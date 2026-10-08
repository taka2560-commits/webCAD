// ===== Web CAD 取り込みの図形（塗りつぶし・引出線・マルチ引出線・読めない図形の知らせ） =====
// cad-import-shapes.js - DXF（cad-io.js）と DWG（cad-dwg.js）の取り込みで共通に使う。
//   塗りつぶし（HATCH・SOLID）: 境界（ふくらみ付きの折れ線、または 線・円弧・楕円弧・スプラインの辺）を折れ線の輪にし、
//       いちばん広い輪を target（閉じた PLINE）の points、ほかの輪を target.holes に入れる（偶奇の規則で塗る＝穴・島・離れた輪）。
//       斜線などの模様は、線の定義（向き・基点・次の線へのずらし・線と間の長さ）を pat に持ち、輪で切り抜いて描く。
//       取り込んだ塗りつぶしは、オプション「取り込み時に塗りつぶしを非表示」（初期値: 入）で非表示にする（hiddenBy: 'fill'）。
//       寸法・引出線の矢印（塗りの三角）は消すと困るので、非表示にしない。
//   引出線（LEADER）・マルチ引出線（MULTILEADER）: 折れ線と、矢印（塗りの三角）と、文字にする。
//   読めない図形: DXF の読込ライブラリ（dxf-parser）が知らない図形も、黙って捨てずに数え、日本語の名前で知らせる。

// ===== 取り込みのオプション: 塗りつぶしを非表示（初期値: 入） =====
function shouldHideImportedFills() {
    try { const v = localStorage.getItem('cad_import_hide_fills'); return v === null ? true : v === '1'; } catch { return true; }
}
window.setImportHideFills = function(v) {
    try { localStorage.setItem('cad_import_hide_fills', v ? '1' : '0'); } catch { /* 保存できなくても続行 */ }
    addCommandLog(`-> 取り込み時の塗りつぶし非表示: ${v ? 'ON' : 'OFF'}`);
};

// ===== 取り込めなかった図形の名前（日本語） =====
const IMPORT_TYPE_NAMES = {
    HATCH: '塗りつぶし', SOLID: '塗り（SOLID）', LEADER: '引出線', MULTILEADER: 'マルチ引出線', MLEADER: 'マルチ引出線',
    WIPEOUT: 'ワイプアウト（白抜き）', IMAGE: '画像の参照', XLINE: '構築線', RAY: '放射線', MLINE: 'マルチライン',
    ACAD_TABLE: '表', TABLE: '表', TOLERANCE: '幾何公差', OLE2FRAME: '貼り付けた OLE', OLEFRAME: '貼り付けた OLE',
    '3DSOLID': '3D ソリッド', REGION: 'リージョン', BODY: 'ボディ', MESH: 'メッシュ', SURFACE: 'サーフェス', PLANESURFACE: 'サーフェス',
    ACAD_PROXY_ENTITY: 'プロキシ図形', PROXY: 'プロキシ図形', VIEWPORT: 'ビューポート', SPLINE: 'スプライン（形の無いもの）',
    DIMENSION: '寸法', ARC_DIMENSION: '弧長寸法', LARGE_RADIAL_DIMENSION: '折り曲げ半径寸法', ATTDEF: '属性定義', ATTRIB: '属性',
    TRACE: '太線（TRACE）', SHAPE: 'シェイプ', HELIX: 'らせん', SECTION: '断面', LIGHT: 'ライト', POINTCLOUD: '点群',
    PDFUNDERLAY: 'PDF のアンダーレイ', DWFUNDERLAY: 'DWF のアンダーレイ', DGNUNDERLAY: 'DGN のアンダーレイ', GEOPOSITIONMARKER: '位置マーカー',
    MTEXT: '文字', TEXT: '文字', LINE: '線', CIRCLE: '円', ARC: '円弧', ELLIPSE: '楕円', POINT: '点',
    POLYLINE: 'ポリライン', LWPOLYLINE: 'ポリライン', POLYLINE2D: 'ポリライン', POLYLINE3D: '3D ポリライン', '3DFACE': '3D 面', INSERT: 'ブロック参照',
};
function importTypeLabel(t) {
    const s = String(t || '?');
    if(s.startsWith('INSERT:')) return `ブロック「${s.slice(7)}」（定義が無い）`;
    return IMPORT_TYPE_NAMES[s] || s;
}
// 取り込めなかった図形の一覧の文字。long: コマンド欄用（元の名前と ×個数をすべて）、そうでなければお知らせ用（多い順に max 種類）
function importSkipText(stats, long, max) {
    const list = Object.entries(stats || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if(long) return list.map(([t, n]) => `${importTypeLabel(t)}（${t}）×${n}`).join('、');
    const m = max || 3;
    return list.slice(0, m).map(([t, n]) => `${importTypeLabel(t)} ${n}`).join('・') + (list.length > m ? ' など' : '');
}
// 取り込みの終わりのお知らせに足す文（取り込めなかった図形・非表示にした塗りつぶし）
function importResultNote(skipStats, hiddenFills) {
    let s = '';
    const skip = importSkipText(skipStats, false, 3);
    if(skip) s += `\n取り込めなかった図形: ${skip}（詳しくはコマンド欄）`;
    if(hiddenFills > 0) s += `\n塗りつぶし ${hiddenFills}個は非表示にしました（画層管理の「塗りつぶしを表示」で表示）`;
    return s;
}

// ===== 塗りつぶしの境界を折れ線の輪にする =====
const HATCH_SEGS = 72; // 円1周を何本の線で近似するか

// 円弧・楕円弧の辺の点。中心 c、長軸の端（中心から）(mx, my)、短軸の比 ratio、媒介変数の始め a0・終わり a1（ラジアン）。
// 右回り（ccw でない）の辺は、AutoCAD の決まりで角度が x 軸で折り返して入っているので、符号を変えて右回りにたどる
function _hatchArcPts(cx, cy, mx, my, ratio, a0, a1, ccw) {
    const TAU = Math.PI * 2;
    const s = ccw ? a0 : -a0, e = ccw ? a1 : -a1, dir = ccw ? 1 : -1;
    let sweep = dir > 0 ? e - s : s - e;
    sweep %= TAU;
    if(sweep <= 1e-9) sweep += TAU;
    const n = Math.max(4, Math.ceil(sweep / TAU * HATCH_SEGS));
    const nx = -my * ratio, ny = mx * ratio; // 短軸（長軸を左へ 90° 回して比を掛ける）
    const out = [];
    for(let k = 0; k <= n; k++) {
        const t = s + dir * sweep * k / n, c = Math.cos(t), si = Math.sin(t);
        out.push({ x: cx + mx * c + nx * si, y: cy + my * c + ny * si });
    }
    return out;
}
// 境界の1つの道を点の列にする。path: { poly: [{x,y,bulge}] } か { edges: [辺] }。
// 辺: { t:'line', a, b } / { t:'arc', c, r, a0, a1, ccw } / { t:'ell', c, mx, my, ratio, a0, a1, ccw } / { t:'spline', deg, knots, ctrl, fit }（角度はラジアン）
function hatchPathPoints(path) {
    if(path.poly) return path.poly.length >= 2 ? expandBulgeVertices(path.poly, true, 16) : [];
    const ring = [];
    const d2 = (p, q) => (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
    (path.edges || []).forEach(ed => {
        let pts = null;
        if(ed.t === 'line') pts = [ed.a, ed.b];
        else if(ed.t === 'arc') pts = _hatchArcPts(ed.c.x, ed.c.y, ed.r, 0, 1, ed.a0, ed.a1, ed.ccw);
        else if(ed.t === 'ell') pts = _hatchArcPts(ed.c.x, ed.c.y, ed.mx, ed.my, ed.ratio || 1, ed.a0, ed.a1, ed.ccw);
        else if(ed.t === 'spline') pts = (ed.ctrl && ed.ctrl.length >= 2) ? evalBSplinePoints(ed.ctrl, ed.deg || 3, ed.knots, Math.min(200, Math.max(16, ed.ctrl.length * 8))) : (ed.fit || []);
        if(!pts || pts.length < 2) return;
        // 辺の向きがそろっていないファイルもあるので、前の辺の終わりに近い端から足す
        if(ring.length) { const last = ring[ring.length - 1]; if(d2(last, pts[pts.length - 1]) < d2(last, pts[0])) pts = pts.slice().reverse(); }
        pts.forEach(p => ring.push({ x: p.x, y: p.y }));
    });
    return ring;
}
// 続く同じ点と、最後の閉じる点（最初と同じ点）を除く
function _hatchCleanRing(pts) {
    const same = (p, q) => Math.abs(p.x - q.x) <= 1e-9 * (1 + Math.abs(p.x)) && Math.abs(p.y - q.y) <= 1e-9 * (1 + Math.abs(p.y));
    const out = [];
    pts.forEach(p => { if(isFinite(p.x) && isFinite(p.y) && !(out.length && same(out[out.length - 1], p))) out.push({ x: p.x, y: p.y }); });
    if(out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
    return out;
}
// 輪の面積（符号つき）。公共座標でも桁が落ちないよう、最初の点からの差で計算する
function _hatchRingArea(r) {
    if(r.length < 3) return 0;
    const x0 = r[0].x, y0 = r[0].y;
    let s = 0;
    for(let i = 1; i + 1 < r.length; i++) s += (r[i].x - x0) * (r[i + 1].y - y0) - (r[i + 1].x - x0) * (r[i].y - y0);
    return s / 2;
}

// ===== 模様（斜線など） =====
// 線の定義がファイルに無いとき（DWG で読めないことがある）に使う、名前の分かる模様。
// .pat と同じ並び: [角度°, 基点x, 基点y, ずらしx（線の向き）, ずらしy（線と直角）, 線・間…（負は間）]
const HATCH_BUILTIN = {
    ANSI31: [[45, 0, 0, 0, 3.175]],
    ANSI32: [[45, 0, 0, 0, 9.525], [45, 4.49013, 0, 0, 9.525]],
    ANSI33: [[45, 0, 0, 0, 6.35], [45, 4.49013, 0, 0, 6.35, 3.175, -1.5875]],
    ANSI37: [[45, 0, 0, 0, 3.175], [135, 0, 0, 0, 3.175]],
    NET: [[0, 0, 0, 0, 3.175], [90, 0, 0, 0, 3.175]],
    NET3: [[0, 0, 0, 0, 3.175], [60, 0, 0, 0, 3.175], [120, 0, 0, 0, 3.175]],
    LINE: [[0, 0, 0, 0, 3.175]],
    DASH: [[0, 0, 0, 3.175, 3.175, 3.175, -3.175]],
    SQUARE: [[0, 0, 0, 0, 3.175, 3.175, -3.175], [90, 0, 0, 0, 3.175, 3.175, -3.175]],
};
// 名前の分かる模様を、ファイルと同じ形（図面の向き・大きさの線の定義）にする。scale が分からないときは、範囲の大きさから決める
function _hatchBuiltinLines(name, angDeg, scale, size) {
    const def = HATCH_BUILTIN[String(name || '').toUpperCase()];
    if(!def) return [];
    const k = (scale > 0) ? scale : Math.max(size / 40, 1e-9) / 3.175;
    const A = (angDeg || 0) * Math.PI / 180;
    return def.map(([a, bx, by, dx, dy, ...dash]) => {
        const t = a * Math.PI / 180 + A, ca = Math.cos(A), sa = Math.sin(A);
        const ox = (dx * Math.cos(a * Math.PI / 180) - dy * Math.sin(a * Math.PI / 180)) * k, oy = (dx * Math.sin(a * Math.PI / 180) + dy * Math.cos(a * Math.PI / 180)) * k;
        return { a: t, bx: (bx * ca - by * sa) * k, by: (bx * sa + by * ca) * k, ox: ox * ca - oy * sa, oy: ox * sa + oy * ca, d: dash.map(v => v * k) };
    });
}

// 取り込んだ塗りつぶしを、アプリの HATCH（target・holes・pat）にする。
//   paths: 元の座標の境界。xf: { pt(x,y) → {x,y}、vec(x,y) → {x,y}、k: 長さの倍率 }。
//   opt: { base（画層・色）, solid, name, lines（線の定義。角度ラジアン・元の座標）, angle（模様の角度°）, scale, hide }
function makeImportedHatch(paths, xf, opt) {
    const rings = [];
    (paths || []).forEach(p => { const r = _hatchCleanRing(hatchPathPoints(p).map(q => xf.pt(q.x, q.y))); if(r.length >= 3) rings.push(r); });
    if(!rings.length) return null;
    rings.sort((a, b) => Math.abs(_hatchRingArea(b)) - Math.abs(_hatchRingArea(a)));
    const target = { type: 'PLINE', points: rings[0], closed: true };
    if(rings.length > 1) target.holes = rings.slice(1);
    const e = Object.assign({}, opt.base, { type: 'HATCH', target, imp: 1 });
    if(!opt.solid && String(opt.name || '').toUpperCase() !== 'SOLID') {
        let lines = (opt.lines || []).filter(l => isFinite(l.a) && (Math.abs(l.ox) + Math.abs(l.oy)) > 0).map(l => {
            const b = xf.pt(l.bx, l.by), o = xf.vec(l.ox, l.oy), u = xf.vec(Math.cos(l.a), Math.sin(l.a));
            return { a: Math.atan2(u.y, u.x), bx: b.x, by: b.y, ox: o.x, oy: o.y, d: (l.d || []).map(v => v * xf.k) };
        });
        if(!lines.length) {
            const bb = calcBBox(target), size = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY);
            lines = _hatchBuiltinLines(opt.name, opt.angle, (opt.scale || 0) * xf.k, size).map(l => {
                const b = { x: target.points[0].x + l.bx, y: target.points[0].y + l.by };
                return Object.assign(l, { bx: b.x, by: b.y });
            });
        }
        e.pat = { name: String(opt.name || ''), lines };
        if(!lines.length) e.pat.dense = true; // 形の分からない模様は、薄く塗る
    }
    if(opt.hide) { e.hidden = true; e.hiddenBy = 'fill'; }
    return e;
}
// 塗りの多角形（SOLID・TRACE）。pts は図面の座標（3〜4点）
function makeImportedFill(pts, base, hide) {
    const r = _hatchCleanRing(pts);
    if(r.length < 3) return null;
    const e = Object.assign({}, base, { type: 'HATCH', imp: 1, target: { type: 'PLINE', points: r, closed: true } });
    if(hide) { e.hidden = true; e.hiddenBy = 'fill'; }
    return e;
}
// 寸法・引出線のブロックを広げた図形の塗り（矢印）は、非表示にしない（「塗りつぶしを隠す」でも隠さないよう arrow を付ける）
function unhideFills(list) {
    (list || []).forEach(e => { if(e && e.type === 'HATCH' && e.imp) { e.arrow = 1; if(e.hiddenBy === 'fill') { delete e.hidden; delete e.hiddenBy; } } });
    return list;
}
// 取り込んだ塗りつぶしを、また非表示にする（画層管理の「塗りつぶしを隠す」。矢印は残す）
window.hideImportedFills = function() {
    const list = entities.filter(e => e.type === 'HATCH' && e.imp && !e.arrow && !e.hidden);
    if(!list.length) { addCommandLog('-> 隠す塗りつぶしはありません'); return; }
    saveUndo();
    list.forEach(e => { e.hidden = true; e.hiddenBy = 'fill'; });
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    addCommandLog(`-> 取り込んだ塗りつぶし ${list.length}個 を非表示にしました（元に戻すにはUndo）`);
    if(typeof window.updateLayerManagerContent === 'function') window.updateLayerManagerContent();
    render();
};

// ===== 塗りつぶしの移し方（移動・回転・鏡像・尺度で、穴の輪と模様も一緒に写す） =====
// f(x, y) → {x, y}: 点の写し方。k: 長さの倍率（1 なら変えない）
function hatchExtrasXform(e, f, k) {
    const tg = e && e.target;
    if(tg && tg.holes) tg.holes.forEach(r => r.forEach(p => { const q = f(p.x, p.y); p.x = q.x; p.y = q.y; }));
    if(e && e.pat && e.pat.lines) e.pat.lines.forEach(l => {
        const b = f(l.bx, l.by), u = f(l.bx + Math.cos(l.a), l.by + Math.sin(l.a)), o = f(l.bx + l.ox, l.by + l.oy);
        l.a = Math.atan2(u.y - b.y, u.x - b.x); l.ox = o.x - b.x; l.oy = o.y - b.y; l.bx = b.x; l.by = b.y;
        if(k && Math.abs(k - 1) > 1e-12 && l.d) l.d = l.d.map(v => v * k);
    });
}

// ===== 模様の描画（画面） =====
// 塗りつぶしの輪で切り抜いて、模様の線を描く。線が細かすぎる（画面で 2px より狭い・本数が多すぎる）ときは薄く塗る
const HATCH_MAX_LINES = 4000;
function drawHatchPattern(e, ringPath) {
    const pat = e.pat, tg = e.target;
    const bb = calcBBox(tg);
    if(!pat || !bb || !isFinite(bb.minX)) return;
    ctx.save();
    ringPath(); ctx.clip('evenodd');
    let lines = pat.dense ? [] : pat.lines, drawn = 0;
    const corners = [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]];
    const plan = [];
    for(const l of lines) {
        const ux = Math.cos(l.a), uy = Math.sin(l.a), nx = -uy, ny = ux;
        const sp = l.ox * nx + l.oy * ny; // 線と線の間隔（向きつき）
        if(!(Math.abs(sp) > 0) || Math.abs(sp) * view.scale < 2) { lines = null; break; }
        let tmin = Infinity, tmax = -Infinity;
        corners.forEach(([x, y]) => { const t = ((x - l.bx) * nx + (y - l.by) * ny) / sp; if(t < tmin) tmin = t; if(t > tmax) tmax = t; });
        const k0 = Math.floor(tmin), k1 = Math.ceil(tmax);
        drawn += k1 - k0 + 1;
        if(drawn > HATCH_MAX_LINES) { lines = null; break; }
        plan.push({ l, ux, uy, k0, k1 });
    }
    if(!lines || !lines.length) {
        // 細かすぎる・形の分からない模様: 薄く塗る
        ctx.globalAlpha = 0.25; ringPath(); ctx.fill('evenodd');
        ctx.restore();
        return;
    }
    ctx.globalAlpha = 1; ctx.lineWidth = lineWidthPx(1);
    for(const { l, ux, uy, k0, k1 } of plan) {
        const dash = _hatchDashPx(l.d);
        ctx.setLineDash(dash ? dash.arr : []);
        for(let kk = k0; kk <= k1; kk++) {
            const px = l.bx + kk * l.ox, py = l.by + kk * l.oy;
            let smin = Infinity, smax = -Infinity;
            corners.forEach(([x, y]) => { const s = (x - px) * ux + (y - py) * uy; if(s < smin) smin = s; if(s > smax) smax = s; });
            const a = wcsToScreen(px + smin * ux, py + smin * uy), b = wcsToScreen(px + smax * ux, py + smax * uy);
            if(dash) ctx.lineDashOffset = ((smin * view.scale) % dash.len + dash.len) % dash.len;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.restore();
}
// 印刷（PDF）の模様: 線の定義ごとに、塗りつぶしの範囲（外接の四角）を横切る線分を seg(a, b) に渡す（begin で輪の切り抜き、end で線を引く）。
// mmPerUnit: 図面の1単位が用紙で何 mm か。細かすぎる（用紙で 0.3mm より狭い・本数が多すぎる）・形の分からない模様は false（呼ぶ側で薄く塗る）
function printHatchLines(e, mmPerUnit, seg, begin, end) {
    const pat = e.pat, bb = e.target && calcBBox(e.target);
    if(!pat || pat.dense || !pat.lines || !pat.lines.length || !bb || !isFinite(bb.minX)) return false;
    const corners = [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]];
    const segs = [];
    for(const l of pat.lines) {
        const ux = Math.cos(l.a), uy = Math.sin(l.a), nx = -uy, ny = ux, sp = l.ox * nx + l.oy * ny;
        if(!(Math.abs(sp) > 0) || Math.abs(sp) * mmPerUnit < 0.3) return false;
        let tmin = Infinity, tmax = -Infinity;
        corners.forEach(([x, y]) => { const t = ((x - l.bx) * nx + (y - l.by) * ny) / sp; if(t < tmin) tmin = t; if(t > tmax) tmax = t; });
        for(let kk = Math.floor(tmin); kk <= Math.ceil(tmax); kk++) {
            if(segs.length > 20000) return false;
            const px = l.bx + kk * l.ox, py = l.by + kk * l.oy;
            let smin = Infinity, smax = -Infinity;
            corners.forEach(([x, y]) => { const s = (x - px) * ux + (y - py) * uy; if(s < smin) smin = s; if(s > smax) smax = s; });
            segs.push([{ x: px + smin * ux, y: py + smin * uy }, { x: px + smax * ux, y: py + smax * uy }]);
        }
    }
    begin();
    segs.forEach(([a, b]) => seg(a, b));
    end();
    return true;
}
// 線・間の長さ（図面の単位。負は間、0 は点）を、画面の点線の指定（px）にする。間の無い模様は null（実線）
function _hatchDashPx(d) {
    if(!d || !d.length || !d.some(v => v < 0)) return null;
    const arr = [];
    d.forEach(v => {
        const px = Math.max(Math.abs(v) * view.scale, v === 0 ? 1 : 0.5);
        const isGap = v < 0;
        if(arr.length % 2 === (isGap ? 0 : 1)) arr.push(0); // 線・間を交互にする
        arr.push(px);
    });
    if(arr.length % 2) arr.push(0);
    const len = arr.reduce((a, b) => a + b, 0);
    return len > 0 ? { arr, len } : null;
}

// ===== DXF: dxf-parser が読まない図形を読む =====
// 図形のタグ（[コード, 値]）を全部集めて、作る関数 build に渡すハンドラ。dxf-parser の決まり: コード 0 まで読み進めて返す
function _dxfTagHandler(name, build) {
    return class {
        constructor() { this.ForEntityName = name; }
        parseEntity(scanner, curr) {
            const tags = [];
            curr = scanner.next();
            while(!scanner.isEOF() && curr.code !== 0) { tags.push([curr.code, curr.value]); curr = scanner.next(); }
            return build(name, tags);
        }
    };
}
// 共通の値（画層・色・レイアウトか・持ち主・ハンドル・見えるか）。最初に出てきたものを使う
function _dxfCommon(type, tags) {
    const e = { type };
    const seen = new Set();
    for(const [c, v] of tags) {
        if(seen.has(c)) continue;
        if(c === 8) e.layer = v; else if(c === 62) e.colorIndex = Number(v); else if(c === 420) e.color = Number(v);
        else if(c === 67) e.inPaperSpace = Number(v) !== 0; else if(c === 330) e.ownerHandle = String(v); else if(c === 5) e.handle = String(v);
        else if(c === 60) e.visible = Number(v) === 0; else if(c === 6) e.lineType = String(v); else if(c === 370) e.lineweight = Number(v);
        else continue;
        seen.add(c);
    }
    return e;
}
// HATCH のタグを読む（境界の円弧の角度は度なので、ラジアンに直す）
function dxfHatchFromTags(type, tags) {
    const h = Object.assign(_dxfCommon(type, tags), { paths: [], lines: [] });
    const n = tags.length;
    let i = 0;
    const at = (c) => i < n && tags[i][0] === c;
    const num = () => Number(tags[i++][1]);
    const pt = (cx) => { const x = num(); const y = at(cx + 10) ? num() : 0; if(at(cx + 20)) i++; return { x, y }; };
    const D2R = Math.PI / 180;
    while(i < n && tags[i][0] !== 91) { const [c, v] = tags[i]; if(c === 2) h.name = String(v); else if(c === 70) h.solid = Number(v) === 1; i++; }
    if(i >= n) return h;
    const np = num();
    for(let k = 0; k < np && i < n; k++) {
        while(i < n && tags[i][0] !== 92) i++;
        if(i >= n) break;
        const flag = num();
        if(flag & 2) {
            let nv = 0;
            if(at(72)) i++; if(at(73)) i++; if(at(93)) nv = num();
            const poly = [];
            for(let v = 0; v < nv && at(10); v++) { const p = pt(10); poly.push({ x: p.x, y: p.y, bulge: at(42) ? num() : 0 }); }
            h.paths.push({ poly });
        } else {
            const ne = at(93) ? num() : 0, edges = [];
            for(let q = 0; q < ne && at(72); q++) {
                const et = num();
                if(et === 1) { const a = at(10) ? pt(10) : null, b = at(11) ? pt(11) : null; if(a && b) edges.push({ t: 'line', a, b }); }
                else if(et === 2 || et === 3) {
                    const c = at(10) ? pt(10) : { x: 0, y: 0 };
                    const m = (et === 3 && at(11)) ? pt(11) : null;
                    const r = at(40) ? num() : 1, a0 = at(50) ? num() : 0, a1 = at(51) ? num() : 360, ccw = at(73) ? !!num() : true;
                    edges.push(et === 2 ? { t: 'arc', c, r, a0: a0 * D2R, a1: a1 * D2R, ccw } : { t: 'ell', c, mx: m ? m.x : 1, my: m ? m.y : 0, ratio: r, a0: a0 * D2R, a1: a1 * D2R, ccw });
                } else if(et === 4) {
                    const deg = at(94) ? num() : 3; if(at(73)) i++; if(at(74)) i++;
                    const nk = at(95) ? num() : 0, nc = at(96) ? num() : 0;
                    const knots = [], ctrl = [], fit = [];
                    for(let z = 0; z < nk && at(40); z++) knots.push(num());
                    for(let z = 0; z < nc && at(10); z++) { ctrl.push(pt(10)); if(at(42)) i++; }
                    while(at(42)) i++;
                    if(at(97)) { const nf = num(); for(let z = 0; z < nf && at(11); z++) fit.push(pt(11)); }
                    if(at(12)) pt(12); if(at(13)) pt(13);
                    edges.push({ t: 'spline', deg, knots, ctrl, fit });
                } else break;
            }
            h.paths.push({ edges });
        }
        if(at(97)) { const ns = num(); for(let s = 0; s < ns && at(330); s++) i++; } // 境界のもとになった図形
    }
    while(i < n) {
        const c = tags[i][0];
        if(c === 52) { h.angle = num(); continue; }
        if(c === 41) { h.scale = num(); continue; }
        if(c === 78) {
            const nl = num();
            for(let L = 0; L < nl && at(53); L++) {
                const a = num() * D2R;
                const bx = at(43) ? num() : 0, by = at(44) ? num() : 0, ox = at(45) ? num() : 0, oy = at(46) ? num() : 0;
                const nd = at(79) ? num() : 0, d = [];
                for(let z = 0; z < nd && at(49); z++) d.push(num());
                h.lines.push({ a, bx, by, ox, oy, d });
            }
            continue;
        }
        i++;
    }
    return h;
}
// LEADER: 頂点（10・20）と、矢印があるか（71）
function dxfLeaderFromTags(type, tags) {
    const e = Object.assign(_dxfCommon(type, tags), { vertices: [], arrow: true });
    for(let i = 0; i < tags.length; i++) {
        const [c, v] = tags[i];
        if(c === 71) e.arrow = Number(v) !== 0;
        else if(c === 10) { const y = (tags[i + 1] && tags[i + 1][0] === 20) ? Number(tags[++i][1]) : 0; e.vertices.push({ x: Number(v), y }); }
    }
    return e;
}
// MULTILEADER: 引出の線（LEADER_LINE{ の 10）・最後の点（LEADER{ の 10）・水平の線（11 の向き × 40 の長さ）・文字（304・12・41・42）
function dxfMleaderFromTags(type, tags) {
    const m = Object.assign(_dxfCommon(type, tags), { type: 'MULTILEADER', leaders: [], text: '', textPos: null, textH: 0, arrow: 0, textRot: 0 });
    const sec = [];
    let curLeader = null, curLine = null;
    for(let i = 0; i < tags.length; i++) {
        const [c, v] = tags[i];
        if(c === 300 && v === 'CONTEXT_DATA{') { sec.push('ctx'); continue; }
        if(c === 302 && v === 'LEADER{') { sec.push('leader'); curLeader = { lines: [], last: null, dog: null, dogLen: 0 }; m.leaders.push(curLeader); continue; }
        if(c === 304 && v === 'LEADER_LINE{') { sec.push('line'); curLine = []; if(curLeader) curLeader.lines.push(curLine); continue; }
        if((c === 301 || c === 303 || c === 305) && String(v).trim() === '}') { sec.pop(); if(c === 305) curLine = null; if(c === 303) curLeader = null; continue; }
        const top = sec[sec.length - 1];
        const xy = () => { const x = Number(v); let y = 0; if(tags[i + 1] && tags[i + 1][0] === c + 10) y = Number(tags[++i][1]); if(tags[i + 1] && tags[i + 1][0] === c + 20) i++; return { x, y }; };
        if(top === 'line') { if(c === 10 && curLine) curLine.push(xy()); }
        else if(top === 'leader') { if(c === 10) curLeader.last = xy(); else if(c === 11) curLeader.dog = xy(); else if(c === 40) curLeader.dogLen = Number(v); }
        else if(top === 'ctx') {
            if(c === 304) m.text = String(v);
            else if(c === 12) m.textPos = xy();
            else if(c === 41 && !m.textH) m.textH = Number(v);
            else if(c === 140 && !m.arrow) m.arrow = Number(v);
            else if(c === 42) m.textRot = Number(v);
        }
    }
    return m;
}
// 読めない図形: 名前と共通の値だけ持たせ、取り込むときに「取り込めなかった図形」として数える。
// 弧長寸法・折り曲げ半径寸法は、寸法のブロック（2）があれば寸法と同じように広げる
function dxfUnknownFromTags(type, tags) {
    const e = _dxfCommon(type, tags);
    if(type === 'ARC_DIMENSION' || type === 'LARGE_RADIAL_DIMENSION') {
        const b = tags.find(([c]) => c === 2);
        if(b) { e.dimType = type; e.type = 'DIMENSION'; e.block = String(b[1]); }
    }
    return e;
}
// DXF の ENTITIES・BLOCKS にある図形の名前を集める（読めない図形も数えるため）
function dxfEntityNames(text) {
    const names = new Set();
    const lines = String(text).split(/\r\n|\r|\n/);
    let sec = null;
    for(let i = 0; i + 1 < lines.length; i += 2) {
        if(lines[i].trim() !== '0') continue;
        const v = lines[i + 1].trim();
        if(v === 'SECTION') { const nm = lines[i + 3] && lines[i + 3].trim(); sec = (nm === 'ENTITIES' || nm === 'BLOCKS') ? nm : null; continue; }
        if(v === 'ENDSEC') { sec = null; continue; }
        if(sec && v && !['BLOCK', 'ENDBLK', 'SEQEND', 'VERTEX', 'EOF'].includes(v)) names.add(v);
    }
    return names;
}
// 塗りつぶし・引出線・マルチ引出線と、ファイルにある読めない図形のハンドラを登録する（text が無ければ、読めない図形の分は省く）
function registerShapeDxfHandlers(parser, text) {
    parser.registerEntityHandler(_dxfTagHandler('HATCH', dxfHatchFromTags));
    parser.registerEntityHandler(_dxfTagHandler('LEADER', dxfLeaderFromTags));
    parser.registerEntityHandler(_dxfTagHandler('MULTILEADER', dxfMleaderFromTags));
    parser.registerEntityHandler(_dxfTagHandler('MLEADER', dxfMleaderFromTags));
    parser.registerEntityHandler(_dxfTagHandler('TRACE', (t, tags) => Object.assign(_dxfCommon(t, tags), { type: 'SOLID', points: _dxfCorners(tags) })));
    if(!text) return;
    const known = parser._entityHandlers || {};
    dxfEntityNames(text).forEach(nm => { if(!known[nm]) parser.registerEntityHandler(_dxfTagHandler(nm, dxfUnknownFromTags)); });
}
// SOLID・TRACE の4つの角（10〜13）
function _dxfCorners(tags) {
    const pts = [];
    for(let i = 0; i < tags.length; i++) {
        const c = tags[i][0];
        if(c >= 10 && c <= 13) { const y = (tags[i + 1] && tags[i + 1][0] === c + 10) ? Number(tags[i + 1][1]) : 0; pts[c - 10] = { x: Number(tags[i][1]), y }; }
    }
    return pts.filter(Boolean);
}

// ===== DXF・DWG 共通: 取り込んだ図形を作る =====
// 引出線: 折れ線と、始めの点の矢印（塗りの三角）。pts は図面の座標
function makeImportedLeader(pts, base, size, arrow) {
    const clean = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0);
    if(clean.length < 2) return [];
    const out = [Object.assign({}, base, { type: 'PLINE', points: clean, closed: false })];
    if(arrow !== false) { const a = importArrowHead(clean[0], clean[1], size, base); if(a) out.push(a); }
    return out;
}
// 矢印（塗りの三角）。先 tip、根もと側の点 from、長さ size（線の半分より長くしない）。幅は長さの 1/3
function importArrowHead(tip, from, size, base) {
    const dx = tip.x - from.x, dy = tip.y - from.y, L = Math.hypot(dx, dy);
    if(!(L > 0) || !(size > 0)) return null;
    const s = Math.min(size, L * 0.5), ux = dx / L, uy = dy / L, w = s / 6;
    const bx = tip.x - ux * s, by = tip.y - uy * s;
    return Object.assign({}, base, { type: 'HATCH', imp: 1, arrow: 1, target: { type: 'PLINE', closed: true, points: [{ x: tip.x, y: tip.y }, { x: bx - uy * w, y: by + ux * w }, { x: bx + uy * w, y: by - ux * w }] } });
}
// マルチ引出線: 引出の線ごとに折れ線（最後の点まで）と矢印、水平の線、文字。xf は点・向きの写し方
function makeImportedMleader(m, xf, base, rot) {
    const out = [];
    const size = (m.arrow > 0 ? m.arrow : (typeof _importDimTxt !== 'undefined' ? (_importDimTxt.asz || _importDimTxt.h) : 2.5)) * xf.k;
    (m.leaders || []).forEach(ld => {
        (ld.lines || []).forEach(line => {
            const pts = line.concat(ld.last ? [ld.last] : []).map(p => xf.pt(p.x, p.y));
            makeImportedLeader(pts, base, size, true).forEach(e => out.push(e));
        });
        if(ld.last && ld.dog && ld.dogLen > 0) {
            const a = xf.pt(ld.last.x, ld.last.y), b = xf.pt(ld.last.x + ld.dog.x * ld.dogLen, ld.last.y + ld.dog.y * ld.dogLen);
            out.push(Object.assign({}, base, { type: 'LINE', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        }
    });
    const text = m.text ? _cleanCadMtext(m.text) : '';
    if(text && m.textPos) {
        const p = xf.pt(m.textPos.x, m.textPos.y);
        out.push(Object.assign({}, base, { type: 'TEXT', x: p.x, y: p.y, text, height: (m.textH > 0 ? m.textH : 2.5) * xf.k, rotation: (m.textRot || 0) + (rot || 0), halign: 'left', valign: 'top' }));
    }
    return out;
}
