'use strict';
// 大きな図面向けの軽量化（フェーズ3）のテスト:
//   ・元に戻す（Undo）の新しい履歴形式（図形ごとの文字列・変更の無い図形は共有）
//   ・描画の軽量化（同じ色の線をまとめて描く・小さい図形/文字の簡略表示）
//   ・画面操作中の描画キャッシュ
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('元に戻す（履歴の新形式）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            resetCommand();
            entities.length = 0; undoStack.length = 0; redoStack.length = 0; _undoStrCache = null;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            for (let i = 0; i < 50; i++) entities.push({ type: 'LINE', layer: 0, x1: i, y1: 0, x2: i + 1, y2: 1 });
            entities.push({ type: 'PLINE', layer: 0, closed: true, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] });
            entities.push({ type: 'TEXT', layer: 0, x: 1, y: 2, text: '測点A', height: 3, rotation: 0.3 });
            ensureEntityIds();
        `);
    });

    // 追加したばかりの図形にもIDを付けてから状態を取る（履歴にはIDが入るため）
    const state = () => app.val('(ensureEntityIds(), entities.map(e => { const c = Object.assign({}, e); delete c.bbox; delete c._hits; return c; }))');

    it('複数回の編集を元に戻す・やり直すと、各時点の状態に正確に戻る', () => {
        const s0 = state();
        app.eval('saveUndo(); moveEntity(entities[3], 10, 10);');
        const s1 = state();
        app.eval(`saveUndo(); entities.splice(5, 2); entities.push({ type: 'CIRCLE', layer: 0, cx: 9, cy: 9, radius: 2 });`);
        const s2 = state();
        app.eval(`saveUndo(); layers.push({ name: '新画層', color: '#ff0000', visible: false }); entities[0].layer = 1;`);
        const s3 = state();
        const L3 = app.val('layers');

        app.eval('undo();'); assert.deepEqual(state(), s2);
        assert.equal(app.val('layers').length, 1, '画層も元に戻る');
        app.eval('undo();'); assert.deepEqual(state(), s1);
        app.eval('undo();'); assert.deepEqual(state(), s0);
        app.eval('redo(); redo(); redo();');
        assert.deepEqual(state(), s3);
        assert.deepEqual(app.val('layers'), L3);
    });

    it('元に戻したとき、変わっていない図形はオブジェクトをそのまま使う（外形も作り直さない）', () => {
        app.eval(`entities.forEach(e => { e.bbox = calcBBox(e); }); window.__keep = entities[10]; window.__moved = entities[3];`);
        app.eval('saveUndo(); moveEntity(entities[3], 10, 10);');
        app.eval('undo();');
        assert.equal(app.eval('entities[10] === window.__keep'), true, '変わっていない図形が作り直された');
        assert.equal(app.eval('entities[3] === window.__moved'), false, '変わった図形は履歴の内容で作り直す');
        assert.equal(app.eval('entities[3].x1'), 3);
        assert.ok(app.eval('entities[10].bbox'), '変わっていない図形の外形は残る');
    });

    it('外形（bbox）や寸法の画面上の当たり判定は履歴に含めない', () => {
        app.eval(`entities[0].bbox = calcBBox(entities[0]); entities[0]._hits = [{ type: 'seg' }]; saveUndo();`);
        const s = app.val('undoStack[undoStack.length - 1].strs[0]');
        assert.doesNotMatch(s, /bbox|_hits/);
        assert.ok(app.eval('entities[0].bbox'), '履歴を作っても図形の外形は消えない');
        assert.equal(app.eval('entities[0]._hits.length'), 1);
    });

    it('履歴に固有IDが残り、元に戻した後も選択が同じ図形を指す', () => {
        app.eval('cmdState.selectedIndices = [20];');
        const id = app.val('entities[20].id');
        app.eval('saveUndo(); entities.splice(0, 5);');
        app.eval('undo();');
        assert.deepEqual(app.val('cmdState.selectedIndices.map(i => entities[i].id)'), [id]);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('描画の軽量化', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    // ctx.stroke / fillText の呼び出し回数を数える
    const countDraw = (setupCode) => app.val(`(function () {
        ${setupCode || ''}
        let strokes = 0, texts = 0, moves = 0;
        ctx.stroke = () => { strokes++; }; ctx.fillText = () => { texts++; }; ctx.moveTo = () => { moves++; };
        try { _frameCache = null; _drawFrame(); }
        finally { delete ctx.stroke; delete ctx.fillText; delete ctx.moveTo; }
        return { strokes, texts, moves };
    })()`);

    beforeEach(() => {
        app.eval(`
            resetCommand(); touchState.isPinch = false; window.ghostLayerMode = false;
            entities.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }, { name: 'Y', color: '#ffff00', visible: true }, { name: 'OFF', color: '#ff00ff', visible: false });
            view.x = 0; view.y = 768; view.scale = 1; view.rotation = 0;
        `);
    });

    it('同じ色の線はまとめて描く（1000本でも stroke は数回）', () => {
        app.eval(`for (let i = 0; i < 1000; i++) entities.push({ type: 'LINE', layer: 0, x1: i % 900, y1: 10 + (i % 50), x2: i % 900 + 20, y2: 30 + (i % 50) });`);
        const r = countDraw();
        assert.ok(r.strokes < 20, `stroke が多すぎる: ${r.strokes}`);
        assert.ok(r.moves >= 1000, `描かれていない線がある: moveTo ${r.moves}`);
    });

    it('色が変わる・選択中の図形は別の色で描く（まとめすぎない）', () => {
        app.eval(`
            for (let i = 0; i < 10; i++) entities.push({ type: 'LINE', layer: i % 2, x1: i * 10, y1: 100, x2: i * 10 + 5, y2: 120 });
            ensureEntityIds(); cmdState.highlightIdx = 4;
        `);
        const r = countDraw();
        assert.ok(r.strokes >= 10, `色ごとに描き分けられていない: ${r.strokes}`);
    });

    it('全種類の図形を、拡大率・画面回転・薄表示・選択の組み合わせでエラーなく描ける', () => {
        app.eval(`
            entities.push({ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 100, y2: 50 });
            entities.push({ type: 'CIRCLE', layer: 1, cx: 50, cy: 50, radius: 20 });
            entities.push({ type: 'ARC', layer: 0, cx: 80, cy: 20, radius: 10, startAngle: 5, endAngle: 1, counterclockwise: false });
            entities.push({ type: 'RECTANG', layer: 2, x1: 10, y1: 10, x2: 60, y2: 40 });
            entities.push({ type: 'PLINE', layer: 0, closed: true, points: [{ x: 0, y: 0 }, { x: 0.001, y: 0 }, { x: 30, y: 5 }, { x: 40, y: 40 }] });
            entities.push({ type: 'ELLIPSE', layer: 1, cx: 20, cy: 70, rx: 15, ry: 5, rotation: 0.4 });
            entities.push({ type: 'POINT', layer: 0, x: 5, y: 5 });
            entities.push({ type: 'TEXT', layer: 0, x: 10, y: 10, text: '測点\\n2行目', height: 5, rotation: 0.2, halign: 'center', valign: 'middle' });
            entities.push({ type: 'HATCH', layer: 1, target: { type: 'CIRCLE', cx: 50, cy: 50, radius: 20 } });
            entities.push({ type: 'DIMENSION', subType: 'LINEAR', layer: 0, p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, offset: 10 });
            ensureEntityIds(); cmdState.selectedIndices = [1, 2];
        `);
        for (const scale of [0.001, 0.05, 0.3, 1, 20]) {
            for (const rot of [0, 0.7]) {
                for (const ghost of [false, true]) {
                    app.eval(`view.scale = ${scale}; view.rotation = ${rot}; window.ghostLayerMode = ${ghost}; _frameCache = null; _drawFrame();`);
                }
            }
        }
        assert.deepEqual(app.errors(), []);
    });

    it('読めない大きさの文字は fillText せず簡略表示し、読める大きさでは文字を描く', () => {
        // 座標軸のラベルなど図形以外の文字もあるので、図形が無いときの回数を差し引く
        const base = countDraw('view.scale = 0.2;').texts;
        app.eval(`for (let i = 0; i < 100; i++) entities.push({ type: 'TEXT', layer: 0, x: i * 5, y: 100, text: 'No.' + i, height: 10 });`);
        const small = countDraw('view.scale = 0.2;'); // 高さ2px
        assert.equal(small.texts - base, 0, '小さすぎる文字を描いている');
        assert.ok(small.strokes >= 1, '簡略表示の線が描かれていない');
        const big = countDraw('view.scale = 1;'); // 高さ10px
        assert.equal(big.texts - base, 100);
    });

    it('画面上で一定の大きさの点の記号（POINT）は、縮小しても記号のまま描く', () => {
        app.eval(`entities.push({ type: 'POINT', layer: 0, x: 100, y: 100 });`);
        const r = countDraw('view.scale = 0.01;');
        assert.ok(r.moves >= 3, `POINT が点に置き換わった: moveTo ${r.moves}`);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('画面操作中の描画キャッシュ', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    // 図形の描画に時間がかかる（重い図面）状態を再現して、キャッシュを作らせる
    const heavyFrame = () => app.eval(`(function () {
        const orig = drawEntities;
        drawEntities = function () { const t = performance.now(); while (performance.now() - t < GESTURE_CACHE_MIN_MS + 3) {} return orig.apply(this, arguments); };
        try { _drawFrame(); } finally { drawEntities = orig; }
    })()`);
    const fullDrawsDuring = (code) => app.val(`(function () {
        let n = 0; const orig = drawEntities;
        drawEntities = function () { n++; return orig.apply(this, arguments); };
        try { ${code} } finally { drawEntities = orig; }
        return n;
    })()`);

    beforeEach(() => {
        app.eval(`
            resetCommand(); touchState.isPinch = false; _viewGestureUntil = 0;
            entities.length = 0; for (let i = 0; i < 200; i++) entities.push({ type: 'LINE', layer: 0, x1: i, y1: 0, x2: i, y2: 100 });
            view.x = 0; view.y = 700; view.scale = 3; view.rotation = 0; _frameCache = null;
        `);
    });

    it('重い図面では、ピンチ操作中は保存した画面を使い、図形を描き直さない', () => {
        heavyFrame();
        assert.equal(app.eval('!!_frameCache'), true, 'キャッシュが作られていない');
        const n = fullDrawsDuring('touchState.isPinch = true; view.scale *= 1.1; _drawFrame(); view.x += 20; _drawFrame();');
        assert.equal(n, 0);
        const after = fullDrawsDuring('touchState.isPinch = false; _drawFrame();');
        assert.equal(after, 1, '操作後に正確に描き直していない');
    });

    it('軽い図面ではキャッシュを使わず、毎回描く（見た目は従来どおり）', () => {
        app.eval('_drawFrame();');
        assert.equal(app.eval('_frameCache'), null);
        const n = fullDrawsDuring('touchState.isPinch = true; view.scale *= 1.1; _drawFrame();');
        assert.equal(n, 1);
    });

    it('図形を編集したら、操作中でも古いキャッシュは使わない', () => {
        heavyFrame();
        app.eval('saveUndo(); entities[0].x1 = 50; delete entities[0].bbox;');
        const n = fullDrawsDuring('touchState.isPinch = true; _drawFrame();');
        assert.equal(n, 1);
    });

    it('画面を回転させた場合はキャッシュを使わない', () => {
        heavyFrame();
        const n = fullDrawsDuring('touchState.isPinch = true; view.rotation = 0.3; _drawFrame();');
        assert.equal(n, 1);
    });

    it('重い図面では、カーソル・スナップ記号だけの更新で図形を描き直さない', () => {
        heavyFrame();
        assert.equal(fullDrawsDuring('_drawFrame(true); _drawFrame(true);'), 0, '重ね表示だけの更新で図形を描き直している');
        // 表示位置・選択・画層の表示・図形が変わったら描き直す
        assert.equal(fullDrawsDuring('view.x += 5; _drawFrame(true);'), 1, '表示位置が変わったのに描き直していない');
        heavyFrame();
        assert.equal(fullDrawsDuring('cmdState.highlightIdx = 3; _drawFrame(true);'), 1, 'ハイライトが変わったのに描き直していない');
        heavyFrame();
        assert.equal(fullDrawsDuring('layers[0].visible = false; _drawFrame(true);'), 1, '画層の表示が変わったのに描き直していない');
        app.eval('layers[0].visible = true;');
        heavyFrame();
        assert.equal(fullDrawsDuring('saveUndo(); entities[1].x1 = 70; delete entities[1].bbox; _drawFrame(true);'), 1, '図形を編集したのに描き直していない');
    });

    it('マウス移動（作図中）は重ね表示だけ、選択待ちでハイライトが変わったら図形ごと描き直す', async () => {
        // 実際の重い図面と同じく、図形の描画に毎回時間がかかる状態にして、図形を描いた回数を数える
        app.eval(`(function () {
            const o = drawEntities; window.__origDraw = o; window.__fullCount = 0;
            drawEntities = function () {
                window.__fullCount++;
                const t = performance.now(); while (performance.now() - t < GESTURE_CACHE_MIN_MS + 3) {}
                return o.apply(this, arguments);
            };
        })()`);
        const nextFrame = () => new Promise((r) => app.window.requestAnimationFrame(() => r()));
        const moveAndCount = async (x, y) => {
            const before = app.eval('window.__fullCount');
            app.eval(`canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }));`);
            await nextFrame();
            return app.eval('window.__fullCount') - before;
        };
        try {
            app.eval(`cmdState.mode = 'WAITING_LINE_P2'; cmdState.startWcs = { x: 0, y: 0 }; render();`);
            await nextFrame(); // 重い画面を1回描いて保存させる
            assert.equal(await moveAndCount(300, 300), 0, '作図中のマウス移動で図形を描き直している');
            assert.equal(await moveAndCount(310, 305), 0);
            // 削除対象の選択待ち: 線の上に来たらハイライトが変わるので描き直す
            app.eval(`resetCommand(); cmdState.mode = 'WAITING_ERASE_SELECT'; render();`);
            await nextFrame();
            const p = app.val('wcsToScreen(50, 50)');
            assert.equal(await moveAndCount(p.x, p.y), 1, 'ハイライトが変わったのに描き直していない');
            assert.equal(await moveAndCount(p.x + 0.5, p.y), 0, '同じ図形の上での移動で描き直している');
        } finally {
            app.eval('drawEntities = window.__origDraw; resetCommand();');
        }
    });

    it('ホイール操作は最後の操作から少し待って正確に描き直す', async () => {
        heavyFrame();
        const n = fullDrawsDuring('noteViewGesture(30); _drawFrame();');
        assert.equal(n, 0, 'ホイール操作中なのに描き直している');
        await new Promise((r) => setTimeout(r, 120));
        assert.equal(app.eval('_isViewGestureActive()'), false);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
