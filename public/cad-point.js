// ===== Web CAD 点（POINT コマンド） =====
// cad-point.js - 図面をタップした所に測点を置き、座標一覧に入れる（左のツールバーの「点」・コマンド POINT / PO）
//
// ・初めに「点 作図設定」で最初の点名（次の番号の案が入る）と標高（空欄なら無し）を決め、「この点名で置き始める」
// ・そのあとは、タップ（1本指でなぞるとルーペで狙える。指を離した所）・クリック・コマンド欄の「X,Y」で、その場に置く。
//   （v5.23 はタッチを「位置を決めて ☑確定」にしていたが、確定の前に終了・座標一覧を開くと点が入らず「一覧に載らない」ことがあった。
//    画面を動かすのは2本指なので、線分と同じくすぐ置き、まちがいは「↩ 元に戻す」で消す）。点名は P1 → P2 → … と自動で次の番号にする（同じ点名があれば飛ばす）。
//   スナップも効く。置いた点は測量計算の「点の追加」と同じ作り（点・点名の文字。画層「測点」）なので、座標一覧・SIMA の書き出しに入る
// ・押し間違いで置いたときは、画面の下の「↩ 元に戻す」か ↩ で消せる。終わるときは「終了」・Esc・もう一度「点」

let _pt = { next: '', z: null }; // 次に置く点名・標高

// 図面にもう使われている点名か
function _ptNameTaken(name) {
    return collectSurveyPoints().some((p) => p.name === name || String(p.num) === name);
}
// 使われていない点名（同じ点名があれば次の番号へ）
function _ptFreeName(name) {
    let n = String(name || '').trim() || 'P1';
    for(let i = 0; i < 10000 && _ptNameTaken(n); i++) n = cogoNextName(n);
    return n;
}
// 次の点名の案（図面の最後の測点の次。無ければ P1）
function _ptSuggestName() {
    const pts = collectSurveyPoints().filter((p) => p.name);
    return _ptFreeName(pts.length ? cogoNextName(pts[pts.length - 1].name) : 'P1');
}

function showPointPanel() {
    const name = _pt.next && !_ptNameTaken(_pt.next) ? _pt.next : _ptSuggestName();
    const html = `
        <div class="prop-row"><label for="prop-point-name">点名:</label><input type="text" id="prop-point-name" autocomplete="off" value="${escapeHtml(name)}" placeholder="例 P1"></div>
        <div class="prop-row"><label for="prop-point-z">標高${displayUnitTag('len')}:</label><input type="text" id="prop-point-z" inputmode="decimal" autocomplete="off" value="${_pt.z === null ? '' : _pt.z}" placeholder="なし"></div>
        ${_cogoNote('タップした所に点を置き、座標一覧に入れます（スナップも効きます）。点名は置くたびに次の番号になります。まちがえて置いたら「↩ 元に戻す」で消せます。')}
        <button class="prop-btn" onclick="applyPointPreset()">この点名で置き始める</button>`;
    showPropertyPanel('点 作図設定', html);
}
// 設定を決めて、置き始める
window.applyPointPreset = function() {
    const nEl = document.getElementById('prop-point-name'), zEl = document.getElementById('prop-point-z');
    const name = nEl ? String(nEl.value).trim() : '';
    if(nEl && !name) { fieldError(nEl, '点名を入れてください（例 P1）'); return; }
    const z = zEl ? fieldNum(zEl, { allowEmpty: true, what: '標高' }) : null;
    if(z === undefined) return;
    if(name && _ptNameTaken(name)) { fieldError(nEl, `点名「${name}」はもう図面にあります（別の点名にしてください。案: ${_ptFreeName(name)}）`); return; }
    _pt.next = name || _ptSuggestName();
    _pt.z = (z === null) ? null : fromDisplayUnit(z, 'len');
    hidePropertyPanel();
    cmdState.mode = 'WAITING_POINT_PLACE';
    if(typeof showActionbarControls === 'function') showActionbarControls({ hideConfirm: true }); // 「終了」だけ
    _ptPrompt();
    addCommandLog(`-> [点] 点を置く位置をタップ（点名 ${_pt.next} から）`);
};
function _ptPrompt() { setPrompt(`点を置く位置をタップ（次の点名 ${_pt.next}）→ 終わるときは「終了」`); }
// 点の位置の入力（cad-command.js の _handlePointInputCore から）。タップ（指を離した所）・クリック・コマンド欄の「X,Y」で、その場に置く
function pointInput(wcs) { pointPlaceAt(wcs); }

// 図面にまだ点名が無いときの点名の文字の高さ: 今の画面で約14px になる高さを、きりのよい値（1・2・5 の10のべき）に丸める
function _ptLabelHeight() {
    const raw = 14 / (view.scale || 1);
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    for(const k of [1, 2, 5, 10]) if(k * e >= raw * 0.8) return +(k * e).toPrecision(6);
    return raw;
}
// タップした所（スナップの点）に点を置く（cad-command.js の _handlePointInputCore から）
function pointPlaceAt(wcs) {
    const name = _ptFreeName(_pt.next);
    const s = wcsToSurvey(wcs.x, wcs.y);
    cogoAddSurveyPoint(s.X, s.Y, name, _pt.z, _ptLabelHeight());
    addCommandLog(`-> 点「${name}」を追加 X ${cogoFix(s.X, 3)} Y ${cogoFix(s.Y, 3)}`);
    if(typeof showUndoSnack === 'function') showUndoSnack(`点「${name}」を置きました（座標一覧に入ります）`);
    if(navigator.vibrate) navigator.vibrate(15);
    _pt.next = _ptFreeName(cogoNextName(name));
    _ptPrompt();
    if(typeof updateCoordListContent === 'function' && document.getElementById('coord-list-rows')) updateCoordListContent();
    render();
}

// コマンド POINT / PO
function processPointCommand(cmd) {
    if(cmd !== 'POINT' && cmd !== 'PO') return false;
    resetCommand();
    setActiveTool('POINT');
    activeCommandName = 'POINT';
    cmdState.mode = 'WAITING_POINT_PRESET';
    setPrompt('点名を決めて「この点名で置き始める」');
    addCommandLog('-> [点] 点名・標高を決めて置き始めます');
    showPointPanel();
    return true;
}
