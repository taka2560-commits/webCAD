'use strict';
// 図形の張り合わせ（cad-align.js。コマンド HALIGN・ALIGN・AL。v5.59）:
//   図面の中の図形を、点の組（動かす側の点 → 合わせる先の点）から求めた回転・移動（・縮尺）で動かす。
//   ・計算は、アプリとは別の式（図面の座標を複素数にした最小二乗）で求めた値と照らし合わせる（m・mm の図面、公共座標の大きさ）
//   ・選び方は鏡像・尺度変更と同じ（選んでから始める・タップ・範囲選択）
//   ・張り合わせ点は SIMA の変換と同じ別窓の方式（別窓で動かす側の点をタップ → 図面で合わせる先の点を ☑確定）
//   ・別窓のタップは、動かす図形に吸い付く（端点・中点・交点・中心・四半円点・線の上。図面のスナップと同じ計算。v5.59.1）
//   ・組の入れ替え・使う／外す・点名で組にする・鏡像の知らせ・合わない組の知らせ・確かめの画面・全体表示・↩ 1回で戻る
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

// ---- 照らし合わせる側の計算（アプリの式は使わない）: 図面の座標 z = x + iy で w ≒ α(z − zc) + wc ----
function oracle(pairs, mode) {
    const n = pairs.length;
    let zx = 0, zy = 0, wx = 0, wy = 0;
    pairs.forEach((p) => { zx += p.src.x; zy += p.src.y; wx += p.dst.x; wy += p.dst.y; });
    zx /= n; zy /= n; wx /= n; wy /= n;
    let re = 0, im = 0, den = 0;
    pairs.forEach((p) => {
        const a = p.src.x - zx, b = p.src.y - zy, c = p.dst.x - wx, d = p.dst.y - wy;
        re += a * c + b * d; im += a * d - b * c; den += a * a + b * b; // conj(z)·w
    });
    let ar = re / den, ai = im / den;
    if (mode === 'rigid') { const m = Math.hypot(ar, ai); ar /= m; ai /= m; }
    const map = (x, y) => { const a = x - zx, b = y - zy; return { x: wx + ar * a - ai * b, y: wy + ai * a + ar * b }; };
    return { map, scale: Math.hypot(ar, ai), ccw: Math.atan2(ai, ar) };
}
const rot = (p, th, k, t) => ({ x: t.x + k * (Math.cos(th) * p.x - Math.sin(th) * p.y), y: t.y + k * (Math.sin(th) * p.x + Math.cos(th) * p.y) });

describe('図形の張り合わせ（HALIGN）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`alignReset(); resetCommand(); closePropertyPanel(); hideSnack(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0; initLayers();
            view.x = 400; view.y = 300; view.scale = 1; view.rotation = 0; ucs.originX = 0; ucs.originY = 0; ucs.angle = 0; orthoMode = false;
            localStorage.setItem('cad_survey_unit', 'm'); window.groupSelectEnabled = true; window.innerWidth = 1024;
            localStorage.removeItem('webcad_last_params'); lastParams = Object.assign({}, DEFAULT_LAST_PARAMS);`);
    });
    const compute = (pairs, mode) => app.val(`(() => { const c = alignCompute(${JSON.stringify(pairs)}, '${mode}');
        return { ok: !!(c.sol && c.sol.ok), err: c.sol && c.sol.error, rot: c.sol && c.sol.rot, scale: c.sol && c.sol.scale, sigma0: c.sol && c.sol.sigma0, dof: c.sol && c.sol.dof, n: c.sol && c.sol.n,
            rows: c.rows.map(r => r && { d: r.d, flag: r.flag }), mirror: c.mirror, nUse: c.nUse, k: c.T && c.T.k,
            map: c.T ? ${JSON.stringify([[0, 0], [1, 0], [0, 1], [123.456, -78.9], [-5000, 9000]])}.map(([x, y]) => editXformPoint(c.T, x, y)) : null }; })()`);
    const CHECK = [[0, 0], [1, 0], [0, 1], [123.456, -78.9], [-5000, 9000]];
    const toast = () => app.val(`document.getElementById('cad-toast') ? document.getElementById('cad-toast').textContent : ''`);
    const panel = () => app.val(`document.getElementById('property-panel').style.display === 'flex' ? document.getElementById('property-panel').textContent : ''`);
    const pt = (x, y) => app.eval(`handlePointInput({ x: ${x}, y: ${y} }, true)`);

    // ===== 計算（別の式と照らし合わせる） =====
    for (const unit of ['m', 'mm']) {
        it(`計算（図面の単位 ${unit}）: 回転・移動だけのぴったり合う組は、較差 0・縮尺 1。動かした先が別の式と同じ`, () => {
            app.eval(`localStorage.setItem('cad_survey_unit', '${unit}')`);
            const f = unit === 'mm' ? 1000 : 1, th = 0.4321, t = { x: 23470.5 * f, y: -112360.25 * f };
            const src = [{ x: 0, y: 0 }, { x: 40 * f, y: 0 }, { x: 40 * f, y: 25 * f }, { x: -3 * f, y: 31 * f }];
            const pairs = src.map((p) => ({ src: p, dst: rot(p, th, 1, t), use: true }));
            const r = compute(pairs, 'rigid');
            assert.equal(r.ok, true);
            assert.ok(near(r.scale, 1, 1e-12) && near(r.k, 1, 1e-12));
            assert.ok(near(r.rot, -th, 1e-10), `回転は右回りが正: ${r.rot}`);
            r.rows.forEach((row) => assert.ok(row.d < 1e-7, `較差 ${row.d}`)); // m。公共座標の大きさでも 0.1µm より小さい
            assert.ok(r.sigma0 < 1e-7);
            CHECK.forEach(([x, y], i) => { const e = rot({ x: x * f, y: y * f }, th, 1, t), g = app.val(`(() => { const c = alignCompute(${JSON.stringify(pairs)}, 'rigid'); return editXformPoint(c.T, ${x * f}, ${y * f}); })()`);
                assert.ok(near(g.x, e.x, 1e-6 * f) && near(g.y, e.y, 1e-6 * f), `点 ${i}: ${g.x},${g.y} ≠ ${e.x},${e.y}`); });
        });

        it(`計算（図面の単位 ${unit}）: ばらつきのある4組。動かした先・較差・標準偏差が、別の式（複素数の最小二乗）と同じ。1/1 と 縮尺も求める`, () => {
            app.eval(`localStorage.setItem('cad_survey_unit', '${unit}')`);
            const f = unit === 'mm' ? 1000 : 1, th = -1.234, k0 = 1.0375, t = { x: -45210.123 * f, y: 98765.4 * f };
            const src = [{ x: 10, y: 5 }, { x: 62, y: 8 }, { x: 55, y: 47 }, { x: 4, y: 39 }].map((p) => ({ x: p.x * f, y: p.y * f }));
            const noise = [[0.004, -0.003], [-0.006, 0.002], [0.001, 0.005], [0.003, -0.004]]; // m
            const pairs = src.map((p, i) => { const q = rot(p, th, k0, t); return { src: p, dst: { x: q.x + noise[i][0] * f, y: q.y + noise[i][1] * f }, use: true }; });
            for (const mode of ['rigid', 'sim']) {
                const r = compute(pairs, mode), o = oracle(pairs, mode);
                assert.equal(r.ok, true);
                assert.ok(near(r.scale, o.scale, 1e-10), `縮尺 ${r.scale} ≠ ${o.scale}`);
                assert.ok(near(r.k, o.scale, 1e-10));
                assert.ok(near(r.rot, -o.ccw, 1e-10), `回転 ${r.rot} ≠ ${-o.ccw}`);
                CHECK.forEach(([x, y], i) => { const e = o.map(x, y); assert.ok(near(r.map[i].x, e.x, 1e-6 * f) && near(r.map[i].y, e.y, 1e-6 * f), `${mode} 点 ${i}: ${JSON.stringify(r.map[i])} ≠ ${JSON.stringify(e)}`); });
                let ss = 0;
                pairs.forEach((p, i) => { const e = o.map(p.src.x, p.src.y), d = Math.hypot(e.x - p.dst.x, e.y - p.dst.y) / f; ss += d * d;
                    assert.ok(near(r.rows[i].d, d, 1e-7), `${mode} 較差 ${i}: ${r.rows[i].d} ≠ ${d}`); });
                const dof = 2 * 4 - (mode === 'rigid' ? 3 : 4);
                assert.equal(r.dof, dof);
                assert.ok(near(r.sigma0, Math.sqrt(ss / dof), 1e-7), `${mode} σ₀ ${r.sigma0}`);
            }
            // 縮尺も求める: 元の縮尺に近い。1/1: 縮尺は 1 のまま（較差が大きくなる）
            assert.ok(near(compute(pairs, 'sim').scale, k0, 1e-3));
            assert.equal(compute(pairs, 'rigid').scale, 1);
            assert.ok(compute(pairs, 'rigid').sigma0 > compute(pairs, 'sim').sigma0 * 10);
        });
    }

    it('計算: 2組。縮尺も求めるときは、ちょうど合わせるだけ（精度は確かめられない）。1/1 は、2点の間の長さの違いが標準偏差に出る。1組・同じ点では計算しない', () => {
        const two = [{ src: { x: 0, y: 0 }, dst: { x: 100, y: 50 }, use: true }, { src: { x: 10, y: 0 }, dst: { x: 100, y: 60 }, use: true }];
        const r = compute(two, 'rigid');
        assert.equal(r.ok, true); assert.equal(r.dof, 1); assert.ok(r.sigma0 < 1e-9, '長さが同じ（10 と 10）なので 0');
        assert.ok(near(r.map[1].x, 100, 1e-9) && near(r.map[1].y, 51, 1e-9)); // (1,0) は 90° 左へ回って (100, 51)
        assert.equal(compute(two, 'sim').sigma0, null);
        // 1/1 で長さが違う（10 → 10.02）: 回して重心を合わせると、両端で 1cm ずつ合わない
        const off = [two[0], { src: { x: 10, y: 0 }, dst: { x: 100, y: 60.02 }, use: true }], ro = compute(off, 'rigid');
        assert.ok(near(ro.rows[0].d, 0.01, 1e-9) && near(ro.rows[1].d, 0.01, 1e-9));
        assert.ok(near(ro.sigma0, Math.sqrt(2 * 0.01 * 0.01 / 1), 1e-9));
        assert.ok(near(compute(off, 'sim').scale, 1.002, 1e-12));
        assert.equal(compute(two.slice(0, 1), 'rigid').ok, false);
        assert.match(compute(two.slice(0, 1), 'rigid').err, /あと 1組/);
        assert.equal(compute([two[0], Object.assign({}, two[1], { use: false })], 'rigid').ok, false);
        assert.equal(compute([two[0], { src: { x: 0, y: 0 }, dst: { x: 5, y: 5 }, use: true }], 'rigid').ok, false, '動かす側が同じ点');
        // 使わない組の較差も出す（今の変換と比べる）
        const three = two.concat([{ src: { x: 0, y: 10 }, dst: { x: 500, y: 500 }, use: false }]);
        const r3 = compute(three, 'rigid');
        assert.equal(r3.nUse, 2);
        assert.ok(r3.rows[2].d > 400);
    });

    it('計算: 点を取り違えた組は「合っていない」と知らせる。裏返しの図形は「鏡像かもしれません」', () => {
        const th = 0.3, t = { x: 500, y: -200 };
        const src = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }, { x: 25, y: 60 }];
        const good = src.map((p) => ({ src: p, dst: rot(p, th, 1, t), use: true }));
        assert.deepEqual(compute(good, 'rigid').rows.map((r) => r.flag), [false, false, false, false, false]);
        assert.equal(compute(good, 'rigid').mirror, false);
        const bad = good.map((p, i) => (i === 2 ? { src: p.src, dst: { x: p.dst.x + 2.5, y: p.dst.y - 1.5 }, use: true } : p));
        const rb = compute(bad, 'rigid');
        assert.equal(rb.rows[2].flag, true);
        assert.equal(rb.rows.filter((r) => r.flag).length, 1);
        // 裏返し（x を反転）してから回して置いた形
        const mir = src.map((p) => ({ src: p, dst: rot({ x: -p.x, y: p.y }, th, 1, t), use: true }));
        assert.equal(compute(mir, 'rigid').mirror, true);
        assert.equal(compute(mir, 'sim').mirror, true);
        // 一直線の3点は、裏返しても同じなので知らせない
        const lin = [0, 10, 30].map((x) => ({ src: { x, y: 0 }, dst: rot({ x, y: 0 }, th, 1, t), use: true }));
        assert.equal(compute(lin, 'rigid').mirror, false);
    });

    // ===== 操作の流れ（別窓で動かす側の点 → 図面で合わせる先の点） =====
    const SHAPES = `entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 40, y2: 0 }, { type: 'LINE', layer: 0, color: null, x1: 40, y1: 0, x2: 40, y2: 25 },
        { type: 'CIRCLE', layer: 0, color: null, cx: 20, cy: 10, radius: 4 }, { type: 'TEXT', layer: 0, color: null, x: 5, y: 5, text: 'A', height: 2 },
        { type: 'LINE', layer: 0, color: null, x1: 1000, y1: 1000, x2: 1000, y2: 1040 }, { type: 'LINE', layer: 0, color: null, x1: 1000, y1: 1040, x2: 975, y2: 1040 });`;
    const start = (idx) => app.eval(SHAPES + `cmdState.selectedIndices = ${JSON.stringify(idx)}; processCommand('HALIGN');`);
    // 1組: 別窓で動かす側の点を選ぶ → 図面で合わせる先の点を決める（☑確定 のあとと同じ点の入力）
    const pair = (sx, sy, dx, dy) => { app.eval(`alignSelectSource({ x: ${sx}, y: ${sy} })`); pt(dx, dy); };
    const go = () => app.eval(`window.__cc = cadChoose; cadChoose = (o, cb) => { window.__dlg = o; cb('go'); }; try { alignApply(); } finally { cadChoose = window.__cc; }`);
    const viewOpen = () => app.val('!!_alignViewInst && _alignViewInst.isOpen()');
    const raf = () => new Promise((r) => setTimeout(r, 40));

    it('選び方は鏡像・尺度変更と同じ: 選んでから始める／タップ／範囲選択。写真のピンは外す。選ぶと別窓に出る', () => {
        app.eval(SHAPES + `entities.push({ type: 'PIN', layer: 0, x: 1, y: 1 }); cmdState.selectedIndices = [0, 1, 2, 3, 6]; processCommand('HALIGN');`);
        assert.equal(app.val('_align.on'), true);
        assert.deepEqual([...app.val('_alignTargets()')], [0, 1, 2, 3]);
        assert.equal(app.val('cmdState.mode'), 'IDLE', '図形を選び終えたら、選ぶ段階は終わる');
        assert.equal(app.val('cmdState.selectedIndices.length'), 0);
        assert.match(panel(), /別窓（動かす図形）で「動かす側の点」をタップ/);
        assert.equal(viewOpen(), true);
        assert.match(app.val(`_alignViewInst.el.querySelector('.subview-title').textContent`), /動かす図形（4個）/);
        // 選ばずに始める: 選ぶ段階（スナップしない・範囲選択できる）
        app.eval(`alignReset(); processCommand('AL');`);
        assert.equal(app.val('cmdState.mode'), 'WAITING_HALIGN_SELECT');
        assert.equal(app.val(`editIsPickMode(cmdState.mode) && editIsAreaSelectMode(cmdState.mode)`), true);
        assert.match(panel(), /動かす図形を選びます/);
        assert.equal(app.val('_align.on'), false);
        app.eval('editAreaSelect([0, 1, 6])');
        assert.deepEqual([...app.val('_alignTargets()')], [0, 1]);
        assert.equal(app.val('cmdState.mode'), 'IDLE');
        // タップ
        app.eval(`alignReset(); processCommand('ALIGN'); window.__hit = hitTestEntity; hitTestEntity = () => 2; try { handlePointInput({ x: 20, y: 10 }, true); } finally { hitTestEntity = window.__hit; }`);
        assert.deepEqual([...app.val('_alignTargets()')], [2]);
        // 選択バーなどから（issueCommand）: 1つだけタップで選んだ図形も引き継ぐ
        app.eval(`alignReset(); cmdState.highlightIdx = 1; issueCommand('HALIGN');`);
        assert.deepEqual([...app.val('_alignTargets()')], [1]);
    });

    it('別窓のタップ: 近くの点（端点・頂点・中心・測点）を拾う。遠ければ知らせる。拾ったら、図面で合わせる先の点を指定する段階になる', () => {
        start([0, 1, 2, 3]);
        const keys = app.val('_alignKeys().map(p => p.x + "," + p.y)');
        assert.deepEqual([...keys].sort(), ['0,0', '20,10', '40,0', '40,25', '5,5'], '重なった端点は1つ');
        const scr = app.val(`(() => { const s = wcsToSurvey(40, 25), q = _alignView().toScreen(s.X, s.Y); return [q.x, q.y]; })()`);
        app.eval(`_alignTapSource(${scr[0] + 400}, ${scr[1] + 400})`);
        assert.match(toast(), /図形の近くをタップしてください（端点・中点・交点・線の上などに吸い付きます/);
        assert.equal(app.val('_align.sel'), null);
        app.eval(`_alignTapSource(${scr[0] + 6}, ${scr[1] - 5})`);
        assert.deepEqual({ ...app.val('_align.sel') }, { x: 40, y: 25, t: '端点' });
        assert.equal(app.val('cogoIsPicking() && _cogo.pick.owner'), 'align');
        assert.match(app.val(`document.getElementById('command-prompt').textContent`), /合わせる先の点をなぞって ☑確定/);
        assert.doesNotThrow(() => app.eval('_alignViewInst.drawNow(); drawAlignOverlay();'));
        // ❌終了・Esc で指定をやめたら、選んだ点も外す
        app.eval(`processCommand('CANCEL')`);
        assert.equal(app.val('_align.sel'), null);
        assert.equal(app.val('_align.on'), true, '張り合わせは続く');
        assert.match(panel(), /張り合わせ点/);
    });

    it('2組を指定して動かす: 確かめの画面 → 図形が合わせる先にぴったり合う → 全体を表示。↩ 1回で戻る', () => {
        start([0, 1, 2, 3]);
        pair(0, 0, 1000, 1000);
        assert.equal(app.val('cmdState.mode'), 'IDLE');
        assert.match(panel(), /あと 1組/);
        assert.equal(app.val(`document.getElementById('align-go').disabled`), true);
        pair(40, 0, 1000, 1040);
        assert.equal(app.val('_align.pairs.length'), 2);
        assert.match(panel(), /回転.*左回り.*90/);
        assert.match(panel(), /標準偏差 σ₀0\.0 mm（2組・自由度 1）/);
        assert.match(app.val(`document.getElementById('align-go').textContent`), /動かす（4個）/);
        assert.doesNotThrow(() => app.eval('_alignViewInst.drawNow(); drawAlignOverlay();'));
        app.eval(`window.__ze = zoomExtents; window.__zoomed = 0; zoomExtents = (q) => { window.__zoomed++; window.__zq = q; };`);
        try { go(); } finally { app.eval('zoomExtents = window.__ze'); }
        assert.match(app.val('window.__dlg.message'), /張り合わせ点 2組から、図形 4個を合わせる先へ動かします[\s\S]*回転[\s\S]*↩ で戻せます/);
        assert.equal(app.val('window.__zoomed'), 1, '動かしたあと、全体を表示する');
        assert.equal(app.val('window.__zq'), true, '全体表示の知らせは出さない（「元に戻す」の知らせを残す）');
        assert.equal(app.val('undoStack.length'), 1);
        const e = app.val('entities.slice(0, 4)');
        assert.ok(near(e[0].x1, 1000, 1e-9) && near(e[0].y1, 1000, 1e-9) && near(e[0].x2, 1000, 1e-9) && near(e[0].y2, 1040, 1e-9));
        assert.ok(near(e[1].x2, 975, 1e-9) && near(e[1].y2, 1040, 1e-9), '2本目の端は、もとからある線の端と同じ所へ');
        assert.ok(near(e[2].cx, 990, 1e-9) && near(e[2].cy, 1020, 1e-9) && e[2].radius === 4);
        assert.ok(near(e[3].x, 995, 1e-9) && near(e[3].y, 1005, 1e-9) && near(e[3].rotation, Math.PI / 2, 1e-12) && e[3].height === 2);
        assert.equal(app.val('entities[4].x1'), 1000, '動かさない図形はそのまま');
        assert.match(app.val(`document.getElementById('cad-snack').textContent`), /張り合わせました/);
        assert.equal(app.val('_align.on'), false, '終わったら、張り合わせを閉じる');
        assert.equal(panel(), '');
        assert.equal(viewOpen(), false);
        app.eval('undo()');
        assert.deepEqual({ ...app.val('({ a: entities[0].x2, b: entities[2].cx, c: entities[3].rotation || 0 })') }, { a: 40, b: 20, c: 0 });
    });

    it('確かめの画面でやめたら、動かさない。元の図形を残す（複写して置く）。縮尺も求めると、円の半径・文字の高さも同じ倍率', () => {
        start([0, 2, 3]);
        app.eval(`alignSetKeep(true); alignSetMode('sim');`);
        pair(0, 0, 1000, 1000); pair(40, 0, 1000, 1080); // 40 → 80: 2倍
        assert.match(app.val(`document.getElementById('align-go').textContent`), /複写して置く（3個）/);
        assert.match(panel(), /2\.00000000/);
        assert.match(panel(), /文字・寸法の大きさも同じ倍率/);
        assert.match(panel(), /確かめられません（2組）/);
        app.eval(`window.__cc = cadChoose; cadChoose = (o, cb) => cb(null); try { alignApply(); } finally { cadChoose = window.__cc; }`);
        assert.equal(app.val('entities.length'), 6);
        assert.equal(app.val('undoStack.length'), 0);
        assert.equal(app.val('_align.on'), true);
        go();
        assert.match(app.val('window.__dlg.message'), /複写して、合わせる先に置きます[\s\S]*縮尺 2\.000000/);
        assert.equal(app.val('entities.length'), 9);
        assert.equal(app.val('entities[0].x2'), 40, '元の図形はそのまま');
        const c = app.val('entities.slice(6)');
        assert.ok(near(c[0].x2, 1000, 1e-9) && near(c[0].y2, 1080, 1e-9));
        assert.ok(near(c[1].radius, 8, 1e-12) && near(c[1].cx, 980, 1e-9) && near(c[1].cy, 1040, 1e-9));
        assert.ok(near(c[2].height, 4, 1e-12));
        assert.equal(app.val('undoStack.length'), 1);
        assert.equal(app.val(`lastParams.alignKeep === true && lastParams.alignMode === 'sim'`), true, '設定は覚えておく');
    });

    it('組の直し: 同じ「動かす側の点」を指定し直すと入れ替える。表の「使う」・✕。使う組が2つ無ければ動かせない', () => {
        start([0, 1]);
        pair(0, 0, 999, 999); pair(40, 0, 1000, 1040); pair(40, 25, 975, 1040);
        assert.equal(app.val('_align.pairs.length'), 3);
        pair(0, 0, 1000, 1000); // No.1 を指定し直す
        assert.equal(app.val('_align.pairs.length'), 3);
        assert.deepEqual({ ...app.val('({ x: _align.pairs[0].dst.x, y: _align.pairs[0].dst.y })') }, { x: 1000, y: 1000 });
        assert.match(panel(), /標準偏差 σ₀0\.0 mm（3組・自由度 3）/);
        assert.equal(app.val(`document.querySelectorAll('.cogo-table tbody tr').length`), 3);
        assert.equal(app.val('undoStack.length'), 0, '図面の ↩ の履歴には触らない');
        app.eval('alignUsePair(2, false)');
        assert.match(panel(), /計算に使う 2 \/ 3組/);
        app.eval('alignUsePair(0, false)');
        assert.equal(app.val(`document.getElementById('align-go').disabled`), true);
        assert.equal(app.val('alignApply()'), false);
        assert.equal(app.val('undoStack.length'), 0);
        app.eval('alignDeletePair(0)');
        assert.equal(app.val('_align.pairs.length'), 2);
        app.eval('alignCancel()');
        assert.equal(app.val('_align.on'), false);
        assert.equal(panel(), '');
    });

    it('🔗 点名が同じ点を組にする: 動かす図形の中の測点 ↔ 動かさない測点。同じ点名が2つ以上あるものは組にしない', () => {
        const mk = (name, x, y) => `{ type: 'POINT', layer: 0, color: null, x: ${x}, y: ${y}, name: '${name}' }`;
        app.eval(`entities.push(${mk('K1', 0, 0)}, ${mk('K2', 40, 0)}, ${mk('K3', 40, 25)}, ${mk('X9', 7, 7)}, ${mk('D1', 3, 3)},
            ${mk('K1', 1000, 1000)}, ${mk('K2', 1000, 1040)}, ${mk('K3', 975, 1040)}, ${mk('D1', 900, 900)}, ${mk('D1', 901, 901)});
            cmdState.selectedIndices = [0, 1, 2, 3, 4]; processCommand('HALIGN');`);
        assert.equal(app.val('alignPairByName()'), 3);
        assert.match(toast(), /3組.*同じ点名が2つ以上ある 1点/);
        assert.match(panel(), /K1.*K2.*K3/);
        assert.match(panel(), /標準偏差 σ₀0\.0 mm（3組/);
        assert.equal(app.val('alignPairByName()'), 0, '2回押しても増えない');
        assert.equal(app.val('_align.pairs.length'), 3);
        go();
        assert.ok(near(app.val('entities[2].x'), 975, 1e-9) && near(app.val('entities[2].y'), 1040, 1e-9));
        assert.equal(app.val('entities[2].name'), 'K3');
    });

    it('知らせ: 合わせる先が動かす図形の点だったとき。裏返しの図形。範囲の外の図形（三角形の区画そのものは「外」にしない）', () => {
        start([0, 1]);
        pair(0, 0, 40, 25); // 合わせる先が、動かす図形（2本目の線）の端
        assert.match(toast(), /合わせる先の点が、動かす図形の上にあります/);
        // 裏返し: 動かす側 (0,0)(40,0)(40,25) → 合わせる先を x 反転した形
        app.eval('alignReset(); entities.length = 0;');
        start([0, 1]);
        pair(0, 0, 2000, 2000); pair(40, 0, 1960, 2000); pair(40, 25, 1960, 2025);
        assert.match(panel(), /裏返し（鏡像）の図形かもしれません/);
        // 3つの頂点で合わせた三角形: 「範囲の外」は出さない
        app.eval('alignReset(); entities.length = 0;');
        app.eval(SHAPES + `entities.push({ type: 'LINE', layer: 0, color: null, x1: 40, y1: 25, x2: 0, y2: 0 }); cmdState.selectedIndices = [0, 1, 6]; processCommand('HALIGN');`);
        pair(0, 0, 1000, 1000); pair(40, 0, 1000, 1040); pair(40, 25, 975, 1040);
        assert.doesNotMatch(panel(), /範囲の外/);
        assert.doesNotMatch(panel(), /鏡像/);
        // 範囲の外: 張り合わせ点（3点）で囲んだ三角形の外に、動かす図形（円）がある
        app.eval('alignReset(); entities.length = 0;');
        app.eval(SHAPES + `entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 300, cy: 300, radius: 5 }); cmdState.selectedIndices = [0, 1, 6]; processCommand('HALIGN');`);
        pair(0, 0, 1000, 1000); pair(40, 0, 1000, 1040); pair(40, 25, 975, 1040);
        assert.match(panel(), /範囲の外にも、動かす図形があります/);
    });

    it('スマホの幅: 図面で点を指定するあいだは、パネルを隠して別窓をたたむ。決めると元に戻る（SIMA の変換と同じ）', () => {
        app.eval('window.innerWidth = 390');
        start([0, 1]);
        assert.match(panel(), /別窓（動かす図形）で/);
        app.eval('alignSelectSource({ x: 0, y: 0 })');
        assert.equal(panel(), '', '図面を覆うので隠す');
        assert.equal(app.val('_alignViewInst.collapsed && _align.folded'), true);
        assert.equal(viewOpen(), true, '別窓はたたんだまま出しておく');
        pt(1000, 1000);
        assert.match(panel(), /あと 1組/);
        assert.equal(app.val('_alignViewInst.collapsed || _align.folded'), false);
        pair(40, 0, 1000, 1040);
        assert.match(panel(), /回転/);
    });

    it('パネルを閉じても、もう一度始めると続きから。別窓は、パネルを出しているあいだだけ。図形が消えた・図面を開き直したら、やめる', async () => {
        start([0, 1]);
        pair(0, 0, 1000, 1000);
        app.eval('closePropertyPanel()');
        await raf();
        assert.equal(viewOpen(), false, 'パネルを閉じたら、別窓も隠す');
        assert.equal(app.val('_alignOverlayOn()'), false);
        app.eval(`processCommand('HALIGN')`);
        assert.equal(app.val('_align.pairs.length'), 1, '組は残っている');
        assert.match(panel(), /あと 1組/);
        assert.equal(viewOpen(), true);
        // 新しく図形を選んで始めたら、初めから
        app.eval(`cmdState.selectedIndices = [2]; processCommand('HALIGN');`);
        assert.equal(app.val('_align.pairs.length'), 0);
        assert.deepEqual([...app.val('_alignTargets()')], [2]);
        // 動かす図形が ↩ などで消えた
        app.eval(`entities.splice(2, 1); _bumpGeomEpoch(); alignPanel();`);
        assert.match(panel(), /動かす図形がありません/);
        assert.equal(app.val('alignApply()'), false);
        // 図面を開き直した・閉じた
        app.eval(`alignStart([0]); setDrawingName('別の図面');`);
        assert.equal(app.val('_align.on'), false);
        assert.equal(panel(), '');
        await raf();
        assert.equal(viewOpen(), false);
    });

    it('入口: ツールバー・お気に入り・ヘルプ・変換タブ。もう一度押すと選ぶ段階をやめる', () => {
        assert.equal(app.val(`[...document.querySelectorAll('.tool-cmd')].some((e) => e.textContent === 'HALIGN')`), true);
        assert.equal(app.val(`typeof alignCommand === 'function' && _SELECTION_EDIT_COMMANDS.includes('HALIGN')`), true);
        app.eval(`showCogoPanel && showCogoPanel(); `);
        assert.match(app.val('helmTabHtml()'), /図面の中の図形どうしを張り合わせる/);
        app.eval(SHAPES + `closePropertyPanel(); toggleCommand('HALIGN');`);
        assert.equal(app.val('cmdState.mode'), 'WAITING_HALIGN_SELECT');
        assert.equal(app.val(`document.querySelector('.tool-btn.active .tool-cmd').textContent`), 'HALIGN');
        app.eval(`toggleCommand('HALIGN')`); // もう一度押すと終わる
        assert.equal(app.val('cmdState.mode'), 'IDLE');
        assert.equal(app.val('_align.on'), false);
    });

    // ===== G3（別の担当が壊しにかかった点検）で見つかった「知らせ」の直し =====
    // 決まった乱数（毎回同じ並び）
    const rngOf = (seed) => { let s = seed >>> 0; const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); return { r, u: (a, b) => a + (b - a) * r(), gauss }; };
    const randPairs = (g, n, noise, k0 = 1) => { const th = g.u(-3, 3), t = { x: g.u(-5e4, 5e4), y: g.u(-5e4, 5e4) };
        return Array.from({ length: n }, () => { const p = { x: g.u(0, 80), y: g.u(0, 80) }, q = rot(p, th, k0, t); return { src: p, dst: { x: q.x + g.gauss() * noise, y: q.y + g.gauss() * noise }, use: true }; }); };
    const many = (list, mode) => app.val(`${JSON.stringify(list)}.map((ps) => { const c = alignCompute(ps, '${mode}'); return { ok: c.sol.ok, flags: c.rows.map((r) => !!(r && r.flag)), mirror: c.mirror, hint: c.scaleHint, sig: c.sol.sigma0 }; })`);

    it('取り違えの無い組には、めったに「合っていません」を出さない（組が少なくても）。0.5m の取り違えは、5組あれば見つける', () => {
        for (const [n, mode] of [[3, 'rigid'], [4, 'rigid'], [4, 'sim'], [5, 'sim'], [8, 'sim']]) {
            const g = rngOf(100 + n + (mode === 'sim' ? 50 : 0));
            const res = many(Array.from({ length: 150 }, () => randPairs(g, n, 0.01)), mode);
            const alarms = res.filter((r) => r.flags.some(Boolean)).length;
            assert.ok(alarms <= 150 * 0.12, `${n}組 ${mode}: 取り違えが無いのに知らせた ${alarms} / 150（以前は 3〜7割）`);
            assert.equal(res.filter((r) => r.mirror || r.hint).length, 0, 'ばらつきだけでは、鏡像・長さの知らせも出さない');
        }
        for (const mode of ['rigid', 'sim']) {
            const g = rngOf(mode === 'sim' ? 7 : 8);
            const list = Array.from({ length: 100 }, () => { const ps = randPairs(g, 5, 0.01); ps[2].dst = { x: ps[2].dst.x + 0.3, y: ps[2].dst.y - 0.4 }; return ps; });
            const res = many(list, mode);
            assert.ok(res.filter((r) => r.flags[2]).length >= 90, `${mode}: 取り違えた組を知らせた ${res.filter((r) => r.flags[2]).length} / 100`);
            assert.ok(res.filter((r) => r.flags[2] && r.flags.filter(Boolean).length === 1).length >= 85, 'その組だけを知らせる');
        }
        // 倍率の境: 自由度が少ないほど広い（1: 100、2: 14.1、4: 6、多いと 3.03）
        const ks = app.val('[1, 2, 4, 8, 1000].map(helmFlagK)');
        [[99.995, 0.01], [14.0712, 0.001], [6, 1e-9], [4.1582, 0.001], [3.038, 0.01]].forEach(([e, tol], i) => assert.ok(near(ks[i], e, tol), `helmFlagK ${i}: ${ks[i]}`));
        assert.equal(app.val('helmFlagK(0) === Infinity'), true);
    });

    it('「1/1」で長さが合っていないときは、そう知らせる（単位・縮尺の違う図形）。合っていれば出さない', () => {
        const two = (len) => [{ src: { x: 0, y: 0 }, dst: { x: 100, y: 50 }, use: true }, { src: { x: 10, y: 0 }, dst: { x: 100, y: 50 + len }, use: true }];
        assert.equal(compute(two(10), 'rigid').ok, true);
        const h = (ps, mode) => app.val(`alignCompute(${JSON.stringify(ps)}, '${mode}').scaleHint`);
        assert.equal(h(two(10), 'rigid'), null);
        assert.equal(h(two(10.002), 'rigid'), null, '2mm の違いは、ばらつきのうち');
        assert.ok(near(h(two(10.5), 'rigid'), 1.05, 1e-12));
        assert.ok(near(h(two(10000), 'rigid'), 1000, 1e-9), 'm の図形を mm の図形に合わせた');
        assert.equal(h(two(10.5), 'sim'), null, '縮尺も求めるときは出さない');
        const g = rngOf(31);
        const scaled = randPairs(g, 4, 0.003, 1.01), same = randPairs(g, 4, 0.003, 1);
        assert.ok(near(h(scaled, 'rigid'), 1.01, 1e-3));
        assert.equal(h(same, 'rigid'), null);
        assert.deepEqual(many([scaled], 'rigid')[0].flags, [false, false, false, false], '全部が均等にずれるので、組の知らせは出ない（だから長さの知らせが要る）');
        // パネル
        start([0, 1]);
        pair(0, 0, 1000, 1000); pair(40, 0, 1000, 1042);
        assert.match(panel(), /長さが合っていません（縮尺を 1\.050000 にすると合います）/);
        app.eval(`alignSetMode('sim')`);
        assert.doesNotMatch(panel(), /長さが合っていません/);
    });

    it('鏡像の知らせ: 合わせる先の2点を取り違えただけ（裏返っていない）では出さない。出るときも、取り違えの知らせは消さない', () => {
        const g = rngOf(77);
        for (const n of [3, 4, 5]) {
            const list = Array.from({ length: 100 }, () => { const ps = randPairs(g, n, 0.003); const d = ps[0].dst; ps[0].dst = ps[1].dst; ps[1].dst = d; return ps; });
            for (const mode of ['rigid', 'sim']) assert.ok(many(list, mode).filter((r) => r.mirror).length <= 2, `${n}組 ${mode}: 取り違えを鏡像とした`);
            // 本当の裏返しは、ばらつきがあっても見つける
            const mir = Array.from({ length: 50 }, () => randPairs(g, n, 0.003).map((p, i, a) => ({ src: { x: -p.src.x, y: p.src.y }, dst: p.dst, use: true })));
            const found = many(mir, 'rigid').filter((r) => r.mirror).length;
            assert.ok(found >= 45, `${n}組: 裏返しを見つけた ${found} / 50`);
        }
        // 一直線に近い細い形でも、裏返しでなければ出さない
        const thin = [0, 20, 40, 60].map((x, i) => ({ src: { x, y: i % 2 ? 0.02 : 0 }, dst: { x: 500 + x, y: 300 + (i % 2 ? 0.02 : 0) + (i === 1 ? 0.03 : 0) }, use: true }));
        assert.equal(compute(thin, 'rigid').mirror, false);
    });

    it('計算できない組は、張り合わせの言葉で断る（動かす側が同じ点・合わせる先が同じ点。1/1 でも）。1/1 の倍率は、ちょうど 1', () => {
        const same = (mode) => compute([{ src: { x: 0, y: 0 }, dst: { x: 5, y: 5 }, use: true }, { src: { x: 10, y: 0 }, dst: { x: 5, y: 5 }, use: true }], mode);
        assert.equal(same('rigid').ok, false, '1/1 でも、回転が決まらない');
        assert.match(same('rigid').err, /合わせる先の点が同じ位置です/);
        assert.match(same('sim').err, /合わせる先の点が同じ位置です/);
        assert.match(compute([{ src: { x: 1, y: 1 }, dst: { x: 5, y: 5 }, use: true }, { src: { x: 1, y: 1 }, dst: { x: 9, y: 5 }, use: true }], 'rigid').err, /動かす側の点が同じ位置です/);
        // 1/1: 図形に掛ける倍率は、どの角度でもちょうど 1（以前は 0.9999999999999999 になる角度があり、円の半径 4 が 3.9999999999999996 になった）
        const ks = app.val(`(() => { const out = []; for(let i = 0; i < 2000; i++) { const th = i * 0.0031 - 3, c = Math.cos(th), s = Math.sin(th);
            const ps = [[0, 0], [37, 5], [11, 29]].map(([x, y]) => ({ src: { x, y }, dst: { x: 900 + c * x - s * y, y: -400 + s * x + c * y }, use: true }));
            out.push(alignCompute(ps, 'rigid').T.k); } return out.filter((k) => k !== 1).length; })()`);
        assert.equal(ks, 0);
        start([2]);
        pair(20, 10, 777.7, 333.3); pair(0, 0, 777.7 + 20 * Math.cos(1.1) - 10 * Math.sin(1.1) - (20 * Math.cos(1.1) - 10 * Math.sin(1.1)) + (0 - 20) * Math.cos(1.1) - (0 - 10) * Math.sin(1.1), 333.3 + (0 - 20) * Math.sin(1.1) + (0 - 10) * Math.cos(1.1));
        go();
        assert.equal(app.val('entities[2].radius'), 4, '円の半径は、1/1 では1ビットも変わらない');
    });

    it('点名で組にする: ブロックの測点は、部品が1つでも選ばれていれば動かす側。見えない測点（非表示・画層が非表示）は組にしない', () => {
        const blk = (gid, name, x, y, layer = 0) => `{ type: 'CIRCLE', layer: ${layer}, color: null, cx: ${x}, cy: ${y}, radius: 0.3, gid: '${gid}', blockName: '杭', ins: { x: ${x}, y: ${y} } },
            { type: 'TEXT', layer: ${layer}, color: null, x: ${x + 1}, y: ${y + 1}, text: '${name}', height: 1, attTag: '点名', gid: '${gid}', blockName: '杭', ins: { x: ${x}, y: ${y} } }`;
        app.eval(`layers.push({ name: '隠す', color: '#ffffff', visible: false });
            entities.push(${blk('a1', 'K1', 0, 0)}, ${blk('a2', 'K2', 40, 0)}, ${blk('b1', 'K1', 1000, 1000)}, ${blk('b2', 'K2', 1000, 1040)},
                { type: 'POINT', layer: 0, color: null, x: 500, y: 500, name: 'K2', hidden: true }, { type: 'POINT', layer: 1, color: null, x: 600, y: 600, name: 'K1' });
            window.groupSelectEnabled = false; alignStart([1, 3]);`); // 属性の文字（2つ目の部品）だけを選んだ
        assert.equal(app.val('alignPairByName()'), 2, '見えない K1・K2 は数えない（「同じ点名が2つ以上」にもしない）');
        assert.deepEqual([...app.val('_align.pairs.map((p) => [p.src.x, p.src.y, p.dst.x, p.dst.y].join(","))')], ['0,0,1000,1000', '40,0,1000,1040']);
    });

    it('組が少なくて取り違えを見分けられないときは、そう出す（3組まで）', () => {
        start([0, 1]);
        pair(0, 0, 1000, 1000); pair(40, 0, 1000, 1040); pair(40, 25, 975, 1040);
        assert.match(panel(), /組が少ないので、点を取り違えていても、どの組かは見分けられません/);
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 25, x2: 0, y2: 0 }); _bumpGeomEpoch(); _align.ids.push(entities[entities.length - 1].id);`);
        pair(0, 25, 975, 1000);
        assert.doesNotMatch(panel(), /組が少ないので/);
        app.eval(`alignSetMode('sim')`);
        assert.doesNotMatch(panel(), /組が少ないので/, '縮尺も求める: 4組あれば見分けられる');
        app.eval('alignDeletePair(3)');
        assert.match(panel(), /組が少ないので/, '縮尺も求める: 3組では見分けられない');
    });

    // ===== 別窓のスナップ（v5.59.1）: 端点・頂点・中心だけでなく、図形（中点・交点・四半円点・線の上）にも吸い付く =====
    describe('別窓のスナップ', () => {
        let saved;
        beforeEach(() => { saved = app.val('JSON.stringify(osnapState)'); });
        const restore = () => app.eval(`Object.assign(osnapState, ${saved})`);
        // 動かす図形: 線 (0,0)-(40,0)・線 (40,0)-(40,25)・円 中心 (20,10) 半径 4・文字 (5,5)・斜めの線 (0,-10)-(30,20)（y=0 の線と (10,0) で交わる）
        // 動かさない図形: 遠くの線2本と、動かす線を (30,0) で横切る線 (30,-4)-(30,6)
        const begin = () => app.eval(SHAPES + `entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: -10, x2: 30, y2: 20 }, { type: 'LINE', layer: 0, color: null, x1: 30, y1: -4, x2: 30, y2: 6 });
            cmdState.selectedIndices = [0, 1, 2, 3, 6]; processCommand('HALIGN');`);
        const snap = (x, y, k) => { const r = app.val(`alignSnapPoint({ x: ${x}, y: ${y} }, ${k}, 22)`); return r && { ...r }; };

        it('吸い付く点: 中点・交点・端点・中心・四半円点・挿入点。幾何の点が近くに無いときだけ、線の上の点（近接点）', () => {
            try {
                begin();
                assert.deepEqual(snap(20.5, 0.8, 5), { x: 20, y: 0, t: '中点' }, '線の真ん中の近く');
                assert.deepEqual(snap(10.3, 0.2, 20), { x: 10, y: 0, t: '交点' }, '動かす図形どうしの交点（y = x − 10 と y = 0）');
                assert.deepEqual(snap(39.7, 0.4, 5), { x: 40, y: 0, t: '端点' });
                assert.deepEqual(snap(20.4, 10.3, 20), { x: 20, y: 10, t: '中心' });
                assert.deepEqual(snap(24.3, 10.2, 20), { x: 24, y: 10, t: '四半円点' });
                assert.deepEqual(snap(5.2, 5.1, 5), { x: 5, y: 5, t: '挿入点' }, '文字の位置');
                // 線の上（端点・中点から離れた所）: 線に下ろした点
                assert.deepEqual(snap(33, 1, 20), { x: 33, y: 0, t: '近接点' });
                // 円の上: 中心からその向きへ、半径ぶん
                const c = snap(17.1, 12.7, 20), a = Math.atan2(2.7, -2.9); // 斜めの線が円と交わる右上は避ける
                assert.equal(c.t, '近接点');
                assert.ok(near(c.x, 20 + 4 * Math.cos(a), 1e-12) && near(c.y, 10 + 4 * Math.sin(a), 1e-12), JSON.stringify(c));
                // 何も無い所
                assert.equal(snap(60, 60, 5), null);
            } finally { restore(); }
        });

        it('動かさない図形には吸い付かない（その図形の中点・それとの交点にも）。図面の表示の倍率にはよらない', () => {
            try {
                begin();
                assert.equal(snap(1000.2, 1020.1, 5), null, '動かさない線の中点');
                const nx = snap(30.1, 0.1, 20);
                assert.ok(nx.t === '近接点' && near(nx.x, 30.1, 1e-12) && nx.y === 0, '動かさない線との交点 (30,0) ではなく、動かす線の上の点: ' + JSON.stringify(nx));
                // 図面のスナップ（ふつうの呼び方）は、今までどおり全部の図形が相手
                const all = app.val(`collectSnapPoints(30.1, 0.1, null, Object.assign({}, osnapState, { main: true }), 22).filter((p) => p.t === '交点' && Math.hypot(p.x - 30, p.y) < 1e-9).length`);
                assert.equal(all, 1, '図面では、動かさない線との交点も出る');
                // 図面を大きく・小さく表示していても、別窓の結果は同じ（別窓の倍率だけで決まる）
                for (const s of [0.001, 1, 5000]) {
                    app.eval(`view.scale = ${s}`);
                    assert.deepEqual(snap(20.5, 0.8, 5), { x: 20, y: 0, t: '中点' }, `view.scale ${s}`);
                    assert.deepEqual(snap(10.3, 0.2, 20), { x: 10, y: 0, t: '交点' }, `view.scale ${s}`);
                    assert.equal(snap(1000.2, 1020.1, 5), null);
                }
                // 図面の「延長」の取得待ち（カーソルの下の線の覚え）を、別窓の動きで書き換えない
                app.eval(`_snapHoverTmp = { d: 1.5, src: { kind: 'seg', x1: 1, y1: 2, x2: 3, y2: 4 } }; alignSnapPoint({ x: 33, y: 1 }, 20, 22);`);
                assert.deepEqual({ ...app.val('_snapHoverTmp.src') }, { kind: 'seg', x1: 1, y1: 2, x2: 3, y2: 4 });
                app.eval('_snapHoverTmp = null');
            } finally { restore(); }
        });

        it('種類は OSNAP の設定のとおり（中点を切れば中点には吸い付かない）。端点・中心・挿入点は、OSNAP を切っていても吸い付く', () => {
            try {
                begin();
                app.eval('osnapState.mid = false');
                assert.deepEqual(snap(20.5, 0.8, 5), { x: 20.5, y: 0, t: '近接点' });
                app.eval('osnapState.near = false');
                assert.equal(snap(20.5, 0.8, 5), null, '中点も近接点も切った');
                app.eval('osnapState.int = false');
                assert.equal(snap(10.3, 0.2, 20), null);
                // OSNAP 全体を切っても（図面では自由な点になる）、別窓は種類ごとの設定で吸い付く
                app.eval(`Object.assign(osnapState, ${saved}); osnapState.main = false; osnapState.mid = true;`);
                assert.deepEqual(snap(20.5, 0.8, 5), { x: 20, y: 0, t: '中点' });
                app.eval(`['end', 'mid', 'cen', 'int', 'near', 'qua', 'ins', 'gce', 'div'].forEach((k) => { osnapState[k] = false; });`);
                assert.deepEqual(snap(39.7, 0.4, 5), { x: 40, y: 0, t: '端点' });
                assert.deepEqual(snap(20.4, 10.3, 20), { x: 20, y: 10, t: '中心' });
                assert.deepEqual(snap(5.2, 5.1, 5), { x: 5, y: 5, t: '挿入点' });
                assert.equal(snap(24.3, 10.2, 40), null, '四半円点は設定のとおり');
                // 等分点（3等分）を入れると出る
                app.eval('osnapState.div = true; osnapState.divN = 3;');
                const d = snap(13.5, 0.3, 20);
                assert.equal(d.t, '等分点');
                assert.ok(near(d.x, 40 / 3, 1e-12) && d.y === 0);
            } finally { restore(); }
        });

        it('見えていない画層の図形も、別窓に描いているので吸い付く（端点だけでなく中点も）', () => {
            try {
                app.eval(SHAPES + `layers.push({ name: '隠す', color: '#ffffff', visible: false });
                    entities.push({ type: 'LINE', layer: 1, color: null, x1: 100, y1: 100, x2: 120, y2: 100 }, { type: 'LINE', layer: 0, color: null, x1: 200, y1: 100, x2: 220, y2: 100, hidden: true });
                    cmdState.selectedIndices = [0, 6, 7]; processCommand('HALIGN');`);
                assert.deepEqual(snap(110.2, 100.3, 5), { x: 110, y: 100, t: '中点' });
                assert.deepEqual(snap(200.3, 100.2, 5), { x: 200, y: 100, t: '端点' });
                assert.deepEqual(snap(210.1, 100.2, 5), { x: 210, y: 100, t: '中点' });
            } finally { restore(); }
        });

        it('別窓のタップ: 線の真ん中をタップすると中点。種類を知らせて、図面で合わせる先の点を指定する段階へ。組には座標だけを入れる', () => {
            try {
                begin();
                const scr = (x, y) => app.val(`(() => { const s = wcsToSurvey(${x}, ${y}), q = _alignView().toScreen(s.X, s.Y); return [q.x, q.y]; })()`);
                const m = scr(20, 0);
                app.eval(`_alignTapSource(${m[0] + 3}, ${m[1] - 4})`);
                assert.deepEqual({ ...app.val('_align.sel') }, { x: 20, y: 0, t: '中点' });
                assert.match(toast(), /動かす側の点: 中点。図面で合わせる先の点をなぞって ☑確定/);
                assert.match(app.val(`document.getElementById('command-log').textContent`), /動かす側の点（中点）/);
                assert.equal(app.val('cogoIsPicking() && _cogo.pick.owner'), 'align');
                assert.doesNotThrow(() => app.eval('_alignViewInst.drawNow(); drawAlignOverlay();'));
                pt(1020, 1000);
                assert.deepEqual({ ...app.val('_align.pairs[0].src') }, { x: 20, y: 0 });
                // 交点をタップ → 2組目。動かすと、中点・交点が、合わせる先にぴったり合う（90° 回して (1000,1000) へ: (x, y) → (1000 − y… ではなく、ここは平行移動）
                const x = scr(10, 0);
                app.eval(`_alignTapSource(${x[0] - 2}, ${x[1] + 2})`);
                assert.deepEqual({ ...app.val('_align.sel') }, { x: 10, y: 0, t: '交点' });
                pt(1010, 1000);
                assert.equal(app.val('_align.pairs.length'), 2);
                go();
                const l = app.val('({ a: [entities[0].x1, entities[0].y1], b: [entities[0].x2, entities[0].y2], r: entities[2].radius, c: [entities[2].cx, entities[2].cy] })');
                assert.ok(near(l.a[0], 1000, 1e-9) && near(l.a[1], 1000, 1e-9) && near(l.b[0], 1040, 1e-9) && near(l.b[1], 1000, 1e-9), JSON.stringify(l));
                assert.ok(near(l.c[0], 1020, 1e-9) && near(l.c[1], 1010, 1e-9) && l.r === 4);
            } finally { restore(); }
        });

        it('PC: マウスを動かすと、吸い付く点の下見が出る（記号と種類）。別窓の外へ出ると消える。タッチの動きでは出さない', () => {
            try {
                begin();
                const cv = `_alignViewInst.canvas`;
                const move = (x, y, type) => app.eval(`(() => { const e = new window.Event('pointermove'); Object.assign(e, { clientX: ${x}, clientY: ${y}, pointerId: 7, pointerType: '${type}' }); ${cv}.dispatchEvent(e); })()`);
                const m = app.val(`(() => { const s = wcsToSurvey(20, 0), q = _alignView().toScreen(s.X, s.Y); return [q.x, q.y]; })()`);
                move(m[0] + 2, m[1] + 3, 'touch');
                assert.equal(app.val('_align.hover'), null);
                move(m[0] + 2, m[1] + 3, 'mouse');
                assert.deepEqual({ ...app.val('_align.hover') }, { x: 20, y: 0, t: '中点' });
                assert.doesNotThrow(() => app.eval('_alignViewInst.drawNow()'));
                app.eval(`${cv}.dispatchEvent(new window.Event('pointerleave'))`);
                assert.equal(app.val('_align.hover'), null);
                // 図面のスナップの記号を、別の描く先（別窓）にも描ける。渡さなければ今までどおり図面へ
                const calls = app.val(`(() => { const log = []; const g = { beginPath() { log.push('b'); }, rect() { log.push('r'); }, moveTo() {}, lineTo() {}, arc() { log.push('a'); }, closePath() {}, stroke() { log.push('s'); }, setLineDash() {} };
                    drawSnapShape('中点', 10, 10, 6, g); drawSnapShape('中心', 10, 10, 6, g); return log.join(''); })()`);
                assert.equal(calls, 'brsbas');
                assert.doesNotThrow(() => app.eval(`drawSnapShape('端点', 10, 10, 6)`));
                // 選ぶと下見は消える。やめても残らない
                move(m[0] + 2, m[1] + 3, 'mouse');
                app.eval(`_alignTapSource(${m[0] + 2}, ${m[1] + 3})`);
                assert.equal(app.val('_align.hover'), null);
                move(m[0] + 2, m[1] + 3, 'mouse');
                app.eval('alignReset()');
                assert.equal(app.val('_align.hover'), null);
            } finally { restore(); }
        });

        // ===== G3（別の担当の点検）で見つかった点の直し =====
        it('測点の近くをタップしたら、測点を拾う（点名の文字の位置は拾わない）。公共座標の区画の図心も、ずれない', () => {
            try {
                // 測点（点＋点名の文字。文字は測点から少しずらして置く）と、公共座標の小さな四角の区画
                app.eval(`entities.push({ type: 'POINT', layer: 0, color: null, x: 0, y: 0, name: 'K1', gid: 'g1' }, { type: 'TEXT', layer: 0, color: null, x: 1, y: 0.6, text: 'K1', height: 2, gid: 'g1', blockName: '測点', ptLabel: true },
                    { type: 'PLINE', layer: 0, color: null, closed: true, points: [{ x: 128120.2, y: -59917.2 }, { x: 128121.2, y: -59917.2 }, { x: 128121.2, y: -59916.2 }, { x: 128120.2, y: -59916.2 }] });
                    cmdState.selectedIndices = [0, 1, 2]; processCommand('HALIGN');`);
                assert.deepEqual([...app.val('_alignKeys().slice(0, 1).map((p) => [p.x, p.y, p.t].join(","))')], ['0,0,端点']);
                assert.equal(app.val('_alignKeys().some((p) => p.x === 1 && p.y === 0.6)'), false, '点名の文字の位置は、拾える点に入れない');
                for (const [x, y] of [[1, 0.6], [0.9, 0.5], [0.3, -0.2], [1.5, 1]]) assert.deepEqual(snap(x, y, 5), { x: 0, y: 0, t: '端点' }, `(${x}, ${y}) の近く`);
                // 図心（OSNAP で入れたとき）: 1辺 1m の四角の真ん中。以前は座標をそのまま掛け合わせていて、ここで 1cm ほどずれた
                app.eval('osnapState.gce = true');
                const c = snap(128120.71, -59916.69, 100);
                assert.equal(c.t, '図心');
                assert.ok(near(c.x, 128120.7, 1e-9) && near(c.y, -59916.7, 1e-9), JSON.stringify(c));
                // 面積 0（一直線）・点が無いときは、今までどおり頂点の平均・原点
                const z = app.val(`[_polygonCentroid([{ x: 100000, y: 5 }, { x: 100002, y: 5 }, { x: 100004, y: 5 }]), _polygonCentroid([])]`);
                assert.deepEqual([{ ...z[0] }, { ...z[1] }], [{ x: 100002, y: 5 }, { x: 0, y: 0 }]);
            } finally { restore(); }
        });

        it('下見の印を古いまま残さない: ホイールで拡大したら作り直す。図形が変わったら（↩ など）消す。図面の「延長」の覚えは書き換えない', async () => {
            try {
                begin();
                const ev = (type, x, y, extra) => app.eval(`(() => { const e = new window.Event('${type}', { cancelable: true }); Object.assign(e, { clientX: ${x}, clientY: ${y}, pointerId: 7, pointerType: 'mouse' }, ${JSON.stringify(extra || {})}); _alignViewInst.canvas.dispatchEvent(e); })()`);
                const m = app.val(`(() => { const s = wcsToSurvey(20, 0), q = _alignView().toScreen(s.X, s.Y); return [q.x, q.y]; })()`);
                await raf(); // 前のテストのマウスの動きのコマが終わってから
                ev('pointermove', m[0] + 15, m[1] + 4);
                assert.deepEqual({ ...app.val('_align.hover') }, { x: 20, y: 0, t: '中点' });
                await raf();
                // その場でホイールで拡大: マウスの下は、中点から離れた線の上になる。下見も、クリックで選ばれる点と同じになる
                for (let i = 0; i < 8; i++) { ev('wheel', m[0] + 15, m[1] + 4, { deltaY: -100 }); await raf(); }
                const h = app.val('_align.hover'), tap = app.val(`alignSnapAt(${m[0] + 15}, ${m[1] + 4})`);
                assert.equal(h.t, '近接点');
                assert.deepEqual({ ...h }, { ...tap }, '下見とクリックで選ばれる点が同じ');
                // 図形が変わった（世代が進んだ）: 次に描くときに下見を消す
                app.eval('_bumpGeomEpoch(); _alignViewInst.drawNow();');
                assert.equal(app.val('_align.hover'), null);
                // 全体（別窓の見え方を合わせ直す）でも消す
                ev('pointermove', m[0] + 15, m[1] + 4); await raf();
                app.eval('_alignFitView()');
                assert.equal(app.val('_align.hover'), null);
                // 続けて来たマウスの動きは、1コマに1回だけ探す（最後の位置で）
                await raf();
                const n = app.val(`(() => { let n = 0; const f = alignSnapAt; alignSnapAt = (x, y) => { n++; return f(x, y); };
                    try { for(let i = 0; i < 30; i++) _alignHover(${m[0]} + i * 0.1, ${m[1]}); } finally { alignSnapAt = f; } return n; })()`);
                assert.ok(n <= 1, `1コマの中で探した回数: ${n}`);
                await raf(); await raf();
                assert.deepEqual({ ...app.val('_align.hover') }, { x: 20, y: 0, t: '中点' }, '最後の位置の下見が出る');
                // 図面の「延長」の取得待ち（カーソルにいちばん近い線の覚え）は、中身も書き換えない
                app.eval(`_snapHoverTmp = { d: 9.5, src: { kind: 'seg', x1: 1, y1: 2, x2: 3, y2: 4 } }; alignSnapPoint({ x: 33, y: 0.05 }, 20, 22);`);
                assert.deepEqual(JSON.parse(app.val('JSON.stringify(_snapHoverTmp)')), { d: 9.5, src: { kind: 'seg', x1: 1, y1: 2, x2: 3, y2: 4 } });
                app.eval('_snapHoverTmp = null');
            } finally { restore(); }
        });
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
