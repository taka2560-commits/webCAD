// ===== Web CAD 線種・線の太さ =====
// cad-ltype.js - 線種（破線・一点鎖線など）と線の太さ。取り込み（DXF・DWG）・画面の描画・印刷（PDF）・DXF の書き出し・プロパティで使う。
//   線種: 図形の lt（無い・BYLAYER は画層に従う）、画層の lt（無い・CONTINUOUS は実線）。
//         模様は、図面の線種表 drawingLineTypes（取り込んだファイルの線種）、無ければ標準の線種（acadiso.lin と同じ mm の値）。
//         模様の長さ（図面の単位）＝ 模様 × 線種の尺度（図面の LTSCALE）× 図形の線種の尺度（ltScale）。AutoCAD と同じ決まり。
//   線の太さ: 図形の lw（1/100 mm）、無ければ画層の lw、それも無ければ既定（0.25mm）。画面では mm × 4px（細い線は 1px・太くても 6px まで）。
//   取り込むとき、ブロックの中の BYBLOCK は、ブロック参照（INSERT）の線種・太さにする。

const LTYPE_STD = {
    CONTINUOUS: { d: [], ja: '実線' },
    DASHED: { d: [12.7, -6.35], ja: '破線' },
    HIDDEN: { d: [6.35, -3.175], ja: 'かくれ線' },
    CENTER: { d: [31.75, -6.35, 6.35, -6.35], ja: '一点鎖線' },
    PHANTOM: { d: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35], ja: '二点鎖線' },
    DOT: { d: [0, -6.35], ja: '点線' },
    DASHDOT: { d: [12.7, -6.35, 0, -6.35], ja: '一点鎖線（短）' },
    DIVIDE: { d: [12.7, -6.35, 0, -6.35, 0, -6.35], ja: '二点鎖線（短）' },
    BORDER: { d: [12.7, -6.35, 12.7, -6.35, 0, -6.35], ja: '境界線' },
};
// 線の太さの選べる値（1/100 mm）
const LWEIGHT_STD = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const LWEIGHT_DEFAULT = 25;

let drawingLineTypes = {};  // 図面の線種表（取り込んだファイルの線種。キーは大文字の名前 → { name, d, desc }）
let drawingLtscale = null;  // 図面の線種の尺度（LTSCALE）。null は既定（1/500 の用紙で模様が mm どおり: mm の図面 500・m の図面 0.5）
function _readShowLw() { try { return localStorage.getItem('cad_show_lineweights') !== '0'; } catch { return true; } }
let showLineweights = _readShowLw(); // 画面に線の太さを出すか（オプション「線の太さを表示」。初期値: 入）

const _ltKey = (n) => String(n || '').trim().toUpperCase();
function getDrawingLtscale() {
    if(drawingLtscale > 0) return drawingLtscale;
    return 0.5 * ((typeof surveyUnitFactor === 'function') ? surveyUnitFactor() : 1);
}
// 線種の模様（模様の単位。負は間、0 は点）。実線・分からない名前は null。標準の 2（半分）・X2（2倍）も分かる
function ltypePattern(name) {
    const K = _ltKey(name);
    if(!K || K === 'CONTINUOUS' || K === 'BYLAYER' || K === 'BYBLOCK') return null;
    const own = drawingLineTypes[K];
    if(own) return (own.d && own.d.length) ? own.d : null;
    if(LTYPE_STD[K]) return LTYPE_STD[K].d.length ? LTYPE_STD[K].d : null;
    const m = /^(.+?)(X2|2)$/.exec(K);
    if(m && LTYPE_STD[m[1]] && LTYPE_STD[m[1]].d.length) { const f = m[2] === '2' ? 0.5 : 2; return LTYPE_STD[m[1]].d.map(v => v * f); }
    return null;
}
// 線種の表示名（日本語があれば「一点鎖線（CENTER）」）
function ltypeLabel(name) {
    const K = _ltKey(name);
    if(!K || K === 'BYLAYER') return '画層に従う';
    const std = LTYPE_STD[K];
    if(std) return `${std.ja}（${K}）`;
    const m = /^(.+?)(X2|2)$/.exec(K);
    if(m && LTYPE_STD[m[1]]) return `${LTYPE_STD[m[1]].ja}${m[2] === '2' ? '（半分）' : '（2倍）'}（${K}）`;
    return String(name);
}
// 選べる線種の名前（標準＋図面の線種表）
function ltypeNames() {
    const set = new Set(Object.keys(LTYPE_STD));
    Object.values(drawingLineTypes).forEach(t => set.add(t.name || ''));
    return [...set].filter(Boolean);
}
// 図形の線種の名前（画層に従うときは画層の線種）。実線は null
function effectiveLinetype(e) {
    let n = e && e.lt;
    if(!n || _ltKey(n) === 'BYLAYER') { const L = e && layers[e.layer]; n = L && L.lt; }
    const K = _ltKey(n);
    return (!K || K === 'CONTINUOUS' || K === 'BYBLOCK' || K === 'BYLAYER') ? null : n;
}
// 図形の線の太さ（1/100 mm）
function effectiveLineweight(e) {
    if(e && typeof e.lw === 'number' && e.lw >= 0) return e.lw;
    const L = e && layers[e.layer];
    return (L && typeof L.lw === 'number' && L.lw >= 0) ? L.lw : LWEIGHT_DEFAULT;
}
const lwToPx = (lw) => Math.min(6, Math.max(1, lw / 100 * 4));
// 模様を、長さの倍率 unit（模様の 1 → 画面 px・用紙 pt）で、線・間を交互に並べた点線の指定にする。
// 間の無い模様や、1周期が minTotal より短い（細かすぎて線に見える）ときは null（実線で描く）
function ltypeDashArray(pattern, unit, dot, minTotal) {
    if(!pattern || !pattern.length || !pattern.some(v => v < 0)) return null;
    const segs = [];
    pattern.forEach(v => {
        const gap = v < 0, len = gap ? -v * unit : (v === 0 ? dot : v * unit);
        const last = segs[segs.length - 1];
        if(last && last[1] === gap) last[0] += len; else segs.push([len, gap]);
    });
    if(segs[0][1]) segs.unshift([0, false]); // 間から始まる模様
    if(segs.length % 2) segs[0][0] += segs.pop()[0]; // 最後の線は、次の周期の最初の線につなぐ
    const arr = segs.map(s => s[0]);
    const total = arr.reduce((a, b) => a + b, 0);
    return total >= minTotal ? arr : null;
}

// ===== 画面: 図形ごとの線の描き方（1回の描画ごとに作る。同じ描き方はまとめて描けるよう key をそろえる） =====
function makeLineStyler() {
    const ltsc = getDrawingLtscale(), sc = view.scale;
    const w1 = lineWidthPx(1);
    const solid = { key: '|' + w1, dash: null, w: w1 };
    const cache = new Map();
    return (e) => {
        const name = effectiveLinetype(e);
        const lw = showLineweights ? effectiveLineweight(e) : null;
        if(!name && (lw === null || lwToPx(lw) === 1)) return solid;
        const k = (e.ltScale > 0 ? e.ltScale : 1);
        const ck = (name || '') + '|' + k + '|' + lw;
        let st = cache.get(ck);
        if(!st) {
            const w = lw === null ? w1 : lineWidthPx(lwToPx(lw));
            const dash = name ? ltypeDashArray(ltypePattern(name), ltsc * k * sc, 1, 4) : null;
            st = { key: (dash ? dash.join(',') : '') + '|' + w, dash, w };
            cache.set(ck, st);
        }
        return st;
    };
}
// ===== 印刷（PDF）: 線の太さ（mm）と点線（pt） =====
//   mmPerUnit: 図面の1単位が用紙で何 mm か。ptPerMm: 1mm が何 pt か。模様の1周期が用紙で 0.5mm より短いときは実線
function printLineStyle(e, mmPerUnit, ptPerMm) {
    const lw = effectiveLineweight(e);
    const wmm = (lw === LWEIGHT_DEFAULT && !(typeof e.lw === 'number') && !(layers[e.layer] && typeof layers[e.layer].lw === 'number')) ? 0.2 : Math.max(0.05, lw / 100);
    const name = effectiveLinetype(e);
    const k = (e.ltScale > 0 ? e.ltScale : 1);
    const dash = name ? ltypeDashArray(ltypePattern(name), getDrawingLtscale() * k * mmPerUnit * ptPerMm, 0.3 * ptPerMm, 0.5 * ptPerMm) : null;
    return { wmm, dash };
}

// ===== 取り込み =====
// ファイルの線種表を、図面の線種表に入れる。list: [{ name, d（模様）, desc }]
function registerFileLinetypes(list) {
    (list || []).forEach(t => {
        const K = _ltKey(t && t.name);
        if(!K || K === 'BYLAYER' || K === 'BYBLOCK' || K === 'CONTINUOUS') return;
        drawingLineTypes[K] = { name: String(t.name).trim(), d: (t.d || []).map(Number).filter(v => isFinite(v)), desc: t.desc || '' };
    });
}
// 線種の尺度（LTSCALE）: 新しく開いたとき・置き換えたときだけ、ファイルの値にする（今の図面に追加したときは変えない）
function applyFileLtscale(v) {
    const n = Number(v);
    if(n > 0 && (typeof _importMode === 'undefined' || _importMode !== 'append')) drawingLtscale = n;
}
// 線の太さ: DXF（370）は 1/100 mm（-1 画層に従う・-2 ブロックに従う・-3 既定）。DWG は番号（0〜23 は表の値、29 画層・30 ブロック・31 既定）
function dxfLineweight(v) { const n = Number(v); if(n === -2) return 'BYBLOCK'; return (isFinite(n) && n >= 0) ? n : null; }
function dwgLineweight(v) { const n = Number(v); if(n === 30) return 'BYBLOCK'; return (n >= 0 && n < LWEIGHT_STD.length) ? LWEIGHT_STD[n] : null; }
// 取り込んだ図形の線種・太さ・線種の尺度（アプリの図形に足す値）。blk: ブロック参照の線種・太さ（BYBLOCK のとき使う）
function importLineStyle(ltName, lw, ltScale, blk) {
    const s = {};
    const n = String(ltName || '').trim(), K = n.toUpperCase();
    if(K === 'BYBLOCK') { if(blk && blk.lt) s.lt = blk.lt; }
    else if(n && K !== 'BYLAYER') s.lt = n; // 図形に付いた CONTINUOUS も残す（破線の画層でも実線にするため）
    if(lw === 'BYBLOCK') { if(blk && typeof blk.lw === 'number') s.lw = blk.lw; }
    else if(typeof lw === 'number' && lw >= 0) s.lw = lw;
    const k = Number(ltScale);
    if(k > 0 && Math.abs(k - 1) > 1e-9) s.ltScale = k;
    return s;
}
// ブロック参照（INSERT）の線種・太さ（中の BYBLOCK の図形に渡す）。画層に従うときは、その画層の線種・太さ
function insertLineStyle(own, layerIdx, parent) {
    const L = layers[layerIdx] || {};
    return { lt: own.lt || L.lt || (parent && parent.lt) || undefined, lw: (typeof own.lw === 'number') ? own.lw : (typeof L.lw === 'number' ? L.lw : (parent && parent.lw)) };
}
// DXF の画層表の線種（6）と線の太さ（370）。dxf-parser の画層表は持たないので、DXF の文字から読む
function dxfLayerStylesFromText(text) {
    const out = {};
    const lines = String(text || '').split(/\r\n|\r|\n/);
    let inTables = false, cur = null;
    for(let i = 0; i + 1 < lines.length; i += 2) {
        const c = lines[i].trim(), v = lines[i + 1].trim();
        if(c === '0') {
            if(cur && cur.name !== undefined) out[cur.name] = cur;
            cur = null;
            if(v === 'SECTION') { inTables = (lines[i + 3] || '').trim() === 'TABLES'; continue; }
            if(v === 'ENDSEC') { if(inTables) break; continue; }
            if(inTables && v === 'LAYER') cur = {};
            continue;
        }
        if(!cur) continue;
        if(c === '2' && cur.name === undefined) cur.name = lines[i + 1].replace(/^\s+|\s+$/g, '');
        else if(c === '6') cur.lt = v;
        else if(c === '370') cur.lw = Number(v);
    }
    return out;
}
// DWG の画層の線種: 読込エンジン（libredwg-web）の画層表は線種を空にしているので、画層（種類 51）の ltype の参照から名前を引く
function readDwgLayerLinetypes(lib, dwg) {
    const out = {};
    try {
        const n = lib.dwg_get_num_objects(dwg);
        for(let i = 0; i < n; i++) {
            const obj = lib.dwg_get_object(dwg, i);
            if(!obj || lib.dwg_object_get_fixedtype(obj) !== 51) continue; // DWG_TYPE_LAYER
            const tio = lib.dwg_object_to_object_tio(obj);
            const name = lib.dwg_dynapi_entity_value(tio, 'name').data;
            const ref = lib.dwg_dynapi_entity_value(tio, 'ltype').data;
            if(name && ref) { const lt = lib.dwg_ref_get_object_name(ref); if(lt) out[name] = lt; }
        }
    } catch(e) { console.warn('画層の線種を読めませんでした:', e); }
    return out;
}

// ===== DXF の書き出し =====
// 使っている線種を、書き出す線種表に足す（d: dxf-writer の Drawing）。実線・画層に従うは足さない
function exportLinetypes(d) {
    const used = new Set();
    layers.forEach(l => { if(l && l.lt) used.add(String(l.lt)); });
    entities.forEach(e => { if(e && e.lt) used.add(String(e.lt)); });
    used.forEach(n => {
        const K = _ltKey(n);
        if(!K || K === 'CONTINUOUS' || K === 'BYLAYER' || K === 'BYBLOCK') return;
        const pat = ltypePattern(n);
        const own = drawingLineTypes[K];
        try { d.addLineType(n, (own && own.desc) || ltypeLabel(n), pat || []); } catch { /* 書けない名前は飛ばす */ }
    });
}

// ===== 編集（プロパティ・画層） =====
window.changeLayerLinetype = function(idx, name) {
    const L = layers[idx];
    if(!L) return;
    saveUndo();
    const K = _ltKey(name);
    if(!K || K === 'CONTINUOUS') delete L.lt; else L.lt = String(name);
    addCommandLog(`-> 画層「${L.name}」の線種: ${K && K !== 'CONTINUOUS' ? ltypeLabel(name) : '実線'}`);
    if(typeof window.updateLayerManagerContent === 'function') window.updateLayerManagerContent();
    render();
};
window.changeLayerLineweight = function(idx, v) {
    const L = layers[idx];
    if(!L) return;
    saveUndo();
    const n = Number(v);
    if(v === '' || v === null || !(n >= 0)) delete L.lw; else L.lw = n;
    addCommandLog(`-> 画層「${L.name}」の線の太さ: ${typeof L.lw === 'number' ? (L.lw / 100).toFixed(2) + 'mm' : '既定'}`);
    render();
};
window.setShowLineweights = function(v) {
    showLineweights = !!v;
    try { localStorage.setItem('cad_show_lineweights', v ? '1' : '0'); } catch { /* 保存できなくても続行 */ }
    addCommandLog(`-> 線の太さの表示: ${v ? 'ON' : 'OFF'}`);
    render();
};
window.setDrawingLtscale = function(v) {
    const n = parseFloat(typeof cogoHalfWidth === 'function' ? cogoHalfWidth(v) : v);
    if(!(n > 0)) { if(typeof showToast === 'function') showToast('線種の尺度は 0 より大きい数にしてください', 2500); return false; }
    drawingLtscale = n;
    addCommandLog(`-> 線種の尺度（LTSCALE）: ${n}`);
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    render();
    return true;
};
// 線種の選択肢（<option>）。sel: 選んでいる名前。byLayer: 「画層に従う」を先頭に入れる
function ltypeOptionsHtml(sel, byLayer) {
    const K = _ltKey(sel);
    const opts = byLayer ? [`<option value=""${!K || K === 'BYLAYER' ? ' selected' : ''}>画層に従う</option>`] : [];
    ltypeNames().forEach(n => opts.push(`<option value="${escapeHtml(n)}"${_ltKey(n) === K || (!byLayer && !K && n === 'CONTINUOUS') ? ' selected' : ''}>${escapeHtml(ltypeLabel(n))}</option>`));
    return opts.join('');
}
// 線の太さの選択肢
function lweightOptionsHtml(sel, byLayer) {
    const has = typeof sel === 'number' && sel >= 0;
    const opts = [`<option value=""${!has ? ' selected' : ''}>${byLayer ? '画層に従う' : '既定（0.25）'}</option>`];
    LWEIGHT_STD.forEach(w => opts.push(`<option value="${w}"${has && sel === w ? ' selected' : ''}>${(w / 100).toFixed(2)} mm</option>`));
    return opts.join('');
}

// ===== コマンド: LTSCALE（線種の尺度）・LWDISPLAY（線の太さの表示） =====
function processLtypeCommand(cmd) {
    if(cmd === 'LTSCALE' || cmd === 'LTS') {
        if(typeof cadPrompt !== 'function') return true;
        cadPrompt({ title: '線種の尺度（LTSCALE）', message: '破線・一点鎖線などの模様の長さの倍率です（AutoCAD の LTSCALE と同じ）。', value: String(getDrawingLtscale()),
            validate: (v) => { const n = parseFloat(typeof cogoHalfWidth === 'function' ? cogoHalfWidth(v) : v); return n > 0 ? '' : '0 より大きい数を入れてください'; } })
            .then(v => { if(v !== null && v !== undefined) window.setDrawingLtscale(v); });
        return true;
    }
    if(cmd === 'LWDISPLAY' || cmd === 'LWD') { window.setShowLineweights(!showLineweights); return true; }
    return false;
}
