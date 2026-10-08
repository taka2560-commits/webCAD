// ===== Web CAD レイアウト（ペーパー空間）を別の画面で見る =====
// cad-layout.js - DWG・DXF のレイアウト（図枠・表題欄・ビューポート）を、モデルとは別の画面に出す。
//   画面の下の「モデル｜レイアウト名」のタブで切り替える（AutoCAD のモデル・レイアウトのタブと同じ）。
//
// ・モデル（作図・測量の図面）には混ぜない（v5.25.4 からモデル空間だけ取り込んでいる）。レイアウトは見るだけで、
//   作図・編集・測量のコマンドや ↩、モデルを使うパネルを開くと、モデルの画面に戻ってから始める
// ・レイアウトの図形は用紙の座標（mm など）。ビューポートは、モデルの図形を縮尺・中心・回転のとおりに写し、枠で切り抜いて描く:
//     用紙の点 = 枠の中心 + k・R(回転)・(モデルの点 − モデルの中心)、k = 枠の高さ ÷ 写すモデルの高さ、
//     モデルの中心 = 注視点 + R(−回転)・表示の中心（ezdxf の Viewport.get_transformation_matrix と同じ）。
//   レイアウトの枠そのもの（用紙全体を映すビューポート）・切ったもの・真上から見ていないものは描かない
// ・画面の位置・大きさは、モデルとレイアウトごとに覚える。⛶ 全体表示は、レイアウトでは用紙全体
// ・座標の表示は、ビューポートの中ならモデルの座標、外なら —
// ・保存・図面一式（.webcad）・↩ の履歴に入る。レイアウトは取り込みのたびに作り直し、中を書き換えないので、履歴は同じ配列を指すだけ
// ・DXF の書き出し・印刷（PDF）には入れない（モデルだけ）。🖼 画面の画像は、見ているレイアウトをそのまま画像にする

let cadLayouts = [];          // [{ name, order, sheet: { x0, y0, x1, y1 }, ents: [図形], vps: [ビューポート] }]
let _layoutIdx = -1;          // 見ているレイアウト（-1 はモデル）
let _layoutModelView = null;  // レイアウトを見ている間の、モデルの表示位置
const _layoutViews = new WeakMap(); // レイアウト → 表示位置
// レイアウトを見たままでよいコマンド（ほかはモデルに戻ってから始める）
const LAYOUT_STAY_COMMANDS = new Set(['CANCEL', 'ZE', 'ZOOM', 'PNGOUT', 'PNG', 'LAYOUT', 'MODEL', 'HELP']);
// レイアウトを見たまま開いてよいパネル（ほかはモデルの画面に戻ってから開く）
const LAYOUT_STAY_PANELS = new Set(['オプション', '❓ ヘルプ・操作ガイド', '画層一括管理']);

function layoutActive() { return _layoutIdx >= 0 && !!cadLayouts[_layoutIdx]; }
function layoutCurrent() { return layoutActive() ? cadLayouts[_layoutIdx] : null; }

// ===== 取り込み =====
// ビューポートの値 → 共通の形。dc: 表示の中心（DCS）、target: 注視点、vh: 写すモデルの高さ、t: 回転（ラジアン）
function layoutViewport(v) {
    const k = (v.vh > 0 && v.h > 0) ? v.h / v.vh : NaN;
    const t = Number(v.t) || 0, cs = Math.cos(-t), sn = Math.sin(-t);
    const T = v.target || {}, d = v.dc || {};
    const dx = Number(d.x) || 0, dy = Number(d.y) || 0;
    const c = { x: (Number(T.x) || 0) + dx * cs - dy * sn, y: (Number(T.y) || 0) + dx * sn + dy * cs };
    return { cx: Number(v.cx), cy: Number(v.cy), w: Number(v.w), h: Number(v.h), k, t, c, layer: v.layer, hide: v.hide, clip: v.clip,
        off: !!v.off, plan: v.plan !== false, overall: !!v.overall };
}
// 真上から見ているか（見る向きが Z。無ければ真上）
function layoutPlanDir(dir) {
    if(!dir) return true;
    const x = Number(dir.x) || 0, y = Number(dir.y) || 0, z = Number(dir.z);
    return Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && !(z < 0);
}
// 用紙全体を映すビューポート（レイアウトの枠）か: 表示の中心が枠の中心と同じで、写す高さが枠の高さ（1:1）
function layoutIsOverallVp(cx, cy, h, dc, vh) {
    return !!dc && Math.abs((Number(dc.x) || 0) - cx) < 1e-6 && Math.abs((Number(dc.y) || 0) - cy) < 1e-6 && Math.abs((Number(vh) || 0) - h) < 1e-6;
}
// 図形とビューポートの広がり（用紙の座標）
function _layoutContentBox(ents, vps) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (b) => { if(b && isFinite(b.minX)) { x0 = Math.min(x0, b.minX); y0 = Math.min(y0, b.minY); x1 = Math.max(x1, b.maxX); y1 = Math.max(y1, b.maxY); } };
    ents.forEach((e) => { if(!e || e.type === 'DIMENSION') return; grow(e.type === 'HATCH' ? (e.target ? calcBBox(e.target) : null) : calcBBox(e)); });
    vps.forEach((v) => grow({ minX: v.cx - v.w / 2, minY: v.cy - v.h / 2, maxX: v.cx + v.w / 2, maxY: v.cy + v.h / 2 }));
    return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
// 取り込んだレイアウト1枚を作る。図形もビューポートも無ければ null（空のレイアウトはタブにしない）
// o: { name, order, lim: { x0, y0, x1, y1 } | null（レイアウトの範囲 LIMMIN・LIMMAX）, ents: [図形], vps: [layoutViewport の形] }
function makeImportedLayout(o) {
    const vps = (o.vps || []).filter((v) => v && !v.overall && !v.off && v.plan && v.w > 0 && v.h > 0 && v.k > 0 && isFinite(v.k) &&
        isFinite(v.cx) && isFinite(v.cy) && isFinite(v.c.x) && isFinite(v.c.y));
    const ents = (o.ents || []).filter(Boolean);
    // 図枠の角などの円弧は見せる（取り込みのオプションの「円弧を隠す」はモデルの軽さのため）
    ents.forEach((e) => { if(e.hiddenBy === 'arc') { e.hidden = false; delete e.hiddenBy; } });
    if(!ents.length && !vps.length) return null;
    // 用紙: レイアウトの範囲が用紙らしい大きさ（50 以上）ならそれ、無ければ図形とビューポートの広がりに少し余白
    let sheet = null;
    const L = o.lim;
    if(L && [L.x0, L.y0, L.x1, L.y1].every(isFinite) && L.x1 - L.x0 >= 50 && L.y1 - L.y0 >= 50) sheet = { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 };
    if(!sheet) {
        const b = _layoutContentBox(ents, vps);
        if(!b) return null;
        const m = Math.max(b.x1 - b.x0, b.y1 - b.y0, 1) * 0.03;
        sheet = { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
    }
    return {
        name: String(o.name || 'レイアウト').slice(0, 200), order: isFinite(o.order) ? Number(o.order) : 0, sheet, ents,
        vps: vps.map((v) => {
            const out = { cx: v.cx, cy: v.cy, w: v.w, h: v.h, k: v.k, t: v.t || 0, c: { x: v.c.x, y: v.c.y } };
            if(Number.isInteger(v.layer)) out.layer = v.layer;
            if(Array.isArray(v.hide) && v.hide.length) out.hide = v.hide.map(String).slice(0, 5000);
            if(Array.isArray(v.clip) && v.clip.length >= 3) out.clip = v.clip.map((p) => ({ x: p.x, y: p.y }));
            return out;
        }),
    };
}
// DWG のビューポート（読込エンジンの形）→ 共通の形。mainVp: レイアウトの枠のビューポートの番号
function dwgLayoutViewport(v, mainVp, layerIndexOf) {
    const c = v.viewportCenter || {};
    const cx = Number(c.x) || 0, cy = Number(c.y) || 0, h = Number(v.height) || 0;
    const handle = v.handle !== undefined ? String(v.handle).toUpperCase() : '';
    const lname = typeof v.layer === 'object' ? (v.layer && v.layer.name) : v.layer;
    return layoutViewport({ cx, cy, w: v.width, h, dc: v.displayCenter, target: v.targetPoint, vh: v.viewHeight, t: v.viewTwistAngle || 0,
        layer: layerIndexOf(lname), off: !!(Number(v.statusBitFlags) & 0x20000), plan: layoutPlanDir(v.viewDirection),
        overall: (!!mainVp && handle === mainVp) || layoutIsOverallVp(cx, cy, h, v.displayCenter, v.viewHeight) });
}
// DXF の VIEWPORT（dxf-parser に登録する読み方。cad-io.js）
function dxfViewportFromTags(type, tags) {
    const v = _dxfCommon(type, tags);
    const first = new Map();
    v.frozen = [];
    tags.forEach(([c, val]) => { if(c === 331) v.frozen.push(String(val)); else if(!first.has(c)) first.set(c, val); });
    const n = (c) => (first.has(c) ? Number(first.get(c)) : undefined);
    v.cx = n(10); v.cy = n(20); v.w = n(40); v.h = n(41); v.status = n(68); v.id = n(69);
    v.vc = { x: n(12) || 0, y: n(22) || 0 }; v.target = { x: n(17) || 0, y: n(27) || 0 };
    v.dir = first.has(16) || first.has(26) || first.has(36) ? { x: n(16) || 0, y: n(26) || 0, z: first.has(36) ? n(36) : 1 } : null;
    v.vh = n(45); v.twist = n(51) || 0; v.flags = n(90) || 0;
    if(first.has(340)) v.clipHandle = String(first.get(340));
    return v;
}
// DXF の OBJECTS の LAYOUT（dxf-parser は読まないので文字から）: [{ handle, name, order, br（ブロックレコード）, vp（枠のビューポート）, lim }]
function dxfLayoutObjectsFromText(text) {
    const out = [];
    const lines = String(text || '').split(/\r\n|\r|\n/);
    let inObj = false, cur = null, sub = '';
    const push = () => { if(cur) out.push(cur); cur = null; };
    for(let i = 0; i + 1 < lines.length; i += 2) {
        const c = lines[i].trim(), v = lines[i + 1].trim();
        if(c === '0') {
            push(); sub = '';
            if(v === 'SECTION') { inObj = (lines[i + 3] || '').trim() === 'OBJECTS'; continue; }
            if(v === 'ENDSEC') { if(inObj) break; continue; }
            if(inObj && v === 'LAYOUT') cur = { name: '', order: 0, lim: {} };
            continue;
        }
        if(!cur) continue;
        if(c === '100') { sub = v; continue; }
        if(c === '5' && !cur.handle) { cur.handle = v.toUpperCase(); continue; }
        if(sub !== 'AcDbLayout') continue;
        if(c === '1') cur.name = lines[i + 1].replace(/^\s+|\s+$/g, '');
        else if(c === '71') cur.order = Number(v);
        else if(c === '10') cur.lim.x0 = Number(v); else if(c === '20') cur.lim.y0 = Number(v);
        else if(c === '11') cur.lim.x1 = Number(v); else if(c === '21') cur.lim.y1 = Number(v);
        else if(c === '330') cur.br = v.toUpperCase();
        else if(c === '331') cur.vp = v.toUpperCase();
    }
    push();
    out.forEach((o) => { const L = o.lim; if(![L.x0, L.y0, L.x1, L.y1].every((x) => typeof x === 'number' && isFinite(x))) o.lim = null; });
    return out;
}
// 切り抜きの形（DXF の 340 が指す図形: LWPOLYLINE・POLYLINE・CIRCLE）→ 用紙の点の並び
function _dxfClipPoints(e) {
    if(!e) return null;
    if((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && Array.isArray(e.vertices) && e.vertices.length >= 3) return e.vertices.map((p) => ({ x: p.x, y: p.y }));
    if(e.type === 'CIRCLE' && e.center && e.radius > 0) return Array.from({ length: 48 }, (_, i) => ({ x: e.center.x + e.radius * Math.cos(i * Math.PI / 24), y: e.center.y + e.radius * Math.sin(i * Math.PI / 24) }));
    return null;
}
// DXF のレイアウト（cad-io.js の importDxfData から）。paperRaw: ENTITIES の中のレイアウトの図形（今のレイアウト）、
// convertList(並び, 入れ先): 図形の並びをアプリの図形にする。layerStyles: 画層表（handle で凍結画層の名前を引く）
function dxfLayoutsFromImport(dxf, text, paperRaw, convertList, layerStyles) {
    const blocks = (dxf && dxf.blocks) || {};
    const objs = dxfLayoutObjectsFromText(text);
    const layerByHandle = new Map();
    Object.keys(layerStyles || {}).forEach((n) => { const h = layerStyles[n] && layerStyles[n].handle; if(h) layerByHandle.set(String(h).toUpperCase(), n); });
    const blockOfBr = new Map();
    Object.values(blocks).forEach((b) => { if(b && PAPER_SPACE_RE.test(b.name || '') && b.ownerHandle !== undefined) blockOfBr.set(String(b.ownerHandle).toUpperCase(), b.name); });
    const lists = [], used = new Set();
    objs.forEach((o) => {
        if(/^model$/i.test(o.name)) return;
        const bn = o.br ? blockOfBr.get(o.br) : null;
        let raw = null;
        if(bn && /^\*paper_space$/i.test(bn)) raw = paperRaw; // 今のレイアウト: 図形は ENTITIES の中
        else if(bn && blocks[bn]) raw = blocks[bn].entities || [];
        if(!raw) return;
        used.add(bn);
        lists.push({ name: o.name, order: o.order, lim: o.lim, mainVp: o.vp, raw });
    });
    // LAYOUT が無いファイル（R12 など）・対応が付かないレイアウトの図形も、別のレイアウトにする
    if(paperRaw.length && !lists.some((l) => l.raw === paperRaw)) lists.push({ name: 'レイアウト', order: 0, lim: null, raw: paperRaw });
    Object.values(blocks).forEach((b) => {
        if(!b || !PAPER_SPACE_RE.test(b.name || '') || used.has(b.name) || /^\*paper_space$/i.test(b.name) || !(b.entities || []).length) return;
        lists.push({ name: b.name.replace(/^\*/, ''), order: 99, lim: null, raw: b.entities });
    });
    return lists.map((l) => {
        const raw = l.raw.filter(Boolean);
        const ents = [];
        convertList(raw.filter((e) => e.type !== 'VIEWPORT'), ents);
        const byHandle = new Map();
        raw.forEach((e) => { if(typeof e.handle === 'string') byHandle.set(e.handle.toUpperCase(), e); });
        const vps = raw.filter((e) => e.type === 'VIEWPORT').map((v) => {
            const handle = typeof v.handle === 'string' ? v.handle.toUpperCase() : '';
            const clip = (v.flags & 0x10000) && v.clipHandle ? _dxfClipPoints(byHandle.get(v.clipHandle.toUpperCase())) : null;
            return layoutViewport({ cx: v.cx, cy: v.cy, w: v.w, h: v.h, dc: v.vc, target: v.target, vh: v.vh, t: (v.twist || 0) * Math.PI / 180,
                layer: typeof dxfLayerIndex === 'function' ? dxfLayerIndex(v.layer) : undefined,
                off: v.status === 0 || !!(v.flags & 0x20000), plan: layoutPlanDir(v.dir),
                overall: v.id === 1 || (!!l.mainVp && handle === l.mainVp) || layoutIsOverallVp(v.cx, v.cy, v.h, v.vc, v.vh),
                hide: (v.frozen || []).map((h) => layerByHandle.get(String(h).toUpperCase())).filter(Boolean), clip });
        });
        return makeImportedLayout({ name: l.name, order: l.order, lim: l.lim, ents, vps });
    }).filter(Boolean);
}

// 取り込みのあと（cad-io.js・cad-dwg.js）。追加なら今のレイアウトに足す（同じ名前は「名前 (2)」）。戻り値は足した枚数
function layoutsFromImport(list, append) {
    const add = (list || []).filter(Boolean).sort((a, b) => a.order - b.order);
    if(!append) { layoutShowModel(true); cadLayouts = add; }
    else if(add.length) {
        const names = new Set(cadLayouts.map((l) => l.name));
        add.forEach((l) => { const base = l.name; let n = base, i = 2; while(names.has(n)) n = `${base} (${i++})`; l.name = n; names.add(n); });
        cadLayouts = cadLayouts.concat(add);
    }
    layoutTabsUpdate();
    return add.length;
}
// 取り込みの知らせに足す文
function layoutImportNote(n) { return n ? `レイアウト ${n}枚は、別の画面に入れました（画面の下の「${(cadLayouts[0] || {}).name || 'レイアウト'}」などのタブで見られます）` : ''; }
// 図面を閉じた・置き換えたとき
function layoutsClear() { layoutShowModel(true); cadLayouts = []; layoutTabsUpdate(); }
// ↩ の履歴から戻したとき（同じ配列なら何もしない）
function layoutsRestoreRef(arr) {
    if(!Array.isArray(arr) || arr === cadLayouts) return;
    const cur = layoutCurrent();
    cadLayouts = arr;
    const i = cur ? arr.indexOf(cur) : -1;
    if(cur && i < 0) layoutShowModel(true); else _layoutIdx = i;
    layoutTabsUpdate();
}
// 保存（_buildSaveData）: 描画の控え（bbox・_hits）は除く。レイアウトが無ければ undefined（保存のデータに入れない）
function layoutsForSave() {
    if(!cadLayouts.length) return undefined;
    return cadLayouts.map((l) => ({ name: l.name, order: l.order, sheet: Object.assign({}, l.sheet), vps: l.vps.map((v) => JSON.parse(JSON.stringify(v))),
        ents: l.ents.map((e) => { const c = Object.assign({}, e); delete c.bbox; delete c._hits; return c; }) }));
}
// 開いたとき（applyProjectData）
function layoutsLoad(raw) {
    layoutShowModel(true);
    cadLayouts = sanitizeLayouts(raw, null);
    layoutTabsUpdate();
}
// 受け取ったレイアウトの形を確かめる（保存データ・図面一式）。cleanEnt(図形) で図形を確かめる（図面一式は cad-webcad.js の _wcEntity）
function sanitizeLayouts(raw, cleanEnt) {
    if(!Array.isArray(raw)) return [];
    const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : NaN;
    const out = [];
    raw.slice(0, 200).forEach((l) => {
        if(!l || typeof l !== 'object') return;
        const s = l.sheet || {};
        const sheet = { x0: num(s.x0), y0: num(s.y0), x1: num(s.x1), y1: num(s.y1) };
        if(![sheet.x0, sheet.y0, sheet.x1, sheet.y1].every(isFinite) || !(sheet.x1 > sheet.x0) || !(sheet.y1 > sheet.y0)) return;
        const ents = (Array.isArray(l.ents) ? l.ents : []).map((e) => cleanEnt ? cleanEnt(e) : (e && typeof e === 'object' && typeof e.type === 'string' ? e : null)).filter(Boolean);
        const vps = (Array.isArray(l.vps) ? l.vps : []).map((v) => {
            if(!v || typeof v !== 'object') return null;
            const o = { cx: num(v.cx), cy: num(v.cy), w: num(v.w), h: num(v.h), k: num(v.k), t: num(v.t) || 0, c: { x: num(v.c && v.c.x), y: num(v.c && v.c.y) } };
            if(![o.cx, o.cy, o.w, o.h, o.k, o.c.x, o.c.y].every(isFinite) || !(o.w > 0 && o.h > 0 && o.k > 0)) return null;
            if(Number.isInteger(v.layer) && v.layer >= 0) o.layer = v.layer;
            if(Array.isArray(v.hide)) o.hide = v.hide.filter((x) => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, 5000);
            if(Array.isArray(v.clip)) { const cl = v.clip.map((p) => ({ x: num(p && p.x), y: num(p && p.y) })).filter((p) => isFinite(p.x) && isFinite(p.y)); if(cl.length >= 3) o.clip = cl; }
            return o;
        }).filter(Boolean);
        out.push({ name: (typeof l.name === 'string' && l.name ? l.name : 'レイアウト').slice(0, 200), order: isFinite(num(l.order)) ? l.order : 0, sheet, ents, vps });
    });
    return out;
}

// ===== 画面の切り替え =====
function _layoutSaveView() { const L = layoutCurrent(); if(L) _layoutViews.set(L, { x: view.x, y: view.y, scale: view.scale, rotation: 0 }); }
// i 枚目のレイアウトの画面にする
function layoutShow(i) {
    const L = cadLayouts[i];
    if(!L || _layoutIdx === i) return;
    if(cmdState.mode !== 'IDLE') resetCommand();
    _layoutSaveView();
    if(_layoutIdx < 0) _layoutModelView = { x: view.x, y: view.y, scale: view.scale, rotation: view.rotation };
    _layoutIdx = i;
    cmdState.selectedIndices = []; cmdState.highlightIdx = -1;
    if(typeof updateSelectionBar === 'function') updateSelectionBar();
    if(typeof window.hideFsCoordTooltip === 'function') window.hideFsCoordTooltip();
    const v = _layoutViews.get(L);
    view = v ? Object.assign({}, v) : { x: 0, y: 0, scale: 1, rotation: 0 };
    document.body.classList.add('layout-mode');
    if(!v) layoutZoomExtents();
    addCommandLog(`-> レイアウト「${L.name}」（見るだけ。作図・編集のボタンを押すとモデルに戻ります）`);
    if(typeof guideShowTip === 'function') guideShowTip('layoutView');
    _layoutAfterSwitch();
}
// モデルの画面に戻す（quiet: 描き直し・知らせをしない。図面を閉じるときなど）
function layoutShowModel(quiet) {
    if(_layoutIdx < 0) return;
    _layoutSaveView();
    _layoutIdx = -1;
    if(_layoutModelView) view = _layoutModelView;
    _layoutModelView = null;
    document.body.classList.remove('layout-mode');
    if(quiet === true) { if(typeof _frameCache !== 'undefined') _frameCache = null; return; }
    addCommandLog('-> モデルに戻りました');
    _layoutAfterSwitch();
}
function _layoutAfterSwitch() {
    if(typeof _frameCache !== 'undefined') _frameCache = null;
    layoutTabsUpdate();
    if(typeof refreshCoordDisplay === 'function') refreshCoordDisplay();
    render();
}
// コマンドを始める前（processCommand）: レイアウトを見ていたら、モデルに戻る（見るだけのコマンドはそのまま）
function layoutBeforeCommand(cmd) { if(layoutActive() && !LAYOUT_STAY_COMMANDS.has(String(cmd || '').toUpperCase())) layoutShowModel(); }
// パネルを開く前（showPropertyPanel）
function layoutBeforePanel(title) { if(layoutActive() && !LAYOUT_STAY_PANELS.has(title)) layoutShowModel(); }
// ⛶ 全体表示（cad-view.js の zoomExtents から）: レイアウトなら用紙全体にして true
function layoutZoomExtents() {
    const L = layoutCurrent();
    if(!L) return false;
    const s = L.sheet, pad = 24, w = canvas.width || 800, h = canvas.height || 600;
    view.rotation = 0;
    view.scale = Math.max(1e-9, Math.min((w - pad * 2) / (s.x1 - s.x0), (h - pad * 2) / (s.y1 - s.y0)));
    _reanchorView(w / 2, h / 2, { x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 });
    render();
    return true;
}
// コマンド LAYOUT（次のレイアウトへ）・MODEL
function processLayoutCommand(cmd) {
    if(cmd === 'MODEL') { layoutShowModel(); return true; }
    if(cmd !== 'LAYOUT' && cmd !== 'LAYOUTS') return false;
    if(!cadLayouts.length) { showToast('この図面にはレイアウトがありません（DWG・DXF のレイアウトを開くと、画面の下にタブが出ます）', { kind: 'warn', ms: 3500 }); return true; }
    layoutShow(layoutActive() ? (_layoutIdx + 1) % cadLayouts.length : 0);
    return true;
}

// ===== タブ（画面の下） =====
function _layoutTabsEl() {
    let el = document.getElementById('space-tabs');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'space-tabs';
    el.className = 'glass-panel';
    el.setAttribute('role', 'tablist');
    el.setAttribute('aria-label', 'モデルとレイアウト');
    const bar = document.getElementById('status-bar');
    if(bar && bar.parentNode) bar.parentNode.insertBefore(el, bar); else document.body.appendChild(el);
    el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-space]');
        if(!b) return;
        const i = Number(b.dataset.space);
        if(i < 0) layoutShowModel(); else layoutShow(i);
    });
    return el;
}
// タブを今の状態にする（コマンドの途中は隠す。updateCommandPill からも呼ぶ）
function layoutTabsUpdate() {
    const label = document.querySelector('#status-bar .paper-space-label');
    if(label) label.textContent = layoutActive() ? layoutCurrent().name : 'モデル';
    let el = document.getElementById('space-tabs');
    if(!cadLayouts.length) { if(el) el.style.display = 'none'; return; }
    el = _layoutTabsEl();
    const tab = (i, name) => {
        const on = i === _layoutIdx;
        return `<button type="button" role="tab" data-space="${i}" class="${on ? 'active' : ''}" aria-selected="${on}" title="${escapeHtml(i < 0 ? 'モデル（作図・測量の図面）' : `レイアウト「${name}」（見るだけ）`)}">${escapeHtml(name)}</button>`;
    };
    const html = tab(-1, 'モデル') + cadLayouts.map((l, i) => tab(i, l.name)).join('');
    if(el.innerHTML !== html) el.innerHTML = html;
    el.style.display = (layoutActive() || typeof cmdState === 'undefined' || cmdState.mode === 'IDLE') ? 'flex' : 'none';
}

// ===== 描く =====
// ビューポートの中を描くための表示（モデルの点 → 画面）。Lv はレイアウトの表示（用紙の点 → 画面）
function layoutVpView(vp, Lv) {
    const s2 = Lv.scale * vp.k, r2 = (Lv.rotation || 0) + (vp.t || 0);
    const lr = Lv.rotation || 0, lc = Math.cos(lr), ls = Math.sin(lr);
    const sx = Lv.x + (vp.cx * lc - vp.cy * ls) * Lv.scale, sy = Lv.y - (vp.cx * ls + vp.cy * lc) * Lv.scale; // 枠の中心の画面の位置
    const cs = Math.cos(r2), sn = Math.sin(r2), c = vp.c;
    return { x: sx - (c.x * cs - c.y * sn) * s2, y: sy + (c.x * sn + c.y * cs) * s2, scale: s2, rotation: r2 };
}
// ビューポートの枠（用紙の点の並び）
function _layoutVpOutline(vp) {
    if(vp.clip) return vp.clip;
    const x0 = vp.cx - vp.w / 2, x1 = vp.cx + vp.w / 2, y0 = vp.cy - vp.h / 2, y1 = vp.cy + vp.h / 2;
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}
// 用紙の点 → モデルの点（ビューポート vp の写し方で）
function _layoutPaperToModel(vp, px, py) {
    const dx = (px - vp.cx) / vp.k, dy = (py - vp.cy) / vp.k, cs = Math.cos(-vp.t), sn = Math.sin(-vp.t);
    return { x: vp.c.x + dx * cs - dy * sn, y: vp.c.y + dx * sn + dy * cs };
}
function _layoutInside(pts, x, y) {
    let inside = false;
    for(let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}
// 用紙の点 (px, py) が入っているビューポートの、モデルの点（無ければ null）
function layoutModelAt(px, py) {
    const L = layoutCurrent();
    if(!L) return null;
    for(let i = L.vps.length - 1; i >= 0; i--) {
        const vp = L.vps[i];
        if(_layoutInside(_layoutVpOutline(vp), px, py)) return _layoutPaperToModel(vp, px, py);
    }
    return null;
}
// 座標の表示（cad-input.js）: ビューポートの中ならモデルの座標、外なら —
function layoutShowCoords(px, py) {
    const m = layoutModelAt(px, py);
    if(m) { const u = wcsToUcs(m.x, m.y); setCoordsDisplay(u.x, u.y); return; }
    if(typeof coordsDisplay !== 'undefined' && coordsDisplay) {
        const xs = coordsDisplay.querySelector('.coord-x'), ys = coordsDisplay.querySelector('.coord-y');
        if(xs && ys) { xs.textContent = 'X:—'; ys.textContent = 'Y:—'; }
    }
}
// レイアウトの画面を描く（cad-render.js の _drawFrame から）: 用紙の外 → 用紙 → ビューポート（モデル）→ 用紙の図形（図枠・表題欄など）
function drawLayoutSheet() {
    const L = layoutCurrent();
    if(!L) return;
    const light = isLightCanvasBg();
    const s = L.sheet;
    const p0 = wcsToScreen(s.x0, s.y0), p1 = wcsToScreen(s.x1, s.y1);
    const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y), w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
    ctx.save();
    ctx.fillStyle = light ? '#b8bdc5' : '#2b3038';
    ctx.fillRect(-10, -10, canvas.width + 20, canvas.height + 20); // 用紙の外
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 4, y + 4, w, h); // 用紙の影
    ctx.fillStyle = canvasBg;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    const Lv = { x: view.x, y: view.y, scale: view.scale, rotation: view.rotation || 0 };
    try {
        L.vps.forEach((vp) => _layoutDrawViewport(vp, Lv));
    } finally { view = Lv; }
    drawEntities({ list: L.ents, plain: true });
    ctx.save();
    ctx.strokeStyle = light ? '#7a808a' : '#5c636e';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h); // 用紙の縁
    ctx.restore();
}
function _layoutDrawViewport(vp, Lv) {
    const out = _layoutVpOutline(vp).map((p) => wcsToScreen(p.x, p.y));
    ctx.save();
    ctx.beginPath();
    out.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.clip();
    // 写す範囲（モデルの座標）: 枠の四隅をモデルに戻した外接
    const ms = _layoutVpOutline(vp).map((p) => _layoutPaperToModel(vp, p.x, p.y));
    const cull = { minX: Math.min(...ms.map((p) => p.x)), minY: Math.min(...ms.map((p) => p.y)), maxX: Math.max(...ms.map((p) => p.x)), maxY: Math.max(...ms.map((p) => p.y)) };
    let hide = null;
    if(vp.hide && vp.hide.length) { const set = new Set(vp.hide); hide = new Set(); layers.forEach((l, i) => { if(set.has(l.name)) hide.add(i); }); }
    view = layoutVpView(vp, Lv);
    drawEntities({ cull, hideLayers: hide, plain: true });
    drawDimensions();
    view = Lv;
    ctx.restore();
    // 枠（画層が表示のときだけ。薄い線）
    if(vp.layer === undefined || !layers[vp.layer] || layers[vp.layer].visible) {
        ctx.save();
        ctx.strokeStyle = isLightCanvasBg() ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        out.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }
}
// 隠していた塗りつぶし・円弧をレイアウトでも出す（cad-input.js の showHiddenEntities から）。出した数
function layoutsShowHidden(kind) {
    let n = 0;
    cadLayouts.forEach((l) => l.ents.forEach((e) => {
        if(!e.hidden) return;
        const k = e.hiddenBy === 'fill' ? 'fill' : e.type === 'ARC' ? 'arc' : 'other';
        if(kind && k !== kind) return;
        e.hidden = false; delete e.hiddenBy; n++;
    }));
    return n;
}
