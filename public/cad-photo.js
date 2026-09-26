// ===== Web CAD 現場写真・メモ =====
// cad-photo.js - 図面の場所にピンを立て、メモと写真を付ける。写真台帳（PDF）を作る。
//   ピンは図形の一種（type 'PIN'）として図面に入れる: { x, y, text, photos: [写真の番号], time, name（近くの測点名） }。
//   図面と一緒に保存され、元に戻す・図面を閉じる・置き換えにもそのまま従う。画層「写真・メモ」の表示でピンを隠せる。
//   写真は長辺 1600px の JPEG に縮めて、端末の保存領域（IndexedDB の自動保存の領域）に 'photo:番号' で入れる。
//   写真台帳: A4 縦に 3件ずつ（写真・番号・場所・座標・日時・メモ）。JPEG はそのまま PDF に入れる（cad-print.js の pdfBuild）。

const PHOTO_TITLE = '📷 写真・メモ';
const PHOTO_LAYER = '写真・メモ';
const PHOTO_MAX_PX = 1600;
const PHOTO_PIN_R = 10; // 画面上のピンの半径（px）
Object.assign(COGO_SLOT_LABELS, { PN: ['ピンを立てる場所', '📍'] });
const _ph = { editing: null, urls: new Map(), viewing: null };
cogoRegisterPickOwner('photo', { slots: () => ['PN'], render: () => _phAfterPick(), update: () => {} });

function photoPins() { return entities.filter((e) => e && e.type === 'PIN'); }
function _phLayerVisible() { const i = layers.findIndex((l) => l.name === PHOTO_LAYER); return i < 0 || layers[i].visible !== false; }
function _phPinById(id) { return entities.find((e) => e && e.type === 'PIN' && e.id === id) || null; }
function _phNewKey() { return 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function _phFmtTime(iso) {
    const d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// ===== 写真の保存 =====
async function photoSave(key, rec) { await _dbPut(STORE_AUTOSAVE, 'photo:' + key, rec); }
async function photoLoad(key) { try { return await _dbGet(STORE_AUTOSAVE, 'photo:' + key); } catch { return null; } }
async function photoDelete(key) { try { await _dbPut(STORE_AUTOSAVE, 'photo:' + key, null); } catch { /* 消せなくても続行 */ } }
// 画像ファイル → 長辺 PHOTO_MAX_PX の JPEG { mime, data, w, h }
async function photoShrink(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new window.Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('この画像の形式には対応していません'));
            im.src = url;
        });
        const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
        const k = Math.min(1, PHOTO_MAX_PX / Math.max(w0, h0));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
        const g = cv.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height); // 透明な画像は白地に
        g.drawImage(img, 0, 0, cv.width, cv.height);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
        return { mime: 'image/jpeg', data: await blob.arrayBuffer(), w: cv.width, h: cv.height };
    } finally { URL.revokeObjectURL(url); }
}
// 写真の表示用 URL（作ったものは覚えておく）
async function _phUrl(key) {
    if(_ph.urls.has(key)) return _ph.urls.get(key);
    const r = await photoLoad(key);
    const u = r && r.data ? URL.createObjectURL(new Blob([r.data], { type: r.mime || 'image/jpeg' })) : '';
    _ph.urls.set(key, u);
    return u;
}

// ===== ピン =====
// 場所にピンを立てる（元に戻すは1回）。近くの測点名を覚える
function photoAddPin(x, y) {
    saveUndo();
    const layer = _ensureSurveyLayer(PHOTO_LAYER, '#ff9f43');
    const pin = { type: 'PIN', layer, color: null, x, y, text: '', photos: [], time: new Date().toISOString(), name: cogoPointNameAt(x, y) };
    entities.push(pin);
    ensureEntityIds(); initLayers();
    if(typeof updateLayerPanel === 'function') updateLayerPanel();
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    render();
    return pin;
}
// 画面上の (sx, sy) の近くのピン（通常画面の何もしていないときのタップから）。開いたら true
function photoPinTap(sx, sy) {
    if(!_phLayerVisible()) return false;
    let best = null, bd = PHOTO_PIN_R + 8;
    photoPins().forEach((p) => {
        const s = wcsToScreen(p.x, p.y), d = Math.hypot(s.x - sx, s.y - (sy + PHOTO_PIN_R)); // ピンの頭（点の少し上）
        const d2 = Math.hypot(s.x - sx, s.y - sy);
        const dm = Math.min(d, d2);
        if(dm < bd) { bd = dm; best = p; }
    });
    if(!best) return false;
    photoEdit(best.id);
    return true;
}

// ===== パネル（一覧・編集） =====
function _phPanelOpen() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!(p && p.style.display === 'flex' && t && t.textContent === PHOTO_TITLE);
}
window.showPhotoPanel = function() { _ph.editing = null; _ph.viewing = null; _phRenderList(); render(); };
function _phRenderList() {
    const pins = photoPins();
    let h = '<div class="cogo-btns"><button class="prop-btn" onclick="photoStartAdd()">📍 ピンを立てる</button>' +
        `<button class="prop-btn btn-sub" onclick="photoLedgerPdf()" ${pins.length ? '' : 'disabled'}>📄 写真台帳 PDF</button></div>`;
    if(!pins.length) h += _cogoNote('図面の場所にピンを立てて、メモと写真（その場で撮る・選ぶ）を付けます。ピンは図面と一緒に保存されます。写真台帳（PDF）も作れます。');
    else {
        h += '<div class="ph-list">' + pins.map((p, i) => {
            const s = wcsToSurvey(p.x, p.y);
            return `<button class="ph-row" onclick="photoEdit(${p.id}, true)"><span class="ph-no">${i + 1}</span>` +
                `<span class="ph-main"><span class="ph-t">${escapeHtml(p.name || `X ${cogoFix(s.X, 1)} Y ${cogoFix(s.Y, 1)}`)}${p.photos.length ? `&nbsp;&nbsp;📷${p.photos.length}` : ''}</span>` +
                `<span class="ph-m">${escapeHtml((p.text || '（メモなし）').split('\n')[0])}</span></span><span class="ph-d">${_phFmtTime(p.time)}</span></button>`;
        }).join('') + '</div>';
        h += _cogoNote('ピンをタップすると編集します。図面のピンをタップしても開きます。ピンは画層「写真・メモ」で隠せます。');
    }
    showPropertyPanel(PHOTO_TITLE, h);
}
window.photoStartAdd = function() { delete _cogo.slots.PN; cogoPick('PN', 'photo'); };
function _phAfterPick() {
    if(cogoIsPicking()) { if(!panelCoversDrawing()) _phRenderList(); return; }
    const s = _cogo.slots.PN;
    delete _cogo.slots.PN;
    if(!s) { _phRenderList(); return; } // やめたとき
    const pin = photoAddPin(s.x, s.y);
    addCommandLog(`-> ピンを立てました${pin.name ? '（' + pin.name + '）' : ''}`);
    photoEdit(pin.id);
}
// ピンの編集画面。center: ピンを画面の中央に
window.photoEdit = function(id, center) {
    const p = _phPinById(id);
    if(!p) { _phRenderList(); return; }
    _ph.editing = id; _ph.viewing = null;
    if(center) { _reanchorView(canvas.width / 2, canvas.height / 2, { x: p.x, y: p.y }); render(); }
    _phRenderEdit();
};
function _phRenderEdit() {
    const p = _phPinById(_ph.editing);
    if(!p) { _phRenderList(); return; }
    const s = wcsToSurvey(p.x, p.y), no = photoPins().indexOf(p) + 1;
    let h = `<div class="ph-head"><span class="ph-no">${no}</span><span>${escapeHtml(p.name || '（点名なし）')}&nbsp;&nbsp;X ${cogoFix(s.X, 3)}&nbsp;&nbsp;Y ${cogoFix(s.Y, 3)}</span></div>` +
        `<div class="cogo-note">${_phFmtTime(p.time)}</div>` +
        `<textarea id="ph-text" class="prop-val ph-text" rows="3" placeholder="メモ（境界標の種類・状態、立会いの内容など）" oninput="photoSetText(this.value)">${escapeHtml(p.text || '')}</textarea>` +
        '<div id="ph-thumbs" class="ph-thumbs"></div>' +
        '<div class="cogo-btns"><button class="prop-btn" onclick="photoAddFile(true)">📷 撮る</button><button class="prop-btn btn-sub" onclick="photoAddFile(false)">🖼 選ぶ</button></div>' +
        '<div id="ph-view"></div>' +
        '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="showPhotoPanel()">◀ 一覧へ</button><button class="prop-btn btn-warn" onclick="photoDeletePin()">🗑 ピンを消す</button></div>';
    showPropertyPanel(PHOTO_TITLE, h);
    _phRenderThumbs(p);
}
async function _phRenderThumbs(p) {
    const box = document.getElementById('ph-thumbs');
    if(!box) return;
    const parts = await Promise.all(p.photos.map(async (k) => {
        const u = await _phUrl(k);
        return u ? `<div class="ph-th"><img src="${u}" alt="写真" onclick="photoView('${k}')"><button onclick="photoRemovePhoto('${k}')" aria-label="写真を外す">✕</button></div>`
            : `<div class="ph-th ph-miss" onclick="photoRemovePhoto('${k}')">写真が見つかりません（✕ で外す）</div>`;
    }));
    if(_ph.editing === p.id && document.getElementById('ph-thumbs')) box.innerHTML = parts.join('') || '<div class="cogo-note">写真はまだありません</div>';
}
let _phTextTimer = null;
window.photoSetText = function(v) {
    const p = _phPinById(_ph.editing);
    if(!p) return;
    p.text = String(v);
    clearTimeout(_phTextTimer);
    _phTextTimer = setTimeout(() => { if(typeof scheduleAutoSave === 'function') scheduleAutoSave(); }, 400);
};
// 写真を足す（camera: その場で撮る）
window.photoAddFile = function(camera) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if(camera) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
    inp.onchange = () => { if(inp.files && inp.files.length) photoAddFiles([...inp.files]); };
    inp.click();
};
async function photoAddFiles(files) {
    const p = _phPinById(_ph.editing);
    if(!p) return 0;
    let n = 0;
    for(const f of files) {
        try {
            const r = await photoShrink(f);
            const key = _phNewKey();
            await photoSave(key, Object.assign(r, { name: f.name || '', time: new Date().toISOString() }));
            p.photos.push(key);
            n++;
        } catch(e) { showToast('写真を追加できませんでした: ' + e.message, 4000); }
    }
    if(n) {
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
        addCommandLog(`-> 写真を ${n}枚 追加しました（ピン ${photoPins().indexOf(p) + 1}）`);
        showToast(`写真を ${n}枚 追加しました`, 2000);
        render();
    }
    if(_ph.editing === p.id && _phPanelOpen()) _phRenderThumbs(p);
    return n;
}
window.photoView = async function(key) {
    const box = document.getElementById('ph-view');
    if(!box) return;
    if(_ph.viewing === key) { _ph.viewing = null; box.innerHTML = ''; return; }
    _ph.viewing = key;
    const u = await _phUrl(key);
    box.innerHTML = u ? `<img class="ph-big" src="${u}" alt="写真" onclick="photoView('${key}')">` : '';
};
window.photoRemovePhoto = async function(key) {
    const p = _phPinById(_ph.editing);
    if(!p || !confirm('この写真をピンから外して消しますか？')) return;
    p.photos = p.photos.filter((k) => k !== key);
    await photoDelete(key);
    const u = _ph.urls.get(key); if(u) URL.revokeObjectURL(u);
    _ph.urls.delete(key);
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    render();
    _phRenderEdit();
};
window.photoDeletePin = function() {
    const p = _phPinById(_ph.editing);
    if(!p || !confirm('このピンを消しますか？（↩ で戻せます。写真は端末に残ります）')) return;
    saveUndo();
    const i = entities.indexOf(p);
    if(i >= 0) entities.splice(i, 1);
    _ph.editing = null;
    addCommandLog('-> ピンを消しました');
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    render();
    _phRenderList();
};

// ===== 重ね表示（ピン） =====
function drawPhotoPins() {
    if(!_phLayerVisible()) return;
    const pins = photoPins();
    if(!pins.length) return;
    ctx.save();
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    pins.forEach((p, i) => {
        const s = wcsToScreen(p.x, p.y);
        if(s.x < -30 || s.y < -40 || s.x > canvas.width + 30 || s.y > canvas.height + 30) return;
        const r = PHOTO_PIN_R, cy = s.y - r - 6, on = _ph.editing === p.id;
        // しずく形のピン（先が場所を指す）
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - r * 0.6, cy + r * 0.8);
        ctx.arc(s.x, cy, r, Math.PI * 0.8, Math.PI * 0.2);
        ctx.closePath();
        ctx.fillStyle = on ? '#ffcc00' : '#ff9f43'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1b1b1b';
        ctx.fillText(String(i + 1), s.x, cy + 0.5);
        if(p.photos && p.photos.length) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(s.x + r * 0.85, cy - r * 0.75, 3.5, 0, Math.PI * 2); ctx.fill(); }
    });
    ctx.restore();
}

// ===== 写真台帳（PDF） =====
// 文字を幅 maxW（pt）で折り返す
function _phWrap(text, size, maxW) {
    const out = [];
    String(text || '').split('\n').forEach((para) => {
        let line = '';
        for(const ch of para) {
            if(pdfTextWidth(line + ch, size) > maxW && line) { out.push(line); line = ch; }
            else line += ch;
        }
        out.push(line);
    });
    return out;
}
/**
 * 写真台帳のページを作る（A4 縦・1ページに3件）。entries: [{ no, place, X, Y, time, text, img: { jpeg, w, h } | null }]
 * 戻り値: [{ W, H, content, images }]
 */
function photoLedgerPages(entries, title) {
    const k = PT_PER_MM, W = 210, H = 297, per = 3, rowH = 84, top = H - 22;
    const pages = [];
    for(let p0 = 0; p0 < Math.max(1, entries.length); p0 += per) {
        const out = [], images = [];
        const txt = (s, x, y, size) => out.push(`BT /F1 ${pdfNum(size * k)} Tf 1 0 0 1 ${pdfNum(x * k)} ${pdfNum(y * k)} Tm <${pdfHexText(s)}> Tj ET`);
        out.push('0 0 0 RG 0 0 0 rg 0.5 w');
        txt('写真台帳' + (title ? '　' + title : ''), 15, H - 15, 5);
        const pageNo = Math.floor(p0 / per) + 1, pageCnt = Math.max(1, Math.ceil(entries.length / per));
        txt(`${pageNo} / ${pageCnt}`, W - 30, H - 15, 3.5);
        entries.slice(p0, p0 + per).forEach((e, j) => {
            const y0 = top - (j + 1) * rowH; // この件の下端（mm）
            // 写真の枠（120×80mm）に、縦横比を保って入れる
            const bx = 15, by = y0 + 2, bw = 118, bh = rowH - 6;
            out.push(`${pdfNum(bx * k)} ${pdfNum(by * k)} ${pdfNum(bw * k)} ${pdfNum(bh * k)} re S`);
            if(e.img) {
                const name = 'Im' + (images.length + 1);
                images.push({ name, jpeg: e.img.jpeg, w: e.img.w, h: e.img.h });
                const sc = Math.min(bw / e.img.w, bh / e.img.h), iw = e.img.w * sc, ih = e.img.h * sc;
                const ix = bx + (bw - iw) / 2, iy = by + (bh - ih) / 2;
                out.push(`q ${pdfNum(iw * k)} 0 0 ${pdfNum(ih * k)} ${pdfNum(ix * k)} ${pdfNum(iy * k)} cm /${name} Do Q`);
            } else txt('（写真なし）', bx + bw / 2 - 12, by + bh / 2, 4);
            // 右の欄（番号・場所・座標・日時・メモ）
            const tx = bx + bw + 5, tw = W - 15 - tx;
            out.push(`${pdfNum(tx * k)} ${pdfNum(by * k)} ${pdfNum(tw * k)} ${pdfNum(bh * k)} re S`);
            let ty = by + bh - 6;
            const line = (s, size) => { txt(s, tx + 2, ty, size); ty -= size * 1.5; };
            line(`No. ${e.no}`, 4.2);
            if(e.place) line('場所 ' + e.place, 3.4);
            line(`X ${cogoFix(e.X, 3)}`, 3.2);
            line(`Y ${cogoFix(e.Y, 3)}`, 3.2);
            if(e.time) line(e.time, 3.2);
            _phWrap(e.text, 3.2 * k, (tw - 4) * k).slice(0, 8).forEach((s) => line(s, 3.2));
        });
        pages.push({ W: W * k, H: H * k, content: out.join('\n') + '\n', images });
    }
    return pages;
}
window.photoLedgerPdf = async function() {
    const pins = photoPins();
    if(!pins.length) return null;
    const entries = [];
    for(let i = 0; i < pins.length; i++) {
        const p = pins[i], s = wcsToSurvey(p.x, p.y);
        const base = { no: String(i + 1), place: p.name || '', X: s.X, Y: s.Y, time: _phFmtTime(p.time), text: p.text || '' };
        if(!p.photos.length) { entries.push(Object.assign({ img: null }, base)); continue; }
        for(let j = 0; j < p.photos.length; j++) {
            const r = await photoLoad(p.photos[j]);
            entries.push(Object.assign({}, base, { no: p.photos.length > 1 ? `${i + 1}-${j + 1}` : String(i + 1), img: r && r.data ? { jpeg: new Uint8Array(r.data), w: r.w, h: r.h } : null }));
        }
    }
    const title = (window._drawingName || '').replace(/\.[^.]+$/, '');
    const bytes = await pdfBuild({ pages: photoLedgerPages(entries, title) }, { title: '写真台帳 ' + title }, true);
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${_baseName()}_写真台帳.pdf`);
    addCommandLog(`-> 写真台帳を作りました（${entries.length}件）`);
    showToast(`写真台帳（${entries.length}件）を保存しました`, 3000);
    return bytes;
};

// ===== コマンド =====
function processPhotoCommand(cmd) {
    if(cmd === 'PHOTO' || cmd === 'MEMO' || cmd === 'PIN') { window.showPhotoPanel(); return true; }
    return false;
}
