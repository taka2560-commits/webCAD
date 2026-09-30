'use strict';
// 値の監査（tests/values-audit-*.test.cjs）の共通の道具。
//
// 考え方: 現場の「本当の値」をメートルで決め、図面の単位（1m か 1mm）・表示の単位・桁・UCS・画面の回転を
//   すべて組み合わせて、画面・DXF 出力・コマンドの記録・プロパティ欄・座標一覧に出る文字を集め、
//   期待の文字と1つずつ照らす。期待値の式は、このファイルの中だけで完結させる（アプリの dimFormat などは呼ばない）。

const PER_M = { m: 1, mm: 1000 };                       // 1m が何単位か
const R = (deg) => deg * Math.PI / 180;
const pad2 = (n) => String(n).padStart(2, '0');

// ===== 期待値の式（独立） =====
// 「自動」の桁: m は小数3桁まで（末尾の0は省く）、mm は整数（どちらも 1mm まで）
function autoNum(x, unit) { return unit === 'mm' ? String(Math.floor(x + 0.5)) : String(Number(x.toFixed(3))); }
// 寸法の文字: vM は m。unit は表示の単位、dec は寸法の桁（'auto' か '0'〜'3'）
function lenText(vM, unit, dec) { const x = vM * PER_M[unit]; return dec === 'auto' ? autoNum(x, unit) : x.toFixed(Number(dec)); }
// 基点測定の文字: m は小数3桁（0を省かない）、mm は整数
function measText(vM, unit, dec) { const x = vM * PER_M[unit]; return dec === 'auto' ? (unit === 'mm' ? String(Math.floor(x + 0.5)) : x.toFixed(3)) : x.toFixed(Number(dec)); }
// 度 → 度分秒（秒は整数）
function dms(deg) { const u = Math.floor(deg * 3600 + 0.5); return `${Math.floor(u / 3600)}°${pad2(Math.floor(u % 3600 / 60))}′${pad2(u % 60)}″`; }
// 図面の点（m・東 E・北 N）を UCS（原点 oE・oN、x 軸の向き th ラジアン）で見た（東 e, 北 n）
function inUcs(E, N, u) { const dx = E - u.oE, dy = N - u.oN; return { e: dx * Math.cos(u.th) + dy * Math.sin(u.th), n: -dx * Math.sin(u.th) + dy * Math.cos(u.th) }; }
// 画面の位置 → 図面の座標（画面の回転を戻す）→ UCS。戻りは m・UCS の（東 e, 北 n）
function screenToUcsM(sx, sy, view, du, u) {
    const f = PER_M[du];
    const dx = (sx - view.x) / view.scale, dy = -(sy - view.y) / view.scale;
    const wx = dx * Math.cos(view.rotation) + dy * Math.sin(view.rotation);
    const wy = -dx * Math.sin(view.rotation) + dy * Math.cos(view.rotation);
    return inUcs(wx / f, wy / f, u);
}
// 座標の桁: 'std' はステータスバー・全画面が整数、ルーペは m なら小数2桁・mm なら整数
function coordDigits(cd, where, unit) { return cd === 'std' ? (where === 'loupe' && unit === 'm' ? 2 : 0) : Number(cd); }

// ===== UCS（原点は m・東 oE・北 oN、角度は度） =====
const UCS_CASES = [
    { name: 'WCS', oE: 0, oN: 0, deg: 0 },
    { name: 'UCS 移動', oE: 1000.5, oN: 2000.25, deg: 0 },
    { name: 'UCS 移動＋30°', oE: 12.5, oN: -7.25, deg: 30 },
];

// ===== 見本の寸法（値は m で決める。図面の単位に直して図形にする） =====
const DIMS = [
    { id: '平行・横', kind: 'len', v: 12.3456, e: (f) => ({ type: 'DIMENSION', subType: 'LINEAR', dimDir: 'H', layer: 0, color: null, p1: { x: 1.5 * f, y: 2.25 * f }, p2: { x: (1.5 + 12.3456) * f, y: 2.25 * f }, offset: -1 * f }) },
    { id: '平行・縦', kind: 'len', v: 7.8912, e: (f) => ({ type: 'DIMENSION', subType: 'LINEAR', dimDir: 'V', layer: 0, color: null, p1: { x: 3 * f, y: 1 * f }, p2: { x: 3 * f, y: (1 + 7.8912) * f }, offset: 1 * f }) },
    { id: '整列', kind: 'len', v: Math.hypot(3.3333, 4.4444), e: (f) => ({ type: 'DIMENSION', subType: 'ALIGNED', layer: 0, color: null, p1: { x: 0.5 * f, y: 0.5 * f }, p2: { x: (0.5 + 3.3333) * f, y: (0.5 + 4.4444) * f }, offset: 1 * f }) },
    { id: '半径', kind: 'len', prefix: 'R', v: 2.4567, e: (f) => ({ type: 'DIMENSION', subType: 'RADIUS', layer: 0, color: null, center: { x: 10 * f, y: 10 * f }, radius: 2.4567 * f, angle: 0.5 }) },
    { id: '直径', kind: 'len', prefix: '⌀', v: 2 * 1.2345, e: (f) => ({ type: 'DIMENSION', subType: 'DIAMETER', layer: 0, color: null, center: { x: 10 * f, y: 10 * f }, radius: 1.2345 * f, angle: 1 }) },
    { id: '角度', kind: 'angle', deg: 45.5, e: (f) => ({ type: 'DIMENSION', subType: 'ANGULAR', layer: 0, color: null, vertex: { x: 0, y: 0 }, arm1: { x: 5 * f * Math.cos(R(10)), y: 5 * f * Math.sin(R(10)) }, arm2: { x: 5 * f * Math.cos(R(55.5)), y: 5 * f * Math.sin(R(55.5)) }, arcRadius: 2 * f }) },
    { id: '座標寸法（mm の図面の値）', kind: 'coord', E: 29.510405, N: 0.002258, e: (f) => ({ type: 'DIMENSION', subType: 'ORDINATE', layer: 0, color: null, point: { x: 29.510405 * f, y: 0.002258 * f }, leaderCoord: { x: 30.5 * f, y: 3.5 * f } }) },
    { id: '座標寸法（公共座標）', kind: 'coord', E: 100123.4567, N: 45678.9012, e: (f) => ({ type: 'DIMENSION', subType: 'ORDINATE', layer: 0, color: null, point: { x: 100123.4567 * f, y: 45678.9012 * f }, leaderCoord: { x: 100130 * f, y: 45690 * f } }) },
    { id: '座標寸法（旧形式・X）', kind: 'coordOld', isX: true, E: 12.3456, N: 7.8912, e: (f) => ({ type: 'DIMENSION', subType: 'ORDINATE', layer: 0, color: null, point: { x: 12.3456 * f, y: 7.8912 * f }, leader: { x: 20 * f, y: 12 * f }, isX: true }) },
    { id: '座標寸法（旧形式・Y）', kind: 'coordOld', isX: false, E: 12.3456, N: 7.8912, e: (f) => ({ type: 'DIMENSION', subType: 'ORDINATE', layer: 0, color: null, point: { x: 12.3456 * f, y: 7.8912 * f }, leader: { x: 20 * f, y: 12 * f }, isX: false }) },
];

// この組み合わせ c（du 図面の単位・lu 長さ・cu 座標・dd 桁・af 角度・ucs）で、寸法 d が画面・DXF に出す文字（順に）。
// 表示の単位が「図面どおり」（auto）なら図面の単位
function expectedTexts(d, c) {
    const lu = c.lu === 'auto' ? c.du : c.lu, cu = c.cu === 'auto' ? c.du : c.cu;
    if (d.kind === 'len') return [(d.prefix || '') + lenText(d.v, lu, c.dd)];
    if (d.kind === 'angle') return [c.af === 'dms' ? dms(d.deg) : d.deg.toFixed(1) + '°'];
    const u = inUcs(d.E, d.N, { oE: c.ucs.oE, oN: c.ucs.oN, th: R(c.ucs.deg) });
    const fmt = (vM) => lenText(vM, cu, c.dd);
    if (d.kind === 'coord') return ['X: ' + fmt(u.n), 'Y: ' + fmt(u.e)];
    return [d.isX ? 'Y=' + fmt(u.e) : 'X=' + fmt(u.n)];
}

// ===== アプリの状態をそろえる・画面の文字を集める =====
// c: { du: 図面の単位 'm' | 'mm', prefs: 表示・操作の設定（{ lenUnit, coordUnit, dimDecimals, ... }）, ucs: UCS_CASES の1つ, rot: 画面の回転 }
function configure(app, c) {
    const f = PER_M[c.du];
    const u = c.ucs || UCS_CASES[0];
    app.eval(`localStorage.setItem('cad_survey_unit', '${c.du}');
        _displayPrefs = ${JSON.stringify(c.prefs || {})}; applyDisplayPrefs();
        ucs = { originX: ${u.oE * f}, originY: ${u.oN * f}, angle: ${R(u.deg)} };
        resetCommand(); hidePropertyPanel(); entities.length = 0; snapResult = null; orthoMode = false; touchState.showLoupe = false;
        view = { x: 400, y: 300, scale: ${c.du === 'mm' ? 0.01 : 10}, rotation: ${c.rot || 0} };`);
}
const AXIS_TEXTS = ['X', 'Y', 'WCS', 'UCS'];
// 画面に描いた文字を集める（座標軸の文字は除く）
function drawnTexts(app, overlayOnly) {
    app.eval('window.__t = []; ctx.fillText = (t) => window.__t.push(String(t));');
    try { app.eval('_drawFrame(' + (overlayOnly ? 'true' : 'false') + ')'); } finally { app.eval('delete ctx.fillText'); }
    return app.val('window.__t').filter((t) => !AXIS_TEXTS.includes(t));
}
// 最後のコマンドの記録（「->」のあと）
const lastLog = (app) => app.eval(`(() => { const l = document.getElementById('command-log').textContent.trim(); return l.split('->').pop().trim(); })()`);
// 記録の全行（「->」で区切る）
const allLogs = (app) => app.eval(`document.getElementById('command-log').textContent`).split('->').map((t) => t.trim()).filter(Boolean);
// 1つの寸法図形を描いて、画面の文字と DXF 出力用の文字を返す道具をアプリの中に入れる
function installAuditDim(app) {
    app.eval(`window.__auditDim = function(def) {
        entities.length = 0; entities.push(JSON.parse(JSON.stringify(def))); _bumpGeomEpoch();
        window.__t = []; ctx.fillText = (t) => window.__t.push(String(t));
        try { _drawFrame(false); } finally { delete ctx.fillText; }
        return { screen: window.__t.filter((s) => !['X', 'Y', 'WCS', 'UCS'].includes(s)), dxf: dimExportPrims(entities[0], 1).texts.map((x) => x.s) };
    }`);
}

// ===== 見本の図形（プロパティ欄）: 欄の見出し → 期待の値。u(E, N) は UCS で見た（東 e, 北 n）、{ len } は長さ、{ raw } はそのままの文字 =====
const PROP_ENTS = [
    { id: '線', e: (f) => ({ type: 'LINE', layer: 0, color: null, x1: 1.25 * f, y1: 2.5 * f, x2: 11.3456 * f, y2: 8.7654 * f }),
        fields: (u) => { const a = u(1.25, 2.5), z = u(11.3456, 8.7654); return { '始点 X': a.n, '始点 Y': a.e, '終点 X': z.n, '終点 Y': z.e }; } },
    { id: '円', e: (f) => ({ type: 'CIRCLE', layer: 0, color: null, cx: 10.123 * f, cy: 20.456 * f, radius: 2.4567 * f }),
        fields: (u) => { const c = u(10.123, 20.456); return { '中心 X': c.n, '中心 Y': c.e, '半径': { len: 2.4567 } }; } },
    { id: '長方形', e: (f) => ({ type: 'RECTANG', layer: 0, color: null, x1: 2.2222 * f, y1: 3.3333 * f, x2: 7.7777 * f, y2: 9.9999 * f }),
        fields: (u) => { const a = u(2.2222, 3.3333), z = u(7.7777, 9.9999); return { '角1 X': a.n, '角1 Y': a.e, '角2 X': z.n, '角2 Y': z.e }; } },
    { id: '楕円', e: (f) => ({ type: 'ELLIPSE', layer: 0, color: null, cx: 5.5557 * f, cy: 6.6666 * f, rx: 3.3333 * f, ry: 1.6667 * f, rotation: 0 }),
        fields: (u) => { const c = u(5.5557, 6.6666); return { '中心 X': c.n, '中心 Y': c.e, 'X半径': { len: 3.3333 }, 'Y半径': { len: 1.6667 } }; } },
    { id: '文字', e: (f) => ({ type: 'TEXT', layer: 0, color: null, x: 4.4444 * f, y: 5.5555 * f, text: 'あ', height: 0.3 * f }),
        fields: (u) => { const p = u(4.4444, 5.5555); return { '始点 X': p.n, '始点 Y': p.e, '高さ': { len: 0.3 } }; } },
    { id: '測点', e: (f) => ({ type: 'POINT', layer: 0, color: null, x: 29.510405 * f, y: 0.002258 * f, name: 'A2-8', z: 12.345 }),
        fields: (u) => { const p = u(29.510405, 0.002258); return { 'X': p.n, 'Y': p.e, '標高': { raw: '12.345' } }; } },
];

module.exports = { PER_M, R, pad2, autoNum, lenText, measText, dms, inUcs, screenToUcsM, coordDigits, UCS_CASES, DIMS, expectedTexts,
    configure, drawnTexts, lastLog, allLogs, installAuditDim, PROP_ENTS, AXIS_TEXTS };
