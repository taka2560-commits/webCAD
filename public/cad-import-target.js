// ===== Web CAD 取り込み先の準備 =====
// cad-import-target.js - ファイルを開くときの「置き換え / 今の図面に追加」の確認と、開いたファイルの単位（INSUNITS）への図面の単位の合わせ、
//   取り込んだ寸法（図形が無く、値の文字だけ置く寸法）の値の文字、レイアウト（ペーパー空間）の図形の見分け（モデル空間だけ取り込む）、
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
    if(typeof drawingLineTypes !== 'undefined') { // 線種表・線種の尺度も新しいファイルのものにする（読めなかったら戻す）
        _importLtState = { t: drawingLineTypes, s: drawingLtscale };
        drawingLineTypes = {}; drawingLtscale = null;
    }
    cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
    if(typeof window.setCurrentProjectName === 'function') window.setCurrentProjectName(null);
    initLayers();
    return (_importMode = 'replace');
}
// 置き換えで開いたファイルが読めなかったとき、消した図面を元に戻す（使った ↩ 1回分も戻す）。戻したら true。
// 読み込みのあいだに別の操作をしていたら（↩ の履歴が進んでいたら）、その操作を消さないよう戻さない
let _importLtState = null; // 置き換える前の線種表・線種の尺度
function _restoreAfterFailedImport() {
    const snap = _importUndo, proj = _importProject;
    _importUndo = null; _importProject = null;
    if(_importMode !== 'replace' || !snap || undoStack[undoStack.length - 1] !== snap) return false;
    undoStack.pop();
    _applyUndoSnapshot(snap);
    if(_importLtState && typeof drawingLineTypes !== 'undefined') { drawingLineTypes = _importLtState.t; drawingLtscale = _importLtState.s; }
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
let _importUnit = 'm', _importDimTxt = { h: 2.5, asz: 2.5 }, _importHideFills = true;
function _beginImport(insunits, dimtxt, dimscale, dimasz) {
    _importUnit = fileUnitFromInsunits(insunits) || ((typeof getSurveyUnit === 'function') ? getSurveyUnit() : 'm');
    // 文字の高さ: 寸法の設定（DIMTXT）× 全体の尺度（DIMSCALE。0 や無いときは 1）。どちらも無ければ 2.5。
    // 矢印の大きさ（引出線）: DIMASZ × DIMSCALE。無ければ文字の高さと同じ
    const t = Number(dimtxt), s = Number(dimscale), a = Number(dimasz), k = (s > 0 ? s : 1);
    const h = (t > 0 ? t : 2.5) * k;
    _importDimTxt = { h, asz: a > 0 ? a * k : h };
    // 取り込んだ塗りつぶしを非表示にするか（オプション。初期値: 入）
    _importHideFills = (typeof shouldHideImportedFills === 'function') ? shouldHideImportedFills() : true;
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

// ===== レイアウト（ペーパー空間）は取り込まない。モデル空間の図形だけを図面にする =====
// レイアウトの図形（図枠・表題欄・ビューポートなど）は、モデル空間と座標の意味が違う（用紙の mm）ので、混ぜると測量の座標とずれた所に重なる
const PAPER_SPACE_RE = /^\*paper_space/i;
const PAPER_SPACE_LABEL = 'レイアウト（ペーパー空間）';
// DXF: 67（inPaperSpace）が付いた図形に加え、持ち主（330）が *Paper_Space のブロックレコードの図形も除く（67 を書かないソフトがある）。
// 除いた図形を持ち主とする図形（レイアウトに置いたブロック参照の属性）も除く
function dxfPaperSpaceTester(dxf) {
    const owners = new Set();
    Object.values((dxf && dxf.blocks) || {}).forEach(b => {
        if(b && PAPER_SPACE_RE.test(b.name || '') && b.ownerHandle !== undefined) owners.add(String(b.ownerHandle).toUpperCase());
    });
    return (e) => {
        if(!e) return false;
        const owned = e.ownerHandle !== undefined && owners.has(String(e.ownerHandle).toUpperCase());
        if(!(e.inPaperSpace || e.paperSpace || owned)) return false;
        if(typeof e.handle === 'string') owners.add(e.handle.toUpperCase()); // 読み込みが振った番号（数）は使わない
        return true;
    };
}
// DWG: 読込エンジン（libredwg-web）は、モデル空間とすべてのレイアウトの図形をまとめて entities に入れて返す。
// *PAPER_SPACE… のブロックレコードに属する図形（と、そのブロック参照の属性）を除く
function dwgPaperSpaceTester(db) {
    const objs = new Set(), owners = new Set();
    const brs = (db && db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [];
    brs.forEach(b => {
        if(!b || !PAPER_SPACE_RE.test(b.name || '')) return;
        if(b.handle !== undefined) owners.add(String(b.handle).toUpperCase());
        (b.entities || []).forEach(en => { objs.add(en); ((en && en.attribs) || []).forEach(a => objs.add(a)); });
    });
    return (e) => !!e && (!!e.isInPaperSpace || objs.has(e)
        || (e.ownerBlockRecordSoftId !== undefined && owners.has(String(e.ownerBlockRecordSoftId).toUpperCase())));
}
// 取り込んだ図形が無く、レイアウトの図形だけがあったときの知らせ
function paperOnlyNote(n) {
    return `モデル空間に図形がありません。\n${PAPER_SPACE_LABEL}の図形（${n}個）は取り込みません`;
}
