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

    // ---- 垂線（2026-09-22: ポリライン・長方形・寸法・基点測定・円弧の向こう側に対応） ----
    // 基点 (bx, by) を持つ入力の途中にする
    function withBase(mode, bx, by) {
        app.eval(`cmdState = _makeCmdState(); cmdState.mode = '${mode}'; cmdState.startWcs = { x: ${bx}, y: ${by} };
            cmdState.points = [{ x: ${bx}, y: ${by} }]; cmdState.measBase = { x: ${bx}, y: ${by} }; cmdState.moveBase = { x: ${bx}, y: ${by} };`);
    }

    it('斜めのポリラインの区間へ、正確な垂線の足に吸着する（近接点より優先）', () => {
        withBase('WAITING_LINE_P2', 0, 100);
        // 区間 (0,0)-(100,50) への (0,100) からの垂線の足 = (40, 20)
        const s = snapAt([{ type: 'PLINE', layer: 0, closed: false, points: [{ x: -50, y: -25 }, { x: 0, y: 0 }, { x: 100, y: 50 }] }], 40, 20, 3, 2);
        assert.equal(s.type, '垂線');
        assert.ok(near(s.wcsX, 40) && near(s.wcsY, 20), JSON.stringify(s));
    });

    it('閉じたポリラインの最後の辺（始点へ戻る辺）にも垂線が出る', () => {
        withBase('WAITING_LINE_P2', -30, 10);
        // 閉じる辺は (0,40)→(0,0)。(-30,10) からの足 = (0,10)（辺の中点 (0,20) とは別の位置）
        const s = snapAt([{ type: 'PLINE', layer: 0, closed: true, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }] }], 0, 10, 2, 2);
        assert.equal(s.type, '垂線');
        assert.ok(near(s.wcsX, 0) && near(s.wcsY, 10));
    });

    it('長方形の辺にも垂線が出て、中点は辺の中点・中央は「中心」になる', () => {
        const rect = { type: 'RECTANG', layer: 0, x1: 0, y1: 0, x2: 60, y2: 40 };
        withBase('WAITING_LINE_P2', 15, 100);
        const perp = snapAt([rect], 15, 40, 2, 2);
        assert.equal(perp.type, '垂線');
        assert.ok(near(perp.wcsX, 15) && near(perp.wcsY, 40));
        app.eval(`entities.length = 0; cmdState = _makeCmdState(); cmdState.mode = 'WAITING_LINE_P1';`);
        const mid = snapAt([rect], 60, 20, -2, 2);   // 右辺の中点
        assert.equal(mid.type, '中点');
        assert.ok(near(mid.wcsX, 60) && near(mid.wcsY, 20));
        app.eval('entities.length = 0;');
        const cen = snapAt([rect], 30, 20, 2, 2);    // 長方形の中央
        assert.equal(cen.type, '中心');
    });

    for (const [label, mode] of [['整列寸法の2点目', 'WAITING_DIMALN_P2'], ['平行寸法の2点目', 'WAITING_DIMLIN_P2'], ['基点測定', 'WAITING_DIMMEAS_TO']]) {
        it(`${label}でも垂線に吸着する（点から線までの垂直な距離）`, () => {
            withBase(mode, 30, 80);
            const s = snapAt([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 0 }], 30, 0, 2, 1);
            assert.equal(s.type, '垂線');
            assert.ok(near(s.wcsX, 30) && near(s.wcsY, 0));
        });
    }

    it('連続寸法は直列なら前の点、並列なら最初の点からの垂線', () => {
        const line = [{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 0 }];
        app.eval(`cmdState = _makeCmdState(); cmdState.mode = 'WAITING_DIMCONT_NEXT'; cmdState.dimContType = 'SERIAL';
            cmdState.dimContPoints = [{ x: 10, y: 50 }, { x: 20, y: 60 }, { x: 70, y: 60 }];`);
        const serial = snapAt(line, 70, 0, 2, 1);
        assert.equal(serial.type, '垂線');
        assert.ok(near(serial.wcsX, 70));
        app.eval(`entities.length = 0; cmdState.dimContType = 'PARALLEL';`);
        const parallel = snapAt(line, 10, 0, 2, 1);
        assert.equal(parallel.type, '垂線');
        assert.ok(near(parallel.wcsX, 10));
    });

    it('円弧は向こう側の垂線にも吸着する（描かれている範囲だけ）', () => {
        // 0〜2.5rad の円弧（中点は 1.25rad なので、向こう側の足 (0,50)=π/2 とは別の位置）
        const arc = { type: 'ARC', layer: 0, cx: 0, cy: 0, radius: 50, startAngle: 0, endAngle: 2.5, counterclockwise: true };
        withBase('WAITING_LINE_P2', 0, -80);  // 円弧の下側の外から
        const s = snapAt([arc], 0, 50, 2, 1);  // 向こう側の足 (0, 50)
        assert.equal(s.type, '垂線');
        assert.ok(near(s.wcsX, 0) && near(s.wcsY, 50));
        app.eval('entities.length = 0;');
        const off = snapAt([arc], 0, -50, 2, 1); // 手前側 (0,-50) は描かれていない部分
        assert.notEqual(off && off.type, '垂線');
    });

    it('線の上から引き始めたとき、始点そのものを垂線にしない', () => {
        withBase('WAITING_LINE_P2', 30, 0);
        app.eval('osnapState.near = false;');
        const s = snapAt([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 0 }], 30, 0, 2, 1);
        assert.notEqual(s && s.type, '垂線');
    });

    it('垂線の足が線分の外（延長線上）になるときは吸着しない', () => {
        withBase('WAITING_LINE_P2', 150, 50);  // 足 (150,0) は線分 0..100 の外
        const s = snapAt([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 0 }], 100, 0, -4, 1);
        assert.notEqual(s && s.type, '垂線');
    });

    it('画面を回転していても垂線の足は同じ位置', () => {
        app.eval('view.rotation = 0.6;');
        withBase('WAITING_LINE_P2', 0, 100);
        const s = snapAt([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 50 }], 40, 20, 2, 2);
        assert.equal(s.type, '垂線');
        assert.ok(near(s.wcsX, 40) && near(s.wcsY, 20));
    });

    it('頂点の多いポリラインでも、カーソルから遠い頂点は候補にしない', () => {
        // 2万頂点の線（等高線を想定）。カーソルはその1点の近く
        app.eval(`cmdState = _makeCmdState(); cmdState.mode = 'WAITING_LINE_P1';
            const pts = []; for (let i = 0; i < 20000; i++) pts.push({ x: i * 10, y: (i % 2) * 5 });
            window.__ents = [{ type: 'PLINE', layer: 0, closed: false, points: pts }];`);
        const s = app.val(`(function(){ window.__ents.forEach(e => { e.bbox = calcBBox(e); entities.push(e); });
            view.scale = 1; view.x = -50000; view.y = 300;
            const w = { x: 50000, y: 0 }; const sc = wcsToScreen(w.x, w.y);
            const t0 = performance.now(); const r = findSnap(sc.x + 2, sc.y + 1, w.x + 2, w.y - 1); return { r, ms: performance.now() - t0 }; })()`);
        assert.equal(s.r.type, '端点');
        assert.ok(near(s.r.wcsX, 50000) && near(s.r.wcsY, 0));
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
