'use strict';
// ほかのアプリから開く（v5.44。cad-launch.js・sw.js・manifest.json）:
//   PC はファイルの関連付け（file_handlers → launchQueue）、Android は「共有」の送り先（share_target → sw.js がキャッシュに置く → ?shared=1）。
//   どちらも 📁開く と同じ開き方（openIncomingFile）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

describe('ほかのアプリから開く', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('manifest: .dwg・.dxf・.jww などの関連付けと、共有の送り先', () => {
        const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf8'));
        const exts = Object.values(m.file_handlers[0].accept).flat();
        for (const e of ['.dwg', '.dxf', '.jww', '.sim', '.sdr', '.webcad', '.csv']) assert.ok(exts.includes(e), e);
        assert.equal(m.share_target.method, 'POST');
        assert.equal(m.share_target.enctype, 'multipart/form-data');
        assert.equal(m.share_target.params.files[0].name, 'file');
        assert.ok(m.share_target.params.files[0].accept.includes('.jww'));
    });

    it('PC: launchQueue で届いたファイルを、📁開く と同じに開く（確認画面が出ていれば閉じてから）', async () => {
        app.eval(`window.__opened = []; window.__oif = openIncomingFile; openIncomingFile = (f) => window.__opened.push(f.name);
            window.launchQueue = { setConsumer(fn) { window.__consumer = fn; } }; launchSetup();`);
        try {
            await app.eval(`window.__consumer({ files: [{ getFile: async () => new File(['0'], '現場.dwg') }] })`);
            assert.deepEqual(app.val('window.__opened'), ['現場.dwg']);
            // 確認画面が出ている間は待つ
            app.eval(`window.__cdo = window.cadDialogOpen; cadDialogOpen = () => true;`);
            await app.eval(`window.__consumer({ files: [{ getFile: async () => new File(['0'], 'b.jww') }] })`);
            assert.deepEqual(app.val('window.__opened'), ['現場.dwg'], 'まだ開かない');
            app.eval('cadDialogOpen = window.__cdo;');
            await new Promise((r) => setTimeout(r, 400));
            assert.deepEqual(app.val('window.__opened'), ['現場.dwg', 'b.jww']);
        } finally { app.eval('openIncomingFile = window.__oif; delete window.launchQueue;'); }
    });

    it('Android: 共有で届いたファイル（キャッシュ）を ?shared=1 で取り出して開き、キャッシュから消す', async () => {
        app.eval(`window.__opened = []; window.__oif = openIncomingFile; openIncomingFile = (f) => window.__opened.push([f.name, f.size]);
            window.__store = new Map(); window.__store.set(new URL('shared-file', location.href).href, { headers: { get: (k) => k === 'X-File-Name' ? encodeURIComponent('境界 図.dxf') : null }, blob: async () => new Blob(['0123']) });
            window.caches = { open: async () => ({ match: async (k) => window.__store.get(k), delete: async (k) => window.__store.delete(k) }) };
            history.replaceState(null, '', location.pathname + '?shared=1');`);
        try {
            assert.equal(await app.eval('launchPickShared()'), true);
            assert.deepEqual(app.val('window.__opened'), [['境界 図.dxf', 4]]);
            assert.equal(app.val('window.__store.size'), 0, 'キャッシュから消す');
            assert.equal(app.val('location.search'), '', '?shared=1 は外す');
            assert.equal(await app.eval('launchPickShared()'), false, '印が無ければ何もしない');
        } finally { app.eval('openIncomingFile = window.__oif; delete window.caches;'); }
    });

    it('sw.js: 共有の POST を受け取ってキャッシュに置き、?shared=1 へ回す', async () => {
        const store = new Map(), handlers = {};
        const ctx = {
            self: { registration: { scope: 'https://example.test/' }, addEventListener: (t, f) => { handlers[t] = f; }, clients: { claim() {} }, skipWaiting() {} },
            caches: { open: async () => ({ put: async (k, v) => store.set(k, v), match: async () => null, keys: async () => [], delete: async () => true }), keys: async () => [], match: async () => null },
            Response, Request, URL, FormData, File, Blob, fetch: async () => { throw new Error('offline'); }, setTimeout, console,
        };
        vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8'), ctx);
        const fd = new FormData();
        fd.append('file', new File(['ABC'], '現場.jww', { type: '' }));
        let responded = null;
        handlers.fetch({ request: new Request('https://example.test/share-target', { method: 'POST', body: fd }), respondWith: (p) => { responded = p; } });
        const res = await responded;
        assert.equal(res.status, 303);
        assert.equal(res.headers.get('Location'), 'https://example.test/?shared=1');
        const saved = store.get('https://example.test/shared-file');
        assert.equal(decodeURIComponent(saved.headers.get('X-File-Name')), '現場.jww');
        assert.equal(await saved.text(), 'ABC');
    });
});
