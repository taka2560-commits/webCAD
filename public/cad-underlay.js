// ===== Web CAD 背景地図・下絵 =====
// cad-underlay.js - 図面の下に、国土地理院の地図（地理院タイル）と下絵の画像を表示する。
//   地図: 図面の座標を平面直角座標（系番号は 🛰現在地と同じ設定）として緯度経度に直し、Web メルカトルのタイルを
//         タイルごとのアフィン変換で描く（画面の回転にも合う）。出典「地理院タイル」を表示する。インターネットが必要。
//   下絵: 画像（地積測量図のスキャン・写真など）を読み込み、2点で合わせる（画像の上の点 → 図面の点 を2組）。
//         濃さを変えられる。端末に保存し、消すまで残る（アプリを閉じても）。

const UL_TITLE = '🗺 地図・下絵';
const UL_MAPS = {
    std: { name: '標準', ext: 'png', maxZ: 18 },
    pale: { name: '淡色', ext: 'png', maxZ: 18 },
    seamlessphoto: { name: '写真', ext: 'jpg', maxZ: 18 },
};
const UL_OPTS_KEY = 'cad_underlay_opts';
const UL_DB_KEY = 'underlay';  // 自動保存の領域に、下絵を1つ保存する
const UL_MAX_PX = 4096;        // 下絵の画像の長辺（これより大きい画像は縮めて持つ）
const UL_MAX_TILES = 80;       // 1画面で描くタイルの数の上限（超えるときは粗い地図にする）
Object.assign(COGO_SLOT_LABELS, { UA: ['画像の点1', '画1'], UA2: ['図面の点1', '図1'], UB: ['画像の点2', '画2'], UB2: ['図面の点2', '図2'] });
const _ul = {
    tiles: new Map(),   // 'type/z/x/y' → { img, ok, err }
    img: null,          // 下絵 { src（描ける画像）, w, h, T: [a, b, c, d, e, f]（画像の px → 図面）, opacity, on, mime, data, name }
    aligning: false, renderTimer: null, warned: {},
};
// 画像の点（UA・UB）はスナップしない（画像の上の点は図形ではない）
cogoRegisterPickOwner('underlay', { slots: () => ['UA', 'UA2', 'UB', 'UB2'], raw: ['UA', 'UB'], render: () => _ulAfterPick(), update: () => {} });

function ulOpts() {
    const def = { map: 'none', mapOpacity: 0.5 };
    try { return Object.assign(def, JSON.parse(localStorage.getItem(UL_OPTS_KEY) || '{}')); } catch { return def; }
}
function _ulSaveOpts(o) { try { localStorage.setItem(UL_OPTS_KEY, JSON.stringify(o)); } catch { /* 保存できなくても続行 */ } }
function _ulScheduleRender() {
    if(_ul.renderTimer) return;
    _ul.renderTimer = setTimeout(() => { _ul.renderTimer = null; render(); }, 120);
}
function _ulWarnOnce(key, msg) {
    const now = Date.now();
    if(_ul.warned[key] && now - _ul.warned[key] < 60000) return; // 同じ知らせは1分に1回まで
    _ul.warned[key] = now;
    showToast(msg, 4000);
}

// ===== 地図（地理院タイル） =====
function ulLonLatToTile(lon, lat, z) {
    const n = Math.pow(2, z), r = lat * Math.PI / 180;
    return { x: (lon + 180) / 360 * n, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n };
}
function ulTileToLonLat(x, y, z) {
    const n = Math.pow(2, z);
    return { lon: x / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI };
}
function ulTileUrl(type, z, x, y) { return `https://cyberjapandata.gsi.go.jp/xyz/${type}/${z}/${x}/${y}.${UL_MAPS[type].ext}`; }
/**
 * いまの画面に要るタイル。系番号が決まっていなければ null、日本の外なら { outside: true }。
 * 戻り値: { zone, z, list: [{ z, x, y }] }
 */
function ulVisibleTiles(type) {
    const zone = getGnssZone();
    if(!zone) return null;
    const ll = [[0, 0], [canvas.width, 0], [0, canvas.height], [canvas.width, canvas.height]].map(([sx, sy]) => {
        const w = screenToWcs(sx, sy), s = wcsToSurvey(w.x, w.y);
        return jprcsToLatLon(s.X, s.Y, zone);
    });
    const lats = ll.map((p) => p.lat), lons = ll.map((p) => p.lon);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    if(!(lat0 > 20 && lat0 < 46.5) || !lons.every((l) => l > 122 && l < 154.5)) return { outside: true };
    const mpp = 1 / (view.scale * surveyUnitFactor()); // 画面の 1px が何 m か
    let z = Math.round(Math.log2(156543.034 * Math.cos(lat0 * Math.PI / 180) / mpp));
    z = Math.max(2, Math.min(UL_MAPS[type].maxZ, z));
    let t0, t1;
    for(;;) {
        t0 = ulLonLatToTile(Math.min(...lons), Math.max(...lats), z);
        t1 = ulLonLatToTile(Math.max(...lons), Math.min(...lats), z);
        const n = (Math.floor(t1.x) - Math.floor(t0.x) + 1) * (Math.floor(t1.y) - Math.floor(t0.y) + 1);
        if(n <= UL_MAX_TILES || z <= 2) break;
        z--;
    }
    const list = [];
    for(let x = Math.floor(t0.x); x <= Math.floor(t1.x); x++) for(let y = Math.floor(t0.y); y <= Math.floor(t1.y); y++) list.push({ z, x, y });
    return { zone, z, list };
}
function _ulTile(type, z, x, y) {
    const key = `${type}/${z}/${x}/${y}`;
    let t = _ul.tiles.get(key);
    if(t) return t;
    if(_ul.tiles.size > 400) _ul.tiles.delete(_ul.tiles.keys().next().value); // 古いものから捨てる
    const img = new window.Image();
    img.crossOrigin = 'anonymous'; // 地理院タイルは CORS に対応（保存できる形で読み、図面の画面も汚さない）
    t = { img, ok: false, err: false };
    img.onload = () => { t.ok = true; _ulScheduleRender(); };
    img.onerror = () => { t.err = true; _ulWarnOnce('net', '地図を読み込めません（インターネットの接続を確かめてください）'); };
    img.src = ulTileUrl(type, z, x, y);
    _ul.tiles.set(key, t);
    return t;
}
// 画像の3点（左上・右上・左下）が画面のどこに来るかから、描く変換を決めて描く
function _ulDrawAffine(src, w, h, p0, p1, p2) {
    ctx.setTransform((p1.x - p0.x) / w, (p1.y - p0.y) / w, (p2.x - p0.x) / h, (p2.y - p0.y) / h, p0.x, p0.y);
    ctx.drawImage(src, 0, 0, w, h);
}
function _ulLLToScreen(lat, lon, zone) { const p = latLonToJprcs(lat, lon, zone), w = surveyToWcs(p.X, p.Y); return wcsToScreen(w.x, w.y); }
function _ulDrawMap(o) {
    const r = ulVisibleTiles(o.map);
    if(!r) { _ulWarnOnce('zone', '地図を重ねるには、図面の系番号（平面直角座標）を選んでください（🗺 地図・下絵）'); return; }
    if(r.outside) { _ulWarnOnce('out', '図面の座標が平面直角座標ではないため、地図を重ねられません（系番号・単位を確かめてください）'); return; }
    ctx.save();
    ctx.globalAlpha = o.mapOpacity;
    r.list.forEach(({ z, x, y }) => {
        const t = _ulTile(o.map, z, x, y);
        if(!t.ok) return;
        const nw = ulTileToLonLat(x, y, z), ne = ulTileToLonLat(x + 1, y, z), sw = ulTileToLonLat(x, y + 1, z);
        _ulDrawAffine(t.img, 256, 256, _ulLLToScreen(nw.lat, nw.lon, r.zone), _ulLLToScreen(ne.lat, ne.lon, r.zone), _ulLLToScreen(sw.lat, sw.lon, r.zone));
    });
    ctx.restore();
    // 出典（国土地理院のコンテンツ利用規約）。右上の上部バーのすぐ下（右下は ? などのボタンで隠れる）
    const tb = document.getElementById('top-bar');
    const y0 = (tb && tb.getBoundingClientRect().bottom > 0 ? tb.getBoundingClientRect().bottom : 0) + 4;
    ctx.save();
    ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    const s = '出典：地理院タイル', w = ctx.measureText(s).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(canvas.width - w - 14, y0, w + 10, 16);
    ctx.fillStyle = '#e0e0e0'; ctx.fillText(s, canvas.width - 9, y0 + 2);
    ctx.restore();
}

// ===== 下絵（画像） =====
function _ulDrawImage(u) {
    const [a, b, c, d, e, f] = u.T;
    const s0 = wcsToScreen(e, f), s1 = wcsToScreen(e + a * u.w, f + b * u.w), s2 = wcsToScreen(e + c * u.h, f + d * u.h);
    ctx.save();
    ctx.globalAlpha = u.opacity;
    _ulDrawAffine(u.src, u.w, u.h, s0, s1, s2);
    ctx.restore();
}
// 図形の下に描く（cad-render.js から。背景を塗った直後）
function drawUnderlays() {
    const o = ulOpts();
    if(o.map !== 'none' && UL_MAPS[o.map]) _ulDrawMap(o);
    if(_ul.img && _ul.img.on && _ul.img.src) _ulDrawImage(_ul.img);
}
// いまの画面に収まる置き方（画面の8割・画面と同じ向き・画面の中央）。T は 画像の px → 図面
function ulFitTransform(w, h) {
    const rot = view.rotation || 0;
    const s = Math.min(canvas.width * 0.8 / view.scale / w, canvas.height * 0.8 / view.scale / h);
    const cx = screenToWcs(canvas.width / 2, canvas.height / 2);
    const a = s * Math.cos(rot), b = -s * Math.sin(rot), c = -s * Math.sin(rot), d = -s * Math.cos(rot); // 画像の右＝画面の右、下＝画面の下
    return [a, b, c, d, cx.x - (a * w + c * h) / 2, cx.y - (b * w + d * h) / 2];
}
// 2点で合わせる: 画像の上の点 a1・b1（図面の座標）を、図面の点 a2・b2 に重ねる相似変換を T に掛ける
function ulAlignTwoPoints(T, a1, a2, b1, b2) {
    const vx = b1.x - a1.x, vy = b1.y - a1.y, wx = b2.x - a2.x, wy = b2.y - a2.y;
    const L1 = Math.hypot(vx, vy);
    if(L1 < 1e-12 || Math.hypot(wx, wy) < 1e-12) return null;
    const k = Math.hypot(wx, wy) / L1, th = Math.atan2(wy, wx) - Math.atan2(vy, vx);
    const cs = k * Math.cos(th), sn = k * Math.sin(th);
    const S = (x, y) => ({ x: a2.x + cs * (x - a1.x) - sn * (y - a1.y), y: a2.y + sn * (x - a1.x) + cs * (y - a1.y) });
    const [a, b, c, d, e, f] = T, o = S(e, f);
    return { T: [cs * a - sn * b, sn * a + cs * b, cs * c - sn * d, sn * c + cs * d, o.x, o.y], k, th };
}
// 下絵にする（src: 描ける画像、w・h: 画像の大きさ、file: { mime, data（ArrayBuffer）, name }）
function ulSetImage(src, w, h, file, T) {
    _ul.img = { src, w, h, T: T || ulFitTransform(w, h), opacity: 0.6, on: true, mime: file && file.mime, data: file && file.data, name: (file && file.name) || '' };
    render();
}
function _ulDecode(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像の形式には対応していません')); };
        img.src = url;
    });
}
// 大きな画像は長辺 UL_MAX_PX に縮める（端末のメモリを使いすぎないように）
async function _ulShrink(img, file) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const k = Math.min(1, UL_MAX_PX / Math.max(w0, h0));
    if(k >= 1) return { src: img, w: w0, h: h0, mime: file.type || 'image/jpeg', data: await file.arrayBuffer() };
    const cv = document.createElement('canvas');
    cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    const data = await blob.arrayBuffer();
    return { src: await _ulDecode(blob), w: cv.width, h: cv.height, mime: 'image/jpeg', data };
}
async function ulLoadImageFile(file) {
    try {
        const img = await _ulDecode(file);
        const r = await _ulShrink(img, file);
        ulSetImage(r.src, r.w, r.h, { mime: r.mime, data: r.data, name: file.name });
        await ulSaveImage();
        addCommandLog(`-> 下絵を読み込みました: ${file.name}（${r.w}×${r.h}）`);
        showToast('下絵を読み込みました。「📍 2点で合わせる」で図面に重ねます', 3500);
        if(_ulPanelOpen()) _ulRender();
    } catch(e) {
        showToast('画像を読み込めませんでした: ' + e.message, 4000);
    }
}
window.ulPickImage = function() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,application/pdf,.pdf';
    inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if(!f) return;
        if(/\.pdf$/i.test(f.name) || f.type === 'application/pdf') ulLoadPdfFile(f); else ulLoadImageFile(f);
    };
    inp.click();
};
// PDF の1ページを画像にして下絵にする（pdf.js。長辺 UL_MAX_PX まで。ページが複数なら聞く）
async function ulLoadPdfFile(file) {
    try {
        if(typeof window.loadPdfJs !== 'function') throw new Error('PDF 表示エンジンがありません');
        showToast('PDF を読み込んでいます…', 2000);
        const pdfjs = await window.loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        let pageNo = 1;
        if(doc.numPages > 1) {
            const a = window.prompt(`何ページ目を下絵にしますか？（1〜${doc.numPages}）`, '1');
            if(a === null) return false;
            pageNo = Math.min(doc.numPages, Math.max(1, parseInt(cogoHalfWidth(a), 10) || 1));
        }
        const page = await doc.getPage(pageNo);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(6, UL_MAX_PX / Math.max(vp1.width, vp1.height)) });
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
        const g = cv.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png')); // 図面の線がにじまないよう PNG
        const src = await _ulDecode(blob);
        ulSetImage(src, cv.width, cv.height, { mime: 'image/png', data: await blob.arrayBuffer(), name: `${file.name}（${pageNo}ページ）` });
        await ulSaveImage();
        addCommandLog(`-> PDF を下絵にしました: ${file.name} ${pageNo}ページ（${cv.width}×${cv.height}）`);
        showToast('PDF を下絵にしました。「📍 2点で合わせる」で図面に重ねます', 3500);
        if(_ulPanelOpen()) _ulRender();
        return true;
    } catch(e) {
        showToast('PDF を読み込めませんでした: ' + e.message, 4500);
        return false;
    }
}
// 端末に保存（自動保存の領域）。消したときは空にする
async function ulSaveImage() {
    const u = _ul.img;
    try {
        await _dbPut(STORE_AUTOSAVE, UL_DB_KEY, u && u.data ? { mime: u.mime, data: u.data, w: u.w, h: u.h, T: u.T, opacity: u.opacity, on: u.on, name: u.name } : null);
    } catch { /* 保存できなくても表示は続ける */ }
}
async function ulRestore() {
    try {
        const r = await _dbGet(STORE_AUTOSAVE, UL_DB_KEY);
        if(!r || !r.data) return false;
        const src = await _ulDecode(new Blob([r.data], { type: r.mime }));
        _ul.img = { src, w: r.w, h: r.h, T: r.T, opacity: r.opacity, on: r.on !== false, mime: r.mime, data: r.data, name: r.name || '' };
        render();
        return true;
    } catch { return false; }
}
window.addEventListener('load', () => { ulRestore(); });

// ===== パネル =====
function _ulPanelOpen() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === UL_TITLE);
}
window.showUnderlayPanel = function() { _ulRender(); render(); };
function _ulRender() {
    const o = ulOpts(), u = _ul.img, zone = getGnssZone();
    const seg = (cur, list, fn) => `<div class="cogo-seg">${list.map(([v, t]) => `<button class="prop-btn opt-bg-btn ${cur === v ? 'active' : ''}" onclick="${fn}('${v}')">${t}</button>`).join('')}</div>`;
    const row = (label, inner) => `<div class="prop-row cogo-row"><div class="prop-label cogo-label">${label}</div>${inner}</div>`;
    const range = (id, v, fn) => `<input id="${id}" type="range" min="10" max="100" step="5" value="${Math.round(v * 100)}" oninput="${fn}(this.value)" style="flex:1;min-width:0;">`;
    let h = '<div class="ts-sec">地図（国土地理院）</div>' +
        seg(o.map, [['none', 'なし']].concat(Object.keys(UL_MAPS).map((k) => [k, UL_MAPS[k].name])), 'ulSetMap') +
        row('濃さ', range('ul-map-op', o.mapOpacity, 'ulSetMapOpacity')) +
        row('系番号', `<div style="flex:1;font-size:12px;">${zone ? ROMAN[zone] + '系' : '<span style="color:#ffcc00;">未設定</span>'}</div><button class="prop-btn btn-sub cogo-pick" onclick="showGnssZonePanel(false)">選ぶ</button>`) +
        _cogoNote('図面の座標を平面直角座標として、地図を下に重ねます（系番号は 🛰現在地 と同じ設定）。一度見た範囲の地図は端末に保存され、電波の無い所でも表示できます。出典: 地理院タイル') +
        `<div class="prop-row cogo-row"><div class="prop-label cogo-label">保存した地図</div><div id="ul-tile-count" style="flex:1;font-size:12px;">…</div><button class="prop-btn btn-sub cogo-pick" onclick="ulClearTiles()">消す</button></div>` +
        '<div class="ts-sec">下絵（画像）</div>';
    if(!u) {
        h += '<button class="prop-btn" onclick="ulPickImage()">📁 画像・PDF を読み込む</button>' +
            _cogoNote('地積測量図・公図のスキャン（画像・PDF）や写真を図面の下に表示します。読み込んだら「2点で合わせる」で、画像の上の点を図面の同じ点に重ねます。PDF は選んだ1ページを画像にして使います（はじめて PDF を開くときは、表示エンジンの読み込みに通信があります）。');
    } else {
        h += row('画像', `<div style="flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(u.name || '下絵')}（${u.w}×${u.h}）</div>`) +
            row('濃さ', range('ul-img-op', u.opacity, 'ulSetImageOpacity')) +
            `<div class="cogo-btns"><button class="prop-btn" onclick="ulStartAlign()">📍 2点で合わせる</button><button class="prop-btn btn-sub" onclick="ulToggleImage()">${u.on ? '👁 隠す' : '👁 表示'}</button></div>` +
            '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="ulFitImage()">画面に合わせて置き直す</button><button class="prop-btn btn-warn" onclick="ulRemoveImage()">🗑 下絵を消す</button></div>' +
            _cogoNote('2点で合わせる: 画像の上の点1 → 図面の点1 → 画像の点2 → 図面の点2 の順に、なぞって ☑確定（図面の点は測点に吸い付きます）。離れた2点を選ぶと正確です。');
    }
    showPropertyPanel(UL_TITLE, h);
    ulTileCacheCount().then((n) => { const el = document.getElementById('ul-tile-count'); if(el) el.textContent = n === null ? '（この端末では保存しません）' : `${n}枚`; });
}
// 端末に保存した地図のタイルの枚数（アプリとして動いていて保存できないときは null）
const UL_TILE_CACHE = 'webcad-tiles';
async function ulTileCacheCount() {
    try {
        if(typeof window.caches === 'undefined') return null;
        const c = await window.caches.open(UL_TILE_CACHE);
        return (await c.keys()).length;
    } catch { return null; }
}
window.ulClearTiles = async function() {
    if(!confirm('端末に保存した地図を消しますか？（電波がある所では、見るとまた保存されます）')) return;
    try { if(typeof window.caches !== 'undefined') await window.caches.delete(UL_TILE_CACHE); } catch { /* 消せなくても続行 */ }
    _ul.tiles.clear();
    showToast('保存した地図を消しました', 2500);
    if(_ulPanelOpen()) _ulRender();
    render();
};
window.ulSetMap = function(v) {
    const o = ulOpts();
    o.map = UL_MAPS[v] ? v : 'none';
    _ulSaveOpts(o);
    if(o.map !== 'none' && !getGnssZone()) { window.showGnssZonePanel(false); return; }
    _ulRender(); render();
};
window.ulSetMapOpacity = function(v) { const o = ulOpts(); o.mapOpacity = Math.max(0.1, Math.min(1, v / 100)); _ulSaveOpts(o); render(); };
window.ulSetImageOpacity = function(v) { if(!_ul.img) return; _ul.img.opacity = Math.max(0.1, Math.min(1, v / 100)); render(); _ulDeferSave(); };
window.ulToggleImage = function() { if(!_ul.img) return; _ul.img.on = !_ul.img.on; ulSaveImage(); _ulRender(); render(); };
window.ulFitImage = function() { if(!_ul.img) return; _ul.img.T = ulFitTransform(_ul.img.w, _ul.img.h); ulSaveImage(); render(); };
window.ulRemoveImage = function() {
    if(!_ul.img || !confirm('下絵を消しますか？（図面は消えません）')) return;
    _ul.img = null;
    ulSaveImage();
    addCommandLog('-> 下絵を消しました');
    _ulRender(); render();
};
let _ulSaveTimer = null;
function _ulDeferSave() { clearTimeout(_ulSaveTimer); _ulSaveTimer = setTimeout(ulSaveImage, 500); }
window.ulStartAlign = function() {
    if(!_ul.img) return;
    ['UA', 'UA2', 'UB', 'UB2'].forEach((k) => delete _cogo.slots[k]);
    if(!_ul.img.on) _ul.img.on = true;
    _ul.aligning = true;
    showToast('画像の上の点1 → 図面の点1 → 画像の点2 → 図面の点2 の順に指定します', 4000);
    cogoPick('UA', 'underlay');
};
// 点の指定が終わった・やめたとき（cad-cogo-ui.js から）
function _ulAfterPick() {
    if(cogoIsPicking()) { if(!panelCoversDrawing()) _ulRender(); return; } // 指定の途中
    const s = _cogo.slots;
    if(_ul.aligning && _ul.img && s.UA && s.UA2 && s.UB && s.UB2) {
        const r = ulAlignTwoPoints(_ul.img.T, s.UA, s.UA2, s.UB, s.UB2);
        if(!r) showToast('同じ位置の2点では合わせられません。離れた2点を選んでください', 3500);
        else {
            _ul.img.T = r.T;
            ulSaveImage();
            const deg = cogoNormDeg(r.th * 180 / Math.PI);
            addCommandLog(`-> 下絵を2点で合わせました（倍率 ×${r.k.toPrecision(5)}・回転 ${cogoFmtDms(deg)}）`);
            showToast(`下絵を合わせました（倍率 ×${r.k.toPrecision(4)}）`, 3000);
        }
    }
    _ul.aligning = false;
    ['UA', 'UA2', 'UB', 'UB2'].forEach((k) => delete _cogo.slots[k]);
    _ulRender();
    render();
}
// 2点で合わせる途中の印（画像の点＝橙、図面の点＝緑、組を点線で結ぶ）
function drawUnderlayOverlay() {
    if(!_ul.aligning) return;
    const s = _cogo.slots;
    ctx.save();
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 2;
    [['UA', '#ff9f43'], ['UA2', '#00ff88'], ['UB', '#ff9f43'], ['UB2', '#00ff88']].forEach(([k, col]) => {
        const p = s[k];
        if(!p) return;
        const q = wcsToScreen(p.x, p.y);
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(q.x - 11, q.y); ctx.lineTo(q.x + 11, q.y); ctx.moveTo(q.x, q.y - 11); ctx.lineTo(q.x, q.y + 11); ctx.stroke();
        ctx.fillText(COGO_SLOT_LABELS[k][1], q.x + 9, q.y - 6);
    });
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    [['UA', 'UA2'], ['UB', 'UB2']].forEach(([k1, k2]) => {
        if(!s[k1] || !s[k2]) return;
        const p = wcsToScreen(s[k1].x, s[k1].y), q = wcsToScreen(s[k2].x, s[k2].y);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    });
    ctx.restore();
}

// ===== コマンド =====
function processUnderlayCommand(cmd) {
    if(cmd === 'MAP' || cmd === 'UNDERLAY' || cmd === 'SHITAE') { window.showUnderlayPanel(); return true; }
    return false;
}
