'use strict';
// 図形の固有IDと、IDで保持する選択状態のテスト。
// 以前は選択を「配列の何番目か」で持っていたため、削除・トリム・元に戻す等で配列が詰まると
// 別の図形を指してしまっていた（続けて ERASE すると選んでいない図形が消える）。
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('図形の固有IDと選択状態', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    // A,B,C,D の4本の線（x1 で見分ける）
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand();
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            ['A', 'B', 'C', 'D'].forEach((n, i) => entities.push({ type: 'LINE', layer: 0, name: n, x1: i * 10, y1: 0, x2: i * 10 + 5, y2: 0 }));
            ensureEntityIds();
        `);
    });

    const names = (expr) => app.val(`(${expr}).map(i => entities[i] && entities[i].name)`);
    const all = () => app.val('entities.map(e => e.name)');

    it('すべての図形に重複しないIDが付く（既存のIDは変えない）', () => {
        const ids = app.val('entities.map(e => e.id)');
        assert.equal(new Set(ids).size, 4);
        const before = ids.slice();
        app.eval('ensureEntityIds();');
        assert.deepEqual(app.val('entities.map(e => e.id)'), before);
    });

    it('JSON 複製で重複したIDは、後ろの図形に新しいIDを付け直す', () => {
        app.eval('entities.push(JSON.parse(JSON.stringify(entities[1]))); entities[4].name = "B2"; ensureEntityIds();');
        const ids = app.val('entities.map(e => e.id)');
        assert.equal(new Set(ids).size, 5);
        assert.equal(ids[1], app.val('entities[1].id'));
        assert.ok(ids[4] > Math.max(...ids.slice(0, 4)), '複製には新しい番号');
    });

    it('前にある図形が削除されても、選択は同じ図形を指し続ける', () => {
        app.eval('cmdState.selectedIndices = [2, 3]; cmdState.highlightIdx = 2;');
        app.eval('entities.splice(0, 1);'); // A を削除（長押し削除・トリム等と同じ操作）
        assert.deepEqual(names('cmdState.selectedIndices'), ['C', 'D']);
        assert.equal(app.val('entities[cmdState.highlightIdx].name'), 'C');
    });

    it('【回帰】長押しで別の文字を消した後に ERASE しても、選んだ図形だけが消える', () => {
        app.eval('cmdState.selectedIndices = [1, 2];'); // B と C を選択
        app.eval('saveUndo(); entities.splice(0, 1);'); // 長押し削除で A が消える
        app.eval(`processCommand('ERASE');`);
        assert.deepEqual(all(), ['D'], '以前は番号がずれて C と D が消え、B が残っていた');
    });

    it('選択中の図形そのものが削除されたら選択から外れる', () => {
        app.eval('cmdState.selectedIndices = [1]; cmdState.highlightIdx = 1;');
        app.eval('entities.splice(1, 1);');
        assert.deepEqual(app.val('cmdState.selectedIndices'), []);
        assert.equal(app.eval('cmdState.highlightIdx'), -1);
    });

    it('別の場所でトリムしても選択は変わらない', () => {
        app.eval(`
            entities.push({ type: 'LINE', layer: 0, name: 'V', x1: 2, y1: -5, x2: 2, y2: 5 });
            cmdState.selectedIndices = [3];
        `);
        app.eval('executeTrim([{ x: 1, y: 0 }]);'); // A の左端部分を切り取る（配列から A が消えて末尾に残りが入る）
        assert.deepEqual(names('cmdState.selectedIndices'), ['D']);
    });

    it('元に戻した後も、選択は同じ図形を指す', () => {
        app.eval('cmdState.selectedIndices = [1];');
        app.eval('saveUndo(); entities.splice(0, 1);'); // A を削除 → B は 0 番目
        assert.deepEqual(names('cmdState.selectedIndices'), ['B']);
        app.eval('undo();'); // A が戻る → B は再び 1 番目
        assert.deepEqual(names('cmdState.selectedIndices'), ['B']);
        assert.deepEqual(app.val('cmdState.selectedIndices'), [1]);
    });

    it('複製を選ぶと、元の図形ではなく複製が選ばれる', () => {
        app.eval('entities.push(JSON.parse(JSON.stringify(entities[1]))); entities[4].name = "B2";');
        app.eval('cmdState.selectedIndices = [4];');
        assert.deepEqual(names('cmdState.selectedIndices'), ['B2']);
        assert.notEqual(app.val('entities[4].id'), app.val('entities[1].id'));
    });

    it('移動・オフセットの対象もIDで保持する', () => {
        app.eval('cmdState.moveTarget = 3; cmdState.offsetTarget = 2; entities.splice(0, 1);');
        assert.equal(app.val('entities[cmdState.moveTarget].name'), 'D');
        assert.equal(app.val('entities[cmdState.offsetTarget].name'), 'C');
        app.eval('resetCommand();');
        assert.equal(app.eval('cmdState.moveTarget'), undefined);
    });

    it('プロパティ画面の編集は、画面を開いた後に配列が変わっても正しい図形に適用される', () => {
        const idC = app.val('entities[2].id');
        app.eval('entities.splice(0, 1);');
        app.eval(`changeEntityPropById(${idC}, 'color', '#ff0000');`);
        assert.equal(app.val(`entities.find(e => e.name === 'C').color`), '#ff0000');
        assert.equal(app.val(`entities.find(e => e.name === 'D').color`), undefined);
        app.eval(`changeEntityPropById(999999, 'color', '#00ff00');`); // 存在しないIDは何もしない
        assert.ok(!app.val('entities.some(e => e.color === "#00ff00")'));
    });

    it('グループ選択（ブロック）も、前の図形が消えてもグループ全体を指し続ける', () => {
        app.eval(`
            entities[2].gid = 'g1'; entities[3].gid = 'g1'; entities[2].blockName = entities[3].blockName = 'SYM';
            window.groupSelectEnabled = true;
            view.x = 0; view.y = 0; view.scale = 1; view.rotation = 0;
            entities.forEach(e => { e.bbox = calcBBox(e); });
            (function () { const s = wcsToScreen(22, 0); selectEntityAt(s.x, s.y); })();
        `);
        assert.deepEqual(names('cmdState.selectedIndices').sort(), ['C', 'D']);
        app.eval('entities.splice(0, 1);');
        assert.deepEqual(names('cmdState.selectedIndices').sort(), ['C', 'D']);
    });

    it('保存・復元でIDが保たれ、IDの無い古いデータには新しいIDが付く', () => {
        const data = app.val('_buildSaveData("t")');
        assert.ok(data.entities.every((e) => typeof e.id === 'number'));
        const maxId = Math.max(...data.entities.map((e) => e.id));
        // 古い形式（IDなし）を復元
        const legacy = { entities: [{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 1, y2: 1 }, { type: 'CIRCLE', layer: 0, cx: 0, cy: 0, radius: 1 }] };
        app.window.__legacy = legacy;
        app.eval('applyProjectData(JSON.parse(JSON.stringify(window.__legacy)));');
        const ids = app.val('entities.map(e => e.id)');
        assert.ok(ids.every((id) => typeof id === 'number'));
        assert.equal(new Set(ids).size, 2);
        // 復元したデータのIDは以後の新しい図形と重ならない
        app.window.__saved = data;
        app.eval('applyProjectData(JSON.parse(JSON.stringify(window.__saved)));');
        assert.deepEqual(app.val('entities.map(e => e.id)'), data.entities.map((e) => e.id));
        app.eval(`saveUndo(); entities.push({ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 1, y2: 1 }); ensureEntityIds();`);
        assert.ok(app.val('entities[entities.length - 1].id') > maxId);
    });

    it('大きな図面でも選択の参照は速い（2万図形・500個選択を1000回参照）', () => {
        app.eval(`
            entities.length = 0;
            for (let i = 0; i < 20000; i++) entities.push({ type: 'LINE', layer: 0, x1: i, y1: 0, x2: i + 1, y2: 0 });
            ensureEntityIds();
            cmdState.selectedIndices = Array.from({ length: 500 }, (_, k) => k * 40);
        `);
        const t0 = Date.now();
        app.eval('for (let k = 0; k < 1000; k++) { cmdState.selectedIndices; cmdState.highlightIdx; }');
        const ms = Date.now() - t0;
        assert.ok(ms < 2000, `遅すぎる: ${ms}ms`);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
