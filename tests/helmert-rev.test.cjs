'use strict';
// SIMA の変換の逆（v5.49。cad-helmert-rev.js）: 張り合わせ点から図面 → SIMA の変換を求め、図面の図形を SIMA の座標へ動かす
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('図面を SIMA に合わせる（変換の逆）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('任意座標の図面を、公共座標の SIMA へ回転・移動して合わせる（選んだ図形／すべて。↩ で戻る。張り合わせ点も動かす）', () => {
        // 公共座標（X 北・Y 東）: 図面の点を 30° 回して、(-12000, 45000) へ動かしたもの
        const th = 30 * Math.PI / 180, X1 = -12000.123, Y1 = 45000.456;
        const toPub = (X, Y) => ({ X: X1 + X * Math.cos(th) - Y * Math.sin(th), Y: Y1 + X * Math.sin(th) + Y * Math.cos(th) });
        const loc = [[0, 0], [100, 0], [100, 50], [0, 50]]; // 図面（任意座標）の X・Y
        app.eval(`entities.length = 0; undoStack.length = 0; localStorage.setItem('cad_survey_unit', 'm');
            ${JSON.stringify(loc)}.forEach(([X, Y]) => { const w = surveyToWcs(X, Y); entities.push({ type: 'POINT', layer: 0, color: null, x: w.x, y: w.y, name: 'P' }); });
            { const a = surveyToWcs(0, 0), b = surveyToWcs(100, 50); entities.push({ type: 'LINE', layer: 0, color: null, x1: a.x, y1: a.y, x2: b.x, y2: b.y }); }
            ensureEntityIds(); cmdState.selectedIndices = [];
            _helm.src = { name: 'pub.sim', points: ${JSON.stringify(loc.map(([X, Y], i) => Object.assign({ num: String(i + 1), name: 'K' + i }, toPub(X, Y))))} };
            _helm.mode = 'rigid';
            _helm.pairs = ${JSON.stringify(loc.map(([X, Y], i) => ({ si: i, dst: { X, Y, name: 'P' }, use: true })))};
            _helmSolveNow(); window.confirm = () => true;`);
        assert.equal(app.val('helmReverse()'), true);
        // 図面の点が SIMA の座標になった
        const pts = app.val(`entities.filter(e => e.type === 'POINT').map(e => wcsToSurvey(e.x, e.y))`);
        loc.forEach(([X, Y], i) => { const q = toPub(X, Y); near(pts[i].X, q.X, 1e-6); near(pts[i].Y, q.Y, 1e-6); });
        const ln = app.val(`(() => { const e = entities.find(e => e.type === 'LINE'); return [wcsToSurvey(e.x1, e.y1), wcsToSurvey(e.x2, e.y2)]; })()`);
        near(ln[1].X, toPub(100, 50).X, 1e-6); near(ln[1].Y, toPub(100, 50).Y, 1e-6);
        // 張り合わせ点も動き、残差はほぼ 0
        assert.ok(app.val('_helm.sol.ok'));
        assert.ok(app.val('Math.max(..._helm.pairs.map(p => p.res.d))') < 1e-6);
        assert.ok(app.val('_helm.sol.scale') > 0.999999 && app.val('_helm.sol.scale') < 1.000001);
        // ↩ で1回で戻る
        app.eval('undo();');
        const back = app.val(`entities.filter(e => e.type === 'POINT').map(e => wcsToSurvey(e.x, e.y))`);
        near(back[1].X, 100, 1e-9); near(back[1].Y, 0, 1e-9);
        // 選んだ図形だけ（confirm が「はい」なら1つ目＝選んだ図形）
        app.eval(`_helm.pairs = ${JSON.stringify(loc.map(([X, Y], i) => ({ si: i, dst: { X, Y, name: 'P' }, use: true })))}; _helmSolveNow(); cmdState.selectedIndices = [4]; helmReverse();`);
        const after = app.val(`entities.map(e => e.type === 'POINT' ? wcsToSurvey(e.x, e.y).X : wcsToSurvey(e.x2, e.y2).X)`);
        near(after[0], 0, 1e-9); // 点は動かない
        near(after[4], toPub(100, 50).X, 1e-6); // 線だけ動く
        assert.match(app.val(`Array.from(document.getElementById('command-log').children).slice(-3).map(d => d.textContent).join('|')`), /図面の図形 1個を SIMA の座標へ動かしました/);
        app.eval('_helm.src = null; _helm.pairs = []; cmdState.selectedIndices = [];');
        assert.deepEqual(app.errors(), []);
    });

    it('張り合わせ点が1組だけなら知らせる', () => {
        app.eval(`_helm.src = { name: 'a', points: [{ num: '1', X: 0, Y: 0 }] }; _helm.pairs = [{ si: 0, dst: { X: 1, Y: 1 }, use: true }];
            window.__t = null; window.__st0 = window.showToast; window.showToast = (m) => { window.__t = m; };`);
        try { assert.equal(app.val('helmReverse()'), false); assert.match(app.val('window.__t'), /2組以上/); }
        finally { app.eval('window.showToast = window.__st0; _helm.src = null; _helm.pairs = [];'); }
    });
});
