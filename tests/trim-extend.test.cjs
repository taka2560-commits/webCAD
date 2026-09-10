'use strict';
// トリム（なぞって切り取り）・延長のテスト
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('トリム・延長', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            view.x = 0; view.y = 0; view.scale = 1; view.rotation = 0;
            cmdState.mode = 'IDLE';
        `);
    });

    const setup = (ents) => { app.window.__ents = ents; app.eval('window.__ents.forEach(e => entities.push(JSON.parse(JSON.stringify(e))));'); };
    const trimAt = (x, y) => app.eval(`executeTrim([{ x: ${x}, y: ${y} }])`);
    const extendAt = (x, y) => app.eval(`executeExtend([{ x: ${x}, y: ${y} }])`);
    const lines = () => app.val(`entities.filter(e => e.type === 'LINE').map(e => [e.x1, e.y1, e.x2, e.y2])`);
    const hasLine = (ls, x1, y1, x2, y2) => ls.some((l) => (near(l[0], x1) && near(l[1], y1) && near(l[2], x2) && near(l[3], y2)) || (near(l[0], x2) && near(l[1], y2) && near(l[2], x1) && near(l[3], y1)));
    const vbar = (x) => ({ type: 'LINE', layer: 0, x1: x, y1: -10, x2: x, y2: 10 });
    const target = { type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 0 };

    describe('トリム', () => {
        it('2本の境界の間をタップすると、その区間だけ取り除く', () => {
            setup([target, vbar(30), vbar(70)]);
            trimAt(50, 0);
            const ls = lines();
            assert.ok(hasLine(ls, 0, 0, 30, 0), JSON.stringify(ls));
            assert.ok(hasLine(ls, 70, 0, 100, 0), JSON.stringify(ls));
            assert.equal(ls.length, 4);
        });

        it('端の区間をタップすると、境界まで短くなる', () => {
            setup([target, vbar(30)]);
            trimAt(10, 0);
            assert.ok(hasLine(lines(), 30, 0, 100, 0), JSON.stringify(lines()));
        });

        it('どことも交わらない線はそのまま削除する', () => {
            setup([target]);
            trimAt(50, 0);
            assert.equal(app.eval('entities.length'), 0);
        });

        it('長方形の辺を境界として切り取る（以前は線ごと削除されていた）', () => {
            setup([target, { type: 'RECTANG', layer: 0, x1: 20, y1: -10, x2: 60, y2: 10 }]);
            trimAt(80, 0);
            const ls = lines();
            assert.ok(hasLine(ls, 0, 0, 60, 0), `長方形の右辺(x=60)で切れるはず: ${JSON.stringify(ls)}`);
            assert.equal(app.eval(`entities.filter(e => e.type === 'RECTANG').length`), 1, '境界の長方形は残る');
        });

        it('閉じたポリライン（取り込んだ境界線など）の辺を境界として切り取る', () => {
            setup([target, { type: 'PLINE', layer: 0, closed: true, points: [{ x: 20, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: 20, y: 10 }] }]);
            trimAt(10, 0);
            assert.ok(hasLine(lines(), 20, 0, 100, 0), JSON.stringify(lines()));
        });

        it('円弧は描かれている部分だけを境界にする', () => {
            const upperArc = { type: 'ARC', layer: 0, cx: 50, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI, counterclockwise: true };
            // 上半分の円弧と交わる線 → 交点(50+√75, 5)で切れる
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 5, x2: 100, y2: 5 }, upperArc]);
            trimAt(90, 5);
            const x = 50 + Math.sqrt(75);
            assert.ok(hasLine(lines(), 0, 5, x, 5), JSON.stringify(lines()));
            // 下側を通る線は、描かれていない部分としか交わらない → 境界なしとして削除
            app.eval('entities.length = 0;');
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: -5, x2: 100, y2: -5 }, upperArc]);
            trimAt(90, -5);
            assert.equal(lines().length, 0, `描かれていない部分で切れている: ${JSON.stringify(lines())}`);
        });

        it('ブロック（グループ）の線を切り取った残りは同じグループに残る', () => {
            setup([Object.assign({}, target, { gid: 'b1', blockName: 'SYM' }), vbar(30)]);
            trimAt(10, 0);
            const piece = app.val(`entities.find(e => e.type === 'LINE' && Math.abs(e.x1 - e.x2) > 50)`);
            assert.equal(piece.gid, 'b1');
            assert.equal(piece.blockName, 'SYM');
        });

        it('線以外（円など）をタップするとその図形を削除する', () => {
            setup([{ type: 'CIRCLE', layer: 0, cx: 0, cy: 0, radius: 10 }]);
            trimAt(10, 0);
            assert.equal(app.eval('entities.length'), 0);
        });

        it('トリムは元に戻せる', () => {
            setup([target, vbar(30), vbar(70)]);
            trimAt(50, 0);
            app.eval('undo()');
            const ls = lines();
            assert.equal(ls.length, 3);
            assert.ok(hasLine(ls, 0, 0, 100, 0));
        });
    });

    describe('延長', () => {
        it('タップした側の端点を、最も近い境界の線まで伸ばす', () => {
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }, vbar(80), vbar(120)]);
            extendAt(45, 0);
            assert.ok(hasLine(lines(), 0, 0, 80, 0), JSON.stringify(lines()));
        });

        it('始点側をタップすると始点側を伸ばす', () => {
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }, vbar(-20)]);
            extendAt(5, 0);
            assert.ok(hasLine(lines(), -20, 0, 50, 0), JSON.stringify(lines()));
        });

        it('長方形・ポリラインの辺も境界にする', () => {
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }, { type: 'RECTANG', layer: 0, x1: 80, y1: -10, x2: 120, y2: 10 }]);
            extendAt(45, 0);
            assert.ok(hasLine(lines(), 0, 0, 80, 0), JSON.stringify(lines()));
            app.eval('entities.length = 0;');
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }, { type: 'PLINE', layer: 0, closed: false, points: [{ x: 90, y: -30 }, { x: 90, y: 30 }] }]);
            extendAt(45, 0);
            assert.ok(hasLine(lines(), 0, 0, 90, 0), JSON.stringify(lines()));
        });

        it('円弧は描かれている部分だけを境界にする', () => {
            const upperArc = { type: 'ARC', layer: 0, cx: 100, cy: 0, radius: 20, startAngle: 0, endAngle: Math.PI, counterclockwise: true };
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 5, x2: 50, y2: 5 }, upperArc]);
            extendAt(45, 5);
            const x = 100 - Math.sqrt(400 - 25);
            assert.ok(hasLine(lines(), 0, 5, x, 5), JSON.stringify(lines()));
            app.eval('entities.length = 0;');
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: -5, x2: 50, y2: -5 }, upperArc]);
            extendAt(45, -5);
            assert.ok(hasLine(lines(), 0, -5, 50, -5), `描かれていない部分まで伸びている: ${JSON.stringify(lines())}`);
        });

        it('境界が無ければ何も変えない', () => {
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }]);
            extendAt(45, 0);
            assert.ok(hasLine(lines(), 0, 0, 50, 0));
        });

        it('延長は元に戻せる', () => {
            setup([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }, vbar(80)]);
            extendAt(45, 0);
            app.eval('undo()');
            assert.ok(hasLine(lines(), 0, 0, 50, 0), JSON.stringify(lines()));
        });
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
