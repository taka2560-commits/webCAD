'use strict';
// DXF 取り込みの回帰テスト。
// tests/fixtures/test_blocks.dxf の各要素について、DXF の数値から手計算した期待値と比較する。
//   SYM ブロック: 基点(5,5)、挿入点(100,100)、縮尺2、回転90°
//   ワールド座標 = 挿入点 + R(90°)·2·(ブロック座標 − 基点)   … R(90°)(x,y) = (−y, x)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixture, near } = require('./helpers/load-app.cjs');

const HALF_PI = Math.PI / 2;

function importFixture(app, name, opts = {}) {
    app.window.__dxfText = fixture(name);
    app.eval(`
        entities.length = 0;
        layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
        currentLayerIndex = 0;
        setImportHideArcs(${opts.hideArcs === false ? 'false' : 'true'});
        (function () {
            const p = new window.DxfParser();
            registerExtraDxfHandlers(p);
            importDxfData(p.parseSync(window.__dxfText), { skipUndo: true });
        })();
    `);
    return app.val('entities.map(e => { const c = Object.assign({}, e); delete c.bbox; return c; })');
}

const layerIndex = (app, name) => app.eval(`layers.findIndex(l => l.name === ${JSON.stringify(name)})`);
const assertPoint = (p, x, y, msg) => {
    assert.ok(near(p.x, x) && near(p.y, y), `${msg}: 期待 (${x}, ${y}) / 実際 (${p.x}, ${p.y})`);
};

describe('DXF取り込み: test_blocks.dxf', () => {
    let app;
    let ents;
    before(async () => {
        app = await loadApp();
        ents = importFixture(app, 'test_blocks.dxf');
    });
    after(() => app.close());

    it('対象の図形がすべて取り込まれる（ペーパー空間の図形は除外）', () => {
        assert.equal(ents.length, 13);
        assert.ok(!ents.some((e) => e.type === 'LINE' && near(e.x1, 9999)), 'ペーパー空間の LINE が混入している');
    });

    it('ブロック基点・回転・縮尺を考慮して LINE を配置する', () => {
        const line = ents.find((e) => e.type === 'LINE' && e.blockName === 'SYM');
        assert.ok(line, 'SYM の LINE が無い');
        assertPoint({ x: line.x1, y: line.y1 }, 110, 90, '始点');
        assertPoint({ x: line.x2, y: line.y2 }, 110, 110, '終点');
    });

    it('円弧付きポリライン（bulge=1 の半円）を中心(110,100)・半径10の円弧として展開する', () => {
        const pl = ents.find((e) => e.type === 'PLINE' && e.blockName === 'SYM');
        assert.ok(pl && pl.points.length > 4, '折れ線近似の点が少なすぎる');
        assertPoint(pl.points[0], 110, 90, '始点');
        assertPoint(pl.points[pl.points.length - 1], 110, 110, '終点');
        for (const p of pl.points) {
            assert.ok(near(Math.hypot(p.x - 110, p.y - 100), 10, 1e-6), `円弧上にない点 (${p.x}, ${p.y})`);
        }
        const maxX = Math.max(...pl.points.map((p) => p.x));
        assert.ok(near(maxX, 120, 1e-6), `半円の頂点が (120,100) にない: maxX=${maxX}`);
    });

    it('入れ子ブロックに親の回転・縮尺が引き継がれる', () => {
        const c = ents.find((e) => e.type === 'CIRCLE' && e.blockName === 'SYM');
        assert.ok(c, '入れ子ブロックの CIRCLE が無い');
        assertPoint({ x: c.cx, y: c.cy }, 110, 94, '中心');
        assert.ok(near(c.radius, 2), `半径 ${c.radius}`);
    });

    it('属性: ATTRIB の値を表示し、不可視属性と通常の ATTDEF は表示しない', () => {
        const texts = ents.filter((e) => e.type === 'TEXT' && e.blockName === 'SYM').map((e) => e.text).sort();
        assert.deepEqual(texts, ['CONST_VAL', 'KP-12']);
        const attrib = ents.find((e) => e.text === 'KP-12');
        assertPoint(attrib, 100, 110, 'ATTRIB 位置');
        assert.ok(near(attrib.height, 2));
    });

    it('定数属性（ATTDEF 定数）はブロックの変換を受けて表示される', () => {
        const t = ents.find((e) => e.text === 'CONST_VAL');
        assertPoint(t, 102, 90, '位置');
        assert.ok(near(t.height, 2), `高さ ${t.height}`);
        assert.ok(near(t.rotation, HALF_PI), `回転 ${t.rotation}`);
    });

    it('1つの INSERT から展開された図形（属性含む）は同じグループになる', () => {
        const sym = ents.filter((e) => e.blockName === 'SYM');
        assert.equal(sym.length, 5);
        assert.equal(new Set(sym.map((e) => e.gid)).size, 1);
        assert.ok(sym[0].gid);
    });

    it('整列指定のある TEXT は位置合わせ点（code 11）と揃え・回転を使う', () => {
        const t = ents.find((e) => e.text === '中央文字');
        assertPoint(t, 200, 200, '位置');
        assert.equal(t.halign, 'center');
        assert.equal(t.valign, 'middle');
        assert.ok(near(t.rotation, Math.PI / 6), `回転 ${t.rotation}`);
        assert.equal(t.layer, layerIndex(app, 'RED_LAYER'));
    });

    it('MTEXT は書式コードを除去し、回転（ラジアン）と基準位置を取り込む', () => {
        const t = ents.find((e) => e.text === '回転MTEXT');
        assert.ok(t, `MTEXT が見つからない: ${ents.filter((e) => e.type === 'TEXT').map((e) => e.text)}`);
        assertPoint(t, 300, 300, '位置');
        assert.ok(near(t.rotation, 0.5235987756), `回転 ${t.rotation}`);
        assert.equal(t.halign, 'left');
        assert.equal(t.valign, 'top');
    });

    it('寸法（*D ブロック）を線と寸法値に展開し、1つのグループにする', () => {
        const dims = ents.filter((e) => e.blockName === '寸法');
        assert.equal(dims.length, 2);
        assert.equal(new Set(dims.map((e) => e.gid)).size, 1);
        const line = dims.find((e) => e.type === 'LINE');
        assertPoint({ x: line.x1, y: line.y1 }, 0, 50, '寸法線 始点');
        assertPoint({ x: line.x2, y: line.y2 }, 100, 50, '寸法線 終点');
        const text = dims.find((e) => e.type === 'TEXT');
        assert.equal(text.text, '100.00');
        assert.ok(dims.every((e) => e.layer === layerIndex(app, 'DIMS')));
    });

    it('スプラインを曲線として評価する（端点は制御点の両端、制御多角形の範囲内）', () => {
        const sp = ents.find((e) => e.type === 'PLINE' && !e.blockName && !e.closed);
        assert.ok(sp && sp.points.length > 8, 'スプラインの評価点が少ない');
        assertPoint(sp.points[0], 0, -100, '始点');
        assertPoint(sp.points[sp.points.length - 1], 30, -100, '終点');
        for (const p of sp.points) {
            assert.ok(p.x >= -1e-9 && p.x <= 30 + 1e-9 && p.y >= -120 - 1e-9 && p.y <= -80 + 1e-9, `範囲外の点 (${p.x}, ${p.y})`);
        }
    });

    it('SOLID は頂点順を補正した閉じたポリラインになる（蝶ネクタイ状にならない）', () => {
        const so = ents.find((e) => e.type === 'PLINE' && e.closed && !e.blockName);
        assert.deepEqual(so.points, [{ x: 0, y: -200 }, { x: 10, y: -200 }, { x: 10, y: -190 }, { x: 0, y: -190 }]);
    });

    it('ARC の角度を正しく取り込む（度→ラジアンの二重変換をしない）', () => {
        const arc = ents.find((e) => e.type === 'ARC');
        assertPoint({ x: arc.cx, y: arc.cy }, -100, -100, '中心');
        assert.ok(near(arc.radius, 10));
        assert.ok(near(arc.startAngle, 0), `開始角 ${arc.startAngle}`);
        assert.ok(near(arc.endAngle, HALF_PI), `終了角 ${arc.endAngle}（π/2 のはず）`);
        assert.equal(arc.counterclockwise, true);
        assert.equal(arc.hidden, true, '既定では円弧を非表示で取り込む');
    });

    it('画層: 色番号から色を付け、非表示画層は非表示のまま、未定義の画層は作成する', () => {
        const L = app.val('layers');
        const byName = Object.fromEntries(L.map((l) => [l.name, l]));
        assert.equal(byName.RED_LAYER.color.toUpperCase(), '#FF0000');
        assert.equal(byName.DIMS.color.toUpperCase(), '#00FFFF');
        assert.equal(byName.OFF_LAYER.visible, false);
        assert.ok(byName.UNKNOWN_LAYER, '未定義の画層が作成されていない');
        const line = ents.find((e) => e.type === 'LINE' && near(e.x1, -50));
        assert.equal(line.layer, layerIndex(app, 'UNKNOWN_LAYER'));
    });

    it('取り込み中に未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('DXF取り込み: オプションと往復', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('「円弧を非表示」をOFFにすると円弧を表示状態で取り込む', () => {
        const ents = importFixture(app, 'test_blocks.dxf', { hideArcs: false });
        assert.equal(ents.find((e) => e.type === 'ARC').hidden, undefined);
    });

    it('DXF に書き出して読み直しても、図形の種類・形・文字の揃え・図形ごとの色が変わらない', async () => {
        importFixture(app, 'test_blocks.dxf', { hideArcs: false });
        // 取り込み結果に加えて、楕円と色付きの図形も書き出し対象にする
        app.eval(`
            entities.push({ type: 'ELLIPSE', layer: 0, color: null, cx: 500, cy: 500, rx: 20, ry: 8, rotation: Math.PI / 6 });
            entities.push({ type: 'ELLIPSE', layer: 0, color: null, cx: 600, cy: 500, rx: 5, ry: 15, rotation: 0 });
            entities.push({ type: 'LINE', layer: 0, color: '#FF0000', x1: 700, y1: 0, x2: 710, y2: 0 });
            entities.push({ type: 'LINE', layer: 0, color: '#123456', x1: 720, y1: 0, x2: 730, y2: 0 });
            entities.push({ type: 'RECTANG', layer: 0, color: null, x1: 800, y1: 0, x2: 820, y2: 10 });
        `);
        const snapshot = () => app.val(`entities.map(e => ({
            t: e.type, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, cx: e.cx, cy: e.cy, r: e.radius, sa: e.startAngle, ea: e.endAngle,
            rx: e.rx, ry: e.ry, rot: e.rotation, text: e.text, x: e.x, y: e.y, ha: e.halign, va: e.valign, h: e.height,
            n: e.points ? e.points.length : undefined, p0: e.points ? e.points[0] : undefined,
            pn: e.points ? e.points[e.points.length - 1] : undefined, closed: e.closed, color: e.color }))`);
        const before = snapshot();

        app.eval('window.__download = null; downloadBlob = function (blob, name) { window.__download = { blob: blob, name: name }; };');
        app.eval('exportDxf()');
        const blob = app.eval('window.__download && window.__download.blob');
        assert.ok(blob, 'DXF が書き出されていない');
        const text = await new Promise((resolve, reject) => {
            const r = new app.window.FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsText(blob);
        });
        app.window.__dxfText = text;
        app.eval(`
            entities.length = 0;
            (function () {
                const p = new window.DxfParser();
                registerExtraDxfHandlers(p);
                importDxfData(p.parseSync(window.__dxfText), { skipUndo: true });
            })();
        `);
        const after = snapshot();

        // 長方形は閉じたポリラインとして戻る
        const expectType = (b) => (b.t === 'RECTANG' ? 'PLINE' : b.t);
        const count = (arr, key) => arr.reduce((m, e) => ((m[key(e)] = (m[key(e)] || 0) + 1), m), {});
        assert.deepEqual(count(after, (e) => e.t), count(before, expectType), '図形の種類ごとの個数が変わった');
        assert.equal(after.length, before.length);

        const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const close = (a, b, eps = 1e-6) => a === undefined || b === undefined ? a === b : Math.abs(a - b) <= eps;
        // DXF は画層ごとにまとめて出力されるため順序は変わる。種類と代表点で対応付ける
        const anchor = (e) => (e.p0 ? e.p0 : e.cx !== undefined ? { x: e.cx, y: e.cy } : e.x1 !== undefined ? { x: e.x1, y: e.y1 } : { x: e.x, y: e.y });
        const unmatched = after.slice();
        before.forEach((b, i) => {
            const ba = anchor(b);
            const k = unmatched.findIndex((a) => a.t === expectType(b) && close(anchor(a).x, ba.x) && close(anchor(a).y, ba.y) && (b.text === undefined || a.text === b.text));
            assert.ok(k >= 0, `#${i} ${b.t} (${ba.x}, ${ba.y}) に対応する図形が読み直し後に無い`);
            const a = unmatched.splice(k, 1)[0];
            const label = `#${i} ${b.t}`;
            assert.equal(a.t, expectType(b), label);
            if (b.t === 'LINE') for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(close(a[k], b[k]), `${label}.${k}: ${b[k]} → ${a[k]}`);
            if (b.t === 'CIRCLE' || b.t === 'ARC') for (const k of ['cx', 'cy', 'r']) assert.ok(close(a[k], b[k]), `${label}.${k}`);
            if (b.t === 'ARC') {
                assert.ok(close(norm(a.sa), norm(b.sa)), `${label} 開始角: ${b.sa} → ${a.sa}`);
                assert.ok(close(norm(a.ea), norm(b.ea)), `${label} 終了角: ${b.ea} → ${a.ea}`);
            }
            if (b.t === 'PLINE') {
                assert.equal(a.n, b.n, `${label} 頂点数`);
                assert.equal(!!a.closed, !!b.closed, `${label} 閉合`);
                assert.ok(close(a.p0.x, b.p0.x) && close(a.p0.y, b.p0.y) && close(a.pn.x, b.pn.x) && close(a.pn.y, b.pn.y), `${label} 端点`);
            }
            if (b.t === 'RECTANG') {
                assert.equal(a.n, 4);
                assert.equal(a.closed, true);
            }
            if (b.t === 'TEXT') {
                assert.equal(a.text, b.text, label);
                assert.ok(close(a.x, b.x) && close(a.y, b.y), `${label} 位置: (${b.x},${b.y}) → (${a.x},${a.y})`);
                assert.equal(a.ha, b.ha, `${label} 横揃え`);
                assert.equal(a.va, b.va, `${label} 縦揃え`);
                assert.ok(close(norm(a.rot || 0), norm(b.rot || 0)), `${label} 回転`);
                assert.ok(close(a.h, b.h), `${label} 高さ`);
            }
            if (b.t === 'ELLIPSE') {
                assert.ok(close(a.cx, b.cx) && close(a.cy, b.cy), `${label} 中心`);
                const [bMaj, bMin] = [Math.max(b.rx, b.ry), Math.min(b.rx, b.ry)];
                assert.ok(close(Math.max(a.rx, a.ry), bMaj) && close(Math.min(a.rx, a.ry), bMin), `${label} 半径 ${b.rx},${b.ry} → ${a.rx},${a.ry}`);
            }
        });
        // 図形ごとの色: 色番号表にある色はそのまま、無い色は近い色番号で残る（白にはならない）
        const red = after.find((e) => e.t === 'LINE' && close(e.x1, 700));
        assert.equal((red.color || '').toUpperCase(), '#FF0000');
        const navy = after.find((e) => e.t === 'LINE' && close(e.x1, 720));
        assert.ok(navy.color && navy.color.toUpperCase() !== '#FFFFFF', `任意色が白になった: ${navy.color}`);
        const plain = after.find((e) => e.t === 'LINE' && close(e.x1, 110));
        assert.equal(plain.color, null, '色指定の無い図形は ByLayer のまま');
    });

    it('ファイル選択からの読み込み（文字コード判定を含む）で図形と図面名が入る', async () => {
        app.eval('entities.length = 0;');
        const file = new app.window.File([fixture('test_drawing.dxf')], 'sample.dxf');
        app.window.__file = file;
        app.eval('loadDxfFile(window.__file)');
        for (let i = 0; i < 100 && app.eval('entities.length') === 0; i++) await new Promise((r) => setTimeout(r, 10));
        assert.deepEqual(app.val('entities.map(e => e.type)'), ['LINE', 'CIRCLE']);
        assert.equal(app.eval('window._drawingName'), 'sample.dxf');
    });

    it('既存の図面があるとき「置き換え」を選ぶと図形と画層をリセットする', () => {
        app.eval(`entities.length = 0; entities.push({ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 1, y2: 1 }); layers.push({ name: '古い画層', color: '#fff', visible: true });`);
        app.window.confirm = () => true; // OK = 置き換え
        const mode = app.eval('_prepareImportTarget()');
        assert.equal(mode, 'replace');
        assert.equal(app.eval('entities.length'), 0);
        assert.deepEqual(app.val('layers.map(l => l.name)'), ['0']);
    });

    it('「追加」を選ぶと既存の図形を残す', () => {
        app.eval(`entities.length = 0; entities.push({ type: 'LINE', layer: 0, x1: 0, y1: 0, x2: 1, y2: 1 });`);
        app.window.confirm = () => false; // キャンセル = 追加
        const mode = app.eval('_prepareImportTarget()');
        assert.equal(mode, 'append');
        assert.equal(app.eval('entities.length'), 1);
        app.window.confirm = () => true;
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
