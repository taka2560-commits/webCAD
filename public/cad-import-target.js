// ===== Web CAD 取り込み先の準備 =====
// cad-import-target.js - ファイルを開くときの「置き換え / 今の図面に追加」の確認と、開いたファイルの単位（INSUNITS）への図面の単位の合わせ、
//   取り込んだ寸法（図形が無く、値の文字だけ置く寸法）の値の文字、
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

// ===== ファイルの単位（$INSUNITS: 4＝mm、6＝m）に「図面の1単位」を合わせる =====
function fileUnitFromInsunits(code) { const n = Number(code); return n === 4 ? 'mm' : n === 6 ? 'm' : null; }

// ===== 取り込んだ寸法（図形が無いとき、値の文字だけ置く）の値 =====
// 取り込み中のファイルの単位と、寸法の文字の高さ。単位が書かれていなければ、いまの図面の単位
let _importUnit = 'm', _importDimTxt = { h: 2.5 };
function _beginImport(insunits, dimtxt, dimscale) {
    _importUnit = fileUnitFromInsunits(insunits) || ((typeof getSurveyUnit === 'function') ? getSurveyUnit() : 'm');
    // 文字の高さ: 寸法の設定（DIMTXT）× 全体の尺度（DIMSCALE。0 や無いときは 1）。どちらも無ければ 2.5
    const t = Number(dimtxt), s = Number(dimscale);
    _importDimTxt = { h: (t > 0 ? t : 2.5) * (s > 0 ? s : 1) };
}
// 寸法の種類: DXF は 70 の下位ビット（0・1 線、2・5 角度、3 直径、4 半径、6 座標）、DWG は subclassMarker
function _dimKindDxf(type) { const t = (Number(type) || 0) & 7; return t === 3 ? 'diameter' : t === 4 ? 'radius' : (t === 2 || t === 5) ? 'angular' : t === 6 ? 'ordinate' : 'linear'; }
function _dimKindDwg(marker) { const s = String(marker || ''); return /Diametric/.test(s) ? 'diameter' : /Radial/.test(s) ? 'radius' : /Angular/.test(s) ? 'angular' : /Ordinate/.test(s) ? 'ordinate' : 'linear'; }
// 測定値の文字: 長さはファイルの単位のまま、m は小数3桁まで（末尾の0は省く）・mm は整数（どちらも 1mm まで）。
// 半径は「R」、直径は「⌀」。角度はラジアン（ファイルは角度寸法の測定値をラジアンで持つ）を度にする。
// 以前は DWG が測定値を整数に丸め（m の図面の 1.484 が「1」）、DXF は小数2桁（1.48）で、種類を見分けていなかった（角度が「0.79」など）
function importedDimValue(kind, v) {
    if(kind === 'angular') return dimFormatAngle(v > 2 * Math.PI + 0.01 ? v : v * 180 / Math.PI); // 6.3 を超えるなら、度で書かれたものとみなす
    const r = _importUnit === 'mm' ? Math.round(v) : Math.round(v * 1000) / 1000;
    const num = String(Object.is(r, -0) ? 0 : r);
    return kind === 'radius' ? 'R' + num : kind === 'diameter' ? '⌀' + num : num;
}
// 寸法の文字（書かれた文字があればそれ。「<>」は測定値に置き換える）
function importedDimText(kind, meas, userText) {
    const measured = (typeof meas === 'number' && isFinite(meas)) ? importedDimValue(kind, meas) : '';
    let txt = (userText === undefined || userText === null) ? '' : String(userText);
    if(txt === '' || txt === '<>') txt = measured;
    else if(txt.includes('<>')) txt = txt.split('<>').join(measured);
    return _decodeCadText(txt);
}
// 新しく開いた・置き換えたときは自動で合わせる（座標・寸法の値の桁、測定、SIMA の位置が合う）。
// 今の図面に追加したときは変えずに知らせる。単位が書かれていなければ、いまの単位のまま記録に残す。
// 戻り値: 画面に知らせる文（同じ・単位なしなら ''）。what は 'DXF' / 'DWG'
function applyFileUnit(code, what) {
    const mode = _importMode;
    _importMode = 'fresh'; // 次に開くときは、また取り込み先を決め直す
    if(typeof getSurveyUnit !== 'function') return '';
    const fileUnit = fileUnitFromInsunits(code), cur = getSurveyUnit();
    if(!fileUnit) {
        addCommandLog(`-> この${what}には単位が書かれていません（図面の1単位は 1${cur} のまま）。違うときはオプションの測量の欄で変えてください`);
        return '';
    }
    if(fileUnit === cur) return '';
    if(mode !== 'append' && typeof window.setSurveyUnit === 'function') {
        window.setSurveyUnit(fileUnit);
        return `この${what}の単位は ${fileUnit} なので、オプションの「図面の1単位」を 1${fileUnit} にしました`;
    }
    return `この${what}の単位は ${fileUnit} です（オプションの「図面の1単位」は 1${cur}）。今の図面に追加したので変えていません。測定・SIMA の値を合わせるには、オプションで 1${fileUnit} にしてください`;
}
