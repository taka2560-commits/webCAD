// ===== Web CAD 寸法記入モジュール =====
// cad-dimension.js - 6種類の寸法コマンドと描画 + 寸法編集

const DIM_COLOR = '#00FFFF';
const DIM_TEXT_SIZE = 16;   // スクリーンピクセル（オプション「寸法の文字」で倍率を掛ける: dimSizePx）
const DIM_ARROW_SIZE = 10;   // スクリーンピクセル（同上）
const DIM_EXT_OVERSHOOT = 5; // 補助線のオーバーシュート(px)
const DIM_EXT_GAP = 3;      // 補助線の測定点からの隙間(px)

// ===== 寸法値フォーマット =====
// 以前は常に整数へ丸めていたため、1単位＝1m の図面では 12.345m が「12」になっていた。
// 既定（自動）は小数3桁まで表示し、末尾の0は省く（mm の図面の 1500 は「1500」のまま）。
// オプション「寸法の桁」で 1 / 0.1 / 0.01 / 0.001 に固定できる。
// 値はオプション「長さの単位」（座標寸法は「座標の単位」）に換算して出す（cad-prefs.js）
function dimFormat(val) {
    if(typeof val !== 'number' || !isFinite(val)) return '';
    return formatDimNumber(toDisplayUnit(val, 'len'), displayUnit('len'));
}
// 座標の値（座標寸法・原点などの記録）。mm の図面では整数の mm（「自動」のとき）
function dimFormatCoord(val) {
    if(typeof val !== 'number' || !isFinite(val)) return '';
    return formatDimNumber(toDisplayUnit(val, 'coord'), displayUnit('coord'));
}
// 角度寸法の文字（オプション「角度の表示」: 度は小数1桁、度分秒は秒まで）
function dimFormatAngle(deg) { return angleIsDms() ? formatDmsAngle(deg) : deg.toFixed(1) + '°'; }

// 基点測定で記入した寸法（測定の表示と同じ桁: m は小数3桁、mm は整数）
function _isMeasDim(e) { return !!e && (e.meas === true || e.blockName === '測定'); }
// 平行・整列寸法の文字。文字上書きがあればそれを使う。
// 以前の版は、1単位＝1m の図面で記入した測定の寸法の文字を「12.345」と固定していた。
// 値と同じ文字なら固定していないものとして扱い、単位・桁の設定に合わせる
function dimLengthText(e, override, value) {
    const meas = _isMeasDim(e);
    if(override && !(meas && override === value.toFixed(3))) return override;
    return meas ? measFormatLength(value) : dimFormat(value);
}

// ===== 矢印描画 =====
function drawArrowHead(cx, cy, angle, size) {
    ctx.save(); ctx.fillStyle = ctx.strokeStyle;
    ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-size, size/3); ctx.lineTo(-size, -size/3); ctx.closePath(); ctx.fill();
    ctx.restore();
}

// ===== 寸法テキスト描画 =====
function drawDimText(text, x, y, angle, color) {
    const px = dimSizePx(DIM_TEXT_SIZE);
    ctx.save(); ctx.fillStyle = color || ctx.strokeStyle || DIM_COLOR; ctx.font = outdoorFontWeight() + px + 'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.translate(x, y);
    let a = angle || 0;
    while(a > Math.PI) a -= Math.PI * 2;
    while(a <= -Math.PI) a += Math.PI * 2;
    if(a > Math.PI/2 - 1e-9 || a < -Math.PI/2 - 1e-9) a += Math.PI; // 逆さま・上から下へ読む向きにしない
    ctx.rotate(a);
    outdoorTextHalo(ctx, text, 0, -3, px); // 屋外モードでは太字＋縁取り
    ctx.fillText(text, 0, -3);
    ctx.restore();
}

// ===== 共通：描画ヒット記録 =====
function _addHitSeg(e, sc1, sc2) { if(e){ if(!e._hits) e._hits=[]; e._hits.push({type:'seg', p1:sc1, p2:sc2}); } }
function _addHitCircle(e, sc, radiusPx) { if(e){ if(!e._hits) e._hits=[]; e._hits.push({type:'circle', c:sc, r:radiusPx}); } }
function _addHitText(e, sc) { if(e){ if(!e._hits) e._hits=[]; e._hits.push({type:'text', p:sc}); } }

// ===== 平行寸法・整列寸法の形（図面の座標で組み立てる） =====
// 以前は画面の縦横で描いていたため、画面を回転（PLAN）すると寸法線の向きがずれていた。
// 図面の座標で形を作り、画面に写すので、画面の回転・回転コマンド・DXF出力で同じ形になる。
//   u: 測る向き、n: 寸法線をずらす向き（offset の正の向き）
//   平行寸法（LINEAR）: 横(H) u=(1,0) n=(0,1)、縦(V) u=(0,1) n=(1,0)。回転コマンドで回した分（dimRot）だけ両方を回す
//   整列寸法（ALIGNED）: u = 1点目→2点目、n = u の右側
function _dimLineFrame(kind, p1, p2, dimDir, rot) {
    if(kind === 'ALIGNED') {
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
        const u = { x: dx / len, y: dy / len };
        return { u, n: { x: u.y, y: -u.x } };
    }
    const H = (dimDir === 'H') || (!dimDir && Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y));
    let u = H ? { x: 1, y: 0 } : { x: 0, y: 1 }, n = H ? { x: 0, y: 1 } : { x: 1, y: 0 };
    if(rot) {
        const c = Math.cos(rot), s = Math.sin(rot), R = (v) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
        u = R(u); n = R(n);
    }
    return { u, n };
}
// k: 画面の1pxが図面の何単位か（画面: 1/view.scale、DXF出力: 文字の高さに合わせる）
function dimLinePrims(kind, p1, p2, offset, dimDir, rot, k) {
    const { u, n } = _dimLineFrame(kind, p1, p2, dimDir, rot);
    const along = (p2.x - p1.x) * u.x + (p2.y - p1.y) * u.y;
    const dl1 = { x: p1.x + offset * n.x, y: p1.y + offset * n.y };
    const dl2 = { x: dl1.x + along * u.x, y: dl1.y + along * u.y };
    const lines = [];
    // 補助線: 測った点の少し先（隙間）から、寸法線を少し越えるところまで
    const ext = (p, dl) => {
        const t = (dl.x - p.x) * n.x + (dl.y - p.y) * n.y;
        if(Math.abs(t) < 1e-12) return;
        const sg = Math.sign(t);
        lines.push({ x1: p.x + n.x * sg * DIM_EXT_GAP * k, y1: p.y + n.y * sg * DIM_EXT_GAP * k,
                     x2: dl.x + n.x * sg * DIM_EXT_OVERSHOOT * k, y2: dl.y + n.y * sg * DIM_EXT_OVERSHOOT * k });
    };
    ext(p1, dl1); ext(p2, dl2);
    const dirA = Math.atan2(dl2.y - dl1.y, dl2.x - dl1.x);
    return {
        lines, dim: { x1: dl1.x, y1: dl1.y, x2: dl2.x, y2: dl2.y },
        arrows: [{ x: dl1.x, y: dl1.y, a: dirA }, { x: dl2.x, y: dl2.y, a: dirA + Math.PI }], // a: 矢印の先が向く方向
        textAt: { x: (dl1.x + dl2.x) / 2, y: (dl1.y + dl2.y) / 2 }, textAngle: dirA,
        value: kind === 'ALIGNED' ? Math.hypot(p2.x - p1.x, p2.y - p1.y) : Math.abs(along),
    };
}
function _drawDimLineCore(kind, p1, p2, offset, dimDir, color, textOverride, e) {
    if(e) e._hits = [];
    const resolvedColor = outdoorColor(color || getEntityColor(e) || DIM_COLOR); // 屋外モードでは背景との明るさの差を広げる
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = lineWidthPx(1);
    const P = dimLinePrims(kind, p1, p2, offset, dimDir, e && e.dimRot, 1 / (view.scale || 1));
    const rot = view.rotation || 0;
    P.lines.forEach(l => { const a = wcsToScreen(l.x1, l.y1), b = wcsToScreen(l.x2, l.y2); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    const d1 = wcsToScreen(P.dim.x1, P.dim.y1), d2 = wcsToScreen(P.dim.x2, P.dim.y2);
    ctx.beginPath(); ctx.moveTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.stroke();
    _addHitSeg(e, d1, d2);
    P.arrows.forEach(ar => { const s = wcsToScreen(ar.x, ar.y); drawArrowHead(s.x, s.y, -(ar.a + rot), dimSizePx(DIM_ARROW_SIZE)); });
    const t = wcsToScreen(P.textAt.x, P.textAt.y);
    drawDimText(dimLengthText(e, textOverride, P.value), t.x, t.y, -(P.textAngle + rot), resolvedColor);
    _addHitText(e, t);
}
// ===== 共通：DIMLINEAR描画ロジック =====
function _drawDimLinearCore(p1, p2, offset, dimDir, color, textOverride, e) { _drawDimLineCore('LINEAR', p1, p2, offset, dimDir, color, textOverride, e); }
// ===== 共通：DIMALIGNED描画ロジック =====
function _drawDimAlignedCore(p1, p2, offset, color, textOverride, e) { _drawDimLineCore('ALIGNED', p1, p2, offset, null, color, textOverride, e); }

// ===== 共通：DIMRADIUS描画ロジック =====
function _drawDimRadiusCore(center, radius, angle, color, textOverride, e) {
    if(e) e._hits = [];
    const resolvedColor = outdoorColor(color || getEntityColor(e) || DIM_COLOR); // 屋外モードでは背景との明るさの差を広げる
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = lineWidthPx(1);
    const sc = wcsToScreen(center.x, center.y);
    const a = angle || 0;
    const ep = wcsToScreen(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a));
    ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
    _addHitSeg(e, sc, ep);
    const ang = Math.atan2(ep.y - sc.y, ep.x - sc.x);
    drawArrowHead(ep.x, ep.y, ang + Math.PI, dimSizePx(DIM_ARROW_SIZE));
    const tx = (sc.x+ep.x)/2, ty = (sc.y+ep.y)/2;
    drawDimText(textOverride || ('R' + dimFormat(radius)), tx, ty, ang, resolvedColor);
    _addHitText(e, {x:tx, y:ty});
}

// ===== 共通：DIMDIAMETER描画ロジック =====
function _drawDimDiameterCore(center, radius, angle, color, textOverride, e) {
    if(e) e._hits = [];
    const resolvedColor = outdoorColor(color || getEntityColor(e) || DIM_COLOR); // 屋外モードでは背景との明るさの差を広げる
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = lineWidthPx(1);
    const sc = wcsToScreen(center.x, center.y);
    const a = angle || 0;
    const ep1 = wcsToScreen(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a));
    const ep2 = wcsToScreen(center.x - radius * Math.cos(a), center.y - radius * Math.sin(a));
    ctx.beginPath(); ctx.moveTo(ep1.x, ep1.y); ctx.lineTo(ep2.x, ep2.y); ctx.stroke();
    _addHitSeg(e, ep1, ep2);
    const ang = Math.atan2(ep1.y - ep2.y, ep1.x - ep2.x);
    drawArrowHead(ep1.x, ep1.y, ang + Math.PI, dimSizePx(DIM_ARROW_SIZE));
    drawArrowHead(ep2.x, ep2.y, ang, dimSizePx(DIM_ARROW_SIZE));
    drawDimText(textOverride || ('⌀' + dimFormat(radius*2)), sc.x, sc.y, ang, resolvedColor);
    _addHitText(e, {x:sc.x, y:sc.y});
}

// ===== 共通：DIMORDINATE描画ロジック（単一引出線タイプ） =====
function _drawDimOrdinateCore(point, leaderCoord, color, textOverride, e) {
    if(e) e._hits = [];
    ctx.strokeStyle = outdoorColor(color || getEntityColor(e) || DIM_COLOR); ctx.lineWidth = lineWidthPx(1);
    
    // WCS -> Screen 変換 (ここではview.rotationの影響を含む)
    const sp = wcsToScreen(point.x, point.y);
    const sl = wcsToScreen(leaderCoord.x, leaderCoord.y);
    const ucsCoord = wcsToUcs(point.x, point.y);

    // 引出線の描画（sp から sl まで行き、そこから水平な下線を引く）
    // 文字が右に配置されるか左に配置されるかを決定
    const textSide = (sl.x >= sp.x) ? 1 : -1;
    const dk = dimSizePx(DIM_TEXT_SIZE) / DIM_TEXT_SIZE; // 文字の大きさの設定（倍率）
    const lineEnd = {x: sl.x + textSide * 80 * dk, y: sl.y}; // 下線の長さ: 80px（文字に合わせて伸縮）

    ctx.beginPath(); 
    ctx.moveTo(sp.x, sp.y); 
    ctx.lineTo(sl.x, sl.y); 
    ctx.lineTo(lineEnd.x, lineEnd.y); 
    ctx.stroke();

    _addHitSeg(e, sp, sl);
    _addHitSeg(e, sl, lineEnd);

    // テキスト内容
    const txtX = `X: ${dimFormatCoord(ucsCoord.y)}`; // 測量X座標 (数学Y)
    const txtY = `Y: ${dimFormatCoord(ucsCoord.x)}`; // 測量Y座標 (数学X)

    // テキストは下線の中央、少し上に配置（wcsToScreen で画面の回転は済んでいるので、文字は画面に水平）。
    // 以前は ctx.save() が2回で ctx.restore() が1回だったため、描画の状態が戻らなかった。
    // 作図中のプレビューでは点線の設定が残り、そのあと図面の線がすべて点線で描かれていた
    ctx.save();
    ctx.translate(sl.x + textSide * 40 * dk, sl.y - 4);
    const tpx = dimSizePx(DIM_TEXT_SIZE);
    ctx.font = outdoorFontWeight() + tpx + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';

    // 現場で読みやすいように色分け（屋外モードでは太字＋縁取り、背景との明るさの差を広げる）
    const yX = -Math.round(14 * dk);
    outdoorTextHalo(ctx, txtX, 0, yX, tpx); ctx.fillStyle = outdoorColor('#00ff88'); ctx.fillText(txtX, 0, yX); // 上段 (X)
    outdoorTextHalo(ctx, txtY, 0, 0, tpx); ctx.fillStyle = outdoorColor('#00ffff'); ctx.fillText(txtY, 0, 0);   // 下段 (Y)
    ctx.restore();

    _addHitText(e, {x: sl.x + textSide * 40 * dk, y: sl.y - 10});
}

// 角度寸法の形: 辺1の角度 a1 と、辺1から辺2までの小さい方の回転 d（-π〜π、反時計回りが正）
function dimAngularGeom(e) {
    const a1 = Math.atan2(e.arm1.y - e.vertex.y, e.arm1.x - e.vertex.x);
    const a2 = Math.atan2(e.arm2.y - e.vertex.y, e.arm2.x - e.vertex.x);
    let d = a2 - a1;
    while(d > Math.PI) d -= Math.PI * 2;
    while(d <= -Math.PI) d += Math.PI * 2;
    return { a1, d };
}

// ===== DXF出力用: 寸法を「図面の座標の線・弧・矢印・文字」に分ける =====
// 画面と同じ形にする。k は画面の1pxが図面の何単位か（DXFでは文字の高さに合わせて決める）
// 文字の向きは、図面の座標で逆さまにならない向き（-90°より大きく90°以下）にそろえる
function _dimUpright(a) {
    while(a > Math.PI) a -= Math.PI * 2;
    while(a <= -Math.PI) a += Math.PI * 2;
    if(a > Math.PI / 2 + 1e-9) a -= Math.PI;
    else if(a <= -Math.PI / 2 + 1e-9) a += Math.PI;
    return a;
}
function dimExportPrims(e, k) {
    const out = { lines: [], arcs: [], arrows: [], texts: [] };
    const th = dimSizePx(DIM_TEXT_SIZE) * k, as = dimSizePx(DIM_ARROW_SIZE) * k;
    // 線の上（画面の3px）に、線の向きの文字を置く
    const textOn = (s, x, y, ang) => {
        const a = _dimUpright(ang);
        out.texts.push({ s, x: x - Math.sin(a) * 3 * k, y: y + Math.cos(a) * 3 * k, h: th, ang: a, ha: 'center', va: 'bottom' });
    };
    const arrow = (x, y, a) => out.arrows.push({ x, y, a, size: as });
    const st = e.subType;
    if(st === 'LINEAR' || st === 'ALIGNED') {
        const P = dimLinePrims(st, e.p1, e.p2, e.offset ?? 30, e.dimDir, e.dimRot, k);
        out.lines.push(...P.lines, P.dim);
        P.arrows.forEach(a => arrow(a.x, a.y, a.a));
        textOn(dimLengthText(e, e.textOverride, P.value), P.textAt.x, P.textAt.y, P.textAngle);
    } else if(st === 'RADIUS' || st === 'DIAMETER') {
        const c = e.center, r = e.radius, a0 = e.angle || 0, cs = Math.cos(a0), sn = Math.sin(a0);
        const ep = { x: c.x + r * cs, y: c.y + r * sn };
        if(st === 'RADIUS') {
            out.lines.push({ x1: c.x, y1: c.y, x2: ep.x, y2: ep.y });
            arrow(ep.x, ep.y, a0 + Math.PI);
            textOn(e.textOverride || ('R' + dimFormat(r)), (c.x + ep.x) / 2, (c.y + ep.y) / 2, a0);
        } else {
            const ep2 = { x: c.x - r * cs, y: c.y - r * sn };
            out.lines.push({ x1: ep2.x, y1: ep2.y, x2: ep.x, y2: ep.y });
            arrow(ep.x, ep.y, a0 + Math.PI); arrow(ep2.x, ep2.y, a0);
            textOn(e.textOverride || ('⌀' + dimFormat(r * 2)), c.x, c.y, a0);
        }
    } else if(st === 'ANGULAR') {
        const v = e.vertex, R = e.arcRadius || 40, g = dimAngularGeom(e), ae = g.a1 + g.d;
        out.lines.push({ x1: v.x, y1: v.y, x2: e.arm1.x, y2: e.arm1.y }, { x1: v.x, y1: v.y, x2: e.arm2.x, y2: e.arm2.y });
        // DXF の円弧は反時計回り（開始角→終了角）
        out.arcs.push({ cx: v.x, cy: v.y, r: R, sa: g.d > 0 ? g.a1 : ae, ea: g.d > 0 ? ae : g.a1 });
        const s = g.d > 0 ? 1 : -1;
        arrow(v.x + R * Math.cos(g.a1), v.y + R * Math.sin(g.a1), g.a1 - s * Math.PI / 2);
        arrow(v.x + R * Math.cos(ae), v.y + R * Math.sin(ae), ae + s * Math.PI / 2);
        const am = g.a1 + g.d / 2;
        out.texts.push({ s: e.textOverride || dimFormatAngle(Math.abs(g.d) * 180 / Math.PI), x: v.x + R * Math.cos(am), y: v.y + R * Math.sin(am) + 3 * k, h: th, ang: 0, ha: 'center', va: 'bottom' });
    } else if(st === 'ORDINATE') {
        const p = e.point, u = wcsToUcs(p.x, p.y), L = e.leaderCoord || e.leaderX;
        if(L) {
            // 引出線と下線。文字は下線の上に2段（上: X＝北、下: Y＝東）
            const dk = dimSizePx(DIM_TEXT_SIZE) / DIM_TEXT_SIZE, side = (L.x >= p.x) ? 1 : -1;
            out.lines.push({ x1: p.x, y1: p.y, x2: L.x, y2: L.y }, { x1: L.x, y1: L.y, x2: L.x + side * 80 * dk * k, y2: L.y });
            const cx = L.x + side * 40 * dk * k;
            if(e.textOverride) out.texts.push({ s: e.textOverride, x: cx, y: L.y + 4 * k, h: th, ang: 0, ha: 'center', va: 'bottom' });
            else {
                out.texts.push({ s: 'X: ' + dimFormatCoord(u.y), x: cx, y: L.y + (4 + 14 * dk) * k, h: th, ang: 0, ha: 'center', va: 'bottom' });
                out.texts.push({ s: 'Y: ' + dimFormatCoord(u.x), x: cx, y: L.y + 4 * k, h: th, ang: 0, ha: 'center', va: 'bottom' });
            }
        } else if(e.leader) {
            // 旧形式（X か Y の片方だけ）
            const mid = e.isX ? { x: p.x, y: e.leader.y } : { x: e.leader.x, y: p.y };
            out.lines.push({ x1: p.x, y1: p.y, x2: mid.x, y2: mid.y }, { x1: mid.x, y1: mid.y, x2: e.leader.x, y2: e.leader.y });
            const s = e.textOverride || (e.isX ? 'Y=' + dimFormatCoord(u.x) : 'X=' + dimFormatCoord(u.y));
            out.texts.push({ s, x: e.leader.x, y: e.leader.y + 3 * k, h: th, ang: 0, ha: 'center', va: 'bottom' });
        }
    }
    return out;
}
// DXF の寸法の文字の高さ（図面の単位）: 図面全体の大きさの約1/60 を、1・2・2.5・5 の切りのよい値にする
function dimExportTextHeight() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    entities.forEach(e => {
        let b;
        try { b = e.bbox || calcBBox(e); } catch { b = null; }
        if(!b || !isFinite(b.minX) || !isFinite(b.maxX)) return;
        minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    });
    const ext = Math.max(maxX - minX, maxY - minY);
    if(!(ext > 0) || !isFinite(ext)) return 2.5;
    const raw = ext / 60, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m >= 5 ? 5 : m >= 2.5 ? 2.5 : m >= 2 ? 2 : 1) * p;
}

// ===== 寸法タイプ別描画（エンティティから呼ばれる） =====
function drawDimLinear(e, color) { _drawDimLinearCore(e.p1, e.p2, e.offset ?? 30, e.dimDir, color||e.color, e.textOverride, e); }
function drawDimAligned(e, color) { _drawDimAlignedCore(e.p1, e.p2, e.offset ?? 30, color||e.color, e.textOverride, e); }
function drawDimRadius(e, color) { _drawDimRadiusCore(e.center, e.radius, e.angle, color||e.color, e.textOverride, e); }
function drawDimDiameter(e, color) { _drawDimDiameterCore(e.center, e.radius, e.angle, color||e.color, e.textOverride, e); }

function drawDimAngular(e, color) {
    if(e) e._hits = [];
    const resolvedColor = outdoorColor(color || getEntityColor(e) || DIM_COLOR); // 屋外モードでは背景との明るさの差を広げる
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = lineWidthPx(1);
    const sv = wcsToScreen(e.vertex.x, e.vertex.y);
    const sa1 = wcsToScreen(e.arm1.x, e.arm1.y), sa2 = wcsToScreen(e.arm2.x, e.arm2.y);
    ctx.beginPath(); ctx.moveTo(sv.x, sv.y); ctx.lineTo(sa1.x, sa1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sv.x, sv.y); ctx.lineTo(sa2.x, sa2.y); ctx.stroke();
    const rot = view.rotation || 0; // 画面上の角度 = -(図面の角度 + 画面の回転)
    const angle1 = -(Math.atan2(e.arm1.y - e.vertex.y, e.arm1.x - e.vertex.x) + rot);
    const arcR = (e.arcRadius || 40) * view.scale;
    // 2本の辺の間の小さい方の角に弧を描く（以前は辺を選んだ順によって反対側の大きな弧になっていた）
    const g = dimAngularGeom(e);
    const sweepCanvas = -g.d; // 図面の反時計回り = 画面の反時計回り（キャンバスの角度は逆向き）
    ctx.beginPath(); ctx.arc(sv.x, sv.y, arcR, angle1, angle1 + sweepCanvas, g.d > 0); ctx.stroke();
    const angle2b = angle1 + sweepCanvas, dirS = g.d > 0 ? 1 : -1;
    drawArrowHead(sv.x + arcR*Math.cos(angle1), sv.y + arcR*Math.sin(angle1), angle1 + dirS * Math.PI/2, dimSizePx(DIM_ARROW_SIZE));
    drawArrowHead(sv.x + arcR*Math.cos(angle2b), sv.y + arcR*Math.sin(angle2b), angle2b - dirS * Math.PI/2, dimSizePx(DIM_ARROW_SIZE));
    const text = e.textOverride || dimFormatAngle(Math.abs(g.d) * 180 / Math.PI);
    const midA = angle1 + sweepCanvas / 2;
    const tx = sv.x + arcR*Math.cos(midA), ty = sv.y + arcR*Math.sin(midA);
    drawDimText(text, tx, ty, 0, resolvedColor);
    
    _addHitSeg(e, sv, sa1); _addHitSeg(e, sv, sa2);
    _addHitCircle(e, sv, arcR);
    _addHitText(e, {x:tx, y:ty});
}

function drawDimOrdinate(e, color) {
    const leaderCoord = e.leaderCoord || e.leaderX;
    if(leaderCoord) {
        _drawDimOrdinateCore(e.point, leaderCoord, color||e.color, e.textOverride, e);
        return;
    }
    // 旧形式互換（leader + isX で保存されたデータ）
    if(e.leader) {
        if(e) e._hits = [];
        const resolvedColor = outdoorColor(color || getEntityColor(e) || DIM_COLOR); // 屋外モードでは背景との明るさの差を広げる
        ctx.strokeStyle = resolvedColor; ctx.lineWidth = lineWidthPx(1);
        const sp = wcsToScreen(e.point.x, e.point.y);
        const sl = wcsToScreen(e.leader.x, e.leader.y);
        const ucsC = wcsToUcs(e.point.x, e.point.y);
        if(e.isX) {
            const mid = {x: sp.x, y: sl.y};
            ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(mid.x, mid.y); ctx.lineTo(sl.x, sl.y); ctx.stroke();
            drawDimText('Y=' + dimFormatCoord(ucsC.x), sl.x, sl.y, 0, resolvedColor);
            _addHitSeg(e, sp, mid); _addHitSeg(e, mid, sl); _addHitText(e, sl);
        } else {
            const mid = {x: sl.x, y: sp.y};
            ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(mid.x, mid.y); ctx.lineTo(sl.x, sl.y); ctx.stroke();
            drawDimText('X=' + dimFormatCoord(ucsC.y), sl.x, sl.y, 0, resolvedColor);
            _addHitSeg(e, sp, mid); _addHitSeg(e, mid, sl); _addHitText(e, sl);
        }
    }
}

// ===== 全寸法描画（cad-core.jsから呼ばれる） =====
function drawAllDimensions() {
    ctx.save();
    const hlIdx = cmdState.highlightIdx;
    entities.forEach((e, i) => {
        if(e.type !== 'DIMENSION') return;

        const lyrVisible = e.layer === undefined || !layers[e.layer] || layers[e.layer].visible;
        const entityVisible = !e.hidden;

        if (!entityVisible) return;
        if (!lyrVisible && !window.ghostLayerMode) return; // ghostLayerModeがOFFで画層非表示なら描画をスキップ

        ctx.save();
        if (!lyrVisible) {
            ctx.globalAlpha = 0.15; // 非表示レイヤーの寸法はうっすら表示
        }

        const color = i === hlIdx ? '#ff6b6b' : null;
        if(e.subType === 'LINEAR') drawDimLinear(e, color);
        else if(e.subType === 'ALIGNED') drawDimAligned(e, color);
        else if(e.subType === 'RADIUS') drawDimRadius(e, color);
        else if(e.subType === 'DIAMETER') drawDimDiameter(e, color);
        else if(e.subType === 'ANGULAR') drawDimAngular(e, color);
        else if(e.subType === 'ORDINATE') drawDimOrdinate(e, color);

        ctx.restore();
    });
    ctx.restore();
}

// ===== ゴムバンド（実際の寸法をリアルタイムプレビュー） =====
function drawDimRubberBand(mode, sw, mp) {
    ctx.save();
    ctx.globalAlpha = 0.6;

    if(mode === 'WAITING_DIMLIN_POS') {
        const p1 = cmdState.points[0], p2 = cmdState.points[1];
        const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
        const dimDir = dx >= dy ? 'H' : 'V';
        const offset = dimDir === 'H' ? (mp.y - (p1.y + p2.y)/2) : (mp.x - (p1.x + p2.x)/2);
        _drawDimLinearCore(p1, p2, offset, dimDir, DIM_COLOR, null);
    }
    else if(mode === 'WAITING_DIMALN_POS') {
        const p1 = cmdState.points[0], p2 = cmdState.points[1];
        const ddx = p2.x - p1.x, ddy = p2.y - p1.y, len = Math.sqrt(ddx*ddx+ddy*ddy) || 1;
        const nx = -ddy/len, ny = ddx/len;
        const offset = (mp.x - (p1.x+p2.x)/2)*nx + (mp.y - (p1.y+p2.y)/2)*ny;
        _drawDimAlignedCore(p1, p2, offset, DIM_COLOR, null);
    }
    else if(mode === 'WAITING_DIMRAD_POS' && cmdState.dimTarget) {
        const e = cmdState.dimTarget;
        const angle = Math.atan2(mp.y - e.cy, mp.x - e.cx);
        _drawDimRadiusCore({x:e.cx,y:e.cy}, e.radius, angle, DIM_COLOR, null);
    }
    else if(mode === 'WAITING_DIMDIA_POS' && cmdState.dimTarget) {
        const e = cmdState.dimTarget;
        const angle = Math.atan2(mp.y - e.cy, mp.x - e.cx);
        _drawDimDiameterCore({x:e.cx,y:e.cy}, e.radius, angle, DIM_COLOR, null);
    }
    else if(mode === 'WAITING_DIMORD_LEADER') {
        const p = cmdState.points[0];
        _drawDimOrdinateCore(p, mp, DIM_COLOR, null);
    }
    // -- 寸法入力時の確定済みポイントマーカー（全寸法共通） --
    const markerPoints = (mode.startsWith('WAITING_DIMCONT_') && cmdState.dimContPoints) 
                         ? cmdState.dimContPoints 
                         : (mode.startsWith('WAITING_DIM') && cmdState.points ? cmdState.points : null);
    
    if(markerPoints && markerPoints.length > 0) {
        markerPoints.forEach((p, idx) => {
            const sm = wcsToScreen(p.x, p.y);
            // 外側のリング
            ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(sm.x, sm.y, 8, 0, Math.PI*2); ctx.stroke();
            ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2; ctx.stroke();
            // 数字の黒背景
            ctx.fillStyle = '#111';
            ctx.beginPath(); ctx.arc(sm.x, sm.y, 7, 0, Math.PI*2); ctx.fill();
            // 数字
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
            ctx.fillText(idx+1, sm.x, sm.y);
        });
    }

    // -- 寸法コマンドの1点目→2点目等の配置時の点線ラバーバンドプレビュー --
    if((mode === 'WAITING_DIMLIN_P2' || mode === 'WAITING_DIMALN_P2' || mode === 'WAITING_DIMANG_P2' || mode === 'WAITING_DIMANG_P3') && cmdState.points && cmdState.points.length > 0) {
        const p1m = wcsToScreen(cmdState.points[cmdState.points.length-1].x, cmdState.points[cmdState.points.length-1].y);
        const mps = wcsToScreen(mp.x, mp.y);
        ctx.setLineDash([4,4]); ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p1m.x, p1m.y); ctx.lineTo(mps.x, mps.y); ctx.stroke();
        ctx.setLineDash([]);
    }

    // -- DIMCONT (連続寸法) --
    if(mode === 'WAITING_DIMCONT_P2' && cmdState.dimContPoints && cmdState.dimContPoints.length > 0) {
        // 1点目からカーソルへの線分プレビュー
        const p1m = wcsToScreen(cmdState.dimContPoints[0].x, cmdState.dimContPoints[0].y);
        const mps = wcsToScreen(mp.x, mp.y);
        ctx.setLineDash([4,4]); ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p1m.x, p1m.y); ctx.lineTo(mps.x, mps.y); ctx.stroke();
        ctx.setLineDash([]);
    }
    else if(mode === 'WAITING_DIMCONT_POS' && cmdState.dimContPoints && cmdState.dimContPoints.length > 1) {
        // 1点目・2点目から配置位置へのプレビュー
        const p1 = cmdState.dimContPoints[0], p2 = cmdState.dimContPoints[1];
        const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
        const dimDir = cmdState.dimContDirMode === 'AUTO' ? (dx >= dy ? 'H' : 'V') : cmdState.dimContDirMode;
        const offset = dimDir === 'H' ? (mp.y - (p1.y + p2.y)/2) : (mp.x - (p1.x + p2.x)/2);
        _drawDimLinearCore(p1, p2, offset, dimDir, '#ffff00', null);
    }
    else if(mode === 'WAITING_DIMCONT_NEXT' && cmdState.dimContPoints && cmdState.dimContPoints.length > 1) {
        // 直列・並列プレビュー
        const pNew = {x:mp.x, y:mp.y};
        const p1 = cmdState.dimContPoints[0];
        const pts = cmdState.dimContPoints;
        const pPrev = pts[pts.length - 1];
        if(cmdState.dimContType === 'SERIAL') {
            const D_y = (p1.y + pts[1].y)/2 + cmdState.dimContBaseOffset;
            let newOff = D_y - (pPrev.y + pNew.y)/2;
            if(cmdState.dimContDir === 'V') {
                const D_x = (p1.x + pts[1].x)/2 + cmdState.dimContBaseOffset;
                newOff = D_x - (pPrev.x + pNew.x)/2;
            }
            _drawDimLinearCore(pPrev, pNew, newOff, cmdState.dimContDir, '#ffff00', null);
        } else {
            const PARALLEL_STEP = 25;
            const sign = cmdState.dimContBaseOffset >= 0 ? 1 : -1;
            const totalOff = cmdState.dimContBaseOffset + (PARALLEL_STEP * (cmdState.dimContLevel + 1) * sign);
            const D_y = (p1.y + pts[1].y)/2 + totalOff;
            let newOff = D_y - (p1.y + pNew.y)/2;
            if(cmdState.dimContDir === 'V') {
                const D_x = (p1.x + pts[1].x)/2 + totalOff;
                newOff = D_x - (p1.x + pNew.x)/2;
            }
            _drawDimLinearCore(p1, pNew, newOff, cmdState.dimContDir, '#ffff00', null);
        }
        
        // 次の点への点線プレビューも追加して「繋がっていること」を視覚化する
        const pr_sc = wcsToScreen(pPrev.x, pPrev.y);
        const mps = wcsToScreen(mp.x, mp.y);
        ctx.setLineDash([4,4]); ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pr_sc.x, pr_sc.y); ctx.lineTo(mps.x, mps.y); ctx.stroke();
        ctx.setLineDash([]);
    }
    else if((mode === 'WAITING_MOVE_DEST' || mode === 'WAITING_COPY_DEST') && cmdState.moveBase) {
        // 移動・コピーのプレビュー（複数選択対応）
        const dx = mp.x - cmdState.moveBase.x, dy = mp.y - cmdState.moveBase.y;
        _getMoveTargets().forEach(i => {
            const e = entities[i];
            if(e) drawMovePreview(e, dx, dy);
        });
    }

    ctx.globalAlpha = 1;
    ctx.restore();
}

// ===== 移動プレビュー描画 =====
function drawMovePreview(e, dx, dy) {
    ctx.setLineDash([4,4]); ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 1;
    if(e.type === 'LINE') {
        const a = wcsToScreen(e.x1+dx, e.y1+dy), b = wcsToScreen(e.x2+dx, e.y2+dy);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    } else if(e.type === 'CIRCLE') {
        const c = wcsToScreen(e.cx+dx, e.cy+dy);
        ctx.beginPath(); ctx.arc(c.x,c.y,e.radius*view.scale,0,Math.PI*2); ctx.stroke();
    } else if(e.type === 'ARC') {
        const c = wcsToScreen(e.cx+dx, e.cy+dy), rot = view.rotation || 0;
        ctx.beginPath(); ctx.arc(c.x,c.y,e.radius*view.scale,-e.startAngle-rot,-e.endAngle-rot,e.counterclockwise !== false); ctx.stroke();
    } else if(e.type === 'RECTANG') {
        // 4隅を結ぶ（画面が回転していても形どおりに出す）
        const q = [[e.x1,e.y1],[e.x2,e.y1],[e.x2,e.y2],[e.x1,e.y2]].map(([x,y]) => wcsToScreen(x+dx, y+dy));
        ctx.beginPath(); ctx.moveTo(q[0].x,q[0].y); for(let i=1;i<4;i++) ctx.lineTo(q[i].x,q[i].y); ctx.closePath(); ctx.stroke();
    } else if(e.type === 'PLINE' && e.points.length > 1) {
        ctx.beginPath();
        const f = wcsToScreen(e.points[0].x+dx, e.points[0].y+dy); ctx.moveTo(f.x,f.y);
        for(let i=1;i<e.points.length;i++){const p=wcsToScreen(e.points[i].x+dx,e.points[i].y+dy);ctx.lineTo(p.x,p.y);}
        if(e.closed) ctx.closePath(); ctx.stroke();
    } else if(e.type === 'ELLIPSE') {
        const c = wcsToScreen(e.cx+dx, e.cy+dy);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, e.rx*view.scale, e.ry*view.scale, -(e.rotation||0) - (view.rotation||0), 0, Math.PI*2); ctx.stroke();
    } else if(e.type === 'TEXT') {
        const p = wcsToScreen(e.x+dx, e.y+dy);
        ctx.save();
        ctx.font = `${(e.height||10)*view.scale}px sans-serif`; ctx.fillStyle = '#ffff00';
        ctx.translate(p.x, p.y); ctx.rotate(-((view.rotation||0) + (e.rotation||0))); // 本体の文字と同じ向き
        ctx.textAlign = (e.halign === 'center' || e.halign === 'right') ? e.halign : 'left';
        ctx.textBaseline = (e.valign === 'top') ? 'top' : (e.valign === 'middle') ? 'middle' : 'alphabetic';
        ctx.fillText(e.text, 0, 0);
        ctx.restore();
    } else if(e.type === 'POINT') {
        const p = wcsToScreen(e.x+dx, e.y+dy);
        ctx.beginPath(); ctx.moveTo(p.x-4,p.y); ctx.lineTo(p.x+4,p.y); ctx.moveTo(p.x,p.y-4); ctx.lineTo(p.x,p.y+4); ctx.stroke();
    } else if(e.type === 'HATCH' && e.target) {
        drawMovePreview(e.target, dx, dy);
    } else if(e.type === 'DIMENSION') {
        // 寸法の移動プレビュー
        drawDimMovePreview(e, dx, dy);
    }
    ctx.setLineDash([]);
}

function drawDimMovePreview(e, dx, dy) {
    if(e.subType === 'LINEAR' || e.subType === 'ALIGNED') {
        const p1m = {x:e.p1.x+dx, y:e.p1.y+dy}, p2m = {x:e.p2.x+dx, y:e.p2.y+dy};
        // 回した寸法（dimRot）の向きと、測定の寸法かどうか（文字の桁）だけ渡す。本体を渡すと当たり判定が移動先の位置に書き換わる
        const shape = { dimRot: e.dimRot, meas: _isMeasDim(e) };
        if(e.subType === 'LINEAR') _drawDimLinearCore(p1m, p2m, e.offset ?? 30, e.dimDir, '#ffff00', e.textOverride, shape);
        else _drawDimAlignedCore(p1m, p2m, e.offset ?? 30, '#ffff00', e.textOverride, shape);
    }
}

// ===== 寸法コマンドの入力処理 =====
function handleDimPointInput(mode, wcs) {
    // -- 基点測定 --
    if(mode === 'WAITING_DIMMEAS_BASE') { _measureStartFrom(wcs); return; }
    if(mode === 'WAITING_DIMMEAS_TO') { _measureLog(); return; } // 測定中は基点を動かさず、読み取った値を記録する
    // -- DIMLINEAR --
    if(mode === 'WAITING_DIMLIN_P1') {
        cmdState.points = [{x:wcs.x, y:wcs.y}]; cmdState.mode = 'WAITING_DIMLIN_P2'; setPrompt('2点目: (☑️確定)');
        const u = wcsToUcs(wcs.x,wcs.y);
        addCommandLog(`-> 1点目: (${dimFormatCoord(u.x)},${dimFormatCoord(u.y)})`); if(typeof render==='function') render(); return;
    }
    if(mode === 'WAITING_DIMLIN_P2') {
        cmdState.points.push({x:wcs.x, y:wcs.y}); cmdState.mode = 'WAITING_DIMLIN_POS'; setPrompt('寸法線位置 (☑️確定):');
        addCommandLog('-> 寸法線の位置を指定（リアルタイムプレビュー表示中）'); if(typeof render==='function') render(); return;
    }
    if(mode === 'WAITING_DIMLIN_POS') {
        const p1 = cmdState.points[0], p2 = cmdState.points[1];
        const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
        const dimDir = dx >= dy ? 'H' : 'V';
        const offset = dimDir === 'H' ? (wcs.y - (p1.y + p2.y)/2) : (wcs.x - (p1.x + p2.x)/2);
        saveUndo(); entities.push({type:'DIMENSION', subType:'LINEAR', layer:currentLayerIndex, color:null, p1:{x:p1.x,y:p1.y}, p2:{x:p2.x,y:p2.y}, offset:offset, dimDir:dimDir, textOverride:null});
        addCommandLog('-> 平行寸法作成'); cmdState.mode = 'WAITING_DIMLIN_P1'; cmdState.points = []; setPrompt('1点目: (☑️確定)'); if(typeof render==='function') render(); return;
    }
    // -- DIMALIGNED --
    if(mode === 'WAITING_DIMALN_P1') {
        cmdState.points = [{x:wcs.x, y:wcs.y}]; cmdState.mode = 'WAITING_DIMALN_P2'; setPrompt('2点目: (☑️確定)');
        addCommandLog('-> 1点目指定'); if(typeof render==='function') render(); return;
    }
    if(mode === 'WAITING_DIMALN_P2') {
        cmdState.points.push({x:wcs.x, y:wcs.y}); cmdState.mode = 'WAITING_DIMALN_POS'; setPrompt('寸法線位置 (☑️確定):');
        addCommandLog('-> 寸法線の位置を指定（リアルタイムプレビュー表示中）'); if(typeof render==='function') render(); return;
    }
    if(mode === 'WAITING_DIMALN_POS') {
        const p1 = cmdState.points[0], p2 = cmdState.points[1];
        const ddx = p2.x - p1.x, ddy = p2.y - p1.y, len = Math.sqrt(ddx*ddx+ddy*ddy) || 1;
        const nx = -ddy/len, ny = ddx/len;
        const offset = (wcs.x - (p1.x+p2.x)/2)*nx + (wcs.y - (p1.y+p2.y)/2)*ny;
        saveUndo(); entities.push({type:'DIMENSION', subType:'ALIGNED', layer:currentLayerIndex, color:null, p1:{x:p1.x,y:p1.y}, p2:{x:p2.x,y:p2.y}, offset:offset, textOverride:null});
        addCommandLog('-> 整列寸法作成'); cmdState.mode = 'WAITING_DIMALN_P1'; cmdState.points = []; setPrompt('1点目: (☑️確定)'); if(typeof render==='function') render(); return;
    }
    // -- DIMRADIUS --
    if(mode === 'WAITING_DIMRAD_SELECT') {
        const idx = hitTestCircleArc(mouse.screenX, mouse.screenY);
        if(idx >= 0 && (entities[idx].type === 'CIRCLE' || entities[idx].type === 'ARC')) {
            cmdState.dimTarget = entities[idx]; cmdState.mode = 'WAITING_DIMRAD_POS'; setPrompt('テキスト位置 (☑️確定):');
            addCommandLog('-> 円/弧を選択（リアルタイムプレビュー表示中）'); if(typeof render==='function') render();
        } else { addCommandLog('円または弧を選択して「☑️確定」を押してください'); }
        return;
    }
    if(mode === 'WAITING_DIMRAD_POS') {
        const e = cmdState.dimTarget;
        const angle = Math.atan2(wcs.y - e.cy, wcs.x - e.cx);
        saveUndo(); entities.push({type:'DIMENSION', subType:'RADIUS', layer:currentLayerIndex, color:null, center:{x:e.cx,y:e.cy}, radius:e.radius, angle:angle, textOverride:null});
        addCommandLog('-> 半径寸法作成'); cmdState.mode = 'WAITING_DIMRAD_SELECT'; cmdState.dimTarget = null; setPrompt('円/弧を選択: (☑️確定)'); if(typeof render==='function') render(); return;
    }
    // -- DIMDIAMETER --
    if(mode === 'WAITING_DIMDIA_SELECT') {
        const idx = hitTestCircleArc(mouse.screenX, mouse.screenY);
        if(idx >= 0 && (entities[idx].type === 'CIRCLE' || entities[idx].type === 'ARC')) {
            cmdState.dimTarget = entities[idx]; cmdState.mode = 'WAITING_DIMDIA_POS'; setPrompt('テキスト位置 (☑️確定):');
            addCommandLog('-> 円/弧を選択（リアルタイムプレビュー表示中）'); if(typeof render==='function') render();
        } else { addCommandLog('円または弧を選択して「☑️確定」を押してください'); }
        return;
    }
    if(mode === 'WAITING_DIMDIA_POS') {
        const e = cmdState.dimTarget;
        const angle = Math.atan2(wcs.y - e.cy, wcs.x - e.cx);
        saveUndo(); entities.push({type:'DIMENSION', subType:'DIAMETER', layer:currentLayerIndex, color:null, center:{x:e.cx,y:e.cy}, radius:e.radius, angle:angle, textOverride:null});
        addCommandLog('-> 直径寸法作成'); cmdState.mode = 'WAITING_DIMDIA_SELECT'; cmdState.dimTarget = null; setPrompt('円/弧を選択: (☑️確定)'); if(typeof render==='function') render(); return;
    }
    // -- DIMANGULAR --
    if(mode === 'WAITING_DIMANG_P1') {
        cmdState.points = [{x:wcs.x, y:wcs.y}]; cmdState.mode = 'WAITING_DIMANG_P2'; setPrompt('1辺上の点: (☑️確定)');
        addCommandLog('-> 頂点指定'); if(typeof render==='function') render(); return;
    }
    if(mode === 'WAITING_DIMANG_P2') {
        cmdState.points.push({x:wcs.x, y:wcs.y}); cmdState.mode = 'WAITING_DIMANG_P3'; setPrompt('2辺上の点: (☑️確定)');
        addCommandLog('-> 1辺指定'); if(typeof render==='function') render(); return;
    }
    if(mode === 'WAITING_DIMANG_P3') {
        const v = cmdState.points[0], a1 = cmdState.points[1], a2 = {x:wcs.x, y:wcs.y};
        const arcR = Math.max(dist(v.x,v.y,a1.x,a1.y), dist(v.x,v.y,a2.x,a2.y)) * 0.6;
        saveUndo(); entities.push({type:'DIMENSION', subType:'ANGULAR', layer:currentLayerIndex, color:null, vertex:{x:v.x,y:v.y}, arm1:{x:a1.x,y:a1.y}, arm2:{x:a2.x,y:a2.y}, arcRadius:arcR, textOverride:null});
        addCommandLog('-> 角度寸法作成'); cmdState.mode = 'WAITING_DIMANG_P1'; cmdState.points = []; setPrompt('頂点: (☑️確定)'); if(typeof render==='function') render(); return;
    }
    // -- DIMORDINATE（単一引出線タイプ） --
    if(mode === 'WAITING_DIMORD_P1') {
        cmdState.points = [{x:wcs.x, y:wcs.y}]; cmdState.mode = 'WAITING_DIMORD_LEADER'; setPrompt('引出先を指定 (クリックした位置に表示されます): (☑️確定)');
        const u = wcsToUcs(wcs.x, wcs.y);
        addCommandLog(`-> 測定点: (${dimFormatCoord(u.x)},${dimFormatCoord(u.y)}) - 引出先を指定`); if(typeof render==='function') render(); return;
    }
    if(mode === 'WAITING_DIMORD_LEADER') {
        const p = cmdState.points[0];
        saveUndo(); entities.push({type:'DIMENSION', subType:'ORDINATE', layer:currentLayerIndex, color:null, point:{x:p.x,y:p.y}, leaderCoord:{x:wcs.x,y:wcs.y}, textOverride:null});
        addCommandLog('-> 座標寸法作成'); cmdState.mode = 'WAITING_DIMORD_P1'; cmdState.points = []; setPrompt('測定点: (☑️確定)'); if(typeof render==='function') render(); return;
    }
    // -- DIMCONT (連続寸法) --
    if(mode === 'WAITING_DIMCONT_P1') {
        cmdState.dimContPoints = [{x:wcs.x, y:wcs.y}];
        cmdState.mode = 'WAITING_DIMCONT_P2';
        setPrompt('連続寸法: 2点目を選択 (確定ボタン)');
        addCommandLog('-> 1点目確定。2点目を指定してください');
        if(typeof render === 'function') render(); return;
    }
    if(mode === 'WAITING_DIMCONT_P2') {
        cmdState.dimContPoints.push({x:wcs.x, y:wcs.y});
        cmdState.mode = 'WAITING_DIMCONT_POS';
        setPrompt('連続寸法: 寸法の高さを選択 (確定ボタン)');
        addCommandLog('-> 2点目確定。寸法の高さを指定してください');
        if(typeof render === 'function') render(); return;
    }
    if(mode === 'WAITING_DIMCONT_POS') {
        const p1 = cmdState.dimContPoints[0], p2 = cmdState.dimContPoints[1];
        const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
        cmdState.dimContDir = cmdState.dimContDirMode === 'AUTO' ? (dx >= dy ? 'H' : 'V') : cmdState.dimContDirMode;
        cmdState.dimContOffset = cmdState.dimContDir === 'H' ? (wcs.y - (p1.y + p2.y)/2) : (wcs.x - (p1.x + p2.x)/2);
        cmdState.dimContBaseOffset = cmdState.dimContOffset;
        saveUndo();
        entities.push({type:'DIMENSION', subType:'LINEAR', layer:currentLayerIndex, color:null, p1:{x:p1.x,y:p1.y}, p2:{x:p2.x,y:p2.y}, offset:cmdState.dimContOffset, dimDir:cmdState.dimContDir, textOverride:null});
        
        cmdState.mode = 'WAITING_DIMCONT_NEXT';
        const isS = cmdState.dimContType === 'SERIAL';
        setPrompt(`連続寸法: 次の点 (☑️確定) / ❌終了`);
        addCommandLog(`-> 基準寸法作成。次の点を選択 (${isS?'直列':'並列'})`);
        if(typeof render === 'function') render(); return;
    }
    if(mode === 'WAITING_DIMCONT_NEXT') {
        const pts = cmdState.dimContPoints;
        const pNew = {x:wcs.x, y:wcs.y};
        const p1 = pts[0];
        const pPrev = pts[pts.length - 1];
        saveUndo();
        if(cmdState.dimContType === 'SERIAL') {
            const D_y = (p1.y + pts[1].y)/2 + cmdState.dimContBaseOffset;
            let newOffset = D_y - (pPrev.y + pNew.y)/2;
            if(cmdState.dimContDir === 'V') {
                const D_x = (p1.x + pts[1].x)/2 + cmdState.dimContBaseOffset;
                newOffset = D_x - (pPrev.x + pNew.x)/2;
            }
            entities.push({type:'DIMENSION', subType:'LINEAR', layer:currentLayerIndex, color:null, p1:{x:pPrev.x,y:pPrev.y}, p2:{x:pNew.x,y:pNew.y}, offset:newOffset, dimDir:cmdState.dimContDir, textOverride:null});
        } else {
            cmdState.dimContLevel++;
            const PARALLEL_STEP = 25;
            const sign = cmdState.dimContBaseOffset >= 0 ? 1 : -1;
            const totalOffset = cmdState.dimContBaseOffset + (PARALLEL_STEP * cmdState.dimContLevel * sign);
            const D_y = (p1.y + pts[1].y)/2 + totalOffset;
            let newOffset = D_y - (p1.y + pNew.y)/2;
            if(cmdState.dimContDir === 'V') {
                const D_x = (p1.x + pts[1].x)/2 + totalOffset;
                newOffset = D_x - (p1.x + pNew.x)/2;
            }
            entities.push({type:'DIMENSION', subType:'LINEAR', layer:currentLayerIndex, color:null, p1:{x:p1.x,y:p1.y}, p2:{x:pNew.x,y:pNew.y}, offset:newOffset, dimDir:cmdState.dimContDir, textOverride:null});
        }
        pts.push(pNew);
        addCommandLog('-> 寸法を追加');
        if(typeof render === 'function') render(); return;
    }
    // -- MOVE --
    if(mode === 'WAITING_MOVE_SELECT') {
        const idx = hitTestEntity(mouse.screenX, mouse.screenY);
        if(idx >= 0) {
            cmdState.moveTarget = idx;
            const grp = (typeof expandGroupTargets === 'function') ? expandGroupTargets(idx) : [idx];
            cmdState.selectedIndices = grp.length > 1 ? grp : []; // グループ選択ONならブロック全体を対象にする
            cmdState.mode = 'WAITING_MOVE_BASE'; setPrompt('基点 (移動の基準点):');
            cmdState.highlightIdx = idx;
            addCommandLog(grp.length > 1 ? `-> ブロック ${grp.length}個を選択、基準点を指定` : '-> エンティティ選択、基準点を指定'); render();
        } else { addCommandLog('エンティティが見つかりません'); }
        return;
    }
    if(mode === 'WAITING_MOVE_BASE') {
        cmdState.moveBase = {x:wcs.x, y:wcs.y};
        cmdState.mode = 'WAITING_MOVE_DEST'; setPrompt('移動先:');
        addCommandLog('-> 基準点指定、移動先を指定'); render();
        return;
    }
    if(mode === 'WAITING_MOVE_DEST') {
        const targets = _getMoveTargets();
        const dx = wcs.x - cmdState.moveBase.x, dy = wcs.y - cmdState.moveBase.y;
        if(targets.length > 0) {
            saveUndo();
            targets.forEach(i => { if(entities[i]) moveEntity(entities[i], dx, dy); });
            addCommandLog(`-> ${targets.length}個を移動 (${lengthText(dx)},${lengthText(dy)})`);
        } else { addCommandLog('移動対象がありません'); }
        // 連続移動モード
        cmdState.selectedIndices = []; cmdState.moveTarget = undefined;
        cmdState.mode = 'WAITING_MOVE_SELECT'; cmdState.highlightIdx = -1; setPrompt('移動対象 (右クリックで終了):');
        render(); return;
    }
    // -- COPY --
    if(mode === 'WAITING_COPY_SELECT') {
        const idx = hitTestEntity(mouse.screenX, mouse.screenY);
        if(idx >= 0) {
            cmdState.moveTarget = idx;
            const grp = (typeof expandGroupTargets === 'function') ? expandGroupTargets(idx) : [idx];
            cmdState.selectedIndices = grp.length > 1 ? grp : []; // グループ選択ONならブロック全体を対象にする
            cmdState.mode = 'WAITING_COPY_BASE'; setPrompt('基点 (コピーの基準点):');
            cmdState.highlightIdx = idx;
            addCommandLog(grp.length > 1 ? `-> ブロック ${grp.length}個を選択、基準点を指定` : '-> エンティティ選択、基準点を指定'); render();
        } else { addCommandLog('エンティティが見つかりません'); }
        return;
    }
    if(mode === 'WAITING_COPY_BASE') {
        cmdState.moveBase = {x:wcs.x, y:wcs.y};
        cmdState.mode = 'WAITING_COPY_DEST'; setPrompt('コピー先:');
        addCommandLog('-> 基準点指定、コピー先を指定'); render();
        return;
    }
    if(mode === 'WAITING_COPY_DEST') {
        const targets = _getMoveTargets();
        const dx = wcs.x - cmdState.moveBase.x, dy = wcs.y - cmdState.moveBase.y;
        if(targets.length > 0) {
            saveUndo();
            const copies = [];
            const gidMap = {}; // 元gid → コピー先の新gid（ブロックのまとまりを保ったまま別グループにする）
            targets.forEach(i => {
                if(!entities[i]) return;
                const copy = JSON.parse(JSON.stringify(entities[i]));
                delete copy.id; // 複写は新しい図形（固有IDは追加後に新しく付く）
                if(copy.gid) { if(!gidMap[copy.gid]) gidMap[copy.gid] = (typeof newGroupId === 'function') ? newGroupId('c') : copy.gid + '_c'; copy.gid = gidMap[copy.gid]; }
                moveEntity(copy, dx, dy);
                copies.push(copy);
            });
            copies.forEach(c => entities.push(c));
            addCommandLog(`-> ${copies.length}個をコピー (${lengthText(dx)},${lengthText(dy)})`);
        } else { addCommandLog('コピー対象がありません'); }
        cmdState.selectedIndices = []; cmdState.moveTarget = undefined;
        cmdState.mode = 'WAITING_COPY_SELECT'; cmdState.highlightIdx = -1; setPrompt('コピー対象 (右クリックで終了):');
        render(); return;
    }
}

// 移動・コピーの対象インデックス一覧（範囲選択の複数 or 単体クリックの1個）
function _getMoveTargets() {
    if(cmdState.selectedIndices && cmdState.selectedIndices.length > 0) return cmdState.selectedIndices.slice();
    if(cmdState.moveTarget !== undefined && entities[cmdState.moveTarget]) return [cmdState.moveTarget];
    return [];
}

// ===== エンティティ移動ヘルパー =====
function moveEntity(e, dx, dy) {
    delete e.bbox; // 座標変更後は次回描画時に再計算させる
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(e.ins) { e.ins.x += dx; e.ins.y += dy; } // ブロックの挿入点（測点の座標）
    if(e.type === 'LINE') { e.x1+=dx; e.y1+=dy; e.x2+=dx; e.y2+=dy; }
    else if(e.type === 'CIRCLE' || e.type === 'ARC' || e.type === 'ELLIPSE') { e.cx+=dx; e.cy+=dy; }
    else if(e.type === 'RECTANG') { e.x1+=dx; e.y1+=dy; e.x2+=dx; e.y2+=dy; }
    else if(e.type === 'PLINE') { e.points.forEach(p => { p.x+=dx; p.y+=dy; }); }
    else if(e.type === 'POINT' || e.type === 'TEXT') { e.x+=dx; e.y+=dy; }
    else if(e.type === 'HATCH') { if(e.target) moveEntity(e.target, dx, dy); }
    else if(e.type === 'DIMENSION') {
        if(e.p1) { e.p1.x+=dx; e.p1.y+=dy; e.p2.x+=dx; e.p2.y+=dy; }
        if(e.center) { e.center.x+=dx; e.center.y+=dy; }
        if(e.vertex) { e.vertex.x+=dx; e.vertex.y+=dy; e.arm1.x+=dx; e.arm1.y+=dy; e.arm2.x+=dx; e.arm2.y+=dy; }
        if(e.point) { e.point.x+=dx; e.point.y+=dy; }
        if(e.leader) { e.leader.x+=dx; e.leader.y+=dy; }
        if(e.leaderX) { e.leaderX.x+=dx; e.leaderX.y+=dy; }
        if(e.leaderY) { e.leaderY.x+=dx; e.leaderY.y+=dy; }
        if(e.leaderCoord) { e.leaderCoord.x+=dx; e.leaderCoord.y+=dy; }
    }
}

// アクションバー表示用のヘルパー
function _showDimActionBar(isContinuous) {
    const actionbar = document.getElementById('fs-dim-actionbar');
    if(actionbar) actionbar.style.display = 'flex';
    _hideMeasureButtons(); // 基点測定用のボタンは他の寸法コマンドでは出さない
    const toggleBtn = document.getElementById('dim-mode-toggle');
    if(toggleBtn) toggleBtn.style.display = isContinuous ? 'inline-block' : 'none';
    const dirBtn = document.getElementById('dim-dir-toggle');
    if(dirBtn) dirBtn.style.display = isContinuous ? 'inline-block' : 'none';
}

// ===== 基点測定 =====
// 基点を1つ決めると、そこから指（カーソル）やスナップ点までの
//   ・X距離（北方向 ＝ 図面の縦方向）
//   ・Y距離（東方向 ＝ 図面の横方向）
//   ・直線距離
// を画面に出したままにする。画面を動かしても基点は図面上の同じ場所に残る。
// 指を離した位置（スナップ点）に表示が残るので、そのまま読み取れる。
const MEAS_COLOR = '#00FFFF';      // 寸法と同じ水色
const MEAS_BASE_COLOR = '#00ff88'; // 基点は緑（確定した点）
const MEAS_TEXT_SIZE = 15;

// 測る相手の点（スナップがあればスナップ点、なければカーソル位置）
function _measTargetPoint() {
    if(typeof getInputPoint === 'function') return getInputPoint();
    return { x: mouse.wcsX, y: mouse.wcsY };
}
// 長さの表示。オプション「長さの単位」（「図面どおり」なら図面の1単位）で、m は小数3桁、mm は整数。
// オプション「寸法の桁」を選んでいれば、その桁にする（記入した寸法と同じ文字になる）
function measFormatLength(v) {
    const x = toDisplayUnit(v, 'len'), d = displayPref('dimDecimals');
    if(d !== null && d !== undefined) return formatDimNumber(x, displayUnit('len'));
    return displayUnit('len') === 'mm' ? String(Math.round(x)) : x.toFixed(3);
}
function _measUnitLabel() { return displayUnit('len'); }

// 読み取りやすいように、背景の帯つきで文字を描く
function _measLabel(text, x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    let a = angle || 0;
    if(a > Math.PI/2 || a < -Math.PI/2) a += Math.PI; // 文字が逆さまにならないように
    ctx.rotate(a);
    const ts = dimSizePx(MEAS_TEXT_SIZE); // オプション「寸法の文字」の大きさ
    ctx.font = 'bold ' + ts + 'px sans-serif';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(-w/2 - 5, -ts/2 - 4, w + 10, ts + 8);
    ctx.fillStyle = MEAS_COLOR;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
}

// 基点の印（十字つきの丸）
function _measDrawBaseMark(s) {
    ctx.strokeStyle = MEAS_BASE_COLOR; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x - 12, s.y); ctx.lineTo(s.x + 12, s.y);
    ctx.moveTo(s.x, s.y - 12); ctx.lineTo(s.x, s.y + 12);
    ctx.stroke();
}

// 基点測定の重ね表示（1フレームごとに描き直す）
function drawMeasureOverlay() {
    const m = cmdState.mode;
    if(m !== 'WAITING_DIMMEAS_BASE' && m !== 'WAITING_DIMMEAS_TO') return;
    const b = cmdState.measBase;
    if(!b) return;

    const t = _measTargetPoint();
    const c = { x: t.x, y: b.y };             // 直角に曲がる点（X距離とY距離の折れ点）
    const sb = wcsToScreen(b.x, b.y), st = wcsToScreen(t.x, t.y), sc = wcsToScreen(c.x, c.y);
    const dX = Math.abs(t.y - b.y);            // 測量X（北）＝ 図面のy方向
    const dY = Math.abs(t.x - b.x);            // 測量Y（東）＝ 図面のx方向
    const dL = dist(b.x, b.y, t.x, t.y);

    ctx.save();
    _measDrawBaseMark(sb);

    // 折れ線（X方向・Y方向）は破線
    ctx.strokeStyle = MEAS_COLOR; ctx.lineWidth = lineWidthPx(1, 1.5); ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(sb.x, sb.y); ctx.lineTo(sc.x, sc.y); ctx.lineTo(st.x, st.y); ctx.stroke();
    ctx.setLineDash([]);

    // 直線距離は実線＋両端矢印（寸法と同じ見た目）
    const ang = Math.atan2(st.y - sb.y, st.x - sb.x);
    if(Math.hypot(st.x - sb.x, st.y - sb.y) > 1) {
        ctx.beginPath(); ctx.moveTo(sb.x, sb.y); ctx.lineTo(st.x, st.y); ctx.stroke();
        drawArrowHead(sb.x, sb.y, ang, dimSizePx(DIM_ARROW_SIZE));
        drawArrowHead(st.x, st.y, ang + Math.PI, dimSizePx(DIM_ARROW_SIZE));
    }

    // 測る先の点の印
    ctx.strokeRect(st.x - 4, st.y - 4, 8, 8);

    // それぞれの値を、線から少し離して置く
    const u = _measUnitLabel();
    if(Math.hypot(sc.x - sb.x, sc.y - sb.y) > 24) {
        const a1 = Math.atan2(sc.y - sb.y, sc.x - sb.x);
        _measLabel('Y ' + measFormatLength(dY) + u, (sb.x + sc.x)/2 - Math.sin(a1)*14, (sb.y + sc.y)/2 + Math.cos(a1)*14, a1);
    }
    if(Math.hypot(st.x - sc.x, st.y - sc.y) > 24) {
        const a2 = Math.atan2(st.y - sc.y, st.x - sc.x);
        _measLabel('X ' + measFormatLength(dX) + u, (sc.x + st.x)/2 + Math.sin(a2)*14, (sc.y + st.y)/2 - Math.cos(a2)*14, a2);
    }
    if(dL > 0) _measLabel(measFormatLength(dL) + u, (sb.x + st.x)/2 - Math.sin(ang)*18, (sb.y + st.y)/2 + Math.cos(ang)*18, ang);

    ctx.restore();
}

// 基点測定用のボタンを隠す（他のコマンドへ切り替えたとき）
function _hideMeasureButtons() {
    const writeBtn = document.getElementById('dim-meas-write'); if(writeBtn) writeBtn.style.display = 'none';
    const baseBtn = document.getElementById('dim-meas-base'); if(baseBtn) baseBtn.style.display = 'none';
}
window._hideMeasureButtons = _hideMeasureButtons;

// 画面下のボタンの出し分け（BASE: 基点待ち / TO: 測定中）
function _showMeasureBar(stage) {
    const ab = document.getElementById('fs-dim-actionbar');
    if(ab) ab.style.display = 'flex';
    const confirmBtn = ab && ab.querySelector('button[onclick="dimConfirmPoint()"]');
    if(confirmBtn) confirmBtn.style.display = (stage === 'BASE') ? '' : 'none';
    const modeBtn = document.getElementById('dim-mode-toggle'); if(modeBtn) modeBtn.style.display = 'none';
    const dirBtn = document.getElementById('dim-dir-toggle'); if(dirBtn) dirBtn.style.display = 'none';
    const writeBtn = document.getElementById('dim-meas-write'); if(writeBtn) writeBtn.style.display = (stage === 'TO') ? '' : 'none';
    const baseBtn = document.getElementById('dim-meas-base'); if(baseBtn) baseBtn.style.display = (stage === 'TO') ? '' : 'none';
}

// いま表示している測定値を、図面の寸法として記入する
// （X方向の平行寸法・Y方向の平行寸法・直線の整列寸法の3つを1つのまとまりとして入れる）
window.measureWriteDims = function() {
    if(cmdState.mode !== 'WAITING_DIMMEAS_TO' || !cmdState.measBase) return;
    const b = cmdState.measBase, t = _measTargetPoint();
    if(dist(b.x, b.y, t.x, t.y) < 1e-9) { addCommandLog('-> 基点と同じ位置のため記入しませんでした'); return; }
    const sb = wcsToScreen(b.x, b.y), st = wcsToScreen(t.x, t.y);
    const px = 24 / (view.scale || 1);                  // 寸法線を図形から24px離す
    const gid = (typeof newGroupId === 'function') ? newGroupId('meas') : undefined;
    // 文字は固定せず（meas: 測定の桁で描く）、長さの単位・寸法の桁を変えると記入済みの寸法も変わる
    const mk = (props) => Object.assign({ type:'DIMENSION', layer:currentLayerIndex, color:null, gid:gid, blockName:'測定', meas:true, textOverride:null, p1:{x:b.x,y:b.y}, p2:{x:t.x,y:t.y} }, props);

    saveUndo();
    // Y距離（東西・図面の横方向）
    entities.push(mk({ subType:'LINEAR', dimDir:'H', offset:(st.y > sb.y ? px : -px) }));
    // X距離（南北・図面の縦方向）
    entities.push(mk({ subType:'LINEAR', dimDir:'V', offset:(t.x - b.x) + (st.x > sb.x ? px : -px) }));
    // 直線距離
    entities.push(mk({ subType:'ALIGNED', offset:0 }));

    const u = _measUnitLabel();
    addCommandLog(`-> 寸法を記入: X ${measFormatLength(Math.abs(t.y - b.y))}${u} / Y ${measFormatLength(Math.abs(t.x - b.x))}${u} / 直線 ${measFormatLength(dist(b.x,b.y,t.x,t.y))}${u}`);
    if(typeof showToast === 'function') showToast('寸法を記入しました');
    if(typeof clearSnapOverride === 'function') clearSnapOverride();
    if(typeof guideNotify === 'function') guideNotify('measureWrite');
    if(navigator.vibrate) navigator.vibrate(20);
    if(typeof render === 'function') render();
};

// いま測っている点を、次の基点にする（続けて測るとき）
window.measureSetBase = function() {
    if(cmdState.mode !== 'WAITING_DIMMEAS_TO') return;
    const t = _measTargetPoint();
    _measureStartFrom(t);
    if(navigator.vibrate) navigator.vibrate(20);
};

// いまの測定値をコマンドログに残す
function _measureLog() {
    const b = cmdState.measBase;
    if(!b) return;
    const t = _measTargetPoint(), u = _measUnitLabel();
    addCommandLog(`-> 測定: X ${measFormatLength(Math.abs(t.y - b.y))}${u} / Y ${measFormatLength(Math.abs(t.x - b.x))}${u} / 直線 ${measFormatLength(dist(b.x, b.y, t.x, t.y))}${u}`);
    if(typeof render === 'function') render();
}

function _measureStartFrom(pt) {
    cmdState.measBase = { x: pt.x, y: pt.y };
    cmdState.mode = 'WAITING_DIMMEAS_TO';
    const u = wcsToUcs(pt.x, pt.y);
    setPrompt('測る点をなぞる → 📐記入 / 📍基点で基点を移動');
    addCommandLog(`-> 基点: X${dimFormatCoord(u.y)} Y${dimFormatCoord(u.x)} — 測る点をなぞってください`);
    _showMeasureBar('TO');
    if(typeof render === 'function') render();
}

// ===== 寸法コマンドのディスパッチ =====
function processDimCommand(cmd) {
    if(cmd==='DLI'||cmd==='DIMLINEAR') { cmdState.mode='WAITING_DIMLIN_P1'; cmdState.points=[]; setPrompt('1点目: (☑️確定)'); setActiveTool('DIMLIN'); addCommandLog('-> [平行寸法] 1点目を指定'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DAL'||cmd==='DIMALIGNED') { cmdState.mode='WAITING_DIMALN_P1'; cmdState.points=[]; setPrompt('1点目: (☑️確定)'); setActiveTool('DIMALN'); addCommandLog('-> [整列寸法] 1点目を指定'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DRA'||cmd==='DIMRADIUS') { cmdState.mode='WAITING_DIMRAD_SELECT'; cmdState.dimTarget=null; setPrompt('円/弧を選択: (☑️確定)'); setActiveTool('DIMRAD'); addCommandLog('-> [半径寸法] 円または弧を選択'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DDI'||cmd==='DIMDIAMETER') { cmdState.mode='WAITING_DIMDIA_SELECT'; cmdState.dimTarget=null; setPrompt('円/弧を選択: (☑️確定)'); setActiveTool('DIMDIA'); addCommandLog('-> [直径寸法] 円または弧を選択'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DAN'||cmd==='DIMANGULAR') { cmdState.mode='WAITING_DIMANG_P1'; cmdState.points=[]; setPrompt('頂点: (☑️確定)'); setActiveTool('DIMANG'); addCommandLog('-> [角度寸法] 頂点を指定'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='MEASURE'||cmd==='MEA'||cmd==='DIST'||cmd==='DI') {
        cmdState.mode='WAITING_DIMMEAS_BASE'; cmdState.measBase=null; cmdState.points=[];
        setPrompt('基点をなぞって「☑️確定」:'); setActiveTool('MEASURE');
        addCommandLog('-> [基点測定] 基点を指定すると、そこからのX距離・Y距離・直線距離を出したままにします');
        if(ucs.angle) addCommandLog('-> ※ UCSを回転しているため、X・Yは図面本来の軸で測ります');
        _showMeasureBar('BASE');
        if(typeof render==='function') render(); return true;
    }
    if(cmd==='DOR'||cmd==='DIMORDINATE') { cmdState.mode='WAITING_DIMORD_P1'; cmdState.points=[]; setPrompt('測定点: (☑️確定)'); setActiveTool('DIMORD'); addCommandLog('-> [座標寸法] 測定点を指定 (XY一括表示)'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='M'||cmd==='MOVE') {
        cmdState.moveTarget = undefined;
        if(typeof _adoptIdleHighlight === 'function') _adoptIdleHighlight(); // タップで選んだ1図形も引き継ぐ
        // IDLE時の複数選択を引き継いで基点指定へ
        if(cmdState.selectedIndices && cmdState.selectedIndices.length > 0) {
            cmdState.mode='WAITING_MOVE_BASE'; setPrompt('基点 (移動の基準点):'); setActiveTool('MOVE');
            addCommandLog(`-> [移動] ${cmdState.selectedIndices.length}個の選択を引き継ぎ。基点を指定`);
            if(typeof render==='function') render(); return true;
        }
        cmdState.mode='WAITING_MOVE_SELECT'; setPrompt('移動対象:'); setActiveTool('MOVE'); addCommandLog('-> [移動] エンティティをクリック'); return true;
    }
    if(cmd==='CO'||cmd==='COPY') {
        cmdState.moveTarget = undefined;
        if(typeof _adoptIdleHighlight === 'function') _adoptIdleHighlight(); // タップで選んだ1図形も引き継ぐ
        // IDLE時の複数選択を引き継いで基点指定へ
        if(cmdState.selectedIndices && cmdState.selectedIndices.length > 0) {
            cmdState.mode='WAITING_COPY_BASE'; setPrompt('基点 (コピーの基準点):'); setActiveTool('COPY');
            addCommandLog(`-> [コピー] ${cmdState.selectedIndices.length}個の選択を引き継ぎ。基点を指定`);
            if(typeof render==='function') render(); return true;
        }
        cmdState.mode='WAITING_COPY_SELECT'; setPrompt('コピー対象:'); setActiveTool('COPY'); addCommandLog('-> [コピー] エンティティをクリック'); return true;
    }
    // 連続寸法コマンドの処理
    if(cmd === 'DIMCONT' || cmd === 'DIMCONTINUOUS') {
        cmdState.mode = 'WAITING_DIMCONT_P1';
        cmdState.dimContPoints = [];
        cmdState.dimContType = 'SERIAL';
        cmdState.dimContDirMode = 'AUTO';
        cmdState.dimContLevel = 0;
        setPrompt('連続寸法: 1点目を選択 (☑️確定ボタンで決定)');
        addCommandLog('-> [連続寸法] アクションバーの確定ボタンで点を入力します');
        
        _showDimActionBar(true);
        const toggleBtn = document.getElementById('dim-mode-toggle');
        if(toggleBtn) toggleBtn.textContent = '📏 直列 (変更)';
        const dirBtn = document.getElementById('dim-dir-toggle');
        if(dirBtn) dirBtn.textContent = '⚙ 自動 (X/Y)';
        
        if(typeof render === 'function') render();
        return true;
    }
    return false;
}

// 連続寸法のモード切り替え関数（グローバル）
window.toggleDimContMode = function() {
    if(!cmdState.mode || !cmdState.mode.startsWith('WAITING_DIMCONT')) return;
    if(cmdState.dimContType === 'SERIAL') {
        cmdState.dimContType = 'PARALLEL';
        const toggleBtn = document.getElementById('dim-mode-toggle');
        if(toggleBtn) toggleBtn.textContent = '📏 並列 (変更)';
        if(cmdState.mode === 'WAITING_DIMCONT_NEXT') addCommandLog('-> モード切替: 並列 (最初の基準点から測ります)');
    } else {
        cmdState.dimContType = 'SERIAL';
        const toggleBtn = document.getElementById('dim-mode-toggle');
        if(toggleBtn) toggleBtn.textContent = '📏 直列 (変更)';
        if(cmdState.mode === 'WAITING_DIMCONT_NEXT') addCommandLog('-> モード切替: 直列 (前回の点から測ります)');
    }
    if(typeof render === 'function') render();
};

window.toggleDimContDir = function() {
    if(!cmdState.mode || !cmdState.mode.startsWith('WAITING_DIMCONT')) return;
    if(cmdState.dimContDirMode === 'AUTO') {
        cmdState.dimContDirMode = 'H';
        const dirBtn = document.getElementById('dim-dir-toggle');
        if(dirBtn) dirBtn.textContent = '↔ 水平/X軸 (固定)';
        addCommandLog('-> 寸法方向: X軸 (水平) に固定しました');
    } else if(cmdState.dimContDirMode === 'H') {
        cmdState.dimContDirMode = 'V';
        const dirBtn = document.getElementById('dim-dir-toggle');
        if(dirBtn) dirBtn.textContent = '↕ 垂直/Y軸 (固定)';
        addCommandLog('-> 寸法方向: Y軸 (垂直) に固定しました');
    } else {
        cmdState.dimContDirMode = 'AUTO';
        const dirBtn = document.getElementById('dim-dir-toggle');
        if(dirBtn) dirBtn.textContent = '⚙ 自動 (X/Y)';
        addCommandLog('-> 寸法方向: 自動判定 に戻しました');
    }
    
    if(cmdState.mode === 'WAITING_DIMCONT_POS' && cmdState.dimContPoints && cmdState.dimContPoints.length > 1) {
        const p1 = cmdState.dimContPoints[0], p2 = cmdState.dimContPoints[1];
        const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
        cmdState.dimContDir = cmdState.dimContDirMode === 'AUTO' ? (dx >= dy ? 'H' : 'V') : cmdState.dimContDirMode;
    }
    if(typeof render === 'function') render();
};