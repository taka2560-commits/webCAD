// ===== Web CAD 作図・編集の強化 =====
// cad-edit.js - 鏡像（MIRROR）・尺度変更（SCALE）・配列（ARRAY）・分割（BREAK）・結合（JOIN）・
//               角の処理（FILLET: フィレット・面取り）のコマンドの流れ（対象の選び方・パネル・途中の表示）。
//               形の計算は cad-editgeom.js、頂点のドラッグ編集は cad-grip.js
// （ブラウザでは同じスコープに読み込まれるため、関数・変数はそのまま共有される）

// 図形をタップで選ぶ段階（スナップしない・カーソルの下の図形を強調する）
const EDIT_PICK_MODES = ['WAITING_MIRROR_SELECT', 'WAITING_SCALE_SELECT', 'WAITING_ARRAY_SELECT', 'WAITING_BREAK_SELECT',
    'WAITING_JOIN_SELECT', 'WAITING_FILLET_SELECT', 'WAITING_FILLET_SECOND'];
// 範囲選択でも対象を選べる段階
const EDIT_AREA_MODES = ['WAITING_MIRROR_SELECT', 'WAITING_SCALE_SELECT', 'WAITING_ARRAY_SELECT', 'WAITING_JOIN_SELECT'];
const EDIT_ARRAY_MAX = 20000;   // 配列で一度に作る図形の上限
const EDIT_PREVIEW_MAX = 3000;  // 途中の表示で形を描く図形の上限（多いときは外形の枠だけ）
const EDIT_PROMPT = {
    MIRROR_SELECT: '鏡像: 映す図形を選択', MIRROR_P1: '鏡像: 鏡の線の1点目を指定', MIRROR_P2: '鏡像: 鏡の線の2点目を指定',
    SCALE_SELECT: '尺度変更: 大きさを変える図形を選択', SCALE_BASE: '尺度変更: 基点（動かない点）を指定',
    ARRAY_SELECT: '配列: 並べる図形を選択', ARRAY_RECT: '配列: パネルで数と間隔を決めて「作る」', ARRAY_POLAR: '配列: 中心を指定して「作る」',
    BREAK_SELECT: '分割: 分ける図形を選択', BREAK_DIVIDE: '分割: 等分する図形を選択', BREAK_POINT: '分割: 分ける点を指定',
    JOIN_SELECT: '結合: つなぐ線を選択 → ☑確定',
    FILLET_SELECT: '角の処理: 1本目の線（残す側）を選択', FILLET_SECOND: '角の処理: 2本目の線（残す側）を選択',
};
function editIsPickMode(m) { return EDIT_PICK_MODES.includes(m); }
function editIsAreaSelectMode(m) { return EDIT_AREA_MODES.includes(m); }
// 直交モード・垂線スナップ・相対座標の基準にする点
function editBaseWcs(m) {
    if(m === 'WAITING_MIRROR_P2' && cmdState.mirrorP1) return cmdState.mirrorP1;
    if(m === 'WAITING_GRIP_DEST' && cmdState.grip) return { x: cmdState.grip.x, y: cmdState.grip.y };
    return null;
}

// ===== 共通 =====
// 編集の対象（選んだ図形。写真のピンは除く）
function _editTargets() {
    return (cmdState.selectedIndices || []).filter(i => entities[i] && entities[i].type !== 'PIN');
}
function _editRow(label, inner) { return `<div class="prop-row cogo-row"><div class="prop-label cogo-label">${label}</div>${inner}</div>`; }
function _editSeg(cur, list, fn) {
    return `<div class="cogo-seg">${list.map(([v, t]) => `<button class="prop-btn opt-bg-btn ${cur === v ? 'active' : ''}" onclick="${fn}('${v}')">${t}</button>`).join('')}</div>`;
}
function _editNum(id, key, v, attrs) {
    return `<input class="prop-val" type="number" id="${id}" value="${escapeHtml(String(v === undefined ? '' : v))}" ${attrs || ''} oninput="editSetParam('${key}', this.value)" style="flex:1;min-width:0;">`;
}
function _editNote(t) { return `<div class="cogo-note">${t}</div>`; }
function _editToast(msg) { addCommandLog('-> ' + msg); if(typeof showToast === 'function') showToast(msg, 3500); }
function _editVibrate() { if(navigator.vibrate) navigator.vibrate(20); }
// パネルの値（端末に覚えておく）。変えたら途中の表示を描き直す
window.editSetParam = function(key, val) {
    lastParams[key] = val;
    saveLastParams();
    if(key === 'breakMode' && cmdState.mode === 'WAITING_BREAK_POINT') { cmdState.mode = 'WAITING_BREAK_SELECT'; } // 等分に変えたら選び直し
    if(key === 'breakMode' && cmdState.mode === 'WAITING_BREAK_SELECT') setPrompt(val === 'divide' ? EDIT_PROMPT.BREAK_DIVIDE : EDIT_PROMPT.BREAK_SELECT);
    if(key === 'arrKind' && cmdState.mode === 'WAITING_ARRAY_SET') setPrompt(val === 'polar' ? EDIT_PROMPT.ARRAY_POLAR : EDIT_PROMPT.ARRAY_RECT);
    if(['breakMode', 'arrKind', 'filletMode', 'chamferBy'].includes(key)) _editPanelFor(cmdState.mode);
    render();
};
// 選んだ図形を引き継いで始める（IDLE で選んだ図形があれば次の段階へ、無ければ図形を選ぶ段階へ）
function _editBegin(tool, label, selectMode, nextMode, nextPrompt) {
    if(typeof _adoptIdleHighlight === 'function') _adoptIdleHighlight();
    const sel = nextMode ? _editTargets() : [];
    cmdState.highlightIdx = -1;
    cmdState.selectedIndices = sel;
    setActiveTool(tool);
    const ab = document.getElementById('fs-dim-actionbar'); if(ab) ab.style.display = 'none';
    if(sel.length) {
        cmdState.mode = nextMode; setPrompt(nextPrompt);
        addCommandLog(`-> [${label}] ${sel.length}個の選択を引き継ぎ。${nextPrompt}`);
    } else {
        cmdState.mode = selectMode; setPrompt(EDIT_PROMPT[selectMode.replace('WAITING_', '')]);
        addCommandLog(`-> [${label}] ${EDIT_PROMPT[selectMode.replace('WAITING_', '')]}`);
    }
    _editPanelFor(cmdState.mode);
    render();
}
// 対象の図形をタップで選んだ（グループ選択ONならブロック全体）
function _editPickTargets(nextMode, nextPrompt) {
    const idx = hitTestEntity(mouse.screenX, mouse.screenY);
    if(idx < 0 || entities[idx].type === 'PIN') { addCommandLog('図形が見つかりません'); return false; }
    cmdState.selectedIndices = expandGroupTargets(idx);
    cmdState.highlightIdx = -1;
    cmdState.mode = nextMode; setPrompt(nextPrompt);
    const n = cmdState.selectedIndices.length;
    addCommandLog(`-> ${n > 1 ? `ブロック ${n}個` : '図形'}を選択。${nextPrompt}`);
    render();
    return true;
}
// 範囲選択で選んだ図形（cad-input.js の範囲選択から）。編集コマンドの段階なら受け取って true
function editAreaSelect(selected) {
    const m = cmdState.mode;
    if(!editIsAreaSelectMode(m)) return false;
    const list = selected.filter(i => entities[i] && entities[i].type !== 'PIN');
    cmdState.highlightIdx = -1;
    if(m === 'WAITING_JOIN_SELECT') {
        const cur = new Set(cmdState.selectedIndices || []);
        list.forEach(i => cur.add(i));
        cmdState.selectedIndices = Array.from(cur);
        addCommandLog(`-> ${list.length}個を追加（計 ${cur.size}個）。☑確定 で結合`);
        return true;
    }
    cmdState.selectedIndices = list;
    if(!list.length) return true;
    if(m === 'WAITING_MIRROR_SELECT') { cmdState.mode = 'WAITING_MIRROR_P1'; setPrompt(EDIT_PROMPT.MIRROR_P1); }
    else if(m === 'WAITING_SCALE_SELECT') { cmdState.mode = 'WAITING_SCALE_BASE'; setPrompt(EDIT_PROMPT.SCALE_BASE); }
    else if(m === 'WAITING_ARRAY_SELECT') { _editArrayEnter(); }
    addCommandLog(`-> ${list.length}個を選択。${document.getElementById('command-prompt').textContent}`);
    return true;
}
// cmdState[prop] に図形の番号を覚える（内部はID。元に戻すなどで配列が変わっても同じ図形を指し、消えたら undefined）
function _editRef(prop, idx) {
    const d = Object.getOwnPropertyDescriptor(cmdState, prop);
    if(!d || !d.get) _defineEntityRef(cmdState, prop, undefined);
    cmdState[prop] = idx;
}
// 図形 idx を list に置き換える（同じ場所に入れて、描く順を保つ）
function _editReplace(idx, list) {
    entities.splice(idx, 1, ...list);
    _bumpGeomEpoch();
}
// 段階に合った設定パネル
function _editPanelFor(m) {
    if(!m) return;
    if(m.startsWith('WAITING_MIRROR_')) _editMirrorPanel();
    else if(m.startsWith('WAITING_SCALE_')) _editScalePanel();
    else if(m === 'WAITING_ARRAY_SET') _editArrayPanel();
    else if(m === 'WAITING_ARRAY_SELECT') hidePropertyPanel(); // 並べ方は、図形を選んでから出す
    else if(m.startsWith('WAITING_BREAK_')) _editBreakPanel();
    else if(m.startsWith('WAITING_FILLET_')) _editFilletPanel();
    else if(m === 'WAITING_JOIN_SELECT') _editJoinPanel();
}

// ===== 鏡像 =====
function _editMirrorPanel() {
    const keep = lastParams.mirrorKeep !== false;
    showPropertyPanel('⇋ 鏡像',
        `<label class="edit-chk"><input type="checkbox" ${keep ? 'checked' : ''} onchange="editSetParam('mirrorKeep', this.checked)"> 元の図形を残す（映した複写を作る）</label>` +
        _editNote('図形を選ぶ → 鏡の線の1点目 → 2点目。文字は裏返さず、読める向きのまま映します。'));
}
function editDoMirror(p1, p2) {
    const idxs = _editTargets();
    if(!idxs.length) { addCommandLog('鏡像: 対象がありません'); resetCommand(); return false; }
    if(Math.hypot(p2.x - p1.x, p2.y - p1.y) <= 1e-9 * (Math.abs(p1.x) + Math.abs(p1.y) + 1)) { _editToast('鏡の線の2点目は、1点目と違う点にしてください'); return false; }
    const keep = lastParams.mirrorKeep !== false;
    const T = editMirrorXform(p1, p2);
    saveUndo();
    if(keep) { const gm = {}; idxs.map(i => editTransformEntity(editCloneEntity(entities[i], gm), T)).forEach(c => entities.push(c)); }
    else idxs.forEach(i => editTransformEntity(entities[i], T));
    addCommandLog(`-> 鏡像: ${idxs.length}個を${keep ? '映して複写しました' : '映しました'}`);
    _editVibrate();
    resetCommand();
    return true;
}

// ===== 尺度変更 =====
function _editScaleK() { const k = parseFloat(lastParams.scaleK || '2'); return (k > 0 && isFinite(k)) ? k : NaN; }
function _editScalePanel() {
    showPropertyPanel('⤢ 尺度変更',
        _editRow('倍率', `<input class="prop-val" type="number" id="edit-scale-k" value="${escapeHtml(String(lastParams.scaleK || '2'))}" min="0" step="any" oninput="editScaleInput('k')" style="flex:1;min-width:0;">`) +
        _editRow('長さで', `<input class="prop-val" type="number" id="edit-scale-from" placeholder="今の長さ" step="any" oninput="editScaleInput('len')" style="flex:1;min-width:0;"><span>→</span>` +
            `<input class="prop-val" type="number" id="edit-scale-to" placeholder="新しい長さ" step="any" oninput="editScaleInput('len')" style="flex:1;min-width:0;">`) +
        _editNote('図形を選ぶ → 基点（動かない点）をタップすると、基点を中心に倍率ぶん大きさを変えます。「長さで」に今の長さと新しい長さを入れると、倍率を求めます。'));
}
window.editScaleInput = function(src) {
    const kEl = document.getElementById('edit-scale-k');
    if(src === 'len') {
        const a = parseFloat((document.getElementById('edit-scale-from') || {}).value), b = parseFloat((document.getElementById('edit-scale-to') || {}).value);
        if(a > 0 && b > 0 && kEl) kEl.value = String(+(b / a).toPrecision(12));
    }
    if(kEl) { lastParams.scaleK = kEl.value; saveLastParams(); }
    render();
};
function editDoScale(base) {
    const idxs = _editTargets(), k = _editScaleK();
    if(!idxs.length) { addCommandLog('尺度変更: 対象がありません'); resetCommand(); return false; }
    if(!(k > 0)) { _editToast('倍率を 0 より大きい数にしてください'); return false; }
    saveUndo();
    const T = editScaleXform(base, k);
    idxs.forEach(i => editTransformEntity(entities[i], T));
    addCommandLog(`-> 尺度変更: ${idxs.length}個を ${k}倍にしました`);
    _editVibrate();
    resetCommand();
    return true;
}

// ===== 配列 =====
function _editNice(v) {
    if(!(v > 0) || !isFinite(v)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return +((m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p).toPrecision(6);
}
function _editArrayOpts() {
    return {
        kind: lastParams.arrKind === 'polar' ? 'polar' : 'rect',
        cols: Math.max(1, Math.floor(parseFloat(lastParams.arrCols) || 1)), rows: Math.max(1, Math.floor(parseFloat(lastParams.arrRows) || 1)),
        dx: parseFloat(lastParams.arrDX), dy: parseFloat(lastParams.arrDY),
        n: Math.max(2, Math.floor(parseFloat(lastParams.arrN) || 2)), ang: parseFloat(lastParams.arrAng === undefined ? '360' : lastParams.arrAng),
        rot: lastParams.arrRot !== false,
    };
}
function _editArrayEnter() {
    const b = editBoundsOf(_editTargets().map(i => entities[i]));
    if(lastParams.arrCols === undefined) { lastParams.arrCols = '3'; lastParams.arrRows = '1'; lastParams.arrN = '6'; lastParams.arrAng = '360'; }
    if(!isFinite(parseFloat(lastParams.arrDX)) || !isFinite(parseFloat(lastParams.arrDY))) {
        // 初めてのときは、選んだ図形の大きさの約1.5倍（切りのよい値）
        const s = b ? _editNice(Math.max(b.maxX - b.minX, b.maxY - b.minY) * 1.5) : suggestLengthForScreen(80);
        lastParams.arrDX = String(s); lastParams.arrDY = String(s);
    }
    saveLastParams();
    cmdState.mode = 'WAITING_ARRAY_SET';
    setPrompt(_editArrayOpts().kind === 'polar' ? EDIT_PROMPT.ARRAY_POLAR : EDIT_PROMPT.ARRAY_RECT);
    _editArrayPanel();
    if(typeof showActionbarControls === 'function') showActionbarControls({}); // ☑確定 で作る
    render();
}
function _editArrayPanel() {
    const o = _editArrayOpts();
    let h = _editSeg(o.kind, [['rect', '▦ 縦横に並べる'], ['polar', '◎ 円形に並べる']], 'editArrayKind');
    if(o.kind === 'rect') {
        h += _editRow('横（→）の数', _editNum('edit-ar-cols', 'arrCols', o.cols, 'min="1" step="1"')) +
            _editRow('横の間隔', _editNum('edit-ar-dx', 'arrDX', lastParams.arrDX, 'step="any"')) +
            _editRow('縦（↑）の数', _editNum('edit-ar-rows', 'arrRows', o.rows, 'min="1" step="1"')) +
            _editRow('縦の間隔', _editNum('edit-ar-dy', 'arrDY', lastParams.arrDY, 'step="any"')) +
            _editNote('元の図形を左下の1つとして、右（→）・上（↑）へ並べます（UCS の向き）。間隔をマイナスにすると左・下へ並べます。');
    } else {
        h += _editRow('数（元を含む）', _editNum('edit-ar-n', 'arrN', o.n, 'min="2" step="1"')) +
            _editRow('角度（左回り）', _editNum('edit-ar-ang', 'arrAng', lastParams.arrAng === undefined ? '360' : lastParams.arrAng, 'step="any"')) +
            `<label class="edit-chk"><input type="checkbox" ${o.rot ? 'checked' : ''} onchange="editSetParam('arrRot', this.checked)"> 図形も回す</label>` +
            _editRow('中心', `<div id="edit-ar-center" style="flex:1;font-size:12px;">${cmdState.arrayCenter ? '指定済み（タップで変更）' : '<span style="color:#ffcc00;">図面でタップ</span>'}</div>`) +
            _editNote('中心を図面でタップし、角度の中に数ぶん並べます（360° なら一周に等間隔）。');
    }
    h += '<button class="prop-btn" onclick="editArrayCommit()">✓ 配列を作る</button>';
    showPropertyPanel('▦ 配列', h);
}
window.editArrayKind = function(kind) { editSetParam('arrKind', kind === 'polar' ? 'polar' : 'rect'); };
// 配列の各複写の写し方（元の位置を除く）。返り値: 相似変換の配列 または { error }
function editArrayXforms(o, idxs, center) {
    const out = [];
    if(o.kind === 'rect') {
        if(!isFinite(o.dx) || !isFinite(o.dy)) return { error: '間隔を入れてください' };
        const A = (typeof ucs !== 'undefined' && ucs.angle) || 0, ux = { x: Math.cos(A), y: Math.sin(A) }, uy = { x: -Math.sin(A), y: Math.cos(A) };
        for(let r = 0; r < o.rows; r++) for(let c = 0; c < o.cols; c++) {
            if(!r && !c) continue;
            out.push(editMoveXform(c * o.dx * ux.x + r * o.dy * uy.x, c * o.dx * ux.y + r * o.dy * uy.y));
        }
        return out;
    }
    if(!center) return { error: '中心を図面でタップしてください' };
    if(!isFinite(o.ang) || o.ang === 0) return { error: '角度を入れてください' };
    const full = Math.abs(o.ang) >= 360 - 1e-9;
    const step = (full ? 360 * Math.sign(o.ang) / o.n : o.ang / (o.n - 1)) * Math.PI / 180;
    const b = editBoundsOf(idxs.map(i => entities[i]));
    const ref = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : center;
    for(let i = 1; i < o.n; i++) {
        const R = editRotateXform(center, step * i);
        if(o.rot) out.push(R);
        else { const q = editXformPoint(R, ref.x, ref.y); out.push(editMoveXform(q.x - ref.x, q.y - ref.y)); }
    }
    return out;
}
window.editArrayCommit = function() {
    if(cmdState.mode === 'WAITING_ARRAY_SELECT') { _editToast('先に、並べる図形を選んでください'); return false; }
    if(cmdState.mode !== 'WAITING_ARRAY_SET') return false;
    const idxs = _editTargets();
    if(!idxs.length) { addCommandLog('配列: 対象がありません'); resetCommand(); return false; }
    const Ts = editArrayXforms(_editArrayOpts(), idxs, cmdState.arrayCenter);
    if(Ts.error) { _editToast(Ts.error); return false; }
    if(!Ts.length) { _editToast('数を 2 以上にしてください'); return false; }
    if(Ts.length * idxs.length > EDIT_ARRAY_MAX) { _editToast(`多すぎます（${Ts.length * idxs.length}個。一度に ${EDIT_ARRAY_MAX}個まで）`); return false; }
    saveUndo();
    const src = idxs.map(i => entities[i]);
    Ts.forEach(T => { const gm = {}; src.forEach(e => entities.push(editTransformEntity(editCloneEntity(e, gm), T))); });
    addCommandLog(`-> 配列: ${Ts.length * src.length}個を作りました（${Ts.length + 1}か所）`);
    _editVibrate();
    resetCommand();
    return true;
};

// ===== 分割 =====
function _editBreakPanel() {
    const div = lastParams.breakMode === 'divide';
    showPropertyPanel('✂ 分割',
        _editSeg(div ? 'divide' : 'point', [['point', '点で分ける'], ['divide', '等分する']], 'editBreakMode') +
        (div ? _editRow('分ける数', _editNum('edit-br-n', 'breakN', lastParams.breakN || '2', 'min="2" step="1"')) : '') +
        _editNote(div ? '線・円弧・円・ポリライン・長方形をタップすると、同じ長さに分けます（閉じた形は始点から）。'
            : '分ける図形をタップ → 分ける点を指定します（交点・端点などに吸い付きます）。閉じた形は、その点で開いた1本になります。'));
}
window.editBreakMode = function(mode) { editSetParam('breakMode', mode === 'divide' ? 'divide' : 'point'); };
function _editBreakTap() {
    const idx = hitTestEntity(mouse.screenX, mouse.screenY);
    if(idx < 0) { addCommandLog('図形が見つかりません'); return; }
    const e = entities[idx];
    if(lastParams.breakMode === 'divide') {
        const n = Math.floor(parseFloat(lastParams.breakN || '2'));
        const r = editDivide(e, n);
        if(r.error) { _editToast(r.error); return; }
        saveUndo();
        _editReplace(idx, r);
        addCommandLog(`-> 分割: ${n}等分しました`);
        _editVibrate(); render();
        return;
    }
    if(!['LINE', 'ARC', 'PLINE', 'RECTANG'].includes(e.type)) { _editToast(e.type === 'CIRCLE' ? '円は1点では分けられません（「等分する」か、トリムを使います）' : 'この図形は分けられません（線・円弧・ポリライン・長方形）'); return; }
    _editRef('breakTarget', idx);
    cmdState.mode = 'WAITING_BREAK_POINT'; setPrompt(EDIT_PROMPT.BREAK_POINT);
    addCommandLog('-> ' + EDIT_PROMPT.BREAK_POINT);
    render();
}
function editDoBreak(wcs) {
    const idx = cmdState.breakTarget;
    if(!(idx >= 0) || !entities[idx]) { cmdState.mode = 'WAITING_BREAK_SELECT'; setPrompt(EDIT_PROMPT.BREAK_SELECT); return false; }
    const r = editSplitAt(entities[idx], wcs.x, wcs.y);
    if(r.error) { _editToast(r.error); return false; }
    saveUndo();
    _editReplace(idx, r);
    addCommandLog(r.length > 1 ? '-> 分割: 2つに分けました' : '-> 分割: 閉じた形をその点で開きました');
    _editVibrate();
    cmdState.breakTarget = undefined;
    cmdState.mode = 'WAITING_BREAK_SELECT'; setPrompt(EDIT_PROMPT.BREAK_SELECT);
    render();
    return true;
}

// ===== 結合 =====
function _editJoinPanel() {
    showPropertyPanel('🔗 結合', _editNote('つなぐ線をタップすると、端がつながった線（分かれ道まで）をまとめて選びます。もう一度タップで外し、範囲選択で足せます。☑確定 で、線・開いたポリラインは1本のポリライン（一周すれば閉じた形、一直線なら1本の線）に、同じ円の上の円弧は1つの円弧にします。'));
}
function _editJoinTap() {
    const idx = hitTestEntity(mouse.screenX, mouse.screenY);
    if(idx < 0) { addCommandLog('図形が見つかりません'); return; }
    const e = entities[idx], sel = new Set(cmdState.selectedIndices || []);
    if(sel.has(idx)) { sel.delete(idx); cmdState.selectedIndices = Array.from(sel); addCommandLog(`-> 選択から外しました（計 ${sel.size}個）`); render(); return; }
    if(!editJoinPath(e) && e.type !== 'ARC') { _editToast('結合できるのは、線・開いたポリライン・円弧です'); return; }
    const chain = e.type === 'ARC' ? [idx] : editJoinChainFrom(idx, editJoinTol());
    chain.forEach(i => sel.add(i));
    cmdState.selectedIndices = Array.from(sel);
    cmdState.highlightIdx = -1;
    addCommandLog(`-> ${chain.length}本を選択（計 ${sel.size}個）。☑確定 で結合`);
    render();
}
function editDoJoin() {
    const idxs = _editTargets();
    if(idxs.length < 2) { _editToast('結合する図形を2つ以上選んでください'); return false; }
    const plan = editJoinPlan(idxs, editJoinTol());
    if(!plan.made.length) { _editToast('つながった図形がありません（端が離れているか、結合できない図形です）'); return false; }
    saveUndo();
    // 結合した図形は、元の図形のうち一番前の位置に入れる（描く順を保つ）
    const removed = new Set(), at = new Map();
    plan.made.forEach(m => { m.items.forEach(i => removed.add(i)); at.set(Math.min(...m.items), m.entity); });
    const next = [];
    entities.forEach((e, i) => { if(at.has(i)) next.push(at.get(i)); else if(!removed.has(i)) next.push(e); });
    entities.length = 0;
    next.forEach(e => entities.push(e));
    _bumpGeomEpoch();
    addCommandLog(`-> 結合: ${removed.size}個を ${plan.made.length}個にしました${plan.skipped ? `（つながらない ${plan.skipped}個はそのまま）` : ''}`);
    _editVibrate();
    cmdState.selectedIndices = [];
    render();
    return true;
}

// ===== 角の処理（フィレット・面取り） =====
function _editFilletOpts() {
    return { mode: lastParams.filletMode === 'chamfer' ? 'chamfer' : 'fillet', radius: parseFloat(lastParams.filletR || '0') || 0,
        dist: parseFloat(lastParams.chamferD || '0') || 0, by: lastParams.chamferBy === 'base' ? 'base' : 'leg' };
}
function _editFilletPanel() {
    const o = _editFilletOpts();
    let h = _editSeg(o.mode, [['fillet', '⌒ 丸める'], ['chamfer', '◸ 面取り（隅切り）']], 'editFilletMode');
    if(o.mode === 'fillet') {
        h += _editRow('半径', _editNum('edit-fl-r', 'filletR', lastParams.filletR || '0', 'min="0" step="any"')) +
            _editNote('2本の線の、残す側をタップします。半径 0 は、線を延ばす・切って角を出します。');
    } else {
        h += _editRow('長さ', _editNum('edit-fl-d', 'chamferD', lastParams.chamferD || '', 'min="0" step="any" placeholder="例: 2"')) +
            _editRow('長さの測り方', _editSeg(o.by, [['leg', '角から両側'], ['base', '底辺（切る線）']], 'editChamferBy')) +
            _editNote('2本の線の残す側をタップするか、ポリライン・長方形の角をタップします。「角から両側」は角から両方の線に沿った長さ、「底辺」は切る線（二等辺三角形の底辺）の長さです。');
    }
    showPropertyPanel('⌒ 角の処理', h);
}
window.editFilletMode = function(mode) { editSetParam('filletMode', mode === 'chamfer' ? 'chamfer' : 'fillet'); };
window.editChamferBy = function(by) { editSetParam('chamferBy', by === 'base' ? 'base' : 'leg'); };
// 1本目: 線ならその線と選んだ点を覚える。ポリライン・長方形なら、その角をすぐ面取りする
function _editFilletFirst(wcs) {
    const idx = hitTestEntity(mouse.screenX, mouse.screenY);
    if(idx < 0) { addCommandLog('図形が見つかりません'); return; }
    const e = entities[idx], o = _editFilletOpts();
    if(e.type === 'LINE') {
        _editRef('filletFirst', idx); cmdState.filletTap = { x: wcs.x, y: wcs.y };
        cmdState.mode = 'WAITING_FILLET_SECOND'; setPrompt(EDIT_PROMPT.FILLET_SECOND);
        addCommandLog('-> 1本目を選択。' + EDIT_PROMPT.FILLET_SECOND);
        render();
        return;
    }
    if(e.type === 'RECTANG' || (e.type === 'PLINE' && e.points && e.points.length >= 3)) {
        if(o.mode !== 'chamfer') { _editToast(o.radius > 0 ? 'ポリラインの角は面取りだけできます（丸めるときは、線を2本選びます）' : 'ポリラインの角は、すでに角です'); return; }
        const closed = e.type === 'RECTANG' || !!e.closed;
        const pts = e.type === 'RECTANG' ? _editRectPoints(e) : e.points;
        const v = editNearestCorner(pts, closed, wcs.x, wcs.y);
        const r = v >= 0 ? editChamferVertex(pts, closed, v, o) : { error: '角が見つかりません' };
        if(r.error) { _editToast(r.error); return; }
        saveUndo();
        const n = _editPiece(e, { type: 'PLINE', points: r.points, closed });
        delete n.x1; delete n.y1; delete n.x2; delete n.y2;
        n.id = e.id; // 同じ図形のまま形だけ変える
        entities[idx] = n;
        _bumpGeomEpoch();
        addCommandLog(`-> 面取り: 角から ${dimFormat(r.legs)} の所で切りました`);
        _editVibrate(); render();
        return;
    }
    _editToast('線（またはポリライン・長方形の角）を選んでください');
}
function editDoFillet(wcs) {
    const i1 = cmdState.filletFirst, idx = hitTestEntity(mouse.screenX, mouse.screenY);
    const e1 = entities[i1];
    if(!e1) { cmdState.mode = 'WAITING_FILLET_SELECT'; setPrompt(EDIT_PROMPT.FILLET_SELECT); return false; }
    if(idx < 0) { addCommandLog('図形が見つかりません'); return false; }
    if(idx === i1) { _editToast('1本目とは別の線を選んでください'); return false; }
    const e2 = entities[idx];
    if(e2.type !== 'LINE') { _editToast('線（LINE）を選んでください'); return false; }
    const o = _editFilletOpts();
    const r = editFilletLines(e1, cmdState.filletTap, e2, wcs, o);
    if(r.error) { _editToast(r.error); return false; }
    saveUndo();
    Object.assign(e1, r.l1); Object.assign(e2, r.l2);
    delete e1.bbox; delete e2.bbox;
    const base = { layer: e1.layer, color: e1.color === undefined ? null : e1.color };
    if(r.arc) entities.push(Object.assign({ type: 'ARC' }, base, r.arc));
    if(r.seg) entities.push(Object.assign({ type: 'LINE' }, base, r.seg));
    _bumpGeomEpoch();
    addCommandLog(r.arc ? `-> フィレット: 半径 ${dimFormat(r.arc.radius)} で丸めました` : r.seg ? `-> 面取り: 角から ${dimFormat(r.legs)} の所で切りました` : '-> 角を出しました');
    _editVibrate();
    cmdState.filletFirst = undefined; cmdState.filletTap = null;
    cmdState.mode = 'WAITING_FILLET_SELECT'; setPrompt(EDIT_PROMPT.FILLET_SELECT);
    render();
    return true;
}

// ===== 点の入力・☑確定・コマンド =====
// 点の入力（cad-command.js の _handlePointInputCore から）。編集コマンドの段階なら処理して true
function handleEditPointInput(m, wcs) {
    switch(m) {
    case 'WAITING_MIRROR_SELECT': _editPickTargets('WAITING_MIRROR_P1', EDIT_PROMPT.MIRROR_P1); return true;
    case 'WAITING_MIRROR_P1':
        cmdState.mirrorP1 = { x: wcs.x, y: wcs.y };
        cmdState.mode = 'WAITING_MIRROR_P2'; setPrompt(EDIT_PROMPT.MIRROR_P2);
        addCommandLog('-> 1点目を指定。' + EDIT_PROMPT.MIRROR_P2); render();
        return true;
    case 'WAITING_MIRROR_P2': editDoMirror(cmdState.mirrorP1, wcs); return true;
    case 'WAITING_SCALE_SELECT': _editPickTargets('WAITING_SCALE_BASE', EDIT_PROMPT.SCALE_BASE); return true;
    case 'WAITING_SCALE_BASE': editDoScale(wcs); return true;
    case 'WAITING_ARRAY_SELECT': if(_editPickTargets('WAITING_ARRAY_SET', _editArrayOpts().kind === 'polar' ? EDIT_PROMPT.ARRAY_POLAR : EDIT_PROMPT.ARRAY_RECT)) _editArrayEnter(); return true;
    case 'WAITING_ARRAY_SET':
        if(_editArrayOpts().kind === 'polar') {
            cmdState.arrayCenter = { x: wcs.x, y: wcs.y };
            addCommandLog('-> 中心を指定。☑確定（または「作る」）で配列を作ります');
            _editArrayPanel(); render();
        } else addCommandLog('-> 縦横に並べるときは、点の指定は要りません。パネルで数と間隔を決めて「作る」');
        return true;
    case 'WAITING_BREAK_SELECT': _editBreakTap(); return true;
    case 'WAITING_BREAK_POINT': editDoBreak(wcs); return true;
    case 'WAITING_JOIN_SELECT': _editJoinTap(); return true;
    case 'WAITING_FILLET_SELECT': _editFilletFirst(wcs); return true;
    case 'WAITING_FILLET_SECOND': editDoFillet(wcs); return true;
    }
    return false;
}
// 画面下の ☑確定（cad-command.js の dimConfirmPoint から）。編集コマンドの段階なら処理して true
function editConfirm() {
    if(cmdState.mode === 'WAITING_JOIN_SELECT') { editDoJoin(); return true; }
    if(cmdState.mode === 'WAITING_ARRAY_SET') { editArrayCommit(); return true; }
    return false;
}
// コマンド文字列（cad-command.js の processCommand から）。処理したら true
function processEditCommand(cmd) {
    const m = cmdState.mode;
    if(/^-?\d+(\.\d+)?$/.test(cmd)) {
        const v = parseFloat(cmd);
        if(m === 'WAITING_SCALE_SELECT' || m === 'WAITING_SCALE_BASE') {
            if(!(v > 0)) { addCommandLog('倍率は 0 より大きい数です'); return true; }
            lastParams.scaleK = String(v); saveLastParams(); _editScalePanel();
            addCommandLog(`-> 倍率 ${v}`); render();
            return true;
        }
        if(m.startsWith('WAITING_FILLET_')) {
            if(v < 0) { addCommandLog('0 以上の数を入れてください'); return true; }
            const key = _editFilletOpts().mode === 'chamfer' ? 'chamferD' : 'filletR';
            lastParams[key] = String(v); saveLastParams(); _editFilletPanel();
            addCommandLog(`-> ${key === 'chamferD' ? '面取りの長さ' : '半径'} ${v}`);
            return true;
        }
        if(m.startsWith('WAITING_BREAK_') && lastParams.breakMode === 'divide') {
            lastParams.breakN = String(Math.floor(v)); saveLastParams(); _editBreakPanel();
            addCommandLog(`-> 分ける数 ${Math.floor(v)}`);
            return true;
        }
        return false;
    }
    if(cmd === 'MI' || cmd === 'MIRROR') { _editBegin('MIRROR', '鏡像', 'WAITING_MIRROR_SELECT', 'WAITING_MIRROR_P1', EDIT_PROMPT.MIRROR_P1); return true; }
    if(cmd === 'SC' || cmd === 'SCALE') { _editBegin('SCALE', '尺度変更', 'WAITING_SCALE_SELECT', 'WAITING_SCALE_BASE', EDIT_PROMPT.SCALE_BASE); return true; }
    if(cmd === 'AR' || cmd === 'ARRAY') {
        cmdState.arrayCenter = null;
        _editBegin('ARRAY', '配列', 'WAITING_ARRAY_SELECT', 'WAITING_ARRAY_SET', '');
        if(cmdState.mode === 'WAITING_ARRAY_SET') _editArrayEnter();
        return true;
    }
    if(cmd === 'BR' || cmd === 'BREAK' || cmd === 'DIV' || cmd === 'DIVIDE') {
        if(cmd === 'DIV' || cmd === 'DIVIDE') { lastParams.breakMode = 'divide'; saveLastParams(); }
        _editBegin('BREAK', '分割', 'WAITING_BREAK_SELECT', null, '');
        if(lastParams.breakMode === 'divide') setPrompt(EDIT_PROMPT.BREAK_DIVIDE);
        return true;
    }
    if(cmd === 'J' || cmd === 'JOIN') {
        // 2つ以上選んでいれば、そのまま結合する。1つなら、それにつながった線を選んだ状態で始める
        if(typeof _adoptIdleHighlight === 'function') _adoptIdleHighlight();
        const sel = _editTargets();
        _editBegin('JOIN', '結合', 'WAITING_JOIN_SELECT', null, '');
        if(sel.length === 1 && editJoinPath(entities[sel[0]])) cmdState.selectedIndices = editJoinChainFrom(sel[0], editJoinTol());
        else cmdState.selectedIndices = sel;
        if(typeof showActionbarControls === 'function') showActionbarControls({});
        if(sel.length >= 2 && editDoJoin()) { resetCommand(); return true; } // 選んでから結合したときは1回で終わる
        render();
        return true;
    }
    if(cmd === 'F' || cmd === 'FILLET' || cmd === 'CHA' || cmd === 'CHAMFER') {
        // FILLET は前に使った処理（丸める・面取り）のまま。CHAMFER は面取りで始める
        if(cmd === 'CHA' || cmd === 'CHAMFER') { lastParams.filletMode = 'chamfer'; saveLastParams(); }
        _editBegin('FILLET', '角の処理', 'WAITING_FILLET_SELECT', null, '');
        return true;
    }
    return false;
}

// ===== 途中の表示 =====
// 図形の形を色 col で描く（寸法も。途中の表示用の複写に使う）
function editDrawShape(c, col) {
    if(c.type !== 'DIMENSION') { drawOneEntity(c, col); return; }
    const f = { LINEAR: drawDimLinear, ALIGNED: drawDimAligned, RADIUS: drawDimRadius, DIAMETER: drawDimDiameter, ANGULAR: drawDimAngular, ORDINATE: drawDimOrdinate }[c.subType];
    if(f) f(c, col);
}
// 変形したあとの形を点線で重ねる（多いときは外形の枠だけ）
function _editDrawPreview(idxs, Ts) {
    const src = idxs.map(i => entities[i]).filter(Boolean);
    if(!src.length || !Ts.length) return;
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
    const col = '#ffff00';
    if(src.length * Ts.length <= EDIT_PREVIEW_MAX) {
        Ts.forEach(T => src.forEach(e => editDrawShape(_editXformShape(JSON.parse(JSON.stringify(e)), T), col)));
    } else {
        const b = editBoundsOf(src);
        if(b) Ts.forEach(T => {
            const q = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]].map(([x, y]) => { const p = editXformPoint(T, x, y); return wcsToScreen(p.x, p.y); });
            ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); for(let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y); ctx.closePath(); ctx.stroke();
        });
    }
    ctx.restore();
}
function _editMark(p, color) {
    const s = wcsToScreen(p.x, p.y);
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x - 9, s.y); ctx.lineTo(s.x + 9, s.y); ctx.moveTo(s.x, s.y - 9); ctx.lineTo(s.x, s.y + 9); ctx.stroke();
    ctx.restore();
}
function drawEditOverlay() {
    const m = cmdState.mode;
    if(!m || m === 'IDLE') return;
    if(m === 'WAITING_MIRROR_P2' && cmdState.mirrorP1) {
        const p1 = cmdState.mirrorP1, p2 = getInputPoint();
        if(Math.hypot(p2.x - p1.x, p2.y - p1.y) > 1e-12) {
            // 鏡の線（画面の端まで）
            const a = wcsToScreen(p1.x, p1.y), b = wcsToScreen(p2.x, p2.y), L = Math.hypot(b.x - a.x, b.y - a.y) || 1, far = (canvas.width + canvas.height) / L;
            ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([8, 4, 2, 4]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x - (b.x - a.x) * far, a.y - (b.y - a.y) * far); ctx.lineTo(a.x + (b.x - a.x) * far, a.y + (b.y - a.y) * far); ctx.stroke();
            ctx.restore();
            _editDrawPreview(_editTargets(), [editMirrorXform(p1, p2)]);
        }
    } else if(m === 'WAITING_SCALE_BASE') {
        const k = _editScaleK();
        if(k > 0) _editDrawPreview(_editTargets(), [editScaleXform(getInputPoint(), k)]);
    } else if(m === 'WAITING_ARRAY_SET') {
        const o = _editArrayOpts(), idxs = _editTargets();
        if(o.kind === 'polar' && cmdState.arrayCenter) _editMark(cmdState.arrayCenter, '#00ff88');
        const Ts = editArrayXforms(o, idxs, cmdState.arrayCenter);
        if(Array.isArray(Ts) && Ts.length * idxs.length <= EDIT_ARRAY_MAX) _editDrawPreview(idxs, Ts);
    } else if(m === 'WAITING_BREAK_POINT') {
        const e = entities[cmdState.breakTarget];
        if(e) {
            drawOneEntity(e, '#00ff88');
            const p = getInputPoint(), r = editSplitAt(e, p.x, p.y);
            if(Array.isArray(r) && r[0]) {
                const q = r[0].type === 'LINE' ? { x: r[0].x2, y: r[0].y2 } : r[0].type === 'ARC' ? { x: r[0].cx + r[0].radius * Math.cos(r[0].endAngle), y: r[0].cy + r[0].radius * Math.sin(r[0].endAngle) }
                    : r[0].points[r.length > 1 ? r[0].points.length - 1 : 0];
                _editMark(q, '#ffff00');
            }
        }
    } else if(m === 'WAITING_FILLET_SECOND') {
        const e1 = entities[cmdState.filletFirst];
        if(!e1) return;
        ctx.save(); ctx.lineWidth = 2; drawOneEntity(e1, '#00ff88'); ctx.restore();
        const i2 = cmdState.highlightIdx, e2 = entities[i2];
        if(e2 && e2 !== e1 && e2.type === 'LINE') {
            const r = editFilletLines(e1, cmdState.filletTap, e2, { x: mouse.wcsX, y: mouse.wcsY }, _editFilletOpts());
            if(!r.error) {
                ctx.save(); ctx.setLineDash([4, 4]);
                [r.l1, r.l2, r.seg].forEach(l => { if(l) drawOneEntity(Object.assign({ type: 'LINE' }, l), '#ffff00'); });
                if(r.arc) drawOneEntity(Object.assign({ type: 'ARC' }, r.arc), '#ffff00');
                ctx.restore();
            }
        }
    }
}
