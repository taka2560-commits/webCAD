'use strict';
// ピンの知らせ（v5.47。cad-ping.js）とピンの表示の入／切（cad-photo.js の photoPinsShow）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('ピンの知らせ・表示の入／切', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('ピンを立てるとポンと立って円の波。波は時間で広がって消え、現在地があれば距離も出す', () => {
        app.eval(`entities.length = 0; window.__now = 1000; _pingNow = () => window.__now; window.__arcs = [];
            window.__oarc = ctx.arc; ctx.arc = function (x, y, r) { window.__arcs.push(r); return window.__oarc.apply(this, arguments); };
            window.__txt = []; window.__oft = ctx.fillText; ctx.fillText = function (s) { window.__txt.push(s); return window.__oft.apply(this, arguments); };
            window.__pin = photoAddPin(10, 20);`);
        try {
            assert.equal(app.val('_pings.length'), 1);
            assert.ok(app.val('pingPinScale(window.__pin.id)') < 0.2, '立てた瞬間は小さい');
            app.eval('window.__now = 1000.2;');
            assert.ok(app.val('pingPinScale(window.__pin.id)') > 1, '少し越える');
            app.eval('window.__now = 1000.4;');
            assert.equal(app.val('pingPinScale(window.__pin.id)'), 1, '元の大きさ');
            // 0.5 秒: 1・2本目の波
            app.eval('window.__now = 1000.5; window.__arcs = []; drawPingOverlay();');
            const r1 = app.val('window.__arcs');
            assert.equal(r1.length, 2);
            app.eval('window.__now = 1000.9; window.__arcs = []; drawPingOverlay();');
            const r2 = app.val('window.__arcs');
            assert.ok(r2[0] > r1[0], '広がる');
            // 現在地
            app.eval(`_gnss.fix = { x: 10, y: 84 }; window.__txt = []; drawPingOverlay();`);
            assert.ok(app.val('window.__txt').some((s) => /現在地から 64/.test(s)));
            app.eval('_gnss.fix = null;');
            // 一覧から開いても知らせる
            app.eval(`_pings = []; photoEdit(window.__pin.id, true);`);
            assert.equal(app.val('_pings.length'), 1);
        } finally { app.eval('ctx.arc = window.__oarc; ctx.fillText = window.__oft; _pings = [];'); }
    });

    it('ピンの表示の入／切: 一覧の切り替え・コマンド PINS・お気に入り。立てる・一覧から開くと表示に戻す', () => {
        app.eval(`entities.length = 0; photoAddPin(0, 0); showPhotoPanel();`);
        const vis = () => app.val(`layers.find(l => l.name === '写真・メモ').visible !== false`);
        assert.equal(vis(), true);
        app.eval(`photoPinsShow(false)`);
        assert.equal(vis(), false);
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /ピンを表示/);
        app.eval(`processCommand('PINS')`);
        assert.equal(vis(), true);
        app.eval(`photoPinsToggle()`);
        assert.equal(vis(), false);
        app.eval(`photoAddPin(5, 5)`);
        assert.equal(vis(), true, '立てたら表示に戻す');
        app.eval(`photoPinsShow(false); photoEdit(photoPins()[0].id, true);`);
        assert.equal(vis(), true, '一覧から開いたら表示に戻す');
        assert.ok(app.val(`FAV_CATALOG.some(d => d.id === 'PINS')`));
        assert.deepEqual(app.errors(), []);
    });
});
