// ===== Web CAD 寸法記入モジュール =====
// cad-dimension.js - 6種類の寸法コマンドと描画 + 寸法編集

const DIM_COLOR = '#00FFFF';
const DIM_TEXT_SIZE = 12;   // スクリーンピクセル
const DIM_ARROW_SIZE = 8;   // スクリーンピクセル
const DIM_EXT_OVERSHOOT = 5; // 補助線のオーバーシュート(px)
const DIM_EXT_GAP = 3;      // 補助線の測定点からの隙間(px)

// ===== 寸法値フォーマット（mm単位、小数点なし） =====
function dimFormat(val) { return Math.round(val).toString(); }
function dimFormatAngle(deg) { return deg.toFixed(1) + '°'; }

// ===== 矢印描画 =====
function drawArrowHead(cx, cy, angle, size) {
    ctx.save(); ctx.fillStyle = ctx.strokeStyle;
    ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-size, size/3); ctx.lineTo(-size, -size/3); ctx.closePath(); ctx.fill();
    ctx.restore();
}

// ===== 寸法テキスト描画 =====
function drawDimText(text, x, y, angle, color) {
    ctx.save(); ctx.fillStyle = color || ctx.strokeStyle || DIM_COLOR; ctx.font = DIM_TEXT_SIZE+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.translate(x, y);
    let a = angle || 0;
    if(a > Math.PI/2 || a < -Math.PI/2) a += Math.PI;
    ctx.rotate(a);
    ctx.fillText(text, 0, -3);
    ctx.restore();
}

// ===== 共通：描画ヒット記録 =====
function _addHitSeg(e, sc1, sc2) { if(e){ if(!e._hits) e._hits=[]; e._hits.push({type:'seg', p1:sc1, p2:sc2}); } }
function _addHitCircle(e, sc, radiusPx) { if(e){ if(!e._hits) e._hits=[]; e._hits.push({type:'circle', c:sc, r:radiusPx}); } }
function _addHitText(e, sc) { if(e){ if(!e._hits) e._hits=[]; e._hits.push({type:'text', p:sc}); } }

// ===== 共通：DIMLINEAR描画ロジック =====
function _drawDimLinearCore(p1, p2, offset, dimDir, color, textOverride, e) {
    if(e) e._hits = [];
    const s1 = wcsToScreen(p1.x, p1.y), s2 = wcsToScreen(p2.x, p2.y);
    const resolvedColor = color || getEntityColor(e) || DIM_COLOR;
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = 1;
    const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
    const isHoriz = (dimDir === 'H') || (!dimDir && dx >= dy);
    const offsetPx = offset * view.scale;

    let dl1, dl2;
    if(isHoriz) {
        const dimY = s1.y - offsetPx;
        dl1 = {x: s1.x, y: dimY}; dl2 = {x: s2.x, y: dimY};
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y - DIM_EXT_GAP * Math.sign(offset)); ctx.lineTo(dl1.x, dl1.y - DIM_EXT_OVERSHOOT * Math.sign(offset)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s2.x, s2.y - DIM_EXT_GAP * Math.sign(offset)); ctx.lineTo(dl2.x, dl2.y - DIM_EXT_OVERSHOOT * Math.sign(offset)); ctx.stroke();
    } else {
        const dimX = s1.x + offsetPx;
        dl1 = {x: dimX, y: s1.y}; dl2 = {x: dimX, y: s2.y};
        ctx.beginPath(); ctx.moveTo(s1.x + DIM_EXT_GAP * Math.sign(offset), s1.y); ctx.lineTo(dl1.x + DIM_EXT_OVERSHOOT * Math.sign(offset), dl1.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s2.x + DIM_EXT_GAP * Math.sign(offset), s2.y); ctx.lineTo(dl2.x + DIM_EXT_OVERSHOOT * Math.sign(offset), dl2.y); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(dl1.x, dl1.y); ctx.lineTo(dl2.x, dl2.y); ctx.stroke();
    _addHitSeg(e, dl1, dl2);
    const ang = Math.atan2(dl2.y - dl1.y, dl2.x - dl1.x);
    drawArrowHead(dl1.x, dl1.y, ang, DIM_ARROW_SIZE);
    drawArrowHead(dl2.x, dl2.y, ang + Math.PI, DIM_ARROW_SIZE);
    const val = isHoriz ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
    const text = textOverride || dimFormat(val);
    const tx = (dl1.x+dl2.x)/2, ty = (dl1.y+dl2.y)/2;
    drawDimText(text, tx, ty, isHoriz ? 0 : -Math.PI/2, resolvedColor);
    _addHitText(e, {x:tx, y:ty});
}

// ===== 共通：DIMALIGNED描画ロジック =====
function _drawDimAlignedCore(p1, p2, offset, color, textOverride, e) {
    if(e) e._hits = [];
    const s1 = wcsToScreen(p1.x, p1.y), s2 = wcsToScreen(p2.x, p2.y);
    const resolvedColor = color || getEntityColor(e) || DIM_COLOR;
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = 1;
    const ddx = s2.x - s1.x, ddy = s2.y - s1.y;
    const len = Math.sqrt(ddx*ddx + ddy*ddy) || 1;
    const nx = -ddy/len, ny = ddx/len;
    const offPx = offset * view.scale;
    const dl1 = {x: s1.x + nx*offPx, y: s1.y + ny*offPx};
    const dl2 = {x: s2.x + nx*offPx, y: s2.y + ny*offPx};
    ctx.beginPath(); ctx.moveTo(s1.x + nx*DIM_EXT_GAP, s1.y + ny*DIM_EXT_GAP); ctx.lineTo(dl1.x + nx*DIM_EXT_OVERSHOOT, dl1.y + ny*DIM_EXT_OVERSHOOT); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s2.x + nx*DIM_EXT_GAP, s2.y + ny*DIM_EXT_GAP); ctx.lineTo(dl2.x + nx*DIM_EXT_OVERSHOOT, dl2.y + ny*DIM_EXT_OVERSHOOT); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dl1.x, dl1.y); ctx.lineTo(dl2.x, dl2.y); ctx.stroke();
    _addHitSeg(e, dl1, dl2);
    const ang = Math.atan2(dl2.y - dl1.y, dl2.x - dl1.x);
    drawArrowHead(dl1.x, dl1.y, ang, DIM_ARROW_SIZE);
    drawArrowHead(dl2.x, dl2.y, ang + Math.PI, DIM_ARROW_SIZE);
    const val = dist(p1.x, p1.y, p2.x, p2.y);
    const tx = (dl1.x+dl2.x)/2, ty = (dl1.y+dl2.y)/2;
    drawDimText(textOverride || dimFormat(val), tx, ty, ang, resolvedColor);
    _addHitText(e, {x:tx, y:ty});
}

// ===== 共通：DIMRADIUS描画ロジック =====
function _drawDimRadiusCore(center, radius, angle, color, textOverride, e) {
    if(e) e._hits = [];
    const resolvedColor = color || getEntityColor(e) || DIM_COLOR;
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = 1;
    const sc = wcsToScreen(center.x, center.y);
    const a = angle || 0;
    const ep = {x: sc.x + radius*view.scale*Math.cos(a), y: sc.y - radius*view.scale*Math.sin(a)};
    ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
    _addHitSeg(e, sc, ep);
    const ang = Math.atan2(ep.y - sc.y, ep.x - sc.x);
    drawArrowHead(ep.x, ep.y, ang + Math.PI, DIM_ARROW_SIZE);
    const tx = (sc.x+ep.x)/2, ty = (sc.y+ep.y)/2;
    drawDimText(textOverride || ('R' + dimFormat(radius)), tx, ty, ang, resolvedColor);
    _addHitText(e, {x:tx, y:ty});
}

// ===== 共通：DIMDIAMETER描画ロジック =====
function _drawDimDiameterCore(center, radius, angle, color, textOverride, e) {
    if(e) e._hits = [];
    const resolvedColor = color || getEntityColor(e) || DIM_COLOR;
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = 1;
    const sc = wcsToScreen(center.x, center.y);
    const a = angle || 0;
    const r = radius * view.scale;
    const ep1 = {x: sc.x + r*Math.cos(a), y: sc.y - r*Math.sin(a)};
    const ep2 = {x: sc.x - r*Math.cos(a), y: sc.y + r*Math.sin(a)};
    ctx.beginPath(); ctx.moveTo(ep1.x, ep1.y); ctx.lineTo(ep2.x, ep2.y); ctx.stroke();
    _addHitSeg(e, ep1, ep2);
    const ang = Math.atan2(ep1.y - ep2.y, ep1.x - ep2.x);
    drawArrowHead(ep1.x, ep1.y, ang + Math.PI, DIM_ARROW_SIZE);
    drawArrowHead(ep2.x, ep2.y, ang, DIM_ARROW_SIZE);
    drawDimText(textOverride || ('⌀' + dimFormat(radius*2)), sc.x, sc.y, ang, resolvedColor);
    _addHitText(e, {x:sc.x, y:sc.y});
}

// ===== 共通：DIMORDINATE描画ロジック（単一引出線タイプ） =====
function _drawDimOrdinateCore(point, leaderCoord, color, textOverride, e) {
    if(e) e._hits = [];
    ctx.strokeStyle = color || getEntityColor(e) || DIM_COLOR; ctx.lineWidth = 1;
    
    // WCS -> Screen 変換 (ここではview.rotationの影響を含む)
    const sp = wcsToScreen(point.x, point.y);
    const sl = wcsToScreen(leaderCoord.x, leaderCoord.y);
    const ucsCoord = wcsToUcs(point.x, point.y);

    // 引出線の描画（sp から sl まで行き、そこから水平な下線を引く）
    // 文字が右に配置されるか左に配置されるかを決定
    const textSide = (sl.x >= sp.x) ? 1 : -1; 
    const lineEnd = {x: sl.x + textSide * 80, y: sl.y}; // 下線の長さ: 80px

    ctx.beginPath(); 
    ctx.moveTo(sp.x, sp.y); 
    ctx.lineTo(sl.x, sl.y); 
    ctx.lineTo(lineEnd.x, lineEnd.y); 
    ctx.stroke();

    _addHitSeg(e, sp, sl);
    _addHitSeg(e, sl, lineEnd);

    // テキスト内容
    const txtX = `X: ${dimFormat(ucsCoord.y)}`; // 測量X座標 (数学Y)
    const txtY = `Y: ${dimFormat(ucsCoord.x)}`; // 測量Y座標 (数学X)

    ctx.save();
    // テキストは下線の中央、少し上に配置
    ctx.translate(sl.x + textSide * 40, sl.y - 4);

    // もし view.rotation がかかっていれば、文字自体は画面に対して水平になるよう逆回転させるか？
    // wcsToScreenで既に回転したスクリーン座標が出ているので、このままで文字は画面水平に描画される
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    
    // 現場で読みやすいように色分け
    ctx.fillStyle = '#00ff88'; ctx.fillText(txtX, 0, -14); // 上段 (X)
    ctx.fillStyle = '#00ffff'; ctx.fillText(txtY, 0, 0);   // 下段 (Y)
    
    ctx.restore();

    _addHitText(e, {x: sl.x + textSide * 40, y: sl.y - 10});
}

// ===== 寸法タイプ別描画（エンティティから呼ばれる） =====
function drawDimLinear(e, color) { _drawDimLinearCore(e.p1, e.p2, e.offset||30, e.dimDir, color||e.color, e.textOverride, e); }
function drawDimAligned(e, color) { _drawDimAlignedCore(e.p1, e.p2, e.offset||30, color||e.color, e.textOverride, e); }
function drawDimRadius(e, color) { _drawDimRadiusCore(e.center, e.radius, e.angle, color||e.color, e.textOverride, e); }
function drawDimDiameter(e, color) { _drawDimDiameterCore(e.center, e.radius, e.angle, color||e.color, e.textOverride, e); }

function drawDimAngular(e, color) {
    if(e) e._hits = [];
    const resolvedColor = color || getEntityColor(e) || DIM_COLOR;
    ctx.strokeStyle = resolvedColor; ctx.lineWidth = 1;
    const sv = wcsToScreen(e.vertex.x, e.vertex.y);
    const sa1 = wcsToScreen(e.arm1.x, e.arm1.y), sa2 = wcsToScreen(e.arm2.x, e.arm2.y);
    ctx.beginPath(); ctx.moveTo(sv.x, sv.y); ctx.lineTo(sa1.x, sa1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sv.x, sv.y); ctx.lineTo(sa2.x, sa2.y); ctx.stroke();
    const angle1 = Math.atan2(-(e.arm1.y - e.vertex.y), e.arm1.x - e.vertex.x);
    const angle2 = Math.atan2(-(e.arm2.y - e.vertex.y), e.arm2.x - e.vertex.x);
    const arcR = (e.arcRadius || 40) * view.scale;
    ctx.beginPath(); ctx.arc(sv.x, sv.y, arcR, angle1, angle2, false); ctx.stroke();
    drawArrowHead(sv.x + arcR*Math.cos(angle1), sv.y + arcR*Math.sin(angle1), angle1 - Math.PI/2, DIM_ARROW_SIZE);
    drawArrowHead(sv.x + arcR*Math.cos(angle2), sv.y + arcR*Math.sin(angle2), angle2 + Math.PI/2, DIM_ARROW_SIZE);
    const a1w = Math.atan2(e.arm1.y - e.vertex.y, e.arm1.x - e.vertex.x);
    const a2w = Math.atan2(e.arm2.y - e.vertex.y, e.arm2.x - e.vertex.x);
    let angleDeg = Math.abs(a2w - a1w) * 180 / Math.PI;
    if(angleDeg > 180) angleDeg = 360 - angleDeg;
    const text = e.textOverride || dimFormatAngle(angleDeg);
    const midA = (angle1 + angle2) / 2;
    const tx = sv.x + arcR*Math.cos(midA), ty = sv.y + arcR*Math.sin(midA);
    drawDimText(text, tx, ty, 0, resolvedColor);
    
    _addHitSeg(e, sv, sa1); _addHitSeg(e, sv, sa2);
    _addHitCircle(e, sv, arcR);
    _addHitText(e, {x:tx, y:ty});
}

function drawDimOrdinate(e, color) {
    _drawDimOrdinateCore(e.point, e.leaderCoord || e.leaderX, color||e.color, e.textOverride, e);
    // 旧形式互換（leaderX/leaderYがない場合）
    if(!e.leaderX && !e.leaderY && e.leader) {
        if(e) e._hits = [];
        const resolvedColor = color || getEntityColor(e) || DIM_COLOR;
        ctx.strokeStyle = resolvedColor; ctx.lineWidth = 1;
        const sp = wcsToScreen(e.point.x, e.point.y);
        const sl = wcsToScreen(e.leader.x, e.leader.y);
        const ucsC = wcsToUcs(e.point.x, e.point.y);
        if(e.isX) {
            const mid = {x: sp.x, y: sl.y};
            ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(mid.x, mid.y); ctx.lineTo(sl.x, sl.y); ctx.stroke();
            drawDimText('Y=' + dimFormat(ucsC.x), sl.x, sl.y, 0, resolvedColor);
            _addHitSeg(e, sp, mid); _addHitSeg(e, mid, sl); _addHitText(e, sl);
        } else {
            const mid = {x: sl.x, y: sp.y};
            ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(mid.x, mid.y); ctx.lineTo(sl.x, sl.y); ctx.stroke();
            drawDimText('X=' + dimFormat(ucsC.y), sl.x, sl.y, 0, resolvedColor);
            _addHitSeg(e, sp, mid); _addHitSeg(e, mid, sl); _addHitText(e, sl);
        }
    }
}

// ===== 全寸法描画（cad-core.jsから呼ばれる） =====
function drawAllDimensions() {
    ctx.save();
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

        const color = i === cmdState.highlightIdx ? '#ff6b6b' : null;
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
            ctx.font = 'bold 10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
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
    else if(mode === 'WAITING_MOVE_DEST' && cmdState.moveTarget !== undefined) {
        // 移動プレビュー
        const e = entities[cmdState.moveTarget];
        if(e) {
            const dx = mp.x - cmdState.moveBase.x, dy = mp.y - cmdState.moveBase.y;
            drawMovePreview(e, dx, dy);
        }
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
        const c = wcsToScreen(e.cx+dx, e.cy+dy);
        ctx.beginPath(); ctx.arc(c.x,c.y,e.radius*view.scale,-e.startAngle,-e.endAngle,!e.counterclockwise); ctx.stroke();
    } else if(e.type === 'RECTANG') {
        const a = wcsToScreen(e.x1+dx, e.y1+dy), b = wcsToScreen(e.x2+dx, e.y2+dy);
        ctx.beginPath(); ctx.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y)); ctx.stroke();
    } else if(e.type === 'PLINE' && e.points.length > 1) {
        ctx.beginPath();
        const f = wcsToScreen(e.points[0].x+dx, e.points[0].y+dy); ctx.moveTo(f.x,f.y);
        for(let i=1;i<e.points.length;i++){const p=wcsToScreen(e.points[i].x+dx,e.points[i].y+dy);ctx.lineTo(p.x,p.y);}
        if(e.closed) ctx.closePath(); ctx.stroke();
    } else if(e.type === 'DIMENSION') {
        // 寸法の移動プレビュー
        drawDimMovePreview(e, dx, dy);
    }
    ctx.setLineDash([]);
}

function drawDimMovePreview(e, dx, dy) {
    if(e.subType === 'LINEAR' || e.subType === 'ALIGNED') {
        const p1m = {x:e.p1.x+dx, y:e.p1.y+dy}, p2m = {x:e.p2.x+dx, y:e.p2.y+dy};
        if(e.subType === 'LINEAR') _drawDimLinearCore(p1m, p2m, e.offset||30, e.dimDir, '#ffff00', e.textOverride);
        else _drawDimAlignedCore(p1m, p2m, e.offset||30, '#ffff00', e.textOverride);
    }
}

// ===== 寸法コマンドの入力処理 =====
function handleDimPointInput(mode, wcs) {
    // -- DIMLINEAR --
    if(mode === 'WAITING_DIMLIN_P1') {
        cmdState.points = [{x:wcs.x, y:wcs.y}]; cmdState.mode = 'WAITING_DIMLIN_P2'; setPrompt('2点目: (☑️確定)');
        const u = wcsToUcs(wcs.x,wcs.y);
        addCommandLog(`-> 1点目: (${dimFormat(u.x)},${dimFormat(u.y)})`); if(typeof render==='function') render(); return;
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
        addCommandLog(`-> 測定点: (${dimFormat(u.x)},${dimFormat(u.y)}) - 引出先を指定`); if(typeof render==='function') render(); return;
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
            cmdState.mode = 'WAITING_MOVE_BASE'; setPrompt('基点 (移動の基準点):');
            cmdState.highlightIdx = idx;
            addCommandLog('-> エンティティ選択、基準点を指定'); render();
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
        const idx = cmdState.moveTarget;
        const dx = wcs.x - cmdState.moveBase.x, dy = wcs.y - cmdState.moveBase.y;
        saveUndo();
        moveEntity(entities[idx], dx, dy);
        addCommandLog(`-> 移動完了 (${dimFormat(dx)},${dimFormat(dy)})`);
        // 連続移動モード
        cmdState.mode = 'WAITING_MOVE_SELECT'; cmdState.highlightIdx = -1; setPrompt('移動対象 (右クリックで終了):');
        render(); return;
    }
    // -- COPY --
    if(mode === 'WAITING_COPY_SELECT') {
        const idx = hitTestEntity(mouse.screenX, mouse.screenY);
        if(idx >= 0) {
            cmdState.moveTarget = idx;
            cmdState.mode = 'WAITING_COPY_BASE'; setPrompt('基点 (コピーの基準点):');
            cmdState.highlightIdx = idx;
            addCommandLog('-> エンティティ選択、基準点を指定'); render();
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
        const idx = cmdState.moveTarget;
        const dx = wcs.x - cmdState.moveBase.x, dy = wcs.y - cmdState.moveBase.y;
        saveUndo();
        const copy = JSON.parse(JSON.stringify(entities[idx]));
        moveEntity(copy, dx, dy);
        entities.push(copy);
        addCommandLog(`-> コピー完了 (${dimFormat(dx)},${dimFormat(dy)})`);
        cmdState.mode = 'WAITING_COPY_SELECT'; cmdState.highlightIdx = -1; setPrompt('コピー対象 (右クリックで終了):');
        render(); return;
    }
}

// ===== エンティティ移動ヘルパー =====
function moveEntity(e, dx, dy) {
    if(e.type === 'LINE') { e.x1+=dx; e.y1+=dy; e.x2+=dx; e.y2+=dy; }
    else if(e.type === 'CIRCLE' || e.type === 'ARC') { e.cx+=dx; e.cy+=dy; }
    else if(e.type === 'RECTANG') { e.x1+=dx; e.y1+=dy; e.x2+=dx; e.y2+=dy; }
    else if(e.type === 'PLINE') { e.points.forEach(p => { p.x+=dx; p.y+=dy; }); }
    else if(e.type === 'POINT') { e.x+=dx; e.y+=dy; }
    else if(e.type === 'DIMENSION') {
        if(e.p1) { e.p1.x+=dx; e.p1.y+=dy; e.p2.x+=dx; e.p2.y+=dy; }
        if(e.center) { e.center.x+=dx; e.center.y+=dy; }
        if(e.vertex) { e.vertex.x+=dx; e.vertex.y+=dy; e.arm1.x+=dx; e.arm1.y+=dy; e.arm2.x+=dx; e.arm2.y+=dy; }
        if(e.point) { e.point.x+=dx; e.point.y+=dy; }
        if(e.leader) { e.leader.x+=dx; e.leader.y+=dy; }
        if(e.leaderX) { e.leaderX.x+=dx; e.leaderX.y+=dy; }
        if(e.leaderY) { e.leaderY.x+=dx; e.leaderY.y+=dy; }
    }
}

// アクションバー表示用のヘルパー
function _showDimActionBar(isContinuous) {
    const actionbar = document.getElementById('fs-dim-actionbar');
    if(actionbar) actionbar.style.display = 'flex';
    const toggleBtn = document.getElementById('dim-mode-toggle');
    if(toggleBtn) toggleBtn.style.display = isContinuous ? 'inline-block' : 'none';
    const dirBtn = document.getElementById('dim-dir-toggle');
    if(dirBtn) dirBtn.style.display = isContinuous ? 'inline-block' : 'none';
}

// ===== 寸法コマンドのディスパッチ =====
function processDimCommand(cmd) {
    if(cmd==='DLI'||cmd==='DIMLINEAR') { cmdState.mode='WAITING_DIMLIN_P1'; cmdState.points=[]; setPrompt('1点目: (☑️確定)'); setActiveTool('DIMLIN'); addCommandLog('-> [平行寸法] 1点目を指定'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DAL'||cmd==='DIMALIGNED') { cmdState.mode='WAITING_DIMALN_P1'; cmdState.points=[]; setPrompt('1点目: (☑️確定)'); setActiveTool('DIMALN'); addCommandLog('-> [整列寸法] 1点目を指定'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DRA'||cmd==='DIMRADIUS') { cmdState.mode='WAITING_DIMRAD_SELECT'; cmdState.dimTarget=null; setPrompt('円/弧を選択: (☑️確定)'); setActiveTool('DIMRAD'); addCommandLog('-> [半径寸法] 円または弧を選択'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DDI'||cmd==='DIMDIAMETER') { cmdState.mode='WAITING_DIMDIA_SELECT'; cmdState.dimTarget=null; setPrompt('円/弧を選択: (☑️確定)'); setActiveTool('DIMDIA'); addCommandLog('-> [直径寸法] 円または弧を選択'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DAN'||cmd==='DIMANGULAR') { cmdState.mode='WAITING_DIMANG_P1'; cmdState.points=[]; setPrompt('頂点: (☑️確定)'); setActiveTool('DIMANG'); addCommandLog('-> [角度寸法] 頂点を指定'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='DOR'||cmd==='DIMORDINATE') { cmdState.mode='WAITING_DIMORD_P1'; cmdState.points=[]; setPrompt('測定点: (☑️確定)'); setActiveTool('DIMORD'); addCommandLog('-> [座標寸法] 測定点を指定 (XY一括表示)'); _showDimActionBar(false); if(typeof render==='function') render(); return true; }
    if(cmd==='M'||cmd==='MOVE') { cmdState.mode='WAITING_MOVE_SELECT'; cmdState.moveTarget=undefined; setPrompt('移動対象:'); setActiveTool('MOVE'); addCommandLog('-> [移動] エンティティをクリック'); return true; }
    if(cmd==='CO'||cmd==='COPY') { cmdState.mode='WAITING_COPY_SELECT'; cmdState.moveTarget=undefined; setPrompt('コピー対象:'); setActiveTool('COPY'); addCommandLog('-> [コピー] エンティティをクリック'); return true; }
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