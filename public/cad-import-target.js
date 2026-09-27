// ===== Web CAD 取り込み先の準備 =====
// cad-import-target.js - ファイルを開くときの「置き換え / 今の図面に追加」の確認と、
//   置き換えで開いたファイルが読めなかったときに元の図面へ戻す処理（cad-io.js から分けた。読み込みの本体は cad-io.js・cad-survey.js・cad-sdr.js）

// ===== 取り込み先の準備（置き換え / 追加） =====
// 図面が空でなければ確認し、置き換えの場合は図形・画層を初期化する。Undoは1回分にまとめる
// 決めた取り込み先（'fresh' 空の図面 / 'replace' 置き換え / 'append' 今の図面に追加）は、ファイルの単位を合わせるときに使う
let _importMode = 'fresh';
let _importUndo = null, _importProject = null; // 置き換えで消す前の図面（↩ 1回分）とプロジェクトの名前。読めなかったら戻す
// next(mode): 取り込み先が決まったら呼ぶ（「やめる」なら呼ばない）。戻り値: その場で決まったときの取り込み先（やめたら null）。
// 以前はブラウザの確認で「キャンセル＝今の図面に追加」になっていて、開くのをやめられなかった
// onCancel: 「やめる」を選んだときに呼ぶ
function _prepareImportTarget(next, onCancel) {
    if(typeof guideBeforeFileOpen === 'function') guideBeforeFileOpen();
    saveUndo();
    _importUndo = null; _importProject = null;
    if(entities.length === 0) { _importMode = 'fresh'; if(next) next('fresh'); return 'fresh'; }
    let result;
    cadChoose({ title: 'ファイルを開く', message: '今の図面があります。開くファイルをどうしますか？\n（置き換えても ↩ で今の図面に戻せます）', choices: [
        { label: '置き換える', value: 'replace', kind: 'primary' },
        { label: '今の図面に追加', value: 'append', kind: 'sub' },
    ] }, (v) => {
        if(v === 'replace') result = _clearForReplace();
        else if(v === 'append') result = (_importMode = 'append');
        else { undoStack.pop(); result = null; addCommandLog('-> ファイルを開くのをやめました'); if(onCancel) onCancel(); } // 積んだ ↩ 1回分も戻す
        if(result && next) next(result);
    });
    return result;
}
// 置き換え: 今の図面を消す（消す前の図面は ↩ 1回分として残し、読めなかったときに戻す）
function _clearForReplace() {
    _importUndo = undoStack[undoStack.length - 1];
    _importProject = (typeof window.getProjectState === 'function') ? window.getProjectState() : null;
    entities.length = 0;
    layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
    currentLayerIndex = 0;
    cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
    if(typeof window.setCurrentProjectName === 'function') window.setCurrentProjectName(null);
    initLayers();
    return (_importMode = 'replace');
}
// 置き換えで開いたファイルが読めなかったとき、消した図面を元に戻す（使った ↩ 1回分も戻す）。戻したら true。
// 読み込みのあいだに別の操作をしていたら（↩ の履歴が進んでいたら）、その操作を消さないよう戻さない
function _restoreAfterFailedImport() {
    const snap = _importUndo, proj = _importProject;
    _importUndo = null; _importProject = null;
    if(_importMode !== 'replace' || !snap || undoStack[undoStack.length - 1] !== snap) return false;
    undoStack.pop();
    _applyUndoSnapshot(snap);
    _bumpGeomEpoch();
    if(proj && typeof window.restoreProjectState === 'function') window.restoreProjectState(proj);
    _importMode = 'append';
    render();
    addCommandLog('-> 読み込めなかったので、元の図面に戻しました');
    return true;
}
