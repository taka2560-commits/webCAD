'use strict';
// ヘルマート変換（cad-helmert.js・cad-subview.js）のテスト:
//   変換の計算（縮尺あり・1/1、公共座標の桁）、最小二乗の式どおりの精度（σ₀・標準偏差・点の精度の目安）、
//   ほかの組と合わない組（その組を除いて求めた変換と比べる）、外挿、
//   別窓での張り合わせ（タップ → ☑確定）・点名で組にする・使う／消す、範囲（四角・なぞる）、
//   画層を変えての取り込みと元に戻す、変換後の SIMA・結果の CSV・結果の表、TS で受信した SIMA からの変換・機械へ送る、別窓の出し入れ
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const { ReadableStream, WritableStream } = require('node:stream/web');
const { loadApp, near } = require('./helpers/load-app.cjs');

// 変換元（現場の仮の座標・m）
const SRC = [
    { num: '1', name: 'T1', X: 0, Y: 0, z: 10 }, { num: '2', name: 'T2', X: 50, Y: 0 }, { num: '3', name: 'T3', X: 50, Y: 80 }, { num: '4', name: 'T4', X: 0, Y: 80 },
    { num: '5', name: 'K1', X: 20, Y: 30 }, { num: '6', name: 'K2', X: 30, Y: 30 }, { num: '7', name: 'K3', X: 30, Y: 45 }, { num: '8', name: 'K4', X: 20, Y: 45 },
    { num: '9', name: 'F1', X: 150, Y: 150 }, // 張り合わせ点から遠い点
];
const fmt = (v) => (v === undefined ? '' : v.toFixed(3));
const SIMA = ['G00,01,GENBA,', 'Z00,座標ﾃﾞｰﾀ,,', 'A00,', ...SRC.map((p) => `A01,${p.num},${p.name},${fmt(p.X)},${fmt(p.Y)},${fmt(p.z)},`), 'A99,',
    'Z00,区画ﾃﾞｰﾀ,', 'D00,1,1-1,1,', 'B01,5,K1,', 'B01,6,K2,', 'B01,7,K3,', 'B01,8,K4,', 'D99,',
    'D00,2,1-2,1,', 'B01,1,T1,', 'B01,2,T2,', 'B01,9,F1,', 'D99,'].join('\r\n') + '\r\n';
// 図面の座標への変換（右回り 30°・縮尺 1.0002・公共座標へ移動）
const TH = 30 * Math.PI / 180, SC = 1.0002, TX = -35000, TY = 20000;
const fwd = (p, s = SC) => ({ X: TX + s * (Math.cos(TH) * p.X - Math.sin(TH) * p.Y), Y: TY + s * (Math.sin(TH) * p.X + Math.cos(TH) * p.Y) });
// 図面の張り合わせ点に入れる測りの誤差（mm）
const NOISE = [[1.2, -0.8], [-0.5, 1.5], [0.3, 0.2], [-1.1, -0.9], [0.7, -1.3], [0, 0.6]];
const noisy = (i) => { const q = fwd(SRC[i]), e = NOISE[i % NOISE.length]; return { X: q.X + e[0] / 1000, Y: q.Y + e[1] / 1000 }; };

// 独立に解く最小二乗（未知数 a, b, c, d: X' = aX − bY + c, Y' = bX + aY + d。正規方程式を掃き出しで解く）
function inv(M) {
    const n = M.length, A = M.map((r, i) => [...r, ...M.map((_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        [A[c], A[p]] = [A[p], A[c]];
        const d = A[c][c];
        for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
        for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map((r) => r.slice(n));
}
function lsq(pairs) {
    const N = [0, 1, 2, 3].map(() => [0, 0, 0, 0]), u = [0, 0, 0, 0], rows = [];
    const add = (g, l) => { rows.push([g, l]); for (let i = 0; i < 4; i++) { u[i] += g[i] * l; for (let j = 0; j < 4; j++) N[i][j] += g[i] * g[j]; } };
    pairs.forEach(({ src, dst }) => { add([src.X, -src.Y, 1, 0], dst.X); add([src.Y, src.X, 0, 1], dst.Y); });
    const Q = inv(N), x = Q.map((r) => r.reduce((s, v, j) => s + v * u[j], 0));
    const vv = rows.reduce((s, [g, l]) => s + (g.reduce((t, gi, i) => t + gi * x[i], 0) - l) ** 2, 0);
    return { x, Q, sigma0: Math.sqrt(vv / (rows.length - 4)) };
}

describe('ヘルマート変換: 計算', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    const solve = (pairs, mode) => app.val(`helmSolve(${JSON.stringify(pairs)}, '${mode}')`);

    it('既知の変換を求める（縮尺あり・1/1）。回転は右回りが正。公共座標どうしでも桁が落ちない', () => {
        const pairs = [0, 1, 2, 3].map((i) => ({ src: SRC[i], dst: fwd(SRC[i]) }));
        const s = solve(pairs, 'sim');
        assert.equal(s.ok, true); assert.equal(s.mode, 'sim'); assert.equal(s.dof, 4);
        assert.ok(near(s.scale, SC, 1e-12) && near(s.rot, TH, 1e-12), JSON.stringify(s));
        assert.ok(s.sigma0 < 1e-9);
        const q = app.val(`helmApply(${JSON.stringify(s)}, 150, 150)`), e = fwd(SRC[8]);
        assert.ok(near(q.X, e.X, 1e-8) && near(q.Y, e.Y, 1e-8));
        assert.equal(app.eval(`helmRotText(${s.rot})`), '右回り 30°00′00.0″');
        assert.equal(app.eval(`helmRotText(-Math.PI / 2)`), '左回り 90°00′00.0″');
        // 1/1: 縮尺は 1 のまま、回転と移動だけ
        const r = solve([0, 1, 2, 3].map((i) => ({ src: SRC[i], dst: fwd(SRC[i], 1) })), 'rigid');
        assert.equal(r.mode, 'rigid'); assert.equal(r.dof, 5);
        assert.ok(near(r.scale, 1, 1e-12) && near(r.rot, TH, 1e-12) && r.sigma0 < 1e-9);
        // 縮尺のある組を 1/1 で合わせると、ずれが残る（1.0002 × 重心から約 47m ≈ 9mm）
        const r2 = solve(pairs, 'rigid');
        assert.ok(near(r2.scale, 1, 1e-12)); assert.ok(r2.sigma0 > 0.005, String(r2.sigma0));
        // 変換元も公共座標
        const b = solve(pairs.map((p) => ({ src: { X: p.src.X - 120000, Y: p.src.Y + 45000 }, dst: p.dst })), 'sim');
        assert.ok(near(b.scale, SC, 1e-10) && near(b.rot, TH, 1e-10) && b.sigma0 < 1e-7, JSON.stringify([b.scale, b.rot, b.sigma0]));
    });

    it('精度: σ₀・縮尺と回転の標準偏差・点の精度の目安が、最小二乗の式（正規方程式）と合う', () => {
        const pairs = [0, 1, 2, 3, 4, 5].map((i) => ({ src: SRC[i], dst: noisy(i) }));
        const s = solve(pairs, 'sim'), ref = lsq(pairs);
        assert.ok(near(s.a, ref.x[0], 1e-10) && near(s.b, ref.x[1], 1e-10), JSON.stringify([s.a, s.b, ref.x]));
        assert.equal(s.dof, 8);
        assert.ok(near(s.sigma0, ref.sigma0, 1e-9), `${s.sigma0} ${ref.sigma0}`);
        assert.ok(s.sigma0 > 0.0003 && s.sigma0 < 0.003, String(s.sigma0)); // 1mm 前後の誤差
        assert.ok(near(s.sScale, ref.sigma0 * Math.sqrt(ref.Q[0][0]), 1e-10));
        assert.ok(near(s.sRot, ref.sigma0 * Math.sqrt(ref.Q[1][1]) / s.scale, 1e-10));
        assert.ok(near(s.sShift, s.sigma0 / Math.sqrt(6), 1e-12));
        // 点の精度の目安 = σ₀·√(gᵀ Q g)（g は X′ の式の係数）
        const g = [100, 20, 1, 0]; // 点 (100, −20)
        const gQg = g.reduce((t, gi, i) => t + gi * ref.Q[i].reduce((w, q, j) => w + q * g[j], 0), 0);
        assert.ok(near(app.eval(`helmPointSigma(${JSON.stringify(s)}, 100, -20)`), ref.sigma0 * Math.sqrt(gQg), 1e-9));
    });

    it('2組: 縮尺ありは、ちょうど合わせるだけ（自由度 0・精度は出せない）。1/1 は自由度 1。同じ位置の点は計算しない', () => {
        const pairs = [0, 2].map((i) => ({ src: SRC[i], dst: noisy(i) }));
        const s = solve(pairs, 'sim');
        assert.equal(s.ok, true); assert.equal(s.dof, 0); assert.equal(s.sigma0, null);
        assert.ok(s.residuals.every((r) => r.d < 1e-9));
        assert.equal(app.eval(`helmPointSigma(${JSON.stringify(s)}, 10, 10)`), null);
        const r = solve(pairs, 'rigid');
        assert.equal(r.dof, 1); assert.ok(r.sigma0 > 0);
        assert.match(app.val(`helmSolve([], 'sim').error`), /2組以上/);
        assert.match(solve([{ src: SRC[0], dst: fwd(SRC[0]) }, { src: SRC[0], dst: fwd(SRC[1]) }], 'sim').error, /同じ位置/);
    });

    it('ほかの組と合わない組（点の取り違え）を見つける。外れた組が σ₀ を大きくして隠れることがない', () => {
        const pairs = [0, 1, 2, 3, 4, 5].map((i) => ({ src: SRC[i], dst: noisy(i) }));
        pairs[2].dst = { X: pairs[2].dst.X + 0.25, Y: pairs[2].dst.Y };
        const s = solve(pairs, 'sim');
        assert.ok(s.residuals[2].d < 3 * s.sigma0, '全部の組で求めた残差と 3σ₀ を比べるだけでは見つからない');
        const P = JSON.stringify(pairs);
        assert.deepEqual(app.val(`${P}.map((_, i) => helmLeaveOneOut(${P}, 'sim', i).flag)`), [false, false, true, false, false, false]);
        assert.deepEqual(app.val(`${P}.map((_, i) => helmLeaveOneOut(${P}, 'rigid', i).flag)`), [false, false, true, false, false, false]);
        // 除くと自由度が無いとき（縮尺ありで3組）は判定しない
        assert.equal(app.val(`helmLeaveOneOut(${JSON.stringify(pairs.slice(0, 3))}, 'sim', 0)`), null);
    });

    it('外挿: 張り合わせ点で囲んだ範囲の外の点を知らせる。点の精度の目安は、重心から離れるほど大きい', () => {
        const pairs = [0, 1, 2, 3].map((i) => ({ src: SRC[i], dst: noisy(i) }));
        const s = JSON.stringify(solve(pairs, 'sim'));
        const ex = (X, Y) => app.eval(`helmIsExtrapolated(${s}, ${X}, ${Y})`);
        assert.equal(ex(25, 40), false); assert.equal(ex(50, 80), false);
        assert.equal(ex(51, 40), false, '張り合わせ点の広がりの 5% までの外側は内とみなす');
        assert.equal(ex(150, 150), true); assert.equal(ex(60, 40), true); assert.equal(ex(-10, 40), true);
        const sg = (X, Y) => app.eval(`helmPointSigma(${s}, ${X}, ${Y})`);
        assert.ok(sg(25, 40) < sg(50, 80) && sg(50, 80) < sg(150, 150));
        // 2組（線分）のときは、線分から離れた点はすべて外
        const s2 = JSON.stringify(solve(pairs.slice(0, 2), 'rigid'));
        assert.equal(app.eval(`helmIsExtrapolated(${s2}, 25, 0)`), false);
        assert.equal(app.eval(`helmIsExtrapolated(${s2}, 25, 30)`), true);
    });
});

describe('ヘルマート変換: 画面', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand(); localStorage.removeItem('cad_survey_unit'); localStorage.removeItem('cad_helm_opts'); _helm.mode = 'sim';
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 1, rotation: 0 }; snapResult = null;
            _cogo.slots = {}; _cogo.vals = {}; _cogo.pick = null;
        `);
        // 図面の点（張り合わせる相手）: T1〜T4 を図面の座標で。関係の無い点も1つ
        app.set('window.__dst', [0, 1, 2, 3].map((i) => Object.assign({ num: String(i + 1), name: SRC[i].name }, noisy(i))).concat([{ num: '99', name: 'X9', X: TX + 500, Y: TY + 500 }]));
        app.eval(`addSurveyData(window.__dst, []); undoStack.length = 0; helmLoadSimaText(${JSON.stringify(SIMA)}, 'genba.sim');`);
    });
    const panelText = () => app.eval(`document.getElementById('property-panel-content').textContent`);
    const panelTitle = () => app.eval(`document.getElementById('property-panel').style.display === 'flex' ? document.getElementById('property-panel-title').textContent : ''`);
    const viewShown = () => app.eval(`document.getElementById('helm-view').style.display`) === 'flex';
    const collapsed = () => app.eval(`document.getElementById('helm-view').classList.contains('collapsed')`);
    const frames = () => new Promise((r) => app.window.requestAnimationFrame(() => app.window.requestAnimationFrame(() => r())));
    // 別窓の変換元の点 i をタップ
    const svTap = (i) => app.run(`const v = _helmView(), q = v.toScreen(${SRC[i].X}, ${SRC[i].Y}), cv = v.canvas;
        cv.dispatchEvent(new MouseEvent('pointerdown', { clientX: q.x, clientY: q.y, bubbles: true }));
        cv.dispatchEvent(new MouseEvent('pointerup', { clientX: q.x, clientY: q.y, bubbles: true }));`);
    // 図面の張り合わせ点 i に吸い付けて ☑確定
    const pickDrawing = (i) => { const d = noisy(i); app.run(`const w = surveyToWcs(${d.X}, ${d.Y}); snapResult = { wcsX: w.x, wcsY: w.y, type: '点' }; handlePointInput({ x: w.x, y: w.y }, false);`); };
    // 別窓で範囲を囲む（corners: 変換元の座標の頂点。四角は対角の2点）
    const drag = (kind, corners) => app.run(`helmSetRange('${kind}'); const v = _helmView(), cv = v.canvas;
        const pts = ${JSON.stringify(corners)}.map(([X, Y]) => v.toScreen(X, Y));
        const ev = (type, p) => cv.dispatchEvent(new MouseEvent(type, { clientX: p.x, clientY: p.y, bubbles: true }));
        ev('pointerdown', pts[0]); pts.slice(1).forEach((p) => ev('pointermove', p)); ev('pointerup', pts[pts.length - 1]);`);
    // パネルの要素のインラインの処理（onclick・onchange）を実行する（jsdom の設定ではインラインの処理が動かないため）
    const inline = (sel, attr, prep = '') => app.run(`const el = document.querySelector(${JSON.stringify(sel)}); ${prep}
        (new Function('event', el.getAttribute('${attr}'))).call(el, { stopPropagation() {}, target: el });`);
    const readBlob = (how) => app.eval(`new Promise(r => { const fr = new FileReader(); fr.onload = () => r(${how === 'bytes' ? 'Array.from(new Uint8Array(fr.result))' : 'fr.result'}); fr.${how === 'bytes' ? 'readAsArrayBuffer' : 'readAsText'}(window.__blob); })`);
    const capture = (call) => app.eval(`window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; }; try { ${call}; } finally { downloadBlob = window.__dl; }`);

    it('SIMA を読むと「変換」タブと別窓が開く。コマンド HELMERT でも開く。読む前は案内を出す', () => {
        assert.equal(panelTitle(), '🧮 測量計算');
        assert.equal(app.eval('_cogo.tab'), 'helm');
        assert.equal(viewShown(), true);
        assert.match(app.eval(`document.querySelector('#helm-view .subview-title').textContent`), /genba\.sim/);
        assert.match(panelText(), /genba\.sim（点 9・区画 2）/);
        assert.match(panelText(), /2組以上で計算/);
        app.eval(`hidePropertyPanel(); issueCommand('HELMERT')`);
        assert.equal(panelTitle(), '🧮 測量計算'); assert.equal(app.eval('_cogo.tab'), 'helm');
        app.eval(`_helm.src = null; showCogoPanel('helm')`);
        assert.match(panelText(), /SIMA を読み込む/); assert.match(panelText(), /張り合わせ点を2組以上/);
    });

    it('張り合わせ: 別窓の点をタップ → 図面で同じ点を ☑確定 で組になる。点名が同じ点も組にできる。指定し直し・使う・消す', () => {
        svTap(0);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT');
        assert.equal(app.eval('_helm.sel'), 0);
        pickDrawing(0);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.deepEqual(app.val('_helm.pairs.map(p => [p.si, p.dst.name])'), [[0, 'T1']]);
        assert.equal(panelTitle(), '🧮 測量計算');
        assert.match(panelText(), /あと 1組 指定すると計算します/);
        svTap(2); pickDrawing(2);
        assert.deepEqual(app.val('_helm.pairs.map(p => [p.si, p.dst.name])'), [[0, 'T1'], [2, 'T3']]);
        assert.match(panelText(), /確かめられません（2組）/);
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /組 No\.2: SIMA「T3」↔ 図面「T3」/);
        // 点名が同じ点をまとめて組にする（組にした点・関係の無い点は除く）
        app.eval('helmPairByName()');
        assert.deepEqual(app.val('_helm.pairs.map(p => [p.si, p.dst.name])'), [[0, 'T1'], [2, 'T3'], [1, 'T2'], [3, 'T4']]);
        const t = panelText();
        assert.match(t, /標準偏差 σ₀/); assert.match(t, /4組・自由度 4/); assert.match(t, /右回り 30°|右回り 29°59′/); assert.match(t, /1\.0002/);
        assert.ok(Math.abs(app.val('_helm.sol.rot') - TH) < 1e-4 && Math.abs(app.val('_helm.sol.scale') - SC) < 1e-4);
        // 同じ点を指定し直すと、同じ番号のまま入れ替わる
        svTap(2); pickDrawing(2);
        assert.equal(app.val('_helm.pairs.length'), 4); assert.equal(app.val('_helm.pairs[1].si'), 2);
        // 使う・消す
        app.eval('helmUsePair(3, false)');
        assert.equal(app.val('_helm.sol.n'), 3);
        assert.match(panelText(), /計算に使う 3 \/ 4組/);
        app.eval('helmDeletePair(3)');
        assert.equal(app.val('_helm.pairs.length'), 3);
        // 重ね表示・別窓の描画がエラーにならない
        app.eval('render(); _helmView().drawNow()');
        assert.deepEqual(app.errors(), []);
    });

    it('ほかの組と合わない組（点の取り違え）は、表で黄色にして知らせる。「使う」を外すと、その組を除いて計算し直す', () => {
        app.eval('helmPairByName()');
        app.eval(`_helm.pairs.find(p => p.si === 2).dst.X += 0.25; _helmChanged();`); // T3 の相手が 25cm ずれている
        assert.deepEqual(app.val('_helm.pairs.filter(p => p.res.flag).map(p => p.si)'), [2]);
        assert.match(panelText(), /No\.3 は、ほかの組と合っていません/);
        assert.equal(app.eval(`document.querySelectorAll('#property-panel-content tr.helm-flag').length`), 1);
        const k = app.val('_helm.pairs.findIndex(p => p.si === 2)');
        app.eval(`helmUsePair(${k}, false)`);
        assert.equal(app.val('_helm.sol.n'), 3);
        assert.ok(app.val('_helm.sol.sigma0') < 0.003, '外した組を除くと、ばらつきは小さい');
        assert.doesNotMatch(panelText(), /ほかの組と合っていません/);
        assert.equal(app.val(`_helm.pairs[${k}].res.flag`), true, '外した組は、今の変換と比べても合わない');
    });

    it('縮尺の選び方（1/1・縮尺も求める）を覚える', () => {
        app.eval(`helmPairByName(); helmSetMode('rigid')`);
        assert.equal(app.eval(`JSON.parse(localStorage.getItem('cad_helm_opts')).mode`), 'rigid');
        assert.equal(app.val('_helm.sol.mode'), 'rigid'); assert.ok(near(app.val('_helm.sol.scale'), 1, 1e-12));
        assert.match(panelText(), /1（そのまま）/);
        app.eval(`helmSetMode('sim')`);
        assert.equal(app.eval(`JSON.parse(localStorage.getItem('cad_helm_opts')).mode`), 'sim');
    });

    it('範囲: 別窓で四角に囲んだ点だけを、新しい画層に取り込む（区画は構成点がすべて中のもの）。元の点はそのまま・元に戻す', () => {
        app.eval('helmPairByName()'); // T1〜T4
        drag('rect', [[10, -10], [60, 50]]); // T2・K1〜K4 が中
        assert.equal(app.val('_helm.range.kind'), 'rect');
        assert.deepEqual(app.val('_helmRangeIndices()'), [1, 4, 5, 6, 7]);
        assert.match(panelText(), /取り込む点 5 \/ 9（別窓の水色の枠/);
        const pts = () => app.val(`entities.filter(e => e.type === 'POINT' && !/^変換_/.test(layers[e.layer].name)).map(e => [e.name, e.x, e.y, e.layer])`);
        const before = pts();
        assert.equal(app.eval('helmImport()'), true);
        const L = app.eval(`layers.findIndex(l => l.name === '変換_genba')`);
        assert.ok(L >= 0);
        const onL = app.val(`entities.filter(e => e.layer === ${L}).map(e => e.type)`);
        assert.equal(onL.filter((t) => t === 'POINT').length, 5);
        assert.equal(onL.filter((t) => t === 'PLINE').length, 1, '区画 1-1 だけ（1-2 は T1・F1 が範囲の外）');
        assert.equal(onL.length, 12, '点・点名・区画・区画名がすべて同じ画層');
        const k1 = app.val(`entities.find(e => e.layer === ${L} && e.type === 'POINT' && e.name === 'K1')`), e = fwd(SRC[4]);
        assert.ok(near(k1.y, e.X, 0.005) && near(k1.x, e.Y, 0.005), JSON.stringify(k1)); // 図面の y が北（X）
        assert.equal(k1.num, '5');
        assert.deepEqual(pts(), before, '元の点はそのまま');
        assert.match(panelText(), /取り込み済み: 画層「変換_genba」/);
        app.eval('helmImport()'); // もう一度取り込むと、別の画層に
        assert.ok(app.eval(`layers.some(l => l.name === '変換_genba(2)')`));
        app.eval('undo(); undo()');
        assert.equal(app.eval(`entities.filter(e => /^変換_/.test((layers[e.layer] || {}).name || '')).length`), 0);
        assert.deepEqual(pts(), before);
    });

    it('SIMA の点の表: ☑ で取り込む点を1点ずつ選ぶ（四角で囲んだあとも直せる）・絞り込んでまとめて選ぶ／外す', () => {
        app.eval('helmPairByName()');
        const rows = () => app.val(`[...document.querySelectorAll('#helm-src-list tbody tr')].map(tr => +tr.dataset.i)`);
        const box = (i) => app.eval(`document.querySelector('#helm-src-list tr[data-i="${i}"] input[type=checkbox]').checked`);
        const rangeActive = () => app.eval(`document.querySelectorAll('#property-panel-content button.active[onclick^="helmSetRange"]').length`);
        assert.deepEqual(rows(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
        assert.ok(rows().every(box), '最初は全部を取り込む');
        drag('rect', [[10, -10], [60, 50]]); // T2・K1〜K4
        assert.equal(box(7), true); assert.equal(box(0), false);
        // 表で K4 を外す
        inline('#helm-src-list tr[data-i="7"] input[type=checkbox]', 'onchange', 'el.checked = false;');
        assert.deepEqual(app.val('_helmRangeIndices()'), [1, 4, 5, 6]);
        assert.equal(app.val('_helm.range.kind'), 'pick');
        assert.match(panelText(), /取り込む点 4 \/ 9（表で選んだ点）/);
        assert.equal(rangeActive(), 0, '範囲のボタンはどれも押していない形');
        assert.equal(app.val('_helmRangeLots().length'), 0, '区画 1-1 は K4 が外れたので入らない');
        // 絞り込み（点名・点番号の一部。大文字小文字は区別しない）→ 表に出ている点をまとめて選ぶ・外す
        app.eval(`helmFilter('k')`);
        assert.deepEqual(rows(), [4, 5, 6, 7]);
        app.eval('helmTakeShown(true)');
        assert.deepEqual(app.val('_helmRangeIndices()'), [1, 4, 5, 6, 7]);
        assert.deepEqual(rows(), [4, 5, 6, 7], '選び直しても絞り込みはそのまま');
        app.eval('helmTakeShown(false)');
        assert.deepEqual(app.val('_helmRangeIndices()'), [1]);
        app.eval(`helmFilter('9')`); // 点番号でも
        assert.deepEqual(rows(), [8]);
        // 全部を選び直すと「全部」に戻る
        app.eval(`helmFilter(''); helmTakeShown(true)`);
        assert.equal(app.val('_helm.take'), null); assert.equal(app.val('_helm.range'), null);
        assert.equal(rangeActive(), 1);
        app.eval(`helmFilter('zzz')`);
        assert.match(app.eval(`document.getElementById('helm-src-list').textContent`), /当てはまる点がありません/);
    });

    it('SIMA の点の表: 📍 で張り合わせ点にする（図面で ☑確定）と表に組の番号が出る。行をタップすると別窓の真ん中に示す。開いた状態を覚える', () => {
        app.eval(`helmTableToggle(true); _helmRerender();`);
        assert.equal(app.eval(`document.querySelector('#property-panel-content details.helm-src').open`), true);
        assert.equal(app.eval(`JSON.parse(localStorage.getItem('cad_helm_opts')).table`), true);
        inline('#helm-src-list tr[data-i="3"] .helm-pin', 'onclick');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT');
        assert.equal(app.eval('_helm.sel'), 3);
        assert.equal(app.eval('_helm.focus'), -1, '📍 は行のタップ（示す）にならない');
        pickDrawing(3);
        assert.deepEqual(app.val('_helm.pairs.map(p => [p.si, p.dst.name])'), [[3, 'T4']]);
        assert.equal(app.eval(`document.querySelector('#helm-src-list tr[data-i="3"] .helm-no').textContent`), '1');
        // 行をタップ → 別窓の真ん中にその点（F1）
        inline('#helm-src-list tr[data-i="8"]', 'onclick');
        assert.equal(app.eval('_helm.focus'), 8);
        assert.equal(app.eval(`document.querySelector('#helm-src-list tr[data-i="8"]').classList.contains('helm-focus')`), true);
        const c = app.val(`(() => { const v = _helmView(), q = v.toScreen(150, 150); return [q.x, q.y, v.canvas.width / 2, v.canvas.height / 2]; })()`);
        assert.ok(near(c[0], c[2]) && near(c[1], c[3]), JSON.stringify(c));
        // チェックを外す（示す点はそのまま）
        inline('#helm-src-list tr[data-i="0"] input[type=checkbox]', 'onchange', 'el.checked = false;');
        assert.equal(app.eval('_helm.focus'), 8); assert.equal(app.val('_helmRangeIndices()').includes(0), false);
        assert.equal(app.eval(`document.querySelector('#helm-src-list tr[data-i="8"]').classList.contains('helm-focus')`), true, '描き直しても示している行は同じ');
        app.eval(`helmTableToggle(false)`);
        assert.equal(app.eval(`JSON.parse(localStorage.getItem('cad_helm_opts')).table`), false);
        app.eval('render(); _helmView().drawNow()');
        assert.deepEqual(app.errors(), []);
    });

    it('範囲: なぞって囲む・「全部」に戻す・囲む途中でやめる', () => {
        drag('lasso', [[15, 25], [35, 25], [35, 50], [15, 50]]);
        assert.equal(app.val('_helm.range.kind'), 'lasso');
        assert.deepEqual(app.val('_helmRangeIndices()'), [4, 5, 6, 7]);
        app.eval(`helmSetRange('all')`);
        assert.equal(app.val('_helm.range'), null);
        assert.equal(app.val('_helmRangeIndices().length'), 9);
        app.eval(`helmSetRange('rect')`);
        assert.equal(app.eval('_helmView().shaping'), true);
        assert.match(panelText(), /ドラッグして四角に囲んで/);
        app.eval(`helmSetRange('all')`);
        assert.equal(app.eval('_helmView().shaping'), false);
        // 小さすぎる形（タップだけ）は囲まなかったことにする
        drag('rect', [[20, 30], [20.001, 30.001]]);
        assert.equal(app.val('_helm.range'), null);
    });

    it('変換後の SIMA（Shift-JIS・範囲の中の点と区画）・結果の CSV・結果の表', async () => {
        app.eval('helmPairByName()');
        drag('rect', [[10, -10], [60, 50]]);
        capture('helmExportSima()');
        assert.equal(app.eval('window.__name'), 'genba_変換.sim');
        const sima = new util.TextDecoder('shift_jis').decode(Uint8Array.from(await readBlob('bytes')));
        const lines = sima.split('\r\n');
        assert.equal(lines[0], 'G00,01,GENBA_変換,');
        assert.deepEqual(lines.filter((l) => l.startsWith('A01,')).map((l) => l.split(',').slice(1, 3).join(',')), ['2,T2', '5,K1', '6,K2', '7,K3', '8,K4']);
        const k1 = lines.find((l) => l.startsWith('A01,5,K1,')).split(','), e = fwd(SRC[4]);
        assert.ok(near(+k1[3], e.X, 0.005) && near(+k1[4], e.Y, 0.005), k1.join());
        assert.deepEqual(lines.filter((l) => l.startsWith('D00,')), ['D00,1,1-1,1,']);
        const back = app.val(`parseSima(${JSON.stringify(sima)})`);
        assert.equal(back.points.length, 5); assert.equal(back.lots.length, 1);
        // 結果の CSV
        capture('helmExportCsv()');
        assert.equal(app.eval('window.__name'), 'genba_変換結果.csv');
        const csv = await readBlob('text');
        assert.match(csv, /ヘルマート変換の結果/); assert.match(csv, /縮尺も求める/); assert.match(csv, /標準偏差 σ0（mm）,\d+\.\d/);
        const rows = csv.split('\r\n');
        assert.equal(rows.filter((r) => /^[1-4],T[1-4],T[1-4],/.test(r)).length, 4, '張り合わせ点 4組');
        assert.equal(rows.filter((r) => /^[25678],(T2|K[1-4]),-?\d+\.\d{3},/.test(r)).length, 5, '範囲の中の点 5点');
        // 範囲が無ければ、遠い点 F1 は外挿の印
        app.eval(`helmSetRange('all')`);
        capture('helmExportCsv()');
        const f1 = (await readBlob('text')).split('\r\n').find((r) => r.startsWith('9,F1,'));
        assert.ok(f1 && f1.endsWith(',○'), f1);
        // 結果の表を図面に置く（元に戻すは1回）
        const n0 = app.eval('entities.length');
        app.eval('helmPlaceTable()');
        const tbl = app.val(`entities.filter(e => e.blockName === 'ヘルマート変換').map(e => [e.type, e.text || '', layers[e.layer].name])`);
        assert.ok(tbl.length > 20, String(tbl.length));
        assert.ok(tbl.every((t) => t[2] === '変換結果表'));
        assert.ok(tbl.some((t) => /^ヘルマート変換（縮尺あり）/.test(t[1]))); assert.ok(tbl.some((t) => t[1] === '標準偏差 σ₀'));
        app.eval('undo()');
        assert.equal(app.eval('entities.length'), n0);
    });

    it('TS で受信した SIMA を「🧮 変換して取り込む」で変換元にし、変換後の点を機械へ送る（座標だけ）', async () => {
        app.eval(`_ts.pending = _tsSimaResult(${JSON.stringify(SIMA)}); showTsPanel(); _tsUpdateResult();`);
        assert.ok(app.eval(`[...document.querySelectorAll('#ts-result button')].some(b => /変換して取り込む/.test(b.textContent))`));
        assert.equal(app.eval('helmFromTs()'), true);
        assert.equal(app.eval('_helm.src.name'), 'GENBA');
        assert.equal(app.eval('_helm.src.points.length'), 9); assert.equal(app.eval('_helm.src.lots.length'), 2);
        assert.equal(app.eval('_ts.pending'), null);
        assert.equal(panelTitle(), '🧮 測量計算');
        app.eval('helmPairByName()');
        // 模擬のポートにつないで送る
        const sent = [];
        const port = { readable: new ReadableStream({ start() {} }), writable: new WritableStream({ write(chunk) { sent.push(...chunk); } }),
            open: async () => {}, close: async () => {}, addEventListener: () => {} };
        Object.defineProperty(app.window.navigator, 'serial', { value: { requestPort: async () => port }, configurable: true });
        try {
            await app.eval('tsConnect()');
            app.eval(`TS_TIMING.lineGap = 0; showCogoPanel('helm')`);
            assert.match(panelText(), /機械へ送る/);
            assert.equal(await app.eval('helmSendSima()'), true);
            const text = new util.TextDecoder('shift_jis').decode(Uint8Array.from(sent));
            assert.equal((text.match(/^A01,/gm) || []).length, 9);
            assert.doesNotMatch(text, /D00,/, '機械の既知点へは座標だけ');
            assert.match(text, /^G00,01,GENBA_変換,/);
        } finally {
            await app.eval('tsDisconnect()');
            delete app.window.navigator.serial;
            app.eval('TS_TIMING.lineGap = 30');
        }
    });

    it('別窓は「変換」タブのあいだだけ出る（別のタブ・パネルを閉じると隠れる）。✕ で閉じたら「🗺 別窓を開く」まで出さない', async () => {
        assert.equal(viewShown(), true);
        app.eval(`cogoSetTab('inv')`); await frames(); assert.equal(viewShown(), false);
        app.eval(`cogoSetTab('helm')`); await frames(); assert.equal(viewShown(), true);
        app.eval(`hidePropertyPanel()`); await frames(); assert.equal(viewShown(), false);
        app.eval(`showCogoPanel('helm')`); await frames(); assert.equal(viewShown(), true);
        app.eval(`document.querySelector('#helm-view .subview-btn[data-act="close"]').click()`);
        assert.equal(viewShown(), false);
        app.eval(`cogoSetTab('inv'); cogoSetTab('helm')`); await frames(); assert.equal(viewShown(), false);
        app.eval(`helmOpenView()`); assert.equal(viewShown(), true);
        // ▁ でたたむ・広げる
        app.eval(`document.querySelector('#helm-view .subview-btn[data-act="fold"]').click()`); assert.equal(collapsed(), true);
        app.eval(`document.querySelector('#helm-view .subview-btn[data-act="fold"]').click()`); assert.equal(collapsed(), false);
    });

    it('スマホの幅: 図面の点を指定するあいだは別窓をたたんで下に寄せ、☑確定・❌終了で元の場所に戻す', async () => {
        const w0 = app.window.innerWidth;
        const top = () => app.eval(`document.getElementById('helm-view').style.top`);
        Object.defineProperty(app.window, 'innerWidth', { value: 390, configurable: true });
        try {
            const top0 = top();
            svTap(1);
            assert.equal(collapsed(), true);
            assert.equal(top(), `${app.window.innerHeight - 120 - 34}px`, 'たたんだ窓は画面の下（☑確定 の帯より上）');
            assert.equal(app.eval(`document.getElementById('property-panel').style.display`), 'none', '図面が見えるようにパネルを隠す');
            await frames();
            assert.equal(viewShown(), true, '指定のあいだも（たたんで）出ている');
            pickDrawing(1);
            assert.equal(collapsed(), false);
            assert.equal(top(), top0, '広げると元の場所');
            assert.equal(panelTitle(), '🧮 測量計算');
            assert.equal(app.val('_helm.pairs.length'), 1);
            // ❌終了でやめると、選んだ点も外す
            svTap(3); app.eval(`issueCommand('CANCEL')`);
            assert.equal(app.eval('cmdState.mode'), 'IDLE');
            assert.equal(app.eval('_helm.sel'), -1);
            assert.equal(collapsed(), false);
            assert.equal(panelTitle(), '🧮 測量計算');
            assert.equal(app.val('_helm.pairs.length'), 1);
        } finally { Object.defineProperty(app.window, 'innerWidth', { value: w0, configurable: true }); }
        assert.deepEqual(app.errors(), []);
    });
});
