// ===== Web CAD 測量計算（COGO）: 計算 =====
// cad-cogo.js - 座標求積（座標法）・辺長・逆計算（距離・方向角）・放射（方向角と距離で点を出す）・交点の計算と、
//               求積表（CSV・図面に置く表）、辺長・面積の文字、測点の追加。
//               画面（パネル・図面での点の指定・重ね表示）は cad-cogo-ui.js。
//
// 座標の約束（cad-survey.js と同じ）:
//   測量の X ＝ 北 ＝ 図面の y、測量の Y ＝ 東 ＝ 図面の x。計算は測量座標（m）で行う
//   （図面が 1単位＝1mm でも、表示・出力は m）。UCS を設定していても図面の座標（WCS）で計算する（座標一覧と同じ）。
//   方向角は北から時計回り（度）。表示は「度°分′秒″」。

const COGO_LAYER_TABLE = '求積表';
const COGO_LAYER_NOTE = '求積';     // 辺長・面積の文字

// ===== 数値・角度の表記 =====
// 小数 d 桁の文字（-0.000 にしない）
function cogoFix(v, d) {
    if(typeof v !== 'number' || !isFinite(v)) return '';
    const s = v.toFixed(d);
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}
// 0 以上 360 未満の度
function cogoNormDeg(d) { d %= 360; return d < 0 ? d + 360 : d; }
// 度 → 「123°45′06″」。secDigits は秒の小数桁（既定 0）
function cogoFmtDms(deg, secDigits) {
    const sd = secDigits || 0, k = Math.pow(10, sd);
    let u = Math.round(cogoNormDeg(deg) * 3600 * k); // 秒×k の整数で数える（59.99…″ → 60″ の繰り上がりを間違えない）
    if(u >= 360 * 3600 * k) u -= 360 * 3600 * k;
    const D = Math.floor(u / (3600 * k)); u -= D * 3600 * k;
    const M = Math.floor(u / (60 * k)); u -= M * 60 * k;
    const S = (u / k).toFixed(sd);
    return `${D}°${String(M).padStart(2, '0')}′${S.padStart(sd ? 3 + sd : 2, '0')}″`;
}
// 全角の数字・記号を半角にする（日本語入力のままでも数値を読めるように）
function cogoHalfWidth(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/[\u2212\u2012\u2013\u2014\u30FC]/g, '-').replace(/\u3000/g, ' ');
}
// 角度の入力（「45.5」＝度、「45 30 15」「45-30-15」「45°30′15″」＝度 分 秒）。読めなければ NaN
function cogoParseAngle(text) { const s = cogoHalfWidth(text); return (typeof parseAzimuth === 'function') ? parseAzimuth(s) : parseFloat(s); }
// 数値の入力（全角でもよい）。空・読めなければ NaN
function cogoParseNum(text) { const s = cogoHalfWidth(text).trim(); return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN; }

// ===== 2点の計算（a, b は測量座標 { X, Y }・m） =====
// 逆計算: a → b の ΔX（北）・ΔY（東）・水平距離・方向角（度）
function cogoInverse(a, b) {
    const dX = b.X - a.X, dY = b.Y - a.Y, dist = Math.hypot(dX, dY);
    return { dX, dY, dist, az: dist > 0 ? cogoNormDeg(Math.atan2(dY, dX) * 180 / Math.PI) : 0 };
}
// 放射: a から方向角 az（度）・水平距離 d の点
function cogoPolar(a, az, d) {
    const r = az * Math.PI / 180;
    return { X: a.X + d * Math.cos(r), Y: a.Y + d * Math.sin(r) };
}
// 器械点 st で後視点 bs を 0° にして、右回りに ang（度）回した方向の方向角
function cogoAzFromBacksight(st, bs, ang) {
    return cogoNormDeg(cogoInverse(st, bs).az + ang);
}

// ===== 交点 =====
// 2直線の交点（直線1: p1→p2、直線2: p3→p4。延長線上でもよい）。平行なら null
function cogoIntersectLines(p1, p2, p3, p4) {
    const aX = p2.X - p1.X, aY = p2.Y - p1.Y, bX = p4.X - p3.X, bY = p4.Y - p3.Y;
    const la = Math.hypot(aX, aY), lb = Math.hypot(bX, bY);
    if(la < 1e-12 || lb < 1e-12) return null;
    const den = aX * bY - aY * bX;
    if(Math.abs(den) < 1e-12 * la * lb) return null; // 平行
    const t = ((p3.X - p1.X) * bY - (p3.Y - p1.Y) * bX) / den;
    return { X: p1.X + t * aX, Y: p1.Y + t * aY };
}
// 方向角の交会: a から方向角 azA、b から方向角 azB の線の交点。平行なら null
function cogoIntersectAzimuths(a, azA, b, azB) {
    const ra = azA * Math.PI / 180, rb = azB * Math.PI / 180;
    return cogoIntersectLines(a, { X: a.X + Math.cos(ra), Y: a.Y + Math.sin(ra) }, b, { X: b.X + Math.cos(rb), Y: b.Y + Math.sin(rb) });
}
// 距離の交会: a から距離 da、b から距離 db の点。a→b を見て右側・左側の2つ。届かなければ null
function cogoIntersectDistances(a, da, b, db) {
    const d = cogoInverse(a, b).dist;
    if(d < 1e-12 || !(da > 0) || !(db > 0)) return null;
    const tol = 1e-9 * Math.max(1, d);
    if(da + db < d - tol || Math.abs(da - db) > d + tol) return null;
    const x = (da * da - db * db + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, da * da - x * x));
    const uX = (b.X - a.X) / d, uY = (b.Y - a.Y) / d; // a→b の向き（北成分・東成分）
    const mX = a.X + x * uX, mY = a.Y + x * uY;
    // 進む向きの右（時計回りに90°）は（-東成分, 北成分）
    return { right: { X: mX - h * uY, Y: mY + h * uX }, left: { X: mX + h * uY, Y: mY - h * uX } };
}

// ===== 座標求積（座標法） =====
// pts: [{ name, X, Y }]（区画の頂点を順に。最後の点と最初の点を結ぶ）
// 行ごとに 点名・X・Y・(Yn+1 − Yn−1)・Xn×(Yn+1 − Yn−1)・辺長（次の点まで）。倍面積＝Σ Xn×(Yn+1 − Yn−1)
function cogoAreaTable(pts) {
    const n = pts.length;
    const rows = pts.map((p, i) => {
        const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
        const dY = next.Y - prev.Y;
        return { name: p.name, X: p.X, Y: p.Y, dY, prod: p.X * dY, side: Math.hypot(next.X - p.X, next.Y - p.Y), toName: next.name };
    });
    const twiceSigned = rows.reduce((s, r) => s + r.prod, 0);
    return { rows, twiceSigned, twice: Math.abs(twiceSigned), area: Math.abs(twiceSigned) / 2, perimeter: rows.reduce((s, r) => s + r.side, 0) };
}
// 地積（登記）の端数処理。'cm': 1㎡の1/100未満を切り捨て、'm': 1㎡未満を切り捨て（宅地・鉱泉地以外で10㎡を超える土地）
function cogoLandArea(area, mode) {
    const s = Math.abs(area).toFixed(6); // 小数6桁に丸めてから切り捨てる（計算の誤差で 12.34 が 12.33999… にならないように）
    const [ip, fp] = s.split('.');
    if(mode === 'm' && parseFloat(s) > 10) return ip;
    return ip + '.' + fp.slice(0, 2);
}
// 辺が交わっている（ねじれた）多角形か。面積が正しく出ないので知らせる
function cogoSelfIntersects(pts) {
    const n = pts.length;
    if(n < 4) return false;
    const cross = (o, a, b) => (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
    for(let i = 0; i < n; i++) {
        const a1 = pts[i], a2 = pts[(i + 1) % n];
        for(let j = i + 2; j < n; j++) {
            if(i === 0 && j === n - 1) continue; // 隣り合う辺（最後の辺と最初の辺）
            const b1 = pts[j], b2 = pts[(j + 1) % n];
            const d1 = cross(b1, b2, a1), d2 = cross(b1, b2, a2), d3 = cross(a1, a2, b1), d4 = cross(a1, a2, b2);
            if(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
        }
    }
    return false;
}

// 求積表の列（表示・CSV・図面の表で共通）
const COGO_AREA_COLS = [
    { head: '点名', align: 'center', v: (r) => String(r.name) },
    { head: 'X', align: 'right', v: (r) => cogoFix(r.X, 3) },
    { head: 'Y', align: 'right', v: (r) => cogoFix(r.Y, 3) },
    { head: 'Yn+1−Yn−1', align: 'right', v: (r) => cogoFix(r.dY, 3) },
    { head: 'Xn×(Yn+1−Yn−1)', align: 'right', v: (r) => cogoFix(r.prod, 6) },
    { head: '辺長', align: 'right', v: (r) => cogoFix(r.side, 3) },
];
// 表の下の合計欄
function cogoAreaFooter(t, landMode) {
    return [['倍面積（㎡）', cogoFix(t.twice, 6)], ['面積（㎡）', cogoFix(t.area, 6)], ['地積（㎡）', cogoLandArea(t.area, landMode)]];
}

// 求積表の CSV（Excel で開ける UTF-8。BOM は出力するときに付ける）
function cogoAreaCsv(title, t, landMode) {
    const q = (s) => /[",\r\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
    const L = [q('座標求積表') + ',' + q(title || '')];
    L.push(COGO_AREA_COLS.map((c) => q(c.head)).join(','));
    t.rows.forEach((r) => L.push(COGO_AREA_COLS.map((c) => q(c.v(r))).join(',')));
    cogoAreaFooter(t, landMode).forEach(([k, v]) => L.push(',,,,' + q(k) + ',' + q(v)));
    L.push(',,,,' + q('周長（m）') + ',' + q(cogoFix(t.perimeter, 3)));
    return L.join('\r\n') + '\r\n';
}

// 文字の幅の目安（半角 0.62・全角 1.0 文字分）
function _cogoTextW(s, h) {
    let w = 0;
    for(const ch of String(s)) w += ch.charCodeAt(0) <= 0xff ? 0.62 : 1.0;
    return w * h;
}
/**
 * 線と文字の表（題・見出し・行・合計欄）を図面の図形で作る（求積表・杭打ち表で共通）。
 * opt: { left, top（表の左上・図面の座標）, h（文字の高さ・図面の単位）, layer, title,
 *        cols: [{ head, align }], rows: [[文字, …]], foot: [[見出し, 値], …], footCol（合計の値の列。見出しはその左の列すべてにまたがる） }
 * 戻り値: { entities, width, height }
 */
function cogoGridTable(opt) {
    const h = opt.h, pad = h * 0.5, rowH = h * 1.8, layer = opt.layer, cols = opt.cols, foot = opt.foot || [], fc = opt.footCol;
    const widths = cols.map((c, i) => {
        let w = _cogoTextW(c.head, h);
        opt.rows.forEach((r) => { w = Math.max(w, _cogoTextW(r[i], h)); });
        if(i === fc) foot.forEach((f) => { w = Math.max(w, _cogoTextW(f[1], h)); });
        return w + pad * 2;
    });
    // 合計欄の見出しが入りきらなければ最初の列を広げる
    if(foot.length && fc > 0) {
        const labelW = Math.max(...foot.map((f) => _cogoTextW(f[0], h))) + pad * 2;
        const leftW = widths.slice(0, fc).reduce((a, b) => a + b, 0);
        if(leftW < labelW) widths[0] += labelW - leftW;
    }
    const xs = [opt.left];
    widths.forEach((w) => xs.push(xs[xs.length - 1] + w));
    const right = xs[xs.length - 1];
    const nData = opt.rows.length, nRows = 2 + nData + foot.length; // 題・見出し・行・合計
    const ys = [];
    for(let i = 0; i <= nRows; i++) ys.push(opt.top - i * rowH);
    const out = [];
    const line = (x1, y1, x2, y2) => out.push({ type: 'LINE', layer, color: null, x1, y1, x2, y2 });
    const text = (s, x, y, align) => { if(s !== '' && s !== null && s !== undefined) out.push({ type: 'TEXT', layer, color: null, x, y, text: String(s), height: h, halign: align, valign: 'middle' }); };
    for(let i = 0; i <= nRows; i++) line(opt.left, ys[i], right, ys[i]);
    line(opt.left, ys[0], opt.left, ys[nRows]); line(right, ys[0], right, ys[nRows]);
    const dataEnd = 2 + nData;
    for(let c = 1; c < widths.length; c++) line(xs[c], ys[1], xs[c], ys[dataEnd]);
    if(foot.length) { line(xs[fc], ys[dataEnd], xs[fc], ys[nRows]); if(fc + 1 < widths.length) line(xs[fc + 1], ys[dataEnd], xs[fc + 1], ys[nRows]); }
    const mid = (k) => (ys[k] + ys[k + 1]) / 2;
    text(opt.title, opt.left + pad, mid(0), 'left');
    cols.forEach((c, i) => text(c.head, (xs[i] + xs[i + 1]) / 2, mid(1), 'center'));
    opt.rows.forEach((r, k) => cols.forEach((c, i) => {
        const x = c.align === 'center' ? (xs[i] + xs[i + 1]) / 2 : c.align === 'left' ? xs[i] + pad : xs[i + 1] - pad;
        text(r[i], x, mid(2 + k), c.align);
    }));
    foot.forEach(([k, v], j) => { text(k, xs[fc] - pad, mid(dataEnd + j), 'right'); text(v, xs[fc + 1] - pad, mid(dataEnd + j), 'right'); });
    return { entities: out, width: right - opt.left, height: nRows * rowH };
}
// 求積表を図面の図形で作る。opt: { left, top, h, layer, title, landMode }
function cogoAreaTableEntities(t, opt) {
    return cogoGridTable({ left: opt.left, top: opt.top, h: opt.h, layer: opt.layer, title: '座標求積表' + (opt.title ? '　' + opt.title : ''),
        cols: COGO_AREA_COLS, rows: t.rows.map((r) => COGO_AREA_COLS.map((c) => c.v(r))), foot: cogoAreaFooter(t, opt.landMode), footCol: 4 });
}

// 辺長の文字（辺の中央・区画の外側・辺に沿った向き）。wpts: 図面の座標の頂点
function cogoSideLabelEntities(wpts, h, layer) {
    const f = surveyUnitFactor(), c = _polygonCentroid(wpts), out = [];
    for(let i = 0; i < wpts.length; i++) {
        const p = wpts[i], q = wpts[(i + 1) % wpts.length];
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
        if(len < 1e-9) continue;
        let a = Math.atan2(dy, dx);
        if(a > Math.PI / 2 + 1e-9) a -= Math.PI; else if(a <= -Math.PI / 2 + 1e-9) a += Math.PI; // 逆さまにしない
        let nx = -dy / len, ny = dx / len;
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        if(nx * (mx - c.x) + ny * (my - c.y) < 0) { nx = -nx; ny = -ny; } // 区画の外側へずらす
        out.push({ type: 'TEXT', layer, color: null, x: mx + nx * h * 0.9, y: my + ny * h * 0.9, text: cogoFix(len / f, 3), height: h, halign: 'center', valign: 'middle', rotation: a });
    }
    return out;
}
// 面積の文字（区画の重心の少し下。区画名の文字と重ならないように）
function cogoAreaLabelEntity(wpts, h, layer, text) {
    const c = _polygonCentroid(wpts);
    return { type: 'TEXT', layer, color: null, x: c.x, y: c.y - h * 1.6, text, height: h, halign: 'center', valign: 'middle' };
}
// 区画の大きさに合った文字の高さ（図面の単位。1・2・2.5・5 × 10^k の近い値）
function cogoNoteHeight(wpts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    wpts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    const f = surveyUnitFactor();
    const raw = Math.min(20 * f, Math.max(0.1 * f, Math.max(maxX - minX, maxY - minY) / 40));
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    let best = p, bestR = Infinity;
    [1, 2, 2.5, 5, 10].forEach((m) => { const v = m * p, r = Math.abs(Math.log(raw / v)); if(r < bestR) { bestR = r; best = v; } });
    return +best.toPrecision(6);
}

// ===== 測点 =====
// 点名・点番号から測点を探す（完全一致を優先、次に大文字小文字を区別しない一致）
function cogoFindPoint(text) {
    const s = String(text || '').trim();
    if(!s) return null;
    const all = collectSurveyPoints();
    const lc = s.toLowerCase();
    const p = all.find((q) => q.name === s) || all.find((q) => String(q.num) === s) || all.find((q) => String(q.name).toLowerCase() === lc);
    return p ? { x: p.x, y: p.y, name: p.name || String(p.num) } : null;
}
// 図面の点（WCS）から、同じ位置にある測点の名前を引く関数（多くの点を調べるときは一度作って使い回す）
function cogoPointNamer() {
    const tol = 1e-6 * surveyUnitFactor(), m = new Map();
    const key = (x, y) => Math.round(x / tol) + ',' + Math.round(y / tol);
    collectSurveyPoints().forEach((p) => { const nm = p.name || String(p.num || ''); if(nm && !m.has(key(p.x, p.y))) m.set(key(p.x, p.y), nm); });
    return (x, y) => m.get(key(x, y)) || '';
}
// 図面の点（WCS）と同じ位置にある測点の名前（無ければ ''）
function cogoPointNameAt(x, y) { return cogoPointNamer()(x, y); }
// 座標の文字「X,Y」（測量座標・m。X＝北）→ 図面の座標。読めなければ null
function cogoParseXY(text) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(cogoHalfWidth(text));
    if(!m) return null;
    return surveyToWcs(parseFloat(m[1]), parseFloat(m[2]));
}
// 次の点名の案（「P5」→「P6」、「No.09」→「No.10」。すでにある名前は飛ばす）
function cogoNextName(name) {
    const used = new Set(collectSurveyPoints().map((p) => p.name));
    const m = /^(.*?)(\d+)$/.exec(String(name || ''));
    let prefix = 'P', num = 1, width = 1;
    if(m) { prefix = m[1]; num = parseInt(m[2], 10) + 1; width = m[2].length; }
    else if(name) prefix = String(name) + '-';
    let s;
    do { s = prefix + String(num).padStart(width, '0'); num++; } while(used.has(s));
    return s;
}
// 測点（点の記号＋点名）を追加する。X, Y は測量座標（m）。追加した点の図面の座標を返す
function cogoAddSurveyPoint(X, Y, name, z) {
    const w = surveyToWcs(X, Y);
    saveUndo();
    // 点名の文字は、図面にある点名と同じ大きさにそろえる（無ければ点の広がりから決める）
    let h = null;
    for(let i = entities.length - 1; i >= 0; i--) { const e = entities[i]; if(e && e.type === 'TEXT' && e.ptLabel && e.height > 0) { h = e.height; break; } }
    if(!h) h = _autoLabelHeight(entities.filter((e) => e && e.type === 'POINT').map((e) => ({ x: e.x, y: e.y })).concat([w]));
    const lp = _ensureSurveyLayer(SURVEY_LAYER_POINT, '#ffff00');
    const ll = _ensureSurveyLayer(SURVEY_LAYER_LABEL, '#ffffff');
    makeSurveyPointEntities({ x: w.x, y: w.y, name: String(name || ''), num: '', z: (typeof z === 'number' && isFinite(z)) ? z : null }, h, lp, ll).forEach((e) => entities.push(e));
    ensureEntityIds(); _bumpGeomEpoch(); initLayers();
    if(typeof updateLayerPanel === 'function') updateLayerPanel();
    return w;
}
