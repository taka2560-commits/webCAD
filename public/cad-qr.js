// ===== Web CAD このアプリを人に渡す（QR コード） =====
// cad-qr.js - アプリのリンクを大きな QR コードで出す（☰ メニュー「📱 このアプリを渡す」・コマンド QR / SHAREAPP）。
//   相手がスマホのカメラで読み取ると Web CAD が開き、ホーム画面に追加すればアプリとして使える。
//   QR はアプリの中で作る（qrcode-generator を同梱。src/vendor.js）ので、電波の無い所でも出せる。
//   リンクは、いま開いているアプリの場所。開発用（localhost・192.168.… など）や手元のファイルで開いているときは、公開している場所にする。
//   「📤 リンクを送る」（スマホの共有メニュー）と「📋 コピー」も並べる

const APP_PUBLIC_URL = 'https://antigravity-web-cad.vercel.app/';
const SHARE_APP_TITLE = '📱 このアプリを渡す';

// 渡すリンク（いま開いている場所。手元の開発用の場所なら公開している場所）
// loc: 場所（テスト用。省くと今の場所）
function shareAppUrl(loc0) {
    const loc = loc0 || window.location || {};
    const host = String(loc.hostname || '');
    const local = !/^https?:$/.test(loc.protocol || '') || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /\.(localhost|local|test)$/.test(host);
    if(local) return APP_PUBLIC_URL;
    return String(loc.origin || '') + String(loc.pathname || '/');
}
// 文字 → QR の SVG（白地に黒。まわりに 4 マスの余白。誤り訂正 M）。作れなければ ''
function qrSvg(text) {
    if(typeof window.qrcode !== 'function') return '';
    let qr;
    try { qr = window.qrcode(0, 'M'); qr.addData(String(text)); qr.make(); } catch { return ''; }
    const n = qr.getModuleCount(), q = 4, size = n + q * 2;
    let d = '';
    for(let r = 0; r < n; r++) {
        for(let c = 0; c < n; c++) {
            if(!qr.isDark(r, c)) continue;
            let w = 1; // 横に続く黒いマスは1つの四角にまとめる
            while(c + w < n && qr.isDark(r, c + w)) w++;
            d += `M${c + q} ${r + q}h${w}v1h-${w}z`;
            c += w - 1;
        }
    }
    return `<svg class="qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="アプリのリンクの QR コード">` +
        `<rect width="${size}" height="${size}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}
window.showShareAppPanel = function() {
    const url = shareAppUrl();
    const svg = qrSvg(url);
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const h = `
        <div class="qr-box">${svg || '<div class="cogo-note" style="color:#ff6b6b;">QR コードを作れませんでした（ページを読み込み直してください）</div>'}</div>
        <div class="qr-url" id="qr-url">${escapeHtml(url)}</div>
        <div class="cogo-btns">
            ${canShare ? '<button class="prop-btn" onclick="shareAppLink()">📤 リンクを送る</button>' : ''}
            <button class="prop-btn btn-sub" onclick="copyAppLink()">📋 リンクをコピー</button>
        </div>
        <div class="cogo-note">相手のスマホのカメラでこの QR を読み取ると、Web CAD が開きます。<br>
            ホーム画面に置くと、アプリとして使えます（iPhone は Safari の共有ボタン →「ホーム画面に追加」、Android は Chrome の ⋮ →「アプリをインストール」か「ホーム画面に追加」）。<br>
            一度開けば、そのあとは電波の無い現場でも使えます。図面は端末ごとに保存されるので、図面を渡すときは ☰「📦 図面一式」や DXF を送ってください。</div>`;
    showPropertyPanel(SHARE_APP_TITLE, h);
};
window.shareAppLink = async function() {
    const url = shareAppUrl();
    try { await navigator.share({ title: 'Web CAD', text: 'Web CAD（測量・現場向けの CAD）', url }); }
    catch(e) { if(!e || e.name !== 'AbortError') window.copyAppLink(); } // 送れなかったらコピーにする（やめたときは何もしない）
};
window.copyAppLink = async function() {
    const url = shareAppUrl();
    try {
        await navigator.clipboard.writeText(url);
        showToast('リンクをコピーしました', { kind: 'success', ms: 2000 });
    } catch {
        // コピーできないブラウザ: リンクの文字を選んで見せる（長押しでコピーできる）
        const el = document.getElementById('qr-url');
        if(el && window.getSelection && document.createRange) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
        showToast('コピーできませんでした。選んだリンクを長押ししてコピーしてください', { kind: 'warn', ms: 3500 });
    }
};
// コマンド QR・SHAREAPP
function processShareAppCommand(cmd) {
    if(cmd !== 'QR' && cmd !== 'SHAREAPP') return false;
    window.showShareAppPanel();
    return true;
}
