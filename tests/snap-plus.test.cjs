'use strict';
// 追加したスナップと点の指定の補助（cad-snap.js）のテスト:
//   挿入点・接線・四半円点・図心・等分点・延長・延長交点・延長線上の垂線・楕円（近接点・交点・垂線・接線）、
//   次の1点だけのスナップ指定、候補の切り替え、2点間の中点、相対座標の入力、設定の保存
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

const ALL_ON = { main: true, end: true, mid: true, cen: true, int: true, near: true, perp: true, tan: true, ins: true, qua: true, ext: true, gce: true, div: true, divN: 3 };

describe('スナップの追加分', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            resetCommand(); entities.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            view.x = 0; view.y = 0; view.scale = 1; view.rotation = 0;
            ucs = { originX: 0, originY: 0, angle: 0 };
            osnapState = ${JSON.stringify(ALL_ON)};
            snapResult = null; _lastInputWcs = null;
        `);
    });

    // 図形を置く（外形 bbox も付ける）
    function put(ents) {
        app.window.__ents = ents;
        app.eval(`window.__ents.forEach(e => { const c = JSON.parse(JSON.stringify(e)); c.bbox = calcBBox(c); entities.push(c); }); _bumpGeomEpoch();`);
    }
    // WCS の (x, y) から画面上で (dx, dy) ピクセルずらした位置でスナップを探す（使う種類を flags で絞れる）
    function snapAt(x, y, dx = 0, dy = 0, flags) {
        if(flags) app.eval(`osnapState = Object.assign({ main: true, divN: 3 }, ${JSON.stringify(flags)});`);
        return app.val(`(function () {
            const s = wcsToScreen(${x}, ${y}); const sx = s.x + ${dx}, sy = s.y + ${dy}; const w = screenToWcs(sx, sy);
            const r = findSnap(sx, sy, w.x, w.y); snapResult = r; return r;
        })()`);
    }
    function withBase(mode, bx, by) {
        app.eval(`cmdState.mode = '${mode}'; cmdState.startWcs = { x: ${bx}, y: ${by} }; cmdState.points = [{ x: ${bx}, y: ${by} }]; cmdState.measBase = { x: ${bx}, y: ${by} };`);
    }
    const at = (s, x, y) => s && near(s.wcsX, x, 1e-6) && near(s.wcsY, y, 1e-6);

    // ---- 挿入点 ----
    it('挿入点: 取り込んだブロック（三角の測点記号）の挿入点に吸着する', () => {
        // 三角の記号の重心ではなく、ブロックの挿入点 (100, 50)
        put([{ type: 'PLINE', layer: 0, closed: true, gid: 'b1', blockName: '三角点', ins: { x: 100, y: 50 }, points: [{ x: 97, y: 48 }, { x: 103, y: 48 }, { x: 100, y: 54 }] }]);
        const s = snapAt(100, 50, 2, 1, { ins: true });
        assert.equal(s.type, '挿入点');
        assert.ok(at(s, 100, 50));
    });
    it('挿入点: 文字の位置に吸着する（測点名の文字は対象外）', () => {
        put([{ type: 'TEXT', layer: 0, x: 40, y: 30, text: '境界', height: 2 }, { type: 'TEXT', layer: 0, x: 80, y: 30, text: 'T-1', height: 2, ptLabel: true }]);
        assert.equal(snapAt(40, 30, 2, 1, { ins: true }).type, '挿入点');
        assert.equal(snapAt(80, 30, 2, 1, { ins: true }), null);
    });

    // ---- 接線 ----
    it('接線: 円の外の点から引いた接線の接点に吸着する', () => {
        put([{ type: 'CIRCLE', layer: 0, cx: 0, cy: 0, radius: 30 }]);
        withBase('WAITING_LINE_P2', 60, 0);
        // 接点: 角度 ±acos(30/60)=±60° → (15, ±25.98)
        const s = snapAt(15, 30 * Math.sin(Math.PI / 3), 2, 1, { tan: true });
        assert.equal(s.type, '接線');
        assert.ok(at(s, 15, 30 * Math.sin(Math.PI / 3)), JSON.stringify(s));
    });
    it('接線: 円の内側からは出ない', () => {
        put([{ type: 'CIRCLE', layer: 0, cx: 0, cy: 0, radius: 30 }]);
        withBase('WAITING_LINE_P2', 5, 0);
        assert.equal(snapAt(0, 30, 2, 1, { tan: true }), null);
    });

    // ---- 四半円点 ----
    it('四半円点: 円の上下左右（UCS を回転していればその向き）', () => {
        put([{ type: 'CIRCLE', layer: 0, cx: 0, cy: 0, radius: 40 }]);
        assert.ok(at(snapAt(0, 40, 2, 1, { qua: true }), 0, 40));
        app.eval('ucs.angle = Math.PI / 4;');
        const s = snapAt(40 * Math.cos(Math.PI / 4), 40 * Math.sin(Math.PI / 4), 2, 1, { qua: true });
        assert.equal(s.type, '四半円点');
        assert.ok(at(s, 40 * Math.cos(Math.PI / 4), 40 * Math.sin(Math.PI / 4)));
    });
    it('四半円点: 円弧は描かれている範囲だけ', () => {
        put([{ type: 'ARC', layer: 0, cx: 0, cy: 0, radius: 40, startAngle: 0.2, endAngle: 2.0, counterclockwise: true }]);
        assert.equal(snapAt(0, 40, 2, 1, { qua: true }).type, '四半円点');  // 90° は範囲内
        assert.equal(snapAt(-40, 0, 2, 1, { qua: true }), null);           // 180° は範囲外
    });

    // ---- 図心 ----
    it('図心: 閉じた区画（ポリライン）の重心', () => {
        // 直角三角形 (0,0)-(60,0)-(0,30) の重心 (20,10)
        put([{ type: 'PLINE', layer: 0, closed: true, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 30 }] }]);
        const s = snapAt(20, 10, 2, 1, { gce: true });
        assert.equal(s.type, '図心');
        assert.ok(at(s, 20, 10));
    });

    // ---- 等分点 ----
    it('等分点: 線を指定の数に等分した点（線分・ポリライン・円弧）', () => {
        put([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 90, y2: 0 }]);
        assert.ok(at(snapAt(30, 0, 2, 1, { div: true, divN: 3 }), 30, 0));
        assert.ok(at(snapAt(60, 0, 2, 1, { div: true, divN: 3 }), 60, 0));
        const s5 = snapAt(18, 0, 2, 1, { div: true, divN: 5 });
        assert.equal(s5.type, '等分点');
        assert.ok(at(s5, 18, 0));
        app.eval('entities.length = 0;');
        put([{ type: 'ARC', layer: 0, cx: 0, cy: 0, radius: 60, startAngle: 0, endAngle: Math.PI, counterclockwise: true }]);
        const a = snapAt(60 * Math.cos(Math.PI / 3), 60 * Math.sin(Math.PI / 3), 2, 1, { div: true, divN: 3 });
        assert.equal(a.type, '等分点');
    });
    it('等分点: 偶数に分けたときの真ん中は「中点」として出す', () => {
        put([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 80, y2: 0 }]);
        assert.equal(snapAt(40, 0, 2, 1, { div: true, mid: true, divN: 4 }).type, '中点');
        assert.equal(snapAt(20, 0, 2, 1, { div: true, mid: true, divN: 4 }).type, '等分点');
    });

    // ---- 延長 ----
    const LINE_A = { type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 };
    it('延長: 取得した線を延ばした先に吸着する（取得していない線は延長しない）', () => {
        put([LINE_A]);
        assert.equal(snapAt(120, 0, 2, 3, { ext: true }), null); // 取得前は延長しない
        app.eval('acquireSnapLine(0, 0, 50, 0);');
        const s = snapAt(120, 0, 2, 3, { ext: true });
        assert.equal(s.type, '延長');
        assert.ok(near(s.wcsY, 0) && near(s.wcsX, 122, 1e-6), JSON.stringify(s)); // 延長線（y=0）の上
        assert.deepEqual(s.ext, [{ x: 50, y: 0 }]); // 線の端から補助線を出す
    });
    it('延長: 線の上で少し止まると取得される（通り過ぎただけでは取得しない）', async () => {
        put([LINE_A]);
        app.eval(`cmdState.mode = 'WAITING_LINE_P1';`);
        snapAt(25, 0, 0, 1, ALL_ON);
        assert.equal(app.eval('(cmdState.snapAcq || []).length'), 0);
        await new Promise(r => setTimeout(r, 450));
        assert.equal(app.eval('(cmdState.snapAcq || []).length'), 1);
        // コマンドを終えると取得は消える
        app.eval('resetCommand()');
        assert.equal(app.eval('(cmdState.snapAcq || []).length'), 0);
    });
    it('延長線上の垂線: 取得した線の延長へ下ろした垂線の足', () => {
        put([LINE_A]);
        withBase('WAITING_LINE_P2', 100, 40);
        app.eval('acquireSnapLine(0, 0, 50, 0);');
        const s = snapAt(100, 0, 2, 1, { perp: true, ext: true });
        assert.equal(s.type, '垂線(延長)');
        assert.ok(at(s, 100, 0));
    });
    it('延長交点: 取得した2本の線を延ばした交点（IP点）', () => {
        // y=0 の線と、(100,20)-(120,60) の線（延ばすと (90, 0) で交わる）
        put([LINE_A, { type: 'LINE', layer: 0, x1: 100, y1: 20, x2: 120, y2: 60 }]);
        app.eval('acquireSnapLine(0, 0, 50, 0); acquireSnapLine(100, 20, 120, 60);');
        const s = snapAt(90, 0, 2, 1, { int: true, ext: true });
        assert.equal(s.type, '延長交点');
        assert.ok(at(s, 90, 0), JSON.stringify(s));
        assert.equal(s.ext.length, 2);
    });
    it('延長交点: 取得した線を延ばした先と、近くの線分との交点', () => {
        put([LINE_A, { type: 'LINE', layer: 0, x1: 80, y1: -20, x2: 80, y2: 20 }]);
        app.eval('acquireSnapLine(0, 0, 50, 0);');
        const s = snapAt(80, 0, 2, 1, { int: true, ext: true });
        assert.equal(s.type, '延長交点');
        assert.ok(at(s, 80, 0));
    });

    // ---- 楕円 ----
    const ELL = { type: 'ELLIPSE', layer: 0, cx: 0, cy: 0, rx: 60, ry: 30, rotation: 0 };
    it('楕円: 近接点は楕円の上の一番近い点', () => {
        put([ELL]);
        const s = snapAt(0, 30, 3, -4, { near: true });
        assert.equal(s.type, '近接点');
        assert.ok(Math.abs(app.eval(`_ellImplicit(entities[0], ${s.wcsX}, ${s.wcsY})`)) < 1e-9); // 楕円の上
    });
    it('楕円: 線との交点（厳密解）', () => {
        put([ELL, { type: 'LINE', layer: 0, x1: 30, y1: -50, x2: 30, y2: 50 }]);
        const y = 30 * Math.sqrt(1 - (30 / 60) ** 2);
        const s = snapAt(30, y, 2, 1, { int: true });
        assert.equal(s.type, '交点');
        assert.ok(at(s, 30, y), JSON.stringify(s));
    });
    it('楕円: 円との交点', () => {
        put([ELL, { type: 'CIRCLE', layer: 0, cx: 60, cy: 0, radius: 20 }]);
        // 交点は数値で求める。楕円の上かつ円の上であることを確かめる
        const r = app.val(`(function(){ const pts = collectSnapPoints(50, 10, null, { main: true, int: true }).filter(p => p.t === '交点'); return pts; })()`);
        assert.ok(r.length >= 2);
        r.forEach(p => {
            assert.ok(Math.abs(app.eval(`_ellImplicit(entities[0], ${p.x}, ${p.y})`)) < 1e-9);
            assert.ok(Math.abs(Math.hypot(p.x - 60, p.y) - 20) < 1e-9);
        });
    });
    it('楕円: 垂線と接線', () => {
        put([ELL]);
        withBase('WAITING_LINE_P2', 0, 80);
        const p = snapAt(0, 30, 2, 1, { perp: true });
        assert.equal(p.type, '垂線');
        assert.ok(at(p, 0, 30));
        const t = app.val(`collectSnapPoints(0, 0, { x: 0, y: 80 }, { main: true, tan: true }).filter(p => p.t === '接線')`);
        assert.equal(t.length, 2);
        t.forEach(q => { // 接点で、基点への向きと楕円の法線が直交する
            const nx = q.x / (60 * 60), ny = q.y / (30 * 30);
            assert.ok(Math.abs((0 - q.x) * nx + (80 - q.y) * ny) < 1e-6);
        });
    });
    it('楕円: 上下左右の点は「四半円点」', () => {
        put([ELL]);
        assert.equal(snapAt(60, 0, 2, 1, { qua: true }).type, '四半円点');
    });

    // ---- 次の1点だけ ----
    it('次の1点だけのスナップ指定: 指定した種類だけに吸着し、入力すると解除される', () => {
        put([LINE_A, { type: 'LINE', layer: 0, x1: 50, y1: 0, x2: 50, y2: 40 }]);
        app.eval(`osnapState = ${JSON.stringify(ALL_ON)}; processCommand('LINE'); handlePointInput({ x: 20, y: 30 }, true);`);
        // 垂線の指定中は垂線の足 (20,0) だけを探し、吸着の範囲も2倍になる（12px 離れていても吸着する）
        app.eval(`setSnapOverride('perp')`);
        assert.equal(app.eval('snapOverrideLabel()'), '垂線');
        assert.equal(app.eval(`document.getElementById('btn-osnap').textContent`), '垂線のみ');
        const s = snapAt(20, 0, 12, 1);
        assert.equal(s.type, '垂線');
        assert.ok(s.forced);
        app.eval('handlePointInput(getInputPoint(), true)');
        assert.equal(app.eval('snapOverrideLabel()'), null);
        assert.equal(app.eval(`document.getElementById('btn-osnap').textContent`), 'OSNAP');
    });
    it('次の1点だけの指定は、OSNAP を OFF にしていても働く', () => {
        put([LINE_A]);
        app.eval(`osnapState.main = false; cmdState.mode = 'WAITING_LINE_P1'; setSnapOverride('end');`);
        const s = snapAt(50, 0, 3, 2);
        assert.equal(s.type, '端点');
        assert.ok(app.eval('snapActive()'));
        assert.deepEqual(app.val('getInputPoint()'), { x: 50, y: 0 });
        app.eval('resetCommand()');
        assert.equal(app.eval('snapOverrideLabel()'), null); // コマンド終了で解除
    });

    // ---- 候補の切り替え ----
    it('候補の切り替え: 重なった候補を順に選べる（カーソルを動かすと最初に戻る）', () => {
        // 端点 (50,0) と、もう1本の線の端点 (52,0)、中点 (51,0)... のように近い候補を作る
        put([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }, { type: 'LINE', layer: 0, x1: 54, y1: 0, x2: 54, y2: 30 }]);
        app.eval(`cmdState.mode = 'WAITING_LINE_P1';`);
        const first = snapAt(52, 0, 0, 1, ALL_ON);
        assert.ok(first.count >= 2, JSON.stringify(first));
        assert.equal(first.index, 0);
        app.eval('cycleSnapCandidate()');
        const second = app.val('snapResult');
        assert.equal(second.index, 1);
        assert.ok(second.wcsX !== first.wcsX || second.wcsY !== first.wcsY || second.type !== first.type);
        // 動かすと最初の候補に戻る
        const moved = snapAt(52, 0, 6, 1);
        assert.equal(moved.index, 0);
        // アクションバーの「⇄」ボタンに数を出す
        app.eval('snapResult = findSnap.apply(null, _snapLastArgs); updateSnapCycleButton();');
        const btn = app.eval(`document.getElementById('dim-snap-cycle').textContent`);
        assert.match(btn, /⇄ 1\/\d/);
    });
    it('候補の切り替え: Tab キーでも切り替わる', () => {
        put([{ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 50, y2: 0 }, { type: 'LINE', layer: 0, x1: 54, y1: 0, x2: 54, y2: 30 }]);
        app.eval(`cmdState.mode = 'WAITING_LINE_P1';`);
        snapAt(52, 0, 0, 1, ALL_ON);
        app.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))`);
        assert.equal(app.eval('snapResult.index'), 1);
    });

    // ---- 2点間の中点 ----
    it('2点間の中点: 2点を指定すると、その中点が入力される', () => {
        app.eval(`processCommand('LINE'); startMid2P();`);
        app.eval('handlePointInput({ x: 10, y: 10 }, true); handlePointInput({ x: 30, y: 50 }, true);');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        assert.deepEqual(app.val('cmdState.startWcs'), { x: 20, y: 30 }); // 線の始点＝2点の中点
        // もう一度: 終点も2点の中点で
        app.eval(`startMid2P(); handlePointInput({ x: 100, y: 0 }, true); handlePointInput({ x: 100, y: 20 }, true);`);
        const ln = app.val('entities[entities.length - 1]');
        assert.equal(ln.type, 'LINE');
        assert.deepEqual([ln.x1, ln.y1, ln.x2, ln.y2], [20, 30, 100, 10]);
    });
    it('2点間の中点: コマンドの外や基点測定の途中では始めない', () => {
        app.eval('resetCommand(); startMid2P();');
        assert.equal(app.eval('_m2p'), null);
        app.eval(`processCommand('MEASURE'); handlePointInput({ x: 0, y: 0 }, true); startMid2P();`);
        assert.equal(app.eval('_m2p'), null);
    });

    // ---- 相対座標 ----
    it('相対入力: 基準点から北・東へ（測量の並び）', () => {
        app.eval(`processCommand('LINE'); handlePointInput({ x: 100, y: 200 }, true);`);
        // 北へ 10（WCS の y+）、東へ 5（WCS の x+）
        assert.deepEqual(app.val('relativeTarget({ x: 100, y: 200 }, "dxy", 10, 5)'), { x: 105, y: 210 });
        // 距離 10、方向角 90°（東）
        const p = app.val('relativeTarget({ x: 100, y: 200 }, "polar", 10, 90)');
        assert.ok(near(p.x, 110) && near(p.y, 200));
        // UCS を回転していれば UCS の北・東
        app.eval('ucs.angle = Math.PI / 2;');
        const q = app.val('relativeTarget({ x: 0, y: 0 }, "dxy", 10, 0)'); // UCS の北＝WCS の -x
        assert.ok(near(q.x, -10) && near(q.y, 0), JSON.stringify(q));
    });
    it('相対入力パネル: スナップした点を基準に入力し、続けて入力できる', () => {
        put([LINE_A]);
        app.eval(`processCommand('LINE'); snapResult = { wcsX: 50, wcsY: 0, type: '端点' }; showRelativeInputPanel();`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '📐 相対入力');
        app.eval(`document.getElementById('rel-a').value = '20'; document.getElementById('rel-b').value = '-5'; applyRelativeInput();`);
        // 線の始点が (45, 20)（北へ20・西へ5）
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        assert.deepEqual(app.val('cmdState.startWcs'), { x: 45, y: 20 });
        // 続けて同じ量 → 線ができる
        app.eval('applyRelativeInput();');
        const ln = app.val('entities[entities.length - 1]');
        assert.deepEqual([ln.x1, ln.y1, ln.x2, ln.y2], [45, 20, 40, 40]);
    });
    it('方向角は「度」「度 分 秒」のどちらでも入る', () => {
        assert.ok(near(app.eval('parseAzimuth("45.5")'), 45.5));
        assert.ok(near(app.eval('parseAzimuth("45 30 00")'), 45.5));
        assert.ok(near(app.eval('parseAzimuth("123-45-06")'), 123 + 45 / 60 + 6 / 3600));
        assert.ok(near(app.eval(`parseAzimuth("123°45′06″")`), 123 + 45 / 60 + 6 / 3600));
        assert.ok(Number.isNaN(app.eval('parseAzimuth("")')));
    });
    it('コマンド欄の「@X,Y」は直前の点から北へ X・東へ Y の相対座標', () => {
        // 「10,20」= X（北）10・Y（東）20 → 図面の座標 (x=20, y=10)。「@5,-3」= 北へ5・西へ3 → (17, 15)
        app.eval(`processCommand('LINE'); processCommand('10,20'); processCommand('@5,-3');`);
        const ln = app.val('entities[entities.length - 1]');
        assert.deepEqual([ln.x1, ln.y1, ln.x2, ln.y2], [20, 10, 17, 15]);
    });

    // ---- パネルと保存 ----
    it('スナップの設定パネル: すべての種類のチェックと「次の1点だけ」のボタン', () => {
        app.eval('buildOsnapPanel()');
        const labels = app.eval(`[...document.querySelectorAll('#osnap-panel .osnap-chk')].map(l => l.textContent.trim()).join(',')`);
        assert.equal(labels, '端点,中点,中心,交点,垂線,接線,挿入点,四半円点,図心,等分点,延長,近接点');
        assert.equal(app.eval(`document.querySelectorAll('#osnap-panel .osnap-once').length`), 12);
    });
    it('チェックを変えると端末に保存され、次に開いたときも同じ', () => {
        app.eval('buildOsnapPanel()');
        app.eval(`const cb = document.querySelector('#osnap-panel input[data-snap="gce"]'); cb.checked = true; cb.dispatchEvent(new Event('change'));`);
        const saved = JSON.parse(app.eval(`localStorage.getItem('cad_osnap')`));
        assert.equal(saved.gce, true);
        app.eval(`osnapState.gce = false; _loadOsnapPrefs();`);
        assert.equal(app.eval('osnapState.gce'), true);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
