'use strict';
// 作図・編集の強化（cad-editgeom.js・cad-edit.js・cad-grip.js）のテスト:
//   鏡像（円弧の向き・長方形・読める文字・寸法線の位置）、尺度変更、配列（縦横・円形・上限）、
//   分割（点で・等分）、結合（つながった線をたどる・閉じた形・一直線・円弧）、角の処理（角を出す・フィレット・面取り・隅切り）、
//   点を動かす（グリップ: 線・ポリライン・長方形・円・円弧・寸法、マウス・指の操作、やめても選んだまま）、範囲選択・ヒント
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

const nearPt = (p, x, y, eps = 1e-9) => near(p.x, x, eps) && near(p.y, y, eps);

describe('作図・編集の強化', () => {
    let app;
    before(async () => {
        app = await loadApp();
        app.eval(`window.__touch = (type, pts) => { const ev = new Event(type, { bubbles:true, cancelable:true });
            Object.defineProperty(ev, 'touches', { value: pts.map(p => ({ clientX: p[0], clientY: p[1] })) }); canvas.dispatchEvent(ev); };`);
    });
    after(() => app.close());

    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand();
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0;
            view.x = 400; view.y = 300; view.scale = 1; view.rotation = 0;
            ucs.originX = 0; ucs.originY = 0; ucs.angle = 0; orthoMode = false; osnapState.main = true;
            window.groupSelectEnabled = true;
            localStorage.removeItem('webcad_last_params'); lastParams = Object.assign({}, DEFAULT_LAST_PARAMS);
            localStorage.removeItem('cad_survey_unit');
            document.body.classList.remove('fullscreen-mode');
        `);
    });

    const add = (list) => app.eval(`(${JSON.stringify(list)}).forEach(e => entities.push(Object.assign({ layer: 0, color: null }, e))); ensureEntityIds(); _bumpGeomEpoch();`);
    const ents = () => app.val('entities');
    // 図面の点 (x,y) をタップ・クリックした（カーソルをそこへ動かしてから点を入れる）
    const pick = (x, y) => app.eval(`(function(){ const s = wcsToScreen(${x}, ${y}); mouse.screenX = s.x; mouse.screenY = s.y; mouse.wcsX = ${x}; mouse.wcsY = ${y}; handlePointInput({ x: ${x}, y: ${y} }); })()`);
    const point = (x, y) => app.eval(`handlePointInput({ x: ${x}, y: ${y} })`);
    const xf = (entity, T) => app.val(`(function(){ const T = ${T}; return editTransformEntity(${JSON.stringify(entity)}, T); })()`);
    const mode = () => app.eval('cmdState.mode');

    // ===== 鏡像・尺度変更（形の計算） =====
    it('鏡像: 線・長方形（縦横の鏡は長方形のまま、斜めは閉じたポリライン）・楕円', () => {
        const l = xf({ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 5 }, 'editMirrorXform({x:20,y:0},{x:20,y:10})');
        assert.ok(nearPt({ x: l.x1, y: l.y1 }, 40, 0) && nearPt({ x: l.x2, y: l.y2 }, 30, 5), JSON.stringify(l));
        const r = xf({ type: 'RECTANG', x1: 0, y1: 0, x2: 10, y2: 5 }, 'editMirrorXform({x:20,y:0},{x:20,y:10})');
        assert.equal(r.type, 'RECTANG');
        assert.deepEqual([r.x1, r.x2].sort((a, b) => a - b), [30, 40]);
        const q = xf({ type: 'RECTANG', x1: 0, y1: 0, x2: 10, y2: 5 }, 'editMirrorXform({x:0,y:0},{x:1,y:1})');
        assert.equal(q.type, 'RECTANG', '45° の鏡は縦と横が入れ替わるだけ');
        assert.ok(nearPt({ x: q.x2, y: q.y2 }, 5, 10), '対角の点 (10,5) は (5,10) に映る');
        const d = xf({ type: 'RECTANG', x1: 0, y1: 0, x2: 10, y2: 5 }, 'editMirrorXform({x:0,y:0},{x:Math.cos(Math.PI/6),y:Math.sin(Math.PI/6)})');
        assert.equal(d.type, 'PLINE'); assert.equal(d.closed, true); assert.equal(d.points.length, 4);
        assert.ok(nearPt(d.points[1], 5, 5 * Math.sqrt(3)), '(10,0) は 30° の鏡で 60° の向きへ');
        const el = xf({ type: 'ELLIPSE', cx: 3, cy: 4, rx: 5, ry: 2, rotation: 0.3 }, 'editMirrorXform({x:0,y:0},{x:1,y:0})');
        assert.ok(nearPt({ x: el.cx, y: el.cy }, 3, -4) && near(el.rotation, -0.3), JSON.stringify(el));
    });

    it('鏡像: 円弧は鏡に映した範囲に描かれる（左回り・右回りとも）', () => {
        const check = (arc, onDeg, offDeg) => app.val(`(function(){
            const e = editTransformEntity(${JSON.stringify(arc)}, editMirrorXform({x:0,y:0},{x:0,y:10}));
            const at = (d) => ({ x: 10 * Math.cos(d * Math.PI / 180), y: 10 * Math.sin(d * Math.PI / 180) });
            return { on: ${JSON.stringify(onDeg)}.map(d => { const p = at(d); return isPointOnArc(e, p.x, p.y); }),
                     off: ${JSON.stringify(offDeg)}.map(d => { const p = at(d); return isPointOnArc(e, p.x, p.y); }), ccw: e.counterclockwise };
        })()`);
        // 第1象限の円弧（左回り 0°→90°）→ 縦の鏡で第2象限
        let r = check({ type: 'ARC', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2, counterclockwise: true }, [100, 135, 170], [10, 45, 80, 200, 300]);
        assert.deepEqual(r.on, [true, true, true]); assert.deepEqual(r.off, [false, false, false, false, false]);
        // 右回り 90°→0°（同じ第1象限）
        r = check({ type: 'ARC', cx: 0, cy: 0, radius: 10, startAngle: Math.PI / 2, endAngle: 0, counterclockwise: false }, [100, 135, 170], [10, 45, 80, 200, 300]);
        assert.deepEqual(r.on, [true, true, true]); assert.deepEqual(r.off, [false, false, false, false, false]);
        assert.equal(r.ccw, false, '回る向きの印は元のまま（始点と終点を入れ替えて表す）');
    });

    it('鏡像の文字は裏返さず、読める向きのまま鏡の位置に置く（揃えを入れ替える）', () => {
        let t = xf({ type: 'TEXT', x: 0, y: 0, text: 'ABC', height: 2 }, 'editMirrorXform({x:10,y:0},{x:10,y:5})');
        assert.ok(nearPt(t, 20, 0)); assert.equal(t.halign, 'right'); assert.equal(t.rotation, undefined);
        t = xf({ type: 'TEXT', x: 0, y: 0, text: 'ABC', height: 2, halign: 'right' }, 'editMirrorXform({x:10,y:0},{x:10,y:5})');
        assert.equal(t.halign, undefined, '右揃え → 左揃え');
        t = xf({ type: 'TEXT', x: 0, y: 0, text: 'ABC', height: 2 }, 'editMirrorXform({x:0,y:10},{x:5,y:10})');
        assert.ok(nearPt(t, 0, 20)); assert.equal(t.valign, 'top', '上下の鏡: 文字は線の下側へ'); assert.equal(t.rotation, undefined);
        t = xf({ type: 'TEXT', x: 0, y: 0, text: 'ABC', height: 2, rotation: 0.5 }, 'editRotateXform({x:0,y:0}, 0.25)');
        assert.ok(near(t.rotation, 0.75), '回転はそのまま足す');
    });

    it('鏡像の寸法: 寸法線の位置も鏡に映る（平行寸法の横・縦・回した向き、整列寸法）', () => {
        const dims = [
            { type: 'DIMENSION', subType: 'LINEAR', p1: { x: 0, y: 0 }, p2: { x: 10, y: 3 }, offset: 5, dimDir: 'H' },
            { type: 'DIMENSION', subType: 'LINEAR', p1: { x: 0, y: 0 }, p2: { x: 3, y: 10 }, offset: -7, dimDir: 'V' },
            { type: 'DIMENSION', subType: 'LINEAR', p1: { x: 2, y: 1 }, p2: { x: 10, y: 3 }, offset: 4, dimDir: 'H', dimRot: 0.4 },
            { type: 'DIMENSION', subType: 'LINEAR', p1: { x: 0, y: 0 }, p2: { x: 10, y: 3 }, offset: 6 }, // 向きが自動
            { type: 'DIMENSION', subType: 'ALIGNED', p1: { x: 0, y: 0 }, p2: { x: 10, y: 3 }, offset: 3 },
        ];
        ['editMirrorXform({x:20,y:0},{x:20,y:1})', 'editMirrorXform({x:0,y:0},{x:Math.cos(0.5),y:Math.sin(0.5)})', 'editScaleXform({x:1,y:2}, 2.5)', 'editRotateXform({x:3,y:-1}, 1.1)'].forEach(T => {
            dims.forEach(d => {
                const r = app.val(`(function(){
                    const T = ${T}, d = ${JSON.stringify(d)};
                    const P0 = dimLinePrims(d.subType, d.p1, d.p2, d.offset, d.dimDir, d.dimRot, 1);
                    const a = editXformPoint(T, P0.dim.x1, P0.dim.y1), b = editXformPoint(T, P0.dim.x2, P0.dim.y2);
                    const e = editTransformEntity(JSON.parse(JSON.stringify(d)), T);
                    const P1 = dimLinePrims(e.subType, e.p1, e.p2, e.offset, e.dimDir, e.dimRot, 1);
                    const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
                    const c = { x: P1.dim.x1, y: P1.dim.y1 }, f = { x: P1.dim.x2, y: P1.dim.y2 };
                    return { ok: (same(a, c) && same(b, f)) || (same(a, f) && same(b, c)), v0: P0.value * T.k, v1: P1.value };
                })()`);
                assert.ok(r.ok, `寸法線の位置 ${T} ${JSON.stringify(d)}`);
                assert.ok(near(r.v0, r.v1, 1e-9), '寸法の値は倍率ぶん');
            });
        });
    });

    it('尺度変更: 基点を中心に倍率ぶん（円の半径・文字の高さ・寸法線のずれ・ブロックの挿入点）', () => {
        const c = xf({ type: 'CIRCLE', cx: 20, cy: 10, radius: 5 }, 'editScaleXform({x:10,y:10}, 2)');
        assert.ok(nearPt({ x: c.cx, y: c.cy }, 30, 10) && near(c.radius, 10));
        const t = xf({ type: 'TEXT', x: 11, y: 10, text: 'a', height: 2, ins: { x: 11, y: 10 } }, 'editScaleXform({x:10,y:10}, 3)');
        assert.ok(nearPt(t, 13, 10) && near(t.height, 6) && nearPt(t.ins, 13, 10));
        const a = xf({ type: 'DIMENSION', subType: 'ANGULAR', vertex: { x: 0, y: 0 }, arm1: { x: 5, y: 0 }, arm2: { x: 0, y: 5 }, arcRadius: 3 }, 'editScaleXform({x:0,y:0}, 2)');
        assert.ok(near(a.arcRadius, 6) && nearPt(a.arm1, 10, 0));
        // 公共座標（数十万 m）でも、基点の近くの点は桁が落ちない
        const big = xf({ type: 'LINE', x1: -34567.891, y1: 123456.789, x2: -34567.881, y2: 123456.789 }, 'editMirrorXform({x:-34567.891,y:123456.789},{x:-34567.891,y:123457.789})');
        assert.equal(big.x1, -34567.891); assert.equal(big.y1, 123456.789);
    });

    // ===== コマンドの流れ =====
    it('鏡像コマンド: タップで選んだ図形を映して複写し、元を残す・消すを選べる。元に戻せる', () => {
        add([{ type: 'LINE', name: 'A', x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'CIRCLE', name: 'B', cx: 100, cy: 100, radius: 5 }]);
        app.eval(`(function(){ const s = wcsToScreen(5, 0); selectEntityAt(s.x, s.y); issueCommand('MIRROR'); })()`);
        assert.equal(mode(), 'WAITING_MIRROR_P1', 'タップで選んだ図形を引き継ぐ');
        assert.match(app.eval(`document.getElementById('property-panel-title').textContent`), /鏡像/);
        point(20, 0); assert.equal(mode(), 'WAITING_MIRROR_P2');
        app.eval('_drawFrame(false)'); // 途中の表示でエラーが出ない
        point(20, 10);
        assert.equal(mode(), 'IDLE');
        let es = ents();
        assert.equal(es.length, 3);
        assert.ok(nearPt({ x: es[2].x1, y: es[2].y1 }, 40, 0) && nearPt({ x: es[2].x2, y: es[2].y2 }, 30, 0));
        assert.ok(near(es[0].x1, 0), '元の図形は残る');
        app.eval('ensureEntityIds()');
        es = ents(); assert.equal(new Set(es.map(e => e.id)).size, 3, '複写には新しいID');
        app.eval('undo()'); assert.equal(ents().length, 2);
        // 元を消す
        app.eval(`lastParams.mirrorKeep = false; processCommand('MI');`);
        assert.equal(mode(), 'WAITING_MIRROR_SELECT');
        pick(5, 0); assert.equal(mode(), 'WAITING_MIRROR_P1');
        point(0, 5); point(10, 5);
        es = ents(); assert.equal(es.length, 2);
        assert.ok(nearPt({ x: es[0].x1, y: es[0].y1 }, 0, 10), '元の図形を映した');
    });

    it('鏡像コマンド: ブロックの複写は、複写どうしの新しいグループになる', () => {
        add([{ type: 'LINE', name: 'G1', gid: 'g1', blockName: 'SYM', x1: 0, y1: 0, x2: 5, y2: 0 },
             { type: 'LINE', name: 'G2', gid: 'g1', blockName: 'SYM', x1: 0, y1: 1, x2: 5, y2: 1 }]);
        app.eval(`processCommand('MIRROR')`); pick(2, 0);
        assert.deepEqual(app.val('cmdState.selectedIndices').sort(), [0, 1], 'ブロック全体を選ぶ');
        point(10, 0); point(10, 5);
        const es = ents();
        assert.equal(es.length, 4);
        assert.equal(es[2].gid, es[3].gid); assert.notEqual(es[2].gid, 'g1');
    });

    it('尺度変更コマンド: 数で倍率を入れ、基点で確定（0 以下の倍率は受け付けない）', () => {
        add([{ type: 'CIRCLE', cx: 10, cy: 0, radius: 2 }]);
        app.eval(`processCommand('SC')`); assert.equal(mode(), 'WAITING_SCALE_SELECT');
        pick(12, 0); assert.equal(mode(), 'WAITING_SCALE_BASE');
        app.eval(`processCommand('0')`); assert.equal(app.eval('lastParams.scaleK || "2"'), '2', '0 は受け付けない');
        app.eval(`processCommand('3')`); assert.equal(app.eval('lastParams.scaleK'), '3');
        app.eval('_drawFrame(false)');
        point(0, 0);
        const c = ents()[0];
        assert.ok(nearPt({ x: c.cx, y: c.cy }, 30, 0) && near(c.radius, 6), JSON.stringify(c));
        assert.equal(mode(), 'IDLE');
        // 長さから倍率を求める
        app.eval(`processCommand('SCALE')`);
        app.eval(`document.getElementById('edit-scale-from').value = '4'; document.getElementById('edit-scale-to').value = '10'; editScaleInput('len');`);
        assert.equal(app.eval('lastParams.scaleK'), '2.5');
    });

    it('配列: 縦横（間隔のマイナス・UCS の向き）、円形（回す・回さない・角度の範囲）、多すぎるときは作らない', () => {
        add([{ type: 'LINE', name: 'A', x1: 0, y1: 0, x2: 1, y2: 0 }]);
        app.eval(`lastParams.arrKind = 'rect'; lastParams.arrCols = '3'; lastParams.arrRows = '2'; lastParams.arrDX = '10'; lastParams.arrDY = '-5';`);
        app.eval(`processCommand('AR')`); pick(0.5, 0);
        assert.equal(mode(), 'WAITING_ARRAY_SET');
        app.eval('_drawFrame(false)');
        app.eval('dimConfirmPoint()'); // ☑確定 で作る
        let es = ents();
        assert.equal(es.length, 6);
        const starts = es.map(e => [e.x1, e.y1].map(v => Math.round(v * 1e6) / 1e6).join(',')).sort();
        assert.deepEqual(starts, ['0,-5', '0,0', '10,-5', '10,0', '20,-5', '20,0']);
        app.eval('undo()'); assert.equal(ents().length, 1);
        // UCS を 90° 回すと、横（→）は UCS の X の向き（図面の上）
        app.eval(`ucs.angle = Math.PI / 2; lastParams.arrRows = '1'; lastParams.arrCols = '2'; lastParams.arrDY = '5';`);
        app.eval(`processCommand('AR')`); pick(0.5, 0); app.eval('editArrayCommit()');
        es = ents(); assert.ok(nearPt({ x: es[1].x1, y: es[1].y1 }, 0, 10), JSON.stringify(es[1]));
        app.eval('undo(); ucs.angle = 0;');
        // 円形: 4つ（元を含む）・一周・図形も回す
        app.eval(`lastParams.arrKind = 'polar'; lastParams.arrN = '4'; lastParams.arrAng = '360'; lastParams.arrRot = true;`);
        app.eval(`processCommand('ARRAY')`); pick(0.5, 0);
        app.eval('editArrayCommit()'); assert.equal(ents().length, 1, '中心がまだなので作らない');
        assert.equal(mode(), 'WAITING_ARRAY_SET');
        point(-5, 0); // 中心
        app.eval('editArrayCommit()');
        es = ents(); assert.equal(es.length, 4);
        assert.ok(nearPt({ x: es[1].x1, y: es[1].y1 }, -5, 5) && nearPt({ x: es[1].x2, y: es[1].y2 }, -5, 6), '90° 回した位置と向き');
        app.eval('undo()');
        // 回さない・90° の範囲に3つ（45° おき）
        app.eval(`lastParams.arrN = '3'; lastParams.arrAng = '90'; lastParams.arrRot = false;`);
        app.eval(`processCommand('ARRAY')`); pick(0.5, 0); point(-5, 0); app.eval('editArrayCommit()');
        es = ents(); assert.equal(es.length, 3);
        assert.ok(near(es[1].y2 - es[1].y1, 0) && near(es[1].x2 - es[1].x1, 1), '向きはそのまま');
        const c = Math.cos(Math.PI / 4) * 5.5;
        assert.ok(nearPt({ x: (es[1].x1 + es[1].x2) / 2, y: es[1].y1 }, -5 + c, c, 1e-9), JSON.stringify(es[1]));
        app.eval('undo()');
        // 多すぎる
        app.eval(`lastParams.arrKind = 'rect'; lastParams.arrCols = '300'; lastParams.arrRows = '300';`);
        app.eval(`processCommand('ARRAY')`); pick(0.5, 0); app.eval('editArrayCommit()');
        assert.equal(ents().length, 1);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /多すぎます/);
    });

    it('分割: 点で分ける（線・円弧・開いたポリラインの途中と頂点・閉じた形は開く・長方形）', () => {
        const split = (e, x, y) => app.val(`editSplitAt(${JSON.stringify(e)}, ${x}, ${y})`);
        let r = split({ type: 'LINE', layer: 2, x1: 0, y1: 0, x2: 10, y2: 0 }, 4, 0.5);
        assert.equal(r.length, 2); assert.ok(nearPt({ x: r[0].x2, y: r[0].y2 }, 4, 0) && nearPt({ x: r[1].x1, y: r[1].y1 }, 4, 0));
        assert.equal(r[1].layer, 2, '画層を引き継ぐ');
        assert.ok(split({ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }, 10, 0).error, '端では分けない');
        r = split({ type: 'ARC', cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI, counterclockwise: true }, 0, 10);
        assert.equal(r.length, 2); assert.ok(near(r[0].endAngle, Math.PI / 2) && near(r[1].startAngle, Math.PI / 2));
        r = split({ type: 'PLINE', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, 10, 5);
        assert.deepEqual(r.map(p => p.points.length), [3, 2]);
        assert.ok(nearPt(r[0].points[2], 10, 5) && nearPt(r[1].points[0], 10, 5));
        r = split({ type: 'PLINE', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, 10, 0);
        assert.deepEqual(r.map(p => p.points.length), [2, 2], '頂点で分ける');
        r = split({ type: 'PLINE', closed: true, lotName: '1-1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, 5, 0);
        assert.equal(r.length, 1); assert.equal(r[0].closed, false); assert.equal(r[0].points.length, 6);
        assert.ok(nearPt(r[0].points[0], 5, 0) && nearPt(r[0].points[5], 5, 0));
        r = split({ type: 'RECTANG', x1: 0, y1: 0, x2: 10, y2: 10 }, 10, 3);
        assert.equal(r[0].type, 'PLINE'); assert.equal(r[0].x1, undefined); assert.ok(nearPt(r[0].points[0], 10, 3));
        assert.ok(split({ type: 'CIRCLE', cx: 0, cy: 0, radius: 5 }, 5, 0).error);
        // コマンド: 図形を選ぶ → 点 → また図形を選ぶ段階へ。元に戻せる
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }]);
        app.eval(`processCommand('BREAK')`); assert.equal(mode(), 'WAITING_BREAK_SELECT');
        pick(8, 0); assert.equal(mode(), 'WAITING_BREAK_POINT');
        app.eval('_drawFrame(false)');
        point(4, 0);
        assert.equal(ents().length, 2); assert.equal(mode(), 'WAITING_BREAK_SELECT');
        app.eval('undo()'); assert.equal(ents().length, 1);
    });

    it('等分: 線・円弧（右回り）・円・ポリライン（長さで）・閉じた形。コマンド DIV', () => {
        const div = (e, n) => app.val(`editDivide(${JSON.stringify(e)}, ${n})`);
        let r = div({ type: 'LINE', x1: 0, y1: 0, x2: 9, y2: 3 }, 3);
        assert.equal(r.length, 3); assert.ok(nearPt({ x: r[1].x1, y: r[1].y1 }, 3, 1) && r[2].x2 === 9 && r[2].y2 === 3);
        r = div({ type: 'CIRCLE', cx: 0, cy: 0, radius: 5 }, 4);
        assert.deepEqual(r.map(a => a.type), ['ARC', 'ARC', 'ARC', 'ARC']); assert.ok(near(r[1].startAngle, Math.PI / 2) && near(r[1].endAngle, Math.PI));
        r = div({ type: 'ARC', cx: 0, cy: 0, radius: 5, startAngle: Math.PI / 2, endAngle: 0, counterclockwise: false }, 2);
        assert.ok(near(r[0].endAngle, Math.PI / 4) && r[0].counterclockwise === false && r[1].endAngle === 0);
        r = div({ type: 'PLINE', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, 4);
        assert.equal(r.length, 4); assert.ok(nearPt(r[0].points[1], 5, 0) && nearPt(r[1].points[1], 10, 0) && nearPt(r[2].points[1], 10, 5));
        assert.deepEqual(r.map(p => p.points.length), [2, 2, 2, 2], '頂点ちょうどで切るときは頂点で分ける');
        r = div({ type: 'RECTANG', x1: 0, y1: 0, x2: 10, y2: 10 }, 2);
        assert.equal(r.length, 2); assert.ok(nearPt(r[0].points[r[0].points.length - 1], 10, 10));
        assert.ok(div({ type: 'LINE', x1: 0, y1: 0, x2: 1, y2: 0 }, 1).error);
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }]);
        app.eval(`processCommand('DIV')`); assert.equal(mode(), 'WAITING_BREAK_SELECT');
        app.eval(`processCommand('5')`); pick(3, 0);
        assert.equal(ents().length, 5);
    });

    it('結合: つながった線をたどって選び、一周は閉じたポリライン、一直線は1本の線にする（分かれ道で止まる）', () => {
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', x1: 10, y1: 10, x2: 10, y2: 0 },
             { type: 'LINE', x1: 10, y1: 10, x2: 0, y2: 10 }, { type: 'LINE', x1: 0, y1: 10, x2: 0, y2: 0 },
             { type: 'CIRCLE', cx: 50, cy: 50, radius: 3 }]);
        app.eval(`processCommand('JOIN')`); assert.equal(mode(), 'WAITING_JOIN_SELECT');
        pick(5, 0);
        assert.equal(app.val('cmdState.selectedIndices').length, 4, '一周の4本をまとめて選ぶ');
        app.eval('dimConfirmPoint()');
        let es = ents();
        assert.equal(es.length, 2); assert.equal(es[0].type, 'PLINE'); assert.equal(es[0].closed, true); assert.equal(es[0].points.length, 4);
        assert.equal(mode(), 'WAITING_JOIN_SELECT', '続けて結合できる');
        app.eval('undo()'); assert.equal(ents().length, 5);
        app.eval('resetCommand(); entities.length = 0;');
        // 一直線（向きがばらばら）→ 1本の線
        add([{ type: 'LINE', x1: 10, y1: 0, x2: 0, y2: 0 }, { type: 'LINE', x1: 10, y1: 0, x2: 20, y2: 0 }, { type: 'LINE', x1: 30, y1: 0, x2: 20, y2: 0 }]);
        app.eval(`cmdState.selectedIndices = [0, 1, 2]; issueCommand('JOIN')`);
        es = ents(); assert.equal(es.length, 1); assert.equal(es[0].type, 'LINE');
        assert.deepEqual([es[0].x1, es[0].x2].sort((a, b) => a - b), [0, 30]);
        assert.equal(mode(), 'IDLE', '選んでから結合したときは1回で終わる');
        app.eval('entities.length = 0;');
        // T 字の分かれ道では止まる
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', x1: 10, y1: 0, x2: 20, y2: 0 }, { type: 'LINE', x1: 10, y1: 0, x2: 10, y2: 10 }]);
        assert.deepEqual(app.val('editJoinChainFrom(0, editJoinTol())'), [0]);
        assert.deepEqual(app.val('editJoinChainFrom(2, editJoinTol())'), [2]);
    });

    it('結合: すき間は 0.5mm まで。ポリラインと線、同じ円の円弧（一周なら円）', () => {
        const plan = (list, idxs) => { app.eval('entities.length = 0;'); add(list); return app.val(`editJoinPlan(${JSON.stringify(idxs)}, editJoinTol())`); };
        let p = plan([{ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', x1: 10.0003, y1: 0, x2: 10, y2: 10 }], [0, 1]);
        assert.equal(p.made.length, 1); assert.equal(p.made[0].entity.points.length, 3);
        p = plan([{ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', x1: 10.01, y1: 0, x2: 10, y2: 10 }], [0, 1]);
        assert.equal(p.made.length, 0, '1cm 離れていればつながない'); assert.equal(p.skipped, 2);
        // mm の図面ではすき間も mm で
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm')`);
        assert.ok(near(app.val('editJoinTol()'), 0.5));
        app.eval(`localStorage.removeItem('cad_survey_unit')`);
        p = plan([{ type: 'PLINE', lotName: '5', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }, { type: 'LINE', x1: 0, y1: 5, x2: 5, y2: 5 }], [0, 1]);
        assert.equal(p.made[0].entity.type, 'PLINE'); assert.equal(p.made[0].entity.lotName, '5'); assert.equal(p.made[0].entity.points.length, 4);
        const q = Math.PI / 2;
        p = plan([0, 1].map(i => ({ type: 'ARC', cx: 0, cy: 0, radius: 5, startAngle: i * q, endAngle: (i + 1) * q, counterclockwise: true })), [0, 1]);
        assert.equal(p.made[0].entity.type, 'ARC'); assert.ok(near(p.made[0].entity.startAngle, 0) && near(p.made[0].entity.endAngle, Math.PI));
        p = plan([3, 0, 2, 1].map(i => ({ type: 'ARC', cx: 0, cy: 0, radius: 5, startAngle: i * q, endAngle: (i + 1) * q, counterclockwise: true })), [0, 1, 2, 3]);
        assert.equal(p.made.length, 1); assert.equal(p.made[0].entity.type, 'CIRCLE');
        // 右回りの円弧と、0° をまたぐ円弧
        p = plan([{ type: 'ARC', cx: 0, cy: 0, radius: 5, startAngle: q, endAngle: 0, counterclockwise: false },
                  { type: 'ARC', cx: 0, cy: 0, radius: 5, startAngle: 3 * q, endAngle: 2 * Math.PI, counterclockwise: true }], [0, 1]);
        assert.equal(p.made.length, 1); assert.ok(near(p.made[0].entity.startAngle, 3 * q) && near(p.made[0].entity.endAngle, q));
    });

    it('角の処理: 半径 0 で角を出す・フィレット（接する円弧）・面取り（角から・底辺）、残す側、できないとき', () => {
        const L1 = { type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }, L2 = { type: 'LINE', x1: 12, y1: 2, x2: 12, y2: 10 };
        const f = (opt, a = L1, ta = { x: 5, y: 0 }, b = L2, tb = { x: 12, y: 8 }) => app.val(`editFilletLines(${JSON.stringify(a)}, ${JSON.stringify(ta)}, ${JSON.stringify(b)}, ${JSON.stringify(tb)}, ${JSON.stringify(opt)})`);
        let r = f({ mode: 'fillet', radius: 0 });
        assert.deepEqual([r.l1.x1, r.l1.y1, r.l1.x2, r.l1.y2], [0, 0, 12, 0]); assert.deepEqual([r.l2.x1, r.l2.y1, r.l2.x2, r.l2.y2], [12, 0, 12, 10]);
        r = f({ mode: 'fillet', radius: 2 });
        assert.ok(nearPt({ x: r.l1.x2, y: r.l1.y2 }, 10, 0) && nearPt({ x: r.l2.x1, y: r.l2.y1 }, 12, 2));
        assert.ok(nearPt({ x: r.arc.cx, y: r.arc.cy }, 10, 2) && near(r.arc.radius, 2));
        assert.ok(near(r.arc.startAngle, 3 * Math.PI / 2) && near(r.arc.endAngle, 0) || near(r.arc.endAngle, 2 * Math.PI), JSON.stringify(r.arc));
        r = f({ mode: 'chamfer', dist: 2, by: 'leg' });
        assert.ok(nearPt({ x: r.seg.x1, y: r.seg.y1 }, 10, 0) && nearPt({ x: r.seg.x2, y: r.seg.y2 }, 12, 2));
        r = f({ mode: 'chamfer', dist: 2, by: 'base' });
        assert.ok(near(Math.hypot(r.seg.x2 - r.seg.x1, r.seg.y2 - r.seg.y1), 2), '底辺（切る線）の長さが 2');
        // 交わる2本: 選んだ側を残す
        r = f({ mode: 'fillet', radius: 0 }, { type: 'LINE', x1: -10, y1: 0, x2: 10, y2: 0 }, { x: 5, y: 0 }, { type: 'LINE', x1: 0, y1: -10, x2: 0, y2: 10 }, { x: 0, y: 5 });
        assert.deepEqual([r.l1.x1, r.l1.y1, r.l1.x2, r.l1.y2], [0, 0, 10, 0]); assert.deepEqual([r.l2.x1, r.l2.y1, r.l2.x2, r.l2.y2], [0, 0, 0, 10]);
        assert.ok(f({ mode: 'fillet', radius: 1 }, L1, { x: 5, y: 0 }, { type: 'LINE', x1: 0, y1: 3, x2: 10, y2: 3 }, { x: 5, y: 3 }).error, '平行');
        assert.match(f({ mode: 'fillet', radius: 50 }).error, /半径が大きすぎます/);
        assert.match(f({ mode: 'chamfer', dist: 30, by: 'leg' }).error, /長さが線より長い/);
    });

    it('角の処理コマンド: 2本の線を丸める、ポリライン・長方形の角を面取り（隅切り）', () => {
        add([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', x1: 12, y1: 2, x2: 12, y2: 10 }]);
        app.eval(`lastParams.filletMode = 'fillet'; lastParams.filletR = '2'; processCommand('FILLET')`);
        assert.equal(mode(), 'WAITING_FILLET_SELECT');
        pick(5, 0); assert.equal(mode(), 'WAITING_FILLET_SECOND');
        app.eval(`(function(){ const s = wcsToScreen(12, 8); mouse.screenX = s.x; mouse.screenY = s.y; mouse.wcsX = 12; mouse.wcsY = 8; cmdState.highlightIdx = 1; _drawFrame(false); })()`);
        pick(12, 8);
        let es = ents();
        assert.equal(es.length, 3); assert.equal(es[2].type, 'ARC'); assert.equal(es[2].layer, 0);
        assert.equal(mode(), 'WAITING_FILLET_SELECT', '続けて処理できる');
        app.eval('undo(); resetCommand(); entities.length = 0;');
        // 閉じたポリラインの角を面取り（角から 2）
        add([{ type: 'PLINE', closed: true, lotName: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, { type: 'RECTANG', x1: 20, y1: 0, x2: 30, y2: 10 }]);
        const id0 = app.val('entities[0].id');
        app.eval(`lastParams.filletMode = 'chamfer'; lastParams.chamferD = '2'; lastParams.chamferBy = 'leg'; processCommand('F')`);
        pick(9.5, 10); // 右上の角の近く（上の辺の上）
        es = ents();
        assert.deepEqual(es[0].points.map(p => [p.x, p.y]), [[0, 0], [10, 0], [10, 8], [8, 10], [0, 10]]);
        assert.equal(es[0].id, id0, '同じ図形のまま'); assert.equal(es[0].lotName, 'A');
        pick(20, 5); // 長方形の左の辺（一番近い角は (20,0)・(20,10) のどちらか）
        es = ents(); assert.equal(es[1].type, 'PLINE'); assert.equal(es[1].closed, true); assert.equal(es[1].points.length, 5);
        // 丸めるモードでポリラインの角は、面取りだけできると知らせる
        app.eval(`lastParams.filletMode = 'fillet'; lastParams.filletR = '1';`);
        pick(5, 0);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /面取りだけ/);
    });

    // ===== 点を動かす（グリップ） =====
    const tapSel = (x, y) => app.eval(`(function(){ const s = wcsToScreen(${x}, ${y}); selectEntityAt(s.x, s.y); })()`);
    const tapGrip = (x, y) => app.eval(`(function(){ const s = wcsToScreen(${x}, ${y}); return gripTap(s.x, s.y); })()`);

    it('グリップ: 線の端・中点、つかんでから動かす先を指定。動かしたあとも選んだまま。元に戻せる', () => {
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 100, y2: 0 }]);
        tapSel(50, 0);
        assert.equal(app.eval('gripTargetIndex()'), 0);
        assert.deepEqual(app.val('gripPoints(entities[0]).map(g => g.kind)'), ['p1', 'p2', 'mid']);
        app.eval('_drawFrame(false)');
        assert.equal(tapGrip(100, 0), true);
        assert.equal(mode(), 'WAITING_GRIP_DEST');
        app.eval(`mouse.wcsX = 100; mouse.wcsY = 30; _drawFrame(false)`); // 途中の表示
        point(100, 30);
        let e = ents()[0];
        assert.deepEqual([e.x2, e.y2], [100, 30]);
        assert.equal(mode(), 'IDLE'); assert.equal(app.eval('cmdState.highlightIdx'), 0, '選んだまま');
        // 中点をつかむと線ごと動く
        tapGrip(50, 15); point(50, 25);
        e = ents()[0]; assert.deepEqual([e.x1, e.y1, e.x2, e.y2], [0, 10, 100, 40]);
        app.eval('undo(); undo();'); e = ents()[0]; assert.deepEqual([e.x2, e.y2], [100, 0]);
        // Esc でやめても選んだまま
        app.eval('clearSelection()'); tapSel(50, 0); assert.equal(tapGrip(0, 0), true);
        app.eval(`processCommand('CANCEL')`);
        assert.equal(mode(), 'IDLE'); assert.equal(app.eval('cmdState.highlightIdx'), 0);
        assert.deepEqual([ents()[0].x1, ents()[0].y1], [0, 0]);
        // グリップの外をタップすると、ふつうの選択（解除）
        assert.equal(tapGrip(30, 0), false);
    });

    it('グリップ: ポリラインの頂点・点を足す、長方形の角・辺、円の半径、円弧（3点）、楕円、文字', () => {
        add([{ type: 'PLINE', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }]);
        tapSel(50, 0); tapGrip(100, 100); point(120, 90);
        assert.ok(nearPt(ents()[0].points[2], 120, 90));
        tapGrip(50, 0); assert.match(app.eval(`document.getElementById('command-prompt').textContent`), /点を足す/);
        point(50, -20);
        assert.deepEqual(ents()[0].points.map(p => [p.x, p.y]), [[0, 0], [50, -20], [100, 0], [120, 90]]);
        app.eval('entities.length = 0; resetCommand();');
        add([{ type: 'RECTANG', x1: 0, y1: 0, x2: 100, y2: 50 }]);
        tapSel(50, 0); tapGrip(100, 50); point(120, 60);
        let e = ents()[0]; assert.deepEqual([e.type, e.x1, e.y1, e.x2, e.y2], ['RECTANG', 0, 0, 120, 60]);
        tapGrip(120, 30); point(140, 0); // 右の辺の中点 → 右の辺だけ動く
        e = ents()[0]; assert.deepEqual([e.x1, e.y1, e.x2, e.y2], [0, 0, 140, 60]);
        app.eval('entities.length = 0; resetCommand();');
        add([{ type: 'CIRCLE', cx: 0, cy: 0, radius: 50 }]);
        tapSel(50, 0); tapGrip(0, 50); point(0, 80);
        assert.ok(near(ents()[0].radius, 80));
        app.eval('entities.length = 0; resetCommand();');
        add([{ type: 'ARC', cx: 0, cy: 0, radius: 50, startAngle: 0, endAngle: Math.PI, counterclockwise: true }]);
        tapSel(0, 50);
        tapGrip(0, 50); point(0, 80); // 中点 → ふくらみ
        e = ents()[0];
        const at = (a) => ({ x: e.cx + e.radius * Math.cos(a), y: e.cy + e.radius * Math.sin(a) });
        assert.ok(nearPt(at(e.startAngle), 50, 0, 1e-9) && nearPt(at(e.endAngle), -50, 0, 1e-9), '両端はそのまま');
        assert.ok(app.val(`isPointOnArc(entities[0], 0, 80)`) && near(Math.hypot(0 - e.cx, 80 - e.cy), e.radius, 1e-9), '新しい中点を通る');
        tapGrip(-50, 0); point(0, 80); // 終点を中点に重ねる → 一直線で円弧にならない
        assert.equal(mode(), 'WAITING_GRIP_DEST', 'できないときは、つかんだまま');
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /一直線/);
        app.eval(`processCommand('CANCEL'); entities.length = 0; resetCommand();`);
        add([{ type: 'ELLIPSE', cx: 0, cy: 0, rx: 60, ry: 20, rotation: 0 }]);
        tapSel(60, 0); tapGrip(60, 0); point(0, 70);
        e = ents()[0]; assert.ok(near(e.rx, 70) && near(e.rotation, Math.PI / 2));
        app.eval('entities.length = 0; resetCommand();');
        add([{ type: 'TEXT', x: 10, y: 10, text: 'No.1', height: 10 }]);
        tapSel(12, 12); tapGrip(10, 10); point(40, 50);
        assert.deepEqual([ents()[0].x, ents()[0].y], [40, 50]);
    });

    it('グリップ: 寸法（測った点を動かしても寸法線は同じ所、寸法線の位置、半径寸法の向き）', () => {
        add([{ type: 'DIMENSION', subType: 'LINEAR', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, offset: 30, dimDir: 'H' }]);
        app.eval('cmdState.highlightIdx = 0; _drawFrame(false)');
        assert.deepEqual(app.val('gripPoints(entities[0]).map(g => g.kind)'), ['d1', 'd2', 'dl']);
        tapGrip(0, 0); point(-20, 10);
        let e = ents()[0];
        assert.deepEqual([e.p1.x, e.p1.y], [-20, 10]); assert.ok(near(e.offset, 20), '寸法線の高さ（y=30）はそのまま');
        tapGrip(40, 30); point(40, 60);
        assert.ok(near(ents()[0].offset, 50));
        app.eval('entities.length = 0; resetCommand();');
        add([{ type: 'DIMENSION', subType: 'RADIUS', center: { x: 0, y: 0 }, radius: 50, angle: 0 }]);
        app.eval('cmdState.highlightIdx = 0;');
        tapGrip(50, 0); point(0, 10);
        assert.ok(near(ents()[0].angle, Math.PI / 2));
    });

    it('グリップ: 出さないとき（複数選択・ブロックの部品・座標読取モード・ツアー中）、長押しで消さない', () => {
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 100, y2: 0 }, { type: 'LINE', x1: 0, y1: 50, x2: 100, y2: 50 },
             { type: 'LINE', gid: 'b', ins: { x: 0, y: 100 }, x1: 0, y1: 100, x2: 100, y2: 100 }]);
        app.eval('cmdState.selectedIndices = [0, 1]; cmdState.highlightIdx = 0;');
        assert.equal(app.eval('gripTargetIndex()'), -1);
        app.eval('window.groupSelectEnabled = false; cmdState.selectedIndices = []; cmdState.highlightIdx = 2;');
        assert.equal(app.eval('gripTargetIndex()'), -1, '挿入点のあるブロックの部品');
        app.eval(`cmdState.highlightIdx = 0; document.body.classList.add('fullscreen-mode')`);
        assert.equal(app.eval('gripTargetIndex()'), -1);
        app.eval(`document.body.classList.remove('fullscreen-mode')`);
        assert.equal(app.eval('gripTargetIndex()'), 0);
        assert.equal(app.eval(`(function(){ const s = wcsToScreen(0, 0); return gripHitTest(s.x, s.y); })()`), true);
    });

    it('グリップ: マウスのクリック、指のタップでも操作できる', () => {
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 100, y2: 0 }]);
        app.eval(`osnapState.main = false; window.__last = lastTouchTime; lastTouchTime = 0;`);
        tapSel(50, 0);
        const s = app.val('wcsToScreen(100, 0)'), d = app.val('wcsToScreen(100, -40)');
        app.eval(`canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${s.x}, clientY: ${s.y}, bubbles: true }));
                  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: ${s.x}, clientY: ${s.y}, button: 0, bubbles: true }));`);
        assert.equal(mode(), 'WAITING_GRIP_DEST');
        app.eval(`canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${d.x}, clientY: ${d.y}, bubbles: true }));
                  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: ${d.x}, clientY: ${d.y}, button: 0, bubbles: true }));`);
        assert.deepEqual([ents()[0].x2, ents()[0].y2], [100, -40]);
        // 指: グリップをタップ → 動かす先をタップ
        const g = app.val('wcsToScreen(0, 0)'), t = app.val('wcsToScreen(-30, 20)');
        app.eval(`__touch('touchstart', [[${g.x}, ${g.y}]]); __touch('touchend', []);`);
        assert.equal(mode(), 'WAITING_GRIP_DEST');
        app.eval(`__touch('touchstart', [[${t.x}, ${t.y}]]); __touch('touchend', []);`);
        assert.deepEqual([ents()[0].x1, ents()[0].y1], [-30, 20]);
        assert.equal(mode(), 'IDLE');
        app.eval('osnapState.main = true;');
    });

    it('グリップ: 押したまま動かして離すと、離した所へ動かす（マウス・指）。2本指が触れたら、つかむのをやめる', () => {
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 100, y2: 0 }]);
        app.eval(`osnapState.main = false; lastTouchTime = 0;`);
        tapSel(50, 0);
        const s = app.val('wcsToScreen(100, 0)'), d = app.val('wcsToScreen(120, 30)');
        app.eval(`canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${s.x}, clientY: ${s.y}, bubbles: true }));
                  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: ${s.x}, clientY: ${s.y}, button: 0, bubbles: true }));
                  canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${d.x}, clientY: ${d.y}, bubbles: true }));
                  window.dispatchEvent(new MouseEvent('mouseup', { clientX: ${d.x}, clientY: ${d.y}, button: 0, bubbles: true }));`);
        assert.deepEqual([ents()[0].x2, ents()[0].y2], [120, 30]);
        assert.equal(mode(), 'IDLE'); assert.equal(app.eval('cmdState.highlightIdx'), 0);
        // 指: グリップに置いたままなぞって離す
        const g = app.val('wcsToScreen(0, 0)'), t = app.val('wcsToScreen(-20, -10)');
        app.eval(`__touch('touchstart', [[${g.x}, ${g.y}]]); __touch('touchmove', [[${(g.x + t.x) / 2}, ${(g.y + t.y) / 2}]]); __touch('touchmove', [[${t.x}, ${t.y}]]); __touch('touchend', []);`);
        assert.deepEqual([ents()[0].x1, ents()[0].y1], [-20, -10]);
        assert.equal(mode(), 'IDLE');
        // なぞって座標を読むだけ（グリップの上から始めない）なら動かない
        const m = app.val('wcsToScreen(40, 30)'), n = app.val('wcsToScreen(60, 40)');
        app.eval(`__touch('touchstart', [[${m.x}, ${m.y}]]); __touch('touchmove', [[${n.x}, ${n.y}]]); __touch('touchend', []);`);
        assert.deepEqual([ents()[0].x1, ents()[0].y1, ents()[0].x2, ents()[0].y2], [-20, -10, 120, 30]);
        // グリップに置いた指のあとに2本目: つかむのをやめて、選んだまま
        app.eval('clearSelection()'); tapSel(50, 10);
        const q = app.val('wcsToScreen(120, 30)');
        app.eval(`__touch('touchstart', [[${q.x}, ${q.y}]])`);
        assert.equal(mode(), 'WAITING_GRIP_DEST');
        app.eval(`__touch('touchstart', [[${q.x}, ${q.y}], [${q.x + 80}, ${q.y + 40}]]); __touch('touchend', [[${q.x}, ${q.y}]]); __touch('touchend', []);`);
        assert.equal(mode(), 'IDLE'); assert.equal(app.eval('cmdState.highlightIdx'), 0);
        assert.deepEqual([ents()[0].x2, ents()[0].y2], [120, 30]);
        app.eval('osnapState.main = true;');
    });

    // ===== 画面の操作・案内 =====
    it('範囲選択で対象を選べる、図形を選ぶ段階はスナップせずカーソルの下の図形を強調する', () => {
        add([{ type: 'LINE', x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', x1: 0, y1: 5, x2: 10, y2: 5 }, { type: 'CIRCLE', cx: 200, cy: 0, radius: 5 }]);
        app.eval(`processCommand('MIRROR')`);
        const n = app.val(`(function(){ const a = wcsToScreen(-5, 20), b = wcsToScreen(20, -5);
            mouse.selStartX = a.x; mouse.selStartY = a.y; mouse.screenX = b.x; mouse.screenY = b.y; mouse.isSelecting = true;
            window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); return cmdState.selectedIndices.slice().sort(); })()`);
        assert.deepEqual(n, [0, 1]);
        assert.equal(mode(), 'WAITING_MIRROR_P1');
        app.eval(`resetCommand(); processCommand('FILLET')`);
        const s = app.val('wcsToScreen(5, 0)');
        app.eval(`canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${s.x}, clientY: ${s.y}, bubbles: true }))`);
        assert.equal(app.eval('cmdState.highlightIdx'), 0);
        assert.equal(app.eval('snapResult'), null);
    });

    it('ツールバー・選択バーのボタン、操作中のヒント、ヘルプのコマンド一覧', () => {
        const cmds = app.val(`[...document.querySelectorAll('#toolbar .tool-cmd')].map(el => el.textContent)`);
        ['MIRROR', 'SCALE', 'ARRAY', 'BREAK', 'JOIN', 'FILLET'].forEach(c => assert.ok(cmds.includes(c), c));
        const sel = app.val(`[...document.querySelectorAll('#sel-actionbar .sel-btn')].map(b => b.textContent)`).join(' ');
        assert.match(sel, /鏡像/); assert.match(sel, /尺度/); assert.match(sel, /配列/); assert.match(sel, /結合/);
        app.eval(`toggleCommand('MIRROR')`);
        assert.ok(app.eval(`[...document.querySelectorAll('#toolbar .tool-btn.active .tool-cmd')].some(el => el.textContent === 'MIRROR')`));
        app.eval(`toggleCommand('MIRROR')`); assert.equal(mode(), 'IDLE', 'もう一度押すとやめる');
        ['WAITING_MIRROR_SELECT', 'WAITING_MIRROR_P2', 'WAITING_SCALE_BASE', 'WAITING_ARRAY_SET', 'WAITING_BREAK_POINT', 'WAITING_JOIN_SELECT', 'WAITING_FILLET_SECOND', 'WAITING_GRIP_DEST'].forEach(m => {
            const h = app.val(`(function(){ const d = _guideHintFor('${m}'); if(!d) return null; const suf = '${m}'.slice(d.prefix.length); return d.steps.some(s => s.when ? true : (s.modes || []).includes(suf)); })()`);
            assert.equal(h, true, `ヒント ${m}`);
        });
        app.eval('showGuideHelp()');
        const help = app.eval(`document.getElementById('property-panel-content').textContent`);
        ['MIRROR', 'SCALE', 'ARRAY', 'BREAK', 'JOIN', 'FILLET'].forEach(c => assert.ok(help.includes(c), c));
        assert.match(help, /点を動かす/);
        assert.deepEqual(app.errors(), []);
    });
});
