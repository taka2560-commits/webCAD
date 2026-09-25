// ===== Web CAD 測量計算: ヘルマート変換（SIMA の張り合わせ） =====
// cad-helmert.js - 🧮測量計算の「変換」タブ。
//   読み込んだ SIMA（変換元）を別窓（cad-subview.js）に出し、張り合わせ点（変換元の点 ↔ 図面の点）の組から、
//   回転・移動（・縮尺）を最小二乗で求め、SIMA の点・区画を図面の座標に変換する。
//   縮尺: 「1/1」（回転・移動だけ。3つの値）／「縮尺も求める」（ヘルマート変換。4つの値）
//   精度: 標準偏差 σ₀、回転・縮尺・移動の標準偏差、組ごとの残差（その組を除いて求めた変換と比べ、ほかの組と合わない組を知らせる）、
//         変換した点の精度の目安、
//         張り合わせ点で囲んだ範囲の外（外挿）の知らせ
//   範囲: 別窓で四角・なぞって囲んだ点だけを、取り込み・書き出しの対象にできる（張り合わせ点は範囲の外でもよい）
//   取り込み: 新しい画層「変換_（名前）」に入れる（元の図面の点はそのまま）。変換後の SIMA（書き出し・機械へ送る）・結果の CSV・結果の表
// 計算は測量座標（X＝北・Y＝東、m）で、重心を引いてから行う（公共座標でも桁が落ちない）。回転角は方向角と同じく右回りが正。
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

// ===== 計算 =====
/**
 * 張り合わせ点の組から変換を求める。
 * pairs: [{ src: { X, Y }, dst: { X, Y } }]（計算に使う組だけ）、mode: 'rigid'（1/1）| 'sim'（縮尺も求める）
 * 変換: X′ = X1 + a·(X − X0) − b·(Y − Y0)、Y′ = Y1 + b·(X − X0) + a·(Y − Y0)（X0・Y0: 変換元の重心、X1・Y1: 図面側の重心）
 * 戻り値: { ok, error, mode, n, a, b, scale, rot（ラジアン・右回りが正）, X0, Y0, X1, Y1, S, rMax, hull（変換元の張り合わせ点を囲む凸包・重心から）,
 *          dof, sigma0（残差の標準偏差 m。自由度が無ければ null）, sRot（ラジアン）, sScale, sShift（m）, residuals: [{ dX, dY, d }] }
 */
function helmSolve(pairs, mode) {
    const n = pairs.length;
    if(n < 2) return { ok: false, error: '張り合わせ点を2組以上指定してください' };
    let X0 = 0, Y0 = 0, X1 = 0, Y1 = 0;
    pairs.forEach((p) => { X0 += p.src.X; Y0 += p.src.Y; X1 += p.dst.X; Y1 += p.dst.Y; });
    X0 /= n; Y0 /= n; X1 /= n; Y1 /= n;
    let S = 0, P = 0, Q = 0, rMax = 0;
    pairs.forEach((p) => {
        const x = p.src.X - X0, y = p.src.Y - Y0, u = p.dst.X - X1, v = p.dst.Y - Y1;
        S += x * x + y * y; P += x * u + y * v; Q += x * v - y * u;
        rMax = Math.max(rMax, Math.hypot(x, y));
    });
    if(!(S > 1e-18)) return { ok: false, error: '変換元の張り合わせ点が同じ位置です（離れた点を選んでください）' };
    const rigid = mode === 'rigid';
    let a, b;
    if(rigid) { const th = Math.atan2(Q, P); a = Math.cos(th); b = Math.sin(th); }
    else { a = P / S; b = Q / S; }
    const scale = Math.hypot(a, b);
    if(!(scale > 1e-12)) return { ok: false, error: '図面の張り合わせ点が同じ位置です（離れた点を選んでください）' };
    const sol = { ok: true, mode: rigid ? 'rigid' : 'sim', n, a, b, scale, rot: Math.atan2(b, a), X0, Y0, X1, Y1, S, rMax,
        hull: _helmHull(pairs.map((p) => ({ x: p.src.X - X0, y: p.src.Y - Y0 }))) };
    let ss = 0;
    sol.residuals = pairs.map((p) => {
        const q = helmApply(sol, p.src.X, p.src.Y), dX = q.X - p.dst.X, dY = q.Y - p.dst.Y;
        ss += dX * dX + dY * dY;
        return { dX, dY, d: Math.hypot(dX, dY) };
    });
    sol.dof = 2 * n - (rigid ? 3 : 4);
    sol.sigma0 = sol.dof > 0 ? Math.sqrt(ss / sol.dof) : null;
    if(sol.sigma0 !== null) {
        sol.sRot = sol.sigma0 / (scale * Math.sqrt(S));
        sol.sScale = rigid ? 0 : sol.sigma0 / Math.sqrt(S);
        sol.sShift = sol.sigma0 / Math.sqrt(n);
    }
    return sol;
}
function helmApply(sol, X, Y) {
    const x = X - sol.X0, y = Y - sol.Y0;
    return { X: sol.X1 + sol.a * x - sol.b * y, Y: sol.Y1 + sol.b * x + sol.a * y };
}
// 変換した点の精度の目安（1σ・X と Y それぞれ）: σ₀·√(1/n + r²/S)。r は変換元の重心からの距離。求められなければ null
function helmPointSigma(sol, X, Y) {
    if(!sol || !sol.ok || sol.sigma0 === null || sol.sigma0 === undefined) return null;
    const r2 = (X - sol.X0) ** 2 + (Y - sol.Y0) ** 2;
    return sol.sigma0 * Math.sqrt(1 / sol.n + r2 / sol.S);
}
// 外れた組を見つける: 組 i を除いて求めた変換で、組 i がどれだけずれるか。
// （全部の組で求めた残差と σ₀ を比べるだけでは、外れた組が σ₀ を大きくして自分を隠してしまい、組が少ないと見つからない）
// 戻り値: { d（ずれ m）, sig（そのずれの標準偏差の見込み m）, flag（3倍を超える） }。除くと自由度が無いときは null
const HELM_SIGMA_FLOOR = 0.001; // 座標は mm までなので、ばらつきの見込みは 1mm より小さくしない
function helmLeaveOneOut(pairs, mode, i) {
    const sol = helmSolve(pairs.filter((_, k) => k !== i), mode);
    if(!sol.ok || sol.sigma0 === null) return null;
    const p = pairs[i], q = helmApply(sol, p.src.X, p.src.Y);
    const d = Math.hypot(q.X - p.dst.X, q.Y - p.dst.Y);
    const sig = Math.max(sol.sigma0, HELM_SIGMA_FLOOR) * Math.sqrt(1 + 1 / sol.n + ((p.src.X - sol.X0) ** 2 + (p.src.Y - sol.Y0) ** 2) / sol.S);
    return { d, sig, flag: d > 3 * sig };
}
// 点の集まりの凸包（反時計回り）。一直線に並ぶときは両端の2点
function _helmHull(pts) {
    const P = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if(P.length < 3) return P;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    P.forEach((p) => { while(lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for(let i = P.length - 1; i >= 0; i--) { const p = P[i]; while(up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop();
    return lo.concat(up);
}
function _helmSegDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
// 張り合わせ点で囲んだ範囲（凸包）の外か（外挿）。張り合わせ点の広がりの 5% までの外側は内とみなす
function helmIsExtrapolated(sol, X, Y) {
    if(!sol || !sol.ok || !sol.hull || !sol.hull.length) return false;
    const H = sol.hull, p = { x: X - sol.X0, y: Y - sol.Y0 }, tol = sol.rMax * 0.05 + 1e-9;
    if(H.length >= 3) {
        let inside = true;
        for(let i = 0; i < H.length; i++) {
            const a = H[i], b = H[(i + 1) % H.length];
            if((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) { inside = false; break; }
        }
        if(inside) return false;
    }
    let d = Infinity;
    for(let i = 0; i < H.length; i++) d = Math.min(d, _helmSegDist(p, H[i], H[(i + 1) % H.length]));
    return d > tol;
}
function _helmPpm(s) { const v = (s - 1) * 1e6; return (v > 0 ? '+' : '') + cogoFix(v, 2); }
// 回転角の文字（右回り・左回り 度分秒）
function helmRotText(rot) { const d = rot * 180 / Math.PI; return `${d >= 0 ? '右回り' : '左回り'} ${cogoFmtDms(Math.abs(d), 1)}`; }
// 点 (X, Y) が多角形 poly（[{ X, Y }]）の中か
function _helmInPoly(X, Y, poly) {
    let inside = false;
    for(let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const p = poly[i], q = poly[j];
        if((p.X > X) !== (q.X > X) && Y < (q.Y - p.Y) * (X - p.X) / (q.X - p.X) + p.Y) inside = !inside;
    }
    return inside;
}

// ===== 状態 =====
const HELM_OPTS_KEY = 'cad_helm_opts';
const HELM_LAYER_COLOR = '#ff79c6';
const HELM_LAYER_TABLE = '変換結果表';
const HELM_HINT = '点をタップ → 図面で同じ点をなぞって ☑確定';
const _helm = {
    src: null,       // 変換元 { name, title, points: [{ num, name, X, Y, z }], lots: [{ num, name, refs }] }
    pairs: [],       // 張り合わせ点の組 [{ si: 変換元の点の番号, dst: { X, Y, name }, use, res: { dX, dY, d, flag } }]
    sel: -1,         // 別窓で選んだ変換元の点（図面の点を指定する前）
    mode: (() => { try { return JSON.parse(localStorage.getItem(HELM_OPTS_KEY) || '{}').mode === 'rigid' ? 'rigid' : 'sim'; } catch { return 'sim'; } })(),
    range: null,     // 取り込む範囲 { kind: 'rect' | 'lasso', poly: [{ X, Y }] }（変換元の座標）。null なら全部
    sol: null,       // 計算の結果（helmSolve）
    applied: '',     // 取り込んだ画層の名前
    folded: false,   // 図面で点を指定するあいだ、別窓をたたんだか
    viewClosed: false, // 別窓を ✕ で閉じた（「🗺 別窓を開く」まで出さない）
    shapeKind: '',   // 別窓で範囲を囲んでいる途中（'rect' | 'lasso'）
    rangeCache: null,
};
COGO_SLOT_LABELS.HT = ['図面の点', '図'];
cogoRegisterPickOwner('helm', { slots: () => ['HT'], render: () => { _helmAfterPick(); _cogoRender(); }, update: () => _cogoUpdateResult() });

let _helmViewInst = null;
function _helmView() {
    if(!_helmViewInst) {
        _helmViewInst = createSubView({
            id: 'helm-view', title: '📄 変換元（SIMA）', posKey: 'cad_helm_view_pos', sizeKey: 'cad_helm_view_size', hint: HELM_HINT,
            onTap: (X, Y, sx, sy) => _helmTapSource(sx, sy),
            onDraw: (g, api) => _helmDrawView(g, api),
            onFit: () => _helmFitView(),
            onClose: () => { _helm.viewClosed = true; _helmEndShape(); },
        });
    }
    return _helmViewInst;
}
function _helmFitView() {
    const s = _helm.src;
    if(!s || !s.points.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    s.points.forEach((p) => { minX = Math.min(minX, p.X); maxX = Math.max(maxX, p.X); minY = Math.min(minY, p.Y); maxY = Math.max(maxY, p.Y); });
    _helmView().fit({ minX, maxX, minY, maxY });
}
window.helmOpenView = function() {
    if(!_helm.src) return;
    _helm.viewClosed = false;
    const v = _helmView();
    v.open(); v.setCollapsed(false); _helmFitView();
};
// 範囲を囲むのをやめる（別窓を閉じた・隠したとき）
function _helmEndShape() {
    if(!_helm.shapeKind) return;
    _helm.shapeKind = '';
    if(_helmViewInst) { _helmViewInst.cancelShape(); _helmViewInst.setHint(HELM_HINT); }
    if(_helmOverlayOn() && !cogoIsPicking()) _cogoRender();
}
// 別窓は、測量計算の「変換」タブを開いているあいだ（図面で点を指定しているあいだも）だけ出す。
// パネルの表示・題名が変わるたびに確かめる（パネルを閉じた・別のタブや別のパネルにしたときは隠す）
let _helmSyncPending = false;
function _helmSyncView() {
    if(_helmSyncPending) return;
    _helmSyncPending = true;
    requestAnimationFrame(() => {
        _helmSyncPending = false;
        if(!_helmViewInst) return;
        const want = !_helm.viewClosed && _helmOverlayOn();
        if(want && !_helmViewInst.isOpen()) _helmViewInst.open();
        else if(!want && _helmViewInst.isOpen()) { _helmEndShape(); _helmViewInst.hide(); }
        else _helmViewInst.fitPanel(); // パネルを開き直した・動かしたとき（スマホでは別窓の上までの高さに）
    });
}
(function _helmWatchPanel() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    if(!p || typeof window.MutationObserver !== 'function') return;
    const mo = new window.MutationObserver(_helmSyncView);
    mo.observe(p, { attributes: true, attributeFilter: ['style'] });
    if(t) mo.observe(t, { childList: true, characterData: true, subtree: true });
})();

// 範囲の中の点の番号（範囲が無ければ全部）
function _helmRangeIndices() {
    const s = _helm.src;
    if(!s) return [];
    const c = _helm.rangeCache;
    if(c && c.src === s && c.range === _helm.range) return c.idx;
    const idx = [];
    s.points.forEach((p, i) => { if(!_helm.range || _helmInPoly(p.X, p.Y, _helm.range.poly)) idx.push(i); });
    _helm.rangeCache = { src: s, range: _helm.range, idx };
    return idx;
}
// 範囲の中の区画（構成点がすべて範囲の中のもの）
function _helmRangeLots() {
    const s = _helm.src;
    if(!s || !s.lots.length) return [];
    const inSet = new Set(_helmRangeIndices());
    const byNum = new Map(), byName = new Map();
    s.points.forEach((p, i) => {
        if(p.num !== '' && p.num !== undefined && !byNum.has(String(p.num))) byNum.set(String(p.num), i);
        if(p.name && !byName.has(p.name)) byName.set(p.name, i);
    });
    return s.lots.filter((lot) => lot.refs.length >= 3 && lot.refs.every((r) => {
        const i = byNum.has(String(r.num)) ? byNum.get(String(r.num)) : byName.get(r.name);
        return i !== undefined && inSet.has(i);
    }));
}
// 変換元の点 i を変換した点（点番号・点名・標高はそのまま）
function _helmOut(i) {
    const p = _helm.src.points[i], q = helmApply(_helm.sol, p.X, p.Y);
    return { num: p.num, name: p.name, X: q.X, Y: q.Y, z: p.z };
}

// ===== 読み込み =====
window.helmPickFile = function() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.sim,.txt';
    inp.onchange = async () => { const f = inp.files && inp.files[0]; if(f) await helmLoadFile(f); };
    inp.click();
};
async function helmLoadFile(file) {
    try {
        const dec = await _readTextFile(file);
        return helmLoadSimaText(dec.text, file.name);
    } catch(e) { showToast('SIMA を読み込めませんでした: ' + e.message, 4000); return false; }
}
function helmLoadSimaText(text, name) {
    const d = parseSima(text);
    if(!d.points.length) { showToast('SIMA に座標データ（A01）がありません', 3500); return false; }
    helmSetSource({ name: name || 'SIMA', title: d.title || '', points: d.points, lots: d.lots });
    return true;
}
// TS連携で受信した SIMA を変換元にする（受信したデータは変換の側へ渡す）
window.helmFromTs = function() {
    const r = typeof _tsCurrent === 'function' ? _tsCurrent() : null;
    if(!r || r.format !== 'SIMA' || !r.simaPoints || !r.simaPoints.length) return false;
    _ts.pending = null; _ts.parser = null; _ts.sima = '';
    helmSetSource({ name: r.job || 'TS受信', title: r.job || '', points: r.simaPoints, lots: r.lots || [] });
    return true;
};
// 変換元を決める（組・範囲・結果はやり直し）
function helmSetSource(src) {
    if(cogoIsPicking()) { _cogo.pick = null; resetCommand(); }
    _helmEndShape();
    Object.assign(_helm, { src, pairs: [], sel: -1, range: null, sol: null, applied: '', folded: false, viewClosed: false });
    const v = _helmView();
    v.setTitle(`📄 変換元: ${src.name}`);
    showCogoPanel('helm');
    v.open(); v.setCollapsed(false); _helmFitView();
    addCommandLog(`-> [変換] 変換元の SIMA: ${src.name}（点 ${src.points.length}${src.lots.length ? '・区画 ' + src.lots.length : ''}）`);
    showToast('別窓の点をタップ → 図面で同じ点を ☑確定 で、張り合わせ点を2組以上指定します', 4500);
}

// ===== 張り合わせ点 =====
// 別窓でタップした位置のいちばん近い点を選ぶ
function _helmTapSource(sx, sy) {
    const s = _helm.src;
    if(!s) return;
    const v = _helmView();
    let best = -1, bd = 22;
    s.points.forEach((p, i) => { const q = v.toScreen(p.X, p.Y), d = Math.hypot(q.x - sx, q.y - sy); if(d < bd) { bd = d; best = i; } });
    if(best < 0) { showToast('点の近くをタップしてください（拡大すると選びやすくなります）', 2500); return; }
    helmSelectSource(best);
}
// 変換元の点 i を選び、図面で相手の点を指定する（☑確定）
window.helmSelectSource = function(i) {
    if(!_helm.src || !_helm.src.points[i]) return false;
    _helm.sel = i;
    _cogo.tab = 'helm';
    const v = _helmView(), sp = _helm.src.points[i];
    addCommandLog(`-> [変換] SIMA の点「${sp.name || sp.num}」を選びました。図面で同じ点をなぞって ☑確定`);
    if(window.innerWidth < 700) { v.setCollapsed(true); _helm.folded = true; } // スマホでは図面が見えるように別窓をたたむ
    v.redraw();
    cogoPick('HT', 'helm');
    return true;
};
// 点の指定のあと（パネルを描き直す前）: 図面の点が決まっていれば組にする
function _helmAfterPick() {
    const picking = cogoIsPicking();
    if(!picking && _helm.folded) { _helm.folded = false; if(_helmViewInst) _helmViewInst.setCollapsed(false); }
    const s = _cogo.slots.HT;
    if(!s) {
        if(!picking && _helm.sel >= 0) { _helm.sel = -1; if(_helmViewInst) _helmViewInst.redraw(); } // ❌終了で指定をやめた
        return;
    }
    delete _cogo.slots.HT;
    if(_helm.sel < 0 || !_helm.src) return;
    const sv = wcsToSurvey(s.x, s.y), si = _helm.sel;
    _helm.sel = -1;
    const pr = { si, dst: { X: sv.X, Y: sv.Y, name: s.name || '' }, use: true };
    let k = _helm.pairs.findIndex((p) => p.si === si); // 同じ点を指定し直したときは、同じ番号のまま入れ替える
    if(k >= 0) _helm.pairs[k] = pr; else { _helm.pairs.push(pr); k = _helm.pairs.length - 1; }
    const sp = _helm.src.points[si];
    addCommandLog(`-> [変換] 組 No.${k + 1}: SIMA「${sp.name || sp.num}」↔ 図面「${s.name || '(点名なし)'}」`);
    _helmSolveNow();
    if(_helmViewInst) _helmViewInst.redraw();
}
function _helmChanged() { _helmSolveNow(); _cogoRender(); renderOverlay(); if(_helmViewInst) _helmViewInst.redraw(); }
window.helmPairByName = function() {
    if(!_helm.src) return 0;
    const map = new Map();
    collectSurveyPoints().forEach((p) => {
        if(!p.name || map.has(p.name)) return;
        const e = entities[p.idx], ln = e && layers[e.layer] ? layers[e.layer].name : '';
        if(/^変換_/.test(ln)) return; // 取り込んだ変換後の点は使わない
        const w = wcsToSurvey(p.x, p.y);
        map.set(p.name, { X: w.X, Y: w.Y, name: p.name });
    });
    let added = 0;
    _helm.src.points.forEach((sp, i) => {
        if(!sp.name || _helm.pairs.some((q) => q.si === i)) return;
        const d = map.get(sp.name);
        if(d) { _helm.pairs.push({ si: i, dst: Object.assign({}, d), use: true }); added++; }
    });
    _helmChanged();
    if(added) addCommandLog(`-> [変換] 点名が同じ点を ${added}組にしました`);
    showToast(added ? `点名が同じ点を ${added}組にしました` : '図面に、点名が同じ点が見つかりませんでした', 3000);
    return added;
};
window.helmUsePair = function(k, on) { const p = _helm.pairs[k]; if(!p) return; p.use = !!on; _helmChanged(); };
window.helmDeletePair = function(k) { if(!_helm.pairs[k]) return; _helm.pairs.splice(k, 1); _helmChanged(); };
window.helmSetMode = function(m) {
    _helm.mode = m === 'rigid' ? 'rigid' : 'sim';
    try { localStorage.setItem(HELM_OPTS_KEY, JSON.stringify({ mode: _helm.mode })); } catch { /* 保存できなくても続行 */ }
    _helmChanged();
};
// 取り込む範囲: 全部／四角で囲む／なぞって囲む（別窓で）
window.helmSetRange = function(kind) {
    if(!_helm.src) return;
    const v = _helmView();
    if(kind !== 'rect' && kind !== 'lasso') { _helmEndShape(); _helm.range = null; _helmChanged(); return; }
    _helm.viewClosed = false;
    v.open(); v.setCollapsed(false);
    _helm.shapeKind = kind;
    v.setHint(kind === 'rect' ? '取り込む範囲を、ドラッグして四角に囲んでください' : '取り込む範囲を、なぞって囲んでください');
    v.startShape(kind, (poly) => {
        _helm.shapeKind = '';
        v.setHint(HELM_HINT);
        if(poly) { _helm.range = { kind, poly }; addCommandLog(`-> [変換] 取り込む範囲: ${_helmRangeIndices().length} / ${_helm.src.points.length}点`); }
        _helmChanged();
    });
    _cogoRender();
    showToast(kind === 'rect' ? '別窓で、取り込む範囲をドラッグして四角に囲みます' : '別窓で、取り込む範囲をなぞって囲みます', 3000);
};
// 組から計算し直す（組ごとの残差と、ほかの組と合わない組の印 flag も付ける）
function _helmSolveNow() {
    const s = _helm.src;
    if(!s) { _helm.sol = null; return; }
    const used = _helm.pairs.filter((p) => p.use && s.points[p.si]);
    const up = used.map((p) => ({ src: s.points[p.si], dst: p.dst }));
    const sol = _helm.sol = helmSolve(up, _helm.mode);
    _helm.pairs.forEach((p) => {
        const sp = s.points[p.si];
        if(!sol.ok || !sp) { p.res = null; return; }
        const q = helmApply(sol, sp.X, sp.Y), dX = q.X - p.dst.X, dY = q.Y - p.dst.Y, d = Math.hypot(dX, dY);
        p.res = { dX, dY, d, loo: null, flag: false };
        if(!p.use && sol.sigma0 !== null) { // 計算に使っていない組は、そのまま今の変換と比べる
            const sig = Math.max(sol.sigma0, HELM_SIGMA_FLOOR) * Math.sqrt(1 + 1 / sol.n + ((sp.X - sol.X0) ** 2 + (sp.Y - sol.Y0) ** 2) / sol.S);
            p.res.flag = d > 3 * sig;
        }
    });
    if(sol.ok) used.forEach((p, k) => { const lo = helmLeaveOneOut(up, _helm.mode, k); if(lo) { p.res.loo = lo.d; p.res.flag = lo.flag; } });
}

// ===== パネル（測量計算の「変換」タブ） =====
function helmTabHtml() {
    const s = _helm.src;
    let h = `<div class="cogo-btns"><button class="prop-btn${s ? ' btn-sub' : ''}" onclick="helmPickFile()">📁 SIMA を読み込む</button>` +
        (s ? '<button class="prop-btn btn-sub" onclick="helmOpenView()">🗺 別窓を開く</button>' : '') + '</div>';
    if(!s) {
        return h + _cogoNote('別の座標で測った SIMA を、図面の座標に合わせて取り込みます。読み込んだ SIMA は別窓に出るので、点をタップ → 図面で同じ点をなぞって ☑確定 で、張り合わせ点を2組以上指定します。TS連携で受信した SIMA も「🧮 変換して取り込む」で使えます。');
    }
    h += _cogoKv([['変換元', `${escapeHtml(s.name)}（点 ${s.points.length}${s.lots.length ? '・区画 ' + s.lots.length : ''}）`]]);
    h += `<div class="prop-row cogo-row"><div class="prop-label cogo-label">縮尺</div>${_cogoSeg(_helm.mode, [['rigid', '1/1（そのまま）'], ['sim', '縮尺も求める']], 'helmSetMode')}</div>`;
    const rk = _helm.shapeKind || (_helm.range ? _helm.range.kind : 'all');
    h += `<div class="prop-row cogo-row"><div class="prop-label cogo-label">取り込む範囲</div>${_cogoSeg(rk, [['all', '全部'], ['rect', '▭ 四角'], ['lasso', '✎ なぞる']], 'helmSetRange')}</div>`;
    if(_helm.shapeKind) h += _cogoNote(_helm.shapeKind === 'rect' ? '別窓で、取り込む範囲をドラッグして四角に囲んでください。' : '別窓で、取り込む範囲を指でなぞって囲んでください。');
    else if(_helm.range) h += _cogoNote(`範囲の中の点 ${_helmRangeIndices().length} / ${s.points.length}（別窓の水色の枠）。張り合わせ点は範囲の外でも使えます。`);
    const nUse = _helm.pairs.filter((p) => p.use).length;
    h += `<div class="ts-sec">張り合わせ点${_helm.pairs.length ? `（計算に使う ${nUse} / ${_helm.pairs.length}組）` : ''}</div>`;
    h += '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="helmPairByName()">🔗 点名が同じ点を組にする</button></div>';
    if(!_helm.pairs.length) return h + _cogoNote('別窓で点をタップ → 図面で同じ点をなぞって ☑確定（測点に吸い付きます）。2組以上で計算し、3組以上で精度を確かめられます。');
    const rows = _helm.pairs.map((p, k) => {
        const sp = s.points[p.si] || {}, r = p.res;
        return `<tr${r && r.flag ? ' class="helm-flag"' : ''}><td class="c">${k + 1}</td><td>${escapeHtml(sp.name || sp.num || '')}</td><td>${escapeHtml(p.dst.name || '(点名なし)')}</td>` +
            `<td class="r">${r ? cogoFix(r.d * 1000, 1) : ''}</td><td class="c"><input type="checkbox" ${p.use ? 'checked' : ''} onchange="helmUsePair(${k}, this.checked)"></td>` +
            `<td class="c"><button class="helm-x" onclick="helmDeletePair(${k})" title="この組を消す">✕</button></td></tr>`;
    }).join('');
    return h + `<div class="cogo-table-wrap"><table class="cogo-table"><thead><tr><th>No</th><th>SIMA の点</th><th>図面の点</th><th>較差 mm</th><th>使う</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
// 変換した点の精度の目安（範囲の中の点の、いちばん良い〜悪い）と、外挿の点の数
function _helmPointStats() {
    const sol = _helm.sol, idx = _helmRangeIndices();
    let min = Infinity, max = -Infinity, extra = 0;
    idx.forEach((i) => {
        const p = _helm.src.points[i], sg = helmPointSigma(sol, p.X, p.Y);
        if(sg !== null) { min = Math.min(min, sg); max = Math.max(max, sg); }
        if(helmIsExtrapolated(sol, p.X, p.Y)) extra++;
    });
    return { n: idx.length, min: isFinite(min) ? min : null, max: isFinite(max) ? max : null, extra };
}
function helmResultHtml() {
    if(!_helm.src) return '';
    const sol = _helm.sol, nUse = _helm.pairs.filter((p) => p.use).length;
    if(nUse < 2) return _helm.pairs.length ? _cogoNote(`あと ${2 - nUse}組 指定すると計算します。`) : '';
    if(!sol || !sol.ok) return `<div class="cogo-warn">⚠ ${escapeHtml((sol && sol.error) || '計算できません')}</div>`;
    const acc = sol.sigma0 !== null, st = _helmPointStats();
    let worst = null;
    _helm.pairs.forEach((p) => { if(p.use && p.res && (!worst || p.res.d > worst.res.d)) worst = p; });
    const kv = [
        ['回転', helmRotText(sol.rot) + (acc ? `（±${cogoFix(sol.sRot * 180 / Math.PI * 3600, 1)}″）` : '')],
        ['縮尺', sol.mode === 'rigid' ? '1（そのまま）' : `${sol.scale.toFixed(8)}<br>（${_helmPpm(sol.scale)} ppm${acc ? ` ±${cogoFix(sol.sScale * 1e6, 1)}` : ''}）`],
        ['重心の移動', `ΔX ${_cogoSigned(sol.X1 - sol.X0)}<br>ΔY ${_cogoSigned(sol.Y1 - sol.Y0)}${acc ? `<br>（±${cogoFix(sol.sShift * 1000, 1)} mm）` : ''}`],
        ['標準偏差 σ₀', acc ? `${cogoFix(sol.sigma0 * 1000, 1)} mm（${sol.n}組・自由度 ${sol.dof}）` : `確かめられません（${sol.n}組）`, 'cogo-big'],
    ];
    if(worst && acc) kv.push(['最大の較差', `${cogoFix(worst.res.d * 1000, 1)} mm（No.${_helm.pairs.indexOf(worst) + 1}）`]);
    if(st.min !== null) kv.push(['変換した点の精度', `${cogoFix(st.min * 1000, 1)}〜${cogoFix(st.max * 1000, 1)} mm（1σ・目安）`]);
    let h = _cogoKv(kv);
    if(!acc) h += '<div class="cogo-warn">⚠ ' + (sol.mode === 'sim' ? '縮尺も求めるときは、3組以上で精度を確かめられます（2組では、ちょうど合わせるだけです）' : '組を増やすと、精度を確かめられます') + '</div>';
    const flagged = _helm.pairs.map((p, k) => (p.use && p.res && p.res.flag ? k + 1 : 0)).filter(Boolean);
    if(flagged.length) h += `<div class="cogo-warn">⚠ No.${flagged.join('・No.')} は、ほかの組と合っていません（その組を除いて求めた変換とのずれが、ばらつきの3倍を超えています）。点の取り違えが無いか確かめてください。「使う」を外すと、その組を除いて計算し直します</div>`;
    if(st.extra) h += `<div class="cogo-warn">⚠ 張り合わせ点で囲んだ範囲の外の点が ${st.extra}点あります（外挿。張り合わせ点から離れるほど精度が下がります）</div>`;
    const tsOn = typeof _ts !== 'undefined' && !!_ts.port;
    h += '<div class="cogo-btns"><button class="prop-btn" onclick="helmImport()">✅ 図面に取り込む</button>' +
        '<button class="prop-btn btn-sub" onclick="helmExportSima()">📄 変換後の SIMA</button>' +
        (tsOn ? '<button class="prop-btn btn-sub" onclick="helmSendSima()" title="変換後の点を SIMA で機械へ送る">📤 機械へ送る</button>' : '') +
        '<button class="prop-btn btn-sub" onclick="helmExportCsv()">📄 結果の CSV</button>' +
        '<button class="prop-btn btn-sub" onclick="helmPlaceTable()" title="結果の表を図面に置く">📋 結果の表を置く</button></div>';
    const nLots = _helmRangeLots().length;
    h += _cogoNote(`取り込むと、新しい画層「${escapeHtml(_helmLayerName())}」に 点 ${st.n}${nLots ? '・区画 ' + nLots : ''} が入ります（元の図面の点はそのまま）。` +
        (_helm.applied ? `<br>取り込み済み: 画層「${escapeHtml(_helm.applied)}」` : ''));
    return h;
}

// ===== 取り込み・書き出し =====
function _helmBaseName() { return String((_helm.src && _helm.src.name) || 'SIMA').replace(/\.[^.]+$/, '').trim() || 'SIMA'; }
// 取り込む画層の名前（「変換_名前」。すでにあれば (2)・(3)…）
function _helmLayerName() {
    const base = '変換_' + _helmBaseName();
    if(!layers.some((l) => l.name === base)) return base;
    for(let k = 2; ; k++) { const n = `${base}(${k})`; if(!layers.some((l) => l.name === n)) return n; }
}
window.helmImport = function() {
    const sol = _helm.sol;
    if(!_helm.src || !sol || !sol.ok) return false;
    const idx = _helmRangeIndices();
    if(!idx.length) { showToast('取り込む範囲に点がありません', 3000); return false; }
    if(_helm.applied && !confirm(`画層「${_helm.applied}」に取り込み済みです。もう一度、別の画層に取り込みますか？`)) return false;
    const layer = _helmLayerName(), lots = _helmRangeLots();
    saveUndo();
    const r = addSurveyData(idx.map(_helmOut), lots, { layer, color: HELM_LAYER_COLOR });
    _helm.applied = layer;
    render();
    addCommandLog(`-> [変換] 画層「${layer}」に取り込みました: 点 ${r.pointCount}${r.lotCount ? '・区画 ' + r.lotCount : ''}（${sol.mode === 'rigid' ? '1/1' : '縮尺 ' + sol.scale.toFixed(8)}・${helmRotText(sol.rot)}${sol.sigma0 !== null ? `・σ₀ ${cogoFix(sol.sigma0 * 1000, 1)}mm` : ''}）`);
    showToast(`画層「${layer}」に 点 ${r.pointCount}${r.lotCount ? '・区画 ' + r.lotCount : ''} を取り込みました`, 3500);
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    _cogoUpdateResult();
    return true;
};
// 変換後の SIMA の行（範囲の中の点。withLots なら区画も。点番号・点名・標高はそのまま）
function helmSimaLines(withLots) {
    const idx = _helmRangeIndices(), lots = withLots ? _helmRangeLots() : [];
    const L = [`G00,01,${_simaField((_helm.src.title || _helmBaseName()) + '_変換')},`, 'Z00,座標ﾃﾞｰﾀ,,', 'A00,'];
    idx.forEach((i) => L.push(_simaA01(_helmOut(i))));
    L.push('A99,');
    if(lots.length) {
        L.push('Z00,区画ﾃﾞｰﾀ,');
        lots.forEach((lot, k) => {
            L.push(`D00,${_simaField(lot.num || String(k + 1))},${_simaField(lot.name)},1,`);
            lot.refs.forEach((r) => L.push(`B01,${_simaField(r.num)},${_simaField(r.name)},`));
            L.push('D99,');
        });
    }
    return { lines: L, pointCount: idx.length, lotCount: lots.length };
}
window.helmExportSima = function() {
    if(!_helm.sol || !_helm.sol.ok) return false;
    const r = helmSimaLines(true);
    downloadBlob(new Blob([encodeShiftJis(r.lines.join('\r\n') + '\r\n')], { type: 'text/plain' }), `${_helmBaseName()}_変換.sim`);
    addCommandLog(`-> [変換] 変換後の SIMA を書き出しました: 点 ${r.pointCount}${r.lotCount ? '・区画 ' + r.lotCount : ''}（Shift-JIS）`);
    showToast(`変換後の SIMA: 点 ${r.pointCount}${r.lotCount ? '・区画 ' + r.lotCount : ''}`, 3000);
    return true;
};
// 変換後の点を機械へ送る（既知点の外部入力。座標だけ）
window.helmSendSima = async function() {
    if(!_helm.sol || !_helm.sol.ok || typeof tsSendSimaLines !== 'function') return false;
    const r = helmSimaLines(false);
    if(!r.pointCount) { showToast('送る点がありません', 3000); return false; }
    return tsSendSimaLines(r.lines, r.pointCount, '変換後の');
};
// 結果の CSV（変換の値・精度・張り合わせ点の残差・変換した点と精度の目安）
function helmCsvText() {
    const sol = _helm.sol, s = _helm.src, f3 = (v) => cogoFix(v, 3), mm = (v) => cogoFix(v * 1000, 1), acc = sol.sigma0 !== null;
    const q = (t) => /[",\r\n]/.test(String(t)) ? '"' + String(t).replace(/"/g, '""') + '"' : String(t);
    const L = [];
    const row = (...c) => L.push(c.map(q).join(','));
    row('ヘルマート変換の結果');
    row('変換元', s.name);
    row('縮尺の扱い', sol.mode === 'rigid' ? '1/1（回転・移動）' : '縮尺も求める（ヘルマート変換）');
    row('組の数', sol.n, '自由度', sol.dof);
    row('回転（右回りが正）', helmRotText(sol.rot), '標準偏差（秒）', acc ? cogoFix(sol.sRot * 180 / Math.PI * 3600, 2) : '');
    row('縮尺', sol.scale.toFixed(10), 'ppm', _helmPpm(sol.scale), '標準偏差（ppm）', acc && sol.mode === 'sim' ? cogoFix(sol.sScale * 1e6, 2) : '');
    row('標準偏差 σ0（mm）', acc ? mm(sol.sigma0) : '（自由度が無いため求められない）', '重心の移動の標準偏差（mm）', acc ? mm(sol.sShift) : '');
    row('変換の式', "X' = X1 + a(X - X0) - b(Y - Y0)", "Y' = Y1 + b(X - X0) + a(Y - Y0)");
    row('a', sol.a.toFixed(12), 'b', sol.b.toFixed(12));
    row('X0（変換元の重心）', f3(sol.X0), 'Y0', f3(sol.Y0));
    row('X1（図面側の重心）', f3(sol.X1), 'Y1', f3(sol.Y1));
    L.push('');
    row('張り合わせ点');
    row('No', 'SIMA の点', '図面の点', 'SIMA X', 'SIMA Y', '図面 X', '図面 Y', '変換後 X', '変換後 Y', 'ΔX(mm)', 'ΔY(mm)', '較差(mm)', '計算に使う', 'その組を除いて求めた変換とのずれ(mm)', 'ほかの組と合わない（3σ超え）');
    _helm.pairs.forEach((p, k) => {
        const sp = s.points[p.si], t = helmApply(sol, sp.X, sp.Y), dX = t.X - p.dst.X, dY = t.Y - p.dst.Y;
        row(k + 1, sp.name || sp.num, p.dst.name, f3(sp.X), f3(sp.Y), f3(p.dst.X), f3(p.dst.Y), f3(t.X), f3(t.Y), mm(dX), mm(dY), mm(Math.hypot(dX, dY)), p.use ? '○' : '×',
            p.res && p.res.loo !== null && p.res.loo !== undefined ? mm(p.res.loo) : '', p.res && p.res.flag ? '○' : '');
    });
    L.push('');
    row('変換した点' + (_helm.range ? '（範囲の中）' : ''));
    row('点番号', '点名', 'SIMA X', 'SIMA Y', '変換後 X', '変換後 Y', '標高', '精度の目安 1σ(mm)', '外挿');
    _helmRangeIndices().forEach((i) => {
        const sp = s.points[i], t = _helmOut(i), sg = helmPointSigma(sol, sp.X, sp.Y);
        row(sp.num, sp.name, f3(sp.X), f3(sp.Y), f3(t.X), f3(t.Y), sp.z === null || sp.z === undefined ? '' : f3(sp.z), sg === null ? '' : mm(sg), helmIsExtrapolated(sol, sp.X, sp.Y) ? '○' : '');
    });
    return L.join('\r\n') + '\r\n';
}
window.helmExportCsv = function() {
    if(!_helm.sol || !_helm.sol.ok) return false;
    downloadBlob(new Blob([String.fromCharCode(0xFEFF) + helmCsvText()], { type: 'text/csv' }), `${_helmBaseName()}_変換結果.csv`); // Excel で文字化けしないように BOM を付ける
    addCommandLog('-> [変換] 結果の CSV を書き出しました');
    return true;
};
// 結果の表（張り合わせ点の残差と、変換の値・精度）を、変換した点の右に置く
window.helmPlaceTable = function() {
    const sol = _helm.sol;
    if(!_helm.src || !sol || !sol.ok) return false;
    const idx = _helmRangeIndices(), wp = (idx.length ? idx : _helm.pairs.map((p) => p.si)).map((i) => { const t = _helmOut(i); return surveyToWcs(t.X, t.Y); });
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    wp.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    const h = cogoNoteHeight(wp), acc = sol.sigma0 !== null, st = _helmPointStats();
    const rows = _helm.pairs.map((p, k) => {
        const sp = _helm.src.points[p.si], r = p.res;
        return [String(k + 1), sp.name || sp.num || '', p.dst.name || '', r ? cogoFix(r.dX * 1000, 1) : '', r ? cogoFix(r.dY * 1000, 1) : '', r ? cogoFix(r.d * 1000, 1) + (p.use ? '' : '（除外）') : ''];
    });
    const foot = [['回転', helmRotText(sol.rot) + (acc ? ` ±${cogoFix(sol.sRot * 180 / Math.PI * 3600, 1)}″` : '')],
        ['縮尺', sol.mode === 'rigid' ? '1（1/1）' : `${sol.scale.toFixed(8)}${acc ? ` ±${cogoFix(sol.sScale * 1e6, 1)}ppm` : ''}`],
        ['標準偏差 σ₀', acc ? `${cogoFix(sol.sigma0 * 1000, 1)} mm（自由度 ${sol.dof}）` : '―'],
        ['点の精度（目安）', st.min !== null ? `${cogoFix(st.min * 1000, 1)}〜${cogoFix(st.max * 1000, 1)} mm` : '―']];
    const t = cogoGridTable({ left: maxX + h * 3, top: maxY, h, layer: _ensureSurveyLayer(HELM_LAYER_TABLE, '#ffffff'),
        title: 'ヘルマート変換（' + (sol.mode === 'rigid' ? '1/1' : '縮尺あり') + '）　' + _helmBaseName(),
        cols: [{ head: 'No', align: 'center' }, { head: 'SIMA の点', align: 'left' }, { head: '図面の点', align: 'left' }, { head: 'ΔX mm', align: 'right' }, { head: 'ΔY mm', align: 'right' }, { head: '較差 mm', align: 'right' }],
        rows, foot, footCol: 5 });
    _cogoPushGroup(t.entities, 'helm', 'ヘルマート変換');
    _cogoZoomTo(minX, maxY - t.height, maxX + h * 3 + t.width, maxY);
    addCommandLog('-> [変換] 結果の表を置きました');
    showToast('結果の表を置きました（移動で動かせます）', 3000);
    if(window.innerWidth < 700) hidePropertyPanel(); // スマホでは置いた表を見せる
    return true;
};

// ===== 表示 =====
// 別窓: 変換元の点・区画・範囲・張り合わせ点で囲んだ範囲・張り合わせ点・選んだ点
function _helmDrawView(g, api) {
    const s = _helm.src;
    if(!s) return;
    const light = typeof isLightCanvasBg === 'function' && isLightCanvasBg();
    const fg = light ? '#333333' : '#e0e0e0', dim = light ? '#bbbbbb' : '#555555';
    const W = api.canvas.width, H = api.canvas.height, sol = _helm.sol && _helm.sol.ok ? _helm.sol : null;
    const path = (pts) => { g.beginPath(); pts.forEach((p, i) => { const q = api.toScreen(p.X, p.Y); if(i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); g.closePath(); };
    // 区画
    if(s.lots.length) {
        const byNum = new Map(), byName = new Map();
        s.points.forEach((p) => { if(p.num !== '' && !byNum.has(String(p.num))) byNum.set(String(p.num), p); if(p.name && !byName.has(p.name)) byName.set(p.name, p); });
        g.strokeStyle = dim; g.lineWidth = 1;
        s.lots.forEach((lot) => {
            const vs = lot.refs.map((r) => byNum.get(String(r.num)) || byName.get(r.name)).filter(Boolean);
            if(vs.length >= 3) { path(vs); g.stroke(); }
        });
    }
    // 取り込む範囲（水色）と、張り合わせ点で囲んだ範囲（緑の点線）
    if(_helm.range) {
        g.save(); g.strokeStyle = '#00ffff'; g.fillStyle = 'rgba(0,255,255,0.08)'; g.lineWidth = 1.5; g.setLineDash([6, 4]);
        path(_helm.range.poly); g.fill(); g.stroke(); g.restore();
    }
    if(sol && sol.hull.length >= 3) {
        g.save(); g.strokeStyle = 'rgba(0,255,136,0.5)'; g.lineWidth = 1; g.setLineDash([3, 3]);
        path(sol.hull.map((p) => ({ X: p.x + sol.X0, Y: p.y + sol.Y0 }))); g.stroke(); g.restore();
    }
    // 点（範囲の外は薄く、張り合わせ点で囲んだ範囲の外は黄色）。画面に出ている点が少ないときは点名も
    const inSet = _helm.range ? new Set(_helmRangeIndices()) : null;
    const vis = [];
    s.points.forEach((p, i) => { const q = api.toScreen(p.X, p.Y); if(q.x > -10 && q.y > -10 && q.x < W + 10 && q.y < H + 10) vis.push([i, q]); });
    g.lineWidth = 1; g.font = '11px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom';
    vis.forEach(([i, q]) => {
        const p = s.points[i], c = inSet && !inSet.has(i) ? dim : sol && helmIsExtrapolated(sol, p.X, p.Y) ? '#ffcc00' : fg;
        g.strokeStyle = c; g.beginPath(); g.moveTo(q.x - 3, q.y - 3); g.lineTo(q.x + 3, q.y + 3); g.moveTo(q.x + 3, q.y - 3); g.lineTo(q.x - 3, q.y + 3); g.stroke();
        if(vis.length <= 300) { g.fillStyle = c; g.fillText(p.name || p.num || '', q.x + 5, q.y - 3); }
    });
    // 張り合わせ点（緑。ほかの組と合わない組は黄色、使わない組は灰色）
    g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    _helm.pairs.forEach((pr, k) => {
        const p = s.points[pr.si];
        if(!p) return;
        const q = api.toScreen(p.X, p.Y), c = !pr.use ? '#888888' : pr.res && pr.res.flag ? '#ffcc00' : '#00ff88';
        g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 8, 0, Math.PI * 2); g.stroke();
        g.fillStyle = c; g.fillText(String(k + 1), q.x - 14, q.y - 11); // 番号は左上（点名は右に出る）
    });
    // 選んだ点（図面の点を待っている）
    if(_helm.sel >= 0 && s.points[_helm.sel]) {
        const p = s.points[_helm.sel], q = api.toScreen(p.X, p.Y);
        g.strokeStyle = '#00ffff'; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 11, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#00ffff'; g.textAlign = 'left'; g.fillText('→ 図面で指定', q.x + 14, q.y + 12);
    }
}
function _helmOverlayOn() {
    if(!_helm.src) return false;
    if(cogoIsPicking()) return !!(_cogo.pick && _cogo.pick.owner === 'helm');
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return _cogo.tab === 'helm' && !!(p && p.style.display === 'flex' && t && t.textContent === COGO_TITLE);
}
// 図面: 張り合わせ点の番号、変換後の点（取り込む前の確かめ用・水色。外挿の点は黄色）、選んだ点の見込みの位置
function drawHelmOverlay() {
    if(!_helmOverlayOn()) return;
    const s = _helm.src, sol = _helm.sol && _helm.sol.ok ? _helm.sol : null;
    ctx.save();
    if(sol) {
        const idx = _helmRangeIndices(), many = idx.length > 150;
        ctx.lineWidth = 1.2; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        idx.slice(0, 5000).forEach((i) => {
            const p = s.points[i], t = helmApply(sol, p.X, p.Y), w = surveyToWcs(t.X, t.Y), q = wcsToScreen(w.x, w.y);
            if(q.x < -20 || q.y < -20 || q.x > canvas.width + 20 || q.y > canvas.height + 20) return;
            const c = helmIsExtrapolated(sol, p.X, p.Y) ? '#ffcc00' : '#00ffff';
            ctx.strokeStyle = c; ctx.fillStyle = c;
            ctx.beginPath(); ctx.moveTo(q.x - 4, q.y - 4); ctx.lineTo(q.x + 4, q.y + 4); ctx.moveTo(q.x + 4, q.y - 4); ctx.lineTo(q.x - 4, q.y + 4); ctx.stroke();
            if(!many) ctx.fillText(p.name || p.num || '', q.x + 6, q.y - 4);
        });
    }
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    _helm.pairs.forEach((pr, k) => {
        const w = surveyToWcs(pr.dst.X, pr.dst.Y), q = wcsToScreen(w.x, w.y), c = !pr.use ? '#888888' : pr.res && pr.res.flag ? '#ffcc00' : '#00ff88';
        ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = c; ctx.fillText(String(k + 1), q.x - 16, q.y - 12); // 番号は左上（点名は右に出る）
    });
    if(sol && _helm.sel >= 0 && s.points[_helm.sel]) {
        const p = s.points[_helm.sel], t = helmApply(sol, p.X, p.Y), w = surveyToWcs(t.X, t.Y), q = wcsToScreen(w.x, w.y);
        ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(q.x, q.y, 14, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
}
