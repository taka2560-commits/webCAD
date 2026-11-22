'use strict';
// 種類で絞る（cad-typeview.js。v5.60）: 画層管理（👁）のパネルで、見たい種類の図形だけを表示する。
//   ・種類のボタンを押すと、その種類だけ表示。絞っているあいだは、押すたびに足す・外す。「すべて表示」で戻す
//   ・今ある「隠す」と同じ図形ごとの非表示（hidden）に、hiddenBy 'type' を付ける。ほかの理由で隠れている図形には触らない
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('種類で絞る（見たい種類だけ表示）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }, { name: '補助', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            cmdState.selectedIndices = []; cmdState.highlightIdx = -1; view.x = 400; view.y = 300; view.scale = 1; typeViewSync(true);`);
    });
    // 0 線分・1 ポリライン・2 四角・3 円・4 楕円・5 円弧・6 文字・7 点・8 点名の文字・9 寸法・10 取り込んだ寸法の線・11 取り込んだ寸法の数字・12 塗りつぶし・
    // 13 取り込みで隠した塗りつぶし・14 取り込みで隠した円弧・15 自分で隠した線・16 写真のピン
    const SHAPES = `entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'PLINE', layer: 1, color: null, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] },
        { type: 'RECTANG', layer: 0, color: null, x1: 20, y1: 0, x2: 30, y2: 10 }, { type: 'CIRCLE', layer: 0, color: null, cx: 50, cy: 50, radius: 5 }, { type: 'ELLIPSE', layer: 0, color: null, cx: 70, cy: 50, rx: 6, ry: 3, rotation: 0 },
        { type: 'ARC', layer: 0, color: null, cx: 90, cy: 50, radius: 5, startAngle: 0, endAngle: 1.5 }, { type: 'TEXT', layer: 0, color: null, x: 0, y: 30, text: '道路', height: 2 },
        { type: 'POINT', layer: 0, color: null, x: 100, y: 0, name: 'K1', gid: 'p1', blockName: '測点' }, { type: 'TEXT', layer: 0, color: null, x: 101, y: 0.6, text: 'K1', height: 2, gid: 'p1', blockName: '測点', ptLabel: true },
        { type: 'DIMENSION', layer: 0, color: null, subType: 'LINEAR', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 5 },
        { type: 'LINE', layer: 0, color: null, x1: 0, y1: 50, x2: 100, y2: 50, gid: 'd1', blockName: '寸法' }, { type: 'TEXT', layer: 0, color: null, x: 50, y: 51, text: '100.00', height: 2, gid: 'd1', blockName: '寸法' },
        { type: 'HATCH', layer: 0, color: null, target: { type: 'CIRCLE', cx: 0, cy: 80, radius: 3 } },
        { type: 'HATCH', layer: 0, color: null, target: { type: 'CIRCLE', cx: 20, cy: 80, radius: 3 }, imp: true, hidden: true, hiddenBy: 'fill' },
        { type: 'ARC', layer: 0, color: null, cx: 40, cy: 80, radius: 5, startAngle: 0, endAngle: 1, hidden: true, hiddenBy: 'arc' }, { type: 'LINE', layer: 0, color: null, x1: 0, y1: 90, x2: 10, y2: 90, hidden: true },
        { type: 'PIN', layer: 0, x: 5, y: 5, text: 'メモ' }); ensureEntityIds(); _bumpGeomEpoch();`;
    const shownIdx = () => [...app.val('entities.map((e, i) => (e.hidden ? -1 : i)).filter((i) => i >= 0)')];
    const mine = () => [...app.val(`entities.map((e, i) => (e.hidden && e.hiddenBy === 'type' ? i : -1)).filter((i) => i >= 0)`)];
    const toast = () => app.val(`document.getElementById('cad-toast') ? document.getElementById('cad-toast').textContent : ''`);
    const panel = () => app.val(`document.getElementById('property-panel').style.display === 'flex' ? document.getElementById('property-panel').textContent : ''`);
    const badge = () => app.val(`document.querySelector('button[onclick="toggleLayerPanel()"]').classList.contains('tv-on')`);
    const BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16]; // 初めから見えている図形

    it('図形の種類: 線（線分・ポリライン・四角）・円（円・楕円）・円弧・文字・点（点名の文字も）・寸法（取り込んだ寸法の線・数字も）・塗りつぶし。写真のピンは対象外', () => {
        app.eval(SHAPES);
        assert.deepEqual([...app.val('entities.map((e) => typeViewCatOf(e))')],
            ['line', 'line', 'line', 'circle', 'circle', 'arc', 'text', 'point', 'point', 'dim', 'dim', 'dim', 'fill', 'fill', 'arc', 'line', null]);
        assert.equal(app.val(`typeViewCatOf({ type: 'MULTILEADER' })`), 'other');
        assert.equal(app.val('typeViewCatOf(null)'), null);
        const st = app.val('typeViewState()');
        assert.equal(st.active, false);
        assert.deepEqual([st.cats.line.n, st.cats.circle.n, st.cats.arc.n, st.cats.text.n, st.cats.point.n, st.cats.dim.n, st.cats.fill.n, st.cats.other.n], [3, 2, 1, 1, 2, 3, 1, 0], 'ほかの理由で隠れている図形（13・14・15）は数えない');
    });

    it('「線」を押すと、線だけ表示する（↩ 1回分）。ほかの理由で隠れていた図形・写真のピンには触らない。上のバーの 👁 に印が付く', () => {
        app.eval(SHAPES);
        assert.deepEqual(shownIdx(), BASE);
        assert.equal(badge(), false);
        const n = app.val(`typeViewTap('line')`);
        assert.equal(n, 10, '隠した図形の数');
        assert.deepEqual(shownIdx(), [0, 1, 2, 16], '線分・ポリライン・四角（と写真のピン）');
        assert.deepEqual(mine(), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        assert.deepEqual([...app.val('[13, 14, 15].map((i) => entities[i].hidden + ":" + (entities[i].hiddenBy || ""))')], ['true:fill', 'true:arc', 'true:'], '前から隠れていた図形はそのまま');
        assert.equal(app.val('undoStack.length'), 1);
        assert.match(toast(), /線 だけ表示しています（ほかの 10個 を隠しました）/);
        assert.equal(badge(), true);
        assert.equal(app.val('typeViewState().active'), true);
        // 隠した図形は、今までの「隠す」と同じ: 吸い付かない
        const snaps = app.val(`collectSnapPoints(50, 50, null, Object.assign({}, osnapState, { main: true }), 22).filter((p) => p.t === '中心' && p.x === 50 && p.y === 50).length`);
        assert.equal(snaps, 0, '隠した円の中心には吸い付かない');
        // もう一度同じ様子にしても、↩ の記録を増やさない
        assert.equal(app.val(`typeViewApply(['line'])`), 0);
        assert.equal(app.val('undoStack.length'), 1);
    });

    it('絞っているあいだは、押すたびに足す・外す。最後の1つを外す・全部になると、絞るのをやめる。「すべて表示」で元どおり', () => {
        app.eval(SHAPES + `typeViewTap('line');`);
        app.eval(`typeViewTap('circle')`);
        assert.deepEqual(shownIdx(), [0, 1, 2, 3, 4, 16], '線と円');
        assert.match(toast(), /線・円 だけ表示しています/);
        app.eval(`typeViewTap('line')`);
        assert.deepEqual(shownIdx(), [3, 4, 16], '線を外して、円だけ');
        app.eval(`typeViewTap('circle')`); // 最後の1つを外す → 絞るのをやめる
        assert.deepEqual(shownIdx(), BASE);
        assert.equal(app.val('typeViewState().active'), false);
        assert.equal(badge(), false);
        assert.match(toast(), /すべての種類を表示しました/);
        // 1つずつ足していって全部になったら、絞るのをやめる
        app.eval(`typeViewTap('text'); ['line', 'circle', 'arc', 'point', 'dim', 'fill'].forEach((k) => typeViewTap(k));`);
        assert.deepEqual(shownIdx(), BASE);
        assert.equal(app.val('typeViewState().active'), false);
        // すべて表示: この機能で隠した図形だけを戻す
        app.eval(`typeViewTap('dim')`);
        assert.deepEqual(shownIdx(), [9, 10, 11, 16], '寸法（取り込んだ寸法の線・数字も）');
        assert.ok(app.val('typeViewClear()') > 0);
        assert.deepEqual(shownIdx(), BASE, '取り込みで隠した塗りつぶし・円弧・自分で隠した線は、隠れたまま');
        assert.equal(app.val('typeViewClear()'), 0, '絞っていなければ、何もしない');
        // 図形の無い種類・知らない種類は、何もしない
        assert.equal(app.val(`typeViewTap('other') + typeViewTap('xxx')`), 0);
        assert.deepEqual(shownIdx(), BASE);
    });

    it('点だけ: 測点と点名の文字が一緒に出る。文字だけ: 点名・寸法の数字は出さない', () => {
        app.eval(SHAPES + `typeViewTap('point');`);
        assert.deepEqual(shownIdx(), [7, 8, 16]);
        app.eval(`typeViewClear(); typeViewTap('text');`);
        assert.deepEqual(shownIdx(), [6, 16]);
    });

    it('パネル: 種類のボタンと数。絞ると「すべて表示」が出る。「隠れ図形を再表示」の数には入れず、そのボタンでは戻らない。SHOWALL は全部戻す', () => {
        app.eval(SHAPES + `showLayerManagerPanel();`);
        assert.match(panel(), /種類で絞る/);
        assert.deepEqual([...app.val(`[...document.querySelectorAll('.tv-chip')].map((b) => b.dataset.tv + ':' + b.querySelector('b').textContent)`)],
            ['line:3', 'circle:2', 'arc:1', 'text:1', 'point:2', 'dim:3', 'fill:1'], '図形の無い「その他」は出さない');
        assert.equal(app.val(`document.getElementById('tv-all')`), null);
        assert.equal(app.val(`document.querySelectorAll('.tv-chip.on, .tv-chip.off').length`), 0);
        assert.match(panel(), /隠れ図形を再表示 \(1個\)/, '自分で隠した線 1個');
        app.eval(`document.querySelector('.tv-chip[data-tv="circle"]').getAttribute('onclick'); typeViewTap('circle');`);
        assert.deepEqual([...app.val(`[...document.querySelectorAll('.tv-chip.on')].map((b) => b.dataset.tv)`)], ['circle']);
        assert.equal(app.val(`document.querySelectorAll('.tv-chip.off').length`), 6);
        assert.ok(app.val(`!!document.getElementById('tv-all')`));
        assert.match(panel(), /円 だけ表示しています（ほかの 11個 を隠しています）/);
        assert.match(panel(), /隠れ図形を再表示 \(1個\)/, '種類で隠した図形は、ここの数に入れない');
        assert.match(panel(), /円弧を表示 \(1個\)/, '取り込みで隠した円弧だけ（種類で隠した円弧 5 は入れない）');
        app.eval(`showHiddenEntities('other'); showHiddenEntities('arc');`);
        assert.equal(app.val('entities[15].hidden || entities[14].hidden'), false, '自分で隠した線・取り込みで隠した円弧は出る');
        assert.equal(app.val('entities[5].hidden && entities[0].hidden'), true, '種類で隠した図形は、そのまま');
        assert.equal(app.val('typeViewState().active'), true);
        // 「すべて表示」のボタン
        app.eval(`document.getElementById('tv-all').click === undefined; typeViewClear();`);
        assert.equal(app.val(`document.getElementById('tv-all')`), null);
        // SHOWALL（全部の非表示を戻す）は、種類で隠した図形も戻して、👁 の印も消す
        app.eval(`typeViewTap('line'); processCommand('SHOWALL');`);
        assert.equal(app.val('entities.some((e) => e.hidden)'), false);
        assert.equal(badge(), false);
        // 色をまとめて変えているあいだは出さない（パネルが長くなるので）
        app.eval(`lmBulkColorMode(true)`);
        assert.equal(app.val(`document.getElementById('tv-box')`), null);
        app.eval(`lmBulkColorMode(false)`);
        assert.ok(app.val(`!!document.getElementById('tv-box')`));
    });

    it('隠した図形を選んだままにしない。↩・やり直しで戻り、👁 の印も合う。保存・図面一式にも、絞ったまま残る', async () => {
        app.eval(SHAPES + `cmdState.selectedIndices = [3, 4]; cmdState.highlightIdx = 3; typeViewTap('line');`);
        assert.equal(app.val('cmdState.selectedIndices.length + (cmdState.highlightIdx + 1)'), 0);
        // 見えている図形を選んでいるときは、そのまま
        app.eval(`cmdState.selectedIndices = [0, 1]; cmdState.highlightIdx = 0; typeViewTap('circle');`);
        assert.equal(app.val('cmdState.selectedIndices.length'), 2);
        app.eval('undo(); undo();');
        assert.deepEqual(shownIdx(), BASE);
        assert.equal(badge(), false);
        app.eval('redo()');
        assert.deepEqual(shownIdx(), [0, 1, 2, 16]);
        assert.equal(badge(), true);
        assert.equal(app.val(`_buildSaveData('x').entities[3].hiddenBy`), 'type');
        const text = await app.eval('buildWebcadDoc().then((r) => r.text)');
        app.window.__buf = new TextEncoder().encode(text).buffer;
        const back = JSON.parse(await app.eval('parseWebcadBytes(window.__buf).then((r) => JSON.stringify(r.project.entities.map((e) => (e.hidden ? e.hiddenBy || "" : "-"))))'));
        assert.deepEqual(back.slice(0, 6), ['-', '-', '-', 'type', 'type', 'type']);
    });

    it('絞ったあとに描いた図形は、隠している種類でも見える。その種類を押すと、まとめて表示に戻る。種類が1つだけの図面では出さない', () => {
        app.eval(SHAPES + `typeViewTap('line'); entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 0, cy: 0, radius: 1 }); _bumpGeomEpoch();`);
        const n = app.val('entities.length') - 1;
        assert.equal(app.val(`!!entities[${n}].hidden`), false);
        const st = app.val('typeViewState().cats.circle');
        assert.deepEqual([st.n, st.hidden], [3, 2], '円は「隠している」種類のまま');
        app.eval(`typeViewTap('circle')`);
        assert.deepEqual(shownIdx(), [0, 1, 2, 3, 4, 16, n]);
        // 種類が1つだけ
        app.eval(`entities.length = 0; entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }, { type: 'PLINE', layer: 0, color: null, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }); _bumpGeomEpoch();`);
        assert.equal(app.val('typeViewHtml()'), '');
        assert.equal(app.val(`typeViewTap('line')`), 0, '全部がその種類なら、何も隠さない');
        assert.deepEqual(app.errors(), []);
    });
});
