// ===== Web CAD 円（CIRCLE）の描き方 =====
// cad-circle.js - 円コマンドの描き方を選ぶ（v5.40）。
//
// ・固定半径（中心をタップ → ☑確定）・中心と半径（中心 → 円周の点 → ☑確定）は以前から（cad-command.js）
// ・3点: 円周の3点を通る円。3点目をタップすると仮の円が出て、☑確定 で描く（中心と半径はコマンド欄に出す）
// ・2点（直径）: 直径の両端の2点
// ・接線・接線・半径: 2つの線・円に接する、決めた半径の円。線（ポリライン・長方形の辺も）は延ばした直線として、
//   円弧は円として扱い、接する所がタップした所に近い円を選ぶ（AutoCAD の TTR と同じ）
// ・コマンド欄: 円の途中で 3P・2P・TTR（T）と打つと切り替わる。CEN は中心と半径。接線・接線・半径の途中で数を打つと半径
// ・描き方は lastParams.circleMode（'auto' | 'manual' | '3p' | '2p' | 'ttr'）に覚える

const CIRCLE_MODES = [
    ['auto', '固定半径', '中心をタップ → ☑確定（同じ半径で続けて置く）'],
    ['manual', '中心と半径', '中心 → 円周の点 → ☑確定'],
    ['3p', '3点', '円周の3点を通る円（中心と半径を出します）'],
    ['2p', '2点（直径）', '直径の両端の2点'],
    ['ttr', '接線・接線・半径', '2つの線・円に接する、半径を決めた円'],
];
const _CIRCLE_NEW_MODES = new Set(['WAITING_CIRCLE_3P', 'WAITING_CIRCLE_2P', 'WAITING_CIRCLE_TTR']);
function circleMode() { const m = lastParams.circleMode; return CIRCLE_MODES.some(([k]) => k === m) ? m : 'auto'; }
function _circleR() { return parseFloat(lastParams.radius) || 50; }
// 下のバーの切り替えボタンの文字
function circleModeButtonText() {
    const m = circleMode(), r = lengthText(_circleR());
    if(m === 'auto') return `🔄 自動 (半径:${r})`;
    if(m === 'manual') return '🔄 手動 (2点)';
    if(m === 'ttr') return `🔄 接線・接線・半径 (半径:${r})`;
    return '🔄 ' + CIRCLE_MODES.find(([k]) => k === m)[1];
}

// ===== 形の計算 =====
// 3点を通る円 { cx, cy, r }。一直線・同じ点なら null（座標が大きくても桁が落ちないよう、1点目からの差で計算する）
function circleFrom3(a, b, c) {
    const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y;
    const d = 2 * (bx * cy - by * cx), lb = bx * bx + by * by, lc = cx * cx + cy * cy;
    if(!(lb > 0 && lc > 0) || Math.abs(d) <= 1e-12 * Math.max(lb, lc)) return null;
    const ux = (cy * lb - by * lc) / d, uy = (bx * lc - cx * lb) / d;
    return { cx: a.x + ux, cy: a.y + uy, r: Math.hypot(ux, uy) };
}
// 直径の両端の2点の円。同じ点なら null
function circleFrom2(a, b) {
    const r = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    return r > 0 ? { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r } : null;
}
// 接する相手の形: { k: 'line', a, b }（延ばした直線）か { k: 'circle', c, r }。pick: タップした所（ポリライン・長方形はその近くの辺）
function circleTanShape(e, pick) {
    if(!e) return null;
    if(e.type === 'LINE') return Math.hypot(e.x2 - e.x1, e.y2 - e.y1) > 0 ? { k: 'line', a: { x: e.x1, y: e.y1 }, b: { x: e.x2, y: e.y2 } } : null;
    if((e.type === 'CIRCLE' || e.type === 'ARC') && e.radius > 0) return { k: 'circle', c: { x: e.cx, y: e.cy }, r: e.radius };
    if(e.type === 'PLINE' || e.type === 'RECTANG') {
        const P = e.type === 'RECTANG' ? [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }, { x: e.x1, y: e.y1 }]
            : (e.closed && e.points.length > 2 ? e.points.concat([e.points[0]]) : e.points);
        if(!P || P.length < 2) return null;
        const q = editPathProject(P, pick.x, pick.y);
        if(!q) return null;
        const a = P[q.i], b = P[q.i + 1];
        return Math.hypot(b.x - a.x, b.y - a.y) > 0 ? { k: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } } : null;
    }
    return null;
}
// 半径 r の円の中心が通る所（線なら両側に r ずらした直線、円なら半径 R+r と |R−r| の円）
function _circleLoci(s, r) {
    if(s.k === 'line') {
        const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), ux = (s.b.x - s.a.x) / L, uy = (s.b.y - s.a.y) / L;
        return [1, -1].map((g) => ({ k: 'line', p: { x: s.a.x - uy * r * g, y: s.a.y + ux * r * g }, u: { x: ux, y: uy } }));
    }
    const out = [{ k: 'circle', c: s.c, r: s.r + r }];
    if(Math.abs(s.r - r) > 1e-12 * Math.max(s.r, r)) out.push({ k: 'circle', c: s.c, r: Math.abs(s.r - r) });
    return out;
}
function _circleMeet(A, B) {
    if(A.k === 'circle' && B.k === 'line') return _circleMeet(B, A);
    if(A.k === 'line' && B.k === 'line') {
        const den = A.u.x * B.u.y - A.u.y * B.u.x;
        if(Math.abs(den) < 1e-12) return []; // 平行
        const t = ((B.p.x - A.p.x) * B.u.y - (B.p.y - A.p.y) * B.u.x) / den;
        return [{ x: A.p.x + A.u.x * t, y: A.p.y + A.u.y * t }];
    }
    if(A.k === 'line') { // 直線と円
        const fx = A.p.x - B.c.x, fy = A.p.y - B.c.y, bq = fx * A.u.x + fy * A.u.y, cq = fx * fx + fy * fy - B.r * B.r;
        const disc = bq * bq - cq;
        if(disc < -1e-12 * B.r * B.r) return [];
        const h = Math.sqrt(Math.max(0, disc));
        return [-bq - h, -bq + h].map((t) => ({ x: A.p.x + A.u.x * t, y: A.p.y + A.u.y * t }));
    }
    return intersectCircleCircle({ cx: A.c.x, cy: A.c.y, radius: A.r }, { cx: B.c.x, cy: B.c.y, radius: B.r });
}
// 中心 c・半径 r の円が形 s に接する所
function _circleTouch(s, c, r) {
    if(s.k === 'line') {
        const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, t = ((c.x - s.a.x) * dx + (c.y - s.a.y) * dy) / (dx * dx + dy * dy);
        return { x: s.a.x + dx * t, y: s.a.y + dy * t };
    }
    const d = Math.hypot(c.x - s.c.x, c.y - s.c.y);
    if(!(d > 0)) return null;
    const w = { x: (c.x - s.c.x) / d, y: (c.y - s.c.y) / d };
    const p1 = { x: s.c.x + w.x * s.r, y: s.c.y + w.y * s.r }, p2 = { x: s.c.x - w.x * s.r, y: s.c.y - w.y * s.r };
    return Math.abs(Math.hypot(p1.x - c.x, p1.y - c.y) - r) <= Math.abs(Math.hypot(p2.x - c.x, p2.y - c.y) - r) ? p1 : p2;
}
// 2つの形に接する半径 r の円のうち、接する所がタップした所（p1・p2）に一番近いもの { cx, cy, r, t1, t2 }。無ければ null
function circleTanTanRadius(s1, p1, s2, p2, r) {
    if(!(r > 0) || !s1 || !s2) return null;
    let best = null;
    _circleLoci(s1, r).forEach((A) => _circleLoci(s2, r).forEach((B) => _circleMeet(A, B).forEach((c) => {
        const t1 = _circleTouch(s1, c, r), t2 = _circleTouch(s2, c, r);
        if(!t1 || !t2) return;
        const score = Math.hypot(t1.x - p1.x, t1.y - p1.y) + Math.hypot(t2.x - p2.x, t2.y - p2.y);
        if(!best || score < best.score - 1e-12) best = { cx: c.x, cy: c.y, r, t1, t2, score };
    })));
    return best;
}
function _circleSameShape(a, b) {
    if(a.k !== b.k) return false;
    const tol = 1e-9 * Math.max(1, Math.abs(a.k === 'line' ? a.a.x : a.c.x));
    if(a.k === 'circle') return Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) <= tol && Math.abs(a.r - b.r) <= tol;
    const cross = (p, q, s) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
    const L = Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y);
    return Math.abs(cross(a.a, a.b, b.a)) / L <= tol && Math.abs(cross(a.a, a.b, b.b)) / L <= tol; // 同じ直線の上
}

// ===== 描き方を始める・切り替える =====
// how: 'start'（コマンドを始めた）・'panel'（作図設定の「この設定で作図開始」）・'switch'（下のバーの 🔄・コマンド欄の 3P など）・'next'（描いたあと続ける）
function circleBeginMode(how) {
    const m = circleMode(), r = _circleR(), rt = lengthText(r);
    const log = (s) => { if(how !== 'next') addCommandLog(s); }; // 描いたあと続けるとき（next）は書かない
    cmdState.startWcs = null; cmdState.lastInputWcs = null; cmdState.points = []; cmdState.circlePreview = null; cmdState.circleTan = [];
    if(m === 'auto') {
        cmdState.presetRadius = r; cmdState.mode = 'WAITING_CIRCLE_CENTER';
        setPrompt(how === 'start' ? `円 (自動・半径${rt}): 中心を指定 → 「確定」` : `円 (自動・半径${rt}): 中心をタップ → 「確定」`);
        log(how === 'start' ? `-> 円作図: 【固定半径 (自動: 半径${rt})】 中心を指定して「確定」`
            : how === 'panel' ? `-> 半径 ${rt} の固定円モード。中心を指定して「確定」` : `-> 円作図モード: 【固定半径 (自動)】 半径=${rt}`);
    } else if(m === 'manual') {
        cmdState.presetRadius = 0; cmdState.mode = 'WAITING_CIRCLE_CENTER';
        setPrompt(how === 'start' ? '円 (手動): 中心を指定:' : '円 (手動): 1点目(中心)をタップ');
        log(how === 'start' ? '-> 円作図: 【手動 (2点指定)】 中心を指定' : how === 'panel' ? '-> 手動円モード。中心を指定' : '-> 円作図モード: 【手動 (2点指定)】');
    } else if(m === '3p') {
        cmdState.mode = 'WAITING_CIRCLE_3P';
        setPrompt('円 (3点): 円周の1点目を指定');
        log('-> 円作図: 【3点】 円周の3点を指定（3点目のあと「確定」）');
    } else if(m === '2p') {
        cmdState.mode = 'WAITING_CIRCLE_2P';
        setPrompt('円 (2点・直径): 直径の1点目を指定');
        log('-> 円作図: 【2点（直径）】 直径の両端を指定（2点目のあと「確定」）');
    } else {
        cmdState.mode = 'WAITING_CIRCLE_TTR';
        setPrompt(`円 (接線・接線・半径${rt}): 1つ目の線・円をタップ`);
        log(`-> 円作図: 【接線・接線・半径 (半径${rt})】 接する線・円を2つタップ（半径は数を打つと変わります）`);
    }
    _circleBar();
    render();
}
// 下のバー（☑確定 は、新しい描き方では円が決まってから出す）
function _circleBar() {
    showActionbarControls({ showMode: true, hideConfirm: _CIRCLE_NEW_MODES.has(cmdState.mode) && !cmdState.circlePreview });
    updateCircleActionBar();
}
// 描き方を選ぶ（下のバーの 🔄）
function circleChooseMode() {
    const now = circleMode();
    return cadChoose({ title: '円の描き方', message: CIRCLE_MODES.map(([, l, d]) => `${l}: ${d}`).join('\n'),
        choices: CIRCLE_MODES.map(([k, l]) => ({ label: k === now ? `✓ ${l}` : l, value: k, kind: k === now ? 'primary' : 'sub' })) }, (v) => {
        if(!v) return;
        lastParams.circleMode = v;
        saveLastParams();
        if(navigator.vibrate) navigator.vibrate(15);
        if(String(cmdState.mode).startsWith('WAITING_CIRCLE_')) circleBeginMode('switch');
    });
}
// コマンド欄で打ったもの（processCommand から）。円の途中なら処理して true
function circleCommandInput(cmd) {
    const m = String(cmdState.mode);
    if(!m.startsWith('WAITING_CIRCLE_')) return false;
    const key = { '3P': '3p', '2P': '2p', 'TTR': 'ttr', 'T': 'ttr', 'CEN': 'manual' }[cmd];
    if(key) { lastParams.circleMode = key; saveLastParams(); circleBeginMode('switch'); return true; }
    const num = /^(-?\d+(\.\d+)?)$/.exec(cmd);
    if(num && m === 'WAITING_CIRCLE_TTR') {
        const r = fromDisplayUnit(parseFloat(num[1]), 'len');
        if(!(r > 0)) { if(typeof _cmdInputError === 'function') _cmdInputError('半径は 0 より大きい数を入れてください'); return true; }
        lastParams.radius = String(+r.toFixed(6));
        saveLastParams();
        addCommandLog(`-> 半径: ${lengthText(r)}`);
        if((cmdState.circleTan || []).length === 2) _circleTtrSolve(); else setPrompt(`円 (接線・接線・半径${lengthText(r)}): ${(cmdState.circleTan || []).length ? '2つ目' : '1つ目'}の線・円をタップ`);
        _circleBar();
        render();
        return true;
    }
    return false;
}

// ===== 点を入れたとき（cad-command.js の _handlePointInputCore から）。新しい描き方なら処理して true =====
function circleHandlePoint(wcs) {
    const m = cmdState.mode;
    if(!_CIRCLE_NEW_MODES.has(m)) return false;
    hidePropertyPanel();
    if(m === 'WAITING_CIRCLE_TTR') { _circleTtrPick(); return true; }
    const P = cmdState.points || (cmdState.points = []);
    const need = m === 'WAITING_CIRCLE_3P' ? 3 : 2, u = wcsToUcs(wcs.x, wcs.y);
    if(P.length < need - 1) {
        P.push({ x: wcs.x, y: wcs.y });
        cmdState.lastInputWcs = { x: wcs.x, y: wcs.y };
        addCommandLog(`-> ${P.length}点目: ${coordPairText(u.x, u.y)}`);
        setPrompt(m === 'WAITING_CIRCLE_3P' ? `円 (3点): 円周の${P.length + 1}点目を指定` : '円 (2点・直径): 直径のもう一方の端を指定');
    } else {
        const c = m === 'WAITING_CIRCLE_3P' ? circleFrom3(P[0], P[1], wcs) : circleFrom2(P[0], wcs);
        if(!c) {
            const why = m === 'WAITING_CIRCLE_3P' ? '3点が一直線（または同じ点）なので、円になりません' : '同じ点なので、円になりません';
            addCommandLog('-> ' + why);
            if(typeof showToast === 'function') showToast(why + '。別の点を指定してください', { kind: 'warn', ms: 3000 });
            return true;
        }
        cmdState.circlePreview = Object.assign(c, { last: { x: wcs.x, y: wcs.y } });
        const cu = wcsToUcs(c.cx, c.cy);
        addCommandLog(`-> ${need}点目: ${coordPairText(u.x, u.y)} → 中心 ${coordPairText(cu.x, cu.y)}・半径 ${lengthText(c.r)}（「確定」で描く）`);
        setPrompt(`円 (${m === 'WAITING_CIRCLE_3P' ? '3点' : '2点・直径'}): 半径 ${lengthText(c.r)}。よければ「確定」（タップし直すと動きます）`);
    }
    _circleBar();
    render();
    return true;
}
// 接線・接線・半径: 線・円をタップした
function _circleTtrPick() {
    const T = cmdState.circleTan || (cmdState.circleTan = []);
    const idx = hitTestEntity(mouse.screenX, mouse.screenY), pick = screenToWcs(mouse.screenX, mouse.screenY);
    const s = idx >= 0 ? circleTanShape(entities[idx], pick) : null;
    if(!s) { if(typeof showToast === 'function') showToast('線・ポリライン・長方形・円・円弧をタップしてください', 2500); return; }
    if(T.length >= 2) { T.length = 1; cmdState.circlePreview = null; } // 決まったあとのタップは2つ目の選び直し
    if(T.length === 1 && _circleSameShape(T[0].s, s)) { if(typeof showToast === 'function') showToast('2つ目は、別の線・円をタップしてください', 2500); return; }
    T.push({ s, pick: { x: pick.x, y: pick.y } });
    addCommandLog(`-> ${T.length}つ目: ${s.k === 'line' ? '線' : '円'}`);
    if(T.length === 1) { setPrompt(`円 (接線・接線・半径${lengthText(_circleR())}): 2つ目の線・円をタップ`); _circleBar(); render(); return; }
    _circleTtrSolve();
    _circleBar();
    render();
}
function _circleTtrSolve() {
    const T = cmdState.circleTan, r = _circleR();
    const c = circleTanTanRadius(T[0].s, T[0].pick, T[1].s, T[1].pick, r);
    if(!c) {
        cmdState.circlePreview = null;
        T.length = 1;
        addCommandLog(`-> 半径 ${lengthText(r)} では、2つに接する円がありません（半径を変えるか、別のものをタップ）`);
        if(typeof showToast === 'function') showToast(`半径 ${lengthText(r)} では2つに接する円がありません`, { kind: 'warn', ms: 3000 });
        setPrompt(`円 (接線・接線・半径${lengthText(r)}): 2つ目の線・円をタップ`);
        return;
    }
    cmdState.circlePreview = c;
    const cu = wcsToUcs(c.cx, c.cy);
    addCommandLog(`-> 中心 ${coordPairText(cu.x, cu.y)}・半径 ${lengthText(r)}（「確定」で描く）`);
    setPrompt(`円 (接線・接線・半径${lengthText(r)}): よければ「確定」（2つ目をタップし直すと選び直せます）`);
}

// ===== ☑確定（cad-command.js の dimConfirmPoint から）。新しい描き方なら処理して true =====
function circleConfirm() {
    const m = cmdState.mode;
    if(!_CIRCLE_NEW_MODES.has(m)) return false;
    const c = cmdState.circlePreview;
    if(!c) { if(typeof showToast === 'function') showToast(m === 'WAITING_CIRCLE_TTR' ? '接する線・円を2つタップしてから「確定」' : '円周の点を指定してから「確定」', 2500); return true; }
    saveUndo();
    entities.push({ type: 'CIRCLE', layer: currentLayerIndex, color: null, cx: c.cx, cy: c.cy, radius: c.r });
    if(m !== 'WAITING_CIRCLE_TTR') { lastParams.radius = String(+c.r.toFixed(6)); saveLastParams(); } // 次の固定半径の案にも
    const cu = wcsToUcs(c.cx, c.cy);
    const how = m === 'WAITING_CIRCLE_3P' ? '3点' : m === 'WAITING_CIRCLE_2P' ? '2点・直径' : '接線・接線・半径';
    addCommandLog(`-> 円作成（${how}）: 中心 ${coordPairText(cu.x, cu.y)}・半径 ${lengthText(c.r)}（続けて次の円を描けます）`);
    if(navigator.vibrate) navigator.vibrate(20);
    circleBeginMode('next');
    return true;
}

// ===== 仮の線・円（cad-render.js の drawRubberBand から。点線の描き方の中で呼ぶ）。新しい描き方なら描いて true =====
function drawCirclePreview(mp) {
    const m = cmdState.mode;
    if(!_CIRCLE_NEW_MODES.has(m)) return false;
    const P = cmdState.points || [], pv = cmdState.circlePreview;
    const ring = (c) => { const s = wcsToScreen(c.cx, c.cy); ctx.beginPath(); ctx.arc(s.x, s.y, c.r * view.scale, 0, Math.PI * 2); ctx.stroke(); };
    const dot = (p) => { const s = wcsToScreen(p.x, p.y); ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.stroke(); };
    const cross = (c) => { const s = wcsToScreen(c.cx, c.cy); ctx.beginPath(); ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x + 7, s.y); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x, s.y + 7); ctx.stroke(); };
    // 決まる前は点線でカーソルまで
    if(!pv) {
        let c = null;
        if(m === 'WAITING_CIRCLE_3P' && P.length === 2) c = circleFrom3(P[0], P[1], mp);
        else if(m === 'WAITING_CIRCLE_2P' && P.length === 1) c = circleFrom2(P[0], mp);
        else if(m === 'WAITING_CIRCLE_3P' && P.length === 1) { const a = wcsToScreen(P[0].x, P[0].y), b = wcsToScreen(mp.x, mp.y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        if(c) { ring(c); cross(c); }
    }
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    P.forEach(dot);
    (cmdState.circleTan || []).forEach((t) => { // 選んだ線・円（緑）
        if(t.s.k === 'line') { const a = wcsToScreen(t.s.a.x, t.s.a.y), b = wcsToScreen(t.s.b.x, t.s.b.y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        else ring({ cx: t.s.c.x, cy: t.s.c.y, r: t.s.r });
    });
    if(pv) { // 「確定」で描く円（緑）・中心・接する所
        ring(pv); cross(pv);
        if(pv.t1) dot(pv.t1);
        if(pv.t2) dot(pv.t2);
        if(pv.last) dot(pv.last);
    }
    ctx.restore();
    return true;
}
