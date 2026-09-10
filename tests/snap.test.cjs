'use strict';
// オブジェクトスナップのテスト。
// 画面上の位置（ピクセル）で findSnap を呼び、どの種類の点に吸着するかを確認する。
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('オブジェクトスナップ', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            entities.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }, { name: '非表示', color: '#fff', visible: false });
            view.x = 0; view.y = 0; view.scale = 1; view.rotation = 0;
            osnapState = { main: true, end: true, mid: true, cen: true, int: true, near: true, perp: true };
            cmdState.mode = 'IDLE';
        `);
    });

    /** 図形を置き、WCS の (x, y) から画面上で (dx, dy) ピクセルずらした位置でスナップを探す */
    function snapAt(ents, x, y, dx = 0, dy = 0) {
        app.window.__ents = ents;
        return app.val(`(function () {
            window.__ents.forEach(e => { const c = JSON.parse(JSON.stringify(e)); if (c.type !== 'HATCH') c.bbox = calcBBox(c); entities.push(c); });
            const s = wcsToScreen(${x}, ${y});
            const sx = s.x + ${dx}, sy = s.y + ${dy};
            const w = screenToWcs(sx, sy);
            return findSnap(sx, sy, w.x, w.y);
        })()`);
    }
    // 交点(62.5, 37.5)が各線の中点と重ならない配置（重なると中点でも正解になり、交点の検出を確かめられない）
    const cross = [
        { type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 60 },
        { type: 'LINE', layer: 0, x1: 0, y1: 100, x2: 100, y2: 0 },
    ];

    it('交点付近では近接点ではなく交点に吸着する（近接点が常に勝つ不具合の回帰）', () => {
        const s = snapAt(cross, 62.5, 37.5, 3, -2);
        assert.equal(s && s.type, '交点');
        assert.ok(near(s.wcsX, 62.5) && near(s.wcsY, 37.5));
    });

    it('端点付近では端点に吸着する', () => {
        const s = snapAt(cross, 100, 60, -3, 2);
        assert.equal(s.type, '端点');
        assert.ok(near(s.wcsX, 100) && near(s.wcsY, 60));
    });

    it('幾何的な点が近くに無いときだけ近接点に吸着する', () => {
        const s = snapAt(cross, 20, 20, 1, 1);
        assert.equal(s.type, '近接点');
    });

    it('ブロック展開で生じたポリラインと線分の交点に吸着する', () => {
        const s = snapAt([
            { type: 'PLINE', layer: 0, closed: false, gid: 'b1', blockName: 'SYM', points: [{ x: 0, y: 50 }, { x: 40, y: 50 }, { x: 100, y: 50 }] },
            { type: 'LINE', layer: 0, x1: 85, y1: -10, x2: 85, y2: 200 },
        ], 85, 50, 2, 2);
        assert.equal(s.type, '交点');
        assert.ok(near(s.wcsX, 85) && near(s.wcsY, 50));
    });

    it('長方形の辺と線分の交点に吸着する', () => {
        const s = snapAt([
            { type: 'RECTANG', layer: 0, x1: 0, y1: 0, x2: 60, y2: 40 },
            { type: 'LINE', layer: 0, x1: 25, y1: -20, x2: 25, y2: 50 },
        ], 25, 0, 2, -2);
        assert.equal(s.type, '交点');
        assert.ok(near(s.wcsX, 25) && near(s.wcsY, 0));
    });

    it('円どうしの交点に吸着する', () => {
        const s = snapAt([
            { type: 'CIRCLE', layer: 0, cx: 0, cy: 0, radius: 50 },
            { type: 'CIRCLE', layer: 0, cx: 80, cy: 0, radius: 50 },
        ], 40, 30, 2, 2);
        assert.equal(s.type, '交点');
        assert.ok(near(s.wcsX, 40) && near(s.wcsY, 30));
    });

    it('円弧は描かれている範囲の交点だけを採用する', () => {
        const arc = { type: 'ARC', layer: 0, cx: 0, cy: 0, radius: 50, startAngle: 0, endAngle: Math.PI / 2, counterclockwise: true };
        const onArc = snapAt([arc, { type: 'LINE', layer: 0, x1: 30, y1: -100, x2: 30, y2: 100 }], 30, 40, 2, 2);
        assert.equal(onArc.type, '交点', '描かれている部分（第1象限）の交点');
        app.eval('entities.length = 0;');
        const offArc = snapAt([arc, { type: 'LINE', layer: 0, x1: 30, y1: -100, x2: 30, y2: 100 }], 30, -40, 2, 2);
        assert.notEqual(offArc && offArc.type, '交点', '描かれていない部分（第4象限）に交点を作らない');
    });

    it('非表示の図形・非表示画層の図形には吸着しない', () => {
        const s = snapAt([
            { type: 'LINE', layer: 0, hidden: true, x1: 0, y1: 0, x2: 100, y2: 0 },
            { type: 'LINE', layer: 1, x1: 0, y1: 10, x2: 100, y2: 10 },
        ], 100, 0, 1, 1);
        assert.equal(s, null);
    });

    it('交点スナップをOFFにすると交点には吸着しない', () => {
        app.eval('osnapState.int = false; osnapState.near = false;');
        const s = snapAt(cross, 62.5, 37.5, 3, -2);
        assert.notEqual(s && s.type, '交点');
    });

    it('線分の作図中は始点から線への垂線の足に吸着できる', () => {
        app.eval(`cmdState.mode = 'WAITING_LINE_P2'; cmdState.startWcs = { x: 30, y: 80 }; osnapState.near = false;`);
        const s = snapAt([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 0 }], 30, 0, 2, 1);
        assert.equal(s.type, '垂線');
        assert.ok(near(s.wcsX, 30) && near(s.wcsY, 0));
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
