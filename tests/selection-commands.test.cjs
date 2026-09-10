'use strict';
// タップ選択 → 選択アクションバー／ツールバーの編集コマンド（削除・移動・複写・回転）のテスト。
// バーのボタンは issueCommand() を呼ぶ。以前は issueCommand がハイライトを先に消していたため、
// 1つだけタップで選んだ図形はどのボタンでも引き継がれず、もう一度タップが必要だった。
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('選択アクションバーの編集コマンド', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand();
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            view.x = 0; view.y = 0; view.scale = 1; view.rotation = 0;
            window.groupSelectEnabled = true;
            entities.push({ type: 'LINE', layer: 0, name: 'A', x1: 0, y1: 0, x2: 50, y2: 0 });
            entities.push({ type: 'CIRCLE', layer: 0, name: 'B', cx: 100, cy: 0, radius: 10 });
            entities.push({ type: 'LINE', layer: 0, name: 'G1', gid: 'g1', blockName: 'SYM', x1: 0, y1: 100, x2: 20, y2: 100 });
            entities.push({ type: 'LINE', layer: 0, name: 'G2', gid: 'g1', blockName: 'SYM', x1: 0, y1: 110, x2: 20, y2: 110 });
            entities.forEach(e => { e.bbox = calcBBox(e); });
            ensureEntityIds();
        `);
    });

    const tapAt = (x, y) => app.eval(`(function () { const s = wcsToScreen(${x}, ${y}); selectEntityAt(s.x, s.y); })()`);
    const point = (x, y) => app.eval(`handlePointInput({ x: ${x}, y: ${y} })`);
    const byName = (n) => app.val(`entities.find(e => e.name === ${JSON.stringify(n)}) || null`);
    const names = () => app.val('entities.map(e => e.name)');

    it('1つだけタップで選んだ図形を「削除」ボタンで削除できる', () => {
        tapAt(25, 0);
        assert.equal(app.eval('cmdState.highlightIdx'), 0);
        app.eval(`issueCommand('ERASE')`);
        assert.deepEqual(names(), ['B', 'G1', 'G2']);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
    });

    it('1つだけタップで選んだ図形を「移動」ボタンで移動できる', () => {
        tapAt(110, 0); // 円 B の右端
        app.eval(`issueCommand('MOVE')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_MOVE_BASE', '対象を引き継いで基点指定へ進む');
        point(0, 0);
        point(5, 7);
        const b = byName('B');
        assert.ok(near(b.cx, 105) && near(b.cy, 7), JSON.stringify(b));
        assert.ok(near(byName('A').x1, 0), '他の図形は動かない');
    });

    it('1つだけタップで選んだ図形を「複写」ボタンで複写でき、複写には別のIDが付く', () => {
        tapAt(25, 0);
        app.eval(`issueCommand('COPY')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_COPY_BASE');
        point(0, 0);
        point(0, 30);
        const lines = app.val(`entities.filter(e => e.name === 'A')`);
        assert.equal(lines.length, 2);
        assert.ok(lines.some((l) => near(l.y1, 30)));
        app.eval('ensureEntityIds();');
        const ids = app.val(`entities.map(e => e.id)`);
        assert.equal(new Set(ids).size, ids.length);
    });

    it('1つだけタップで選んだ図形を「回転」ボタンで回転の基点指定へ引き継ぐ', () => {
        tapAt(25, 0);
        app.eval(`issueCommand('ROTATE')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_ROTATE_BASE');
        assert.deepEqual(app.val('_getRotateTargets().map(i => entities[i].name)'), ['A']);
    });

    it('ブロックをタップして「削除」するとブロック全体が消える（従来どおり）', () => {
        tapAt(10, 100);
        assert.deepEqual(app.val('cmdState.selectedIndices.map(i => entities[i].name)').sort(), ['G1', 'G2']);
        app.eval(`issueCommand('ERASE')`);
        assert.deepEqual(names(), ['A', 'B']);
    });

    it('コマンド欄に ERASE と入力した場合も、タップで選んだ図形を削除する', () => {
        tapAt(25, 0);
        app.eval(`processCommand('ERASE')`);
        assert.deepEqual(names(), ['B', 'G1', 'G2']);
    });

    it('何も選んでいなければ「削除」は削除対象の選択待ちになる（勝手に消さない）', () => {
        app.eval(`issueCommand('ERASE')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_ERASE_SELECT');
        assert.equal(app.eval('entities.length'), 4);
    });

    it('選択待ち中にマウスが通過して付いた強調表示では、次のコマンドで勝手に消さない', () => {
        app.eval(`issueCommand('MOVE')`); // 移動対象の選択待ち
        app.eval('cmdState.highlightIdx = 0;'); // マウス通過による強調表示
        app.eval(`issueCommand('ERASE')`);
        assert.equal(app.eval('entities.length'), 4);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_ERASE_SELECT');
    });

    it('削除は元に戻せる', () => {
        tapAt(25, 0);
        app.eval(`issueCommand('ERASE')`);
        app.eval('undo()');
        assert.deepEqual(names(), ['A', 'B', 'G1', 'G2']);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
