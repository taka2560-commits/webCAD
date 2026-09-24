// ===== Web CAD 操作ガイド =====
// cad-guide.js - はじめて使う人向けの操作ガイド
//   ① ツアー: 練習用の図面で、実際に操作すると次へ進む（はじめてツアー・座標読取モード・機能別のミニツアー）
//   ② 操作中のヒント: コマンドを始めると手順カードを出し、操作が進むと次の手順に切り替える。
//      つまずいていそうな操作（1本指で画面を動かそうとする等）には一言だけ助けを出す
//   ③ ヘルプ（❓）: 機能ごとの説明と「やってみる」、コマンド一覧、ヒントの出し方の設定
//
// 他のファイルは guideNotify('出来事') でガイドに知らせるだけ（ガイドを使っていないときは何もしない）。

const GUIDE_KEY = 'cad_guide';
const GUIDE_HINT_LIMIT = 3;          // 「最初の3回」: コマンドごとに手順カードを出す回数
const GUIDE_TICK_MS = 120;           // ツアー中に状態を見る間隔
let GUIDE_STUCK_MS = 25000;          // コマンドの最初の段階でこの時間止まっていたら一言（テストでは短くする）
let GUIDE_STEP_DONE_MS = 650;        // 手順を終えてから次へ進むまで（「✓ できました」を見せる）
// 利用者の保存データがある（＝以前から使っている）か。ガイドが自分の設定を書く前に調べる
const _guideExistingUser = (function() {
    try { return Object.keys(localStorage).some(k => k.startsWith('cad_') && k !== GUIDE_KEY); } catch { return false; }
})();

// ===== 保存（端末ごと） =====
function _guideLoad() {
    try {
        const v = JSON.parse(localStorage.getItem(GUIDE_KEY) || '{}');
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch { return {}; }
}
let _guide = _guideLoad(); // { welcome, laterCount, tours:{id:'done'}, hintsMode:'auto'|'always'|'off', hintCounts:{}, tips:{} }
function _guideSave() { try { localStorage.setItem(GUIDE_KEY, JSON.stringify(_guide)); } catch { /* 保存できなくても今回は使える */ } }
function guideHintsMode() { return ['auto', 'always', 'off'].includes(_guide.hintsMode) ? _guide.hintsMode : 'auto'; }

// 説明文: スマホ（指）と PC（マウス）で書き分けたものは今の端末に合う方を使う
function _guideIsTouch() { return (typeof isMobile === 'function') ? isMobile() : false; }
function _gt(t) { return (t && typeof t === 'object') ? (_guideIsTouch() ? t.touch : t.pc) : (t || ''); }
function _guideIsFs() { return document.body.classList.contains('fullscreen-mode'); }

// ===== 画面の部品（必要になったときに作る） =====
function _guideEl(id, tag) {
    let el = document.getElementById(id);
    if(!el) { el = document.createElement(tag || 'div'); el.id = id; document.body.appendChild(el); }
    return el;
}

// ===== 出来事の受け取り =====
let _guideModeTimer = null;
function guideNotify(type) {
    // コマンドの区切り（終了・取り消し）: すぐに手順カードを閉じ、次のコマンドを新しく数える
    if(type === 'reset') { _hintSession = null; _guideHideHint(); }
    // 段階の変化・点の入力: 段階が決まってから手順カードを合わせる
    if(type === 'mode' || type === 'point' || type === 'reset') { clearTimeout(_guideModeTimer); _guideModeTimer = setTimeout(_guideOnModeChange, 0); }
    if(_tour) _tourOnEvent(type);
    _guideTipsOnEvent(type);
}

// ===================================================================
// ① ツアー
// ===================================================================
// 練習用の図面（測量の並び: X＝北、Y＝東）。区画1つ・測点4つ・道路・マンホール
const _gP = (X, Y) => (typeof surveyToWcs === 'function') ? surveyToWcs(X, Y) : { x: Y, y: X };
const _gA = () => _gP(0, 0), _gC = () => _gP(20, 30), _gAB = () => _gP(0, 15);
const _gZoomed = (b) => Math.abs(Math.log(view.scale / b.scale)) > 0.18;
const _gPanned = (b) => Math.hypot(view.x - b.vx, view.y - b.vy) > 60;
const _gAt = (p, q) => !!p && Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
const _gSnapAt = (q) => typeof snapActive === 'function' && snapActive() && _gAt({ x: snapResult.wcsX, y: snapResult.wcsY }, q);
const _gDrawerOpen = () => { const d = document.getElementById('fs-tools-drawer'); return !!d && d.classList.contains('fs-drawer-open'); };
let _gPanelStart = null; // パネルの移動の手順を始めたときの位置
const _gPanelPos = () => { const r = document.getElementById('property-panel').getBoundingClientRect(); return { x: r.left, y: r.top }; };

// よく使う手順（ツアー同士で使い回す）
const GUIDE_STEP = {
    zoom: { title: '拡大・縮小', text: { touch: '2本指で広げると拡大、つまむと縮小します。', pc: 'マウスのホイールを回すと拡大・縮小します。' }, target: 'canvas', done: _gZoomed },
    pan: { title: '画面を動かす', text: { touch: '2本指で触れたまま、スライドして動かします（1本指では動きません）。', pc: 'ホイール（中ボタン）を押したままドラッグして動かします。' }, target: 'canvas', done: _gPanned },
    extents: { title: '全体を表示', text: '🔍全体 で、図面全体が画面に収まります。', target: '#btn-extents', on: 'extents' },
    measureStart: { title: '測ってみる', text: '左の 📐測定 をタップします。', target: '#tool-measure', done: () => cmdState.mode.startsWith('WAITING_DIMMEAS') },
    measureBase: { title: '基点を決める', text: { touch: '測点 A まで指でなぞります。緑の記号（スナップ）が出たら指を離し、下の ☑確定 を押します。', pc: '測点 A をクリックします（近づくと緑の記号＝スナップで吸い付きます）。' }, target: { wcs: _gA, r: 34 }, done: () => cmdState.mode === 'WAITING_DIMMEAS_TO' },
    measureRead: { title: '距離を読む', text: { touch: '測点 C へ指でなぞると、基点からの X・Y・直線の距離が出ます。📐記入 を押すと寸法として図面に残ります。', pc: 'カーソルを測点 C へ動かすと、基点からの X・Y・直線の距離が出ます。📐記入 で寸法として残ります。' }, target: { wcs: _gC, r: 34 }, on: 'measureWrite', next: true },
};

const GUIDE_TOURS = {
    basic: {
        title: 'はじめてツアー', sample: true, screen: 'normal',
        steps: [
            { title: 'ようこそ', text: 'この図面は練習用です（開いていた図面はツアーのあとで元に戻ります）。\n書いてあるとおりに操作すると、次へ進みます。いつでも ✕ でやめられます。', next: true },
            GUIDE_STEP.zoom, GUIDE_STEP.pan, GUIDE_STEP.extents,
            { title: '図形を選ぶ', text: '区画の線をタップすると選べます。下にボタン（移動・削除など）が出ます。もう一度タップすると解除します。', target: { wcs: _gAB, r: 30 },
                done: () => cmdState.mode === 'IDLE' && (((cmdState.selectedIndices || []).length > 0) || cmdState.highlightIdx >= 0) },
            { title: 'ルーペと座標', text: { touch: '1本指で図面をなぞると、指の上に拡大鏡（ルーペ）が出て、その下に座標が出ます（X＝北・Y＝東）。', pc: 'カーソルを動かすと、右下に座標が出ます（X＝北・Y＝東）。' }, target: 'canvas',
                onEnter: () => { if(typeof clearSelection === 'function') clearSelection(); if(typeof render === 'function') render(); },
                done: (b) => _guideIsTouch() ? !!(_tour && _tour.flags.loupe) : Math.hypot(mouse.screenX - b.mx, mouse.screenY - b.my) > 80, on: 'idleDrag' },
            GUIDE_STEP.measureStart, GUIDE_STEP.measureBase, GUIDE_STEP.measureRead,
            { title: '元に戻す', text: '↩ で1つ前の状態に戻ります（記入した寸法が消えます）。', target: '#btn-undo', on: 'undo' },
            { title: '保存', text: '💾保存 で、図面を端末に保存します（練習なので実際には保存しません）。\n作業中の図面は自動でも保存されています。', target: '#btn-save', on: 'saved' },
            { title: 'おわり', text: '基本はここまでです。ほかにも 📍座標一覧、SIMA・座標CSV の読込、🛰現在地、🎯座標読取モード、スナップの設定（OSNAP の ▼）などがあります。\n右下や ⋯ メニューの ❓ から、いつでも見られます。', next: 'おわる',
                extra: [{ label: '🎯 座標読取モードも見る', action: () => startGuideTour('fullscreen') }] },
        ],
    },
    fullscreen: {
        title: '座標読取モード', sample: true, screen: 'any',
        steps: [
            { title: '座標読取モードに入る', text: '上の 🎯座標読取 をタップします。図面を広く見ながら座標を読むモードになります。', target: '#btn-coordread', done: _guideIsFs, skipIf: _guideIsFs },
            { title: 'なぞって読む', text: { touch: '1本指で図面をなぞると、上に X・Y、指の横に座標が出ます。測点に近づくと緑の記号（スナップ）で吸い付きます。\n測点 C に合わせてみましょう。', pc: 'カーソルを動かすと、上に X・Y と座標が出ます。測点に近づくと緑の記号（スナップ）で吸い付きます。\n測点 C に合わせてみましょう。' },
                target: { wcs: _gC, r: 34 }, done: () => _guideIsFs() && _gSnapAt(_gC()) },
            { title: '座標を残す', text: '指を離しても、座標は左上に残ります（メモに便利です）。\nXY で座標の表示を ON/OFF できます。', target: '#fs-btn-coord', next: true },
            { title: '拡大・縮小', text: '左下のスライダーと ＋・− で拡大・縮小します。スナップしている点を中心に拡大するので、細かい所も見失いません。2本指でもできます。', target: '#fs-zoom-panel', done: _gZoomed },
            { title: 'スナップの設定', text: '⊕ でスナップの ON/OFF、▼ で吸い付く点の種類や「次の1点だけ」を選べます。', target: ['#fs-btn-osnap', '#fs-btn-osnap-panel'], next: true },
            { title: '全体を表示', text: '⛶ で図面全体を表示します。', target: '#fs-btn-extents', on: 'extents' },
            { title: '道具箱を開く', text: '右端の ◀ で道具箱を開きます。', target: '#fs-drawer-toggle', done: _gDrawerOpen },
            { title: '道具箱の中身', text: '📍座標 で測点の座標を引出線つきで図面に書き込めます。📏連続寸法・📐基点測定で測ることもできます。\nUCS・画層・座標一覧・現在地もここから使えます。', target: '#fs-tools', next: true,
                onExit: () => { if(typeof window.autoCloseDrawer === 'function') window.autoCloseDrawer(); } },
            { title: '通常の画面に戻る', text: '✕ で通常の画面に戻ります。', target: '#fs-btn-exit', done: () => !_guideIsFs(), skipIf: () => !_guideIsFs() },
            { title: 'おわり', text: '座標読取モードは、現場で図面の座標を確かめるのに向いています。もう一度見たいときは ❓ から。', next: 'おわる' },
        ],
    },
    view: {
        title: '画面の動かし方', sample: true, screen: 'normal',
        steps: [GUIDE_STEP.zoom, GUIDE_STEP.pan, GUIDE_STEP.extents, { title: 'おわり', text: '画面の動かし方はここまでです。', next: 'おわる' }],
    },
    measure: {
        title: '測る（基点測定）', sample: true, screen: 'normal',
        steps: [GUIDE_STEP.measureStart, GUIDE_STEP.measureBase, GUIDE_STEP.measureRead,
            { title: 'おわり', text: '寸法として残したいときは、ツールバーの ↔平行・⤢整列 や、道具箱の 📏連続寸法 も使えます。', next: 'おわる' }],
    },
    snap: {
        title: 'スナップの設定', sample: false, screen: 'normal',
        steps: [
            { title: '設定を開く', text: '下のステータスバーの OSNAP の右にある ▼ をタップします。', target: '#btn-osnap-panel',
                done: () => { const p = document.getElementById('osnap-panel'); return !!p && p.style.display === 'block'; } },
            { title: 'いつも使うスナップ', text: 'チェックした種類の点に吸い付きます。図心・等分点は、必要なときだけ ON にします。', target: '#osnap-panel .osnap-grid', next: true },
            { title: '次の1点だけ', text: '押した種類だけに、次の1点だけ吸い付きます（ほかの候補に取られません）。点を入れると元に戻ります。', target: '#osnap-panel .osnap-once-grid', next: true },
            { title: '延長と切り替え', text: '線の上で指を少し止めると、その線を延ばした先（延長・延長交点）にも吸い付きます。\n候補が重なったときは、寸法・測定の画面下の ⇄ で切り替えられます。', target: '#osnap-panel .osnap-hint', next: 'おわる' },
        ],
        onEnd: () => { const p = document.getElementById('osnap-panel'); if(p) p.style.display = 'none'; },
    },
    panel: {
        title: 'パネルの移動', sample: false, screen: 'normal',
        steps: [
            { title: 'パネルを動かす', text: 'パネルの見出し（⠿ の帯）をつまんで、好きな場所へ動かせます。', target: '#property-panel-header',
                onEnter: () => { if(typeof showOptionsPanel === 'function') showOptionsPanel(); _gPanelStart = _gPanelPos(); },
                done: () => { const p = _gPanelPos(); return !!_gPanelStart && Math.hypot(p.x - _gPanelStart.x, p.y - _gPanelStart.y) > 20; } },
            { title: '元の位置に戻す', text: '見出しをダブルタップすると、画面の中央に戻ります。置いた場所は次に開いたときも覚えています。', target: '#property-panel-header', next: 'おわる' },
        ],
        onEnd: () => { if(typeof hidePropertyPanel === 'function') hidePropertyPanel(); },
    },
    prefs: {
        title: '表示の設定', sample: false, screen: 'normal',
        steps: [
            { title: '表示・操作の設定', text: 'オプションの「表示・操作」で、ルーペの大きさ・座標の文字の大きさや桁・寸法の文字・吸着の範囲を変えられます。', target: '.opt-pref-seg',
                onEnter: () => { if(typeof showOptionsPanel === 'function') showOptionsPanel(); }, next: 'おわる' },
        ],
        onEnd: () => { if(typeof hidePropertyPanel === 'function') hidePropertyPanel(); },
    },
};

let _tour = null;     // { id, def, i, base, flags, backup, timer, completing }
let _tourTicker = null;
function guideTourActive() { return !!_tour; }

// 開いていた図面を控えておき、ツアーのあとで元に戻す
function _guideBackup() {
    return {
        snap: _undoSnapshot(), undo: undoStack.slice(), redo: redoStack.slice(),
        view: Object.assign({}, view), ucs: Object.assign({}, ucs), layerIdx: currentLayerIndex, name: window._drawingName || '',
    };
}
function _guideRestore(b) {
    if(!b) return;
    _applyUndoSnapshot(b.snap);
    undoStack = b.undo; redoStack = b.redo;
    view = Object.assign({}, b.view); ucs = Object.assign({}, b.ucs);
    currentLayerIndex = layers[b.layerIdx] ? b.layerIdx : 0;
    if(typeof _bumpGeomEpoch === 'function') _bumpGeomEpoch();
    if(typeof initLayers === 'function') initLayers();
    if(typeof updateUCSDropdowns === 'function') updateUCSDropdowns();
    if(typeof setDrawingName === 'function') setDrawingName(b.name);
    if(typeof render === 'function') render();
}
// 練習用の図面を作る（区画1つ・測点A〜D・道路・マンホール）
function _guideLoadSample() {
    entities.length = 0;
    layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
    currentLayerIndex = 0;
    ucs = { originX: 0, originY: 0, angle: 0 }; view.rotation = 0;
    if(typeof addSurveyData === 'function') {
        addSurveyData(
            [{ num: '1', name: 'A', X: 0, Y: 0, z: null }, { num: '2', name: 'B', X: 0, Y: 30, z: null },
             { num: '3', name: 'C', X: 20, Y: 30, z: null }, { num: '4', name: 'D', X: 20, Y: 0, z: null }],
            [{ num: '1', name: '練習区画', refs: [{ num: '1' }, { num: '2' }, { num: '3' }, { num: '4' }] }]);
    }
    const f = (typeof surveyUnitFactor === 'function') ? surveyUnitFactor() : 1;
    // 測点名・区画名は、スマホの画面でも読める大きさにする（測点名は点の右上に置き直す）
    const h = 2.6 * f;
    entities.forEach(e => {
        if(e.type !== 'TEXT') return;
        e.height = h;
        if(e.ptLabel) { const pt = entities.find(q => q.type === 'POINT' && q.gid === e.gid); if(pt) { e.x = pt.x + h * 0.4; e.y = pt.y + h * 0.3; } }
        delete e.bbox;
    });
    const p1 = _gP(-8, -10), p2 = _gP(-8, 42), mh = _gP(10, 36);
    entities.push({ type: 'LINE', layer: 0, color: '#aaaaaa', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });          // 道路
    entities.push({ type: 'CIRCLE', layer: 0, color: '#aaaaaa', cx: mh.x, cy: mh.y, radius: 1.2 * f });          // マンホール
    ensureEntityIds(); _bumpGeomEpoch();
    undoStack = []; redoStack = [];
    if(typeof initLayers === 'function') initLayers();
    if(typeof window.updateLayerPanel === 'function') window.updateLayerPanel();
    if(typeof setDrawingName === 'function') setDrawingName('練習用図面');
    zoomExtents();
    const c = screenToWcs(canvas.width / 2, canvas.height / 2); // 余白を少し広げる（中心は保つ）
    view.scale *= 0.85; _reanchorView(canvas.width / 2, canvas.height / 2, c);
    if(typeof render === 'function') render();
}

window.startGuideTour = function(id) {
    const def = GUIDE_TOURS[id];
    if(!def) return;
    if(_tour) endGuideTour(false);
    _guideHideWelcome();
    if(typeof hidePropertyPanel === 'function') hidePropertyPanel();
    const op = document.getElementById('osnap-panel'); if(op) op.style.display = 'none';
    if(typeof resetCommand === 'function') resetCommand();
    if(def.screen === 'normal' && _guideIsFs() && typeof window.toggleFullscreen === 'function') window.toggleFullscreen(); // index.html の関数
    _tour = { id, def, i: -1, base: null, flags: {}, backup: null, completing: false };
    document.body.classList.add('guide-touring'); // 操作ボタン（☑確定など）は暗くしない
    if(def.sample) { _tour.backup = _guideBackup(); _guideLoadSample(); }
    _guideHideHint();
    clearInterval(_tourTicker);
    _tourTicker = setInterval(_tourTick, GUIDE_TICK_MS);
    _tourGo(0);
};

// ツアーを終える（completed: 最後まで進んだ）
window.endGuideTour = function(completed) {
    if(!_tour) return;
    const t = _tour;
    _tour = null;
    document.body.classList.remove('guide-touring');
    clearInterval(_tourTicker); _tourTicker = null;
    const step = t.def.steps[t.i];
    if(step && step.onExit) { try { step.onExit(); } catch { /* 画面の部品が無いときは何もしない */ } }
    if(t.def.onEnd) { try { t.def.onEnd(); } catch { /* 同上 */ } }
    if(typeof resetCommand === 'function') resetCommand();
    if(typeof touchState !== 'undefined') touchState.showLoupe = false;
    if(t.backup) _guideRestore(t.backup);
    _guideHideCard();
    _guideResetPageScroll();
    // ツアーで動かした上のバー・左のツールバーを最初の位置に戻す（📁開く・線分が見えるように）
    const tb = document.getElementById('top-bar'), rail = document.getElementById('toolbar');
    if(tb) tb.scrollLeft = 0; if(rail) rail.scrollTop = 0;
    if(completed) {
        _guide.tours = Object.assign({}, _guide.tours, { [t.id]: 'done' });
        if(t.id === 'basic') _guide.welcome = 'done';
        _guideSave();
    }
    if(typeof renderOverlay === 'function') renderOverlay();
};

// 手順 i を表示する
function _tourGo(i) {
    const t = _tour; if(!t) return;
    const prev = t.def.steps[t.i];
    if(prev && prev.onExit) { try { prev.onExit(); } catch { /* 同上 */ } }
    let n = i;
    while(n < t.def.steps.length && t.def.steps[n].skipIf && t.def.steps[n].skipIf()) n++;
    if(n >= t.def.steps.length) { endGuideTour(true); return; }
    t.i = n; t.completing = false; t.flags = {};
    const step = t.def.steps[n];
    if(step.onEnter) { try { step.onEnter(); } catch { /* 同上 */ } }
    t.base = { scale: view.scale, vx: view.x, vy: view.y, mx: mouse.screenX, my: mouse.screenY, undo: undoStack.length, redo: redoStack.length };
    _tourScrollTargetIntoView(step);
    _tourRenderCard();
    _tourPlace();
}

// 手順を終えたとき: 「✓ できました」を見せてから次へ
function _tourComplete() {
    const t = _tour; if(!t || t.completing) return;
    t.completing = true;
    const ok = document.querySelector('#guide-card .gc-ok');
    if(ok) ok.style.display = '';
    if(navigator.vibrate) navigator.vibrate(15);
    const at = t.i;
    setTimeout(() => { if(_tour === t && t.i === at) _tourGo(at + 1); }, GUIDE_STEP_DONE_MS);
}
window.guideTourNext = function() { if(_tour) _tourGo(_tour.i + 1); };
window.guideTourSkip = function() { if(_tour) _tourGo(_tour.i + 1); };

function _tourOnEvent(type) {
    const t = _tour; if(!t || t.completing) return;
    const step = t.def.steps[t.i]; if(!step) return;
    if(type === 'idleDrag') t.flags.loupe = true;
    if(step.on === type) _tourComplete();
}
function _tourTick() {
    const t = _tour; if(!t) return;
    const step = t.def.steps[t.i]; if(!step) return;
    if(typeof touchState !== 'undefined' && touchState.showLoupe) t.flags.loupe = true;
    _tourPlace();
    if(!t.completing && step.done) {
        let ok;
        try { ok = !!step.done(t.base); } catch { ok = false; }
        if(ok) _tourComplete();
    }
}

// 指し示す場所（画面座標の四角）。見えないときは null
function _tourTargetRect(step) {
    const tg = step.target;
    if(!tg) return null;
    if(tg === 'canvas') return null; // 図面全体（囲まずに説明だけ出す）
    if(typeof tg === 'object' && !Array.isArray(tg) && tg.wcs) {
        const p = tg.wcs(), s = wcsToScreen(p.x, p.y), cr = canvas.getBoundingClientRect(), r = tg.r || 30;
        return { left: cr.left + s.x - r, top: cr.top + s.y - r, width: r * 2, height: r * 2, round: true };
    }
    const sels = Array.isArray(tg) ? tg : [tg];
    let box = null;
    sels.forEach(sel => {
        const el = document.querySelector(sel);
        if(!el) return;
        const r = el.getBoundingClientRect();
        if(r.width <= 0 || r.height <= 0) return;
        box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
                  : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    if(!box) return null;
    return { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top };
}
// 横にスクロールする上のバーや、縦にスクロールする左のツールバーの中なら、そのバーだけを動かして見せる。
// （scrollIntoView はページ全体まで動かしてしまい、画面が横にずれることがあったため使わない）
function _tourScrollTargetIntoView(step) {
    const tg = step.target;
    if(typeof tg !== 'string' || tg === 'canvas') return;
    const el = document.querySelector(tg);
    if(!el) return;
    for(let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        const sx = /(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth;
        const sy = /(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight;
        if(!sx && !sy) continue;
        const pr = p.getBoundingClientRect(), r = el.getBoundingClientRect(), m = 16;
        if(sx) { if(r.left < pr.left) p.scrollLeft -= (pr.left - r.left) + m; else if(r.right > pr.right) p.scrollLeft += (r.right - pr.right) + m; }
        if(sy) { if(r.top < pr.top) p.scrollTop -= (pr.top - r.top) + m; else if(r.bottom > pr.bottom) p.scrollTop += (r.bottom - pr.bottom) + m; }
        break;
    }
    _guideResetPageScroll();
}
// ページ全体（body）はスクロールさせない。ずれていたら戻す
function _guideResetPageScroll() {
    if(document.body.scrollLeft || document.body.scrollTop) { document.body.scrollLeft = 0; document.body.scrollTop = 0; }
}

// スポットライト（対象の周りだけ明るく）と説明カードの位置
function _tourPlace() {
    const t = _tour; if(!t) return;
    const step = t.def.steps[t.i]; if(!step) return;
    const spot = _guideEl('guide-spot'), dim = _guideEl('guide-dim'), card = _guideEl('guide-card');
    const rect = _tourTargetRect(step);
    if(rect) {
        const pad = rect.round ? 0 : 6;
        spot.style.display = 'block';
        spot.style.left = (rect.left - pad) + 'px'; spot.style.top = (rect.top - pad) + 'px';
        spot.style.width = (rect.width + pad * 2) + 'px'; spot.style.height = (rect.height + pad * 2) + 'px';
        spot.style.borderRadius = rect.round ? '50%' : '12px';
        dim.style.display = 'none';
    } else {
        spot.style.display = 'none';
        // 図面を操作する手順では暗くしない（図面が見えないと操作できない）。説明だけの手順は少し暗くする
        dim.style.display = (step.target === 'canvas') ? 'none' : 'block';
    }
    // カードは対象と重ならない側（画面の上か下）に置く
    const H = window.innerHeight, W = window.innerWidth;
    const fs = _guideIsFs();
    const ab = document.getElementById('fs-dim-actionbar');
    const abVisible = !!ab && ab.style.display !== 'none';
    const topY = fs ? 56 : 68, bottomGap = abVisible ? (fs ? 96 : 124) : (fs ? 24 : 56);
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top;
    const tc = rect ? rect.top + rect.height / 2 : (step.target === 'canvas' ? H / 2 : 0);
    if(rect || step.target === 'canvas') top = (tc > H * 0.45) ? topY : Math.max(topY, H - bottomGap - ch);
    else top = Math.max(topY, (H - ch) / 2);
    // 全体表示モードでは右端のボタンの列を隠さないよう左に寄せる
    const left = fs ? 12 : Math.max(12, (W - cw) / 2);
    card.style.top = top + 'px'; card.style.left = left + 'px';
}

function _tourRenderCard() {
    const t = _tour; if(!t) return;
    const step = t.def.steps[t.i];
    const card = _guideEl('guide-card');
    card.className = _guideIsFs() ? 'gc-fs' : '';
    const n = t.def.steps.length;
    const isLast = t.i === n - 1;
    const nextLabel = (typeof step.next === 'string') ? step.next : (step.next ? '次へ' : null);
    const extra = (step.extra || []).map((x, k) => `<button class="gc-btn" data-extra="${k}">${escapeHtml(x.label)}</button>`).join('');
    card.innerHTML = `
        <div class="gc-top"><span class="gc-prog">${escapeHtml(t.def.title)}&nbsp;&nbsp;${t.i + 1} / ${n}</span><button class="gc-x" title="ツアーをやめる" onclick="endGuideTour(false)">✕</button></div>
        <div class="gc-title">${escapeHtml(step.title)}</div>
        <div class="gc-text">${escapeHtml(_gt(step.text))}</div>
        <div class="gc-ok" style="display:none;">✓ できました</div>
        <div class="gc-btns">${extra}${nextLabel ? '' : '<button class="gc-btn" onclick="guideTourSkip()">スキップ</button>'}${nextLabel ? `<button class="gc-btn primary" onclick="${isLast ? 'endGuideTour(true)' : 'guideTourNext()'}">${escapeHtml(nextLabel)}</button>` : ''}</div>`;
    card.querySelectorAll('[data-extra]').forEach(b => b.addEventListener('click', () => {
        const x = (step.extra || [])[+b.dataset.extra];
        if(!x) return;
        endGuideTour(true);
        x.action();
    }));
    card.style.display = 'block';
}
function _guideHideCard() {
    ['guide-card', 'guide-spot', 'guide-dim'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
}

// ツアー中にファイルを開いたら、先に開いていた図面へ戻してツアーを終える（練習用の図面に読み込まない）
function guideBeforeFileOpen() { if(_tour) endGuideTour(false); }

// ===================================================================
// 初回の案内
// ===================================================================
function _guideShowWelcome() {
    if(_tour) return;
    const card = _guideEl('guide-card');
    card.className = 'gc-welcome';
    card.innerHTML = `
        <div class="gc-title">👋 はじめての方へ</div>
        <div class="gc-text">約3分のツアーで、画面の動かし方・座標の読み方・測り方・保存を、練習用の図面で実際に操作しながら覚えられます。</div>
        <div class="gc-btns">
            <button class="gc-btn" onclick="guideWelcomeAnswer('never')">表示しない</button>
            <button class="gc-btn" onclick="guideWelcomeAnswer('later')">あとで</button>
            <button class="gc-btn primary" onclick="guideWelcomeAnswer('start')">ツアーを始める</button>
        </div>`;
    card.style.display = 'block';
    const dim = _guideEl('guide-dim'); dim.style.display = 'block';
    card.style.left = Math.max(12, (window.innerWidth - card.offsetWidth) / 2) + 'px';
    card.style.top = Math.max(68, (window.innerHeight - card.offsetHeight) / 2) + 'px';
}
function _guideHideWelcome() {
    const card = document.getElementById('guide-card');
    if(card && card.classList.contains('gc-welcome')) _guideHideCard();
}
window.guideWelcomeAnswer = function(a) {
    _guideHideWelcome();
    if(a === 'start') { startGuideTour('basic'); return; }
    if(a === 'never') _guide.welcome = 'never';
    else { _guide.welcome = 'later'; _guide.laterCount = (_guide.laterCount || 0) + 1; }
    _guideSave();
    if(typeof showToast === 'function') showToast('操作ガイドは右下や ⋯ メニューの ❓ からいつでも見られます', 4000);
};
// 起動直後: はじめての人には案内、以前から使っている人には一度だけお知らせ
function _guideStartup(tries) {
    const w = _guide.welcome;
    if(w === 'never' || w === 'done' || w === 'notice') return;
    if(w === 'later' && (_guide.laterCount || 0) >= 3) return;
    // パネル・保存一覧を開いている間やコマンドの途中は待つ
    const pp = document.getElementById('property-panel'), plist = document.getElementById('project-list-panel');
    const busy = (pp && pp.style.display === 'flex') || (plist && plist.style.display && plist.style.display !== 'none') || cmdState.mode !== 'IDLE';
    if(busy) {
        if((tries || 0) < 15) setTimeout(() => _guideStartup((tries || 0) + 1), 2000);
        return;
    }
    if(w === undefined && (_guideExistingUser || entities.length > 0)) {
        _guide.welcome = 'notice'; _guideSave();
        if(typeof showToast === 'function') showToast('操作ガイドができました。右下や ⋯ メニューの ❓ から見られます', 5000);
        return;
    }
    _guideShowWelcome();
}
if(document.readyState === 'complete') setTimeout(() => _guideStartup(0), 1500);
else window.addEventListener('load', () => setTimeout(() => _guideStartup(0), 1500));

// ===================================================================
// ② 操作中のヒント（手順カード）
// ===================================================================
// prefix: そのコマンドの段階名の頭。steps: 段階ごとの説明（modes は段階名の末尾、when は条件）
const GUIDE_HINTS = [
    { key: 'MEASURE', title: '📐 基点測定', prefix: 'WAITING_DIMMEAS_', steps: [
        { modes: ['BASE'], text: { touch: '基点にしたい点まで指でなぞり（緑の記号＝スナップ）、☑確定', pc: '基点にしたい点をクリック' } },
        { modes: ['TO'], text: { touch: '測りたい点へなぞると X・Y・直線の距離が出ます。📐記入 で寸法に、📍基点 で基点を移動、❌終了 でおわり', pc: 'カーソルを測りたい点へ。📐記入 で寸法に、❌終了 でおわり' } }] },
    { key: 'DIMLIN', title: '↔ 平行寸法', prefix: 'WAITING_DIMLIN_', steps: [
        { modes: ['P1'], text: { touch: '1点目までなぞって ☑確定', pc: '1点目をクリック' } },
        { modes: ['P2'], text: { touch: '2点目までなぞって ☑確定（線までの垂直距離は「垂線」スナップで）', pc: '2点目をクリック（線までの垂直距離は「垂線」スナップで）' } },
        { modes: ['POS'], text: { touch: '寸法線を置く位置までなぞって ☑確定', pc: '寸法線を置く位置をクリック' } }] },
    { key: 'DIMALN', title: '⤢ 整列寸法', prefix: 'WAITING_DIMALN_', steps: [
        { modes: ['P1'], text: { touch: '1点目までなぞって ☑確定', pc: '1点目をクリック' } },
        { modes: ['P2'], text: { touch: '2点目までなぞって ☑確定（線までの垂直距離は「垂線」スナップで）', pc: '2点目をクリック' } },
        { modes: ['POS'], text: { touch: '寸法線を置く位置までなぞって ☑確定', pc: '寸法線を置く位置をクリック' } }] },
    { key: 'DIMCONT', title: '📏 連続寸法', prefix: 'WAITING_DIMCONT_', steps: [
        { modes: ['P1'], text: '1点目までなぞって ☑確定' },
        { modes: ['P2'], text: '2点目までなぞって ☑確定' },
        { modes: ['POS'], text: '寸法線の高さまでなぞって ☑確定' },
        { modes: ['NEXT'], text: '次の点を ☑確定 で続けて記入します。📏 で直列／並列を切り替え、❌終了 でおわり' }] },
    { key: 'DIMORD', title: '📍 座標寸法', prefix: 'WAITING_DIMORD_', steps: [
        { modes: ['P1'], text: '座標を書き込む点までなぞって ☑確定' },
        { modes: ['LEADER'], text: '文字を置く位置までなぞって ☑確定' }] },
    { key: 'DIMANG', title: '∠ 角度寸法', prefix: 'WAITING_DIMANG_', steps: [
        { modes: ['P1'], text: '角の頂点までなぞって ☑確定' }, { modes: ['P2'], text: '1本目の辺の上の点を ☑確定' }, { modes: ['P3'], text: '2本目の辺の上の点を ☑確定' }] },
    { key: 'DIMRAD', title: 'R 半径寸法', prefix: 'WAITING_DIMRAD_', steps: [{ modes: ['SELECT'], text: '円・円弧をタップ' }, { modes: ['POS'], text: '寸法の位置までなぞって ☑確定' }] },
    { key: 'DIMDIA', title: '⌀ 直径寸法', prefix: 'WAITING_DIMDIA_', steps: [{ modes: ['SELECT'], text: '円・円弧をタップ' }, { modes: ['POS'], text: '寸法の位置までなぞって ☑確定' }] },
    { key: 'LINE', title: '／ 線分', prefix: 'WAITING_LINE_', steps: [
        { modes: ['P1'], text: { touch: '始点をタップ（なぞってルーペで合わせ、指を離すと決まります）', pc: '始点をクリック' } },
        { modes: ['P2'], text: { touch: '次の点をタップ。続けて引けます。終わるときは左の「線分」をもう一度タップ', pc: '次の点をクリック。続けて引けます。右クリックで終了' } }] },
    { key: 'PLINE', title: '∧ ポリライン', prefix: 'WAITING_PLINE_', steps: [
        { when: () => cmdState.points.length === 0, text: { touch: '始点をタップ（指を離すと決まります）', pc: '始点をクリック' } },
        { when: () => cmdState.points.length > 0, text: { touch: '次の点をタップ。☑確定 で完了、⭘閉じる で閉じた形に', pc: '次の点をクリック。☑確定（または Enter）で完了、⭘閉じる で閉じた形に' } }] },
    { key: 'RECT', title: '□ 長方形', prefix: 'WAITING_RECT_', steps: [{ modes: ['P1'], text: '1つ目の角をタップ' }, { modes: ['P2'], text: '反対側の角をタップ' }] },
    { key: 'CIRCLE', title: '◯ 円', prefix: 'WAITING_CIRCLE_', steps: [
        { modes: ['CENTER'], text: '中心をタップして ☑確定（半径は最初のパネルで決めた値）' }, { modes: ['RADIUS'], text: '半径の位置をタップして ☑確定' }] },
    { key: 'ARC', title: '⌒ 円弧', prefix: 'WAITING_ARC_', steps: [{ modes: ['P1'], text: '始点をタップ' }, { modes: ['P2'], text: '円弧が通る点をタップ' }, { modes: ['P3'], text: '終点をタップ' }] },
    { key: 'ELLIPSE', title: '⬭ 楕円', prefix: 'WAITING_ELLIPSE_', steps: [{ modes: ['CENTER'], text: '中心をタップ' }, { modes: ['X'], text: '横方向の端をタップ' }, { modes: ['Y'], text: '縦方向の端をタップ' }] },
    { key: 'MOVE', title: '✥ 移動', prefix: 'WAITING_MOVE_', steps: [
        { modes: ['SELECT'], text: '動かす図形をタップ' }, { modes: ['BASE'], text: 'つかむ点（基点）をタップ' }, { modes: ['DEST'], text: '移動先をタップ' }] },
    { key: 'COPY', title: '⊞ 複写', prefix: 'WAITING_COPY_', steps: [
        { modes: ['SELECT'], text: '複写する図形をタップ' }, { modes: ['BASE'], text: 'つかむ点（基点）をタップ' }, { modes: ['DEST'], text: '複写先をタップ（続けて複写できます）' }] },
    { key: 'ROTATE', title: '↻ 回転', prefix: 'WAITING_ROTATE_', steps: [
        { modes: ['SELECT'], text: '回す図形をタップ' }, { modes: ['BASE'], text: '回転の中心をタップ' }, { modes: ['REF1', 'REF2', 'DEST'], text: '角度を決める点をタップ（角度はパネルで数値でも入れられます）' }] },
    { key: 'ERASE', title: '✖ 削除', prefix: 'WAITING_ERASE_', steps: [{ modes: ['SELECT'], text: '消す図形をタップ（戻すときは ↩）' }] },
    { key: 'TRIM', title: '✂ トリム', prefix: 'WAITING_TRIM', steps: [{ modes: [''], text: { touch: '消したい部分を指でなぞります（交わる線の間が消えます）。終わるときは左の「トリム」をもう一度', pc: '消したい部分をドラッグでなぞります。右クリックで終了' } }] },
    { key: 'EXTEND', title: '↗ 延長', prefix: 'WAITING_EXTEND', steps: [{ modes: [''], text: { touch: '伸ばしたい線の端の近くを指でなぞります。終わるときは左の「延長」をもう一度', pc: '伸ばしたい線の端の近くをドラッグでなぞります' } }] },
    { key: 'OFFSET', title: '◱ オフセット', prefix: 'WAITING_OFFSET_', steps: [
        { modes: ['DIST'], text: 'パネルに距離を入れます' }, { modes: ['SELECT'], text: '平行に写す線をタップ' }, { modes: ['SIDE'], text: 'ずらす側をタップ' }] },
    { key: 'TEXT', title: 'A 文字', prefix: 'WAITING_TEXT_', steps: [{ modes: ['INPUT'], text: 'パネルに文字と大きさを入れます' }, { modes: ['PLACE'], text: '置く位置をタップして ☑確定' }] },
    { key: 'HATCH', title: '塗りつぶし', prefix: 'WAITING_HATCH_', steps: [{ modes: ['SELECT'], text: '塗りつぶす閉じた図形をタップ' }] },
    { key: 'UCS', title: '🎯 UCS', prefix: 'WAITING_UCS_', steps: [
        { modes: ['ORIGIN'], text: '新しい原点をタップ' },
        { modes: ['2P_ORIGIN', '2P_ORIGIN_PREVIEW'], text: '原点にしたい点までなぞって ☑確定' },
        { modes: ['2P_XDIR', '2P_XDIR_PREVIEW'], text: '向きを決める2点目までなぞって ☑確定（原点→この点の向きが横軸になります）' }] },
    { key: 'COGO', title: '📍 点の指定', prefix: 'WAITING_DIMCOGO_', steps: [
        { modes: ['PT'], text: { touch: '点までなぞって（緑の記号＝スナップ）☑確定。続けて次の欄の点を指定します', pc: '点をクリック（測点に吸い付きます）。続けて次の欄の点を指定します' } }] },
    { key: 'COGOLOT', title: '🧮 求積', prefix: 'WAITING_COGO_LOT', steps: [{ modes: [''], text: '求積する区画（閉じたポリライン・長方形）の線か内側をタップ' }] },
    { key: 'LAYOFF', title: '🚫 タッチ非表示', prefix: 'WAITING_LAYOFF', steps: [{ modes: [''], text: '非表示にしたい画層の図形をタップ。終わるときは下の「非表示終了」' }] },
];

let _hintSession = null; // { key, hidden }
function _guideHintFor(mode) {
    return GUIDE_HINTS.find(h => mode.startsWith(h.prefix));
}
function _guideOnModeChange() {
    const mode = (cmdState && cmdState.mode) || 'IDLE';
    document.body.classList.toggle('guide-cmd-active', mode !== 'IDLE');
    _guideTipsOnMode(mode);
    const def = mode === 'IDLE' ? null : _guideHintFor(mode);
    if(!def) { _hintSession = null; _guideHideHint(); return; }
    if(!_hintSession || _hintSession.key !== def.key) {
        if(_tour) { _hintSession = { key: def.key, hidden: true }; } // ツアーのカードが案内するので数えない
        else {
            const cnt = (_guide.hintCounts && _guide.hintCounts[def.key]) || 0;
            const m = guideHintsMode();
            const show = m === 'always' || (m === 'auto' && cnt < GUIDE_HINT_LIMIT);
            _guide.hintCounts = Object.assign({}, _guide.hintCounts, { [def.key]: cnt + 1 });
            _guideSave();
            _hintSession = { key: def.key, hidden: !show };
        }
    }
    if(_hintSession.hidden || _tour) { _guideHideHint(); return; }
    _guideRenderHint(def, mode);
}
function _guideRenderHint(def, mode) {
    const suffix = mode.slice(def.prefix.length);
    const idx = def.steps.findIndex(s => (s.when ? s.when() : (s.modes || []).includes(suffix)));
    if(idx < 0) { _guideHideHint(); return; }
    const el = _guideEl('guide-hint');
    const total = def.steps.length;
    el.innerHTML = `<span class="gh-title">${escapeHtml(def.title)}</span>${total > 1 ? `<span class="gh-step">${idx + 1}/${total}</span>` : ''}
        <div class="gh-text">${escapeHtml(_gt(def.steps[idx].text))}</div>
        <button class="gh-x" title="このコマンドの間は隠す" onclick="guideHideHintForCommand()">✕</button>`;
    el.style.display = 'block';
}
function _guideHideHint() { const el = document.getElementById('guide-hint'); if(el) el.style.display = 'none'; }
window.guideHideHintForCommand = function() { if(_hintSession) _hintSession.hidden = true; _guideHideHint(); };
// 止まっていたとき用: 隠していた手順カードをもう一度出す
function _guideReshowHint() {
    const mode = cmdState.mode, def = _guideHintFor(mode);
    if(!def || _tour || guideHintsMode() === 'off') return;
    _hintSession = { key: def.key, hidden: false };
    _guideRenderHint(def, mode);
}

// ===== つまずいたときの一言 =====
const GUIDE_TIPS = {
    idleDrag: { text: '画面を動かすには、2本指でスライドします（1本指でなぞるのは、位置や座標を読むときです）', max: 3 },
    dimConfirm: { text: '寸法・測定の点は、指を離したあと ☑確定 を押すと決まります', max: 3 },
    stuck: { text: '手順は上の説明のとおりです。やめるときは ❌終了、または同じボタンをもう一度押します', max: 2 },
};
let _tipIdleDrags = [], _tipDimTouches = 0, _tipStuckTimer = null, _tipTimer = null;
function guideShowTip(id) {
    const d = GUIDE_TIPS[id];
    if(!d || _tour || guideHintsMode() === 'off') return false;
    const seen = (_guide.tips && _guide.tips[id]) || 0;
    if(seen >= d.max) return false;
    _guide.tips = Object.assign({}, _guide.tips, { [id]: seen + 1 });
    _guideSave();
    const el = _guideEl('guide-tip');
    el.innerHTML = `💡 ${escapeHtml(d.text)}<button class="gt-x" onclick="this.parentElement.style.display='none'">✕</button>`;
    const ab = document.getElementById('fs-dim-actionbar');
    document.body.classList.toggle('guide-actionbar', !!ab && ab.style.display !== 'none');
    el.style.display = 'block';
    clearTimeout(_tipTimer);
    _tipTimer = setTimeout(() => { el.style.display = 'none'; }, 7000);
    return true;
}
function _guideTipsOnEvent(type) {
    if(type === 'idleDrag') {
        if(!_guideIsTouch()) return;
        const now = Date.now();
        _tipIdleDrags = _tipIdleDrags.filter(t => now - t < 30000).concat(now);
        if(_tipIdleDrags.length >= 2) { _tipIdleDrags = []; guideShowTip('idleDrag'); }
    } else if(type === 'dimTouchEnd') {
        if(cmdState.mode === 'WAITING_DIMMEAS_TO') return; // 測定中は指を離して読むのが正しい使い方
        _tipDimTouches++;
        if(_tipDimTouches >= 2) { _tipDimTouches = 0; guideShowTip('dimConfirm'); }
    }
}
// コマンドの最初の段階（点の指定を待っている）で止まっていたら一言
const _GUIDE_FIRST_STEP = /_(P1|BASE|SELECT|CENTER|ORIGIN|2P_ORIGIN)$/;
function _guideTipsOnMode(mode) {
    _tipDimTouches = 0;
    clearTimeout(_tipStuckTimer);
    if(mode === 'IDLE' || !_GUIDE_FIRST_STEP.test(mode)) return;
    _tipStuckTimer = setTimeout(() => {
        if(cmdState.mode !== mode || _tour) return;
        if(guideShowTip('stuck')) _guideReshowHint();
    }, GUIDE_STUCK_MS);
}

// ===================================================================
// ③ ヘルプ（❓）
// ===================================================================
const GUIDE_TOPICS = [
    { title: '画面の動かし方', tour: 'view', text: { touch: '2本指で広げると拡大、つまむと縮小、2本指のままスライドで移動します。1本指でなぞると、ルーペと座標が出ます。🔍全体 で図面全体を表示します。', pc: 'ホイールで拡大・縮小、ホイール（中ボタン）を押したままドラッグで移動します。🔍全体 で図面全体を表示します。' } },
    { title: '座標を読む（座標読取モード）', tour: 'fullscreen', text: '🎯座標読取 で、図面を広く見ながら座標を読むモードになります。なぞると上に X・Y が出て、指を離しても左上に残ります。X＝北・Y＝東です。' },
    { title: '測る（基点測定・寸法）', tour: 'measure', text: '📐測定 で基点を決めると、そこからの X・Y・直線の距離を出したまま確かめられます。📐記入 で寸法として残せます。寸法は ↔平行・⤢整列・📏連続寸法 でも記入できます。' },
    { title: 'スナップ（点に吸い付く）', tour: 'snap', text: '点の近くでは緑の記号が出て、その点に吸い付きます。OSNAP の ▼ で種類を選び、「次の1点だけ」で種類を絞れます。線の上で少し止めると、線を延ばした先にも吸い付きます。' },
    { title: '図面を開く（DXF・DWG・SIMA・座標CSV）', text: '📁開く から DXF・DWG・SIMA（.sim）・座標CSV を開けます。文字コードは自動で判定します。図面があるときは「置き換える」か「追加する」かを選べます。' },
    { title: '座標一覧・SIMA／CSV 出力', text: '⋯ メニューの 📍座標一覧 で測点を検索し、タップでその点へ移動できます。SIMA 出力・座標CSV 出力 で書き出せます（SIMA は Shift-JIS）。' },
    { title: '測量計算（求積・逆計算・点の追加・交点）', text: '⋯ メニューの 🧮測量計算 で使います。点は 📍 で図面の点をなぞって ☑確定（測点に吸い付きます）、または点名・点番号・「X,Y」を入れます。\n・求積: 区画の線か内側をタップすると、座標法の求積表（倍面積・面積・地積）を出します。📋 求積表を図面に置く、📏 辺長を記入、㎡ 面積を記入、📄 CSV 出力。\n・逆計算: 2点の距離と方向角（度 分 秒）。\n・点の追加: 座標、方向角と距離、後視点と夾角（右回り）から測点を追加します。\n・交点: 2直線・方向角×2・距離×2 の交点を測点として追加します。' },
    { title: '杭打ち（現在地・器械点から案内）', text: '⋯ メニューの 📍杭打ち で使います。範囲選択した測点（無ければすべて）を ◀ ▶ で順に選び、✓済 で次へ進みます。\n・現在地から: スマホの現在地（GNSS）から杭までの距離・向き・北へ／東へ を大きく表示します。🧭 で矢印をスマホの向きに合わせます。GNSS は数 m ずれるので、杭のおおよその場所を探すのに使います。\n・器械点から: 器械点と後視点を指定すると、杭の夾角（後視を 0° とした右回り）・水平距離・方向角を出します。杭打ち表を図面に置く・CSV 出力もできます。' },
    { title: 'トータルステーション（ソキア）との受け渡し', text: '⋯ メニューの 📡TS連携 で使います。\n・ファイル: 機械の現場データ（.sdr。SDR33・SDR2x）を 📁開く で開くと、器械点・後視・観測から座標を計算して測点にします。📄 SDR33 で書き出したファイルは、機械で既知点・杭打ち点として読み込めます（座標一覧からも出力できます）。\n・通信: PC の Chrome・Edge、Android の Chrome では、USB ケーブル・Bluetooth で機械とつなげます。機械で「通信出力（S type・SDR33）」をすると受信して図面に重ね、「図面に取り込む」で測点にします。「📤 測点を送る」は、機械を「既知点 → 通信入力 → S type」にしてから押します。' },
    { title: '現在地（GNSS）', text: '⋯ メニューの 🛰現在地 で、スマホの位置を図面の上に表示します。初回は図面の系番号（平面直角座標）を選びます。精度はスマホの GPS しだい（数m）です。' },
    { title: '保存とオフライン', text: '作業中の図面は自動で保存され、次に開いたときに復元できます。💾保存 で名前を付けて保存し、⋯ の 📂保存一覧 から開けます。一度開けば、電波が無い所でも動きます。' },
    { title: '座標で点を入れる', text: 'コマンド欄に「X,Y」の順（X＝北・Y＝東。画面の座標表示と同じ）で入れます。例: 100,200 → X（北）100・Y（東）200。\n「@5,-3」のように @ を付けると、直前の点から北へ5・西へ3 の点になります。OSNAP の ▼ の「相対入力」では、距離と方向角でも入れられます。' },
    { title: 'パネルの移動', tour: 'panel', text: 'パネルの見出し（⠿ の帯）をつまむと動かせます。ダブルタップで画面の中央に戻ります。' },
    { title: '表示の設定', tour: 'prefs', text: 'オプションの「表示・操作」で、ルーペの大きさ・座標の文字の大きさと桁・寸法の文字・吸着の範囲を変えられます。' },
    { title: '困ったとき', text: '間違えたら ↩（元に戻す）。文字・寸法を長押しすると消えます（通常画面で何もしていないときだけ）。コマンドをやめるときは ❌終了、同じボタンをもう一度、または Esc キー。図面が見えなくなったら 🔍全体。うまく動かないときは オプションの「エラーログ」を見てください。' },
];
const GUIDE_COMMANDS = [
    ['LINE', 'L', '線分'], ['PLINE', 'PL', 'ポリライン'], ['RECTANG', 'REC', '長方形'], ['CIRCLE', 'C', '円'], ['ARC', 'A', '円弧'], ['TEXT', 'T', '文字'],
    ['MOVE', 'M', '移動'], ['COPY', 'CO', '複写'], ['ROTATE', 'RO', '回転'], ['ERASE', 'E', '削除'], ['OFFSET', 'O', 'オフセット'], ['TRIM', 'TR', 'トリム'], ['EXTEND', 'EX', '延長'],
    ['DIMLINEAR', 'DLI', '平行寸法'], ['DIMALIGNED', 'DAL', '整列寸法'], ['DIMCONT', '-', '連続寸法'], ['DIMORDINATE', 'DOR', '座標寸法'], ['MEASURE', 'MEA', '基点測定'],
    ['COORDS', 'ZAHYO', '座標一覧'], ['COGO', 'CALC', '測量計算'], ['AREA', 'AA', '求積'], ['INV', '-', '逆計算'], ['TS', 'SOKKIA', 'TS連携'], ['SDROUT', '-', 'SDR33出力'], ['STAKE', 'KUI', '杭打ち'], ['SIMAOUT', '-', 'SIMA出力'], ['CSVOUT', '-', '座標CSV出力'], ['GNSS', 'GPS', '現在地'], ['UCS', '-', 'UCS（原点）'], ['UCS2P', '-', 'UCS（2点）'],
    ['WCS', '-', 'UCSを戻す'], ['SAVE', '-', '保存'], ['ERRORS', 'ERRLOG', 'エラーログ'],
];

window.showGuideHelp = function() {
    const hm = guideHintsMode();
    const seg = (m, label) => `<button class="prop-btn opt-bg-btn ${hm === m ? 'active' : ''}" style="flex:1;margin-top:0;" onclick="setGuideHintsMode('${m}')">${label}</button>`;
    const topics = GUIDE_TOPICS.map(t => `
        <details class="gh-topic"><summary>${escapeHtml(t.title)}</summary>
            <div class="gh-topic-text">${escapeHtml(_gt(t.text))}</div>
            ${t.tour ? `<button class="prop-btn btn-sub" onclick="startGuideTour('${t.tour}')">▶ やってみる</button>` : ''}
        </details>`).join('');
    const cmds = GUIDE_COMMANDS.map(c => `<tr><td>${c[0]}</td><td>${c[1]}</td><td>${escapeHtml(c[2])}</td></tr>`).join('');
    const doneBasic = _guide.tours && _guide.tours.basic === 'done';
    const html = `
        <div class="gh-sec">ツアー（練習用の図面で操作しながら覚える）</div>
        <button class="prop-btn" onclick="startGuideTour('basic')">🚀 はじめてツアー（約3分）${doneBasic ? ' ✓' : ''}</button>
        <button class="prop-btn btn-sub" onclick="startGuideTour('fullscreen')">🎯 座標読取モードのツアー</button>
        <div class="gh-sec">機能ごとの説明</div>
        ${topics}
        <div class="gh-sec">コマンド一覧（コマンド欄に入力）</div>
        <details class="gh-topic"><summary>一覧を開く</summary><table class="gh-cmds"><tr><th>コマンド</th><th>短縮</th><th>内容</th></tr>${cmds}</table></details>
        <div class="gh-sec">操作中のヒント</div>
        <div style="display:flex;gap:6px;">${seg('auto', '最初の3回')}${seg('always', '常に')}${seg('off', '出さない')}</div>
        <button class="prop-btn btn-sub" onclick="resetGuideHints()">ヒントの回数を最初に戻す</button>`;
    showPropertyPanel('❓ ヘルプ・操作ガイド', html);
};
window.setGuideHintsMode = function(m) {
    if(!['auto', 'always', 'off'].includes(m)) return;
    _guide.hintsMode = m; _guideSave();
    if(m === 'off') _guideHideHint();
    else if(m === 'always' && _hintSession) { _hintSession.hidden = false; _guideOnModeChange(); }
    if(document.getElementById('property-panel-title') && document.getElementById('property-panel-title').textContent.includes('ヘルプ')) showGuideHelp();
};
window.resetGuideHints = function() {
    _guide.hintCounts = {}; _guide.tips = {}; _guideSave();
    if(typeof showToast === 'function') showToast('ヒントをまた最初から出します');
};

// 右下の「？」ボタン（コマンドの途中と全画面では隠す）
(function() {
    const b = _guideEl('guide-help-btn', 'button');
    b.textContent = '？';
    b.title = 'ヘルプ・操作ガイド';
    b.addEventListener('click', () => showGuideHelp());
})();
