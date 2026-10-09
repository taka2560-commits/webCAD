// ===== Web CAD 出力名（書き出すファイルの名前） =====
// cad-outname.js - 書き出すファイル（DXF・SIMA・座標CSV・SDR・PDF・画像・図面一式など）の名前を決める（v5.41）。
//
// ・図面ごとの出力名: ☰「🏷 出力名」（コマンド OUTNAME）で決めておくと、すべての書き出しの名前のもとにする
//   （決めていなければ、今までどおり図面の名前）。保存・図面一式に入り、別のファイルで置き換えると消える
// ・書き出すときの名前の欄: 保存の前に名前を聞く（今の名前が入っているので、そのままなら「💾 保存」だけ）。
//   その回だけの名前で、図面の出力名は変えない。拡張子は自動で付ける。オプション「書き出すときの名前」で聞かないこともできる
// ・書き出す前の確認（SIMA・座標CSV・SDR33・変換後の SIMA）は、確認の画面の名前の欄で決める（cad-export-preview.js）

const OUTNAME_MAX = 120;
let _outputName = null; // この図面の出力名（拡張子なし）。決めていなければ null

// ファイル名に使えない文字（\ / : * ? " < > | と制御文字）は _ にし、前後の空白・末尾の点を外す
function outNameClean(v) {
    let s = Array.from(String(v == null ? '' : v), (c) => c.charCodeAt(0) < 32 ? '_' : c).join('').replace(/[\\/:*?"<>|]/g, '_').trim().replace(/[. ]+$/, '');
    if(s.length > OUTNAME_MAX) s = s.slice(0, OUTNAME_MAX).trim();
    return s;
}
function outputNameGet() { return _outputName; }
function outputNameSet(v) { const s = outNameClean(v); _outputName = s || null; return _outputName; }
// 書き出しの名前のもと（出力名を決めていれば、それ。決めていなければ null）
function outputBase() { return _outputName || null; }
// 名前を「もと」と「拡張子」に分ける（a_写真台帳.pdf → ['a_写真台帳', '.pdf']）
function _outNameSplit(filename) {
    const m = /^(.*?)(\.[A-Za-z0-9]{1,8})$/.exec(String(filename || ''));
    return m && m[1] ? [m[1], m[2]] : [String(filename || ''), ''];
}
// 名前の欄に打った文字 → ファイル名（拡張子まで打っていたら重ねない。空ならもとの名前）
function outNameFinal(typed, filename) {
    const [base, ext] = _outNameSplit(filename);
    let s = outNameClean(typed);
    if(ext && s.toLowerCase().endsWith(ext.toLowerCase())) s = outNameClean(s.slice(0, -ext.length));
    return (s || base) + ext;
}
// 書き出すときの名前の欄（downloadBlob から）。決めた名前の Promise（やめたら null）。聞かないときは名前をそのまま返す（Promise でなく）
function askOutputName(filename) {
    if(window.__cadNoOutNamePrompt || (typeof displayPrefKey === 'function' && displayPrefKey('outName') === 'no')) return filename; // 自動テストは __cadNoOutNamePrompt
    const [base, ext] = _outNameSplit(filename);
    const hint = _outputName ? '' : '\n図面ごとの出力名は、☰ の「🏷 出力名」で決めておけます。';
    return cadPrompt({ title: '書き出すファイルの名前', message: `${ext ? `拡張子「${ext}」は自動で付きます。` : ''}名前を変えなければ、そのまま保存します。${hint}`,
        value: base, ok: '💾 保存', validate: (v) => outNameClean(v) ? '' : '名前を入れてください' })
        .then((v) => (v === null || v === undefined) ? null : outNameFinal(v, filename));
}

// ☰「🏷 出力名」・コマンド OUTNAME
function showOutputNamePanel() {
    const now = _outputName, def = String(window._drawingName || '').replace(/\.[^.]+$/, '').trim() || 'webcad';
    return cadPrompt({ title: '🏷 出力名（この図面）',
        message: `DXF・SIMA・座標CSV・PDF・画像・図面一式など、書き出すファイルの名前のもとにします（例: 名前.dxf・名前_座標.csv・名前_写真台帳.pdf）。\n空にすると、図面の名前（${def}）を使います。`,
        value: now || '', placeholder: def, ok: '決める', validate: () => '' }).then((v) => {
        if(v === null || v === undefined) return;
        const s = outputNameSet(v);
        addCommandLog(s ? `-> 出力名を「${s}」にしました（書き出すファイルの名前のもと）` : '-> 出力名を外しました（図面の名前を使います）');
        if(typeof showToast === 'function') showToast(s ? `出力名: ${s}` : '出力名を外しました', 2500);
        if(typeof scheduleAutoSave === 'function') scheduleAutoSave();
    });
}
function processOutputNameCommand(cmd) {
    if(cmd !== 'OUTNAME' && cmd !== 'OUTPUTNAME') return false;
    showOutputNamePanel();
    return true;
}
