'use strict';
// 全体表示で、公共座標の図面に混ざった原点の近くの図形・桁違いに遠い図形を除いて、図形の集まっている所に合わせる（v5.51。cad-view.js の extentsSplit）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('全体表示: 離れた図形を除く', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => app.eval(`resetCommand(); clearSelection(); entities.length = 0; undoStack.length = 0;
        layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers(); hideSnack();`));
    // 公共座標の現場（X 約 35000・Y 約 -12000 の 100m 四方に線 n 本）
    const site = (n) => app.eval(`for(let i = 0; i < ${n}; i++) entities.push({ type: 'LINE', layer: 0, color: null, x1: 35000 + i, y1: -12000, x2: 35000 + i, y2: -11900 }); ensureEntityIds();`);
    const add = (e) => app.eval(`entities.push(${JSON.stringify(e)}); ensureEntityIds();`);
    const line = (x1, y1, x2, y2) => add({ type: 'LINE', layer: 0, color: null, x1, y1, x2, y2 });
    // 画面の中心の図面の座標と、画面に入っている幅（図面の単位）
    const shown = () => app.val(`(() => { const c = screenToWcs(canvas.width / 2, canvas.height / 2); return { x: c.x, y: c.y, w: canvas.width / view.scale }; })()`);
    const snack = () => app.eval(`(() => { const s = document.getElementById('cad-snack'); return s && s.classList.contains('show') ? s.querySelector('.sn-msg').textContent : ''; })()`);
    const press = (label) => app.eval(`[...document.querySelectorAll('#cad-snack .sn-act')].find(b => b.textContent === '${label}' && b.style.display !== 'none').click()`);

    it('原点の近くに混ざった図形は除いて、現場に合わせる。「🔍 見る」で移って選び、「全部を表示」で全部入れる', () => {
        site(50);
        line(0, 0, 5, 5);
        add({ type: 'TEXT', layer: 0, color: null, x: 1, y: 1, text: 'ごみ', height: 2 });
        app.eval('zoomExtents()');
        const s = shown();
        assert.ok(Math.abs(s.x - 35024.5) < 60 && Math.abs(s.y + 11950) < 60, `現場の中心 ${JSON.stringify(s)}`);
        assert.ok(s.w < 1000, '現場の大きさで見える（原点まで入れると 35km 以上）');
        assert.match(snack(), /離れた所に図形が 2個/);
        press('🔍 見る');
        assert.deepEqual(app.val('cmdState.selectedIndices.slice().sort((a, b) => a - b)'), [50, 51]);
        const f = shown();
        assert.ok(Math.abs(f.x) < 10 && Math.abs(f.y) < 10, '離れた図形へ移る');
        app.eval('clearSelection(); zoomExtents()');
        press('全部を表示');
        assert.ok(shown().w > 30000, '全部を入れる');
        app.eval(`processCommand('ZOOMALL')`);
        assert.ok(shown().w > 30000, 'コマンド ZOOMALL でも');
        assert.deepEqual(app.errors(), []);
    });

    it('原点から現場まで引いた線も除く。4km の道路の図面でも原点の線は除く', () => {
        site(30);
        line(0, 0, 35000, -12000);
        app.eval('zoomExtents()');
        assert.ok(shown().w < 1000);
        assert.match(snack(), /1個/);
        app.eval(`entities.length = 0; hideSnack(); for(let i = 0; i < 400; i++) entities.push({ type: 'LINE', layer: 0, color: null, x1: 35000 + i * 10, y1: -12000, x2: 35010 + i * 10, y2: -12000 }); ensureEntityIds();`);
        line(0, 0, 1, 1);
        app.eval('zoomExtents()');
        assert.match(snack(), /1個/);
        assert.ok(shown().w < 6000, '道路の長さで見える');
    });

    it('除かない（点検で見つかった形）: 細部から伸びる 3km の道路・数 km 先の基準点・まばらに広がる図形・2つの現場・図形が2つ', () => {
        // 細部 500本（50m×40m）と、そこから伸びる 3km の中心線・道路端
        app.eval(`for(let i = 0; i < 500; i++) entities.push({ type: 'LINE', layer: 0, color: null, x1: 35000 + (i % 50), y1: -12000 + Math.floor(i / 50) * 4, x2: 35000.5 + (i % 50), y2: -12000 + Math.floor(i / 50) * 4 }); ensureEntityIds();`);
        line(35025, -11980, 38025, -11980); line(35025, -11990, 38025, -11990);
        add({ type: 'PLINE', layer: 0, color: null, points: [{ x: 35025, y: -11970 }, { x: 36000, y: -11970 }, { x: 37000, y: -11900 }], closed: false });
        app.eval('zoomExtents()');
        assert.equal(snack(), '', '道路は除かない');
        assert.ok(shown().w > 2900);
        // 100m の現場の測点 200 と、2〜3km 先の既知点 3
        app.eval(`entities.length = 0; hideSnack();
            for(let i = 0; i < 200; i++) entities.push({ type: 'POINT', layer: 0, color: null, x: 35000 + (i % 20) * 5, y: -12000 + Math.floor(i / 20) * 10 });
            [[37000, -12000], [35000, -9500], [32500, -13000]].forEach(([x, y]) => entities.push({ type: 'POINT', layer: 0, color: null, x, y })); ensureEntityIds(); zoomExtents();`);
        assert.equal(snack(), '', '既知点は除かない');
        assert.ok(shown().w > 4000);
        // 細かい所（20m に 300本）と、まわりに広がる図面（250m 先まで 40本）
        app.eval(`entities.length = 0; hideSnack();
            for(let i = 0; i < 300; i++) entities.push({ type: 'LINE', layer: 0, color: null, x1: 1000 + (i % 20), y1: 1000 + Math.floor(i / 20), x2: 1000.5 + (i % 20), y2: 1000 + Math.floor(i / 20) });
            for(let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, r = 30 + i * 5.5; entities.push({ type: 'LINE', layer: 0, color: null, x1: 1000 + Math.cos(a) * r, y1: 1000 + Math.sin(a) * r, x2: 1003 + Math.cos(a) * r, y2: 1000 + Math.sin(a) * r }); }
            ensureEntityIds(); zoomExtents();`);
        assert.equal(snack(), '');
        assert.ok(shown().w > 400);
        // 2つの現場（同じくらいの数。片方は原点の近く）
        app.eval(`entities.length = 0; hideSnack();`);
        site(20);
        app.eval(`for(let i = 0; i < 20; i++) entities.push({ type: 'LINE', layer: 0, color: null, x1: i, y1: 0, x2: i, y2: 100 }); ensureEntityIds(); zoomExtents();`);
        assert.equal(snack(), '');
        assert.ok(shown().w > 30000, '両方入れる');
        // 2つだけ・1つ
        app.eval(`entities.length = 0; hideSnack();`);
        line(0, 0, 1, 0); line(50000, 0, 50001, 0);
        app.eval('zoomExtents()');
        assert.equal(snack(), '');
        app.eval(`entities.length = 1; zoomExtents();`);
        assert.equal(snack(), '');
        assert.deepEqual(app.errors(), []);
    });

    it('点検で直したこと: 図面が変わったあとの「見る」は何もしない・コマンドの途中では選ばない・SIMA に合わせたあとの「元に戻す」の知らせを消さない', () => {
        site(20);
        app.eval('saveUndo(); entities.pop();');
        line(0, 0, 1, 1);
        app.eval('zoomExtents()');
        assert.match(snack(), /1個/);
        app.eval('undo()'); // ごみが消え、番号がずれる
        press('🔍 見る');
        assert.deepEqual(app.val('cmdState.selectedIndices'), [], '別の図形を選ばない');
        // コマンドの途中
        line(0, 0, 1, 1);
        app.eval(`cmdState.selectedIndices = [0, 1]; processCommand('M'); zoomExtents();`);
        const mode = app.eval('cmdState.mode');
        press('🔍 見る');
        assert.equal(app.eval('cmdState.mode'), mode);
        assert.deepEqual(app.val('cmdState.selectedIndices'), [0, 1], '動かす図形は変えない');
        app.eval('resetCommand(); clearSelection();');
        // SIMA に合わせる（一部だけ動かす）: 知らせは「元に戻す」のまま
        app.eval(`helmReverseApply({ a: 1, b: 0, X0: 0, Y0: 0, X1: 0.001, Y1: 0 }, [0, 1]);`);
        assert.match(snack(), /SIMA の座標へ動かしました/);
        assert.deepEqual(app.errors(), []);
    });

    it('隠した画層・非表示の図形は今までどおり入れない。quiet（図面一式の表紙）では知らせない', () => {
        site(20);
        app.eval(`layers.push({ name: '隠す', color: '#ffffff', visible: false }); initLayers();
            entities.push({ type: 'LINE', layer: 1, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }, { type: 'LINE', layer: 0, color: null, x1: 9, y1: 9, x2: 10, y2: 10, hidden: true }); ensureEntityIds(); zoomExtents();`);
        assert.equal(snack(), '', '隠しているものは数えない');
        line(0, 0, 1, 1);
        app.eval('zoomExtents(true)');
        assert.equal(snack(), '');
        assert.ok(shown().w < 1000, 'quiet でも現場に合わせる');
    });

    it('extentsSplit: 乱数の図面で、原点の近くのごみはぜんぶ除き、現場・道路・遠くの基準点は1つも除かない。原点の近くの現場では除かない', () => {
        const r = app.val(`(() => {
            let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
            const box = (idx, x, y, w, h) => ({ idx, minX: Math.min(x, x + w), minY: Math.min(y, y + h), maxX: Math.max(x, x + w), maxY: Math.max(y, y + h) });
            let missed = 0, wrong = 0, local = 0;
            for(let t = 0; t < 300; t++) {
                const items = [], size = 10 + rnd() * 2000, a0 = rnd() * Math.PI * 2, R0 = size * (8 + rnd() * 200);
                const cx = Math.cos(a0) * R0, cy = Math.sin(a0) * R0, n = 10 + Math.floor(rnd() * 200);
                for(let i = 0; i < n; i++) items.push(box(i, cx + rnd() * size, cy + rnd() * size, rnd() * size * 0.05, rnd() * size * 0.05));
                // 現場から伸びる道路・数 km 先の基準点（原点とは反対の向き）
                for(let j = 0; j < 3; j++) { const L = size * (1 + rnd() * 30), a = a0 + (rnd() - 0.5); items.push(box(500 + j, cx, cy, Math.cos(a) * L, Math.sin(a) * L)); }
                for(let j = 0; j < 3; j++) { const L = size * (1 + rnd() * 40), a = a0 + (rnd() - 0.5); items.push(box(600 + j, cx + Math.cos(a) * L, cy + Math.sin(a) * L, 1, 1)); }
                // 原点の近くのごみ・原点から現場へ引いた線
                const k = 1 + Math.floor(rnd() * Math.max(1, n / 8));
                for(let j = 0; j < k; j++) items.push(rnd() < 0.3 ? box(1000 + j, 0, 0, cx, cy) : box(1000 + j, (rnd() - 0.5) * size, (rnd() - 0.5) * size, rnd() * 5, rnd() * 5));
                const { main, far } = extentsSplit(items);
                if(main.some((b) => b.idx >= 1000)) missed++;
                if(far.some((b) => b.idx < 1000)) wrong++;
                // 原点の近くの現場（ローカル座標）: 何も除かない
                const it2 = []; for(let i = 0; i < n; i++) it2.push(box(i, rnd() * size, rnd() * size, rnd() * 3, rnd() * 3));
                it2.push(box(9999, 0, 0, 1, 1));
                if(extentsSplit(it2).far.length) local++;
            }
            return { missed, wrong, local };
        })()`);
        assert.deepEqual(r, { missed: 0, wrong: 0, local: 0 });
    });
});
