'use strict';
// 座標読取（全画面）の ＋・−・スライダーは、最後にカーソル・指で読んだ点（スナップしていればその点）を中心に拡大・縮小する（v5.52）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('座標読取の拡大・縮小の中心', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => app.eval(`document.body.classList.add('fullscreen-mode'); window._fsZoomAnchor = null;
        canvas.width = 800; canvas.height = 600; view = { x: 400, y: 300, scale: 1, rotation: 0 }; ucs = { originX: 0, originY: 0, angle: 0 };`));
    const scr = (x, y) => app.val(`wcsToScreen(${x}, ${y})`);
    const near = (a, b, msg) => assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, `${msg} ${JSON.stringify(a)} ${JSON.stringify(b)}`);

    it('読んだ点を画面の同じ場所に置いたまま、＋・−・スライダーで拡大・縮小する', () => {
        const p0 = scr(-150, 80);
        app.eval('updateFsCoordTooltip(0, 0, -150, 80, null, true)');
        app.eval('fsZoomIn(); fsZoomIn()');
        assert.ok(Math.abs(app.val('view.scale') - 1.5625) < 1e-12);
        near(scr(-150, 80), p0, '＋');
        app.eval('fsZoomOut()');
        near(scr(-150, 80), p0, '−');
        app.eval('fsZoomSlider(0.8)');
        assert.ok(Math.abs(app.val('view.scale') - Math.pow(10, 0.8)) < 1e-9);
        near(scr(-150, 80), p0, 'スライダー');
        assert.deepEqual(app.errors(), []);
    });

    it('UCS が入っていても、読んだ点（UCS の座標）を図面の同じ点として扱う', () => {
        app.eval('ucs = { originX: 1000, originY: -500, angle: Math.PI / 6 }');
        const w = app.val('ucsToWcs(30, 40)');
        app.eval(`view.x = 400 - ${w.x}; view.y = 300 + ${w.y}; render();`);
        const p0 = scr(w.x, w.y);
        app.eval('updateFsCoordTooltip(0, 0, 30, 40, "端点", true)');
        app.eval('fsZoomIn()');
        near(scr(w.x, w.y), p0, 'UCS');
    });

    it('まだ読んでいない・読んだ点が画面の外なら、画面の真ん中を中心にする', () => {
        const c0 = app.val('screenToWcs(400, 300)');
        app.eval('fsZoomIn()');
        near(app.val('screenToWcs(400, 300)'), c0, '読んでいない');
        app.eval('updateFsCoordTooltip(0, 0, 100000, 100000, null, true)');
        const c1 = app.val('screenToWcs(400, 300)');
        app.eval('fsZoomOut()');
        near(app.val('screenToWcs(400, 300)'), c1, '画面の外');
    });

    it('全画面でないときは読んだ点を覚えない', () => {
        app.eval(`document.body.classList.remove('fullscreen-mode'); updateFsCoordTooltip(0, 0, 5, 5, null, true)`);
        assert.equal(app.val('window._fsZoomAnchor'), null);
    });

    it('マウス: ＋・− へ動かす途中で読んだ点は覚えず、図面を押した点を中心にする（G3 で見つけた）', () => {
        app.eval('updateFsCoordTooltip(0, 0, -150, 80, null)');
        assert.equal(app.val('window._fsZoomAnchor'), null, 'カーソルを動かしただけでは覚えない');
        const r = app.val('(() => { const r = canvas.getBoundingClientRect(); return { l: r.left, t: r.top }; })()');
        app.eval(`lastTouchTime = 0; canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: ${r.l} + 200, clientY: ${r.t} + 150, button: 0, bubbles: true }));
            canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: ${r.l} + 200, clientY: ${r.t} + 150, button: 0, bubbles: true }));`);
        const a = app.val('window._fsZoomAnchor');
        assert.ok(a, '押した点を覚える');
        const p0 = scr(a.x, a.y);
        assert.ok(Math.abs(p0.x - 200) < 1e-6 && Math.abs(p0.y - 150) < 1e-6, JSON.stringify(p0));
        app.eval('updateFsCoordTooltip(0, 0, -340, -230, null); fsZoomIn()');
        near(scr(a.x, a.y), p0, '押した点のまま');
    });

    it('別の図面になったら（閉じる・開く）、拡大の中心は使わない', () => {
        app.eval('updateFsCoordTooltip(0, 0, 5, 5, null, true); setDrawingName("別の図面")');
        assert.equal(app.val('window._fsZoomAnchor'), null);
    });
});
