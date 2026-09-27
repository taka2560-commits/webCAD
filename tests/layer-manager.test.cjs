'use strict';
// 画層一括管理のテスト:
//   うっすら表示の濃さ（スライダー。初めは 15%、5〜70%、動かすと入、端末に覚える、図形と寸法の濃さ）、
//   タッチで非表示（タップは消す候補にするだけ・赤く描く・もう一度で外す・☑確定／Enter でまとめて非表示・↩ で戻る・やめると消さない）、
//   画層の色（一覧の色の欄・上のバーの作図画層の色・↩）、画面いっぱいのときの一覧（高さの制限なし・何列か）、画層名の文字の安全
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('画層一括管理', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`
            resetCommand(); closePropertyPanel();
            localStorage.removeItem('cad_ghost_alpha'); _ghostAlpha = 0.15; window.ghostLayerMode = false;
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }, { name: '道路', color: '#f00', visible: true },
                { name: '境界', color: '#ffff00', visible: true }, { name: '等高線', color: '#00ff00', visible: false });
            currentLayerIndex = 0; if(typeof initLayers === 'function') initLayers();
            view = { x: 400, y: 300, scale: 1, rotation: 0 }; ucs = { originX: 0, originY: 0, angle: 0 }; snapResult = null;
            entities.push({ type: 'LINE', layer: 1, color: null, x1: -100, y1: 0, x2: -60, y2: 0 });
            entities.push({ type: 'LINE', layer: 2, color: null, x1: 0, y1: 50, x2: 40, y2: 50 });
            entities.push({ type: 'LINE', layer: 3, color: null, x1: 60, y1: -50, x2: 100, y2: -50 });
            entities.push({ type: 'DIMENSION', subType: 'ALIGNED', layer: 3, color: '#00ffff', p1: { x: 60, y: -50 }, p2: { x: 100, y: -50 }, offset: 10 });
        `);
    });
    const panelText = () => app.eval(`document.getElementById('layer-manager-container').textContent`);
    // 図形 i の線の真ん中をタップ（タッチ非表示）
    const tap = (i) => app.run(`const e = entities[${i}], s = wcsToScreen((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2);
        mouse.screenX = s.x; mouse.screenY = s.y; handlePointInput({ x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 }, false);`);
    const confirmBtn = () => app.val(`(b => [b.style.display, b.textContent])(document.querySelector('#fs-dim-actionbar button[onclick="dimConfirmPoint()"]'))`);
    // 1コマ描いて、線の色・濃さを集める
    const strokes = () => {
        app.eval(`window.__s = []; ctx.stroke = () => window.__s.push({ c: String(ctx.strokeStyle), a: ctx.globalAlpha });`);
        try { app.eval('_drawFrame(false)'); } finally { app.eval('delete ctx.stroke'); }
        return app.val('window.__s');
    };

    it('うっすら表示の濃さ: 初めは 15%。スライダーで 5〜70% にでき、動かすと入にして端末に覚える。非表示の画層の図形・寸法をその濃さで描く', () => {
        app.eval(`showLayerManagerPanel()`);
        assert.equal(app.eval('ghostLayerAlpha()'), 0.15);
        assert.deepEqual(app.val(`(r => [r.min, r.max, r.step, r.value])(document.getElementById('ghost-alpha'))`), ['5', '70', '5', '15']);
        assert.equal(app.eval(`document.getElementById('ghost-alpha-val').textContent`), '15%');
        assert.equal(app.eval('window.ghostLayerMode'), false);
        assert.ok(!strokes().some((s) => s.a < 1), '切のときは非表示の画層を描かない');
        app.eval(`setGhostLayerAlpha(40)`);
        assert.equal(app.eval('ghostLayerAlpha()'), 0.4);
        assert.equal(app.eval('window.ghostLayerMode'), true, '動かすと、うっすら表示を入にする');
        assert.equal(app.eval(`document.getElementById('ghost-layer-toggle').checked`), true);
        assert.equal(app.eval(`document.getElementById('ghost-alpha-val').textContent`), '40%');
        assert.equal(app.eval(`localStorage.getItem('cad_ghost_alpha')`), '0.4');
        const s = strokes();
        assert.ok(s.some((x) => x.c === '#00ff00' && Math.abs(x.a - 0.4) < 1e-9), JSON.stringify(s));
        assert.ok(s.some((x) => x.c === '#00ffff' && Math.abs(x.a - 0.4) < 1e-9), '寸法も同じ濃さ: ' + JSON.stringify(s));
        app.eval(`setGhostLayerAlpha(0)`); assert.equal(app.eval('ghostLayerAlpha()'), 0.05);
        app.eval(`setGhostLayerAlpha(100)`); assert.equal(app.eval('ghostLayerAlpha()'), 0.7);
        assert.deepEqual(app.errors(), []);
    });

    it('タッチで非表示: タップは消す候補にするだけ（赤く描く・もう一度で外す）。☑確定 でまとめて非表示にし、↩ で戻る', () => {
        app.eval(`issueCommand('LAYOFF')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LAYOFF_TOUCH');
        assert.equal(confirmBtn()[0], 'none', '候補を選ぶまでは ☑確定 を出さない');
        assert.equal(app.eval(`document.getElementById('dim-cancel-btn').style.color`), 'rgb(30, 34, 40)', '終了のボタンの文字が読める');
        tap(0);
        assert.equal(app.eval('layers[1].visible'), true, 'タップしただけでは消さない');
        assert.deepEqual(app.val('cmdState.layoffPick'), [1]);
        assert.deepEqual(confirmBtn(), ['', '☑️ 確定（1）']);
        assert.match(app.eval(`document.getElementById('command-prompt').textContent`), /「道路」→ ☑確定/);
        assert.match(panelText(), /消す候補: 「道路」/);
        assert.equal(app.eval(`document.querySelectorAll('.lm-row.lm-pick').length`), 1);
        assert.ok(strokes().filter((s) => s.a === 1).some((s) => s.c === '#ff6b6b'), '候補の画層は赤く描く');
        tap(0);
        assert.deepEqual(app.val('cmdState.layoffPick'), [], 'もう一度タップで外す');
        assert.equal(confirmBtn()[0], 'none');
        tap(0); tap(1);
        assert.deepEqual(confirmBtn(), ['', '☑️ 確定（2）']);
        app.eval(`dimConfirmPoint()`);
        assert.deepEqual(app.val('[layers[1].visible, layers[2].visible]'), [false, false]);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LAYOFF_TOUCH', '続けてできる');
        assert.deepEqual(app.val('cmdState.layoffPick'), []);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /「道路」「境界」を非表示にしました/);
        app.eval('undo()');
        assert.deepEqual(app.val('[layers[1].visible, layers[2].visible]'), [true, true], '↩ でまとめて戻る');
        assert.deepEqual(app.errors(), []);
    });

    it('タッチで非表示: Enter でも確定。候補が無いときは知らせるだけ。やめると候補は消さず、ボタンを元に戻す', () => {
        app.eval(`issueCommand('LAYOFF')`);
        app.eval(`dimConfirmPoint()`);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /タップしてから ☑確定/);
        tap(1);
        app.eval(`commandInput.value = ''; commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
        assert.equal(app.eval('layers[2].visible'), false, 'Enter で確定');
        tap(0);
        app.eval(`issueCommand('CANCEL')`);
        assert.equal(app.eval('layers[1].visible'), true, 'やめると候補は消さない');
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.deepEqual(confirmBtn(), ['', '☑️ 確定']);
        assert.deepEqual(app.val(`(b => [b.textContent, b.style.color])(document.getElementById('dim-cancel-btn'))`), ['❌ 終了', 'rgb(255, 107, 107)']);
    });

    it('画層の色: 一覧の色の欄で変えられる（#rgb も #rrggbb で出す）。作図画層なら上のバーの色も変わり、↩ で戻る', () => {
        app.eval(`showLayerManagerPanel()`);
        const vals = app.val(`[...document.querySelectorAll('#layer-manager-container .lm-color')].map(i => [i.type, i.value])`);
        assert.deepEqual(vals, [['color', '#ffffff'], ['color', '#ff0000'], ['color', '#ffff00'], ['color', '#00ff00']]);
        // 色を選んだとき（jsdom では HTML に書いた onchange が動かないので、その中身をこの欄で実行する）
        app.run(`const inp = document.querySelectorAll('#layer-manager-container .lm-color')[2]; inp.value = '#ff8800';
            (new Function('event', inp.getAttribute('onchange'))).call(inp, new Event('change'));`);
        assert.equal(app.eval('layers[2].color'), '#ff8800');
        assert.equal(app.eval(`document.querySelectorAll('#layer-manager-container .lm-color')[2].value`), '#ff8800', '一覧も描き直す');
        assert.ok(strokes().some((s) => s.c === '#ff8800'), '図形の色も変わる');
        app.eval(`changeLayerColorGlobal(0, '#00ffff')`);
        assert.equal(app.eval(`document.getElementById('current-layer-color').style.backgroundColor`), 'rgb(0, 255, 255)');
        app.eval('undo(); undo();');
        assert.deepEqual(app.val('[layers[0].color, layers[2].color]'), ['#ffffff', '#ffff00']);
    });

    it('画面いっぱい（□）のときは、一覧の高さの制限をやめて何列かに並べる（ふつうは高さ 250px まで・1列）', () => {
        app.eval(`showLayerManagerPanel()`);
        const cs = (sel, p) => app.eval(`getComputedStyle(document.querySelector('${sel}')).${p}`);
        assert.equal(cs('.lm-list', 'maxHeight'), '250px');
        assert.equal(cs('.lm-rows', 'display'), 'flex');
        app.eval('togglePropertyPanelMax()');
        assert.equal(cs('.lm-list', 'maxHeight'), 'none');
        assert.equal(cs('.lm-rows', 'display'), 'grid');
        app.eval('togglePropertyPanelMax()');
        assert.equal(cs('.lm-list', 'maxHeight'), '250px');
    });

    it('画層名は文字として出す（一覧・消す候補の案内）', () => {
        app.eval(`layers[1].name = '<img id="pwnL" src="x">'; issueCommand('LAYOFF');`);
        tap(0);
        assert.equal(app.eval(`!!document.getElementById('pwnL')`), false);
        assert.match(panelText(), /<img id="pwnL"/);
        app.eval(`issueCommand('CANCEL')`);
        assert.deepEqual(app.errors(), []);
    });
});

describe('画層一括管理: 起動時', () => {
    it('うっすら表示の濃さは端末に覚えたものを使う（読めない値は 15%）', async () => {
        let app = await loadApp({ storage: { cad_ghost_alpha: '0.3' } });
        try { assert.equal(app.eval('ghostLayerAlpha()'), 0.3); } finally { app.close(); }
        app = await loadApp({ storage: { cad_ghost_alpha: 'abc' } });
        try { assert.equal(app.eval('ghostLayerAlpha()'), 0.15); } finally { app.close(); }
    });
});
