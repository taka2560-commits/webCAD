// ===== Web CAD 図形の張り合わせ（図面の中の図形を、ヘルマート変換で合わせる） =====
// cad-align.js - コマンド HALIGN（別名 ALIGN・AL）。v5.59（別窓の点は、図形へのスナップでも指定できる。v5.59.1）
//   図面の中の図形（別の図面から取り込んだ区画・任意座標で描いた現況など）を、同じ図面の中の点（遠くの公共点でも）に合わせて、
//   回転・移動（・縮尺）で動かす。
//   ・対象の選び方は、鏡像・尺度変更と同じ（選んでから始める／タップ／範囲選択。cad-edit.js の _editBegin・editAreaSelect）
//   ・張り合わせ点の指定は、SIMA の変換（cad-helmert.js）と同じ別窓の方式:
//       動かす図形を別窓（cad-subview.js）に出す → 別窓で「動かす側の点」をタップ → 図面で「合わせる先の点」をなぞって ☑確定。
//       別窓のタップは、動かす図形に吸い付く（図面のスナップと同じ計算。端点・中心・挿入点はいつも。中点・交点・四半円点・図心・等分点・近接点は OSNAP の設定のとおり）
//       図面は自由に動かせるので、動かす図形から遠く離れた点（公共点など）にも合わせられる
//   ・縮尺: 「1/1」（回転・移動だけ）／「縮尺も求める」（ヘルマート変換）。縮尺を求めたときは、文字・寸法の大きさも同じ倍率で変わる（尺度変更と同じ）
//   ・計算は SIMA の張り合わせ（helmSolve）と同じもの。測量座標（X＝北・Y＝東、m）で、重心を引いてから求める
//   ・図形に当てる写し方は、「図面を SIMA に合わせる」（cad-helmert-rev.js の helmReverseXform）と同じ式。動かしたあとの動き（全体表示・「↩ 元に戻す」の知らせ）も同じ
//   ・↩ 1回で戻せる。元の図形を残す（複写して置く）こともできる
// SIMA ファイルが相手のとき（取り込み・書き出し）は、測量計算の「変換」タブ（cad-helmert.js）
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

const ALIGN_TITLE = '⧉ 張り合わせ';
const ALIGN_CMDS = ['HALIGN', 'ALIGN', 'AL'];
const ALIGN_HINT = '動かす側の点をタップ → 図面で合わせる先の点をなぞって ☑確定';
const ALIGN_MIRROR_RATIO = 0.2; // 裏返しにした組のほうが、ばらつきがこの割合より小さければ「鏡像かもしれません」と知らせる
const ALIGN_TAP_PX = 22;        // 別窓のタップで点を拾う近さ（SIMA の変換と同じ）
const ALIGN_SNAP_ALWAYS = ['end', 'cen', 'ins'];                       // 別窓でいつも吸い付く種類（OSNAP を切っていても。v5.59 からの点）
const ALIGN_SNAP_PREF = ['mid', 'int', 'qua', 'gce', 'div', 'near'];   // OSNAP の設定（種類ごとの入・切）のとおりに吸い付く種類
const ALIGN_VIEW_MAX = 5000;    // 別窓に形を描く図形の上限（多いときは、初めのこの数だけ）
const _align = {
    on: false,      // 張り合わせの途中（図形を選び終えてから、動かす・やめるまで）
    ids: [],        // 動かす図形（図形の ID。↩ などで配列が変わっても同じ図形を指す）
    pairs: [],      // 張り合わせ点の組 [{ src: { x, y }, dst: { x, y, name }, use }]（図面の座標）
    sel: null,      // 別窓で選んだ「動かす側の点」（図面で合わせる先の点を指定する前）{ x, y, t: 吸い付いた種類 }
    hover: null,    // 別窓でマウスの下にある、吸い付く点の下見 { x, y, t }（PC だけ）
    hoverEp: -1,    // 下見を作ったときの図形データの世代（図形が変わったら、下見を捨てる）
    calc: null,     // 計算の結果（alignCompute。組・縮尺が変わったら作り直す）
    keys: null,     // 別窓で拾える点（図形の要の点）と、それを作ったときの図形データの世代
    folded: false,  // 図面で点を指定するあいだ、別窓をたたんだか
    viewClosed: false, // 別窓を ✕ で閉じた（「🗺 別窓を開く」まで出さない）
};
function alignIsMode(m) { return typeof m === 'string' && m.startsWith('WAITING_HALIGN_'); }
function _alignMode() { return lastParams.alignMode === 'sim' ? 'sim' : 'rigid'; }
function _alignKeep() { return lastParams.alignKeep === true; }
// 動かす図形の、今の配列の番号（消えた図形・写真のピンは除く）
function _alignTargets() {
    return _align.ids.map((id) => entityIndexById(id)).filter((i) => i >= 0 && entities[i] && entities[i].type !== 'PIN');
}

// ===== 計算 =====
/**
 * 張り合わせ点の組（図面の座標 { src: {x,y}, dst: {x,y}, use }）から、変換と組ごとの較差を求める。
 * 戻り値: { sol（helmSolve の結果。測量座標 m）, T（図形に当てる写し方。sol.ok のときだけ）, rows: [{ d, dX, dY, flag } | null], nUse, mirror }
 *   rows[k].d: 動かした点と、合わせる先の点の離れ（m）。flag: ほかの組と合っていない（その組を除いて求めた変換とのずれが、ばらつきから見て大きすぎる。helmFlagK）
 *   mirror: 3組以上で、動かす側を裏返すとよく合う（鏡像の図形かもしれない）
 *   scaleHint: 「1/1」なのに長さが合っていない（縮尺も求めるとよく合う）ときの、その縮尺。無ければ null
 *   canFlag: 取り違えた組を見分けられるだけの組があるか（1組を除いても自由度が2以上）
 */
function alignCompute(pairs, mode) {
    const S = (p) => wcsToSurvey(p.x, p.y);
    const all = (pairs || []).map((p) => ({ src: S(p.src), dst: S(p.dst), use: p.use !== false }));
    const up = all.filter((p) => p.use);
    const out = { sol: null, T: null, rows: all.map(() => null), nUse: up.length, mirror: false, scaleHint: null, canFlag: false };
    if(up.length < 2) { out.sol = { ok: false, error: `あと ${2 - up.length}組 指定すると計算します` }; return out; }
    const sol = out.sol = helmSolve(up, mode);
    if(!sol.ok) { // 知らせの言葉は、張り合わせの呼び方に（helmSolve は SIMA の変換の言葉）
        if(sol.error) sol.error = sol.error.replace('変換元の張り合わせ点', '動かす側の点').replace('図面の張り合わせ点', '合わせる先の点');
        return out;
    }
    out.T = helmReverseXform(sol); // 測量の座標の変換 → 図面の座標の写し方（式から直接。cad-helmert-rev.js）
    if(sol.mode === 'rigid') out.T.k = 1; // 1/1 は倍率ちょうど 1（cos²+sin² の丸めで 0.9999999999999999 になり、円の半径 4 が 3.9999999999999996 になるのを防ぐ）
    out.canFlag = sol.dof - 2 >= 2;
    let k = 0;
    all.forEach((p, i) => {
        const q = helmApply(sol, p.src.X, p.src.Y), dX = q.X - p.dst.X, dY = q.Y - p.dst.Y, d = Math.hypot(dX, dY);
        const r = out.rows[i] = { dX, dY, d, flag: false };
        if(p.use) { const lo = helmLeaveOneOut(up, mode, k++); if(lo) r.flag = lo.flag; }
        else if(sol.sigma0 !== null) { // 計算に使っていない組は、今の変換と比べる
            const sig = Math.max(sol.sigma0, HELM_SIGMA_FLOOR) * Math.sqrt(1 + 1 / sol.n + ((p.src.X - sol.X0) ** 2 + (p.src.Y - sol.Y0) ** 2) / sol.S);
            r.flag = d > helmFlagK(sol.dof) * sig;
        }
    });
    const big = sol.sigma0 !== null && sol.sigma0 > 5 * HELM_SIGMA_FLOOR; // 合い方が悪い（5mm より大きい）ときだけ、わけを探す
    // 長さの食い違い: 「1/1」なのに、縮尺も求めるとずっとよく合う（単位・縮尺の違う図形）。長さが 0.1% より違うときだけ（それより小さい違いは、ばらつき・投影の縮尺係数のうち）
    if(sol.mode === 'rigid' && big) {
        const s2 = helmSolve(up, 'sim');
        // 3組以上: 縮尺の 1 からの違いが、縮尺のばらつき（sScale）から見て確かなときだけ（境は helmFlagK。ばらつきだけでは、まず出ない）
        const ds = s2.ok ? Math.abs(s2.scale - 1) : 0;
        if(s2.ok && ds > 1e-3 && (s2.sigma0 === null || (ds > helmFlagK(s2.dof) * s2.sScale && s2.sigma0 < sol.sigma0 * ALIGN_MIRROR_RATIO))) out.scaleHint = s2.scale;
    }
    // 鏡像の見分け: ヘルマート変換は裏返せないので、裏返った図形は合わない。動かす側を裏返して求め直し、ずっとよく合うなら知らせる
    // 「ずっとよく合う」だけでなく、裏返した側がほんとうに合っていること（図形の大きさの 0.5% より小さいばらつき）も見る。
    // 合わせる先の2点を取り違えただけのときにも、裏返したほうが少しましになって、まちがって「鏡像」と知らせていた
    if(up.length >= 3 && big) {
        const m = helmSolve(up.map((p) => ({ src: { X: p.src.X, Y: -p.src.Y }, dst: p.dst })), mode);
        if(m.ok && m.sigma0 !== null && m.sigma0 < sol.sigma0 * ALIGN_MIRROR_RATIO && m.sigma0 < Math.max(5 * HELM_SIGMA_FLOOR, 0.005 * sol.rMax)) out.mirror = true;
    }
    return out;
}
function _alignCalc() {
    if(!_align.calc) _align.calc = alignCompute(_align.pairs, _alignMode());
    return _align.calc;
}

// ===== 始める・やめる =====
// コマンド HALIGN・ALIGN・AL（cad-edit.js の processEditCommand から）。選んだ図形があればそれを動かす図形にし、無ければ選ぶ段階へ
function alignCommand(cmd) {
    if(!ALIGN_CMDS.includes(cmd)) return false;
    if(typeof _adoptIdleHighlight === 'function') _adoptIdleHighlight();
    const sel = _editTargets();
    if(sel.length) { alignStart(sel); return true; }
    // 何も選んでいない: 途中の張り合わせがあれば、その続き（パネルを閉じた・別のコマンドを使ったあと）
    if(_align.on && _alignTargets().length) { resetCommand(); _alignShow(); addCommandLog('-> [張り合わせ] 途中の張り合わせに戻りました'); return true; }
    _editBegin('HALIGN', '張り合わせ', 'WAITING_HALIGN_SELECT', null, '');
    return true;
}
// 図形を選ぶ段階のタップ（cad-edit.js の handleEditPointInput から）。グループ選択ONならブロック全体
function alignPointInput(m) {
    if(m !== 'WAITING_HALIGN_SELECT') return false;
    const idx = hitTestEntity(mouse.screenX, mouse.screenY);
    if(idx < 0 || entities[idx].type === 'PIN') { addCommandLog('図形が見つかりません'); return true; }
    alignStart(expandGroupTargets(idx));
    return true;
}
// 動かす図形が決まった: 別窓に出して、張り合わせ点の指定へ
function alignStart(idxs) {
    ensureEntityIds();
    const ids = (idxs || []).filter((i) => entities[i] && entities[i].type !== 'PIN').map((i) => entities[i].id);
    if(!ids.length) { _editToast('張り合わせ: 動かす図形がありません'); return false; }
    if(cogoIsPicking()) _cogo.pick = null;
    Object.assign(_align, { on: true, ids, pairs: [], sel: null, hover: null, calc: null, keys: null, folded: false, viewClosed: false });
    delete _cogo.slots.AT;
    resetCommand(); // 選ぶ段階を終える（選択の印も消す。動かす図形は、図面にオレンジで出す）
    addCommandLog(`-> [張り合わせ] 動かす図形 ${ids.length}個。別窓で動かす側の点をタップ → 図面で合わせる先の点を ☑確定（2組以上）`);
    _alignShow();
    if(typeof showToast === 'function') showToast('別窓で動かす側の点をタップ → 図面で合わせる先の点を ☑確定 で、張り合わせ点を2組以上指定します', 4500);
    return true;
}
// パネルと別窓を出す
function _alignShow() {
    alignPanel();
    if(_align.viewClosed) return;
    const v = _alignView();
    v.setTitle(`⧉ 動かす図形（${_alignTargets().length}個）`);
    v.open(); v.setCollapsed(false); _alignFitView();
}
// やめる・終わる（図面を開き直した・閉じたときも。cad-core.js の setDrawingName から）
function alignReset() {
    const was = _align.on;
    if(cogoIsPicking() && _cogo.pick && _cogo.pick.owner === 'align') { _cogo.pick = null; resetCommand(); }
    Object.assign(_align, { on: false, ids: [], pairs: [], sel: null, hover: null, calc: null, keys: null, folded: false, viewClosed: false });
    if(typeof _cogo !== 'undefined') delete _cogo.slots.AT;
    if(_alignViewInst && _alignViewInst.isOpen()) _alignViewInst.hide();
    if(was && _alignPanelShown()) closePropertyPanel();
    if(was && typeof renderOverlay === 'function') renderOverlay();
}
window.alignCancel = function() { alignReset(); addCommandLog('-> [張り合わせ] やめました'); };

// ===== 別窓（動かす図形） =====
let _alignViewInst = null;
function _alignView() {
    if(!_alignViewInst) {
        _alignViewInst = createSubView({
            id: 'align-view', title: '⧉ 動かす図形', posKey: 'cad_align_view_pos', sizeKey: 'cad_align_view_size', hint: ALIGN_HINT,
            onTap: (X, Y, sx, sy) => _alignTapSource(sx, sy),
            onHover: (sx, sy) => _alignHover(sx, sy),
            onDraw: (g, api) => _alignDrawView(g, api),
            onFit: () => _alignFitView(),
            onClose: () => { _align.viewClosed = true; },
        });
    }
    return _alignViewInst;
}
window.alignOpenView = function() {
    if(!_align.on) return;
    _align.viewClosed = false;
    const v = _alignView();
    v.open(); v.setCollapsed(false); _alignFitView();
};
function _alignFitView() {
    _align.hover = null; _alignHoverNext = null; // 見え方が変わるので、下見は消す（マウスを動かすと出し直す）
    const b = editBoundsOf(_alignTargets().map((i) => entities[i]));
    if(!b) return;
    const a = wcsToSurvey(b.minX, b.minY), c = wcsToSurvey(b.maxX, b.maxY);
    _alignView().fit({ minX: Math.min(a.X, c.X), maxX: Math.max(a.X, c.X), minY: Math.min(a.Y, c.Y), maxY: Math.max(a.Y, c.Y) });
}
// 張り合わせの画面を出しているか（パネルを開いている・図面で合わせる先の点を指定している）
function _alignPanelShown() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    return !!p && p.style.display === 'flex' && !!t && t.textContent === ALIGN_TITLE;
}
function _alignOverlayOn() {
    if(!_align.on) return false;
    if(cogoIsPicking()) return !!(_cogo.pick && _cogo.pick.owner === 'align');
    return _alignPanelShown();
}
// 別窓は、張り合わせのパネルを開いているあいだ（図面で点を指定しているあいだも）だけ出す（SIMA の変換と同じ）
let _alignSyncPending = false;
function _alignSyncView() {
    if(_alignSyncPending) return;
    _alignSyncPending = true;
    requestAnimationFrame(() => {
        _alignSyncPending = false;
        if(!_alignViewInst) return;
        const want = !_align.viewClosed && _alignOverlayOn();
        if(want && !_alignViewInst.isOpen()) _alignViewInst.open();
        else if(!want && _alignViewInst.isOpen()) _alignViewInst.hide();
        else _alignViewInst.fitPanel(); // パネルを開き直した・動かしたとき（スマホでは別窓の上までの高さに）
    });
}
(function _alignWatchPanel() {
    const p = document.getElementById('property-panel'), t = document.getElementById('property-panel-title');
    if(!p || typeof window.MutationObserver !== 'function') return;
    const mo = new window.MutationObserver(_alignSyncView);
    mo.observe(p, { attributes: true, attributeFilter: ['style'] });
    if(t) mo.observe(t, { childList: true, characterData: true, subtree: true });
})();

// 図形の要の点（端点・頂点・中心・点・文字の位置。塗りつぶしは範囲の頂点）
function _alignKeyPoints(e) {
    if(!e) return [];
    const t = e.type;
    if(t === 'LINE') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
    if(t === 'RECTANG') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }];
    if(t === 'PLINE') return e.points || [];
    if(t === 'CIRCLE' || t === 'ELLIPSE') return [{ x: e.cx, y: e.cy }];
    if(t === 'ARC') return [{ x: e.cx, y: e.cy }, { x: e.cx + e.radius * Math.cos(e.startAngle), y: e.cy + e.radius * Math.sin(e.startAngle) }, { x: e.cx + e.radius * Math.cos(e.endAngle), y: e.cy + e.radius * Math.sin(e.endAngle) }];
    // 測点の点名の文字は、測点からずらして置いているので拾わない（測点の近くをタップしたとき、測点ではなく文字の位置を拾ってしまう。図面のスナップと同じ）
    if(t === 'POINT' || t === 'TEXT') return (t === 'TEXT' && e.ptLabel) ? [] : [{ x: e.x, y: e.y }];
    if(t === 'HATCH') return _alignKeyPoints(e.target);
    return [];
}
// 要の点の種類（図面のスナップの呼び方）: 円・楕円・円弧の1つ目は中心、文字は挿入点、ほかは端点
function _alignKeyType(e, k) {
    const t = e.type === 'HATCH' && e.target ? e.target.type : e.type;
    if(t === 'CIRCLE' || t === 'ELLIPSE' || (t === 'ARC' && k === 0)) return '中心';
    return t === 'TEXT' ? '挿入点' : '端点';
}
// 別窓で拾える点（動かす図形の要の点。重なった点は1つに）と、動かす図形の集まり。図形が変わったら作り直す
function _alignKeyCache() {
    const ep = typeof _geomEpoch !== 'undefined' ? _geomEpoch : 0;
    if(_align.keys && _align.keys.ep === ep && _align.keys.n === entities.length) return _align.keys;
    const seen = new Set(), pts = [], set = new Set();
    _alignTargets().forEach((i) => {
        const e = entities[i];
        set.add(e);
        _alignKeyPoints(e).forEach((q, n) => {
            if(!isFinite(q.x) || !isFinite(q.y)) return;
            const k = q.x + ',' + q.y;
            if(seen.has(k)) return;
            seen.add(k); pts.push({ x: q.x, y: q.y, t: _alignKeyType(e, n) });
        });
    });
    return (_align.keys = { ep, n: entities.length, pts, set });
}
function _alignKeys() { return _alignKeyCache().pts; }
// 別窓で吸い付く種類: 端点・中心・挿入点はいつも。ほかは、図面の OSNAP の設定（種類ごとの入・切）と同じ。
// 垂線・接線（基点が要る）と延長（線の取得が要る）は、別窓では使わない
function _alignSnapFlags() {
    const F = { main: true, divN: osnapState.divN };
    ALIGN_SNAP_ALWAYS.forEach((k) => { F[k] = true; });
    ALIGN_SNAP_PREF.forEach((k) => { F[k] = !!osnapState[k]; });
    return F;
}
/**
 * 図面の座標 w の近く（画面で R 画素より近く）で、動かす図形に吸い付く点を探す。k: 1単位あたりの画素数（別窓の倍率）。
 * 戻り値: { x, y（図面の座標）, t（種類: 端点・中点・中心・交点・挿入点・四半円点・図心・等分点・近接点） } | null
 *   点の求め方は、図面のスナップ（cad-snap.js の collectSnapPoints）と同じ。相手は動かす図形だけ（動かさない図形・それとの交点には吸い付かない）。
 *   選び方も図面と同じ2段: 幾何の点（端点・中点・交点 …）が近くにあれば、その中でいちばん近い点。無いときだけ、線の上の点（近接点）
 */
function alignSnapPoint(w, k, R) {
    if(!_align.on || !w || !isFinite(w.x) || !isFinite(w.y) || !(k > 0) || !isFinite(k)) return null;
    R = R > 0 ? R : ALIGN_TAP_PX;
    const cache = _alignKeyCache(), keep = _snapHoverTmp;
    let pts;
    _snapHoverTmp = { d: Infinity, src: null }; // 捨ての入れ物に替えてから呼ぶ（図面の「延長」の取得待ちの中身を、別窓の動きで書き換えない）
    try { pts = collectSnapPoints(w.x, w.y, null, _alignSnapFlags(), R, { scale: k, only: (e) => cache.set.has(e) }); }
    finally { _snapHoverTmp = keep; }
    let best = null;
    const see = (p) => {
        const d = Math.hypot(p.x - w.x, p.y - w.y) * k;
        if(!(d < R)) return;
        const tier = _snapTier(p.t);
        if(!best || tier < best.tier || (tier === best.tier && d < best.d)) best = { x: p.x, y: p.y, t: p.t, tier, d };
    };
    pts.forEach(see);
    cache.pts.forEach(see); // 要の点（文字の位置・塗りつぶしの頂点・見えていない図形の点など、スナップが出さない点も。v5.59 から拾えた点）
    return best && { x: best.x, y: best.y, t: best.t };
}
// 別窓の位置 (sx, sy)（画素）で、吸い付く点を探す
function alignSnapAt(sx, sy) {
    if(!_align.on || !isFinite(sx) || !isFinite(sy)) return null;
    const v = _alignView(), s = v.toSurvey(sx, sy);
    return alignSnapPoint(surveyToWcs(s.X, s.Y), v.scale() / surveyUnitFactor(), ALIGN_TAP_PX);
}
// マウスの下の、吸い付く点の下見（PC。別窓に記号と種類を出す）。
// 探すのは1コマに1回まで（図形が数万個あると1回に数十 ms かかるので、マウスの動きのたびには探さない。コマの中で最後の位置だけを探す）
let _alignHoverBusy = false, _alignHoverNext = null;
function _alignSetHover(h) {
    const a = _align.hover;
    _align.hoverEp = typeof _geomEpoch !== 'undefined' ? _geomEpoch : 0;
    if((!h && !a) || (h && a && h.x === a.x && h.y === a.y && h.t === a.t)) return;
    _align.hover = h;
    if(_alignViewInst) _alignViewInst.redraw();
}
function _alignHover(sx, sy) {
    if(sx === null || sx === undefined) { _alignHoverNext = null; _alignSetHover(null); return; }
    if(_alignHoverBusy) { _alignHoverNext = [sx, sy]; return; }
    _alignSetHover(alignSnapAt(sx, sy));
    _alignHoverBusy = true;
    requestAnimationFrame(() => {
        _alignHoverBusy = false;
        const n = _alignHoverNext;
        _alignHoverNext = null;
        if(n) _alignHover(n[0], n[1]);
    });
}
// 別窓でタップした位置で、動かす図形に吸い付く点を選ぶ（端点・中点・交点・中心・線の上 …）
function _alignTapSource(sx, sy) {
    if(!_align.on) return;
    const v = _alignView();
    const best = alignSnapAt(sx, sy);
    if(!best) {
        if(typeof showToast === 'function') showToast('図形の近くをタップしてください（端点・中点・交点・線の上などに吸い付きます。拡大すると選びやすくなります）', 2800);
        if(typeof motionShake === 'function') motionShake(v.el.querySelector('.subview-hint')); // UIの動き（試用）: 別窓の案内を揺らす
        return;
    }
    alignSelectSource(best);
}
// 動かす側の点を選び（別窓のタップ）、図面で合わせる先の点を指定する（☑確定）
function alignSelectSource(pt) {
    if(!_align.on || !pt || !isFinite(pt.x) || !isFinite(pt.y)) return false;
    const kind = typeof pt.t === 'string' ? pt.t : '';
    _align.sel = { x: pt.x, y: pt.y, t: kind };
    _align.hover = null;
    _align.viewClosed = false;
    const v = _alignView();
    v.open();
    addCommandLog(`-> [張り合わせ] 動かす側の点${kind ? `（${kind}）` : ''} ${coordLogText(pt)} を選びました。図面で合わせる先の点をなぞって ☑確定`);
    // どこに吸い付いたかを知らせる（スマホでは、このあと別窓をたたむので、別窓の記号が見えなくなる）
    if(kind && typeof showToast === 'function') showToast(`動かす側の点: ${kind}。図面で合わせる先の点をなぞって ☑確定`, 2600);
    // スマホ・画面いっぱいの別窓では、図面が見えるように別窓をたたむ（自分でたたんでいたら、そのまま）。指定が終わると広げ直す
    if((window.innerWidth < 700 || v.maximized) && !v.collapsed) { v.setCollapsed(true); _align.folded = true; }
    v.redraw();
    cogoPick('AT', 'align');
    return true;
}
// 点の指定のあと（パネルを描き直す前）: 合わせる先の点が決まっていれば組にする
function _alignAfterPick() {
    const picking = cogoIsPicking();
    if(!picking && _align.folded) { _align.folded = false; if(_alignViewInst) _alignViewInst.setCollapsed(false); }
    const s = _cogo.slots.AT;
    if(!s) {
        if(!picking && _align.sel) { _align.sel = null; if(_alignViewInst) _alignViewInst.redraw(); } // ❌終了で指定をやめた
        return;
    }
    delete _cogo.slots.AT;
    const src = _align.sel;
    _align.sel = null;
    if(!_align.on || !src) return;
    const pr = { src: { x: src.x, y: src.y }, dst: { x: s.x, y: s.y, name: s.name || '' }, use: true };
    const tol = 1e-9 * (Math.abs(src.x) + Math.abs(src.y) + 1);
    let k = _align.pairs.findIndex((p) => Math.abs(p.src.x - src.x) <= tol && Math.abs(p.src.y - src.y) <= tol); // 同じ点を指定し直したときは、同じ番号のまま入れ替える
    if(k >= 0) _align.pairs[k] = pr; else { _align.pairs.push(pr); k = _align.pairs.length - 1; }
    _align.calc = null;
    addCommandLog(`-> [張り合わせ] 組 No.${k + 1}: 合わせる先「${s.name || '(点名なし)'}」${coordLogText(s)}`);
    if(typeof pingAt === 'function') pingAt(s.x, s.y, 'align:' + k, '#00ff88'); // 合わせる先の点をポンと知らせる（cad-ping.js）
    // 合わせる先が、動かす図形の点だった（一緒に動くので、思った所に合わない）
    if(_alignOnTargetsOnly(pr.dst)) _editToast('合わせる先の点が、動かす図形の上にあります（その点も一緒に動きます）。合わせる先は、動かさない図形の点にしてください');
    if(_alignViewInst) _alignViewInst.redraw();
}
if(typeof COGO_SLOT_LABELS !== 'undefined') {
    COGO_SLOT_LABELS.AT = ['合わせる先の点', '先'];
    cogoRegisterPickOwner('align', { slots: () => ['AT'], render: () => { _alignAfterPick(); if(_align.on) alignPanel(); }, update: () => {} });
}
// 点 p が、動かす図形の要の点に重なっていて、動かさない図形の要の点には重なっていない
function _alignOnTargetsOnly(p) {
    const sel = new Set(_alignTargets());
    if(!sel.size) return false;
    const tol = 1e-6 * (Math.abs(p.x) + Math.abs(p.y) + 1);
    const hit = (e) => _alignKeyPoints(e).some((q) => Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol);
    let onSel = false;
    for(let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if(!e || e.hidden || !hit(e)) continue;
        if(sel.has(i)) onSel = true; else return false;
    }
    return onSel;
}
function _alignChanged() {
    _align.calc = null;
    alignPanel();
    if(typeof renderOverlay === 'function') renderOverlay();
    if(_alignViewInst) _alignViewInst.redraw();
}
window.alignUsePair = function(k, on) { const p = _align.pairs[k]; if(!p) return; p.use = !!on; _alignChanged(); };
window.alignDeletePair = function(k) { if(!_align.pairs[k]) return; _align.pairs.splice(k, 1); _alignChanged(); };
window.alignSetMode = function(m) { lastParams.alignMode = m === 'sim' ? 'sim' : 'rigid'; saveLastParams(); _alignChanged(); };
window.alignSetKeep = function(on) { lastParams.alignKeep = !!on; saveLastParams(); _alignChanged(); };
// 🔗 点名が同じ点を組にする: 動かす図形の中の測点 ↔ 動かさない測点（どちらも、その点名が1つだけのとき）
window.alignPairByName = function() {
    if(!_align.on) return 0;
    const sel = new Set(_alignTargets()), src = new Map(), dst = new Map(), dupS = new Set(), dupD = new Set();
    const selGids = new Set(); // ブロックの測点は、部品が1つでも選ばれていれば動かす側（最初の部品だけで決めない）
    sel.forEach((i) => { if(entities[i].gid) selGids.add(entities[i].gid); });
    const shown = (e) => !!e && !e.hidden && !(layers[e.layer] && layers[e.layer].visible === false);
    collectSurveyPoints().forEach((p) => {
        const name = String(p.name || '').trim();
        if(!name || !shown(entities[p.idx])) return; // 見えていない測点（非表示・画層が非表示）は、組にしない
        const [m, dup] = (sel.has(p.idx) || (p.gid && selGids.has(p.gid))) ? [src, dupS] : [dst, dupD];
        if(m.has(name)) dup.add(name); else m.set(name, p);
    });
    const tolOf = (p) => 1e-9 * (Math.abs(p.x) + Math.abs(p.y) + 1);
    let added = 0, skipped = 0;
    src.forEach((s, name) => {
        const d = dst.get(name);
        if(!d) return;
        if(dupS.has(name) || dupD.has(name)) { skipped++; return; } // 同じ点名が2つ以上: どれと組にするか決められない
        if(_align.pairs.some((q) => Math.hypot(q.src.x - s.x, q.src.y - s.y) <= tolOf(s))) return; // もう組にしている
        _align.pairs.push({ src: { x: s.x, y: s.y }, dst: { x: d.x, y: d.y, name }, use: true });
        added++;
    });
    const more = skipped ? `（同じ点名が2つ以上ある ${skipped}点は、組にしていません）` : '';
    if(added) _editToast(`点名が同じ点を ${added}組、張り合わせ点にしました${more}`);
    else _editToast(`点名が同じ測点が、動かす図形と動かさない図形の両方にありません${more}`);
    _alignChanged();
    return added;
};

// ===== 動かす =====
function alignDescText(sol) {
    const q = helmApply(sol, sol.X0, sol.Y0), mv = Math.hypot(q.X - sol.X0, q.Y - sol.Y0); // 重心が動く量
    return `回転 ${angleText(sol.rot * 180 / Math.PI)}（右回りが正）・移動 ${formatSurveyNumber(mv)}m` + (sol.mode === 'sim' ? `・縮尺 ${sol.scale.toFixed(6)}` : '・縮尺 1（そのまま）');
}
// 「▶ 動かす」: 確かめの画面を出してから動かす（「図面を SIMA に合わせる」と同じ流れ）
window.alignApply = function() {
    if(!_align.on) return false;
    const idxs = _alignTargets();
    if(!idxs.length) { _editToast('張り合わせ: 動かす図形がありません（消えた・図面を開き直した）'); return false; }
    const c = _alignCalc(), sol = c.sol;
    if(!sol || !sol.ok || !c.T) { _editToast((sol && sol.error) || '張り合わせ点を2組以上指定してください'); return false; }
    const vals = [c.T.a, c.T.b, c.T.c, c.T.d, c.T.tx, c.T.ty, c.T.ox, c.T.oy];
    if(!vals.every((v) => typeof v === 'number' && isFinite(v)) || !(c.T.k > 0)) { _editToast('張り合わせ: 変換を求められません（点を選び直してください）'); return false; }
    const keep = _alignKeep();
    const sig = sol.sigma0 === null ? '' : `\n張り合わせ点の残差の標準偏差: ${formatSurveyNumber(sol.sigma0)}m`;
    cadChoose({ title: ALIGN_TITLE,
        message: `張り合わせ点 ${sol.n}組から、図形 ${idxs.length}個を${keep ? '複写して、合わせる先に置きます' : '合わせる先へ動かします'}。\n${alignDescText(sol)}${sig}\n（↩ で戻せます）`,
        choices: [{ label: keep ? `複写して置く（${idxs.length}）` : `動かす（${idxs.length}）`, value: 'go', kind: 'primary' }] }, (v) => {
        if(v === 'go') alignApplyNow();
    });
    return true;
};
// 図形を動かす（↩ 1回分）。動かしたあとは全体を表示して、「↩ 元に戻す」の知らせを出す
function alignApplyNow() {
    if(!_align.on) return 0;
    const idxs = _alignTargets(), c = _alignCalc(), sol = c.sol;
    if(!idxs.length || !sol || !sol.ok || !c.T) return 0;
    const keep = _alignKeep(), T = c.T, n = idxs.length;
    saveUndo();
    if(keep) { const gm = {}; idxs.map((i) => editTransformEntity(editCloneEntity(entities[i], gm), T)).forEach((e) => entities.push(e)); }
    else idxs.forEach((i) => { const e = entities[i]; editTransformEntity(e, T); delete e.bbox; });
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    addCommandLog(`-> [張り合わせ] 図形 ${n}個を${keep ? '複写して置きました' : '動かしました'}（${alignDescText(sol)}。張り合わせ点 ${sol.n}組` +
        (sol.sigma0 === null ? '' : `・標準偏差 ${cogoFix(sol.sigma0 * 1000, 1)} mm`) + '）');
    _editVibrate();
    alignReset(); // 終わり（パネル・別窓を閉じる）
    if(typeof showUndoSnack === 'function') showUndoSnack(`図形 ${n}個を張り合わせました`);
    if(typeof zoomExtents === 'function') zoomExtents(true); // 知らせを出さない（「↩ 元に戻す」の知らせを残す）
    render();
    return n;
}

// ===== パネル =====
function _alignPtLabel(p, named) {
    const tol = 1e-6 * (Math.abs(p.x) + Math.abs(p.y) + 1);
    const hit = p.name ? p : named.find((q) => Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol);
    if(hit && (hit.name || hit.num)) return escapeHtml(hit.name || hit.num);
    const s = wcsToSurvey(p.x, p.y);
    return `${formatSurveyNumber(s.X)}<br>${formatSurveyNumber(s.Y)}`;
}
function alignResultHtml(c) {
    const sol = c.sol, pairs = _align.pairs;
    if(!sol) return '';
    if(!sol.ok) return c.nUse < 2 ? (pairs.length ? _editNote(escapeHtml(sol.error)) : '') : `<div class="cogo-warn">⚠ ${escapeHtml(sol.error || '計算できません')}</div>`;
    const acc = sol.sigma0 !== null;
    let worst = -1;
    pairs.forEach((p, k) => { if(p.use !== false && c.rows[k] && (worst < 0 || c.rows[k].d > c.rows[worst].d)) worst = k; });
    const kv = [
        ['回転', helmRotText(sol.rot) + (acc ? `（±${cogoFix(sol.sRot * 180 / Math.PI * 3600, 1)}″）` : '')],
        ['縮尺', sol.mode === 'rigid' ? '1（そのまま）' : `${sol.scale.toFixed(8)}<br>（${_helmPpm(sol.scale)} ppm${acc ? ` ±${cogoFix(sol.sScale * 1e6, 1)}` : ''}）`],
        ['重心の移動', `ΔX ${_cogoSigned(sol.X1 - sol.X0)}<br>ΔY ${_cogoSigned(sol.Y1 - sol.Y0)}`],
        ['標準偏差 σ₀', acc ? `${cogoFix(sol.sigma0 * 1000, 1)} mm（${sol.n}組・自由度 ${sol.dof}）` : `確かめられません（${sol.n}組）`, 'cogo-big'],
    ];
    if(worst >= 0 && acc) kv.push(['最大の較差', `${cogoFix(c.rows[worst].d * 1000, 1)} mm（No.${worst + 1}）`]);
    let h = _cogoKv(kv);
    if(!acc) h += '<div class="cogo-warn">⚠ ' + (sol.mode === 'sim' ? '縮尺も求めるときは、3組以上で精度を確かめられます（2組では、ちょうど合わせるだけです）' : '組を増やすと、精度を確かめられます（点の取り違えに気づけます）') + '</div>';
    if(c.mirror) h += '<div class="cogo-warn">⚠ 裏返し（鏡像）の図形かもしれません。裏返すと、ずっとよく合います。先に ⇋ 鏡像 で映してから、張り合わせてください。</div>';
    const flagged = pairs.map((p, k) => (p.use !== false && c.rows[k] && c.rows[k].flag ? k + 1 : 0)).filter(Boolean);
    if(c.scaleHint) h += `<div class="cogo-warn">⚠ 長さが合っていません（縮尺を ${c.scaleHint.toFixed(6)} にすると合います）。単位・縮尺の違う図形なら、「縮尺も求める」にしてください。点の取り違えかもしれません。</div>`;
    if(flagged.length) h += `<div class="cogo-warn">⚠ No.${flagged.join('・No.')} は、ほかの組と合っていません。点の取り違えが無いか確かめてください。「使う」を外すと、その組を除いて計算します。</div>`;
    else if(acc && !c.canFlag) h += _editNote('組が少ないので、点を取り違えていても、どの組かは見分けられません（標準偏差が大きいときは、組を足すと見分けられます）。');
    if(sol.mode === 'sim' && Math.abs(sol.scale - 1) > 1e-9) h += _editNote('縮尺を変えるので、文字・寸法の大きさも同じ倍率で変わります（尺度変更と同じ）。');
    // 張り合わせ点で囲んだ範囲の外にも、動かす図形がある（3組以上のとき）。図形の要の点で見る
    if(sol.n >= 3 && _alignKeys().slice(0, 20000).some((q) => { const s = wcsToSurvey(q.x, q.y); return helmIsExtrapolated(sol, s.X, s.Y); })) {
        h += _editNote('張り合わせ点で囲んだ範囲の外にも、動かす図形があります（張り合わせ点から離れるほど、精度が下がります）。');
    }
    return h;
}
function alignPanel() {
    if(!_align.on) return;
    const pairs = _align.pairs, n = _alignTargets().length;
    const pc = document.getElementById('property-panel-content'), keepScroll = _alignPanelShown() && pc ? pc.scrollTop : 0;
    let h = '';
    if(!n) {
        h += '<div class="cogo-warn">⚠ 動かす図形がありません（消えた・図面を開き直した）。もう一度、図形を選んでから始めてください。</div>' +
            '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="alignCancel()">やめる</button></div>';
        showPropertyPanel(ALIGN_TITLE, h);
        return;
    }
    h += _editRow('縮尺', _editSeg(_alignMode(), [['rigid', '1/1（そのまま）'], ['sim', '縮尺も求める']], 'alignSetMode'));
    h += `<label class="edit-chk"><input type="checkbox" class="sw" role="switch" ${_alignKeep() ? 'checked' : ''} onchange="alignSetKeep(this.checked)"> 元の図形を残す（複写して置く）</label>`;
    const c = _alignCalc();
    h += `<div class="ts-sec">張り合わせ点${pairs.length ? `（計算に使う ${c.nUse} / ${pairs.length}組）` : ''}・動かす図形 ${n}個</div>`;
    h += '<div class="cogo-btns"><button class="prop-btn btn-sub" onclick="alignPairByName()" title="動かす図形の中の測点と、動かさない測点で、点名が同じものを組にする">🔗 点名が同じ点を組にする</button>' +
        (_align.viewClosed ? '<button class="prop-btn btn-sub" onclick="alignOpenView()">🗺 別窓を開く</button>' : '') + '</div>';
    if(!pairs.length) h += _editNote('別窓（動かす図形）で「動かす側の点」をタップ → 図面で「合わせる先の点」をなぞって ☑確定（PC はクリック）。別窓でも図面でも、端点・中点・交点・線の上などに吸い付きます（種類は OSNAP の設定と同じ）。図面は動かせるので、遠くの公共点にも合わせられます。2組以上で計算し、3組以上で精度を確かめられます。');
    else {
        const named = collectSurveyPoints().filter((p) => p.name || p.num);
        const rows = pairs.map((p, k) => {
            const r = c.rows[k];
            return `<tr${r && r.flag ? ' class="helm-flag"' : ''}><td class="c">${k + 1}</td><td>${_alignPtLabel(p.src, named)}</td><td>${_alignPtLabel(p.dst, named)}</td>` +
                `<td class="r">${r ? cogoFix(r.d * 1000, 1) : ''}</td><td class="c"><input type="checkbox" ${p.use !== false ? 'checked' : ''} onchange="alignUsePair(${k}, this.checked)" aria-label="No.${k + 1} を計算に使う"></td>` +
                `<td class="c"><button class="helm-x" onclick="alignDeletePair(${k})" title="この組を消す">✕</button></td></tr>`;
        }).join('');
        h += `<div class="cogo-table-wrap"><table class="cogo-table"><thead><tr><th>No</th><th>動かす側</th><th>合わせる先</th><th>較差 mm</th><th>使う</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    h += alignResultHtml(c);
    const ok = !!(c.sol && c.sol.ok);
    h += `<div class="cogo-btns"><button class="prop-btn" id="align-go" onclick="alignApply()" ${ok ? '' : 'disabled'}>${_alignKeep() ? '⧉ 複写して置く' : '▶ 動かす'}（${n}個）</button>` +
        '<button class="prop-btn btn-sub" onclick="alignCancel()">やめる</button></div>';
    if(ok) h += _editNote('動かした先の形は、図面に黄色の点線で出ています。↩ で戻せます。');
    showPropertyPanel(ALIGN_TITLE, h);
    const pc2 = document.getElementById('property-panel-content');
    if(pc2 && keepScroll) pc2.scrollTop = keepScroll;
    if(_alignViewInst && _alignViewInst.isOpen()) _alignViewInst.fitPanel(); // スマホ: パネルの高さを別窓の上までに
}

// ===== 別窓の中（動かす図形・拾える点・張り合わせ点・選んだ点） =====
function _alignDrawView(g, api) {
    if(!_align.on) return;
    const light = typeof isLightCanvasBg === 'function' && isLightCanvasBg();
    const fg = light ? '#333333' : '#e0e0e0', dim = light ? '#999999' : '#777777';
    const W = api.canvas.width, H = api.canvas.height, f = surveyUnitFactor(), k = api.scale() / f; // 図面の1単位あたりの画素数
    const S = (x, y) => { const s = wcsToSurvey(x, y); return api.toScreen(s.X, s.Y); };
    const poly = (pts, closed) => { if(!pts || pts.length < 2) return; g.beginPath(); pts.forEach((p, i) => { const q = S(p.x, p.y); if(i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); if(closed) g.closePath(); g.stroke(); };
    const shape = (e) => {
        if(!e) return;
        const t = e.type;
        if(t === 'LINE') poly([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }], false);
        else if(t === 'RECTANG') poly([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x1, y: e.y2 }], true);
        else if(t === 'PLINE') poly(e.points, !!e.closed);
        else if(t === 'CIRCLE') { const q = S(e.cx, e.cy); g.beginPath(); g.arc(q.x, q.y, Math.max(0.5, e.radius * k), 0, Math.PI * 2); g.stroke(); }
        else if(t === 'ARC' || t === 'ELLIPSE') {
            // 折れ線にして描く（画面の向きは図面と同じ: 右が東、上が北）
            const ccw = e.counterclockwise !== false, full = t === 'ELLIPSE';
            let a0 = full ? 0 : e.startAngle, sweep = full ? Math.PI * 2 : (ccw ? normalizeAngle(e.endAngle - e.startAngle) : -normalizeAngle(e.startAngle - e.endAngle));
            if(!full && Math.abs(sweep) < 1e-12) sweep = (ccw ? 1 : -1) * Math.PI * 2;
            const n = 48, rot = e.rotation || 0, pts = [];
            for(let i = 0; i <= n; i++) {
                const a = a0 + sweep * i / n;
                if(full) { const ex = e.rx * Math.cos(a), ey = e.ry * Math.sin(a); pts.push({ x: e.cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: e.cy + ex * Math.sin(rot) + ey * Math.cos(rot) }); }
                else pts.push({ x: e.cx + e.radius * Math.cos(a), y: e.cy + e.radius * Math.sin(a) });
            }
            poly(pts, full);
        }
        else if(t === 'POINT') { const q = S(e.x, e.y); g.beginPath(); g.moveTo(q.x - 3, q.y - 3); g.lineTo(q.x + 3, q.y + 3); g.moveTo(q.x + 3, q.y - 3); g.lineTo(q.x - 3, q.y + 3); g.stroke(); }
        else if(t === 'HATCH') shape(e.target);
    };
    const idxs = _alignTargets(), many = idxs.length > ALIGN_VIEW_MAX;
    g.strokeStyle = fg; g.lineWidth = 1;
    idxs.slice(0, ALIGN_VIEW_MAX).forEach((i) => shape(entities[i]));
    // 文字・点名（少ないときだけ。向き・大きさは合わせず、場所が分かるように小さく出す）
    g.font = '11px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = dim;
    if(idxs.length <= 400) idxs.forEach((i) => {
        const e = entities[i];
        const s = e.type === 'TEXT' ? String(e.text || '').split('\n')[0] : e.type === 'POINT' ? String(e.name || e.num || '') : '';
        if(!s) return;
        const q = S(e.x, e.y);
        if(q.x > -40 && q.y > -10 && q.x < W + 10 && q.y < H + 10) g.fillText(s.length > 14 ? s.slice(0, 13) + '…' : s, q.x + 5, q.y - 3);
    });
    // 拾える点（小さな四角。画面に出ている点が多いときは出さない）
    const keys = _alignKeys(), vis = [];
    for(let i = 0; i < keys.length && vis.length <= 600; i++) { const q = S(keys[i].x, keys[i].y); if(q.x > -5 && q.y > -5 && q.x < W + 5 && q.y < H + 5) vis.push(q); }
    if(vis.length <= 600) { g.fillStyle = fg; vis.forEach((q) => g.fillRect(q.x - 1.5, q.y - 1.5, 3, 3)); }
    if(many) { g.fillStyle = '#ffcc00'; g.textBaseline = 'top'; g.fillText(`図形が多いので、${ALIGN_VIEW_MAX}個だけ描いています（点は全部拾えます）`, 8, 8); }
    // 張り合わせ点（緑。ほかの組と合わない組は赤、使わない組は灰色）
    const c = _alignCalc();
    g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    _align.pairs.forEach((pr, n) => {
        const q = S(pr.src.x, pr.src.y), r = c.rows[n], col = pr.use === false ? '#888888' : r && r.flag ? '#ff6b6b' : '#00ff88';
        g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 8, 0, Math.PI * 2); g.stroke();
        g.fillStyle = col; g.fillText(String(n + 1), q.x - 14, q.y - 11);
    });
    // 選んだ点（図面で合わせる先の点を待っている）
    if(_align.sel) {
        const q = S(_align.sel.x, _align.sel.y);
        g.strokeStyle = '#00ffff'; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 11, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#00ffff'; g.textAlign = 'left'; g.fillText((_align.sel.t ? _align.sel.t + ' ' : '') + '→ 図面で指定', q.x + 14, q.y + 12);
    }
    // マウスの下の、吸い付く点の下見（図面のスナップと同じ記号と、種類の名前）。図形が変わっていたら（↩ など）出さない
    if(_align.hover && _align.hoverEp !== (typeof _geomEpoch !== 'undefined' ? _geomEpoch : 0)) _align.hover = null;
    if(_align.hover) {
        const q = S(_align.hover.x, _align.hover.y);
        g.strokeStyle = '#ffcc00'; g.lineWidth = 2; g.setLineDash([]);
        drawSnapShape(_align.hover.t, q.x, q.y, 6, g);
        g.font = 'bold 11px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#ffcc00';
        g.fillText(_align.hover.t, q.x + 11, q.y - 11);
    }
}

// ===== 図面に重ねる表示（cad-render.js から）: 動かす図形・張り合わせ点・動かした先の形 =====
function drawAlignOverlay() {
    if(!_alignOverlayOn()) return;
    const idxs = _alignTargets(), c = _alignCalc();
    ctx.save();
    // 動かす図形（オレンジ。多いときは外形の枠だけ）
    if(idxs.length <= EDIT_PREVIEW_MAX) idxs.forEach((i) => editDrawShape(entities[i], '#ffaa00'));
    else {
        const b = editBoundsOf(idxs.map((i) => entities[i]));
        if(b) { const a = wcsToScreen(b.minX, b.minY), d = wcsToScreen(b.maxX, b.maxY); ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 1.5; ctx.strokeRect(Math.min(a.x, d.x), Math.min(a.y, d.y), Math.abs(d.x - a.x), Math.abs(d.y - a.y)); }
    }
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    _align.pairs.forEach((p, k) => {
        const a = wcsToScreen(p.src.x, p.src.y), b = wcsToScreen(p.dst.x, p.dst.y);
        const r = c.rows[k], col = p.use === false ? '#888888' : (r && r.flag ? '#ff6b6b' : '#00ff88');
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, Math.PI * 2); ctx.stroke();                          // 動かす側: 丸
        ctx.strokeRect(b.x - 5, b.y - 5, 10, 10);                                                    // 合わせる先: 四角
        ctx.fillText(String(k + 1), a.x + 8, a.y - 4); ctx.fillText(String(k + 1), b.x + 8, b.y - 4);
    });
    // 選んだ「動かす側の点」（合わせる先を待っている）。変換が決まっていれば、見込みの位置も
    if(_align.sel) {
        const a = wcsToScreen(_align.sel.x, _align.sel.y);
        ctx.strokeStyle = '#00ffff'; ctx.fillStyle = '#00ffff'; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.stroke();
        if(c.sol && c.sol.ok && c.T) {
            const w = editXformPoint(c.T, _align.sel.x, _align.sel.y), q = wcsToScreen(w.x, w.y);
            ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]); ctx.fillText('この辺り', q.x + 15, q.y - 4);
        }
    }
    ctx.restore();
    if(c.sol && c.sol.ok && c.T) _editDrawPreview(idxs, [c.T]); // 動かした先の形（黄色の点線）
}
