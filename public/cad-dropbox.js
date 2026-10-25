// ===== Web CAD Dropbox 連携（v5.54・v5.56） =====
// cad-dropbox.js - Dropbox から図面を開く・書き出したファイルを Dropbox に保存する（どちらも Dropbox の API）。
//   ・使うには Dropbox のアプリキー（App key）が要る。DROPBOX_APP_KEY に書くか、⚙ オプションの「Dropbox」で入れる（端末に覚える）。
//   ・1回だけ「Dropbox につなぐ」（OAuth 2 の PKCE。コードを貼り付ける形。iPhone のホーム画面のアプリでも使える）。
//   ・開く: アプリの中の一覧（files/list_folder）でフォルダをたどってファイルを選び、files/download で読んで、
//     📁 開く と同じ openIncomingFile で開く（DXF・DWG・JWW・SIMA・CSV・SDR・図面一式）。
//     v5.56: 以前は Dropbox の Chooser（dropins.js）を使っていたが、よそのスクリプトがアプリの中で動くと
//     端末に置いたキー・token を読めてしまうため、使わないようにした（CSP でも dropbox.com のスクリプトを止めている）。
//   ・保存: files/upload で送る。保存先は、Dropbox から開いたファイルと同じフォルダ（分からなければオプションの保存先。初めは /WebCAD）。
//     同じ名前があれば「名前 (1).dxf」のように別の名前にする（上書きしない）。
//   ・アプリキーは秘密ではない（ブラウザで動くアプリは、どのみち見える）。秘密のキー（App secret）は使わない。

const DROPBOX_APP_KEY = ''; // 作ったアプリキーをここに書くと、どの端末でもオプションに入れずに使える
const DBX_OPEN_EXTS = ['.dxf', '.dwg', '.jww', '.sim', '.csv', '.txt', '.sdr', '.webcad', '.pdf'];
const DBX_DEFAULT_FOLDER = '/WebCAD';
const DBX_UPLOAD_MAX = 150 * 1024 * 1024; // files/upload で1回に送れる大きさ
const DBX_OPEN_MAX = 200 * 1024 * 1024;   // 開くファイルの大きさの上限（端末の記憶を使い切らないように）
const DBX_LIST_MAX = 5000;                // 1つのフォルダで読む数の上限
// 開いたファイルのフォルダを知る・読む・保存する
const DBX_SCOPE = 'files.metadata.read files.content.read files.content.write';

const _dbxLs = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if(v === null || v === undefined || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 覚えられなくても続ける */ } },
};
let _dbxPkce = null;       // つなぐ途中の { verifier }（コードを貼り付けるまで）
let _dbxLastOpened = null; // Dropbox から開いたファイル { id, name, pending }（保存先のフォルダを決める）
let _dbxFolderCache = {};  // ファイルの id → フォルダ
let _dbxBrowse = null;     // 開く一覧 { path, entries, others, busy }

function dropboxAppKey() { return (_dbxLs.get('cad_dropbox_key') || DROPBOX_APP_KEY || '').trim(); }
function dropboxEnabled() { return !!dropboxAppKey(); }
function dropboxSaveFolder() { return _dbxNormFolder(_dbxLs.get('cad_dropbox_folder') || DBX_DEFAULT_FOLDER); }
function _dbxNormFolder(f) {
    let s = String(f || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if(!s || s === '/') return '';
    if(!s.startsWith('/')) s = '/' + s;
    return s.replace(/\/$/, '');
}
function _dbxParent(p) { const s = String(p || ''); return s.includes('/') ? _dbxNormFolder(s.slice(0, s.lastIndexOf('/'))) : ''; }
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

function _dbxNeedKey() {
    if(typeof showSnack === 'function') showSnack('Dropbox を使うには、アプリキーを入れてください', { kind: 'warn', ms: 8000, action: { label: '⚙ オプション', run: () => { if(typeof showOptionsPanel === 'function') showOptionsPanel(); } } });
}
function _dbxNeedConnect(what) {
    showSnack(`Dropbox ${what}には、1回だけ Dropbox につないでください`, { kind: 'warn', ms: 9000, action: { label: '☁ つなぐ', run: () => dropboxConnectStart() } });
}

// ===== つなぐ（OAuth 2 PKCE・コードを貼り付ける形） =====
// 許可の画面は、パネルのリンク（<a target="_blank">）を押して開く（待ってから window.open すると、iPhone・iPad では窓を止められるため）。
// verifier は端末に30分だけ覚える（ホーム画面のアプリから Safari でログインしている間に、アプリが閉じられても使えるように）
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
            <a class="prop-btn" id="dbx-auth-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="text-align:center;text-decoration:none;">☁ Dropbox の画面を開く</a>
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
        showToast('Dropbox につなぎました。☰ の「☁ Dropbox から開く」と、書き出したあとの「☁ Dropbox へ」が使えます', { kind: 'success', ms: 4500 });
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
// Dropbox 側でも許可を取り消す（端末から消すだけだと、Dropbox に refresh token が残る）。使える token が無ければ何もしない
async function _dbxRevoke() {
    if(!dropboxConnected() || !_dbxOnline()) return;
    try {
        const t = await _dbxToken();
        if(t) await window.fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
    } catch { /* 取り消せなくても端末からは消す */ }
}
// アプリキーを変える前の許可を取り消す（前のキーで token を取り直してから）。失敗しても続ける
async function _dbxRevokeOld(auth, appKey) {
    if(!auth || !auth.refresh || !appKey || !_dbxOnline()) return;
    try {
        let t = (auth.access && auth.exp > Date.now()) ? auth.access : null;
        if(!t) t = (await _dbxTokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: appKey })).access_token;
        if(t) await window.fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
    } catch { /* 取り消せなくても端末からは消す */ }
}
async function dropboxDisconnect() {
    await _dbxRevoke();
    _dbxLs.set('cad_dropbox_auth', null);
    _dbxFolderCache = {};
    _dbxBrowse = null;
    hideSnack();
    addCommandLog('-> Dropbox との接続を切りました');
    showToast('Dropbox との接続を切りました', { ms: 2500 });
    if(typeof showOptionsPanel === 'function' && document.getElementById('opt-dropbox')) showOptionsPanel();
}

// Dropbox の API を呼ぶ。token の期限切れは取り直して1回だけ送り直す。許可が取り消されていればつなぎ直しを出して null。
// 許可（scope）が足りなければ、つなぎ直しを出して null（v5.56 で「読む」許可を足したため、前につないだ人はつなぎ直しが要る）
async function _dbxCall(send) {
    let token = await _dbxToken();
    if(!token) return null;
    let res = await send(token);
    const readErr = async (r) => { try { return await (r.clone ? r.clone() : r).json(); } catch { return null; } };
    if(res.status === 401) {
        let j = await readErr(res);
        const tag = j && j.error && j.error['.tag'];
        if(tag === 'expired_access_token') {
            token = await _dbxToken(true);
            if(!token) return null;
            res = await send(token);
            if(res.status === 401) j = await readErr(res);
        }
        if(res.status === 401) {
            const t2 = j && j.error && j.error['.tag'];
            if(t2 === 'missing_scope') {
                showSnack('Dropbox の許可が足りません。Dropbox のアプリの Permissions で files.content.read にチェックして Submit し、つなぎ直してください', { kind: 'warn', ms: 12000, action: { label: '☁ つなぐ', run: () => dropboxConnectStart() } });
            } else _dbxLost();
            return null;
        }
    }
    return res;
}

// ===== 開く（アプリの中の一覧） =====
function _dbxIsOpenable(name) { const n = String(name || '').toLowerCase(); return DBX_OPEN_EXTS.some((e) => n.endsWith(e)); }
async function dropboxOpen() {
    if(!dropboxEnabled()) { _dbxNeedKey(); return; }
    if(!dropboxConnected()) { _dbxNeedConnect('から開く'); return; }
    if(!_dbxOnline()) { showToast('電波が無いので Dropbox を使えません', { kind: 'warn', ms: 3000 }); return; }
    const last = _dbxLastOpened && _dbxLastOpened.id && _dbxFolderCache[_dbxLastOpened.id];
    const start = (_dbxBrowse && typeof _dbxBrowse.path === 'string') ? _dbxBrowse.path : (typeof last === 'string' ? last : dropboxSaveFolder());
    await dropboxBrowse(start, true);
}
// フォルダの中身を読んで一覧を出す。fallbackRoot: 無いフォルダならいちばん上を出す
async function dropboxBrowse(path, fallbackRoot) {
    const p = _dbxNormFolder(path);
    _dbxBrowse = { path: p, entries: [], others: 0, busy: true };
    _dbxRenderBrowse();
    try {
        const list = (body) => _dbxCall((t) => window.fetch('https://api.dropboxapi.com/2/files/list_folder' + (body.cursor ? '/continue' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
        let res = await list({ path: p, limit: 2000, include_non_downloadable_files: false });
        if(!res) { _dbxBrowse = null; hidePropertyPanel(); return; }
        if(res.status === 409 && fallbackRoot && p) return dropboxBrowse('', false); // 保存先のフォルダがまだ無い: いちばん上
        let j = await res.json().catch(() => null);
        if(!res.ok || !j) throw new Error((j && j.error_summary) || `一覧を読めませんでした（${res.status}）`);
        const all = [...(j.entries || [])];
        while(j.has_more && all.length < DBX_LIST_MAX) {
            res = await list({ cursor: j.cursor });
            if(!res) return;
            j = await res.json().catch(() => null);
            if(!res.ok || !j) break;
            all.push(...(j.entries || []));
        }
        const folders = all.filter((e) => e['.tag'] === 'folder').sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        const files = all.filter((e) => e['.tag'] === 'file' && _dbxIsOpenable(e.name)).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        const others = all.filter((e) => e['.tag'] === 'file' && !_dbxIsOpenable(e.name)).length;
        _dbxBrowse = { path: p, entries: [...folders, ...files], others, busy: false, more: !!j.has_more };
        _dbxRenderBrowse();
    } catch(err) {
        _dbxBrowse = { path: p, entries: [], others: 0, busy: false, error: (err && err.message) || String(err) };
        _dbxRenderBrowse();
    }
}
function _dbxSizeText(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
function _dbxRenderBrowse() {
    const B = _dbxBrowse;
    if(!B) return;
    const crumbs = [{ name: 'Dropbox', path: '' }];
    B.path.split('/').filter(Boolean).forEach((seg, i, arr) => crumbs.push({ name: seg, path: '/' + arr.slice(0, i + 1).join('/') }));
    let h = '<div id="dbx-browse" style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:#ddd;">';
    h += '<div class="dbx-crumbs">' + crumbs.map((c, i) => `<button class="status-btn dbx-crumb" data-i="${i}" onclick="dropboxBrowseCrumb(${i})">${escapeHtml(c.name)}</button>`).join('<span class="dbx-sep">/</span>') + '</div>';
    if(B.busy) h += '<div class="cogo-note">読んでいます…</div>';
    else if(B.error) h += `<div class="cogo-note" style="color:#ff6b6b;">${escapeHtml(B.error)}</div>`;
    else {
        h += '<div class="dbx-list" role="list">';
        if(B.path) h += '<button class="dbx-item dbx-up" onclick="dropboxBrowseUp()" role="listitem">⬆ 上のフォルダへ</button>';
        B.entries.forEach((e, i) => {
            if(e['.tag'] === 'folder') h += `<button class="dbx-item dbx-folder" data-i="${i}" onclick="dropboxBrowseEnter(${i})" role="listitem">📁 ${escapeHtml(e.name)}</button>`;
            else h += `<button class="dbx-item dbx-file" data-i="${i}" onclick="dropboxBrowsePick(${i})" role="listitem"><span class="dbx-name">📄 ${escapeHtml(e.name)}</span><span class="dbx-meta">${_dbxSizeText(e.size || 0)}${e.server_modified ? '・' + escapeHtml(String(e.server_modified).slice(0, 10)) : ''}</span></button>`;
        });
        if(!B.entries.length) h += '<div class="cogo-note">開けるファイル（DXF・DWG・JWW・SIMA・座標CSV・SDR・図面一式）とフォルダはありません</div>';
        h += '</div>';
        if(B.others) h += `<div style="color:#888;font-size:10px;">ほかの種類のファイル ${B.others}個 は出していません</div>`;
        if(B.more) h += `<div style="color:#888;font-size:10px;">ファイルが多いので、${DBX_LIST_MAX}個までを出しています</div>`;
    }
    h += '</div>';
    showPropertyPanel('☁ Dropbox から開く', h);
}
window.dropboxBrowseCrumb = function(i) {
    const B = _dbxBrowse; if(!B || B.busy) return;
    const segs = B.path.split('/').filter(Boolean);
    dropboxBrowse(i === 0 ? '' : '/' + segs.slice(0, i).join('/'));
};
window.dropboxBrowseUp = function() { const B = _dbxBrowse; if(B && !B.busy) dropboxBrowse(_dbxParent(B.path)); };
window.dropboxBrowseEnter = function(i) {
    const B = _dbxBrowse; const e = B && B.entries[i];
    if(!e || B.busy || e['.tag'] !== 'folder') return;
    dropboxBrowse(e.path_display || e.path_lower || (B.path + '/' + e.name));
};
window.dropboxBrowsePick = async function(i) {
    const B = _dbxBrowse; const e = B && B.entries[i];
    if(!e || B.busy || e['.tag'] !== 'file') return;
    if((e.size || 0) > DBX_OPEN_MAX) { showToast(`大きすぎて開けません（${_dbxSizeText(DBX_OPEN_MAX)} まで）`, { kind: 'warn', ms: 3500 }); return; }
    showToast(`Dropbox から ${e.name} を読んでいます…`, { ms: 2500 });
    try {
        const res = await _dbxCall((t) => window.fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Dropbox-API-Arg': dropboxApiArg({ path: e.id || e.path_lower }) } }));
        if(!res) return;
        if(!res.ok) { const j = await res.json().catch(() => null); throw new Error((j && j.error_summary) || `読めませんでした（${res.status}）`); }
        const blob = await res.blob();
        const file = new File([blob], e.name, { type: 'application/octet-stream' });
        _dbxLastOpened = { id: e.id || null, name: e.name, pending: true };
        if(e.id) _dbxFolderCache[e.id] = _dbxParent(e.path_display || e.path_lower || '');
        addCommandLog(`-> Dropbox から開きます: ${e.path_display || e.name}`);
        hidePropertyPanel();
        openIncomingFile(file);
    } catch(err) {
        showToast(`Dropbox から開けませんでした: ${(err && err.message) || err}`, { kind: 'error', ms: 4500 });
    }
};

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
                if(p.includes('/')) { const f = _dbxParent(p); _dbxFolderCache[last.id] = f; return f; }
            }
        } catch { /* 分からなければ決めた保存先 */ }
    }
    return dropboxSaveFolder();
}
async function dropboxSaveBlob(blob, filename) {
    if(!dropboxEnabled()) { _dbxNeedKey(); return null; }
    if(!dropboxConnected()) { _dbxNeedConnect('に保存する'); return null; }
    if(!_dbxOnline()) { showToast('電波が無いので Dropbox に保存できません（端末には保存してあります）', { kind: 'warn', ms: 3500 }); return null; }
    if(blob.size > DBX_UPLOAD_MAX) { showToast('150MB より大きいファイルは Dropbox に送れません', { kind: 'error', ms: 3500 }); return null; }
    const name = String(filename || 'webcad').replace(/[\\/:*?"<>|]/g, '_');
    try {
        const token0 = await _dbxToken();
        if(!token0) return null; // 許可が切れた（つなぎ直しを出した）
        const folder = await dropboxTargetFolder(token0);
        const path = `${folder}/${name}`;
        showToast(`Dropbox に保存しています… ${path}`, { ms: 2500 });
        const res = await _dbxCall((t) => window.fetch('https://content.dropboxapi.com/2/files/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': dropboxApiArg({ path, mode: 'add', autorename: true, mute: false, strict_conflict: false }) },
            body: blob,
        }));
        if(!res) return null;
        let j = null;
        try { j = await res.json(); } catch { /* 下で知らせる */ }
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
    const status = !key ? 'アプリキーが入っていません' : (dropboxConnected() ? '✅ つないでいます（開く・保存ができます）' : '開く・保存するには「つなぐ」を押してください（1回だけ）');
    return `
        <div id="opt-dropbox" style="border-top:1px solid rgba(255,255,255,0.1); margin-top:10px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:11px;color:#aaa;font-weight:700;">☁ Dropbox</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;">アプリキー<input class="prop-val" id="opt-dbx-key" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:0;" value="${escapeHtml(own ? key : '')}" placeholder="${DROPBOX_APP_KEY ? '（アプリに入っているキーを使います）' : 'Dropbox の App key'}" onchange="setDropboxAppKey(this.value)"></label>
            <div style="font-size:11px;color:#ddd;" id="opt-dbx-status">${escapeHtml(status)}</div>
            <div style="display:flex;gap:6px;">
                ${dropboxConnected() ? '<button class="prop-btn btn-sub" style="flex:1;" onclick="dropboxDisconnect()">接続を切る</button>' : `<button class="prop-btn" style="flex:1;" onclick="dropboxConnectStart()"${key ? '' : ' disabled'} title="開く・保存するために、1回だけ Dropbox につなぎます">☁ つなぐ</button>`}
                <button class="prop-btn btn-sub" style="flex:1;" onclick="dropboxOpen()"${key ? '' : ' disabled'} title="Dropbox のファイルを選んで開きます">☁ 開く</button>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#ddd;">保存先<input class="prop-val" id="opt-dbx-folder" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:0;" value="${escapeHtml(dropboxSaveFolder() || '/')}" onchange="setDropboxFolder(this.value)"></label>
            <div style="color:#888;font-size:10px;">☰ の「☁ Dropbox から開く」で、Dropbox のフォルダをたどって開きます。書き出したあとの知らせの「☁ Dropbox へ」で保存します。Dropbox から開いた図面は、そのファイルと同じフォルダに保存します（ほかは上の保存先）。同じ名前があれば別の名前にします（上書きしません）。</div>
        </div>`;
}
window.setDropboxAppKey = function(v) {
    const k = String(v || '').trim();
    if(k && !/^[a-z0-9]{8,32}$/i.test(k)) { showToast('アプリキーの形が違います（英数字。Dropbox の App key をそのまま貼り付けてください）', { kind: 'warn', ms: 4000 }); return; }
    const changed = k !== (_dbxLs.get('cad_dropbox_key') || '');
    if(changed) _dbxRevokeOld(_dbxAuth(), dropboxAppKey()); // 前のアプリの許可は、Dropbox 側でも取り消す（待たずに裏で）
    _dbxLs.set('cad_dropbox_key', k);
    if(changed) { _dbxLs.set('cad_dropbox_auth', null); _dbxLs.set('cad_dropbox_pkce', null); _dbxPkce = null; _dbxFolderCache = {}; _dbxBrowse = null; } // 別のアプリのキーなら、つなぎ直す
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
