// ===== Web CAD オブジェクトスナップと点の指定 =====
// cad-snap.js - スナップ点の収集と選択、スナップ記号の描画、点の指定を助ける機能
//
//   スナップの種類: 端点・中点・中心・交点・垂線・接線・挿入点・四半円点・図心・等分点・延長・近接点
//                   （延長の仲間として 延長交点・垂線(延長) も出る）
//   延長の使い方  : 線・円弧の上で指（カーソル）を少し止めると、その線を「取得」し、延長線が使えるようになる
//   点の指定の補助: 次の1点だけのスナップ指定、重なった候補の切り替え（Tab / ⇄）、2点間の中点、相対座標の入力
//
// 座標は WCS（図面本来の座標）。測量の並びでは X＝北＝WCS の y、Y＝東＝WCS の x。

// ===== スナップの種類 =====
// key: osnapState のフラグ名 / tier: 1 = 幾何的な点（優先）、2 = 線の上の任意の点（1が無いときだけ）
const SNAP_TYPES = [
    { key: 'end',  label: '端点',     tier: 1 },
    { key: 'mid',  label: '中点',     tier: 1 },
    { key: 'cen',  label: '中心',     tier: 1 },
    { key: 'int',  label: '交点',     tier: 1 },
    { key: 'perp', label: '垂線',     tier: 1 },
    { key: 'tan',  label: '接線',     tier: 1 },
    { key: 'ins',  label: '挿入点',   tier: 1 },
    { key: 'qua',  label: '四半円点', tier: 1 },
    { key: 'gce',  label: '図心',     tier: 1 },
    { key: 'div',  label: '等分点',   tier: 1 },
    { key: 'ext',  label: '延長',     tier: 2 },
    { key: 'near', label: '近接点',   tier: 2 },
];
// 延長から派生する種類 → もとの種類（「次の1点だけ」の指定や記号の形で使う）
const SNAP_DERIVED = { '延長交点': '交点', '垂線(延長)': '垂線' };
const SNAP_DIV_OPTIONS = [3, 4, 5, 6, 8, 10];
const SNAP_ACQ_MAX = 3;          // 延長に使える線の数（取得した順に古いものから外れる）
const SNAP_ACQ_DWELL_MS = 350;   // 線の上でこの時間止まると取得
const OSNAP_PREFS_KEY = 'cad_osnap';

function _snapTier(t) {
    const base = SNAP_DERIVED[t] || t;
    const d = SNAP_TYPES.find(x => x.label === base);
    return d ? d.tier : 1;
}
function _snapBaseType(t) { return SNAP_DERIVED[t] || t; }

// ===== スナップ設定の保存（端末ごと） =====
function _loadOsnapPrefs() {
    try {
        const v = JSON.parse(localStorage.getItem(OSNAP_PREFS_KEY) || 'null');
        if(!v || typeof v !== 'object') return;
        SNAP_TYPES.forEach(t => { if(typeof v[t.key] === 'boolean') osnapState[t.key] = v[t.key]; });
        if(SNAP_DIV_OPTIONS.includes(v.divN)) osnapState.divN = v.divN;
    } catch { /* 読めなければ既定値 */ }
}
function _saveOsnapPrefs() {
    const o = {};
    SNAP_TYPES.forEach(t => { o[t.key] = !!osnapState[t.key]; });
    o.divN = osnapState.divN;
    try { localStorage.setItem(OSNAP_PREFS_KEY, JSON.stringify(o)); } catch { /* 保存できなくても今回は使える */ }
}
_loadOsnapPrefs();

// ===== スナップの状態 =====
let _snapOverride = null;     // 次の1点だけのスナップ指定 { key, label }
let _snapCycle = null;        // 候補の切り替え { sx, sy, index }（カーソルが動くと最初の候補に戻る）
let _snapLastArgs = null;     // 直前の findSnap の引数（切り替え時に同じ位置で探し直す）
let _snapHoverTmp = null;     // collectSnapPoints がカーソルに一番近い線を記録する
let _snapHover = null;        // いまカーソルが重なっている線（取得待ち）
let _snapHoverTimer = null;
let _lastInputWcs = null;     // 直前に入力した点（相対座標 @ の基準）

// スナップが入力に使われるか（OSNAP が OFF でも「次の1点だけ」の指定中は使う）
function snapActive() { return !!snapResult && (osnapState.main || !!snapResult.forced); }

// ===== 延長に使う線の取得 =====
function _snapAcquired() { return (cmdState && cmdState.snapAcq) || []; }
function _srcKey(s) {
    return s.kind === 'seg' ? `s:${s.x1},${s.y1},${s.x2},${s.y2}` : `a:${s.cx},${s.cy},${s.r},${s.sa},${s.ea},${s.ccw}`;
}
function _acquireSrc(src) {
    if(!cmdState.snapAcq) cmdState.snapAcq = [];
    const list = cmdState.snapAcq, key = _srcKey(src);
    const i = list.findIndex(s => _srcKey(s) === key);
    if(i >= 0) list.splice(i, 1); // 取り直したものは最新にする
    list.push(src);
    if(list.length > SNAP_ACQ_MAX) list.shift();
}
// カーソルが同じ線の上で少し止まったら取得する（通り過ぎただけの線は取得しない）
function _updateSnapHover(src, dPx, radius) {
    if(!src || dPx > radius) { _snapHover = null; clearTimeout(_snapHoverTimer); return; }
    const key = _srcKey(src);
    if(_snapHover && _snapHover.key === key) return;
    _snapHover = { key, src };
    clearTimeout(_snapHoverTimer);
    _snapHoverTimer = setTimeout(() => {
        if(!_snapHover || _snapHover.key !== key) return;
        const known = _snapAcquired().some(s => _srcKey(s) === key);
        _acquireSrc(src);
        if(!known && navigator.vibrate) navigator.vibrate(8);
        if(typeof renderOverlay === 'function') renderOverlay();
    }, SNAP_ACQ_DWELL_MS);
}
// テスト・操作用: 線を直接取得する
function acquireSnapLine(x1, y1, x2, y2) { _acquireSrc({ kind: 'seg', x1, y1, x2, y2 }); }

// ===== 楕円の計算（媒介変数 θ） =====
function _ellPt(e, t) {
    const c = Math.cos(e.rotation || 0), s = Math.sin(e.rotation || 0);
    const x = e.rx * Math.cos(t), y = e.ry * Math.sin(t);
    return { x: e.cx + x * c - y * s, y: e.cy + x * s + y * c };
}
function _ellD(e, t) {
    const c = Math.cos(e.rotation || 0), s = Math.sin(e.rotation || 0);
    const x = -e.rx * Math.sin(t), y = e.ry * Math.cos(t);
    return { x: x * c - y * s, y: x * s + y * c };
}
// 楕円の式の値（内側で負、楕円上で0）
function _ellImplicit(e, px, py) {
    const c = Math.cos(e.rotation || 0), s = Math.sin(e.rotation || 0);
    const dx = px - e.cx, dy = py - e.cy;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    return (lx / e.rx) * (lx / e.rx) + (ly / e.ry) * (ly / e.ry) - 1;
}
// f(θ)=0 となる θ（0〜2π を等分して符号が変わる区間を二分法で絞る。機械精度まで求める）
function _ellRoots(f, n) {
    const N = n || 180, step = 2 * Math.PI / N, out = [];
    let t0 = 0, f0 = f(0);
    for(let i = 1; i <= N; i++) {
        const t1 = i * step, f1 = f(t1);
        if(f0 === 0) out.push(t0);
        else if(f0 * f1 < 0) {
            let a = t0, b = t1, fa = f0;
            for(let k = 0; k < 60; k++) { const m = (a + b) / 2, fm = f(m); if(fa * fm <= 0) b = m; else { a = m; fa = fm; } }
            out.push((a + b) / 2);
        }
        t0 = t1; f0 = f1;
    }
    return out;
}
// 点 (px,py) に一番近い楕円上の点
function _ellNearest(e, px, py) {
    const d2 = (t) => { const p = _ellPt(e, t); return (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py); };
    const N = 72, step = 2 * Math.PI / N;
    let bt = 0, bd = Infinity;
    for(let i = 0; i < N; i++) { const v = d2(i * step); if(v < bd) { bd = v; bt = i * step; } }
    let a = bt - step, b = bt + step; // 黄金分割で絞る
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a);
    for(let k = 0; k < 60; k++) { if(d2(c) < d2(d)) b = d; else a = c; c = b - g * (b - a); d = a + g * (b - a); }
    return _ellPt(e, (a + b) / 2);
}

// ===== スナップ点の収集 =====
// F: 使うスナップの種類（osnapState、または「次の1点だけ」の指定）
// radiusPx: 吸着半径（画面px）。渡されたときは、交点の計算をカーソルの近くを通る線だけに絞る
function collectSnapPoints(wx, wy, baseWcs, F, radiusPx) {
    F = F || osnapState;
    if(!F.main) return [];
    const pts = [];
    const has = (k) => !!F[k];
    const hasCursor = wx !== undefined && wy !== undefined;
    const divN = SNAP_DIV_OPTIONS.includes(F.divN) ? F.divN : (SNAP_DIV_OPTIONS.includes(osnapState.divN) ? osnapState.divN : 3);
    if(!_snapHoverTmp) _snapHoverTmp = { d: Infinity, src: null };
    const push = (x, y, t, extra) => { const p = { x, y, t }; if(extra) Object.assign(p, extra); pts.push(p); };

    // 近接点（線の上のカーソルに一番近い点）。延長のために、カーソルに一番近い線も覚えておく
    const addNear = (px, py, src) => {
        if(hasCursor && src) {
            const d = dist(px, py, wx, wy) * view.scale;
            if(d < _snapHoverTmp.d) { _snapHoverTmp.d = d; _snapHoverTmp.src = src; }
        }
        if(!has('near')) return;
        if(cmdState.mode === 'WAITING_UCS_2P_ORIGIN' || cmdState.mode === 'WAITING_UCS_2P_ORIGIN_PREVIEW') return;
        push(px, py, '近接点');
    };
    const addPerp = (px, py, extra) => {
        // 基点が線の上にあると、垂線の足＝基点そのものになる（長さ0の線になるだけなので候補にしない）
        if(baseWcs && dist(px, py, baseWcs.x, baseWcs.y) * view.scale < 0.5) return;
        push(px, py, (extra && extra.ext) ? '垂線(延長)' : '垂線', extra);
    };
    const isVisible = (e) => (e.layer === undefined || !layers[e.layer] || layers[e.layer].visible) && !e.hidden;

    // マウスカーソル周辺でのみ検索するカリング
    let wxMin, wxMax, wyMin, wyMax;
    if(hasCursor) {
        const searchRad = 100 / view.scale; // 画面上100px程度の範囲
        wxMin = wx - searchRad; wxMax = wx + searchRad;
        wyMin = wy - searchRad; wyMax = wy + searchRad;
    }
    const inWin = (minX, minY, maxX, maxY) => {
        if(wxMin === undefined) return true;
        return !(maxX < wxMin || minX > wxMax || maxY < wyMin || minY > wyMax);
    };

    // 線分1本ぶん（線分・ポリラインの区間・長方形の辺で共通）: 中点・等分点・近接点・垂線
    const addSegSnaps = (x1, y1, x2, y2) => {
        if(!inWin(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2))) return;
        if(has('mid')) push((x1 + x2) / 2, (y1 + y2) / 2, '中点');
        const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
        if(len2 <= 0) return;
        if(has('div')) for(let k = 1; k < divN; k++) { if(2 * k === divN && has('mid')) continue; push(x1 + dx * k / divN, y1 + dy * k / divN, '等分点'); }
        if(hasCursor) {
            let t = ((wx - x1) * dx + (wy - y1) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            addNear(x1 + t * dx, y1 + t * dy, { kind: 'seg', x1, y1, x2, y2 });
        }
        if(has('perp') && baseWcs) {
            // 垂線の足が線分の上にあるとき（線分の外は、線を取得したときの「垂線(延長)」で扱う）
            const t = ((baseWcs.x - x1) * dx + (baseWcs.y - y1) * dy) / len2;
            if(t >= 0 && t <= 1) addPerp(x1 + t * dx, y1 + t * dy);
        }
    };
    // 円・円弧（onArc で描かれている範囲を判定）: 四半円点・近接点・垂線・接線
    const baseAway = (cx, cy) => baseWcs && dist(baseWcs.x, baseWcs.y, cx, cy) * view.scale >= 0.5;
    const addCircleSnaps = (cx, cy, r, onArc, src) => {
        const P = (a) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        if(has('qua')) for(let k = 0; k < 4; k++) { const a = (ucs.angle || 0) + k * Math.PI / 2; if(onArc(a)) { const p = P(a); push(p.x, p.y, '四半円点'); } }
        if(hasCursor) { const a = Math.atan2(wy - cy, wx - cx); if(onArc(a)) { const p = P(a); addNear(p.x, p.y, src); } }
        if(has('perp') && baseAway(cx, cy)) {
            const a = Math.atan2(baseWcs.y - cy, baseWcs.x - cx);
            [a, a + Math.PI].forEach(b => { if(onArc(b)) { const p = P(b); addPerp(p.x, p.y); } }); // 手前側と向こう側
        }
        if(has('tan') && baseWcs) {
            const d = dist(baseWcs.x, baseWcs.y, cx, cy);
            if(d > r * (1 + 1e-9)) { // 円の外からだけ接線が引ける
                const th = Math.atan2(baseWcs.y - cy, baseWcs.x - cx), al = Math.acos(r / d);
                [th + al, th - al].forEach(b => { if(onArc(b)) { const p = P(b); push(p.x, p.y, '接線'); } });
            }
        }
    };
    const arcRange = (e) => (a) => isPointOnArc(e, e.cx + Math.cos(a), e.cy + Math.sin(a));
    const always = () => true;
    const insSeen = new Set(); // ブロックの挿入点は部品が同じ値を持つので1つにまとめる

    _forEachCandidate(wxMin, wyMin, wxMax, wyMax, e => {
        if(!isVisible(e)) return;
        if(e.bbox && wxMin !== undefined) {
            if(e.bbox.maxX < wxMin || e.bbox.minX > wxMax || e.bbox.maxY < wyMin || e.bbox.minY > wyMax) return;
        }
        // 挿入点: 取り込んだブロック（測点記号など）の挿入点
        if(has('ins') && e.ins && isFinite(e.ins.x) && isFinite(e.ins.y)) {
            const k = e.gid || `${e.ins.x},${e.ins.y}`;
            if(!insSeen.has(k)) { insSeen.add(k); push(e.ins.x, e.ins.y, '挿入点'); }
        }

        if(e.type === 'LINE') {
            if(has('end')) { push(e.x1, e.y1, '端点'); push(e.x2, e.y2, '端点'); }
            addSegSnaps(e.x1, e.y1, e.x2, e.y2);
        }
        else if(e.type === 'CIRCLE') {
            if(has('cen')) push(e.cx, e.cy, '中心');
            addCircleSnaps(e.cx, e.cy, e.radius, always, null);
        }
        else if(e.type === 'ARC') {
            if(has('cen')) push(e.cx, e.cy, '中心');
            const r = e.radius;
            if(has('end')) { push(e.cx + r * Math.cos(e.startAngle), e.cy + r * Math.sin(e.startAngle), '端点'); push(e.cx + r * Math.cos(e.endAngle), e.cy + r * Math.sin(e.endAngle), '端点'); }
            if(has('mid') || has('div')) {
                const ccw = e.counterclockwise !== false;
                let sweep = ccw ? normalizeAngle(e.endAngle - e.startAngle) : normalizeAngle(e.startAngle - e.endAngle);
                if(sweep === 0) sweep = 2 * Math.PI;
                const at = (f) => { const a = e.startAngle + (ccw ? 1 : -1) * sweep * f; return { x: e.cx + r * Math.cos(a), y: e.cy + r * Math.sin(a) }; };
                if(has('mid')) { const p = at(0.5); push(p.x, p.y, '中点'); }
                if(has('div')) for(let k = 1; k < divN; k++) { if(2 * k === divN && has('mid')) continue; const p = at(k / divN); push(p.x, p.y, '等分点'); }
            }
            addCircleSnaps(e.cx, e.cy, r, arcRange(e), { kind: 'arc', cx: e.cx, cy: e.cy, r, sa: e.startAngle, ea: e.endAngle, ccw: e.counterclockwise !== false });
        }
        else if(e.type === 'ELLIPSE') {
            if(has('cen')) push(e.cx, e.cy, '中心');
            if(has('qua')) [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(t => { const p = _ellPt(e, t); push(p.x, p.y, '四半円点'); });
            if(hasCursor) { const p = _ellNearest(e, wx, wy); addNear(p.x, p.y, null); }
            if(has('perp') && baseWcs) {
                _ellRoots(t => { const p = _ellPt(e, t), d = _ellD(e, t); return (p.x - baseWcs.x) * d.x + (p.y - baseWcs.y) * d.y; })
                    .forEach(t => { const p = _ellPt(e, t); addPerp(p.x, p.y); });
            }
            if(has('tan') && baseWcs && _ellImplicit(e, baseWcs.x, baseWcs.y) > 1e-12) {
                _ellRoots(t => { const p = _ellPt(e, t), d = _ellD(e, t); return (p.x - baseWcs.x) * d.y - (p.y - baseWcs.y) * d.x; })
                    .forEach(t => { const p = _ellPt(e, t); push(p.x, p.y, '接線'); });
            }
        }
        else if(e.type === 'RECTANG') {
            const c = [[e.x1, e.y1], [e.x2, e.y1], [e.x2, e.y2], [e.x1, e.y2]];
            if(has('end')) c.forEach(p => push(p[0], p[1], '端点'));
            for(let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; addSegSnaps(a[0], a[1], b[0], b[1]); }
            if(has('cen')) push((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, '中心');
        }
        else if(e.type === 'PLINE' && e.points) {
            const P = e.points;
            // 頂点が多い線（等高線など）でもカーソルの近くだけを調べる
            if(has('end')) P.forEach(p => { if(inWin(p.x, p.y, p.x, p.y)) push(p.x, p.y, '端点'); });
            for(let i = 1; i < P.length; i++) addSegSnaps(P[i - 1].x, P[i - 1].y, P[i].x, P[i].y);
            if(e.closed && P.length > 2) {
                addSegSnaps(P[P.length - 1].x, P[P.length - 1].y, P[0].x, P[0].y);
                // 図心: 閉じた区画の重心
                if(has('gce') && typeof _polygonCentroid === 'function') { const g = _polygonCentroid(P); if(g && isFinite(g.x) && isFinite(g.y)) push(g.x, g.y, '図心'); }
            }
        }
        else if(e.type === 'POINT') { if(has('end')) push(e.x, e.y, '端点'); }
        else if(e.type === 'TEXT') {
            // 文字の位置（測点名の文字は測点からずらして置いているので対象外）
            if(has('ins') && !e.ptLabel && isFinite(e.x) && isFinite(e.y)) push(e.x, e.y, '挿入点');
        }
    });

    // ===== 交点（線分・ポリライン・長方形・円・円弧・楕円。ブロック展開後の PLINE 等も対象） =====
    const segs = [], circles = [], ellipses = [];
    if(has('int')) {
        const MAX_SEGS = 300, MAX_CIRCLES = 60, MAX_ELLIPSES = 20;
        // 交点がカーソルから吸着半径内にあるなら、その交点を通る2本の線はどちらもカーソルの近くを通る。
        // そこで、カーソルの近くを通る線だけを組み合わせる（図形の多い図面での計算を大きく減らし、
        // 以前の「300本まで」の打ち切りで指の下の線が漏れることも無くなる）
        const rw = (hasCursor && radiusPx) ? radiusPx / view.scale : undefined;
        const addSeg = (x1, y1, x2, y2) => {
            if(segs.length >= MAX_SEGS) return;
            if(!inWin(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2))) return;
            if(rw !== undefined && distPointToSeg(wx, wy, x1, y1, x2, y2) > rw) return;
            segs.push({ x1, y1, x2, y2 });
        };
        _forEachCandidate(wxMin, wyMin, wxMax, wyMax, e => {
            if(!isVisible(e)) return;
            if(e.bbox && wxMin !== undefined) {
                if(e.bbox.maxX < wxMin || e.bbox.minX > wxMax || e.bbox.maxY < wyMin || e.bbox.minY > wyMax) return;
            }
            if(e.type === 'CIRCLE' || e.type === 'ARC') {
                if(rw !== undefined && Math.abs(dist(wx, wy, e.cx, e.cy) - e.radius) > rw) return;
                if(circles.length < MAX_CIRCLES) circles.push(e);
            }
            else if(e.type === 'ELLIPSE') { if(ellipses.length < MAX_ELLIPSES) ellipses.push(e); }
            else boundarySegmentsOf(e).forEach(s => addSeg(s.x1, s.y1, s.x2, s.y2));
        });
        // 線分×線分
        for(let i = 0; i < segs.length; i++) {
            for(let j = i + 1; j < segs.length; j++) {
                const a = segs[i], b = segs[j];
                const pt = intersectLineLine(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
                if(pt) push(pt.x, pt.y, '交点');
            }
        }
        // 線分×円/円弧
        segs.forEach(s => circles.forEach(c => {
            intersectSegCircle(s.x1, s.y1, s.x2, s.y2, c.cx, c.cy, c.radius).forEach(p => { if(isPointOnArc(c, p.x, p.y)) push(p.x, p.y, '交点'); });
        }));
        // 円/円弧×円/円弧
        for(let i = 0; i < circles.length; i++) {
            for(let j = i + 1; j < circles.length; j++) {
                intersectCircleCircle(circles[i], circles[j]).forEach(p => {
                    if(isPointOnArc(circles[i], p.x, p.y) && isPointOnArc(circles[j], p.x, p.y)) push(p.x, p.y, '交点');
                });
            }
        }
        // 楕円×線分: 楕円を単位円に直す座標で、線分と円の交点として厳密に求める
        ellipses.forEach(el => {
            const c = Math.cos(el.rotation || 0), s = Math.sin(el.rotation || 0);
            const toL = (x, y) => { const dx = x - el.cx, dy = y - el.cy; return { x: (dx * c + dy * s) / el.rx, y: (-dx * s + dy * c) / el.ry }; };
            const toW = (p) => { const x = p.x * el.rx, y = p.y * el.ry; return { x: el.cx + x * c - y * s, y: el.cy + x * s + y * c }; };
            segs.forEach(sg => {
                const a = toL(sg.x1, sg.y1), b = toL(sg.x2, sg.y2);
                intersectSegCircle(a.x, a.y, b.x, b.y, 0, 0, 1).forEach(p => { const w = toW(p); push(w.x, w.y, '交点'); });
            });
            // 楕円×円/円弧、楕円×楕円: 楕円の上を動く点が相手の図形に乗る θ を求める
            circles.forEach(ci => {
                _ellRoots(t => { const p = _ellPt(el, t); return (p.x - ci.cx) * (p.x - ci.cx) + (p.y - ci.cy) * (p.y - ci.cy) - ci.radius * ci.radius; })
                    .forEach(t => { const p = _ellPt(el, t); if(isPointOnArc(ci, p.x, p.y)) push(p.x, p.y, '交点'); });
            });
        });
        for(let i = 0; i < ellipses.length; i++) {
            for(let j = i + 1; j < ellipses.length; j++) {
                const e1 = ellipses[i], e2 = ellipses[j];
                _ellRoots(t => { const p = _ellPt(e1, t); return _ellImplicit(e2, p.x, p.y); }, 360)
                    .forEach(t => { const p = _ellPt(e1, t); push(p.x, p.y, '交点'); });
            }
        }
    }

    // ===== 延長（取得した線・円弧を延ばした線の上） =====
    const acq = _snapAcquired();
    if(has('ext') && acq.length) {
        const lineInter = (a, b) => { // 2本の直線（無限に延ばしたもの）の交点と、それぞれの線上の位置 t, u
            const d1x = a.x2 - a.x1, d1y = a.y2 - a.y1, d2x = b.x2 - b.x1, d2y = b.y2 - b.y1;
            const den = d1x * d2y - d1y * d2x;
            if(Math.abs(den) < 1e-12 * (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y))) return null; // 平行
            const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / den;
            const u = ((b.x1 - a.x1) * d1y - (b.y1 - a.y1) * d1x) / den;
            return { x: a.x1 + t * d1x, y: a.y1 + t * d1y, t, u };
        };
        const endOf = (s, t) => (t < 0 ? { x: s.x1, y: s.y1 } : { x: s.x2, y: s.y2 }); // 延長を始める端
        const outside = (t) => t < -1e-9 || t > 1 + 1e-9;
        acq.forEach(s => {
            if(s.kind === 'seg') {
                const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len2 = dx * dx + dy * dy;
                if(len2 <= 0) return;
                if(hasCursor) {
                    const t = ((wx - s.x1) * dx + (wy - s.y1) * dy) / len2;
                    if(outside(t)) push(s.x1 + t * dx, s.y1 + t * dy, '延長', { ext: [endOf(s, t)] });
                }
                if(has('perp') && baseWcs) {
                    const t = ((baseWcs.x - s.x1) * dx + (baseWcs.y - s.y1) * dy) / len2;
                    if(outside(t)) addPerp(s.x1 + t * dx, s.y1 + t * dy, { ext: [endOf(s, t)] });
                }
            } else if(s.kind === 'arc') {
                const arcE = { type: 'ARC', cx: s.cx, cy: s.cy, radius: s.r, startAngle: s.sa, endAngle: s.ea, counterclockwise: s.ccw };
                const off = (a) => !isPointOnArc(arcE, s.cx + Math.cos(a), s.cy + Math.sin(a)); // 描かれていない部分
                const P = (a) => ({ x: s.cx + s.r * Math.cos(a), y: s.cy + s.r * Math.sin(a) });
                if(hasCursor) { const a = Math.atan2(wy - s.cy, wx - s.cx); if(off(a)) { const p = P(a); push(p.x, p.y, '延長'); } }
                if(has('perp') && baseAway(s.cx, s.cy)) {
                    const a = Math.atan2(baseWcs.y - s.cy, baseWcs.x - s.cx);
                    [a, a + Math.PI].forEach(b => { if(off(b)) { const p = P(b); addPerp(p.x, p.y, { ext: [] }); } });
                }
            }
        });
        // 延長交点: 取得した線どうし、または取得した線を延ばした先と近くの線分の交点（実際の交点は「交点」で出る）
        if(has('int')) {
            const aSegs = acq.filter(s => s.kind === 'seg');
            for(let i = 0; i < aSegs.length; i++) {
                for(let j = i + 1; j < aSegs.length; j++) {
                    const p = lineInter(aSegs[i], aSegs[j]);
                    if(p && (outside(p.t) || outside(p.u))) {
                        const ext = []; if(outside(p.t)) ext.push(endOf(aSegs[i], p.t)); if(outside(p.u)) ext.push(endOf(aSegs[j], p.u));
                        push(p.x, p.y, '延長交点', { ext });
                    }
                }
                segs.forEach(b => {
                    const p = lineInter(aSegs[i], b);
                    if(p && outside(p.t) && !outside(p.u)) push(p.x, p.y, '延長交点', { ext: [endOf(aSegs[i], p.t)] });
                });
            }
        }
    }
    return pts;
}

// 垂線・接線の基点（いま引いている線・寸法の「始まりの点」）。基点が無い入力では垂線・接線は出ない
function getBaseWcs() {
    const m = cmdState.mode;
    if(m === 'WAITING_LINE_P2' || m === 'WAITING_CIRCLE_RADIUS' || m === 'WAITING_RECT_P2') return cmdState.startWcs;
    if((m === 'WAITING_UCS_2P_XDIR' || m === 'WAITING_UCS_2P_XDIR_PREVIEW') && cmdState.startWcs) return cmdState.startWcs;
    if(m === 'WAITING_PLINE_NEXT' && cmdState.points.length > 0) return cmdState.points[cmdState.points.length - 1];
    if(m === 'WAITING_MOVE_DEST' || m === 'WAITING_COPY_DEST') return cmdState.moveBase;
    // 3点円弧: 直前に指定した点から
    if((m === 'WAITING_ARC_P2' || m === 'WAITING_ARC_P3') && cmdState.points && cmdState.points.length > 0) return cmdState.points[cmdState.points.length - 1];
    // 平行寸法・整列寸法の2点目: 1点目から（点から線までの垂直な距離を測る）
    if((m === 'WAITING_DIMLIN_P2' || m === 'WAITING_DIMALN_P2') && cmdState.points && cmdState.points.length > 0) return cmdState.points[0];
    // 連続寸法: 2点目は1点目から、以降は直列なら前の点・並列なら最初の点から
    const cp = cmdState.dimContPoints;
    if(m === 'WAITING_DIMCONT_P2' && cp && cp.length > 0) return cp[0];
    if(m === 'WAITING_DIMCONT_NEXT' && cp && cp.length > 0) return cmdState.dimContType === 'PARALLEL' ? cp[0] : cp[cp.length - 1];
    // 基点測定: 基点から（基点から線までの垂直な距離）
    if(m === 'WAITING_DIMMEAS_TO' && cmdState.measBase) return cmdState.measBase;
    // 鏡の線の2点目は1点目から、点を動かすときはつかんだ点から（cad-edit.js）
    if(typeof editBaseWcs === 'function') { const b = editBaseWcs(m); if(b) return b; }
    return null;
}

// 「次の1点だけ」の指定に使うフラグ（ほかの種類は出さない）
function _overrideFlags(ov) {
    const F = { main: true, divN: osnapState.divN };
    F[ov.key] = true;
    if(ov.key === 'int' || ov.key === 'perp') F.ext = true; // 取得した線があれば延長交点・垂線(延長)も含める
    return F;
}

// カーソル位置 (sx,sy)（画面）/(wx,wy)（WCS）でスナップ点を探す
function findSnap(sx, sy, wx, wy) {
    const ov = _snapOverride;
    if(!osnapState.main && !ov) return null;
    _snapLastArgs = [sx, sy, wx, wy];
    const baseWcs = getBaseWcs();
    const F = ov ? _overrideFlags(ov) : osnapState;
    _snapHoverTmp = { d: Infinity, src: null };
    const radius = snapRadiusPx() * (ov ? 2 : 1); // 吸着半径（指定中は2倍）
    let pts = collectSnapPoints(wx, wy, baseWcs, F, radius);

    // UCS設定時は線の上の任意の点（近接点・延長）を使わない
    if(cmdState.mode.startsWith('WAITING_UCS_')) pts = pts.filter(p => p.t !== '近接点' && p.t !== '延長');
    if(ov) pts = pts.filter(p => _snapBaseType(p.t) === ov.label);

    // 吸着半径はタッチ操作では少し広げ、オプション「吸着の範囲」で倍率を変えられる（snapRadiusPx）
    if(F.ext) _updateSnapHover(_snapHoverTmp.src, _snapHoverTmp.d, snapRadiusPx());

    // スナップ優先順位（AutoCAD準拠の2段階）:
    //   1) 幾何的な点（端点・中点・中心・交点・垂線・接線・挿入点・四半円点・図心・等分点）: 範囲内で近い順
    //   2) 線の上の任意の点（近接点・延長）: 1 が範囲内に1つも無いときだけ
    // ※ 近接点はカーソル直下（距離≒0）に必ず存在するため、単純な最近傍比較だと交点などが永久に選ばれなくなる
    const within = [];
    pts.forEach(p => {
        const sp = wcsToScreen(p.x, p.y);
        const d = dist(sx, sy, sp.x, sp.y);
        if(d < radius) within.push({ p, d, sp, tier: _snapTier(p.t) });
    });
    within.sort((a, b) => (a.tier - b.tier) || (a.d - b.d));
    // 同じ位置の候補は1つにまとめる（先に並んだ＝優先度の高い種類を残す）
    const uniq = [];
    within.forEach(c => { if(!uniq.some(u => Math.abs(u.sp.x - c.sp.x) < 0.5 && Math.abs(u.sp.y - c.sp.y) < 0.5)) uniq.push(c); });
    if(!uniq.length) return null;

    // 候補の切り替え（Tab・⇄）: 同じ位置で押すたびに次の候補。カーソルが動いたら最初の候補に戻る
    if(!_snapCycle || Math.hypot(sx - _snapCycle.sx, sy - _snapCycle.sy) > 3) _snapCycle = { sx, sy, index: 0 };
    const k = _snapCycle.index % uniq.length;
    const c = uniq[k].p;
    return { wcsX: c.x, wcsY: c.y, type: c.t, ext: c.ext || null, index: k, count: uniq.length, forced: !!ov };
}

// ===== スナップ記号の描画 =====
// (x, y) は画面座標、m は記号の大きさ（半径）。線の色・太さは呼び出し側で設定する
function drawSnapShape(type, x, y, m) {
    ctx.beginPath();
    switch(type === '延長交点' ? type : _snapBaseType(type)) {
        case '端点': ctx.moveTo(x, y - m); ctx.lineTo(x + m, y + m * 0.7); ctx.lineTo(x - m, y + m * 0.7); ctx.closePath(); break;
        case '中点': ctx.rect(x - m, y - m, m * 2, m * 2); ctx.moveTo(x - m, y + m); ctx.lineTo(x, y - m); ctx.lineTo(x + m, y + m); break;
        case '中心': ctx.arc(x, y, m, 0, Math.PI * 2); break;
        case '交点': ctx.moveTo(x - m, y - m); ctx.lineTo(x + m, y + m); ctx.moveTo(x + m, y - m); ctx.lineTo(x - m, y + m); break;
        case '延長交点':
            ctx.moveTo(x - m, y - m); ctx.lineTo(x + m, y + m); ctx.moveTo(x + m, y - m); ctx.lineTo(x - m, y + m);
            ctx.stroke(); ctx.beginPath(); ctx.setLineDash([2, 2]); ctx.arc(x, y, m * 1.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
            return;
        case '近接点': ctx.moveTo(x - m, y - m); ctx.lineTo(x + m, y + m); ctx.moveTo(x - m, y + m); ctx.lineTo(x + m, y - m); ctx.rect(x - m, y - m, m * 2, m * 2); break;
        case '垂線': ctx.moveTo(x - m, y - m); ctx.lineTo(x - m, y + m); ctx.lineTo(x + m, y + m); ctx.moveTo(x - m, y); ctx.lineTo(x, y); ctx.lineTo(x, y + m); break;
        case '接線': ctx.arc(x, y + m * 0.2, m * 0.8, 0, Math.PI * 2); ctx.moveTo(x - m, y - m * 0.6); ctx.lineTo(x + m, y - m * 0.6); break;
        case '挿入点': ctx.rect(x - m, y - m, m * 1.3, m * 1.3); ctx.rect(x - m * 0.3, y - m * 0.3, m * 1.3, m * 1.3); break;
        case '四半円点': ctx.moveTo(x, y - m); ctx.lineTo(x + m, y); ctx.lineTo(x, y + m); ctx.lineTo(x - m, y); ctx.closePath(); break;
        case '図心': ctx.arc(x, y, m, 0, Math.PI * 2); ctx.moveTo(x - m, y); ctx.lineTo(x + m, y); ctx.moveTo(x, y - m); ctx.lineTo(x, y + m); break;
        case '等分点': ctx.moveTo(x - m, y - m * 0.7); ctx.lineTo(x + m, y - m * 0.7); ctx.lineTo(x, y + m); ctx.closePath(); break;
        case '延長': ctx.moveTo(x - m, y); ctx.lineTo(x + m, y); ctx.moveTo(x, y - m); ctx.lineTo(x, y + m); break;
        default: ctx.rect(x - m, y - m, m * 2, m * 2);
    }
    ctx.stroke();
}

// 延長の補助線（取得した線の延長・いま使っている延長）と、2点の中点の途中表示
// opts.currentOnly: いまのスナップの補助線だけ（ルーペの中）、opts.px: 線の太さ（ルーペは倍率で割る）
function drawSnapGuides(opts) {
    const o = opts || {};
    const px = o.px || 1;
    const active = cmdState.mode !== 'IDLE' || document.body.classList.contains('fullscreen-mode');
    ctx.save();
    ctx.strokeStyle = '#00ff00';
    // 取得した線: 端に小さな「＋」。カーソルが延長線の近くにあるときだけ、延長線をうすい破線で出す
    // （取得した線の延長を常に出すと画面がうるさいため。AutoCAD の追跡線と同じ考え方）
    if(!o.currentOnly && active && (osnapState.ext || (_snapOverride && _overrideFlags(_snapOverride).ext))) {
        const near = snapRadiusPx() * 3; // 延長線を出すカーソルとの距離（画面px）
        const cx = mouse.wcsX, cy = mouse.wcsY;
        const plus = (p) => { const s = wcsToScreen(p.x, p.y); ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.stroke(); };
        const far = (canvas.width + canvas.height) * 2 / (view.scale || 1);
        _snapAcquired().forEach(s => {
            ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5 * px; ctx.setLineDash([]);
            if(s.kind === 'seg') {
                plus({ x: s.x1, y: s.y1 }); plus({ x: s.x2, y: s.y2 });
                const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); if(len <= 0) return;
                const ux = (s.x2 - s.x1) / len, uy = (s.y2 - s.y1) / len;
                const t = (cx - s.x1) * ux + (cy - s.y1) * uy;                      // 線の向きの位置
                const off = Math.abs((cx - s.x1) * uy - (cy - s.y1) * ux) * view.scale; // 線からの距離（px）
                if(off > near || (t >= 0 && t <= len)) return;                        // 延長線の近くでなければ出さない
                ctx.globalAlpha = 0.45; ctx.lineWidth = px; ctx.setLineDash([4 * px, 4 * px]);
                const from = t < 0 ? { x: s.x1, y: s.y1 } : { x: s.x2, y: s.y2 };
                const dir = t < 0 ? -1 : 1;
                const a = wcsToScreen(from.x, from.y), b = wcsToScreen(from.x + dir * ux * far, from.y + dir * uy * far);
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            } else if(s.kind === 'arc') {
                plus({ x: s.cx + s.r * Math.cos(s.sa), y: s.cy + s.r * Math.sin(s.sa) });
                plus({ x: s.cx + s.r * Math.cos(s.ea), y: s.cy + s.r * Math.sin(s.ea) });
                if(Math.abs(Math.hypot(cx - s.cx, cy - s.cy) - s.r) * view.scale > near) return;
                ctx.globalAlpha = 0.45; ctx.lineWidth = px; ctx.setLineDash([4 * px, 4 * px]);
                const c = wcsToScreen(s.cx, s.cy);
                ctx.beginPath(); ctx.arc(c.x, c.y, s.r * view.scale, 0, Math.PI * 2); ctx.stroke();
            }
        });
        ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
    // いまのスナップが延長を使っているとき: 線の端からスナップ点まで
    if(snapActive() && snapResult.ext && snapResult.ext.length) {
        const s = wcsToScreen(snapResult.wcsX, snapResult.wcsY);
        ctx.lineWidth = 1.5 * px; ctx.setLineDash([5 * px, 3 * px]);
        snapResult.ext.forEach(p => { const a = wcsToScreen(p.x, p.y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(s.x, s.y); ctx.stroke(); });
    }
    // 2点の中点: 1点目と、いまの位置との中点
    if(!o.currentOnly && _m2p && _m2p.first) {
        const cur = getInputPoint();
        const a = wcsToScreen(_m2p.first.x, _m2p.first.y), b = wcsToScreen(cur.x, cur.y);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, Math.PI * 2); ctx.moveTo(m.x - 9, m.y); ctx.lineTo(m.x + 9, m.y); ctx.moveTo(m.x, m.y - 9); ctx.lineTo(m.x, m.y + 9); ctx.stroke();
    }
    ctx.restore();
}

// ===== 候補の切り替え（重なった候補を順に選ぶ） =====
window.cycleSnapCandidate = function() {
    if(!_snapLastArgs || !snapResult || !(snapResult.count > 1)) return false;
    if(!_snapCycle) return false;
    _snapCycle.index++;
    snapResult = findSnap.apply(null, _snapLastArgs);
    if(typeof refreshCoordDisplay === 'function') refreshCoordDisplay();
    if(navigator.vibrate) navigator.vibrate(10);
    if(typeof renderOverlay === 'function') renderOverlay();
    return true;
};
// アクションバーの「⇄ 候補」ボタン（候補が2つ以上あるときだけ出す）
function updateSnapCycleButton() {
    const btn = document.getElementById('dim-snap-cycle');
    if(!btn) return;
    const n = (snapActive() && snapResult.count > 1) ? snapResult.count : 0;
    const text = n ? `⇄ ${snapResult.index + 1}/${n}` : '';
    const display = n ? '' : 'none';
    if(btn.style.display !== display) btn.style.display = display;
    if(n && btn.textContent !== text) btn.textContent = text;
}
// Tab キーで候補を切り替える（コマンドの途中だけ）
document.addEventListener('keydown', (e) => {
    if(e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; // 入力欄では次の欄へ移る
    if(typeof cmdState === 'undefined' || cmdState.mode === 'IDLE') return;
    if(snapResult && snapResult.count > 1) { e.preventDefault(); window.cycleSnapCandidate(); }
});

// ===== 次の1点だけのスナップ指定 =====
window.setSnapOverride = function(key) {
    const t = SNAP_TYPES.find(x => x.key === key);
    if(!t) return;
    if(_snapOverride && _snapOverride.key === key) { clearSnapOverride(); _closeOsnapPanel(); return; } // 同じボタンで取り消し
    _snapOverride = { key, label: t.label };
    _closeOsnapPanel();
    updateSnapOverrideUi();
    addCommandLog(`-> 次の1点だけ「${t.label}」に吸着します`);
    if(typeof showToast === 'function') showToast(`次の1点だけ「${t.label}」`);
    if(_snapLastArgs && cmdState.mode !== 'IDLE') snapResult = findSnap.apply(null, _snapLastArgs);
    if(typeof renderOverlay === 'function') renderOverlay();
};
function clearSnapOverride() {
    if(!_snapOverride) return;
    _snapOverride = null;
    updateSnapOverrideUi();
}
function snapOverrideLabel() { return _snapOverride ? _snapOverride.label : null; }
// OSNAP ボタンに指定中の種類を出す（黄色＝いつもと違う状態）
function updateSnapOverrideUi() {
    const btn = document.getElementById('btn-osnap');
    if(btn) { btn.textContent = _snapOverride ? `${_snapOverride.label}のみ` : 'OSNAP'; btn.classList.toggle('snap-override', !!_snapOverride); }
    const fs = document.getElementById('fs-btn-osnap');
    if(fs) { fs.classList.toggle('snap-override', !!_snapOverride); fs.title = _snapOverride ? `次の1点だけ: ${_snapOverride.label}` : 'OSNAP ON/OFF'; }
    document.querySelectorAll('#osnap-panel .osnap-once').forEach(b => b.classList.toggle('active', !!_snapOverride && b.dataset.snap === _snapOverride.key));
}

// ===== 2点間の中点（2点を指定して、その真ん中を入力する） =====
let _m2p = null; // { first: {x,y} | null }
window.startMid2P = function() {
    _closeOsnapPanel();
    if(cmdState.mode === 'IDLE') { showToast('線・寸法などのコマンドの途中で使います'); return; }
    if(cmdState.mode === 'WAITING_DIMMEAS_TO') { showToast('基点測定では、基点を決める前に使えます'); return; }
    _m2p = { first: null };
    addCommandLog('-> [2点の中点] 1点目を指定してください');
    showToast('2点の中点: 1点目を指定');
    if(typeof renderOverlay === 'function') renderOverlay();
};
// handlePointInput の最初に呼ばれる。2点の中点の途中なら点を受け取って true を返す
function snapInputIntercept(wcs) {
    if(!_m2p) return false;
    if(!_m2p.first) {
        _m2p.first = { x: wcs.x, y: wcs.y };
        clearSnapOverride();
        addCommandLog('-> 2点の中点: 2点目を指定してください');
        showToast('2点の中点: 2点目を指定');
        if(typeof render === 'function') render();
        return true;
    }
    const mid = { x: (_m2p.first.x + wcs.x) / 2, y: (_m2p.first.y + wcs.y) / 2 };
    _m2p = null;
    const u = wcsToUcs(mid.x, mid.y);
    addCommandLog(`-> 2点の中点: X ${formatCoordValue(u.y, 'loupe')}  Y ${formatCoordValue(u.x, 'loupe')}`);
    handlePointInput(mid, true); // 本来の入力として渡す（_m2p は解除済みなので再び受け取らない）
    return true;
}
// 点が入力されたあと（handlePointInput の最後）
function afterSnapPointInput(wcs) {
    _lastInputWcs = { x: wcs.x, y: wcs.y };
    clearSnapOverride();
}
// コマンドの終了・取り消し（resetCommand）
function snapToolsReset() {
    clearSnapOverride();
    _m2p = null;
    _snapCycle = null;
    _snapHover = null; clearTimeout(_snapHoverTimer);
}

// ===== 相対座標の入力 =====
// 基準点から「北へ○・東へ○」または「距離と方向角」で点を入力する（測量の並び: X＝北、Y＝東）
let _relInput = null; // { base: {x,y}, baseLabel, mode: 'dxy' | 'polar' }
function _surveyUnitText() { return (typeof getSurveyUnit === 'function' && getSurveyUnit() === 'mm') ? 'mm' : 'm'; }
function _fmtDms(deg) {
    let d = ((deg % 360) + 360) % 360;
    let D = Math.floor(d), M = Math.floor((d - D) * 60), S = (d - D - M / 60) * 3600;
    S = Math.round(S * 10) / 10;
    if(S >= 60) { S -= 60; M++; } if(M >= 60) { M -= 60; D++; }
    return `${D}°${String(M).padStart(2, '0')}′${S.toFixed(1).padStart(4, '0')}″`;
}
// 方向角の入力: 「45.5」（度）または「45 30 15」「45-30-15」「45°30′15″」（度 分 秒）
function parseAzimuth(text) {
    const s = String(text || '').trim();
    if(!s) return NaN;
    if(/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const parts = s.split(/[\s°'′"″\-:度分秒]+/).filter(Boolean).map(Number);
    if(!parts.length || parts.some(n => !isFinite(n))) return NaN;
    return (parts[0] || 0) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
}
// 相対入力の結果（WCS）。mode 'dxy': dN（北へ）・dE（東へ）、'polar': 距離・方向角（北から時計回り）
function relativeTarget(base, mode, a, b) {
    let dN, dE;
    if(mode === 'polar') { const az = b * Math.PI / 180; dN = a * Math.cos(az); dE = a * Math.sin(az); }
    else { dN = a; dE = b; }
    const u = wcsToUcs(base.x, base.y);
    return ucsToWcs(u.x + dE, u.y + dN);
}
window.showRelativeInputPanel = function() {
    _closeOsnapPanel();
    if(cmdState.mode === 'IDLE') { showToast('線・寸法などのコマンドの途中で使います'); return; }
    let base = null, label = '';
    if(snapActive()) { base = { x: snapResult.wcsX, y: snapResult.wcsY }; label = `スナップ点（${snapResult.type}）`; }
    else if(getBaseWcs()) { base = Object.assign({}, getBaseWcs()); label = 'いまの線の始点'; }
    else if(_lastInputWcs) { base = Object.assign({}, _lastInputWcs); label = '直前に入力した点'; }
    if(!base) { showToast('基準にする点にスナップしてから開いてください'); return; }
    _relInput = { base, baseLabel: label, mode: (_relInput && _relInput.mode) || 'dxy' };
    _renderRelativePanel();
};
function _renderRelativePanel() {
    const r = _relInput; if(!r) return;
    const u = wcsToUcs(r.base.x, r.base.y), unit = _surveyUnitText();
    const seg = (m, text) => `<button class="prop-btn opt-bg-btn ${r.mode === m ? 'active' : ''}" style="flex:1;margin-top:0;" onclick="setRelativeMode('${m}')">${text}</button>`;
    const field = (id, label, ph) => `<div class="prop-row" style="margin-bottom:0;"><div class="prop-label">${label}</div><input id="${id}" class="prop-val" type="text" inputmode="decimal" placeholder="${ph}" style="min-width:0;"></div>`;
    const html = `
        <div style="font-size:11px;color:#aaa;">基準点: ${escapeHtml(r.baseLabel)}</div>
        <div style="font-family:Consolas,monospace;color:#00ff88;font-size:13px;">X ${formatCoordValue(u.y, 'loupe')}&nbsp;&nbsp;Y ${formatCoordValue(u.x, 'loupe')}</div>
        <div style="display:flex;gap:6px;">${seg('dxy', '北・東へ')}${seg('polar', '距離・方向角')}</div>
        ${r.mode === 'polar'
            ? field('rel-a', `距離 (${unit})`, '12.345') + field('rel-b', '方向角', '45 30 15 または 45.5') + '<div id="rel-az-note" style="font-size:10px;color:#888;">方向角は北から時計回り（度、または 度 分 秒）</div>'
            : field('rel-a', `北へ X (${unit})`, '南はマイナス') + field('rel-b', `東へ Y (${unit})`, '西はマイナス')}
        <button class="prop-btn" onclick="applyRelativeInput()">この点を入力</button>
        <div style="font-size:10px;color:#888;">入力した点が次の基準点になります（続けて入力できます）</div>`;
    showPropertyPanel('📐 相対入力', html);
}
window.setRelativeMode = function(m) { if(_relInput) { _relInput.mode = (m === 'polar') ? 'polar' : 'dxy'; _renderRelativePanel(); } };
window.applyRelativeInput = function() {
    const r = _relInput; if(!r) return;
    const aEl = document.getElementById('rel-a'), bEl = document.getElementById('rel-b');
    const a = parseFloat(aEl && aEl.value), b = (r.mode === 'polar') ? parseAzimuth(bEl && bEl.value) : parseFloat(bEl && bEl.value);
    const aa = isFinite(a) ? a : 0, bb = isFinite(b) ? b : 0;
    if(r.mode === 'polar' && (!isFinite(a) || !isFinite(b))) { showToast('距離と方向角を入れてください'); return; }
    if(r.mode === 'dxy' && !isFinite(a) && !isFinite(b)) { showToast('北・東へ動かす量を入れてください'); return; }
    const t = relativeTarget(r.base, r.mode, aa, bb);
    addCommandLog(r.mode === 'polar' ? `-> 相対入力: 距離 ${aa} 方向角 ${_fmtDms(bb)}` : `-> 相対入力: 北へ ${aa} 東へ ${bb}`);
    if(cmdState.mode === 'IDLE') { showToast('コマンドが終わっています'); return; }
    handlePointInput(t, true);
    r.base = { x: t.x, y: t.y }; r.baseLabel = '直前に入力した点';
    // 値は残す（同じ量で続けて入力できる）
    const keepA = aEl ? aEl.value : '', keepB = bEl ? bEl.value : '';
    _renderRelativePanel();
    const a2 = document.getElementById('rel-a'), b2 = document.getElementById('rel-b');
    if(a2) a2.value = keepA; if(b2) b2.value = keepB;
    if(typeof render === 'function') render();
};
// コマンド欄の相対座標「@x,y」: 直前に入力した点から（座標の並びはコマンド欄の絶対座標と同じ）
function relativeCommandPoint(dx, dy) {
    const base = _lastInputWcs || getBaseWcs();
    if(!base) return null;
    const u = wcsToUcs(base.x, base.y);
    return ucsToWcs(u.x + dx, u.y + dy);
}

// ===== スナップ設定のパネル（ステータスバー・全画面の ▼） =====
function _closeOsnapPanel() { const p = document.getElementById('osnap-panel'); if(p) p.style.display = 'none'; }
function buildOsnapPanel() {
    const p = document.getElementById('osnap-panel');
    if(!p) return;
    const checks = SNAP_TYPES.map(t => `<label class="osnap-chk"><input type="checkbox" data-snap="${t.key}" ${osnapState[t.key] ? 'checked' : ''}> ${t.label}</label>`).join('');
    const divSel = `<select id="osnap-divn" class="osnap-sel">${SNAP_DIV_OPTIONS.map(n => `<option value="${n}" ${osnapState.divN === n ? 'selected' : ''}>${n}等分</option>`).join('')}</select>`;
    const once = SNAP_TYPES.map(t => `<button class="osnap-once" data-snap="${t.key}" onclick="setSnapOverride('${t.key}')">${t.label}</button>`).join('');
    p.innerHTML = `
        <div class="osnap-sec">いつも使うスナップ</div>
        <div class="osnap-grid">${checks}</div>
        <div class="osnap-row">等分点の分け方 ${divSel}</div>
        <div class="osnap-sec">次の1点だけ</div>
        <div class="osnap-once-grid">${once}</div>
        <div class="osnap-tools">
            <button class="osnap-tool" onclick="startMid2P()">2点の中点</button>
            <button class="osnap-tool" onclick="showRelativeInputPanel()">相対入力</button>
        </div>
        <div class="osnap-hint">線の上で少し止めると、その線を延ばした先（延長・延長交点・延長線上の垂線）も使えます。候補が重なったら Tab キー / ⇄ で切り替え</div>`;
    p.querySelectorAll('input[data-snap]').forEach(cb => cb.addEventListener('change', (e) => {
        osnapState[e.target.dataset.snap] = e.target.checked;
        _saveOsnapPrefs();
        if(typeof render === 'function') render();
    }));
    const sel = p.querySelector('#osnap-divn');
    if(sel) sel.addEventListener('change', (e) => { const n = parseInt(e.target.value, 10); if(SNAP_DIV_OPTIONS.includes(n)) { osnapState.divN = n; _saveOsnapPrefs(); } });
    // パネル内の操作でキャンバスの操作が始まらないように
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    updateSnapOverrideUi();
}
buildOsnapPanel();
