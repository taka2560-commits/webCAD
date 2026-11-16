'use strict';
// グループ化（GROUP・G）と分解（UNGROUP・X）。v5.59.3 で「外側のグループ」を足した:
//   まとまり（ブロック・測点と点名・寸法・グループ。図形の gid）を含む図形をグループにするときは、中のまとまりを残して、外側のグループ（ogid）にする。
//   以前は全部を1つの gid に書き換えていて、測点と点名の組・ブロックの測点の一覧が壊れた。
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('グループ化と分解（外側のグループ）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0; initLayers();
            window.groupSelectEnabled = true; cmdState.selectedIndices = []; cmdState.highlightIdx = -1;`);
    });
    // 0・1: ばらの線。2・3: 測点 K1（点＋点名の文字）。4・5: 測点 K2。6・7: ブロックの測点 B1（円＋属性の文字）。8・9: ブロックの測点 B2。10: 関係ない線
    const SHAPES = `entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', layer: 0, color: null, x1: 10, y1: 0, x2: 10, y2: 10 },
        { type: 'POINT', layer: 0, color: null, x: 0, y: 0, name: 'K1', gid: 'p1', blockName: '測点' }, { type: 'TEXT', layer: 0, color: null, x: 1, y: 0.6, text: 'K1', height: 2, gid: 'p1', blockName: '測点', ptLabel: true },
        { type: 'POINT', layer: 0, color: null, x: 10, y: 0, name: 'K2', gid: 'p2', blockName: '測点' }, { type: 'TEXT', layer: 0, color: null, x: 11, y: 0.6, text: 'K2', height: 2, gid: 'p2', blockName: '測点', ptLabel: true },
        { type: 'CIRCLE', layer: 0, color: null, cx: 10, cy: 10, radius: 0.3, gid: 'b1', blockName: '杭', ins: { x: 10, y: 10 } }, { type: 'TEXT', layer: 0, color: null, x: 11, y: 11, text: 'B1', height: 1, attTag: '点名', gid: 'b1', blockName: '杭', ins: { x: 10, y: 10 } },
        { type: 'CIRCLE', layer: 0, color: null, cx: 0, cy: 10, radius: 0.3, gid: 'b2', blockName: '杭', ins: { x: 0, y: 10 } }, { type: 'TEXT', layer: 0, color: null, x: 1, y: 11, text: 'B2', height: 1, attTag: '点名', gid: 'b2', blockName: '杭', ins: { x: 0, y: 10 } },
        { type: 'LINE', layer: 0, color: null, x1: 50, y1: 50, x2: 60, y2: 50 }); ensureEntityIds();`;
    const names = () => [...app.val(`collectSurveyPoints().map((p) => p.name + '@' + p.x + ',' + p.y).sort()`)];
    const log = () => app.val(`document.getElementById('command-log').textContent`);

    it('ばらの図形だけなら、今までどおり1つの gid のグループ。1つタップすると、まとめて選ぶ。分解で元に戻る', () => {
        app.eval(SHAPES + `cmdState.selectedIndices = [0, 1, 10]; processCommand('GROUP');`);
        const g = app.val('entities[0].gid');
        assert.ok(g && app.val(`entities[1].gid === '${g}' && entities[10].gid === '${g}'`));
        assert.equal(app.val('entities[0].blockName'), 'グループ');
        assert.equal(app.val('entities.some((e) => e.ogid)'), false, '外側のグループは使わない');
        assert.equal(app.val('undoStack.length'), 1);
        assert.deepEqual([...app.val('expandGroupTargets(1)')], [0, 1, 10]);
        app.eval(`cmdState.selectedIndices = [0, 1, 10]; processCommand('X');`);
        assert.equal(app.val('entities[0].gid === undefined && entities[0].blockName === undefined'), true);
        // 2個より少ないときは、グループにしない
        app.eval(`cmdState.selectedIndices = [0]; processCommand('G');`);
        assert.equal(app.val('entities[0].gid'), undefined);
    });

    it('測点・ブロックを含む図形は、中のまとまりを残して外側のグループにする（測点の一覧・点名の組が壊れない）', () => {
        app.eval(SHAPES);
        const before = names();
        assert.deepEqual(before, ['B1@10,10', 'B2@0,10', 'K1@0,0', 'K2@10,0']);
        app.eval(`cmdState.selectedIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; processCommand('GROUP');`);
        const og = app.val('entities[0].ogid');
        assert.ok(og, '外側のグループ');
        assert.equal(app.val(`entities.slice(0, 10).every((e) => e.ogid === '${og}') && entities[10].ogid === undefined`), true);
        assert.deepEqual([...app.val('entities.slice(0, 10).map((e) => e.gid || "")')], ['', '', 'p1', 'p1', 'p2', 'p2', 'b1', 'b1', 'b2', 'b2'], '中のまとまり（gid）はそのまま');
        assert.equal(app.val('entities[0].blockName'), undefined, 'ばらの図形に「グループ」の名前は付けない（外側のグループは ogid だけ）');
        assert.deepEqual(names(), before, '測点の一覧は変わらない（以前は、ブロックの測点が1つにまとまって消えた）');
        assert.match(log(), /中のブロック・測点・寸法などのまとまりは、そのまま残しています/);
        // 1つタップすると、まとめて選ぶ（測点をタップしても、ばらの線をタップしても）
        for (const i of [0, 3, 6, 9]) assert.deepEqual([...app.val(`expandGroupTargets(${i})`)], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        assert.deepEqual([...app.val('expandGroupTargets(10)')], [10]);
        app.eval(`clearSelection(); window.__hit = hitTestEntity; hitTestEntity = () => 6; try { selectEntityAt(0, 0); } finally { hitTestEntity = window.__hit; }`);
        assert.equal(app.val('cmdState.selectedIndices.length'), 10);
        // 「タップでブロック全体を選択」が切なら、1つだけ
        app.eval('window.groupSelectEnabled = false');
        assert.deepEqual([...app.val('expandGroupTargets(6)')], [6]);
        app.eval('window.groupSelectEnabled = true');
        // 座標一覧から測点を選ぶときなど、gid のまとまりを直に引く所は、中のまとまりのまま
        assert.deepEqual([...app.val(`getGroupMembers('p1')`)], [2, 3]);
        assert.deepEqual([...app.val('groupMembersOf(entities[10])')], []);
    });

    it('分解: まず外側のグループだけを外す（中のまとまりは残る）。もう一度 分解 で、中のまとまりを分解する。↩ で戻る', () => {
        app.eval(SHAPES + `cmdState.selectedIndices = [0, 1, 2, 3, 6, 7]; groupSelection();`);
        assert.equal(app.val('entities.filter((e) => e.ogid).length'), 6);
        app.eval(`cmdState.selectedIndices = [0]; explodeSelection();`); // 仲間の1つを選んで分解しても、グループ全体を外す
        assert.equal(app.val('entities.some((e) => e.ogid)'), false);
        assert.deepEqual([...app.val('[entities[2].gid, entities[6].gid, entities[2].blockName]')], ['p1', 'b1', '測点']);
        assert.match(log(), /中のブロック・測点・寸法などのまとまりは残ります/);
        assert.equal(app.val('undoStack.length'), 2);
        app.eval('undo()');
        assert.equal(app.val('entities.filter((e) => e.ogid).length'), 6, '↩ で外側のグループが戻る');
        app.eval(`undo(); cmdState.selectedIndices = [2, 3]; explodeSelection();`);
        assert.equal(app.val('entities[2].gid === undefined && entities[3].gid === undefined'), true, '外側のグループが無ければ、今までどおり gid を分解');
        assert.equal(app.val('entities[6].gid'), 'b1');
    });

    it('グループをもう一度グループにすると、新しい外側のグループに入れ直す。複写は、複写どうしの新しいグループになる（中のまとまりも）', () => {
        app.eval(SHAPES + `cmdState.selectedIndices = [0, 1, 2, 3]; groupSelection();`);
        const og1 = app.val('entities[0].ogid');
        app.eval(`cmdState.selectedIndices = [0, 1, 2, 3, 10]; groupSelection();`);
        const og2 = app.val('entities[0].ogid');
        assert.ok(og2 && og2 !== og1);
        assert.deepEqual([...app.val('expandGroupTargets(10)')], [0, 1, 2, 3, 10]);
        // 複写（鏡像・複写・配列・張り合わせの「元の図形を残す」が使う editCloneEntity）
        app.eval(`(() => { const gm = {}; [0, 1, 2, 3, 10].map((i) => editCloneEntity(entities[i], gm)).forEach((c) => entities.push(c)); ensureEntityIds(); })()`);
        const n = app.val('entities.length');
        const c = app.val(`entities.slice(${n - 5}).map((e) => [e.ogid, e.gid || ''])`).map((x) => [...x]);
        assert.ok(c[0][0] && c[0][0] !== og2, '複写は別の外側のグループ');
        assert.equal(new Set(c.map((x) => x[0])).size, 1);
        assert.ok(c[2][1] && c[2][1] !== 'p1' && c[2][1] === c[3][1], '中の測点のまとまりも、複写どうしの新しいまとまり');
        assert.deepEqual([...app.val(`expandGroupTargets(${n - 1})`)], [n - 5, n - 4, n - 3, n - 2, n - 1]);
        assert.deepEqual([...app.val('expandGroupTargets(0)')], [0, 1, 2, 3, 10], '元のグループはそのまま');
        // 複写コマンド（COPY）も同じ
        app.eval(`entities.length = ${n - 5}; cmdState.selectedIndices = [0, 1, 2, 3, 10]; processCommand('COPY'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 100, y: 0 }, true); resetCommand();`);
        const m = app.val('entities.length');
        assert.equal(m, n, '5個の複写');
        const og3 = app.val(`entities[${m - 1}].ogid`);
        assert.ok(og3 && og3 !== og2);
        assert.equal(app.val(`entities.slice(${m - 5}).every((e) => e.ogid === '${og3}')`), true);
    });

    it('保存しても外側のグループは残る。DXF の寸法の拡張データには入れない。選んだときの下のバーは「🧩 グループ」と 分解', () => {
        app.eval(SHAPES + `cmdState.selectedIndices = [0, 1, 2, 3]; groupSelection();`);
        const og = app.val('entities[0].ogid');
        assert.equal(app.val(`_buildSaveData('x').entities[3].ogid`), og);
        assert.doesNotMatch(app.val(`dxfOutXdataChunks(entities[0]).join('')`), /ogid/);
        app.eval(`cmdState.selectedIndices = expandGroupTargets(2); cmdState.highlightIdx = 2; updateSelectionBar();`);
        assert.match(app.val(`document.getElementById('sel-label').textContent`), /🧩 グループ \(4個\)/);
        assert.equal(app.val(`document.getElementById('sel-group-btn').textContent`), '分解');
        // ばらの図形を2つ選んだときは、今までどおり「🧩 グループ化」
        app.eval(`cmdState.selectedIndices = [10, 4]; cmdState.highlightIdx = 10; updateSelectionBar();`);
        assert.equal(app.val(`document.getElementById('sel-group-btn').textContent`), '分解', '測点（まとまり）を含むので、今までどおり 分解（グループ化はコマンド G・ブロック管理から）');
        assert.deepEqual(app.errors(), []);
    });

    // ===== G3（別の担当の点検）で見つかった点の直し =====
    it('図面一式（.webcad）で書き出して開いても、外側のグループは残る。オフセットで作った線は、元のグループに入れない', async () => {
        app.eval(SHAPES + `cmdState.selectedIndices = [0, 1, 2, 3, 6, 7]; groupSelection();`);
        const og = app.val('entities[0].ogid');
        const text = await app.eval('buildWebcadDoc().then((r) => r.text)');
        app.window.__buf = new TextEncoder().encode(text).buffer;
        const ents = JSON.parse(await app.eval('parseWebcadBytes(window.__buf).then((r) => JSON.stringify(r.project.entities.map((e) => [e.ogid || "", e.gid || ""])))'));
        assert.deepEqual(ents.map((x) => x[0] === og), [true, true, true, true, false, false, true, true, false, false, false], '外側のグループ（以前は、開くと消えた）');
        assert.deepEqual(ents.map((x) => x[1]), ['', '', 'p1', 'p1', 'p2', 'p2', 'b1', 'b1', 'b2', 'b2', ''], '中のまとまり');
        // オフセット: 新しい線は独立（gid と同じ扱い）
        const c = app.val('createOffsetEntity(entities[0], 2, 5, 5)');
        assert.ok(c && c.type === 'LINE');
        assert.equal(app.val('(() => { const c = createOffsetEntity(entities[0], 2, 5, 5); return c.ogid === undefined && c.gid === undefined; })()'), true);
        assert.equal(app.val('entities[0].ogid'), og, '元の線はそのまま');
    });

    it('中のまとまりは割らない: ブロックの円だけ・測点の点だけを選んでグループにしても、属性の文字・点名の文字も一緒に入る', () => {
        app.eval(SHAPES + `cmdState.selectedIndices = [6, 10, 2]; groupSelection();`); // ブロック b1 の円・ばらの線・測点 K1 の点
        const og = app.val('entities[6].ogid');
        assert.ok(og);
        assert.deepEqual([...app.val(`entities.map((e, i) => (e.ogid === '${og}' ? i : -1)).filter((i) => i >= 0)`)], [2, 3, 6, 7, 10], '同じまとまりの文字（3・7）も入る');
        for (const i of [3, 7, 10]) assert.deepEqual([...app.val(`expandGroupTargets(${i})`)], [2, 3, 6, 7, 10], 'どれをタップしても同じ仲間');
        // ばらの図形どうしは、今までどおり（広げない）
        app.eval(`cmdState.selectedIndices = [0, 1]; groupSelection();`);
        assert.deepEqual([...app.val('expandGroupTargets(0)')], [0, 1]);
        assert.deepEqual(app.errors(), []);
    });
});
