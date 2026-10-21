// ===== Web CAD Dropbox 連携（v5.54） =====
// cad-dropbox.js - Dropbox から図面を開く（Chooser）・書き出したファイルを Dropbox に保存する（Dropbox の API で送る）。
//   ・使うには Dropbox のアプリキー（App key）が要る。DROPBOX_APP_KEY に書くか、⚙ オプションの「Dropbox」で入れる（端末に覚える）。
//   ・開く: Dropbox の Chooser（dropins.js）でファイルを選び、直接のリンク（dl.dropboxusercontent.com）から読み、
//     📁 開く と同じ openIncomingFile で開く（DXF・DWG・JWW・SIMA・CSV・SDR・図面一式）。つなぐ（ログイン）は要らない。
//   ・保存: Dropbox の Saver は「誰でも開ける URL」のファイルしか保存できず、このアプリが作るファイル（端末の中だけにある）は渡せない。
//     そのため、1回だけ「Dropbox につなぐ」（OAuth 2 の PKCE。コードを貼り付ける形。iPhone のホーム画面のアプリでも使える）をして、
//     files/upload で送る。保存先は、Dropbox から開いたファイルと同じフォルダ（分からなければオプションの保存先。初めは /WebCAD）。
//     同じ名前があれば「名前 (1).dxf」のように別の名前にする（上書きしない）。
//   ・アプリキーは秘密ではない（ブラウザで動くアプリは、どのみち見える）。秘密のキー（App secret）は使わない。

const DROPBOX_APP_KEY = ''; // 作ったアプリキーをここに書くと、どの端末でもオプションに入れずに使える
const DBX_DROPINS_URL = 'https://www.dropbox.com/static/api/2/dropins.js';
const DBX_OPEN_EXTS = ['.dxf', '.dwg', '.jww', '.sim', '.csv', '.txt', '.sdr', '.webcad', '.pdf'];
const DBX_DEFAULT_FOLDER = '/WebCAD';
const DBX_UPLOAD_MAX = 150 * 1024 * 1024; // files/upload で1回に送れる大きさ

const _dbxLs = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if(v === null || v === undefined || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 覚えられなくても続ける */ } },
};
let _dbxPkce = null;      // つなぐ途中の { verifier }（コードを貼り付けるまで）
let _dbxLastOpened = null; // Dropbox から開いたファイル { id, name }（保存先のフォルダを決める）
let _dbxFolderCache = {};  // ファイルの id → フォルダ
let _dbxLoading = null;    // dropins.js の読み込み（Promise）

function dropboxAppKey() { return (_dbxLs.get('cad_dropbox_key') || DROPBOX_APP_KEY || '').trim(); }
function dropboxEnabled() { return !!dropboxAppKey(); }
function dropboxSaveFolder() { return _dbxNormFolder(_dbxLs.get('cad_dropbox_folder') || DBX_DEFAULT_FOLDER); }
function _dbxNormFolder(f) {
    let s = String(f || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if(!s || s === '/') return '';
    if(!s.startsWith('/')) s = '/' + s;
    return s.replace(/\/$/, '');
}
function _dbxAuth() { try { return JSON.parse(_dbxLs.get('cad_dropbox_auth') || 'null'); } catch { return null; } }
function dropboxConnected() { const a = _dbxAuth(); return !!(a && a.refresh); }
function _dbxOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

// Dropbox-API-Arg の見出しは ASCII だけ。日本語の名前は \uXXXX にする（Dropbox の決まり）
function dropboxApiArg(obj) {
    return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
function _dbxB64url(bytes) {
    let s = '';
    for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// PKCE: verifier（43〜128 文字）と challenge（verifier の SHA-256 を base64url）
async function dropboxPkcePair() {
    const c = window.crypto;
    if(!c || !c.subtle || !c.getRandomValues) throw new Error('この画面では安全な通信の機能（crypto.subtle）が使えません（https で開いてください）');
    const verifier = _dbxB64url(c.getRandomValues(new Uint8Array(48)));
    const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: _dbxB64url(new Uint8Array(digest)) };
}

// ===== 開く（Chooser） =====
function _dbxLoadDropins() {
    if(window.Dropbox && typeof window.Dropbox.choose === 'function') return Promise.resolve(window.Dropbox);
    if(_dbxLoading) return _dbxLoading;
    _dbxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = DBX_DROPINS_URL; s.id = 'dropboxjs'; s.async = true;
        s.setAttribute('data-app-key', dropboxAppKey());
        s.onload = () => { if(window.Dropbox) resolve(window.Dropbox); else { _dbxLoading = null; s.remove(); reject(new Error('Dropbox の部品を読めませんでした')); } };
        s.onerror = () => { _dbxLoading = null; s.remove(); reject(new Error('Dropbox の部品を読めませんでした（電波・広告ブロックを確かめてください）')); };
        document.head.appendChild(s);
    });
    return _dbxLoading;
}
// ☰ メニューを開いたときなどに先に読んでおく（Chooser の窓は、押した直後に開かないとブラウザに止められるため）
function dropboxPreload() { if(dropboxEnabled() && _dbxOnline()) _dbxLoadDropins().catch(() => { /* 押したときに知らせる */ }); }

function _dbxNeedKey() {
    if(typeof showSnack === 'function') showSnack('Dropbox を使うには、アプリキーを入れてください', { kind: 'warn', ms: 8000, action: { label: '⚙ オプション', run: () => { if(typeof showOptionsPanel === 'function') showOptionsPanel(); } } });
}
function dropboxOpen() {
    if(!dropboxEnabled()) { _dbxNeedKey(); return; }
    if(!_dbxOnline()) { showToast('電波が無いので Dropbox を使えません', { kind: 'warn', ms: 3000 }); return; }
    const D = window.Dropbox;
    if(D && typeof D.choose === 'function') { _dbxChoose(D); return; }
    // まだ読んでいない: 読み終えたら、もう一度押してもらう（読み終えてから開くと、窓がブラウザに止められる）
    showToast('Dropbox の準備をしています…', { ms: 2500 });
    _dbxLoadDropins().then((d) => {
        showSnack('Dropbox の準備ができました', { kind: 'success', ms: 10000, action: { label: '☁ Dropbox から開く', run: () => _dbxChoose(d) } });
    }).catch((err) => showToast(err.message, { kind: 'error', ms: 4000 }));
}
function _dbxChoose(D) {
    D.appKey = dropboxAppKey();
    D.choose({
        linkType: 'direct', multiselect: false, folderselect: false, extensions: DBX_OPEN_EXTS,
        success: (files) => { if(files && files[0]) dropboxOpenChosen(files[0]); },
        cancel: () => {},
    });
}
// Chooser で選んだファイル（{ link, name, id, bytes }）を読んで開く
async function dropboxOpenChosen(f) {
    if(!f || !f.link || !f.name) return;
    showToast(`Dropbox から ${f.name} を読んでいます…`, { ms: 2500 });
    try {
        const res = await window.fetch(f.link);
        if(!res.ok) throw new Error(`読めませんでした（${res.status}）`);
        const blob = await res.blob();
        const file = new File([blob], f.name, { type: blob.type || 'application/octet-stream' });
        _dbxLastOpened = { id: f.id || null, name: f.name, pending: true };
        addCommandLog(`-> Dropbox から開きます: ${f.name}`);
        openIncomingFile(file);
    } catch(err) {
        showToast(`Dropbox から開けませんでした: ${(err && err.message) || err}`, { kind: 'error', ms: 4500 });
    }
}

// ===== つなぐ（保存のため。OAuth 2 PKCE・コードを貼り付ける形） =====
// 許可の画面は、パネルのリンク（<a target="_blank">）を押して開く（待ってから window.open すると、iPhone・iPad では窓を止められるため）。
// verifier は端末に30分だけ覚える（ホーム画面のアプリから Safari でログインしている間に、アプリが閉じられても使えるように）
const DBX_SCOPE = 'files.metadata.read files.content.write'; // 開いたファイルのフォルダを知る・保存する（開くのは Chooser なので要らない）
const DBX_PKCE_MS = 30 * 60 * 1000;
function _dbxPkceGet() {
    if(_dbxPkce && _dbxPkce.verifier) return _dbxPkce;
    try {
        const p = JSON.parse(_dbxLs.get('cad_dropbox_pkce') || 'null');
        if(p && p.verifier && p.key === dropboxAppKey() && Date.now() - p.at < DBX_PKCE_MS) return (_dbxPkce = p);
    } catch { /* 無ければ作り直す */ }
    return null;
}
async function dropboxConnectStart() {
    if(!dropboxEnabled()) { _dbxNeedKey(); return; }
    let p;
    try { p = await dropboxPkcePair(); } catch(err) { showToast(err.message, { kind: 'error', ms: 4500 }); return; }
    _dbxPkce = { verifier: p.verifier, key: dropboxAppKey(), at: Date.now() };
    _dbxLs.set('cad_dropbox_pkce', JSON.stringify(_dbxPkce));
    const q = new window.URLSearchParams({ client_id: dropboxAppKey(), response_type: 'code', code_challenge: p.challenge, code_challenge_method: 'S256',
        token_access_type: 'offline', scope: DBX_SCOPE });
    showDropboxConnectPanel('https://www.dropbox.com/oauth2/authorize?' + q.toString());
}
function showDropboxConnectPanel(url) {
    showPropertyPanel('Dropbox につなぐ', `
        <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#ddd;">
            <div>① 下の「Dropbox の画面を開く」を押し、ログインして「許可」を押します。</div>
            <a class="prop-btn" id="dbx-auth-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;">☁ Dropbox の画面を開く</a>
            <div>② 出てきた<b>コード</b>をコピーして、ここに貼り付けて「つなぐ」を押します（1回だけです）。</div>
            <input class="prop-val" id="dbx-code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ここにコードを貼り付け" aria-label="Dropbox のコード">
            <button class="prop-btn" onclick="dropboxConnectFinish(document.getElementById('dbx-code').value)">☁ つなぐ</button>
        </div>`);
}
async function _dbxTokenRequest(params) {
    const res = await window.fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new window.URLSearchParams(params).toString() });
    let j = null;
    try { j = await res.json(); } catch { /* 下で知らせる */ }
    if(!res.ok || !j || !j.access_token) {
        const e = new Error((j && (j.error_description || j.error)) || `つなげませんでした（${res.status}）`);
        e.grant = !!(j && j.error === 'invalid_grant'); // コード・refresh token が使えない（使い済み・取り消された）
        throw e;
    }
    return j;
}
async function dropboxConnectFinish(code) {
    code = String(code || '').trim();
    if(!code) { showToast('コードを貼り付けてください', { kind: 'warn', ms: 2500 }); return false; }
    const pk = _dbxPkceGet();
    if(!pk) { showToast('先に「☁ つなぐ」を押して、Dropbox の画面を開いてください', { kind: 'warn', ms: 3500 }); return false; }
    try {
        const j = await _dbxTokenRequest({ code, grant_type: 'authorization_code', code_verifier: pk.verifier, client_id: dropboxAppKey() });
        _dbxSaveAuth(j, j.refresh_token);
        _dbxPkce = null; _dbxLs.set('cad_dropbox_pkce', null);
        addCommandLog('-> Dropbox につなぎました');
        showToast('Dropbox につなぎました。書き出したあとの「☁ Dropbox へ」で保存できます', { kind: 'success', ms: 4500 });
        if(typeof showOptionsPanel === 'function') showOptionsPanel();
        return true;
    } catch(err) {
        showToast(`Dropbox につなげませんでした: ${err.message}（コードは1回しか使えません。もう一度「つなぐ」からやり直してください）`, { kind: 'error', ms: 6000 });
        return false;
    }
}
function _dbxSaveAuth(j, refresh) {
    const a = { access: j.access_token, exp: Date.now() + Math.max(60, (Number(j.expires_in) || 14400) - 60) * 1000, refresh: refresh || (_dbxAuth() || {}).refresh || null, account: j.account_id || (_dbxAuth() || {}).account || null };
    _dbxLs.set('cad_dropbox_auth', JSON.stringify(a));
    return a;
}
// つなぎ直してもらう（許可が取り消された・refresh token が使えない）
function _dbxLost() {
    _dbxLs.set('cad_dropbox_auth', null);
    showSnack('Dropbox の許可が切れました。もう一度つないでください', { kind: 'warn', ms: 9000, action: { label: '☁ つなぐ', run: () => dropboxConnectStart() } });
}
// 使える access token（切れていれば・force なら refresh token で取り直す）。取り直せなければ（取り消された）つなぎ直しを出して null
async function _dbxToken(force) {
    const a = _dbxAuth();
    if(!a || !a.refresh) return null;
    if(!force && a.access && a.exp > Date.now()) return a.access;
    try {
        const j = await _dbxTokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: dropboxAppKey() });
        return _dbxSaveAuth(j, a.refresh).access;
    } catch(err) {
        if(err.grant) { _dbxLost(); return null; }
        throw err;
    }
}
async function dropboxDisconnect() {
    // 使える token で revoke を送る（切れた token だと Dropbox 側に refresh token が残る）
    if(dropboxConnected() && _dbxOnline()) {
        try {
            const t = await _dbxToken();
            if(t) await window.fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
        } catch { /* 切れなくても端末からは消す */ }
    }
    _dbxLs.set('cad_dropbox_auth', null);
    _dbxFolderCache = {};
    hideSnack();
    addCommandLog('-> Dropbox との接続を切りました');
    showToast('Dropbox との接続を切りました', { ms: 2500 });
    if(typeof showOptionsPanel === 'function' && document.getElementById('opt-dropbox')) showOptionsPanel();
}

// ===== 保存（files/upload） =====
// 保存先: Dropbox から開いたファイルと同じフォルダ。分からなければオプションの保存先
async function dropboxTargetFolder(token) {
    const last = _dbxLastOpened;
    if(last && last.id && !last.pending) { // 開き終わっていない（やめた・まだ読んでいる）ときは使わない
        if(Object.prototype.hasOwnProperty.call(_dbxFolderCache, last.id)) return _dbxFolderCache[last.id];
        try {
            const res = await window.fetch('https://api.dropboxapi.com/2/files/get_metadata', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: last.id }) });
            if(res.ok) {
                const m = await res.json();
                const p = String((m && (m.path_display || m.path_lower)) || '');
                if(p.includes('/')) { const f = _dbxNormFolder(p.slice(0, p.lastIndexOf('/'))); _dbxFolderCache[last.id] = f; return f; }
            }
        } catch { /* 分からなければ決めた保存先 */ }
    }
    return dropboxSaveFolder();
}
async function dropboxSaveBlob(blob, filename) {
    if(!dropboxEnabled()) { _dbxNeedKey(); return null; }
    if(!dropboxConnected()) {
        showSnack('Dropbox に保存するには、1回だけ Dropbox につないでください', { kind: 'warn', ms: 9000, action: { label: '☁ つなぐ', run: () => dropboxConnectStart() } });
        return null;
    }
    if(!_dbxOnline()) { showToast('電波が無いので Dropbox に保存できません（端末には保存してあります）', { kind: 'warn', ms: 3500 }); return null; }
    if(blob.size > DBX_UPLOAD_MAX) { showToast('150MB より大きいファイルは Dropbox に送れません', { kind: 'error', ms: 3500 }); return null; }
    const name = String(filename || 'webcad').replace(/[\\/:*?"<>|]/g, '_');
    try {
        let token = await _dbxToken();
        if(!token) return null; // 許可が切れた（つなぎ直しを出した）
        const folder = await dropboxTargetFolder(token);
        const path = `${folder}/${name}`;
        showToast(`Dropbox に保存しています… ${path}`, { ms: 2500 });
        const send = (t) => window.fetch('https://content.dropboxapi.com/2/files/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': dropboxApiArg({ path, mode: 'add', autorename: true, mute: false, strict_conflict: false }) },
            body: blob,
        });
        let res = await send(token), j = null;
        try { j = await res.json(); } catch { /* 下で知らせる */ }
        if(res.status === 401) {
            // token の期限切れ（端末の時計のずれなど）なら取り直してもう1回。取り消されていれば、つなぎ直し
            const tag = j && j.error && j.error['.tag'];
            if(tag === 'expired_access_token') {
                token = await _dbxToken(true);
                if(!token) return null;
                res = await send(token); j = null;
                try { j = await res.json(); } catch { /* 下で知らせる */ }
            }
            if(res.status === 401) { _dbxLost(); return null; }
        }
        if(!res.ok || !j) throw new Error((j && (j.error_summary || j.error)) || `保存できませんでした（${res.status}）`);
        const saved = j.path_display || path;
        addCommandLog(`-> Dropbox に保存しました: ${saved}`);
        showToast(`Dropbox に保存しました: ${saved}`, { kind: 'success', ms: 4500 });
        return saved;
    } catch(err) {
        showToast(`Dropbox に保存できませんでした: ${(err && err.message) || err}`, { kind: 'error', ms: 5000 });
        return null;
    }
}
// 書き出したあとの知らせに付けるボタン（cad-io.js の downloadBlob）。使わない設定なら null
function dropboxSaveAction(blob, filename) {
    if(!dropboxEnabled() || !blob) return null;
    return { label: '☁ Dropbox へ', run: () => dropboxSaveBlob(blob, filename) };
}

// ===== オプションの欄 =====
function dropboxOptionsHtml() {
    const key = dropboxAppKey(), own = !!_dbxLs.get('cad_dropbox_key');
    const status = !key ? 'アプリキーが入っていません' : (dropboxConnected() ? '✅ つないでいます（保存できます）' : '開くことはできます。保存するには「つなぐ」を押してください');
    return `
        <div id="opt-dropbox" style="border-top:1px solid rgba(255,255,255,0.1); margin-top:10px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:11px;color:#aaa;font-weight:700;">☁ Dropbox</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;">アプリキー<input class="prop-val" id="opt-dbx-key" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:0;" value="${escapeHtml(own ? key : '')}" placeholder="${DROPBOX_APP_KEY ? '（アプリに入っているキーを使います）' : 'Dropbox の App key'}" onchange="setDropboxAppKey(this.value)"></label>
            <div style="font-size:11px;color:#ddd;" id="opt-dbx-status">${escapeHtml(status)}</div>
            <div style="display:flex;gap:6px;">
                ${dropboxConnected() ? '<button class="prop-btn btn-sub" style="flex:1;" onclick="dropboxDisconnect()">接続を切る</button>' : `<button class="prop-btn" style="flex:1;" onclick="dropboxConnectStart()"${key ? '' : ' disabled'} title="保存するために、1回だけ Dropbox につなぎます">☁ つなぐ</button>`}
                <button class="prop-btn btn-sub" style="flex:1;" onclick="dropboxOpen()"${key ? '' : ' disabled'} title="Dropbox のファイルを選んで開きます">☁ 開く</button>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;">保存先<input class="prop-val" id="opt-dbx-folder" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:0;" value="${escapeHtml(dropboxSaveFolder() || '/')}" onchange="setDropboxFolder(this.value)"></label>
            <div style="color:#888;font-size:10px;">書き出したあとの知らせの「☁ Dropbox へ」で保存します。Dropbox から開いた図面は、そのファイルと同じフォルダに保存します（ほかは上の保存先）。同じ名前があれば別の名前にします（上書きしません）。</div>
        </div>`;
}
window.setDropboxAppKey = function(v) {
    const k = String(v || '').trim();
    if(k && !/^[a-z0-9]{8,32}$/i.test(k)) { showToast('アプリキーの形が違います（英数字。Dropbox の App key をそのまま貼り付けてください）', { kind: 'warn', ms: 4000 }); return; }
    const changed = k !== (_dbxLs.get('cad_dropbox_key') || '');
    _dbxLs.set('cad_dropbox_key', k);
    if(changed) { _dbxLs.set('cad_dropbox_auth', null); _dbxLs.set('cad_dropbox_pkce', null); _dbxPkce = null; _dbxLoading = null; _dbxFolderCache = {}; } // 別のアプリのキーなら、つなぎ直す
    if(typeof showOptionsPanel === 'function' && document.getElementById('opt-dropbox')) showOptionsPanel();
};
window.setDropboxFolder = function(v) {
    const f = _dbxNormFolder(v);
    _dbxLs.set('cad_dropbox_folder', f || '/');
    const el = document.getElementById('opt-dbx-folder');
    if(el) el.value = f || '/';
};
// 図面が変わったとき（cad-core.js の setDrawingName から）。Dropbox から開いたファイルの図面になったときだけ、そのフォルダを覚える。
// 名前で見分ける（開くのをやめた・時間がかかった・ほかのファイルを開いたときに、間違ったフォルダを覚えないよう）。
// 図面一式（.webcad・PDF）は中の図面名になるので、開いた直後の1回（「新規図面」以外）をその図面とみなす
function _dbxBase(n) { return String(n || '').replace(/\.[^./]+$/, '').replace(/_図面一式$/, '').trim(); }
function dropboxDrawingChanged(name) {
    const L = _dbxLastOpened;
    if(!L) return;
    if(L.pending) {
        const pack = /\.(webcad|pdf)$/i.test(L.name);
        if(name === L.name || _dbxBase(name) === _dbxBase(L.name) || (pack && name && name !== '新規図面')) { L.pending = false; return; }
    }
    _dbxLastOpened = null;
}

window.dropboxOpen = dropboxOpen;
window.dropboxConnectStart = dropboxConnectStart;
window.dropboxConnectFinish = dropboxConnectFinish;
window.dropboxDisconnect = dropboxDisconnect;
