'use strict';
// Dropbox 連携（v5.54。cad-dropbox.js）: Chooser で開く・つなぐ（PKCE・コードを貼り付け）・files/upload で保存・保存先のフォルダ・
// 書き出したあとの「☁ Dropbox へ」。Dropbox の通信は代わりの fetch で受ける（本物の Dropbox には送らない）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { loadApp } = require('./helpers/load-app.cjs');

describe('Dropbox 連携', () => {
    let app, w, calls, routes;
    before(async () => {
        app = await loadApp();
        w = app.window;
        Object.defineProperty(w, 'crypto', { value: nodeCrypto.webcrypto, configurable: true });
    });
    after(() => app.close());
    beforeEach(() => {
        calls = []; routes = {};
        // 代わりの fetch: URL ごとに決めた答えを返し、呼ばれた中身を残す
        w.fetch = async (url, opt) => {
            const body = opt && opt.body;
            calls.push({ url: String(url), opt: opt || {}, body: typeof body === 'string' ? body : body });
            const r = routes[String(url).split('?')[0]] || { status: 404, json: { error: 'not found' } };
            const v = typeof r === 'function' ? r(url, opt) : r;
            return { ok: v.status >= 200 && v.status < 300, status: v.status, json: async () => v.json, blob: async () => new w.Blob([v.text || ''], { type: 'application/octet-stream' }) };
        };
        w.open = (u) => { w.__opened = u; return null; };
        w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
        w.HTMLAnchorElement.prototype.click = function () { w.__downloaded = this.download; }; // 保存（ダウンロード）は名前を控えるだけ
        app.eval(`localStorage.removeItem('cad_dropbox_key'); localStorage.removeItem('cad_dropbox_auth'); localStorage.removeItem('cad_dropbox_folder'); localStorage.removeItem('cad_dropbox_pkce');
            _dbxPkce = null; _dbxLastOpened = null; _dbxFolderCache = {}; hideSnack(); closePropertyPanel();`);
    });
    const snack = () => app.val(`(() => { const s = document.getElementById('cad-snack'); if(!s || !s.classList.contains('show')) return null;
        return { msg: s.querySelector('.sn-msg').textContent, acts: [...s.querySelectorAll('.sn-act')].filter((b) => b.style.display !== 'none').map((b) => b.textContent) }; })()`);
    const connect = () => app.eval(`localStorage.setItem('cad_dropbox_key', 'abcd1234efgh'); localStorage.setItem('cad_dropbox_auth', JSON.stringify({ access: 'AT1', exp: Date.now() + 3600000, refresh: 'RT1' }));`);

    it('Dropbox-API-Arg は ASCII だけ（日本語は \\uXXXX）。戻すと同じ中身', () => {
        const s = app.val(`dropboxApiArg({ path: '/現場/図面 A①.dxf', mode: 'add' })`);
        assert.ok(/^[\x20-\x7e]*$/.test(s), s);
        assert.deepEqual(JSON.parse(s), { path: '/現場/図面 A①.dxf', mode: 'add' });
    });

    it('PKCE: challenge は verifier の SHA-256 を base64url にしたもの', async () => {
        await app.eval(`dropboxPkcePair().then((p) => { window.__p = p; })`);
        await new Promise((r) => setTimeout(r, 50));
        const p = app.val('window.__p');
        assert.ok(p.verifier.length >= 43 && p.verifier.length <= 128 && /^[A-Za-z0-9_-]+$/.test(p.verifier));
        assert.equal(p.challenge, nodeCrypto.createHash('sha256').update(p.verifier).digest('base64url'));
    });

    it('アプリキーが無ければ、開く・保存は「⚙ オプション」へ案内する。形の違うキーは入れない', () => {
        app.eval('dropboxOpen()');
        assert.deepEqual(snack().acts, ['⚙ オプション']);
        app.eval(`setDropboxAppKey('https://bad key')`);
        assert.equal(app.val('dropboxAppKey()'), '');
        app.eval(`setDropboxAppKey(' abcd1234efgh ')`);
        assert.equal(app.val('dropboxAppKey()'), 'abcd1234efgh');
        assert.equal(app.val('dropboxEnabled()'), true);
    });

    it('つなぐ: 許可の画面を開き（コードを貼る形・offline）、貼ったコードで token をもらって覚える。キーを変えたら外す', async () => {
        app.eval(`setDropboxAppKey('abcd1234efgh')`);
        routes['https://api.dropboxapi.com/oauth2/token'] = { status: 200, json: { access_token: 'AT1', expires_in: 14400, refresh_token: 'RT1', account_id: 'dbid:x' } };
        await app.eval('dropboxConnectStart()');
        await new Promise((r) => setTimeout(r, 50));
        // 許可の画面は、パネルのリンクを押して開く（待ってから window.open すると iPhone で止められる）
        assert.equal(w.__opened, undefined);
        assert.equal(app.val(`document.getElementById('dbx-auth-link').target`), '_blank');
        const u = new URL(app.val(`document.getElementById('dbx-auth-link').href`));
        assert.equal(u.origin + u.pathname, 'https://www.dropbox.com/oauth2/authorize');
        assert.equal(u.searchParams.get('client_id'), 'abcd1234efgh');
        assert.equal(u.searchParams.get('response_type'), 'code');
        assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(u.searchParams.get('token_access_type'), 'offline');
        assert.equal(u.searchParams.get('redirect_uri'), null, 'コードを画面に出す形（ホーム画面のアプリでも戻れる）');
        assert.equal(u.searchParams.get('scope'), 'files.metadata.read files.content.write', '使う許可だけ');
        assert.equal(app.val(`!!document.getElementById('dbx-code')`), true, 'コードを貼る欄');
        const verifier = app.val('_dbxPkce.verifier');
        // ログインの間にアプリが閉じられても（画面の中の値が消えても）、端末に覚えた verifier で続けられる
        app.eval('_dbxPkce = null');
        assert.equal(u.searchParams.get('code_challenge'), nodeCrypto.createHash('sha256').update(verifier).digest('base64url'));
        await app.eval(`dropboxConnectFinish('  THE-CODE  ').then((ok) => { window.__ok = ok; })`);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(app.val('window.__ok'), true);
        const body = new globalThis.URLSearchParams(calls.at(-1).body);
        assert.equal(body.get('code'), 'THE-CODE');
        assert.equal(body.get('grant_type'), 'authorization_code');
        assert.equal(body.get('code_verifier'), verifier);
        assert.equal(body.get('client_id'), 'abcd1234efgh');
        assert.equal(app.val('dropboxConnected()'), true);
        assert.equal(app.val(`JSON.parse(localStorage.getItem('cad_dropbox_auth')).refresh`), 'RT1');
        app.eval(`setDropboxAppKey('zzzz1234efgh')`);
        assert.equal(app.val('dropboxConnected()'), false, '別のアプリのキーならつなぎ直す');
        assert.deepEqual(app.errors(), []);
    });

    it('保存: /WebCAD に送る（名前に使えない文字は _。同じ名前は別の名前・上書きしない）。期限が切れていたら取り直す', async () => {
        connect();
        app.eval(`localStorage.setItem('cad_dropbox_auth', JSON.stringify({ access: 'OLD', exp: Date.now() - 1000, refresh: 'RT1' }))`);
        routes['https://api.dropboxapi.com/oauth2/token'] = { status: 200, json: { access_token: 'AT2', expires_in: 14400 } };
        routes['https://content.dropboxapi.com/2/files/upload'] = (url, opt) => ({ status: 200, json: { path_display: JSON.parse(opt.headers['Dropbox-API-Arg']).path.replace('.dxf', ' (1).dxf') } });
        await app.eval(`dropboxSaveBlob(new Blob(['0\\nEOF']), '現場:A.dxf').then((p) => { window.__saved = p; })`);
        await new Promise((r) => setTimeout(r, 50));
        const refresh = new globalThis.URLSearchParams(calls[0].body);
        assert.equal(refresh.get('grant_type'), 'refresh_token');
        assert.equal(refresh.get('refresh_token'), 'RT1');
        const up = calls.at(-1);
        assert.equal(up.url, 'https://content.dropboxapi.com/2/files/upload');
        assert.equal(up.opt.headers.Authorization, 'Bearer AT2');
        assert.deepEqual(JSON.parse(up.opt.headers['Dropbox-API-Arg']), { path: '/WebCAD/現場_A.dxf', mode: 'add', autorename: true, mute: false, strict_conflict: false });
        assert.equal(app.val('window.__saved'), '/WebCAD/現場_A (1).dxf');
        assert.equal(app.val(`JSON.parse(localStorage.getItem('cad_dropbox_auth')).access`), 'AT2');
        assert.equal(app.val(`JSON.parse(localStorage.getItem('cad_dropbox_auth')).refresh`), 'RT1', 'refresh token は残す');
    });

    it('つないでいないときの保存は「☁ つなぐ」を出すだけで、送らない', async () => {
        app.eval(`setDropboxAppKey('abcd1234efgh')`);
        await app.eval(`dropboxSaveBlob(new Blob(['x']), 'a.dxf')`);
        assert.equal(calls.length, 0);
        assert.deepEqual(snack().acts, ['☁ つなぐ']);
    });

    it('Chooser で選んだファイルを読んで開き、保存はそのファイルと同じフォルダへ。別の図面にしたら決めた保存先に戻る', async () => {
        connect();
        app.eval(`setDropboxFolder('現場データ/')`);
        assert.equal(app.val('dropboxSaveFolder()'), '/現場データ');
        // Chooser（dropins.js）の代わり
        app.eval(`window.Dropbox = { choose: (o) => { window.__chooseOpt = o; o.success([{ link: 'https://dl.dropboxusercontent.com/x/plan.dxf', name: '平面図.dxf', id: 'id:abc', bytes: 5 }]); } };
            window.__opened = []; openIncomingFile = (f) => { window.__opened.push(f.name); setDrawingName(f.name); };`);
        routes['https://dl.dropboxusercontent.com/x/plan.dxf'] = { status: 200, text: '0\nEOF' };
        app.eval('dropboxOpen()');
        await new Promise((r) => setTimeout(r, 50));
        assert.deepEqual(app.val('window.__opened'), ['平面図.dxf']);
        assert.equal(app.val('window.__chooseOpt.linkType'), 'direct');
        assert.ok(app.val('window.__chooseOpt.extensions').includes('.jww'));
        routes['https://api.dropboxapi.com/2/files/get_metadata'] = { status: 200, json: { path_display: '/案件/2026 現場A/平面図.dxf' } };
        routes['https://content.dropboxapi.com/2/files/upload'] = (url, opt) => ({ status: 200, json: { path_display: JSON.parse(opt.headers['Dropbox-API-Arg']).path } });
        await app.eval(`dropboxSaveBlob(new Blob(['x']), '平面図_修正.dxf').then((p) => { window.__saved = p; })`);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('get_metadata')).opt.body).path, 'id:abc');
        assert.equal(app.val('window.__saved'), '/案件/2026 現場A/平面図_修正.dxf');
        // 別の図面にした（閉じた・ほかのファイルを開いた）
        app.eval(`setDrawingName('新規図面')`);
        await app.eval(`dropboxSaveBlob(new Blob(['x']), 'b.dxf').then((p) => { window.__saved = p; })`);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(app.val('window.__saved'), '/現場データ/b.dxf');
        app.eval('delete window.Dropbox');
    });

    it('書き出したあとの知らせに「☁ Dropbox へ」を出す（キーが無ければ出さない）。押すとそのファイルを保存する', async () => {
        await app.eval(`downloadBlob(new Blob(['x']), 'a.dxf', undefined, { named: true })`);
        assert.equal(snack(), null, 'キーが無ければ今までどおり');
        connect();
        routes['https://content.dropboxapi.com/2/files/upload'] = (url, opt) => ({ status: 200, json: { path_display: JSON.parse(opt.headers['Dropbox-API-Arg']).path } });
        await app.eval(`downloadBlob(new Blob(['x']), 'b.sim', undefined, { named: true })`);
        assert.deepEqual(snack(), { msg: 'b.sim を保存しました', acts: ['☁ Dropbox へ'] });
        app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(JSON.parse(calls.at(-1).opt.headers['Dropbox-API-Arg']).path, '/WebCAD/b.sim');
        assert.deepEqual(app.errors(), []);
    });

    it('オプションの欄: キー・状態・つなぐ／切る・保存先。切ると端末から消す', async () => {
        connect();
        app.eval('showOptionsPanel()');
        assert.equal(app.val(`document.getElementById('opt-dbx-key').value`), 'abcd1234efgh');
        assert.match(app.val(`document.getElementById('opt-dbx-status').textContent`), /つないでいます/);
        routes['https://api.dropboxapi.com/2/auth/token/revoke'] = { status: 200, json: null };
        await app.eval('dropboxDisconnect()');
        assert.equal(app.val('dropboxConnected()'), false);
        assert.ok(calls.some((c) => c.url.endsWith('/auth/token/revoke')));
        assert.equal(app.val(`!!document.querySelector('#opt-dropbox [onclick="dropboxConnectStart()"]')`), true);
        assert.deepEqual(app.errors(), []);
    });

    // ---- G3 の点検で見つけたもの ----
    it('図面一式をスマホで書き出したとき（PDF で送る）も「☁ Dropbox へ」を出し、送るのは .webcad（PDF ではない）', async () => {
        connect();
        app.eval(`window.__sh = _shareTouchDevice; _shareTouchDevice = () => true; window.__ns = navigator.share; Object.defineProperty(navigator, 'share', { value: () => Promise.resolve(), configurable: true });
            window.__cs = navigator.canShare; Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
            window.__wp = webcadPdf; webcadPdf = async () => new Uint8Array([37, 80, 68, 70]);`);
        routes['https://content.dropboxapi.com/2/files/upload'] = (url, opt) => ({ status: 200, json: { path_display: JSON.parse(opt.headers['Dropbox-API-Arg']).path } });
        try {
            await app.eval(`(async () => { entities.length = 0; entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }); ensureEntityIds(); await exportWebcadFile(); })()`);
            await new Promise((r) => setTimeout(r, 600));
            const sn = snack();
            assert.ok(sn && sn.acts.includes('📤 送る') && sn.acts.includes('☁ Dropbox へ'), JSON.stringify(sn));
            app.eval(`[...document.querySelectorAll('#cad-snack .sn-act')].find((b) => b.textContent === '☁ Dropbox へ').click()`);
            await new Promise((r) => setTimeout(r, 50));
            assert.match(JSON.parse(calls.at(-1).opt.headers['Dropbox-API-Arg']).path, /\.webcad$/);
        } finally {
            app.eval(`_shareTouchDevice = window.__sh; webcadPdf = window.__wp; Object.defineProperty(navigator, 'share', { value: window.__ns, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: window.__cs, configurable: true });`);
        }
    });

    it('Dropbox から開くのをやめた・ほかのファイルを開いたときは、そのフォルダに保存しない。時間がかかっても名前で覚える', async () => {
        connect();
        routes['https://api.dropboxapi.com/2/files/get_metadata'] = { status: 200, json: { path_display: '/案件A/平面図.dxf' } };
        routes['https://content.dropboxapi.com/2/files/upload'] = (url, opt) => ({ status: 200, json: { path_display: JSON.parse(opt.headers['Dropbox-API-Arg']).path } });
        const save = async (n) => { await app.eval(`dropboxSaveBlob(new Blob(['x']), '${n}').then((p) => { window.__saved = p; })`); await new Promise((r) => setTimeout(r, 30)); return app.val('window.__saved'); };
        // 開くのをやめた（setDrawingName が呼ばれない）
        app.eval(`_dbxLastOpened = { id: 'id:abc', name: '平面図.dxf', pending: true }`);
        assert.equal(await save('other.dxf'), '/WebCAD/other.dxf');
        // そのあと、ほかのファイル（端末）を開いた
        app.eval(`setDrawingName('端末の図面.dxf')`);
        assert.equal(app.val('_dbxLastOpened'), null);
        assert.equal(await save('other.dxf'), '/WebCAD/other.dxf');
        // 開くのに時間がかかっても、名前が合えば覚える（拡張子・大文字小文字は問わない）
        app.eval(`_dbxLastOpened = { id: 'id:abc', name: '平面図.DWG', pending: true }; setDrawingName('平面図.dwg')`);
        assert.equal(await save('a.dxf'), '/案件A/a.dxf');
        // 図面一式は中の図面名になる
        app.eval(`_dbxFolderCache = {}; _dbxLastOpened = { id: 'id:abc', name: '現場A_図面一式.pdf', pending: true }; setDrawingName('現場Aの図面')`);
        assert.equal(await save('b.dxf'), '/案件A/b.dxf');
    });

    it('許可が取り消された（refresh token が使えない）ら、つなぎ直しを出して印を消す。access token の期限切れは取り直して1回だけ送り直す', async () => {
        connect();
        app.eval(`localStorage.setItem('cad_dropbox_auth', JSON.stringify({ access: 'OLD', exp: Date.now() - 1000, refresh: 'RT1' }))`);
        routes['https://api.dropboxapi.com/oauth2/token'] = { status: 400, json: { error: 'invalid_grant', error_description: 'refresh token is invalid or revoked' } };
        await app.eval(`dropboxSaveBlob(new Blob(['x']), 'a.dxf')`);
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(app.val('dropboxConnected()'), false);
        assert.deepEqual(snack().acts, ['☁ つなぐ']);
        assert.ok(!calls.some((c) => c.url.includes('/files/upload')));
        // 期限切れの 401 → 取り直して送り直す
        connect();
        let n = 0;
        routes['https://api.dropboxapi.com/oauth2/token'] = { status: 200, json: { access_token: 'AT9', expires_in: 14400 } };
        routes['https://content.dropboxapi.com/2/files/upload'] = (url, opt) => (++n === 1 ? { status: 401, json: { error: { '.tag': 'expired_access_token' } } } : { status: 200, json: { path_display: '/WebCAD/a.dxf' } });
        await app.eval(`dropboxSaveBlob(new Blob(['x']), 'a.dxf').then((p) => { window.__saved = p; })`);
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(app.val('window.__saved'), '/WebCAD/a.dxf');
        assert.equal(calls.filter((c) => c.url.includes('/files/upload')).at(-1).opt.headers.Authorization, 'Bearer AT9');
        assert.equal(app.val('dropboxConnected()'), true);
        // 取り消された 401 → つなぎ直し
        routes['https://content.dropboxapi.com/2/files/upload'] = { status: 401, json: { error: { '.tag': 'invalid_access_token' } } };
        await app.eval(`dropboxSaveBlob(new Blob(['x']), 'a.dxf')`);
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(app.val('dropboxConnected()'), false);
    });

    it('接続を切るときは、使える token（期限切れなら取り直す）で revoke を送る', async () => {
        connect();
        app.eval(`localStorage.setItem('cad_dropbox_auth', JSON.stringify({ access: 'EXPIRED', exp: Date.now() - 1000, refresh: 'RT1' }))`);
        routes['https://api.dropboxapi.com/oauth2/token'] = { status: 200, json: { access_token: 'FRESH', expires_in: 14400 } };
        routes['https://api.dropboxapi.com/2/auth/token/revoke'] = { status: 200, json: null };
        await app.eval('dropboxDisconnect()');
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(calls.find((c) => c.url.endsWith('/auth/token/revoke')).opt.headers.Authorization, 'Bearer FRESH');
        assert.equal(app.val('dropboxConnected()'), false);
    });
});
