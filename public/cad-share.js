// ===== Web CAD 共有メニューで送る・画面の画像（PNG） =====
// cad-share.js - ・書き出したファイル（DXF・図面一式・SIMA・CSV・PDF・画像など。downloadBlob を通るものすべて）を、
//                 スマホ・タブレットでは共有メニュー（LINE・メール・AirDrop・「ファイル」に保存）でも送れるよう、お知らせに「📤 送る」を出す。
//                 iPhone のホーム画面から開いたときに保存がうまくいかない場合の代わりにもなる。PC では出さない（保存だけ）
//               ・☰「🖼 画面の画像」（コマンド PNGOUT）: 今の画面の図を PNG にする。選択・カーソル・スナップ・軸・補助の印は入れず、
//                 背景の地図（出典つき）・下絵・図形・寸法・写真のピンを、画面の 2〜3 倍の細かさで描く

// 共有メニューで送れるファイルか（ブラウザが種類で断ることがある。Android の Chrome は DXF などを送れない）
function canShareFile(file) {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; }
}
// スマホ・タブレット（指で操作する端末）か
function _shareTouchDevice() {
    try { if(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return true; } catch { /* 判定できなければ下で */ }
    return (typeof isAppleTouchDevice === 'function') && isAppleTouchDevice();
}
// 書き出したあとに「📤 送る」を出す（押すと共有メニュー）
function offerShare(blob, filename) {
    if(!blob || !_shareTouchDevice() || typeof File !== 'function') return false;
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if(!canShareFile(file)) return false;
    showSnack(`${filename} を保存しました`, { kind: 'success', ms: 9000, action: { label: '📤 送る', run: () => shareFile(file) } });
    return true;
}
async function shareFile(file) {
    try {
        await navigator.share({ files: [file], title: file.name });
        addCommandLog(`-> 共有メニューで送りました: ${file.name}`);
    } catch(err) {
        if(err && err.name === 'AbortError') return; // 共有メニューを閉じた
        showToast('送れませんでした: ' + ((err && err.message) || err), { kind: 'error', ms: 4000 });
    }
}

// ===== 画面の画像（PNG） =====
const PNG_MAX_PIXELS = 16000000; // iPhone・iPad のキャンバスの上限（約 1600万画素）より少し小さく
async function exportScreenPng() {
    const w = canvas.width, h = canvas.height;
    if(!(w > 0 && h > 0)) return;
    const dpr = Math.ceil(window.devicePixelRatio || 1);
    const k = Math.max(1, Math.min(3, Math.max(2, dpr), Math.floor(Math.sqrt(PNG_MAX_PIXELS / (w * h)) * 100) / 100));
    // 選んでいる図形の色を付けずに描く（描いたあと戻す）
    const sel = { hi: cmdState.highlightIdx, si: cmdState.selectedIndices };
    let blob = null, failed = null;
    try {
        cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
        canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
        drawCleanFrame(k);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); // 画素は呼んだときのものを写す
    } catch(err) {
        failed = err;
        console.error('画面の画像の書き出しエラー:', err);
    } finally {
        canvas.width = w; canvas.height = h;
        cmdState.highlightIdx = sel.hi; cmdState.selectedIndices = sel.si;
        if(typeof _frameCache !== 'undefined') _frameCache = null; // 大きさの違う画面を残さない
        render();
    }
    if(failed || !blob) { notify('エラー: 画面の画像を作れませんでした' + (failed ? ` - ${failed.message}` : ''), { kind: 'error', ms: 5000 }); return; }
    const name = `${_baseName()}_画面.png`;
    downloadBlob(blob, name);
    notify(`-> 画面の画像を保存しました: ${name}（${Math.round(w * k)}×${Math.round(h * k)}）`, { kind: 'success', ms: 2500 });
}
