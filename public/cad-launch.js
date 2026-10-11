// ===== Web CAD ほかのアプリから開く（ファイルの関連付け・共有） =====
// cad-launch.js - アプリとして入れた Web CAD に、ほかのアプリからファイルを渡して開く（v5.44）。
//
// ・PC（Chrome・Edge でアプリとして入れたとき）: manifest.json の file_handlers で、.dwg・.dxf・.jww・.sim・.sdr・.webcad・.csv を
//   「プログラムから開く → Web CAD」で開ける。渡されたファイルは window.launchQueue に届く
// ・Android（Chrome でホーム画面に入れたとき）: manifest.json の share_target で、LINE・ファイルの画面の「共有」の送り先に出る。
//   届いたファイルは sw.js が受け取ってキャッシュ（SHARED_CACHE）に置き、「?shared=1」でアプリを開く → ここで取り出す
// ・開き方は 📁開く で選んだときと同じ（openIncomingFile。cad-io.js）。起動の確認画面（前回の作業の復元など）が出ていれば、閉じてから開く

const SHARED_CACHE = 'webcad-shared';   // sw.js と同じ名前
const SHARED_KEY = 'shared-file';       // 届いたファイルを置く場所（スコープからの相対）

// 確認画面が閉じるまで待ってから fn（起動のときの「前回の作業」の確認と重ならないよう）
function _launchWhenIdle(fn, tries) {
    const n = tries || 0;
    const busy = (typeof cadDialogOpen === 'function' && cadDialogOpen());
    if(busy && n < 600) { setTimeout(() => _launchWhenIdle(fn, n + 1), 300); return; }
    fn();
}
function _launchOpen(file, how) {
    if(!file) return;
    addCommandLog(`-> ${how}: ${file.name}`);
    _launchWhenIdle(() => openIncomingFile(file));
}

// PC: ファイルの関連付けで開いたとき
function launchSetup() {
    try {
        if('launchQueue' in window && window.launchQueue && typeof window.launchQueue.setConsumer === 'function') {
            window.launchQueue.setConsumer(async (params) => {
                const h = params && params.files && params.files[0];
                if(!h) return;
                try { _launchOpen(await h.getFile(), 'ほかのアプリから開きました'); } catch(err) { notify(`エラー: ファイルを受け取れませんでした - ${err.message}`, { kind: 'error', ms: 5000 }); }
            });
        }
    } catch { /* 対応していないブラウザ */ }
    launchPickShared();
}
// Android: 共有で届いたファイル（sw.js がキャッシュに置いたもの）を取り出して開く
async function launchPickShared() {
    let params;
    try { params = new window.URLSearchParams(location.search); } catch { return false; }
    if(!params.has('shared')) return false;
    try { window.history.replaceState(null, '', location.pathname + location.hash); } catch { /* 戻せなくてもよい */ }
    const caches = window.caches;
    if(!caches) return false;
    try {
        const cache = await caches.open(SHARED_CACHE);
        const key = new URL(SHARED_KEY, location.href).href;
        const res = await cache.match(key);
        if(!res) { notify('共有されたファイルが見つかりませんでした（もう一度「共有」から送ってください）', { kind: 'warn', ms: 4000 }); return false; }
        const name = decodeURIComponent(res.headers.get('X-File-Name') || 'shared');
        const blob = await res.blob();
        await cache.delete(key);
        _launchOpen(new File([blob], name, { type: blob.type || '' }), '共有で受け取りました');
        return true;
    } catch(err) {
        notify(`エラー: 共有されたファイルを受け取れませんでした - ${err.message}`, { kind: 'error', ms: 5000 });
        return false;
    }
}
if(document.readyState === 'complete') setTimeout(launchSetup, 0);
else window.addEventListener('load', () => setTimeout(launchSetup, 0));
