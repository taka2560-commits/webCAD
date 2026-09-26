'use strict';
// パネル・別窓の ▁ たたむ・□ 画面いっぱい のテスト:
//   パネル: たたむ・広げる、画面いっぱい・❐ で元の大きさ（元の位置はそのまま）、同じパネルの描き直し（タブの切り替え）では続け、
//     別のパネル・✕ で元に戻す、たたんだパネルは開き直すと広げて出す、画面いっぱいのあいだは動かさない・位置を合わせ直さない、
//     図面の点を指定するあいだは隠して、終わると画面いっぱいで戻す、お気に入りのボタン（たたんだパネルは広げる）
//   別窓: 見出しの ボタン（全体・▁・□・✕）、□ で画面いっぱい（パネルより前・見えていた範囲が大きく見える倍率・❐ で元の見え方）、
//     画面いっぱいで点をタップすると図面で指定するあいだたたみ、☑確定で画面いっぱいに戻す、✕ で閉じると元の大きさ
//   jsdom には見た目の大きさが無いので、窓の状態（.win-min・.win-max）・ボタンの説明・インラインの位置を確かめる。
//   別窓の倍率は、中の図面の大きさを仮に決めて確かめる
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

// jsdom には PointerEvent が無いため、MouseEvent に同じ名前を付けて代用する
function pointer(app, el, type, x, y) {
    el.dispatchEvent(new app.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
}
// 変換元の SIMA（別窓に出す点）と、図面の張り合わせ点（変換元を移しただけ）
const SRC = [{ num: '1', name: 'A1', X: 0, Y: 0 }, { num: '2', name: 'A2', X: 40, Y: 0 }, { num: '3', name: 'A3', X: 40, Y: 60 }, { num: '4', name: 'A4', X: 0, Y: 60 }];
const SIMA = ['G00,01,GENBA,', 'Z00,座標ﾃﾞｰﾀ,,', 'A00,', ...SRC.map((p) => `A01,${p.num},${p.name},${p.X.toFixed(3)},${p.Y.toFixed(3)},0.000,`), 'A99,'].join('\r\n') + '\r\n';
const DST = SRC.map((p, i) => ({ num: String(100 + i), name: p.name, X: p.X + 5000, Y: p.Y + 3000 }));

async function setup() {
    const app = await loadApp();
    const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    return app;
}
function reset(app) {
    app.eval(`
        resetCommand(); closePropertyPanel(); localStorage.removeItem('cad_panel_pos'); resetPanelPosition(document.getElementById('property-panel'));
        entities.length = 0; undoStack.length = 0; redoStack.length = 0;
        layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0;
        view = { x: 400, y: 300, scale: 1, rotation: 0 }; snapResult = null; _cogo.slots = {}; _cogo.vals = {}; _cogo.pick = null;
        helmRestoreState(); if(_helmViewInst) _helmViewInst.setMaximized(false); _helm.viewClosed = false;
    `);
}
// 図面の点を置き、SIMA を読む（測量計算の「変換」と別窓が開く）
function loadHelm(app) {
    app.eval(`addSurveyData(${JSON.stringify(DST)}, []); undoStack.length = 0; helmLoadSimaText(${JSON.stringify(SIMA)}, 'genba.sim');`);
}
// 別窓の変換元の点 i をタップ
function svTap(app, i) {
    app.run(`const v = _helmView(), q = v.toScreen(${SRC[i].X}, ${SRC[i].Y}), cv = v.canvas;
        cv.dispatchEvent(new MouseEvent('pointerdown', { clientX: q.x, clientY: q.y, bubbles: true }));
        cv.dispatchEvent(new MouseEvent('pointerup', { clientX: q.x, clientY: q.y, bubbles: true }));`);
}
// 図面の張り合わせ点 i に吸い付けて ☑確定
function pickDrawing(app, i) {
    app.run(`const w = surveyToWcs(${DST[i].X}, ${DST[i].Y}); snapResult = { wcsX: w.x, wcsY: w.y, type: '点' }; handlePointInput({ x: w.x, y: w.y }, false);`);
}

describe('パネルの ▁ たたむ・□ 画面いっぱい', () => {
    let app;
    before(async () => { app = await setup(); });
    after(() => app.close());
    beforeEach(() => reset(app));

    const panel = () => app.window.document.getElementById('property-panel');
    const state = () => ({ min: panel().classList.contains('win-min'), max: panel().classList.contains('win-max') });
    const btn = (id) => app.val(`(b => [b.title, b.getAttribute('aria-pressed')])(document.getElementById('${id}'))`);
    const contentDisplay = () => app.eval(`getComputedStyle(document.getElementById('property-panel-content')).display`);

    it('見出しに ？・▁・□・✕ がある（□ と ❐ の絵は SVG の部品）', () => {
        const d = app.window.document;
        assert.deepEqual(app.val(`[...document.querySelectorAll('#property-panel-header button')].map(b => b.id)`),
            ['property-panel-help', 'property-panel-min', 'property-panel-max', 'property-panel-close']);
        assert.equal(d.getElementById('property-panel-min').getAttribute('onclick'), 'togglePropertyPanelMin()');
        assert.equal(d.getElementById('property-panel-max').getAttribute('onclick'), 'togglePropertyPanelMax()');
        assert.equal(d.getElementById('property-panel-close').getAttribute('onclick'), 'closePropertyPanel()');
        assert.ok(d.getElementById('ico-win-max') && d.getElementById('ico-win-restore'));
        assert.equal(d.querySelectorAll('#property-panel-max .win-ico').length, 2);
        assert.deepEqual(btn('property-panel-min'), ['たたむ（見出しだけにする）', 'false']);
        assert.deepEqual(btn('property-panel-max'), ['画面いっぱいに広げる', 'false']);
    });

    it('▁ で見出しだけにたたみ、もう一度押すと広げる（中身はそのまま）', () => {
        app.eval(`showPropertyPanel('テスト', '<div id="__c">中身</div>')`);
        assert.equal(contentDisplay(), 'flex');
        app.eval('togglePropertyPanelMin()');
        assert.deepEqual(state(), { min: true, max: false });
        assert.equal(contentDisplay(), 'none');
        assert.equal(panel().style.display, 'flex', '閉じてはいない');
        assert.deepEqual(btn('property-panel-min'), ['広げる', 'true']);
        app.eval('togglePropertyPanelMin()');
        assert.deepEqual(state(), { min: false, max: false });
        assert.equal(contentDisplay(), 'flex');
        assert.equal(app.eval(`document.getElementById('__c').textContent`), '中身');
        assert.deepEqual(btn('property-panel-min'), ['たたむ（見出しだけにする）', 'false']);
    });

    it('□ で画面いっぱい（見出しは ❐）、❐ で元の大きさ・位置に戻す。広げているあいだは動かさない・位置を合わせ直さない', () => {
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>')`);
        const h = app.window.document.getElementById('property-panel-header');
        pointer(app, h, 'pointerdown', 100, 100); pointer(app, h, 'pointermove', 180, 160); pointer(app, h, 'pointerup', 180, 160);
        assert.deepEqual([panel().style.left, panel().style.top], ['80px', '60px']);
        app.eval('togglePropertyPanelMax()');
        assert.deepEqual(state(), { min: false, max: true });
        assert.deepEqual(btn('property-panel-max'), ['元の大きさに戻す', 'true']);
        assert.equal(app.eval(`winMaxShown(document.getElementById('property-panel'))`), true);
        // つまんでも動かさない・ダブルタップでも中央に戻さない（元の位置のインラインの指定・覚えた位置はそのまま）
        pointer(app, h, 'pointerdown', 100, 100); pointer(app, h, 'pointermove', 400, 400); pointer(app, h, 'pointerup', 400, 400);
        pointer(app, h, 'dblclick', 400, 400);
        assert.deepEqual([panel().style.left, panel().style.top], ['80px', '60px']);
        assert.equal(app.eval(`localStorage.getItem('cad_panel_pos')`), '{"left":80,"top":60}');
        // 画面の大きさが変わっても、元の位置を画面いっぱいの大きさで丸め直さない
        app.eval(`const p = document.getElementById('property-panel'); p.style.left = '5000px'; applyPanelPosition(p);`);
        assert.equal(panel().style.left, '5000px');
        // ❐ で戻すと、はみ出さない位置に置き直す
        app.eval('togglePropertyPanelMax()');
        assert.deepEqual(state(), { min: false, max: false });
        assert.deepEqual(btn('property-panel-max'), ['画面いっぱいに広げる', 'false']);
        assert.equal(panel().style.left, (app.eval('window.innerWidth') - 320) + 'px');
    });

    it('同じパネルの描き直し（タブの切り替え）では続け、別のパネル・✕ で閉じると元に戻す。たたんだパネルは開き直すと広げて出す', () => {
        app.eval(`showCogoPanel('inv'); togglePropertyPanelMax(); cogoSetTab('area'); cogoSetTab('int');`);
        assert.deepEqual(state(), { min: false, max: true }, 'タブを切り替えても画面いっぱい');
        app.eval('showOptionsPanel()');
        assert.deepEqual(state(), { min: false, max: false }, '別のパネルはふつうの大きさ');
        assert.deepEqual(btn('property-panel-max'), ['画面いっぱいに広げる', 'false']);
        app.eval(`showCogoPanel('inv'); togglePropertyPanelMax(); closePropertyPanel();`);
        assert.equal(panel().style.display, 'none');
        assert.deepEqual(state(), { min: false, max: false }, '✕ で閉じると元に戻す');
        app.eval(`showCogoPanel('inv'); togglePropertyPanelMin(); cogoSetTab('area');`);
        assert.deepEqual(state(), { min: true, max: false }, 'たたんだまま描き直す');
        app.eval(`hidePropertyPanel(); showCogoPanel('area');`);
        assert.deepEqual(state(), { min: false, max: false }, '閉じたあとに開き直すと広げて出す');
        // 画面いっぱいのまま ▁ でたたむと、元の位置・大きさの見出しだけ。もう一度 ▁ で画面いっぱいに戻る
        app.eval('togglePropertyPanelMax(); togglePropertyPanelMin();');
        assert.deepEqual(state(), { min: true, max: true });
        assert.equal(app.eval(`winMaxShown(document.getElementById('property-panel'))`), false);
        assert.equal(app.eval('panelCoversDrawing()'), false);
        app.eval('togglePropertyPanelMin()');
        assert.deepEqual(state(), { min: false, max: true });
        // ❐ は、たたんでいても広げてから元の大きさにする
        app.eval('togglePropertyPanelMin(); togglePropertyPanelMax();');
        assert.deepEqual(state(), { min: false, max: false });
    });

    it('画面いっぱいのパネル: 図面の点を指定するあいだは隠し、終わると画面いっぱいで戻す（ふつうの大きさなら広い画面では出したまま）', () => {
        loadHelm(app);
        app.eval('togglePropertyPanelMax()');
        assert.equal(app.eval('panelCoversDrawing()'), true);
        app.eval('helmSelectSource(0)'); // 表の 📍
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT');
        assert.equal(panel().style.display, 'none', '図面が見えるように隠す');
        assert.equal(state().max, true, '画面いっぱいは覚えている');
        pickDrawing(app, 0);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(panel().style.display, 'flex');
        assert.deepEqual(state(), { min: false, max: true });
        assert.equal(app.val('_helm.pairs.length'), 1);
        app.eval('togglePropertyPanelMax(); helmSelectSource(1)');
        assert.equal(app.eval('panelCoversDrawing()'), false);
        assert.equal(panel().style.display, 'flex', '以前と同じく出したまま');
        app.eval(`issueCommand('CANCEL')`);
        assert.deepEqual(app.errors(), []);
    });

    it('お気に入りのボタン: 開いているパネルは閉じる（▁ でたたんでいたら広げる。閉じると元の大きさ）', () => {
        app.eval(`showCogoPanel(); togglePropertyPanelMin(); favRun('COGO');`);
        assert.equal(panel().style.display, 'flex');
        assert.deepEqual(state(), { min: false, max: false });
        app.eval(`togglePropertyPanelMax(); favRun('COGO');`);
        assert.equal(panel().style.display, 'none');
        assert.deepEqual(state(), { min: false, max: false });
        assert.deepEqual(app.errors(), []);
    });
});

describe('別窓の ▁ たたむ・□ 画面いっぱい', () => {
    let app;
    before(async () => { app = await setup(); });
    after(() => app.close());
    beforeEach(() => { reset(app); loadHelm(app); });

    const view = () => app.window.document.getElementById('helm-view');
    const v = (expr) => app.eval(`_helmView().${expr}`);
    const click = (act) => app.eval(`document.querySelector('#helm-view [data-act="${act}"]').click()`);
    const btn = (act) => app.val(`(b => [b.title, b.getAttribute('aria-pressed')])(document.querySelector('#helm-view [data-act="${act}"]'))`);
    // jsdom には大きさが無いので、別窓の中の図面の大きさを仮に決める（ふつう 358×261、画面いっぱい 982×594）
    const fakeSize = () => app.run(`const el = document.getElementById('helm-view'), body = el.querySelector('.subview-body');
        Object.defineProperty(body, 'clientWidth', { configurable: true, get: () => el.classList.contains('win-max') ? 982 : 358 });
        Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => el.classList.contains('win-max') ? 594 : 261 });`);

    it('見出しは「全体」・▁・□・✕（⤢ は □ と紛らわしいので文字の「全体」に）', () => {
        assert.deepEqual(app.val(`[...document.querySelectorAll('#helm-view .subview-btn')].map(b => [b.dataset.act, b.textContent])`),
            [['fit', '全体'], ['fold', '▁'], ['max', ''], ['close', '✕']]);
        assert.equal(app.eval(`document.querySelectorAll('#helm-view [data-act="max"] .win-ico').length`), 2);
        assert.deepEqual(btn('fold'), ['たたむ（見出しだけにする）', 'false']);
        assert.deepEqual(btn('max'), ['画面いっぱいに広げる', 'false']);
    });

    it('□ で画面いっぱい（パネルより前）。見えていた範囲が大きく見える倍率にし、❐ で元の見え方・位置に戻す。広げているあいだは動かさない', () => {
        fakeSize();
        const s0 = v('scale()'), pos0 = [view().style.left, view().style.top];
        click('max');
        assert.equal(v('maximized'), true);
        assert.equal(view().style.zIndex, '100003');
        assert.deepEqual(btn('max'), ['元の大きさに戻す', 'true']);
        assert.ok(near(v('scale()'), s0 * Math.min(982 / 358, 594 / 261), 1e-9), '見えていた範囲が、そのまま大きく見える');
        const head = view().querySelector('.subview-head');
        pointer(app, head, 'pointerdown', 100, 100); pointer(app, head, 'pointermove', 300, 300); pointer(app, head, 'pointerup', 300, 300);
        assert.deepEqual([view().style.left, view().style.top], pos0, 'つまんでも動かさない');
        click('max');
        assert.equal(v('maximized'), false);
        assert.deepEqual(btn('max'), ['画面いっぱいに広げる', 'false']);
        assert.ok(near(v('scale()'), s0, 1e-9), '元の見え方');
        assert.deepEqual([view().style.left, view().style.top], pos0, '元の位置');
    });

    it('画面いっぱいの別窓で点をタップすると、図面で指定するあいだはたたみ、☑確定で画面いっぱいに戻す', () => {
        click('max');
        svTap(app, 0);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT');
        assert.equal(v('collapsed'), true, '図面が見えるようにたたむ');
        assert.equal(v('maximized'), true, '画面いっぱいは覚えている');
        assert.equal(app.eval(`winMaxShown(document.getElementById('helm-view'))`), false, 'たたんだあいだは元の位置の見出しだけ');
        assert.deepEqual(btn('fold'), ['広げる', 'true']);
        pickDrawing(app, 0);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(v('collapsed'), false);
        assert.equal(v('maximized'), true);
        assert.equal(app.val('_helm.pairs.length'), 1);
        // ふつうの大きさ（広い画面）では、これまでどおりたたまない
        click('max');
        svTap(app, 1);
        assert.equal(v('collapsed'), false);
        app.eval(`issueCommand('CANCEL')`);
        assert.deepEqual(app.errors(), []);
    });

    it('▁ でたたんでいても、□ を押すと広げて画面いっぱい。✕ で閉じると元の大きさに戻す', () => {
        click('fold');
        assert.equal(v('collapsed'), true);
        click('max');
        assert.equal(v('collapsed'), false);
        assert.equal(v('maximized'), true);
        click('close');
        assert.equal(view().style.display, 'none');
        assert.equal(v('maximized'), false);
        app.eval('helmOpenView()');
        assert.equal(view().style.display, 'flex');
        assert.equal(v('maximized'), false, '次に開くときはふつうの大きさ');
        assert.deepEqual(app.errors(), []);
    });
});
