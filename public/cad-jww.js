// ===== Web CAD JWW（Jw_cad の図面）の取り込み =====
// cad-jww.js - Jw_cad の図面ファイル（.jww）を直接開く。形式は Jw_cad の作者が公開している説明（jwdatafmt.txt。Ver.7.02 の形式）と、
//   MFC の CArchive の決まり（新しいクラスは 0xFFFF・スキーマ・名前、2回目からは 0x8000|番号。文字列は長さ＋中身）に従って読む。
//   ・版ごとの違い（2.23・2.25・2.30・3.00・3.51・4.20・7.00）に合わせて読む。ヘッダーの読み取りがずれたときは、最初の図形のクラスの印を探して続ける
//   ・図形: 線・円／円弧（楕円は楕円、楕円弧は折れ線）・点・文字・寸法（線と文字を1つのまとまりに）・ソリッド（塗りつぶし。初めは非表示）・
//     ブロック（定義を置いて広げる）。画像（^@BM の文字）は取り込まない
//   ・長さは mm（Jw_cad の座標は実寸の mm）。文字の大きさは図寸（用紙の mm）× 画層グループの縮尺
//   ・画層は 16 グループ × 16 画層。名前が無ければ「0-2」のように Jw_cad の番号。非表示のグループ・画層は隠す
//   ・色: 線色 1〜9 は Jw_cad の初めの色に近い色（黒は白で描く）、SXF の色（101〜）は図面の色の表か SXF の既定義色。ソリッドの任意色は RGB
//   ・線種: 線種番号（2〜9・倍長）と SXF の線種（31〜）を、アプリの線種（破線・一点鎖線など）に置き換える

// 線色 1〜9（1 水色・2 黒・3 緑・4 黄・5 ピンク・6 青・7 白・8 赤・9 補助線）
const JWW_PEN_COLORS = [null, '#00ffff', '#ffffff', '#00ff00', '#ffff00', '#ff00ff', '#3c64ff', '#ffffff', '#ff0000', '#808080'];
// SXF の既定義色 1〜16（黒は白で描く）
const JWW_SXF_COLORS = [null, '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff',
    '#c00080', '#c08040', '#ff8000', '#80c080', '#0080ff', '#8040ff', '#c0c0c0', '#808080'];
// 線種番号 → アプリの線種（1 は実線、11〜15 のランダム線も実線）
const JWW_PEN_STYLES = { 2: 'HIDDEN', 3: 'DASHED', 4: 'DASHEDX2', 5: 'CENTER', 6: 'CENTERX2', 7: 'PHANTOM', 8: 'PHANTOMX2', 9: 'DOT',
    16: 'CENTERX2', 17: 'CENTERX2', 18: 'PHANTOMX2', 19: 'PHANTOMX2' };
// SXF の既定義線種（31〜45 ＝ 1〜15）
const JWW_SXF_STYLES = { 2: 'DASHED', 3: 'DASHEDX2', 4: 'CENTER', 5: 'PHANTOM', 6: 'PHANTOMX2', 7: 'DOT', 8: 'DASHDOT', 9: 'DIVIDE',
    10: 'DASHDOT', 11: 'DASHDOT', 12: 'DIVIDE', 13: 'DIVIDE', 14: 'DIVIDE', 15: 'DIVIDE' };
const JWW_MAX_BLOCK_DEPTH = 8;

// ===== 読み取り =====
function _jwwReader(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const sjis = new TextDecoder('shift-jis'), utf16 = new TextDecoder('utf-16le');
    const r = {
        p: 0, u8,
        need(n) { if(r.p + n > u8.length) throw new Error('ファイルが途中で切れています'); },
        byte() { r.need(1); return u8[r.p++]; },
        word() { r.need(2); const v = dv.getUint16(r.p, true); r.p += 2; return v; },
        dword() { r.need(4); const v = dv.getUint32(r.p, true); r.p += 4; return v; },
        int() { r.need(4); const v = dv.getInt32(r.p, true); r.p += 4; return v; },
        dbl() { r.need(8); const v = dv.getFloat64(r.p, true); r.p += 8; return v; },
        skip(n) { r.need(n); r.p += n; },
        // CString: 長さ（1バイト。0xFF なら WORD、さらに 0xFFFF なら DWORD）と中身（Shift-JIS）。0xFF・0xFFFE は UTF-16（Jw_cad 8 の Unicode 版）
        str() {
            let n = r.byte(), wide = false;
            if(n === 0xFF) {
                n = r.word();
                if(n === 0xFFFE) { wide = true; n = r.byte(); if(n === 0xFF) { n = r.word(); if(n === 0xFFFF) n = r.dword(); } }
                else if(n === 0xFFFF) n = r.dword();
            }
            const len = wide ? n * 2 : n;
            r.need(len);
            const b = u8.subarray(r.p, r.p + len);
            r.p += len;
            return (wide ? utf16 : sjis).decode(b);
        },
    };
    return r;
}
// 最初の図形のクラスの印（0xFFFF・スキーマ・名前の長さ・"CData"）を探す。見つかれば、その前の個数の位置
function _jwwFindList(u8, from) {
    for(let i = Math.max(2, from); i + 11 < u8.length; i++) {
        if(u8[i] === 0xFF && u8[i + 1] === 0xFF && u8[i + 5] === 0 && u8[i + 4] >= 5 && u8[i + 4] <= 40 &&
            u8[i + 6] === 0x43 && u8[i + 7] === 0x44 && u8[i + 8] === 0x61 && u8[i + 9] === 0x74 && u8[i + 10] === 0x61) { // "CData"
            // 個数は WORD。65535 以上は 0xFFFF と DWORD（そのときは、DWORD の値が 65535 以上）
            const big = i >= 6 && u8[i - 6] === 0xFF && u8[i - 5] === 0xFF && ((u8[i - 4] | (u8[i - 3] << 8) | (u8[i - 2] << 16) | (u8[i - 1] << 24)) >>> 0) >= 0xFFFF;
            return big ? i - 6 : i - 2;
        }
    }
    return -1;
}
// JWW のバイト列 → { ver, groups（16。name・state・scale・layers（16。name・state）), sxfColors, senHaba100, data, blocks, warnings }
function parseJwwBuffer(buf) {
    const r = _jwwReader(buf);
    const sig = String.fromCharCode(...r.u8.subarray(0, 8));
    if(sig !== 'JwwData.') throw new Error('JWW（Jw_cad の図面）ではありません');
    r.p = 8;
    const ver = r.dword(), warnings = [];
    r.str(); // ファイルメモ
    r.dword(); // 図面サイズ
    r.dword(); // 書込レイヤグループ
    const groups = [];
    for(let g = 0; g < 16; g++) {
        const G = { state: r.dword(), writeLay: r.dword(), scale: r.dbl(), protect: r.dword(), layers: [] };
        for(let l = 0; l < 16; l++) G.layers.push({ state: r.dword(), protect: r.dword() });
        groups.push(G);
    }
    r.skip(14 * 4 + 5 * 4 + 4); // ダミー・寸法の設定・ダミー
    const nWid = r.int(); // 線描画の最大幅（-101 以下は線幅を 1/100 mm で持つ）
    r.skip(8 * 3 + 4 + 4 + 8 * 5); // プリンタの原点・倍率・回転、目盛
    for(let g = 0; g < 16; g++) for(let l = 0; l < 16; l++) groups[g].layers[l].name = r.str();
    for(let g = 0; g < 16; g++) groups[g].name = r.str();
    // ここから先は版で並びが変わる。ずれたら、最初の図形の印を探して続ける
    const afterNames = r.p;
    let sxfColors = null;
    try {
        r.skip(8 + 8 + 4 + 8); // 日影
        if(ver >= 300) r.skip(16); // 天空図
        r.skip(4 + 24 + 24); // 2.5D の単位・画面倍率・範囲記憶
        r.skip(ver >= 300 ? 8 * 28 : 4 * 24); // マークジャンプ
        if(ver >= 300) r.skip(8 * 6 + 4 * 2); // 文字の描画状態
        r.skip(8 * 10 + 8 + 8 * 10 + 16 * 10); // 複線間隔・留線出・画面の色と幅・プリンタの色・幅・点の半径
        r.skip(16 * 8 + 20 * 5 + 16 * 4 + 4 * 11); // 線種・ランダム線・倍長線種・実点〜表示のみレイヤ
        if(ver >= 223) r.skip(4 * 5 + 8 * 5);
        if(ver >= 225) r.skip(8 * 4);
        if(ver >= 230) r.skip(8);
        if(ver >= 420) {
            sxfColors = [];
            for(let n = 0; n <= 256; n++) { sxfColors.push(r.dword()); r.dword(); }
            for(let n = 0; n <= 256; n++) { r.str(); r.skip(16); }
            r.skip(33 * 16);
            for(let n = 0; n <= 32; n++) { r.str(); r.skip(4 + 80); }
        }
        r.skip(10 * 28 + 8 * 3 + 8 + 8 * 2 + 4 + 8 * 6); // 文字種・書込み文字・文字位置整理・基準点のずれ
        if(!_jwwListStartsAt(r.u8, r.p)) throw new Error('ヘッダーの長さが合わない');
    } catch(e) {
        const at = _jwwFindList(r.u8, afterNames);
        if(at < 0) throw new Error('図形のデータが見つかりません（' + e.message + '）', { cause: e });
        warnings.push('ヘッダーの一部を読み飛ばしました（色の表などは使いません）');
        sxfColors = null;
        r.p = at;
    }
    const st = { ver, classes: [null], map: 1, r };
    const data = _jwwReadList(st);
    let blocks = [];
    try { blocks = _jwwReadList(st); } catch(e) { warnings.push('ブロックの定義を読めませんでした: ' + e.message); }
    return { ver, groups, sxfColors, senHaba100: nWid <= -101, data, blocks, warnings };
}
// 図形のリストが pos から始まっているか（個数と、最初の図形のクラスの印）
function _jwwListStartsAt(u8, pos) {
    if(pos + 2 > u8.length) return false;
    let n = u8[pos] | (u8[pos + 1] << 8), q = pos + 2;
    if(n === 0xFFFF) { if(q + 4 > u8.length) return false; n = (u8[q] | (u8[q + 1] << 8) | (u8[q + 2] << 16) | (u8[q + 3] << 24)) >>> 0; q += 4; }
    if(n === 0) return q + 2 <= u8.length; // 空の図面（続けてブロックの個数）
    return u8[q] === 0xFF && u8[q + 1] === 0xFF && u8[q + 6] === 0x43 && u8[q + 7] === 0x44; // "CD"
}
// CTypedPtrList のリスト（個数と、CArchive の WriteObject の並び）
function _jwwReadList(st) {
    const r = st.r;
    let n = r.word();
    if(n === 0xFFFF) n = r.dword();
    const out = [];
    for(let i = 0; i < n; i++) {
        const tag = r.word();
        let cls, ci = -1;
        if(tag === 0) continue; // NULL
        if(tag === 0xFFFF) {
            r.word(); // スキーマ
            const len = r.word();
            r.need(len);
            cls = String.fromCharCode(...r.u8.subarray(r.p, r.p + len));
            r.p += len;
            st.classes[st.map++] = cls;
        } else if(tag === 0x7FFF) { // 大きな番号（0x7FFF と、0x80000000|番号 の DWORD）
            const dw = r.dword();
            if(!(dw & 0x80000000)) throw new Error('同じ図形への参照は読めません');
            ci = dw & 0x7FFFFFFF;
        } else if(tag & 0x8000) ci = tag & 0x7FFF;
        else throw new Error(`図形の印ではありません（${tag}）`);
        if(ci >= 0) { cls = st.classes[ci]; if(!cls) throw new Error(`クラスの番号 ${ci} がありません`); }
        st.map++; // 図形の番号
        out.push(_jwwReadBody(st, cls));
    }
    return out;
}
function _jwwData(st, o) {
    const r = st.r;
    o.group = r.dword(); o.style = r.byte(); o.color = r.word();
    o.width = st.ver >= 351 ? r.word() : 0;
    o.layer = r.word(); o.gLayer = r.word(); o.flg = r.word();
    return o;
}
function _jwwSen(st, o) { const r = st.r; _jwwData(st, o); o.x1 = r.dbl(); o.y1 = r.dbl(); o.x2 = r.dbl(); o.y2 = r.dbl(); return o; }
function _jwwTen(st, o) {
    const r = st.r; _jwwData(st, o);
    o.x = r.dbl(); o.y = r.dbl(); o.kari = r.dword();
    if(o.style === 100) { o.code = r.dword(); o.ang = r.dbl(); o.scale = r.dbl(); }
    return o;
}
function _jwwMoji(st, o) {
    const r = st.r; _jwwData(st, o);
    o.x1 = r.dbl(); o.y1 = r.dbl(); o.x2 = r.dbl(); o.y2 = r.dbl();
    o.shu = r.dword(); o.sx = r.dbl(); o.sy = r.dbl(); o.kankaku = r.dbl(); o.deg = r.dbl();
    o.font = r.str(); o.text = r.str();
    return o;
}
function _jwwReadBody(st, cls) {
    const r = st.r, o = { cls };
    switch(cls) {
        case 'CDataSen': return _jwwSen(st, o);
        case 'CDataEnko':
            _jwwData(st, o);
            o.cx = r.dbl(); o.cy = r.dbl(); o.r = r.dbl(); o.start = r.dbl(); o.arc = r.dbl(); o.tilt = r.dbl(); o.flat = r.dbl(); o.full = r.dword();
            return o;
        case 'CDataTen': return _jwwTen(st, o);
        case 'CDataMoji': return _jwwMoji(st, o);
        case 'CDataSunpou':
            _jwwData(st, o);
            o.sen = _jwwSen(st, {}); o.moji = _jwwMoji(st, {});
            if(st.ver >= 420) {
                o.sxf = r.word(); o.ho1 = _jwwSen(st, {}); o.ho2 = _jwwSen(st, {});
                o.t1 = _jwwTen(st, {}); o.t2 = _jwwTen(st, {}); o.th1 = _jwwTen(st, {}); o.th2 = _jwwTen(st, {});
            }
            return o;
        case 'CDataSolid':
            _jwwData(st, o);
            o.p1 = [r.dbl(), r.dbl()]; o.p4 = [r.dbl(), r.dbl()]; o.p2 = [r.dbl(), r.dbl()]; o.p3 = [r.dbl(), r.dbl()];
            if(o.color === 10) o.rgb = r.dword();
            return o;
        case 'CDataBlock':
            _jwwData(st, o);
            o.x = r.dbl(); o.y = r.dbl(); o.sx = r.dbl(); o.sy = r.dbl(); o.rot = r.dbl(); o.num = r.dword();
            return o;
        case 'CDataList':
            _jwwData(st, o);
            o.num = r.dword(); o.ref = r.dword();
            r.skip(_jwwTimeSize(st)); // 作成時刻（CTime。4 バイトか 8 バイト）
            o.name = r.str().split('@@SfigorgFlag@@')[0];
            o.list = _jwwReadList(st);
            return o;
        default: throw new Error(`知らない図形の種類です（${cls}）`);
    }
}
// ブロックの定義の作成時刻（CTime）の長さ: 4 バイト（32ビットの時刻）か 8 バイト（64ビット）。それぞれで名前と中の図形の並びが合うかを見て、
// 両方合うとき（8 バイトの時刻の上の 4 バイトは 0 なので、4 バイトとして読むと「名前なし・図形なし」に見える）は、続く4バイトが 0 なら 8 バイト
function _jwwTimeSize(st) {
    const r = st.r, at = r.p, u8 = r.u8;
    const ok = (size) => {
        try {
            r.p = at + size;
            const name = r.str();
            if([...name].some(ch => { const c = ch.charCodeAt(0); return c < 9 || (c > 13 && c < 32); })) return false;
            return _jwwListStartsAt(u8, r.p) || _jwwListIsRef(st, r.p);
        } catch { return false; } finally { r.p = at; }
    };
    const v4 = ok(4), v8 = ok(8);
    if(v4 && v8) return (at + 8 <= u8.length && u8[at + 4] === 0 && u8[at + 5] === 0 && u8[at + 6] === 0 && u8[at + 7] === 0) ? 8 : 4;
    return v8 && !v4 ? 8 : 4;
}
// 中の図形が、2回目からのクラスの印（0x8000|番号）で始まっているか
function _jwwListIsRef(st, pos) {
    const u8 = st.r.u8;
    if(pos + 4 > u8.length) return false;
    const n = u8[pos] | (u8[pos + 1] << 8), tag = u8[pos + 2] | (u8[pos + 3] << 8);
    return n > 0 && n !== 0xFFFF && (tag & 0x8000) && tag !== 0xFFFF && !!st.classes[tag & 0x7FFF];
}

// ===== アプリの図形にする =====
function _jwwHex(rgb) { const v = rgb >>> 0; return '#' + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map(c => c.toString(16).padStart(2, '0')).join(''); } // COLORREF（0x00BBGGRR）
function _jwwColor(j, c, rgb) {
    let hex = null;
    if(c === 10 && rgb !== undefined) hex = _jwwHex(rgb);
    else if(c >= 1 && c <= 9) hex = JWW_PEN_COLORS[c];
    else if(c > 100) {
        const n = c - 100, v = j.sxfColors && j.sxfColors[n];
        hex = (typeof v === 'number' && v > 9) ? _jwwHex(v) : (typeof v === 'number' && v >= 1 && v <= 9) ? JWW_PEN_COLORS[v] : (JWW_SXF_COLORS[n] || null);
    }
    if(hex === '#000000') hex = '#ffffff'; // 黒は暗い画面で見えないので白
    return (hex && hex !== '#ffffff') ? hex : null;
}
function _jwwLt(style) { return style > 30 ? (JWW_SXF_STYLES[style - 30] || null) : (JWW_PEN_STYLES[style] || null); }
// 2つの変換をつなぐ（m ∘ n）。変換は [a, b, c, d, e, f]: (x, y) → (a·x + c·y + e, b·x + d·y + f)
function _jwwMul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function convertJwwToApp(j) {
    if(typeof _beginImport === 'function') _beginImport(4); // mm
    const result = { entities: [], warnings: j.warnings.slice(), skipStats: {}, hiddenFills: 0 };
    const hideFills = (typeof _importHideFills !== 'undefined') ? _importHideFills : true;
    const skip = (t) => { result.skipStats[t] = (result.skipStats[t] || 0) + 1; };
    const hex = (g) => g.toString(16).toUpperCase();
    // 画層（使っているものだけ作る）。いくつものグループを使っていれば、名前の前にグループの番号
    const used = new Set();
    const mark = (list) => list.forEach(o => { if(o) used.add(o.gLayer * 16 + o.layer); if(o && o.list) mark(o.list); });
    mark(j.data); j.blocks.forEach(b => mark(b.list));
    const multi = new Set([...used].map(k => k >> 4)).size > 1;
    const layIdx = new Map();
    const layerOf = (o) => {
        const g = Math.min(15, o.gLayer || 0), l = Math.min(15, o.layer || 0), key = g * 16 + l;
        if(layIdx.has(key)) return layIdx.get(key);
        const G = j.groups[g], L = G.layers[l], nm0 = (L.name || '').trim();
        const name = nm0 ? (multi ? `${hex(g)}-${hex(l)} ${nm0}` : nm0) : `${hex(g)}-${hex(l)}`;
        let idx = layers.findIndex(x => x.name === name); // 同じ名前の画層（「0」など）は、今ある画層を使う
        if(idx < 0) { layers.push({ name, color: '#ffffff', visible: !(G.state === 0 || L.state === 0) }); idx = layers.length - 1; }
        layIdx.set(key, idx);
        return idx;
    };
    const scaleOf = (o) => { const s = j.groups[Math.min(15, o.gLayer || 0)].scale; return (s > 0 && isFinite(s)) ? s : 1; };
    const base = (o) => {
        const b = { layer: layerOf(o), color: _jwwColor(j, o.color) };
        const lt = _jwwLt(o.style);
        if(lt) b.lt = lt;
        if(j.senHaba100 && o.width > 0 && o.width < 2000) b.lw = o.width;
        return b;
    };
    const defs = new Map();
    j.blocks.forEach(b => { if(!defs.has(b.num)) defs.set(b.num, b); });
    const push = (e, gid) => { if(gid) e.gid = gid; result.entities.push(e); return e; };
    // 変換 m で点を移す
    const P = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
    const isSim = (m) => Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9 * Math.max(1, Math.hypot(m[0], m[1])) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * Math.max(1, m[0] * m[0] + m[1] * m[1]);
    const det = (m) => m[0] * m[3] - m[1] * m[2];
    const ellipsePts = (o, m, a0, a1) => {
        const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI * 2) * 72)), out = [];
        const ct = Math.cos(o.tilt || 0), stl = Math.sin(o.tilt || 0), rx = o.r, ry = o.r * (o.flat || 1);
        for(let k = 0; k <= n; k++) {
            const t = a0 + (a1 - a0) * k / n, u = rx * Math.cos(t), v = ry * Math.sin(t);
            out.push(P(m, o.cx + u * ct - v * stl, o.cy + u * stl + v * ct));
        }
        return out;
    };
    const conv = (o, m, gid, depth) => {
        if(!o) return;
        const b = () => base(o);
        switch(o.cls) {
            case 'CDataSen': { const p = P(m, o.x1, o.y1), q = P(m, o.x2, o.y2); push(Object.assign(b(), { type: 'LINE', x1: p.x, y1: p.y, x2: q.x, y2: q.y }), gid); break; }
            case 'CDataEnko': {
                const flat = o.flat > 0 ? o.flat : 1, full = !!o.full || Math.abs(o.arc) >= Math.PI * 2 - 1e-12;
                if(Math.abs(flat - 1) < 1e-12 && isSim(m)) {
                    const c = P(m, o.cx, o.cy), s = Math.hypot(m[0], m[1]), rot = Math.atan2(m[1], m[0]), mir = det(m) < 0;
                    if(full) push(Object.assign(b(), { type: 'CIRCLE', cx: c.x, cy: c.y, radius: o.r * s }), gid);
                    else {
                        let a0 = o.start + (o.tilt || 0), a1 = a0 + o.arc;
                        if(o.arc < 0) { const t = a0; a0 = a1; a1 = t; }
                        if(mir) { const t0 = rot - a1, t1 = rot - a0; a0 = t0; a1 = t1; } else { a0 += rot; a1 += rot; }
                        push(Object.assign(b(), { type: 'ARC', cx: c.x, cy: c.y, radius: o.r * s, startAngle: a0, endAngle: a1 }), gid);
                    }
                } else if(full && isSim(m)) {
                    const c = P(m, o.cx, o.cy), s = Math.hypot(m[0], m[1]), rot = Math.atan2(m[1], m[0]);
                    push(Object.assign(b(), { type: 'ELLIPSE', cx: c.x, cy: c.y, rx: o.r * s, ry: o.r * flat * s, rotation: (det(m) < 0 ? -(o.tilt || 0) : (o.tilt || 0)) + rot }), gid);
                } else {
                    // 楕円弧（と、伸び縮みするブロックの中の円）は折れ線
                    const pts = full ? ellipsePts(o, m, 0, Math.PI * 2) : ellipsePts(o, m, o.start, o.start + o.arc);
                    push(Object.assign(b(), { type: 'PLINE', points: full ? pts.slice(0, -1) : pts, closed: full }), gid);
                }
                break;
            }
            case 'CDataTen': {
                const p = P(m, o.x, o.y), e = Object.assign(b(), { type: 'POINT', x: p.x, y: p.y });
                delete e.lt; delete e.lw;
                push(e, gid);
                break;
            }
            case 'CDataMoji': {
                const t = String(o.text || '');
                if(t.startsWith('^@BM')) { skip('IMAGE'); break; } // 画像の参照
                if(!t) break;
                const p = P(m, o.x1, o.y1), sy = Math.hypot(m[2], m[3]) || 1, rot = (o.deg || 0) * Math.PI / 180 + Math.atan2(m[1], m[0]);
                const e = Object.assign(b(), { type: 'TEXT', x: p.x, y: p.y, text: t, height: (o.sy > 0 ? o.sy : 2.5) * scaleOf(o) * sy, rotation: rot, halign: 'left', valign: 'bottom' });
                delete e.lt; delete e.lw;
                push(e, gid);
                break;
            }
            case 'CDataSunpou': {
                const g = gid || newGroupId('d');
                [o.sen, o.ho1, o.ho2].forEach(s => { if(s && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0) conv(Object.assign({ cls: 'CDataSen' }, s), m, g, depth); });
                if(o.moji) conv(Object.assign({ cls: 'CDataMoji' }, o.moji), m, g, depth);
                break;
            }
            case 'CDataSolid': {
                let ring, holes = null;
                if(o.style >= 101) {
                    // 円のソリッド: 中心 p1、半径 p4.x、扁平率 p4.y、傾き p2.x、開始角 p2.y、円弧角 p3.x、種類（または内側の半径）p3.y
                    const e = { cx: o.p1[0], cy: o.p1[1], r: o.p4[0], flat: o.p4[1] || 1, tilt: o.p2[0] };
                    const a0 = o.p2[1], arc = o.p3[0], kind = o.p3[1];
                    if(o.style === 111) { skip('円周ソリッド'); break; }
                    const whole = (o.style === 101 && kind === 100) || Math.abs(arc) >= Math.PI * 2 - 1e-9;
                    const outer = whole ? ellipsePts(e, m, 0, Math.PI * 2).slice(0, -1) : ellipsePts(e, m, a0, a0 + arc);
                    if(o.style === 105 || o.style === 106) {
                        const inner = Object.assign({}, e, { r: kind });
                        const ip = whole ? ellipsePts(inner, m, 0, Math.PI * 2).slice(0, -1) : ellipsePts(inner, m, a0, a0 + arc);
                        if(whole) { ring = outer; holes = [ip]; } else ring = outer.concat(ip.reverse());
                    } else if(o.style === 101 && kind === 0 && !whole) ring = [P(m, e.cx, e.cy)].concat(outer); // 扇形
                    else ring = outer; // 全円・弓形・外側円弧
                } else ring = [o.p1, o.p2, o.p3, o.p4].map(q => P(m, q[0], q[1]));
                const bs = base(o); delete bs.lt; delete bs.lw;
                bs.color = _jwwColor(j, o.color, o.rgb);
                const h = makeImportedFill(ring, bs, hideFills);
                if(!h) break;
                if(holes) h.target.holes = holes;
                if(h.hiddenBy === 'fill') result.hiddenFills++;
                push(h, gid);
                break;
            }
            case 'CDataBlock': {
                const d = defs.get(o.num);
                if(!d) { skip('INSERT:' + o.num); break; }
                if(depth >= JWW_MAX_BLOCK_DEPTH) { skip('INSERT:' + (d.name || o.num)); break; }
                const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), sx = o.sx || 1, sy = o.sy || 1;
                const mm = _jwwMul(m, [sx * c, sx * s, -sy * s, sy * c, o.x, o.y]);
                const g = gid || newGroupId('b');
                const n0 = result.entities.length;
                d.list.forEach(x => conv(x, mm, g, depth + 1));
                for(let k = n0; k < result.entities.length; k++) if(!result.entities[k].blockName) result.entities[k].blockName = d.name || ('ブロック' + o.num);
                break;
            }
            default: skip(o.cls);
        }
    };
    const I = [1, 0, 0, 1, 0, 0];
    j.data.forEach(o => conv(o, I, null, 0));
    return result;
}

// ===== 開く =====
async function loadJwwFile(file) {
    addCommandLog(`JWWファイルを読み込み中: ${file.name}...`);
    if(typeof busyStart === 'function') busyStart('JWW を読み込んでいます…');
    try {
        if(typeof busyPaint === 'function') await busyPaint();
        const j = parseJwwBuffer(await file.arrayBuffer());
        const r = convertJwwToApp(j);
        if(!r.entities.length) {
            if(typeof _restoreAfterFailedImport === 'function') _restoreAfterFailedImport();
            showToast('JWW に取り込める図形がありませんでした', { kind: 'error', ms: 5000 });
            return null;
        }
        initLayers();
        r.entities.forEach(e => entities.push(e));
        if(typeof ensureEntityIds === 'function') ensureEntityIds();
        if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
        setDrawingName(file.name);
        addCommandLog(`-> JWWファイル読み込み完了: ${file.name}（Jw_cad の形式 ${j.ver}・${r.entities.length}個の図形）`);
        r.warnings.forEach(w => addCommandLog('  注意: ' + w));
        if(Object.keys(r.skipStats).length) addCommandLog('  取り込めなかった図形: ' + importSkipText(r.skipStats, true));
        if(typeof updateLayerPanel === 'function') updateLayerPanel();
        const unitNote = (typeof applyFileUnit === 'function') ? applyFileUnit(4, 'JWW') : '';
        if(unitNote) addCommandLog('-> ' + unitNote);
        zoomExtents(); render();
        const note = importResultNote(r.skipStats, r.hiddenFills);
        showToast(`読み込み完了: ${r.entities.length}個の図形` + (unitNote ? '\n' + unitNote : '') + note,
            { kind: (r.warnings.length || Object.keys(r.skipStats).length) ? 'warn' : 'success', ms: (unitNote || note) ? 7000 : 4000 });
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
        return r;
    } catch(err) {
        addCommandLog(`エラー: JWWファイルの読み込みに失敗 - ${err.message}`);
        if(typeof reportImportFailure === 'function') reportImportFailure('JWW', file.name, err);
        return null;
    } finally { if(typeof busyEnd === 'function') busyEnd(); }
}
