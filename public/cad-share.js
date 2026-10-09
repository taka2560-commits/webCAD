// ===== Web CAD 共有メニューで送る・画面の画像（PNG） =====
// cad-share.js - ・書き出したファイル（DXF・図面一式・SIMA・CSV・PDF・画像など。downloadBlob を通るものすべて）を、
//                 スマホ・タブレットでは共有メニュー（LINE・メール・AirDrop・「ファイル」に保存）でも送れるよう、お知らせに「📤 送る」を出す。
//                 iPhone のホーム画面から開いたときに保存がうまくいかない場合の代わりにもなる。PC では出さない（保存だけ）
//               ・☰「🖼 画面の画像」（コマンド PNGOUT）: 今の画面の図を PNG にする。選択・カーソル・スナップ・軸・補助の印は入れず、
//                 背景の地図（出典つき）・下絵・図形・寸法・写真のピンを、画面の 2〜3 倍の細かさで描く

// 共有メニューで送れるファイルか（ブラウザが答えられる範囲。種類で断るかは shareTypeOk で見る）
function canShareFile(file) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; }
}
// Chromium（Android の Chrome・Edge など）が共有メニューで渡せるファイルの種類。拡張子と MIME の両方が合うものだけ渡せ、
// ほかの種類（.dxf・.sim・.sdr など）は navigator.canShare が true でも、送るときに「Permission denied」で断られる（v5.39.2）
const SHARE_OK_EXT = ['avif', 'bmp', 'csv', 'gif', 'htm', 'html', 'jfif', 'jpeg', 'jpg', 'pdf', 'png', 'svg', 'text', 'tif', 'tiff', 'txt', 'webp'];
const SHARE_OK_MIME = ['application/pdf', 'image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/tiff', 'image/webp', 'text/csv', 'text/html', 'text/plain'];
// 種類で断られないか。iPhone・iPad（WebKit。iPad の Chrome も）は種類で断らない
function shareTypeOk(file) {
    if(typeof isAppleTouchDevice === 'function' && isAppleTouchDevice()) return true;
    const ext = (/\.([^.]+)$/.exec(file.name || '') || [])[1];
    const mime = String(file.type || '').split(';')[0].trim().toLowerCase();
    return !!ext && SHARE_OK_EXT.includes(ext.toLowerCase()) && SHARE_OK_MIME.includes(mime);
}
// 共有メニューで渡せないファイルの送り方: 保存したファイルを、LINE などのアプリの側から選ぶ（v5.39.2）。denied: 送ろうとして断られた
function showShareSteps(name, denied) {
    const ext = (/\.([^.]+)$/.exec(name || '') || [])[1];
    const why = denied || !ext ? 'このファイルは、共有メニューで渡せませんでした。'
        : `この端末のブラウザ（Android の Chrome など）は、「.${ext}」のファイルを共有メニューで渡せません（渡せるのは画像・PDF・テキストなどだけ）。`;
    cadAlert({ title: '📤 LINE などで送るには', ok: 'わかった', message: `${why}\n保存したファイルを、LINE の側から選んで送ります。\n\n`
        + `1. LINE で送りたいトークを開く\n2. 入力欄の左の ＋ →「ファイル」\n3. 「ダウンロード」（Download）フォルダの「${name}」を選ぶ\n\n`
        + 'メール・Google ドライブなども、添付（ファイルを選ぶ）から同じように選べます。同じ名前のファイルがあると、名前に (1) などが付いていることがあります。' });
}
// スマホ・タブレット（指で操作する端末）か
function _shareTouchDevice() {
    try { if(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return true; } catch { /* 判定できなければ下で */ }
    return (typeof isAppleTouchDevice === 'function') && isAppleTouchDevice();
}
// 書き出したあとに「📤 送る」を出す（押すと共有メニュー）。opt: { saved（保存したファイルの名前。送るものと違うとき）, note（ひとこと） }
// 種類で断られるファイル（Android の DXF・SIMA・SDR など）は、代わりに「📤 送り方」（LINE などの側から選ぶ手順）を出す
function offerShare(blob, filename, opt) {
    if(!blob || !_shareTouchDevice() || typeof File !== 'function' || !navigator.share) return false;
    const file = new File([blob], filename, { type: (blob.type || 'application/octet-stream').split(';')[0] });
    const o = opt || {};
    const msg = `${o.saved || filename} を保存しました${o.note ? `（${o.note}）` : ''}`;
    if(!shareTypeOk(file)) {
        showSnack(msg, { kind: 'success', ms: 9000, action: { label: '📤 送り方', run: () => showShareSteps(o.saved || filename) } });
        return true;
    }
    if(!canShareFile(file)) return false;
    showSnack(msg, { kind: 'success', ms: 9000, action: { label: '📤 送る', run: () => shareFile(file, o.saved) } });
    return true;
}
// saved: 保存したファイルの名前（送るものと違うとき。図面一式は .webcad を保存して PDF を送る）
async function shareFile(file, saved) {
    try {
        await navigator.share({ files: [file], title: file.name });
        addCommandLog(`-> 共有メニューで送りました: ${file.name}`);
    } catch(err) {
        if(err && err.name === 'AbortError') return; // 共有メニューを閉じた
        if(err && err.name === 'NotAllowedError') { // 種類・大きさなどで断られた → 保存したファイルを、アプリの側から選ぶ手順
            // 送るものを別に作っていたら（図面一式の PDF）、それも保存する（手順で選ぶファイルが無い、にならないよう）
            if(saved && saved !== file.name && typeof downloadBlob === 'function') downloadBlob(file, file.name, false, { named: true });
            showShareSteps(file.name, true);
            return;
        }
        showToast('送れませんでした: ' + ((err && err.message) || err), { kind: 'error', ms: 4000 });
    }
}

// ===== 画面の画像（PNG） =====
const PNG_MAX_PIXELS = 16000000; // iPhone・iPad のキャンバスの上限（約 1600万画素）より少し小さく
// 今の画面の図を画像にする（選択・カーソル・スナップなどの印は入れない）。k: 画面の何倍の細かさ、type・quality: 画像の形。
// 戻り値 { blob, w, h }（作れなければ blob は null）。図面一式の PDF の表紙にも使う（cad-webcad.js）
async function captureCleanImage(k, type, quality) {
    const w = canvas.width, h = canvas.height;
    // 選んでいる図形の色を付けずに描く（描いたあと戻す）
    const sel = { hi: cmdState.highlightIdx, si: cmdState.selectedIndices };
    let blob;
    try {
        cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
        canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
        drawCleanFrame(k);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality)); // 画素は呼んだときのものを写す
    } finally {
        canvas.width = w; canvas.height = h;
        cmdState.highlightIdx = sel.hi; cmdState.selectedIndices = sel.si;
        if(typeof _frameCache !== 'undefined') _frameCache = null; // 大きさの違う画面を残さない
        render();
    }
    return { blob, w: Math.round(w * k), h: Math.round(h * k) };
}
async function exportScreenPng() {
    const w = canvas.width, h = canvas.height;
    if(!(w > 0 && h > 0)) return;
    const dpr = Math.ceil(window.devicePixelRatio || 1);
    const k = Math.max(1, Math.min(3, Math.max(2, dpr), Math.floor(Math.sqrt(PNG_MAX_PIXELS / (w * h)) * 100) / 100));
    let blob = null, failed = null;
    try { blob = (await captureCleanImage(k, 'image/png')).blob; } catch(err) {
        failed = err;
        console.error('画面の画像の書き出しエラー:', err);
    }
    if(failed || !blob) { notify('エラー: 画面の画像を作れませんでした' + (failed ? ` - ${failed.message}` : ''), { kind: 'error', ms: 5000 }); return; }
    const name = `${_baseName()}_${layoutActive() ? layoutCurrent().name.replace(/[/:*?"<>|]/g, '_') : '画面'}.png`; // レイアウトを見ていればその名前（cad-layout.js）
    const saved = await downloadBlob(blob, name);
    if(saved === null) return; // 名前の欄で「やめる」
    notify(`-> 画面の画像を保存しました: ${saved || name}（${Math.round(w * k)}×${Math.round(h * k)}）`, { kind: 'success', ms: 2500 });
}
