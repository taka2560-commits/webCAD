'use strict';
// このアプリを人に渡す QR コード（v5.39。cad-qr.js）:
//   リンクは今の場所（手元の開発用の場所なら公開している場所）、QR の SVG は QR の作り（qrcode-generator）のマスと同じ、
//   ☰ メニュー・コマンド QR・お気に入り・ヘルプ、📋 コピー
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const qrcode = require('qrcode-generator');

describe('このアプリを渡す（QR コード）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('リンク: 公開している場所はそのまま、手元の開発用の場所・ファイルなら公開している場所', () => {
        const u = (o) => app.eval(`shareAppUrl(${JSON.stringify(o)})`);
        assert.equal(u({ protocol: 'https:', hostname: 'antigravity-web-cad.vercel.app', origin: 'https://antigravity-web-cad.vercel.app', pathname: '/' }), 'https://antigravity-web-cad.vercel.app/');
        assert.equal(u({ protocol: 'https:', hostname: 'cad.example.jp', origin: 'https://cad.example.jp', pathname: '/webcad/' }), 'https://cad.example.jp/webcad/');
        for (const host of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.20.1.1', 'pc.local']) {
            assert.equal(u({ protocol: 'http:', hostname: host, origin: `http://${host}:5177`, pathname: '/' }), 'https://antigravity-web-cad.vercel.app/', host);
        }
        assert.equal(u({ protocol: 'file:', hostname: '', origin: 'null', pathname: '/C:/a/index.html' }), 'https://antigravity-web-cad.vercel.app/');
    });

    it('QR の SVG は、QR の作りのマス（黒・白）と同じで、まわりに 4 マスの余白', () => {
        const url = 'https://antigravity-web-cad.vercel.app/';
        const svg = app.eval(`qrSvg(${JSON.stringify(url)})`);
        const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
        const n = qr.getModuleCount();
        assert.match(svg, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`));
        // SVG の黒い四角を、マスの表に戻す
        const grid = Array.from({ length: n + 8 }, () => new Array(n + 8).fill(false));
        const d = /<path d="([^"]+)"/.exec(svg)[1];
        for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
            const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
            for (let k = 0; k < w; k++) grid[y][x + k] = true;
        }
        let diff = 0;
        for (let r = 0; r < n + 8; r++) for (let c = 0; c < n + 8; c++) {
            const want = r >= 4 && c >= 4 && r < n + 4 && c < n + 4 ? qr.isDark(r - 4, c - 4) : false;
            if (grid[r][c] !== want) diff++;
        }
        assert.equal(diff, 0);
        assert.match(svg, /fill="#ffffff"/);
    });

    it('☰ メニュー・コマンド QR で開き、QR とリンク・コピーを出す。お気に入り・ヘルプにもある', async () => {
        assert.ok(app.eval(`!!document.querySelector('#top-menu-modal [data-fav="SHAREAPP"]')`));
        app.eval(`processCommand('QR')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '📱 このアプリを渡す');
        assert.ok(app.eval(`!!document.querySelector('#property-panel-content .qr-svg')`));
        assert.equal(app.eval(`document.getElementById('qr-url').textContent`), app.eval('shareAppUrl()'));
        app.eval(`window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true });`);
        await app.eval('copyAppLink()');
        assert.equal(app.eval('window.__copied'), app.eval('shareAppUrl()'));
        assert.ok(app.eval(`FAV_CATALOG.some(c => c.id === 'SHAREAPP')`));
        assert.equal(app.eval(`GUIDE_PANEL_HELP['📱 このアプリを渡す'].topic`), 'shareapp');
        assert.ok(app.val(`guideHelpMatches('QRコード')`).includes('shareapp'));
        assert.deepEqual(app.errors(), []);
    });
});
