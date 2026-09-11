'use strict';
// 空間索引（タップ判定・スナップ・ルーペの候補絞り込み）のテスト。
// 索引を使った結果が、全図形を調べる従来の方法と完全に一致すること、
// 編集・元に戻す後も索引が作り直されて正しく当たることを確認する。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('空間索引', () => {
    let app;
    before(async () => {
        app = await loadApp();
        // 3000図形のランダムな図面（索引を使う規模）
        app.eval(`
            resetCommand();
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }, { name: 'B', color: '#ffff00', visible: true });
            (function () {
                let s = 4242; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
                const W = 2000;
                for (let i = 0; i < 1800; i++) { const x = rnd() * W, y = rnd() * W, a = rnd() * 6.28, l = 3 + rnd() * 40; entities.push({ type: 'LINE', layer: i % 2, x1: x, y1: y, x2: x + Math.cos(a) * l, y2: y + Math.sin(a) * l }); }
                for (let i = 0; i < 400; i++) entities.push({ type: 'CIRCLE', layer: 0, cx: rnd() * W, cy: rnd() * W, radius: 1 + rnd() * 8 });
                for (let i = 0; i < 200; i++) entities.push({ type: 'ARC', layer: 1, cx: rnd() * W, cy: rnd() * W, radius: 2 + rnd() * 15, startAngle: rnd() * 3, endAngle: 3 + rnd() * 3, counterclockwise: true });
                for (let i = 0; i < 300; i++) entities.push({ type: 'TEXT', layer: 0, x: rnd() * W, y: rnd() * W, text: 'P' + i, height: 3 });
                for (let i = 0; i < 200; i++) { let x = rnd() * W, y = rnd() * W; const pts = []; for (let k = 0; k < 20; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; pts.push({ x, y }); } entities.push({ type: 'PLINE', layer: 1, points: pts, closed: rnd() < 0.3 }); }
                for (let i = 0; i < 100; i++) entities.push({ type: 'RECTANG', layer: 0, x1: rnd() * W, y1: rnd() * W, x2: rnd() * W, y2: rnd() * W });
                // 図面全体をまたぐ長い線（「常に調べる」一覧に入る）
                entities.push({ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: W, y2: W });
            })();
            ensureEntityIds();
            view.x = 0; view.y = 0; view.rotation = 0; view.scale = 3;
        `);
    });
    after(() => app.close());

    // 画面上のランダムな点で、索引あり／なしの結果を比べる
    function compareAt(fnExpr, count, seed) {
        return app.val(`(function () {
            let s = ${seed}; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
            const diffs = []; let hits = 0;
            for (let k = 0; k < ${count}; k++) {
                // 図面のある範囲を中心に、画面座標で点を選ぶ
                const w = { x: rnd() * 2000, y: rnd() * 2000 };
                view.x = 400 - w.x * view.scale; view.y = 300 + w.y * view.scale;
                const sx = 400 + (rnd() - 0.5) * 30, sy = 300 + (rnd() - 0.5) * 30;
                window.__disableSpatialIndex = true;  const a = JSON.stringify(${fnExpr});
                window.__disableSpatialIndex = false; const b = JSON.stringify(${fnExpr});
                if (a !== b) diffs.push({ k, a, b });
                if (a !== '-1' && a !== 'null') hits++;
            }
            return { diffs: diffs.slice(0, 5), nd: diffs.length, hits };
        })()`);
    }

    it('タップ判定の結果が、全図形を調べた場合と一致する', () => {
        const r = compareAt('hitTestEntity(sx, sy)', 400, 11);
        assert.equal(r.nd, 0, JSON.stringify(r.diffs));
        assert.ok(r.hits > 50, `当たりが少なすぎて比較になっていない: ${r.hits}`);
    });

    it('スナップ（作図中・垂線含む）の結果が、全図形を調べた場合と一致する', () => {
        app.eval(`cmdState.mode = 'WAITING_LINE_P2'; cmdState.startWcs = { x: 1000, y: 1000 };`);
        try {
            const r = compareAt('findSnap(sx, sy, screenToWcs(sx, sy).x, screenToWcs(sx, sy).y)', 300, 22);
            assert.equal(r.nd, 0, JSON.stringify(r.diffs));
            assert.ok(r.hits > 100, `スナップが少なすぎて比較になっていない: ${r.hits}`);
        } finally {
            app.eval('resetCommand();');
        }
    });

    it('実際に索引が使われ、候補が全図形より大幅に少ない', () => {
        const r = app.val(`(function () { const c = _spatialCandidates(1000, 1000, 1005, 1005); return { len: c ? c.length : -1, n: entities.length }; })()`);
        assert.ok(r.len >= 0, '索引が使われていない');
        assert.ok(r.len < r.n / 20, `候補が多すぎる: ${r.len} / ${r.n}`);
    });

    // 指定した図形の中点をタップしたとき、その図形が当たるか
    const hitsEntityAt = (id, wx, wy) => app.val(`(function () {
        view.x = 400 - ${wx} * view.scale; view.y = 300 + ${wy} * view.scale;
        const i = hitTestEntity(400, 300);
        return i >= 0 ? entities[i].id === ${id} : false;
    })()`);

    it('移動した図形は、新しい位置でタップに当たり、元の位置では当たらない', () => {
        const id = app.val(`(function () { entities.push({ type: 'LINE', layer: 0, x1: 3000, y1: 3000, x2: 3010, y2: 3000 }); ensureEntityIds(); return entities[entities.length - 1].id; })()`);
        assert.equal(hitsEntityAt(id, 3005, 3000), true);
        app.eval(`saveUndo(); moveEntity(getEntityById(${id}), 500, 0);`);
        assert.equal(hitsEntityAt(id, 3505, 3000), true, '移動先で当たらない（索引が古いまま）');
        assert.equal(hitsEntityAt(id, 3005, 3000), false);
        app.eval('undo();');
        assert.equal(hitsEntityAt(id, 3005, 3000), true, '元に戻した位置で当たらない');
    });

    it('延長した部分もタップ・スナップに反応する（外形の更新漏れの回帰）', () => {
        const id = app.val(`(function () {
            entities.push({ type: 'LINE', layer: 0, x1: 5000, y1: 5000, x2: 5010, y2: 5000 });
            entities.push({ type: 'LINE', layer: 0, x1: 5400, y1: 4990, x2: 5400, y2: 5010 });
            ensureEntityIds();
            return entities[entities.length - 2].id;
        })()`);
        hitsEntityAt(id, 5005, 5000); // 索引を作らせる
        app.eval('executeExtend([{ x: 5009, y: 5000 }]);');
        const e = app.val(`getEntityById(${id})`);
        assert.ok(Math.abs(e.x2 - 5400) < 1e-9, `延長されていない: ${JSON.stringify(e)}`);
        assert.equal(e.bbox, undefined, '外形（bbox）が古いまま残っている');
        assert.equal(hitsEntityAt(id, 5300, 5000), true, '延長した部分で当たらない');
    });

    it('回転・プロパティ編集・トリムの後も索引が正しく作り直される', () => {
        const id = app.val(`(function () { entities.push({ type: 'LINE', layer: 0, x1: 7000, y1: 7000, x2: 7020, y2: 7000 }); ensureEntityIds(); return entities[entities.length - 1].id; })()`);
        hitsEntityAt(id, 7010, 7000);
        app.eval(`saveUndo(); rotateEntity(getEntityById(${id}), 7000, 7000, Math.PI / 2);`);
        assert.equal(hitsEntityAt(id, 7000, 7010), true, '回転後の位置で当たらない');
        app.eval(`changeEntityPropById(${id}, 'x1', 7300);`); // プロパティ画面の座標入力（UCS変換あり）
        const moved = app.val(`getEntityById(${id})`);
        const mx = (moved.x1 + moved.x2) / 2, my = (moved.y1 + moved.y2) / 2;
        assert.equal(hitsEntityAt(id, mx, my), true, 'プロパティ編集後の位置で当たらない');
        // トリムで新しくできた線にも当たる
        app.eval(`
            entities.push({ type: 'LINE', layer: 0, x1: 9000, y1: 9000, x2: 9100, y2: 9000 });
            entities.push({ type: 'LINE', layer: 0, x1: 9050, y1: 8990, x2: 9050, y2: 9010 });
            ensureEntityIds();
        `);
        hitsEntityAt(-1, 9010, 9000);
        app.eval('executeTrim([{ x: 9080, y: 9000 }]);');
        const pieceId = app.val(`(function () { const e = entities.find(e => e.type === 'LINE' && Math.abs(e.y1 - 9000) < 1e-9 && Math.abs(e.y2 - 9000) < 1e-9 && Math.max(e.x1, e.x2) <= 9050 + 1e-9 && Math.min(e.x1, e.x2) < 9001); ensureEntityIds(); return e ? e.id : null; })()`);
        assert.ok(pieceId, 'トリム後の線が無い');
        assert.equal(hitsEntityAt(pieceId, 9020, 9000), true, 'トリムで残った線に当たらない');
    });

    it('ルーペは指の周りの図形だけを描く（全図形を毎回描かない）', () => {
        const r = app.val(`(function () {
            let count = 0; const orig = drawOneEntity;
            drawOneEntity = function (e, c) { count++; return orig(e, c); };
            try {
                view.x = 400 - 1000 * view.scale; view.y = 300 + 1000 * view.scale;
                touchState.showLoupe = true; touchState.loupeX = 400; touchState.loupeY = 450;
                drawLoupe();
            } finally { drawOneEntity = orig; touchState.showLoupe = false; }
            return { count, n: entities.length };
        })()`);
        assert.ok(r.count < r.n / 20, `ルーペで描いた図形が多すぎる: ${r.count} / ${r.n}`);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
