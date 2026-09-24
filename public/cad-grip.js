// ===== Web CAD 点を動かす（グリップ） =====
// cad-grip.js - 1つだけ選んだ図形に、つかめる点（グリップ: 端点・頂点・中点・中心など）を出す。
//               グリップを押したまま動かして離すと、離した所へその点を動かす（スナップ・ルーペが使える）。
//               グリップをタップ（クリック）しただけなら「つかんだ」状態になり、次に指定した点へ動かす。
//               （グリップの上から始めないかぎり、1本指でなぞって座標を読んでも図形は動かない）
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const GRIP_MAX = 400;         // これより頂点の多いポリラインにはグリップを出さない
const GRIP_ADD_MIN_PX = 40;   // 画面でこれより短い辺には、頂点を足すグリップ（辺の中点）を出さない

function _gripSizePx() { return (typeof isMobile === 'function' && isMobile()) ? 12 : 8; }
// グリップを出す図形の番号（IDLE でタップして1つだけ選んだ図形。ブロックの部品・塗りつぶし・写真のピンは除く）
function gripTargetIndex() {
    const m = cmdState.mode;
    if(m !== 'IDLE' && m !== 'WAITING_GRIP_DEST') return -1;
    if(document.body.classList.contains('fullscreen-mode')) return -1; // 座標読取モード
    if(typeof guideTourActive === 'function' && guideTourActive()) return -1;
    const sel = cmdState.selectedIndices || [];
    if(sel.length > 1) return -1;
    const idx = sel.length === 1 ? sel[0] : cmdState.highlightIdx;
    const e = entities[idx];
    if(!e || e.ins || e.hidden || e.type === 'HATCH' || e.type === 'PIN') return -1;
    if(e.layer !== undefined && layers[e.layer] && !layers[e.layer].visible) return -1;
    return idx;
}
function _gripArcMid(e) {
    const ccw = e.counterclockwise !== false;
    const span = ccw ? normalizeAngle(e.endAngle - e.startAngle) : normalizeAngle(e.startAngle - e.endAngle);
    return e.startAngle + (ccw ? 1 : -1) * span / 2;
}
// 図形 e のグリップ { x, y, kind, i }（kind: 動かし方）
function gripPoints(e) {
    const g = [], add = (x, y, kind, i) => g.push({ x, y, kind, i: i || 0 });
    if(e.type === 'LINE') { add(e.x1, e.y1, 'p1'); add(e.x2, e.y2, 'p2'); add((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, 'mid'); }
    else if(e.type === 'PLINE') {
        const P = e.points || [];
        if(P.length > GRIP_MAX) return g;
        P.forEach((p, i) => add(p.x, p.y, 'v', i));
        const n = e.closed ? P.length : P.length - 1;
        for(let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % P.length]; add((a.x + b.x) / 2, (a.y + b.y) / 2, 'vadd', i); }
    } else if(e.type === 'RECTANG') {
        const c = [[e.x1, e.y1], [e.x2, e.y1], [e.x2, e.y2], [e.x1, e.y2]];
        c.forEach(([x, y], i) => add(x, y, 'rc', i));
        [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([a, b], i) => add((c[a][0] + c[b][0]) / 2, (c[a][1] + c[b][1]) / 2, 're', i));
    } else if(e.type === 'CIRCLE') {
        add(e.cx, e.cy, 'c');
        for(let i = 0; i < 4; i++) add(e.cx + e.radius * Math.cos(i * Math.PI / 2), e.cy + e.radius * Math.sin(i * Math.PI / 2), 'q', i);
    } else if(e.type === 'ARC') {
        const at = (a) => ({ x: e.cx + e.radius * Math.cos(a), y: e.cy + e.radius * Math.sin(a) });
        const s = at(e.startAngle), t = at(e.endAngle), m = at(_gripArcMid(e));
        add(e.cx, e.cy, 'c'); add(s.x, s.y, 'as'); add(t.x, t.y, 'ae'); add(m.x, m.y, 'am');
    } else if(e.type === 'ELLIPSE') {
        const r = e.rotation || 0, c = Math.cos(r), s = Math.sin(r);
        add(e.cx, e.cy, 'c');
        add(e.cx + e.rx * c, e.cy + e.rx * s, 'ex', 0); add(e.cx - e.rx * c, e.cy - e.rx * s, 'ex', 1);
        add(e.cx - e.ry * s, e.cy + e.ry * c, 'ey', 0); add(e.cx + e.ry * s, e.cy - e.ry * c, 'ey', 1);
    } else if(e.type === 'TEXT' || e.type === 'POINT') add(e.x, e.y, 'pt');
    else if(e.type === 'DIMENSION') {
        const st = e.subType;
        if((st === 'LINEAR' || st === 'ALIGNED') && e.p1 && e.p2) {
            add(e.p1.x, e.p1.y, 'd1'); add(e.p2.x, e.p2.y, 'd2');
            const P = dimLinePrims(st, e.p1, e.p2, e.offset ?? 30, e.dimDir, e.dimRot, 1 / (view.scale || 1));
            add(P.textAt.x, P.textAt.y, 'dl');
        } else if((st === 'RADIUS' || st === 'DIAMETER') && e.center) {
            const a = e.angle || 0; add(e.center.x + e.radius * Math.cos(a), e.center.y + e.radius * Math.sin(a), 'da');
        } else if(st === 'ANGULAR' && e.vertex && e.arm1 && e.arm2) {
            const gm = dimAngularGeom(e), R = e.arcRadius || 40, am = gm.a1 + gm.d / 2;
            add(e.vertex.x + R * Math.cos(am), e.vertex.y + R * Math.sin(am), 'dr');
        } else if(st === 'ORDINATE' && e.point && e.leaderCoord) add(e.leaderCoord.x, e.leaderCoord.y, 'dL');
    }
    return g;
}
// いま画面に出すグリップ（短い辺の「頂点を足す」は出さない）
function gripVisible(e) {
    return gripPoints(e).filter(g => {
        if(g.kind !== 'vadd') return true;
        const P = e.points, a = P[g.i], b = P[(g.i + 1) % P.length];
        const sa = wcsToScreen(a.x, a.y), sb = wcsToScreen(b.x, b.y);
        return Math.hypot(sb.x - sa.x, sb.y - sa.y) >= GRIP_ADD_MIN_PX;
    });
}
// 画面の点 (sx,sy) にあるグリップ（無ければ null）
function gripHitAt(idx, sx, sy) {
    const e = entities[idx];
    if(!e) return null;
    let best = null, bd = Math.max(10, ((typeof hitRadiusPx === 'function') ? hitRadiusPx() : 5) + 4);
    gripVisible(e).forEach(g => {
        const s = wcsToScreen(g.x, g.y), d = Math.hypot(s.x - sx, s.y - sy);
        if(d <= bd) { bd = d; best = g; }
    });
    return best;
}
function gripHitTest(sx, sy) { const idx = gripTargetIndex(); return idx >= 0 && !!gripHitAt(idx, sx, sy); }

// 3点（始点・中点・終点のうち1つを P に替えた）を通る円弧にする
function _gripArc3(e, kind, P) {
    const at = (a) => ({ x: e.cx + e.radius * Math.cos(a), y: e.cy + e.radius * Math.sin(a) });
    let s = at(e.startAngle), t = at(e.endAngle), m = at(_gripArcMid(e));
    if(kind === 'as') s = P; else if(kind === 'ae') t = P; else m = P;
    // 始点を原点にして計算する（公共座標の大きな値でも桁が落ちないように）
    const c0 = circumcenter(0, 0, m.x - s.x, m.y - s.y, t.x - s.x, t.y - s.y);
    if(!c0) return '3点が一直線になるので、円弧にできません';
    const cc = { x: s.x + c0.x, y: s.y + c0.y };
    const sa = Math.atan2(s.y - cc.y, s.x - cc.x), ea = Math.atan2(t.y - cc.y, t.x - cc.x), ma = Math.atan2(m.y - cc.y, m.x - cc.x);
    e.cx = cc.x; e.cy = cc.y; e.radius = Math.hypot(c0.x, c0.y);
    e.startAngle = sa; e.endAngle = ea; e.counterclockwise = isAngleBetweenCCW(ma, sa, ea);
    return null;
}
// グリップ g を点 P へ動かした形にする（e を書き換える）。できないときは理由の文字列
function gripApply(e, g, P) {
    const dx = P.x - g.x, dy = P.y - g.y;
    const rad = () => Math.hypot(P.x - e.cx, P.y - e.cy);
    switch(g.kind) {
    case 'p1': e.x1 = P.x; e.y1 = P.y; break;
    case 'p2': e.x2 = P.x; e.y2 = P.y; break;
    case 'mid': e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy; break;
    case 'v': e.points[g.i] = Object.assign({}, e.points[g.i], { x: P.x, y: P.y }); break;
    case 'vadd': e.points.splice(g.i + 1, 0, { x: P.x, y: P.y }); break;
    case 'rc':
        if(g.i === 0 || g.i === 3) e.x1 = P.x; else e.x2 = P.x;
        if(g.i === 0 || g.i === 1) e.y1 = P.y; else e.y2 = P.y;
        break;
    case 're': if(g.i === 0) e.y1 = P.y; else if(g.i === 1) e.x2 = P.x; else if(g.i === 2) e.y2 = P.y; else e.x1 = P.x; break;
    case 'c': e.cx += dx; e.cy += dy; break;
    case 'q': if(!(rad() > 0)) return '半径が 0 になります'; e.radius = rad(); break;
    case 'as': case 'ae': case 'am': return _gripArc3(e, g.kind, P);
    case 'ex': if(!(rad() > 0)) return '半径が 0 になります'; e.rx = rad(); _editSetRot(e, 'rotation', Math.atan2(P.y - e.cy, P.x - e.cx) + (g.i ? Math.PI : 0)); break;
    case 'ey': if(!(rad() > 0)) return '半径が 0 になります'; e.ry = rad(); break;
    case 'pt': e.x = P.x; e.y = P.y; break;
    case 'd1': case 'd2': case 'dl': {
        // 向きが自動の平行寸法は、いまの向き（横・縦）に決めてから動かす
        if(e.subType === 'LINEAR' && !e.dimDir) e.dimDir = Math.abs(e.p2.x - e.p1.x) >= Math.abs(e.p2.y - e.p1.y) ? 'H' : 'V';
        const f = _dimLineFrame(e.subType, e.p1, e.p2, e.dimDir, e.dimRot);
        if(g.kind === 'dl') { e.offset = (P.x - e.p1.x) * f.n.x + (P.y - e.p1.y) * f.n.y; break; }
        // 測った点を動かしても、平行寸法の寸法線は同じ所に残す
        if(g.kind === 'd1' && e.subType === 'LINEAR') e.offset = (e.offset ?? 30) + (e.p1.x - P.x) * f.n.x + (e.p1.y - P.y) * f.n.y;
        const p = g.kind === 'd1' ? e.p1 : e.p2;
        p.x = P.x; p.y = P.y;
        break;
    }
    case 'da': e.angle = Math.atan2(P.y - e.center.y, P.x - e.center.x); break;
    case 'dr': { const R = Math.hypot(P.x - e.vertex.x, P.y - e.vertex.y); if(!(R > 0)) return '半径が 0 になります'; e.arcRadius = R; break; }
    case 'dL': e.leaderCoord.x = P.x; e.leaderCoord.y = P.y; break;
    default: return 'この点は動かせません';
    }
    delete e.bbox; delete e._hits;
    return null;
}

// ===== 操作 =====
// IDLE のタップ・クリックがグリップの上なら、そのグリップをつかむ（true を返す）
function gripTap(sx, sy) {
    if(cmdState.mode !== 'IDLE') return false;
    const idx = gripTargetIndex();
    if(idx < 0) return false;
    const g = gripHitAt(idx, sx, sy);
    if(!g) return false;
    const e = entities[idx];
    cmdState.mode = 'WAITING_GRIP_DEST';
    cmdState.grip = { id: _idOf(e), kind: g.kind, i: g.i, x: g.x, y: g.y };
    cmdState.highlightIdx = idx;
    cmdState.selectedIndices = [];
    const add = g.kind === 'vadd';
    setPrompt(add ? '点を足す: 足す位置を指定' : '点を動かす: 動かす先を指定');
    addCommandLog(add ? '-> 辺に点を足します。足す位置を指定（Esc・❌でやめる）' : '-> 点をつかみました。動かす先を指定（Esc・❌でやめる）');
    if(typeof showActionbarControls === 'function') showActionbarControls({ hideConfirm: true }); // ❌終了 だけ
    if(typeof updateSelectionBar === 'function') updateSelectionBar();
    if(navigator.vibrate) navigator.vibrate(15);
    render();
    return true;
}
// 動かしたあと・やめたあとも、その図形を選んだままにする
function gripReselect(id) {
    const idx = entityIndexById(id);
    if(idx < 0 || cmdState.mode !== 'IDLE') return;
    cmdState.highlightIdx = idx;
    cmdState.selectedIndices = [];
    if(typeof updatePropertiesPanel === 'function') updatePropertiesPanel();
    if(typeof updateSelectionBar === 'function') updateSelectionBar();
    render();
}
// 点の入力（cad-command.js の _handlePointInputCore から）。つかんだ点を動かして true
function handleGripPointInput(m, wcs) {
    if(m !== 'WAITING_GRIP_DEST') return false;
    const gp = cmdState.grip, idx = gp ? entityIndexById(gp.id) : -1, e = entities[idx];
    if(!e) { resetCommand(); return true; }
    const err = gripApply(JSON.parse(JSON.stringify(e)), gp, wcs); // 先に試す（できないときは図形を変えない）
    if(err) { addCommandLog('-> ' + err); if(typeof showToast === 'function') showToast(err, 3000); return true; }
    saveUndo();
    gripApply(e, gp, wcs);
    _bumpGeomEpoch();
    addCommandLog(gp.kind === 'vadd' ? '-> 点を足しました' : '-> 点を動かしました');
    if(navigator.vibrate) navigator.vibrate(20);
    resetCommand();
    gripReselect(gp.id);
    return true;
}
// グリップと、つかんだ点を動かした形の表示
function drawGripOverlay() {
    const idx = gripTargetIndex();
    if(idx < 0) return;
    const e = entities[idx];
    const hot = cmdState.mode === 'WAITING_GRIP_DEST' ? cmdState.grip : null;
    if(hot && entityIndexById(hot.id) !== idx) return;
    ctx.save();
    if(hot) {
        const P = getInputPoint(), trial = JSON.parse(JSON.stringify(e));
        if(!gripApply(trial, hot, P)) {
            ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.9;
            editDrawShape(trial, '#ffff00');
            ctx.globalAlpha = 1;
        }
        const a = wcsToScreen(hot.x, hot.y), b = wcsToScreen(P.x, P.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
    }
    const size = _gripSizePx(), h = size / 2;
    gripVisible(e).forEach(g => {
        const s = wcsToScreen(g.x, g.y);
        const isHot = !!hot && hot.kind === g.kind && hot.i === g.i;
        ctx.lineWidth = 1;
        if(g.kind === 'vadd' && !isHot) {
            // 頂点を足すグリップ: 中が透けた小さめの四角
            ctx.fillStyle = 'rgba(51,153,255,0.25)'; ctx.strokeStyle = '#3399ff';
            ctx.fillRect(s.x - h * 0.8, s.y - h * 0.8, size * 0.8, size * 0.8); ctx.strokeRect(s.x - h * 0.8, s.y - h * 0.8, size * 0.8, size * 0.8);
        } else {
            ctx.fillStyle = isHot ? '#00ff88' : '#3399ff'; ctx.strokeStyle = '#0b1726';
            ctx.fillRect(s.x - h, s.y - h, size, size); ctx.strokeRect(s.x - h, s.y - h, size, size);
        }
    });
    ctx.restore();
}
