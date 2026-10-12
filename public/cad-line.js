// ===== Web CAD 線分（LINE）の点の入れ方 =====
// cad-line.js - 線分コマンドの誤って引いてしまう線（誤爆）を防ぐ。
//
// ・タッチ: 指を離した所を「仮の点」（緑の輪）にし、画面の下の ☑確定 で決める。タップし直すと仮の点が動くので、
//   画面に触れてしまっても線は引かれない。なぞるとルーペで合わせられる（これまでどおり）。
//   オプション「線分のタッチ」を「離したらすぐ」にすると、以前と同じく指を離した所ですぐ決まる
// ・マウスのクリック・コマンド欄の「X,Y」は、これまでどおりすぐ決まる
// ・↶ 1つ戻す（コマンド U も同じ）: このコマンドで引いた最後の線を消し、その始点から引き直す。線が無ければ始点を取り消す
// ・長さ0の線は作らない（同じ点をもう一度押した・同じ点に吸い付いた。タッチは画面で 3px 未満も）
// ・画面の下のバー: ☑確定（仮の点があるとき）・↶ 1つ戻す（始点を決めたあと）・❌ 終了

const LINE_TOUCH_MIN_PX = 3; // タッチで、始点からこれより近い点は線にしない（指の二度押し）

function _isLineMode(m) { return m === 'WAITING_LINE_P1' || m === 'WAITING_LINE_P2'; }
// 線分のタッチを「☑確定で引く」にしているか（初めは入）
function lineTouchConfirmOn() { return typeof displayPrefKey !== 'function' || displayPrefKey('lineTouch') !== 'now'; }

// 線分を始めたとき（cad-command.js の LINE から）
function lineStart() {
    cmdState.lineIds = [];   // このコマンドで引いた線（↶ 1つ戻す で消す順）
    cmdState.lineCand = null; // 仮の点 { x, y }
    cmdState.lineTaps = 0;    // ☑確定 を押さずにタップした回数（一言の案内に使う）
    _lineBar();
}
// 画面の下のバーとプロンプトを今の段階に合わせる
function _lineBar() {
    if(!_isLineMode(cmdState.mode)) return;
    if(typeof showActionbarControls === 'function') showActionbarControls({ hideConfirm: !cmdState.lineCand });
    const ub = document.getElementById('line-undo-btn');
    if(ub) ub.style.display = cmdState.mode === 'WAITING_LINE_P2' ? '' : 'none';
    const c = cmdState.lineCand, first = cmdState.mode === 'WAITING_LINE_P1';
    if(c) setPrompt(first ? '始点: ☑確定 で決める（タップし直すと動きます）' : '次の点: ☑確定 で線を引く（タップし直すと動きます）');
    else if(lineTouchConfirmOn() && typeof isMobile === 'function' && isMobile()) setPrompt(first ? '1点目: タップして ☑確定' : '次の点: タップして ☑確定');
    else setPrompt(first ? '1点目:' : '次の点:');
    lineFloatUpdate(); // 点の横の ☑確定
}

// ほかのコマンドを始める前（processCommand）: 線分が出した下のバーを片付ける（以前は ↶・☑確定 が別のコマンドに残った）。
// 線分のまま続くとき（ZE など途中で使うコマンド・打ち間違い）は、終わったあとに出し直す
function lineBeforeOtherCommand() {
    if(!_isLineMode(cmdState.mode)) return;
    const ub = document.getElementById('line-undo-btn');
    if(ub) ub.style.display = 'none';
    const ab = document.getElementById('fs-dim-actionbar');
    if(ab) {
        ab.style.display = 'none';
        const cb = ab.querySelector('button[onclick="dimConfirmPoint()"]');
        if(cb) cb.style.display = '';
    }
    Promise.resolve().then(() => { if(_isLineMode(cmdState.mode)) _lineBar(); });
}
// ⇄ で候補を替えた・「次の1点だけ」を選んだとき（cad-snap.js）: 仮の点もその候補に置き直す（以前は ☑確定 で古い点が入った）
function lineSnapChanged() {
    if(!cmdState.lineCand || !_isLineMode(cmdState.mode)) return;
    const pt = getInputPoint();
    cmdState.lineCand = { x: pt.x, y: pt.y };
    _lineBar();
    render();
}
// 指を離したとき（cad-input.js）。「☑確定で引く」なら仮の点にして true（線はまだ引かない）
function lineTouchCandidate() {
    if(!_isLineMode(cmdState.mode) || !lineTouchConfirmOn()) return false;
    const pt = getInputPoint();
    cmdState.lineCand = { x: pt.x, y: pt.y };
    cmdState.lineTaps = (cmdState.lineTaps || 0) + 1;
    if(cmdState.lineTaps >= 3 && typeof guideShowTip === 'function') { cmdState.lineTaps = 0; guideShowTip('lineConfirm'); }
    _lineBar();
    render();
    return true;
}
// ☑確定（cad-command.js の dimConfirmPoint から）。線分の段階なら処理して true
function lineConfirmCandidate() {
    if(!_isLineMode(cmdState.mode)) return false;
    const c = cmdState.lineCand;
    if(!c) { if(typeof showToast === 'function') showToast('線の点をタップしてから ☑確定 を押してください', 2500); return true; }
    cmdState.lineCand = null;
    cmdState.lineTaps = 0;
    if(navigator.vibrate) navigator.vibrate(20);
    handlePointInput({ x: c.x, y: c.y }, false);
    _lineBar();
    render();
    return true;
}

// 始点を決めたとき（cad-command.js の _handlePointInputCore から）
function lineSetStart(wcs) {
    cmdState.startWcs = { x: wcs.x, y: wcs.y };
    cmdState.mode = 'WAITING_LINE_P2';
    cmdState.lineCand = null;
    if(!cmdState.lineIds) cmdState.lineIds = [];
    const u = wcsToUcs(wcs.x, wcs.y);
    addCommandLog(`-> 1点目: ${coordPairText(u.x, u.y)}`);
    _lineBar();
    render();
}
// 次の点を決めたとき（同上）。長さ0の線は作らない。fromMouse が false ならタッチ（画面で 3px 未満も作らない）
function lineAddSegment(wcs, fromMouse) {
    const s = cmdState.startWcs;
    cmdState.lineCand = null;
    const d = Math.hypot(wcs.x - s.x, wcs.y - s.y);
    if(d === 0 || (!fromMouse && d * view.scale < LINE_TOUCH_MIN_PX)) {
        addCommandLog('-> 始点と同じ所なので、線は引きませんでした');
        _lineBar();
        render();
        return;
    }
    saveUndo();
    const ln = { type: 'LINE', layer: currentLayerIndex, color: null, x1: s.x, y1: s.y, x2: wcs.x, y2: wcs.y };
    entities.push(ln);
    if(!cmdState.lineIds) cmdState.lineIds = [];
    cmdState.lineIds.push(_idOf(ln));
    const u = wcsToUcs(wcs.x, wcs.y);
    addCommandLog(`-> 線分作成 終点: ${coordPairText(u.x, u.y)}`);
    cmdState.startWcs = { x: wcs.x, y: wcs.y };
    _lineBar();
    render();
}

// ↶ 1つ戻す（画面の下のバー・コマンド U）。線分の段階なら処理して true
function lineUndoStep() {
    if(!_isLineMode(cmdState.mode)) return false;
    cmdState.lineCand = null;
    const ids = cmdState.lineIds || [];
    while(ids.length) {
        const i = entityIndexById(ids.pop());
        if(i < 0) continue; // ほかの操作（↩ など）で消えた線は飛ばす
        const e = entities[i];
        saveUndo();
        entities.splice(i, 1);
        cmdState.startWcs = { x: e.x1, y: e.y1 };
        if(typeof snapSetLastInput === 'function') snapSetLastInput(cmdState.startWcs); // 「@X,Y」も戻した点から（以前は消した線の終点から）
        addCommandLog('-> 最後に引いた線を消しました（その始点から引き直せます）');
        if(typeof showToast === 'function') showToast('↶ 最後に引いた線を消しました', 1800);
        _lineBar();
        render();
        return true;
    }
    if(cmdState.mode === 'WAITING_LINE_P2') {
        cmdState.mode = 'WAITING_LINE_P1';
        cmdState.startWcs = null;
        addCommandLog('-> 始点を取り消しました');
        _lineBar();
        render();
        return true;
    }
    if(typeof notify === 'function') notify('戻せる線はありません', 1800);
    _lineBar(); // 仮の点を消したので、☑確定・案内も合わせる
    render();
    return true;
}
window.lineUndoStep = lineUndoStep;

// ===== 点の横の ☑確定（v5.45。v5.46 で円・寸法・測定・点の指定にも） =====
// 指で決めた点の横に ☑確定 を出す（下のバーの ☑確定 も残す）。オプション「確定ボタンの位置」が「下のバーだけ」なら出さない。
// 出す場面（_floatAnchor）: 線分の仮の点、円の 3点・2点・接線接線半径の仮の円（指で入れたとき）、寸法・測定・測量計算などの点（指を離したあと）。
// 押すと dimConfirmPoint（下のバーの ☑確定 と同じ）
// ・点から LINE_FLOAT_GAP 離し、画面の中央寄りの側（端なら反対側）に置く。指を当て直している間は薄くして押せなくする
// ・出てから LINE_FLOAT_GUARD_MS は押しても反応しない（点を置き直すタップが当たって決まってしまわないよう）
// ・初めて出るときはポップ（UIの動きが入のとき。CSS の .lf-pop）、タップし直したときはその位置へすっと動く
const LINE_FLOAT_GAP = 64;
const LINE_FLOAT_GUARD_MS = 250;
let _lfShownAt = 0;
function lineFloatOn() { return typeof displayPrefKey !== 'function' || displayPrefKey('confirmPos') !== 'bar'; }
function _lineFloatEl() {
    let b = document.getElementById('line-float-confirm');
    if(!b) {
        b = document.createElement('button');
        b.id = 'line-float-confirm';
        b.type = 'button';
        b.textContent = '☑ 確定';
        b.setAttribute('aria-label', 'この点で確定');
        b.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if(Date.now() - _lfShownAt < LINE_FLOAT_GUARD_MS) return; // 出た直後のタップは受けない
            if(typeof window.dimConfirmPoint === 'function') window.dimConfirmPoint(); // 下のバーの ☑確定 と同じ（線分・円・寸法など）
        });
        document.body.appendChild(b);
    }
    return b;
}
function _lineFloatHide() {
    const b = document.getElementById('line-float-confirm');
    if(b && b.style.display !== 'none') { b.style.display = 'none'; b.classList.remove('lf-pop', 'lf-move', 'lf-dim'); }
}
// 置く位置（画面の座標）: 点の中央寄りの側。はみ出すなら反対側、上下もはみ出さないように
function lineFloatPos(px, py, vw, vh) {
    const m = 36;
    let x = px + (px > vw / 2 ? -LINE_FLOAT_GAP : LINE_FLOAT_GAP), y = py + (py > vh / 2 ? -LINE_FLOAT_GAP * 0.6 : LINE_FLOAT_GAP * 0.6);
    if(x < m || x > vw - m) x = px - (x - px);
    return { x: Math.max(m, Math.min(vw - m, x)), y: Math.max(m + 40, Math.min(vh - m - 60, y)) };
}
// 点の横の ☑確定 を置く点（無ければ null）
function _floatAnchor() {
    const m = String(cmdState.mode);
    if(_isLineMode(m)) return cmdState.lineCand || null;
    if(typeof _CIRCLE_NEW_MODES !== 'undefined' && _CIRCLE_NEW_MODES.has(m)) {
        const pv = cmdState.circlePreview;
        if(!pv || !cmdState.circleTouch) return null;
        const p = pv.last || pv.t2 || { x: pv.cx, y: pv.cy };
        return { x: p.x, y: p.y };
    }
    if(m.startsWith('WAITING_DIM') && cmdState.dimTapped && !touchState.down) { const p = getInputPoint(); return p ? { x: p.x, y: p.y } : null; }
    return null;
}
function lineFloatUpdate() {
    const c = _floatAnchor();
    if(!c || !lineFloatOn()) { _lineFloatHide(); return; }
    const b = _lineFloatEl(), p = wcsToScreen(c.x, c.y);
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const vw = window.innerWidth || 800, vh = window.innerHeight || 600;
    const q = lineFloatPos(r.left + p.x, r.top + p.y, vw, vh);
    const first = b.style.display === 'none' || !b.style.display;
    if(first) {
        b.classList.remove('lf-move', 'lf-dim');
        b.style.display = 'block';
        b.classList.remove('lf-pop'); void b.offsetWidth; b.classList.add('lf-pop'); // 初めて出るときだけポップ
        _lfShownAt = Date.now();
    } else if(b.dataset.cx !== String(c.x) || b.dataset.cy !== String(c.y)) {
        b.classList.add('lf-move'); // 点を置き直したら、その横へすっと動く
        _lfShownAt = Date.now();
    }
    b.dataset.cx = String(c.x); b.dataset.cy = String(c.y);
    b.style.left = `${Math.round(q.x)}px`; b.style.top = `${Math.round(q.y)}px`;
    b.classList.toggle('lf-dim', !!touchState.down); // 指で狙い直している間は押せない
}

// 仮の点の印（緑の輪と十字）。描画の最後に重ねる（cad-render.js）。始点からの線は drawRubberBand が仮の点まで描く
function drawLineCandidate() {
    lineFloatUpdate(); // 点の横の ☑確定 も合わせる
    const c = cmdState.lineCand;
    if(!c || !_isLineMode(cmdState.mode)) return;
    const p = wcsToScreen(c.x, c.y);
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = touchState.down ? 0.45 : 1; // 指で狙い直している間は薄く
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - 15, p.y); ctx.lineTo(p.x - 5, p.y); ctx.moveTo(p.x + 5, p.y); ctx.lineTo(p.x + 15, p.y);
    ctx.moveTo(p.x, p.y - 15); ctx.lineTo(p.x, p.y - 5); ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x, p.y + 15); ctx.stroke();
    ctx.restore();
}
// 線分の2点目の仮の線の先（仮の点があり、指で狙い直していなければ仮の点。それ以外はカーソル）
function lineRubberEnd(mp) {
    const c = cmdState.lineCand;
    return (c && !touchState.down) ? c : mp;
}
