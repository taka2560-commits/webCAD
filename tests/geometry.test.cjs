'use strict';
// 幾何計算の単体テスト（交点・オフセット・回転・円弧付きポリライン・スプライン・色変換）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('幾何計算', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    const v = (expr) => app.val(expr);
    const pt = (p, x, y, msg = '') => assert.ok(p && near(p.x, x, 1e-9) && near(p.y, y, 1e-9), `${msg} 期待 (${x}, ${y}) / 実際 ${JSON.stringify(p)}`);

    describe('交点', () => {
        it('線分×線分: 交差・平行・範囲外', () => {
            pt(v('intersectLineLine(0,0,10,10, 0,10,10,0)'), 5, 5);
            assert.equal(v('intersectLineLine(0,0,10,0, 0,1,10,1)'), null, '平行');
            assert.equal(v('intersectLineLine(0,0,1,1, 5,0,6,-1)'), null, '延長上でのみ交わる');
            pt(v('intersectLineLine(0,0,10,0, 10,-5,10,5)'), 10, 0, '端点で接する');
        });

        it('線分×円: 2点・接点1点・外れ・円の内側', () => {
            const two = v('intersectSegCircle(-10,0,10,0, 0,0,5)');
            assert.equal(two.length, 2);
            pt(two[0], -5, 0); pt(two[1], 5, 0);
            assert.equal(v('intersectSegCircle(-10,5,10,5, 0,0,5)').length, 1, '接線は1点');
            assert.equal(v('intersectSegCircle(-10,6,10,6, 0,0,5)').length, 0);
            assert.equal(v('intersectSegCircle(-1,0,1,0, 0,0,5)').length, 0, '円の内側だけの線分');
        });

        it('円×円: 2点・接する・同心・離れている', () => {
            const two = v('intersectCircleCircle({cx:0,cy:0,radius:5},{cx:8,cy:0,radius:5})');
            assert.equal(two.length, 2);
            two.forEach((p) => { assert.ok(near(p.x, 4)); assert.ok(near(Math.abs(p.y), 3)); });
            assert.equal(v('intersectCircleCircle({cx:0,cy:0,radius:5},{cx:10,cy:0,radius:5})').length, 1);
            assert.equal(v('intersectCircleCircle({cx:0,cy:0,radius:5},{cx:0,cy:0,radius:3})').length, 0);
            assert.equal(v('intersectCircleCircle({cx:0,cy:0,radius:1},{cx:10,cy:0,radius:1})').length, 0);
        });

        it('円弧の角度範囲（0°をまたぐ場合を含む）', () => {
            assert.equal(v('isAngleBetweenCCW(Math.PI/4, 0, Math.PI/2)'), true);
            assert.equal(v('isAngleBetweenCCW(Math.PI, 0, Math.PI/2)'), false);
            assert.equal(v('isAngleBetweenCCW(0.1, 3*Math.PI/2, Math.PI/2)'), true, '270°→90° の弧は 0° 付近を含む');
            assert.equal(v('isAngleBetweenCCW(Math.PI, 3*Math.PI/2, Math.PI/2)'), false);
        });
    });

    describe('オフセット', () => {
        it('線分: クリックした側に平行移動する', () => {
            const left = v(`createOffsetEntity({type:'LINE',x1:0,y1:0,x2:10,y2:0}, 2, 5, 3)`);
            assert.ok(near(left.y1, 2) && near(left.y2, 2) && near(left.x1, 0) && near(left.x2, 10));
            const right = v(`createOffsetEntity({type:'LINE',x1:0,y1:0,x2:10,y2:0}, 2, 5, -3)`);
            assert.ok(near(right.y1, -2) && near(right.y2, -2));
        });

        it('円: 外側/内側、内側で半径が0以下になるなら作らない', () => {
            assert.ok(near(v(`createOffsetEntity({type:'CIRCLE',cx:0,cy:0,radius:5}, 2, 10, 0)`).radius, 7));
            assert.ok(near(v(`createOffsetEntity({type:'CIRCLE',cx:0,cy:0,radius:5}, 2, 1, 0)`).radius, 3));
            assert.equal(v(`createOffsetEntity({type:'CIRCLE',cx:0,cy:0,radius:5}, 6, 1, 0)`), null);
        });

        it('長方形: 外側に広げる/内側に縮める', () => {
            const out = v(`createOffsetEntity({type:'RECTANG',x1:0,y1:0,x2:10,y2:10}, 1, 20, 20)`);
            assert.deepEqual([out.x1, out.y1, out.x2, out.y2], [-1, -1, 11, 11]);
            const inn = v(`createOffsetEntity({type:'RECTANG',x1:0,y1:0,x2:10,y2:10}, 1, 5, 5)`);
            assert.deepEqual([inn.x1, inn.y1, inn.x2, inn.y2], [1, 1, 9, 9]);
        });

        it('長さ0の線分はオフセットしない（NaN の図形を作らない）', () => {
            assert.equal(v(`createOffsetEntity({type:'LINE',x1:3,y1:3,x2:3,y2:3}, 2, 5, 5)`), null);
        });

        it('元図形の bbox・固有IDを引き継がない', () => {
            const o = v(`createOffsetEntity({type:'LINE',x1:0,y1:0,x2:10,y2:0,bbox:{minX:0,minY:0,maxX:10,maxY:0},id:7}, 2, 5, 3)`);
            assert.equal(o.bbox, undefined);
            assert.equal(o.id, undefined);
        });
    });

    describe('回転', () => {
        const rot = (ent, angle) => v(`(function(){ const e = ${JSON.stringify(ent)}; rotateEntity(e, 0, 0, ${angle}); return e; })()`);

        it('線分・円・円弧・文字を原点まわりに90°回転する', () => {
            const l = rot({ type: 'LINE', x1: 1, y1: 0, x2: 2, y2: 0 }, Math.PI / 2);
            pt({ x: l.x1, y: l.y1 }, 0, 1); pt({ x: l.x2, y: l.y2 }, 0, 2);
            const c = rot({ type: 'CIRCLE', cx: 3, cy: 0, radius: 1 }, Math.PI / 2);
            pt({ x: c.cx, y: c.cy }, 0, 3);
            const a = rot({ type: 'ARC', cx: 0, cy: 0, radius: 1, startAngle: 0, endAngle: 1 }, Math.PI / 2);
            assert.ok(near(a.startAngle, Math.PI / 2) && near(a.endAngle, 1 + Math.PI / 2));
            const t = rot({ type: 'TEXT', x: 1, y: 0, text: 'A', height: 1 }, Math.PI / 2);
            pt(t, 0, 1);
            assert.ok(near(t.rotation, Math.PI / 2));
        });

        it('長方形は回転すると閉じたポリラインになる', () => {
            const r = rot({ type: 'RECTANG', x1: 0, y1: 0, x2: 2, y2: 1 }, Math.PI / 2);
            assert.equal(r.type, 'PLINE');
            assert.equal(r.closed, true);
            assert.equal(r.points.length, 4);
            pt(r.points[2], -1, 2);
        });

        it('ポリラインの座標を丸めない（4回の90°回転で元の位置に戻る）', () => {
            const src = { type: 'PLINE', closed: false, points: [{ x: 1.23456789, y: 0.00012345 }, { x: 98765.4321, y: 12345.6789 }] };
            const e = v(`(function(){ const e = ${JSON.stringify(src)}; for (let i = 0; i < 4; i++) rotateEntity(e, 100, 200, Math.PI/2); return e; })()`);
            e.points.forEach((p, i) => {
                assert.ok(near(p.x, src.points[i].x, 1e-6) && near(p.y, src.points[i].y, 1e-6), `点${i}: ${JSON.stringify(p)}`);
            });
        });
    });

    describe('円弧付きポリライン（bulge）・スプライン', () => {
        it('bulge=1 は反時計回りの半円、bulge=-1 は反対側の半円', () => {
            const ccw = v('expandBulgeVertices([{x:0,y:0,bulge:1},{x:10,y:0}], false)');
            const cw = v('expandBulgeVertices([{x:0,y:0,bulge:-1},{x:10,y:0}], false)');
            pt(ccw[0], 0, 0); pt(ccw[ccw.length - 1], 10, 0);
            assert.ok(Math.min(...ccw.map((p) => p.y)) < -4.99, '反時計回りの半円は弦の下側を通る');
            assert.ok(Math.max(...cw.map((p) => p.y)) > 4.99, '時計回りの半円は弦の上側を通る');
            ccw.forEach((p) => assert.ok(near(Math.hypot(p.x - 5, p.y), 5, 1e-9)));
        });

        it('閉じたポリラインは最後の頂点→最初の頂点の bulge も展開する', () => {
            const pts = v('expandBulgeVertices([{x:0,y:0},{x:10,y:0},{x:10,y:10,bulge:1}], true)');
            assert.ok(pts.length > 3, '閉じる区間の円弧が展開されていない');
        });

        it('1次のスプラインは制御点を結ぶ折れ線、端点は制御点の両端', () => {
            const p = v('evalBSplinePoints([{x:0,y:0},{x:10,y:0},{x:10,y:10}], 1, null, 21)');
            pt(p[0], 0, 0); pt(p[p.length - 1], 10, 10);
            p.forEach((q) => assert.ok(near(q.y, 0, 1e-9) || near(q.x, 10, 1e-9), `折れ線上にない点 ${JSON.stringify(q)}`));
        });
    });

    describe('色変換', () => {
        it('色番号表にある色はその番号、無い色は最も近い番号（白にしない）', () => {
            assert.equal(v(`hexToAci('#FF0000')`), 1);
            assert.equal(v(`hexToAci('#00ffff')`), 4);
            const navy = v(`hexToAci('#000080')`);
            assert.notEqual(navy, 7);
            const back = v(`aciToHex(${navy})`);
            const b = parseInt(back.slice(1), 16);
            assert.ok((b & 255) > ((b >> 16) & 255), `青系の色になるはず: ${back}`);
        });
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
