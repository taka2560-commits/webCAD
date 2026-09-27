'use strict';
// 座標一覧の入力（v5.24）のテスト: 「📥 SIMA を読み込む」で測点が図面と一覧に入る（空の図面・今の図面に追加・やめる）、
// 追加のときは図面の名前を変えない、「⊙ 点を置く」で点のコマンドを始める。点のコマンドで置いた点も一覧に出る
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

const SIMA = ['G00,01,テスト', 'Z00,座標ﾃﾞｰﾀ,', 'A00,', 'A01,1,KP1,100.000,200.000,,', 'A01,2,KP2,110.000,205.000,,', 'A99,'].join('\r\n');

describe('座標一覧の入力', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            setDrawingName('現場図面.dxf');`);
    });
    const listText = () => app.eval(`document.getElementById('coord-list-rows').textContent`);
    const load = async () => { app.window.__f = new app.window.File([SIMA], '境界.sim'); return app.eval('coordListLoadSima(window.__f)'); };

    it('座標一覧に「入力」（📥 SIMA を読み込む・⊙ 点を置く）と「出力」がある', () => {
        app.eval('showCoordListPanel()');
        const t = app.eval(`document.getElementById('property-panel-content').textContent`);
        assert.match(t, /入力[\s\S]*SIMA を読み込む[\s\S]*点を置く[\s\S]*出力[\s\S]*SIMA出力/);
    });

    it('空の図面に SIMA を読み込むと、測点が図面と一覧に入る', async () => {
        app.eval('showCoordListPanel()');
        const r = await load();
        assert.equal(r.pointCount, 2);
        assert.deepEqual(app.val(`collectSurveyPoints().map(p => p.name)`), ['KP1', 'KP2']);
        assert.match(listText(), /KP1[\s\S]*KP2/);
        assert.equal(app.eval('window._drawingName'), '境界.sim');
    });

    it('今の図面があるときは「今の図面に追加」で入れ、図面の名前は変えない。「やめる」なら何もしない', async () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }); ensureEntityIds(); showCoordListPanel();`);
        app.window.confirm = () => false; // 今の図面に追加
        await load();
        assert.equal(app.eval(`entities.filter(e => e.type === 'LINE').length`), 1, '線は残る');
        assert.deepEqual(app.val(`collectSurveyPoints().map(p => p.name)`), ['KP1', 'KP2']);
        assert.equal(app.eval('window._drawingName'), '現場図面.dxf');
        assert.match(listText(), /KP1/);
        // やめる（アプリの確認画面で）
        app.eval('window.__cadNativeDialogs = false');
        try {
            const n = app.eval('entities.length');
            app.window.__f = new app.window.File([SIMA], 'x.sim');
            app.eval('window.__r = coordListLoadSima(window.__f)');
            app.eval(`[...document.querySelectorAll('#cad-dialog .cd-btn')].find(b => b.textContent === 'やめる').click()`);
            assert.equal(await app.eval('window.__r'), null);
            assert.equal(app.eval('entities.length'), n);
        } finally { app.eval('window.__cadNativeDialogs = true'); }
        assert.deepEqual(app.errors(), []);
    });

    it('「⊙ 点を置く」で点のコマンドを始め、置いた点は座標一覧に出る', () => {
        app.eval('showCoordListPanel()');
        app.eval(app.eval(`[...document.querySelectorAll('#property-panel-content button')].find(b => /点を置く/.test(b.textContent)).getAttribute('onclick')`));
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '点 作図設定');
        app.eval(`applyPointPreset(); handlePointInput({ x: 5, y: 5 }, true); resetCommand(); showCoordListPanel();`);
        assert.match(listText(), /P1/);
    });
    it('一覧の 🗑 で点を消す（点と点名の文字をいっしょに）。「元に戻す」で戻り、一覧も戻る', async () => {
        app.eval('showCoordListPanel()');
        await load();
        const n0 = app.eval('entities.length');
        const dels = app.val(`[...document.querySelectorAll('#coord-list-rows .coord-del')].map(b => b.getAttribute('aria-label'))`);
        assert.deepEqual(dels, ['点「KP1」を消す', '点「KP2」を消す']);
        const view0 = app.val('[view.x, view.y, view.scale]');
        app.eval(`document.querySelectorAll('#coord-list-rows .coord-del')[0].click()`);
        assert.deepEqual(app.val('collectSurveyPoints().map(p => p.name)'), ['KP2']);
        assert.equal(app.eval(`entities.some(e => e.type === 'TEXT' && e.text === 'KP1')`), false, '点名の文字も消す');
        assert.equal(app.eval('entities.length'), n0 - 2);
        assert.doesNotMatch(listText(), /KP1/);
        assert.deepEqual(app.val('[view.x, view.y, view.scale]'), view0, '🗑 では行を押したときの移動をしない');
        assert.match(app.eval(`document.querySelector('#cad-snack .sn-msg').textContent`), /点「KP1」を消しました/);
        app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
        assert.deepEqual(app.val('collectSurveyPoints().map(p => p.name)').sort(), ['KP1', 'KP2']);
        assert.match(listText(), /KP1/, '元に戻すと一覧も戻る');
        assert.deepEqual(app.errors(), []);
    });
});
