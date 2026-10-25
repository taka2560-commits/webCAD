'use strict';
// キーを外に漏らさない（v5.56）: 公開の安全のヘッダー（CSP の通信先）、ログ・エラー記録・知らせでキーを隠す、
// 保存・図面一式にキーが入らない、「この端末に覚えない」、Service Worker が API の通信に触らない
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

const KEY = 'sk-ant-api03-' + 'Ab1_-'.repeat(10);
const DBX_REFRESH = 'r'.repeat(20) + 'REFRESHTOKEN' + 'q'.repeat(20);

describe('キーを外に漏らさない', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('公開の安全のヘッダー: よそのスクリプトは読まない。通信先は自分・Anthropic・Dropbox・地理院だけ。埋め込み・プラグイン・よそへのフォーム送信は不可', () => {
        const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
        const h = Object.fromEntries(v.headers[0].headers.map((x) => [x.key, x.value]));
        assert.equal(v.headers[0].source, '/(.*)');
        const csp = Object.fromEntries(h['Content-Security-Policy'].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...r] = d.split(/\s+/); return [k, r]; }));
        // data: は DWG の読込エンジンが埋め込んだ WASM を読むため（外へは出ない）
        assert.deepEqual(csp['connect-src'], ["'self'", 'data:', 'https://api.anthropic.com', 'https://api.dropboxapi.com', 'https://content.dropboxapi.com', 'https://cyberjapandata.gsi.go.jp']);
        assert.ok(csp['script-src'].every((t) => t.startsWith("'")), 'スクリプトはこのアプリのものだけ（よその場所を1つも許さない）: ' + csp['script-src'].join(' '));
        assert.deepEqual(csp['frame-src'], ["'none'"]);
        assert.deepEqual(csp['default-src'], ["'self'"]);
        assert.deepEqual(csp['object-src'], ["'none'"]);
        assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
        assert.deepEqual(csp['form-action'], ["'self'"]);
        assert.deepEqual(csp['base-uri'], ["'self'"]);
        assert.ok(!csp['img-src'].includes('https:') && !csp['img-src'].includes('*'), '画像もどこからでも、にしない');
        assert.equal(h['X-Content-Type-Options'], 'nosniff');
        assert.equal(h['X-Frame-Options'], 'DENY');
        assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
        assert.match(h['Referrer-Policy'], /strict-origin/);
        // 手元の preview（画面のチェック G2）でも同じヘッダー
        assert.match(fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8'), /preview: \{ headers: SECURITY_HEADERS \}/);
    });

    it('キー・token に見える文字は、コマンド欄・知らせ・エラーの記録で隠す（コピーして人に送っても漏れない）', () => {
        const m = (s) => app.val(`cadMaskSecrets(${JSON.stringify(s)})`);
        assert.equal(m(`key=${KEY} end`), 'key=sk-ant-…（隠しました） end');
        assert.equal(m('Authorization: Bearer abcDEF123456789.xyz'), 'Authorization: Bearer …（隠しました）');
        assert.equal(m('"x-api-key": "abcdefghijkl"'), '"x-api-key": "…（隠しました）"');
        assert.equal(m('token sl.' + 'B'.repeat(40)), 'token sl.…（隠しました）');
        assert.equal(m('token sl.u.' + 'A'.repeat(40)), 'token sl.…（隠しました）', '今の Dropbox の token の形');
        assert.equal(m('{"refresh_token":"' + 'z'.repeat(30) + '"}'), '{"refresh_token":"…（隠しました）"}');
        assert.equal(m('sk-ant-oat01-' + 'k'.repeat(40)), 'sk-ant-…（隠しました）');
        assert.equal(m('座標 X 123.456 Y -78.9'), '座標 X 123.456 Y -78.9', 'ふつうの文は変えない');
        app.eval(`addCommandLog('コマンド: ${KEY}'); showToast('不明なコマンドです "${KEY}"'); `);
        assert.equal(app.val(`document.getElementById('command-log').textContent.includes('${KEY}')`), false);
        assert.equal(app.val(`document.getElementById('cad-toast').textContent.includes('${KEY}')`), false);
        app.eval(`window.cadErrors.record('error', 'boom ${KEY}', 'at fetch Bearer abcdefghijkl ${KEY}', { silent: true })`);
        assert.equal(app.val('window.cadErrors.count() > 0'), true);
        assert.equal(app.val(`(localStorage.getItem('cad_error_log') || '').includes('${KEY}')`), false, 'エラーの記録にも残さない');
        assert.equal(app.val(`window.cadErrors.list().some((e) => (e.message + e.detail).includes('${KEY}'))`), false);
        app.eval('window.cadErrors.clear()');
    });

    it('保存（自動保存・図面一式）にキー・Dropbox の token は入らない', async () => {
        app.eval(`localStorage.setItem('cad_claude_key', '${KEY}'); localStorage.setItem('cad_dropbox_auth', JSON.stringify({ access: 'sl.${'A'.repeat(40)}', refresh: '${DBX_REFRESH}', exp: 0 }));
            entities.length = 0; entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }); ensureEntityIds();`);
        const save = app.val(`JSON.stringify(_buildSaveData('t'))`);
        assert.ok(!save.includes('sk-ant') && !save.includes(DBX_REFRESH) && !save.includes('sl.AAAA'));
        await app.eval(`buildWebcadDoc().then((r) => { window.__doc = r.text; })`);
        await new Promise((r) => setTimeout(r, 50));
        const doc = app.val('window.__doc');
        assert.ok(doc && doc.length > 10);
        assert.ok(!doc.includes('sk-ant') && !doc.includes(DBX_REFRESH));
        app.eval(`localStorage.removeItem('cad_claude_key'); localStorage.removeItem('cad_dropbox_auth'); entities.length = 0;`);
    });

    it('「この端末に覚えない」: キーはアプリを閉じるまで（sessionStorage）。入れ直すと前のキーは両方から消す。欄にキーを残さない', () => {
        app.eval(`setAireadKey('${KEY}', true)`);
        assert.equal(app.val(`localStorage.getItem('cad_claude_key')`), null);
        assert.equal(app.val(`sessionStorage.getItem('cad_claude_key')`), KEY);
        assert.equal(app.val('aireadKeyWhere()'), 'session');
        app.eval('showOptionsPanel()');
        assert.equal(app.val(`document.getElementById('opt-ai-session').checked`), true);
        assert.match(app.val(`document.getElementById('opt-ai-status').textContent`), /閉じると消えます/);
        app.eval(`setAireadKey('${KEY}', false)`);
        assert.equal(app.val(`sessionStorage.getItem('cad_claude_key')`), null);
        assert.equal(app.val(`localStorage.getItem('cad_claude_key')`), KEY);
        app.eval(`setAireadKey('')`);
        assert.equal(app.val(`localStorage.getItem('cad_claude_key') || sessionStorage.getItem('cad_claude_key')`), null);
        assert.equal(app.val(`document.getElementById('opt-ai-key').value`), '');
    });

    it('Dropbox のスクリプト（dropins.js）をアプリの中に読まない', () => {
        const src = fs.readFileSync(path.join(ROOT, 'public/cad-dropbox.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assert.ok(!/dropins\.js|createElement\('script'\)/.test(src.replace(/\/\/.*$/gm, '')), 'dropins.js を読む処理が無い');
        assert.equal(app.val(`document.querySelector('script[src*="dropbox.com"]')`), null);
    });

    it('Service Worker は Claude・Dropbox の通信に触らない（保存もしない）', () => {
        const sw = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
        const m = sw.match(/if \(\/\(\^\|\\\.\)\((.+?)\)\$\/\.test\(url\.hostname\)\) return;/);
        assert.ok(m, '通信先で外す決まりがある');
        const re = new RegExp(`(^|\\.)(${m[1]})$`);
        ['api.anthropic.com', 'api.dropboxapi.com', 'content.dropboxapi.com', 'dl.dropboxusercontent.com', 'www.dropbox.com', 'cfl.dropboxstatic.com'].forEach((h) => assert.ok(re.test(h), h));
        ['cyberjapandata.gsi.go.jp', 'antigravity-web-cad.vercel.app', 'evil-dropbox.com.example'].forEach((h) => assert.ok(!re.test(h), h));
        assert.ok(sw.indexOf('anthropic') < sw.indexOf("req.mode === 'navigate'"), 'ほかの決まりより先に外す');
    });
});
