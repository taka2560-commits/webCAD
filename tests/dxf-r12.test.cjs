'use strict';
// DXF の書き出し（Jw_cad 向け。v5.29）: R12（AC1009）・Shift-JIS・mm。R12 に無い図形の置き換え（ポリライン・複数行の文字・寸法・塗りつぶし・模様）、
// 画層・線種・色、読み直したときの形と単位を確かめる
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { loadApp, near } = require('./helpers/load-app.cjs');

function exportBytes(app) {
    app.eval(`window.__name = null; window.downloadBlob = (b, name) => { window.__name = name; }; window.__OB = window.Blob;
        window.Blob = function (parts, opt) { window.__parts = parts; return new window.__OB(parts, opt); }; exportDxfJw(); window.Blob = window.__OB;`);
    return Buffer.from(app.val('Array.from(window.__parts[0])'));
}
const sjis = (bytes) => new TextDecoder('shift-jis').decode(bytes);
const tagsOf = (text) => { const L = text.split('\r\n'); const out = []; for (let i = 0; i + 1 < L.length; i += 2) out.push([L[i], L[i + 1]]); return out; };
// ENTITIES の中の図形（0 で区切る）
function entitiesOf(T) {
    const s = T.findIndex(([c, v], i) => c.trim() === '2' && v === 'ENTITIES' && T[i - 1][1] === 'SECTION');
    const out = []; let cur = null;
    for (let i = s + 1; i < T.length; i++) {
        const c = Number(T[i][0]), v = T[i][1];
        if (c === 0) { if (v === 'ENDSEC') break; cur = { type: v, tags: [] }; out.push(cur); } else cur.tags.push([c, v]);
    }
    return out;
}
const get = (ent, code) => { const t = ent.tags.find(([c]) => c === code); return t ? t[1] : undefined; };
const num = (ent, code) => Number(get(ent, code));
// 表（LTYPE・LAYER）の項目
function tableOf(T, name) {
    const s = T.findIndex(([c, v], i) => c.trim() === '2' && v === name && T[i - 1][1] === 'TABLE');
    const out = []; let cur = null;
    for (let i = s + 2; i < T.length; i++) {
        const c = Number(T[i][0]), v = T[i][1];
        if (c === 0) { if (v === 'ENDTAB') break; cur = { tags: [] }; out.push(cur); } else cur.tags.push([c, v]);
    }
    return out;
}
const header = (T, name) => {
    const i = T.findIndex(([c, v]) => c.trim() === '9' && v === name);
    if (i < 0) return null;
    const out = [];
    for (let k = i + 1; k < T.length && !['9', '0'].includes(T[k][0].trim()); k++) out.push(T[k]);
    return out;
};
const reset = (app, unit) => app.eval(`localStorage.setItem('cad_survey_unit', '${unit}'); entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); drawingLineTypes = {}; drawingLtscale = null;`);

describe('DXF の書き出し（Jw_cad 向け: R12・Shift-JIS・mm）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('R12 の作り: AC1009・ANSI_932・CRLF。R12 の図形だけで、ハンドル（5）・サブクラス（100）は書かない', () => {
        reset(app, 'm');
        app.eval(`entities.push(
            { type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 30, y2: 0 },
            { type: 'CIRCLE', layer: 0, color: null, cx: 5, cy: 5, radius: 2 },
            { type: 'ARC', layer: 0, color: null, cx: 0, cy: 0, radius: 3, startAngle: 0, endAngle: Math.PI / 2 },
            { type: 'RECTANG', layer: 0, color: null, x1: 0, y1: 0, x2: 4, y2: 3 },
            { type: 'PLINE', layer: 0, color: null, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], closed: false },
            { type: 'ELLIPSE', layer: 0, color: null, cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0.3 },
            { type: 'POINT', layer: 0, color: null, x: 1, y: 2 },
            { type: 'TEXT', layer: 0, color: null, x: 1, y: 2, text: 'ABC', height: 0.5 },
            { type: 'PIN', layer: 0, x: 0, y: 0 });`);
        const bytes = exportBytes(app);
        const text = sjis(bytes);
        assert.ok(!/[^\r]\n/.test(text), '改行が CRLF でない');
        assert.ok(text.endsWith('  0\r\nEOF\r\n'));
        const T = tagsOf(text);
        assert.deepEqual(T.slice(0, 4).map(([c, v]) => [c, v]), [['  0', 'SECTION'], ['  2', 'HEADER'], ['  9', '$ACADVER'], ['  1', 'AC1009']]);
        assert.deepEqual(header(T, '$DWGCODEPAGE'), [['  3', 'ANSI_932']]);
        assert.ok(T.every(([c]) => /^[ \d-]{3}$/.test(c) && Number.isInteger(Number(c))), 'コードは右詰め3桁の整数');
        assert.ok(!T.some(([c]) => [5, 100, 330, 370, 48].includes(Number(c))), 'R12 に無いコードがある');
        const types = [...new Set(entitiesOf(T).map((e) => e.type))].sort();
        assert.deepEqual(types, ['ARC', 'CIRCLE', 'LINE', 'POINT', 'POLYLINE', 'SEQEND', 'TEXT', 'VERTEX']);
        // 長方形・ポリライン・楕円は POLYLINE（頂点の数・閉じ）
        const E = entitiesOf(T);
        const polys = E.filter((e) => e.type === 'POLYLINE');
        assert.deepEqual(polys.map((p) => num(p, 70)), [1, 0, 1]);
        const vcount = polys.map((p) => { let i = E.indexOf(p) + 1, k = 0; while (E[i].type === 'VERTEX') { k++; i++; } return k; });
        assert.deepEqual(vcount, [4, 3, 72]);
        assert.match(app.val('window.__name'), /_jw\.dxf$/);
        // 日本語を表示する big font（無いと AutoCAD・互換ソフトで「?」になる）
        const st = tableOf(T, 'STYLE')[0];
        assert.deepEqual([get(st, 2), get(st, 3), get(st, 4)], ['STANDARD', 'txt', 'extfont2.shx']);
    });

    for (const unit of ['m', 'mm']) {
        it(`長さは mm（図面の単位 ${unit}）: 座標・半径・文字の高さ・$LTSCALE・$EXTMIN/$EXTMAX`, () => {
            reset(app, unit);
            const f = unit === 'm' ? 1000 : 1;
            app.eval(`entities.push(
                { type: 'LINE', layer: 0, color: null, x1: 1, y1: 2, x2: 31, y2: 2 },
                { type: 'CIRCLE', layer: 0, color: null, cx: 5, cy: 6, radius: 2.5 },
                { type: 'TEXT', layer: 0, color: null, x: 1, y: 2, text: 'A', height: 0.5 });`);
            const T = tagsOf(sjis(exportBytes(app)));
            const E = entitiesOf(T);
            const ln = E.find((e) => e.type === 'LINE');
            assert.deepEqual([10, 20, 11, 21].map((c) => num(ln, c)), [1 * f, 2 * f, 31 * f, 2 * f]);
            const ci = E.find((e) => e.type === 'CIRCLE');
            assert.deepEqual([num(ci, 10), num(ci, 20), num(ci, 40)], [5 * f, 6 * f, 2.5 * f]);
            assert.equal(num(E.find((e) => e.type === 'TEXT'), 40), 0.5 * f);
            const lts = app.val('getDrawingLtscale()');
            assert.ok(near(Number(header(T, '$LTSCALE')[0][1]), lts * f, 1e-9), '$LTSCALE');
            assert.equal(Number(header(T, '$LTSCALE')[0][1]), 500, '初めの線種の尺度は、どちらの単位でも 500（mm）');
            assert.deepEqual(header(T, '$INSUNITS'), [[' 70', '4']]);
            // 範囲は、図形の外接の四角（文字は回転しても入る広め）の mm
            const bb = app.val(`(() => { const b = entities.map(e => calcBBox(e)); return [Math.min(...b.map(q => q.minX)), Math.min(...b.map(q => q.minY)), Math.max(...b.map(q => q.maxX)), Math.max(...b.map(q => q.maxY))]; })()`);
            assert.ok(bb[2] === 31 && bb[3] === 8.5, '線・円の範囲');
            const mn = header(T, '$EXTMIN'), mx = header(T, '$EXTMAX');
            [Number(mn[0][1]), Number(mn[1][1]), Number(mx[0][1]), Number(mx[1][1])].forEach((v, i) => assert.ok(near(v, bb[i] * f, 1e-6), `範囲 ${i}: ${v}`));
            assert.equal(mn.length, 3);
        });
    }

    it('文字は Shift-JIS。Shift-JIS に無い記号は置き換える（⌀ → φ、m² → ㎡、㎥ → m3、㉑ → (21)、↔ → ⇔）。名前は「_」', () => {
        reset(app, 'm');
        app.eval(`layers.push({ name: '境界線', color: '#ffffff', visible: true }, { name: '✖非表示', color: '#ffffff', visible: true });
            entities.push({ type: 'TEXT', layer: 1, color: null, x: 0, y: 0, text: '境界杭 ⌀12 面積 3.5m² −1', height: 1 },
                { type: 'TEXT', layer: 2, color: null, x: 0, y: 5, text: '土量 12.5㎥ ⑳㉑㊿ ↔', height: 1 });`);
        const bytes = exportBytes(app);
        assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'UTF-8 のまま書いている');
        const text = sjis(bytes);
        const [tx, tx2] = entitiesOf(tagsOf(text)).filter((e) => e.type === 'TEXT');
        assert.equal(get(tx, 1), '境界杭 φ12 面積 3.5㎡ －1');
        assert.equal(get(tx, 8), '境界線');
        assert.equal(get(tx2, 1), '土量 12.5m3 ⑳(21)(50) ⇔');
        assert.equal(get(tx2, 8), '_非表示', '画層の名前に「?」');
        assert.deepEqual(tableOf(tagsOf(text), 'LAYER').map((e) => get(e, 2)), ['0', '境界線', '_非表示', '寸法']);
        assert.ok(!text.includes('?'), '表せない文字（?）がある');
        // 「境」は Shift-JIS で 0x8B 0xAB
        assert.ok(bytes.includes(Buffer.from([0x8B, 0xAB])));
    });

    it('測点は POINT（Z ＝ 標高の mm）と点名の文字', () => {
        for (const unit of ['m', 'mm']) {
            reset(app, unit);
            app.eval(`addSurveyData([{ num: '1', name: 'KP1', X: 10.5, Y: 20.25, z: 3.456 }, { num: '2', name: '境界2', X: -4, Y: 5, z: null }], []);`);
            const p0 = app.val(`(() => { const p = entities.find(e => e.type === 'POINT' && e.name === 'KP1'); return { x: p.x, y: p.y }; })()`);
            const f = unit === 'm' ? 1000 : 1;
            const E = entitiesOf(tagsOf(sjis(exportBytes(app))));
            const pts = E.filter((e) => e.type === 'POINT');
            assert.equal(pts.length, 2);
            assert.ok(near(num(pts[0], 10), p0.x * f, 1e-6) && near(num(pts[0], 20), p0.y * f, 1e-6));
            assert.ok(near(num(pts[0], 30), 3456, 1e-6), `Z ${get(pts[0], 30)}`);
            assert.equal(num(pts[1], 30), 0);
            const names = E.filter((e) => e.type === 'TEXT').map((e) => get(e, 1));
            assert.ok(names.includes('KP1') && names.includes('境界2'), names.join(','));
        }
    });

    it('複数行の文字は1行ずつの TEXT（アプリと同じく文字の 1.4 倍ずつ下へ）。揃えは 72・73 と 11', () => {
        reset(app, 'm');
        app.eval(`entities.push({ type: 'TEXT', layer: 0, color: null, x: 1, y: 2, text: '1行目\\n2行目', height: 0.5, rotation: Math.PI / 2, halign: 'center', valign: 'middle' });`);
        const tx = entitiesOf(tagsOf(sjis(exportBytes(app)))).filter((e) => e.type === 'TEXT');
        assert.deepEqual(tx.map((e) => get(e, 1)), ['1行目', '2行目']);
        assert.deepEqual(tx.map((e) => [num(e, 72), num(e, 73)]), [[1, 2], [1, 2]]);
        // 90° 回した文字の「下」は +X
        assert.ok(near(num(tx[0], 11), 1000, 1e-6) && near(num(tx[0], 21), 2000, 1e-6));
        assert.ok(near(num(tx[1], 11), 1000 + 700, 1e-6) && near(num(tx[1], 21), 2000, 1e-6));
        assert.ok(near(num(tx[1], 50), 90, 1e-9));
    });

    it('寸法は、画層「寸法」の線・矢印（SOLID）・文字（直径の ⌀ は φ）。形はアプリの寸法と同じ', () => {
        reset(app, 'm');
        app.eval(`entities.push({ type: 'DIMENSION', subType: 'LINEAR', dimDir: 'H', layer: 0, color: null, p1: { x: 0, y: 0 }, p2: { x: 30, y: 20 }, offset: -3 },
            { type: 'DIMENSION', subType: 'DIAMETER', layer: 0, color: null, center: { x: 70, y: 0 }, radius: 4, angle: 1 });`);
        const prims = app.val(`(() => { const k = dimExportTextHeight() / DIM_TEXT_SIZE; return entities.map(e => dimExportPrims(e, k)); })()`);
        const E = entitiesOf(tagsOf(sjis(exportBytes(app))));
        assert.ok(E.every((e) => get(e, 8) === '寸法'));
        const lines = E.filter((e) => e.type === 'LINE'), solids = E.filter((e) => e.type === 'SOLID'), texts = E.filter((e) => e.type === 'TEXT');
        const want = prims.flatMap((p) => p.lines);
        assert.equal(lines.length, want.length);
        lines.forEach((l, i) => assert.ok([10, 20, 11, 21].every((c, j) => near(num(l, c), [want[i].x1, want[i].y1, want[i].x2, want[i].y2][j] * 1000, 1e-6))));
        assert.equal(solids.length, prims.reduce((a, p) => a + p.arrows.length, 0));
        // 矢印の先は、寸法の矢印の位置
        const tips = prims.flatMap((p) => p.arrows);
        solids.forEach((s, i) => assert.ok(near(num(s, 10), tips[i].x * 1000, 1e-6) && near(num(s, 20), tips[i].y * 1000, 1e-6)));
        assert.deepEqual(texts.map((t) => get(t, 1)), prims.flatMap((p) => p.texts.map((t) => t.s.replace(/⌀/g, 'φ'))));
        assert.match(get(texts[1], 1), /^φ/);
    });

    it('座標寸法の2段（X・Y）は、DXF では文字の高さの 1.4 倍あける（重ならない）。画面・印刷の間は今までどおり', () => {
        reset(app, 'm');
        app.eval(`entities.push({ type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:40,y:30}, leaderCoord:{x:45,y:35} });`);
        const tx = entitiesOf(tagsOf(sjis(exportBytes(app)))).filter((e) => e.type === 'TEXT');
        assert.deepEqual(tx.map((e) => get(e, 1)), ['X: 30', 'Y: 40']);
        const h = num(tx[0], 40);
        assert.ok(near(num(tx[0], 21) - num(tx[1], 21), h * 1.4, 1e-6), `間 ${num(tx[0], 21) - num(tx[1], 21)}（高さ ${h}）`);
        const scr = app.val(`(() => { const d = dimExportPrims(entities[0], 0.1).texts; return { gap: d[0].y - d[1].y, dk: dimSizePx(DIM_TEXT_SIZE) / DIM_TEXT_SIZE }; })()`);
        assert.ok(near(scr.gap, 14 * scr.dk * 0.1, 1e-9), '画面・印刷の間が変わった');
    });

    it('塗りつぶし（穴あき）は SOLID の台形。台形の面積の合計＝外の輪−穴、穴の中には置かない', () => {
        reset(app, 'm');
        app.eval(`entities.push({ type: 'HATCH', layer: 0, color: null, target: { type: 'PLINE', closed: true,
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 6 }, { x: 4, y: 10 }, { x: -1, y: 5 }],
            holes: [[{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 5 }, { x: 3, y: 5 }]] } });`);
        const E = entitiesOf(tagsOf(sjis(exportBytes(app))));
        const S = E.filter((e) => e.type === 'SOLID');
        assert.ok(S.length > 0 && S.length === E.length);
        const shoelace = (p) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y; }, 0)) / 2;
        const want = shoelace([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 6 }, { x: 4, y: 10 }, { x: -1, y: 5 }]) - 4;
        let area = 0;
        S.forEach((s) => {
            const [x1, y1, x2, , x3, y3, x4] = [10, 20, 11, 21, 12, 22, 13].map((c) => num(s, c) / 1000);
            assert.ok(x2 >= x1 - 1e-9 && x4 >= x3 - 1e-9, '台形の左右が逆');
            area += ((x2 - x1) + (x4 - x3)) / 2 * (y3 - y1);
            const cx = (x1 + x2 + x3 + x4) / 4, cy = (y1 + y3) / 2;
            assert.ok(!(cx > 3 && cx < 5 && cy > 3 && cy < 5), '穴の中に台形がある');
        });
        assert.ok(near(area, want, 1e-6), `面積 ${area} ≠ ${want}`);
    });

    it('斜線などの模様は、輪で切った線（穴の中には引かない）。形の分からない模様は書かずに知らせる', () => {
        reset(app, 'm');
        app.eval(`entities.push({ type: 'HATCH', layer: 0, color: null, target: { type: 'PLINE', closed: true,
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], holes: [[{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }]] },
            pat: { name: 'ANSI31', lines: [{ a: Math.PI / 4, bx: 0, by: 0, ox: -0.5 * Math.SQRT2 / 2, oy: 0.5 * Math.SQRT2 / 2, d: [] }] } },
            { type: 'HATCH', layer: 0, color: null, target: { type: 'PLINE', closed: true, points: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }] }, pat: { name: 'AR-CONC', lines: [], dense: true } });`);
        app.eval(`commandLog.innerHTML = ''`);
        const E = entitiesOf(tagsOf(sjis(exportBytes(app))));
        const L = E.filter((e) => e.type === 'LINE');
        assert.ok(L.length > 20, `線 ${L.length}本`);
        assert.equal(E.length, L.length, '形の分からない模様を書いている');
        L.forEach((l) => {
            const [x1, y1, x2, y2] = [10, 20, 11, 21].map((c) => num(l, c) / 1000);
            [[x1, y1], [x2, y2]].forEach(([x, y]) => assert.ok(x >= -1e-6 && x <= 10 + 1e-6 && y >= -1e-6 && y <= 10 + 1e-6, `範囲の外 ${x},${y}`));
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            assert.ok(!(mx > 4 + 1e-6 && mx < 6 - 1e-6 && my > 4 + 1e-6 && my < 6 - 1e-6), '穴の中に線がある');
            assert.ok(near(Math.abs(Math.atan2(y2 - y1, x2 - x1)), Math.PI / 4, 1e-9) || near(Math.abs(Math.atan2(y2 - y1, x2 - x1)), Math.PI * 3 / 4, 1e-9));
        });
        assert.match(app.val('commandLog.textContent'), /未対応の図形 1個/);
    });

    it('画層・線種・色: 線種表（模様つき）、画層の色（隠した画層は負）と線種、図形の色・線種。名前に使えない文字は「_」', () => {
        reset(app, 'm');
        app.eval(`layers.push({ name: 'A/B', color: '#ff0000', visible: false, lt: 'dashed' });
            entities.push({ type: 'LINE', layer: 1, color: '#00ff00', lt: 'Center', x1: 0, y1: 0, x2: 1, y2: 0 }, { type: 'LINE', layer: 1, color: null, x1: 0, y1: 1, x2: 1, y2: 1 });`);
        const T = tagsOf(sjis(exportBytes(app)));
        const LT = tableOf(T, 'LTYPE');
        const ltName = (e) => get(e, 2);
        assert.deepEqual(LT.map(ltName).sort(), ['CENTER', 'CONTINUOUS', 'DASHED']);
        LT.forEach((e) => {
            const pat = app.val(`ltypePattern(${JSON.stringify(ltName(e))}) || []`);
            assert.deepEqual(e.tags.filter(([c]) => c === 49).map(([, v]) => Number(v)), pat, ltName(e));
            assert.equal(num(e, 73), pat.length);
            assert.ok(near(num(e, 40), pat.reduce((a, v) => a + Math.abs(v), 0), 1e-9));
        });
        const LY = tableOf(T, 'LAYER');
        assert.deepEqual(LY.map((e) => get(e, 2)), ['0', 'A_B', '寸法']);
        const ab = LY[1];
        assert.equal(num(ab, 62), -1);
        assert.equal(get(ab, 6), 'DASHED');
        const E = entitiesOf(T).filter((e) => e.type === 'LINE');
        assert.deepEqual(E.map((e) => [get(e, 8), get(e, 6), get(e, 62)]), [['A_B', 'CENTER', '3'], ['A_B', undefined, undefined]]);
    });

    it('読み直すと同じ形（単位は mm として開く）。時計回りの円弧も同じ所を通る', () => {
        reset(app, 'm');
        app.eval(`entities.push(
            { type: 'LINE', layer: 0, color: null, x1: 1, y1: 2, x2: 31, y2: 2 },
            { type: 'ARC', layer: 0, color: null, cx: 5, cy: 5, radius: 3, startAngle: Math.PI / 2, endAngle: 0, counterclockwise: false },
            { type: 'PLINE', layer: 0, color: null, points: [{ x: 0, y: 0 }, { x: 1, y: 1.5 }, { x: 2, y: 0 }], closed: true },
            { type: 'TEXT', layer: 0, color: null, x: 1, y: 2, text: '境界', height: 0.5 });`);
        const text = sjis(exportBytes(app));
        app.window.__t = text;
        app.eval(`(() => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); _importMode = 'fresh';
            const p = new window.DxfParser(); registerExtraDxfHandlers(p, window.__t); importDxfData(p.parseSync(window.__t), { skipUndo: true, text: window.__t }); })()`);
        assert.equal(app.val('getSurveyUnit()'), 'mm');
        const ents = app.val('entities.map(e => Object.assign({}, e, { bbox: undefined }))');
        const ln = ents.find((e) => e.type === 'LINE');
        assert.deepEqual([ln.x1, ln.y1, ln.x2, ln.y2], [1000, 2000, 31000, 2000]);
        const arc = ents.find((e) => e.type === 'ARC');
        assert.ok(near(arc.cx, 5000, 1e-6) && near(arc.radius, 3000, 1e-6));
        // 円弧の中ほど（45°）を通る
        const mid = app.val(`(() => { const a = entities.find(e => e.type === 'ARC'); const s = a.startAngle, e2 = a.endAngle; let d = a.counterclockwise === false ? s - e2 : e2 - s; while (d < 0) d += Math.PI * 2; const m = a.counterclockwise === false ? s - d / 2 : s + d / 2; return m; })()`);
        assert.ok(near(((mid % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), Math.PI / 4, 1e-9), `中ほど ${mid}`);
        const pl = ents.find((e) => e.type === 'PLINE');
        assert.equal(pl.closed, true);
        assert.deepEqual(pl.points.map((p) => [p.x, p.y]), [[0, 0], [1000, 1500], [2000, 0]]);
        const tx = ents.find((e) => e.type === 'TEXT');
        assert.equal(tx.text, '境界');
        assert.ok(near(tx.height, 500, 1e-9));
    });

    it('☰ メニュー・コマンド（DXFJW）・お気に入りから書き出せる', () => {
        assert.equal(app.val(`!!document.querySelector('#top-menu-modal [data-fav="DXFJW"]')`), true);
        assert.equal(app.val(`FAV_CATALOG.some(f => f.id === 'DXFJW')`), true);
        app.eval(`window.__called = 0; window.__orig = window.exportDxfJw; window.exportDxfJw = () => { window.__called++; };`);
        try {
            assert.equal(app.val(`processIOCommand('DXFJW')`), true);
            assert.equal(app.val(`processIOCommand('EXPORTDXFJW')`), true);
            app.eval(`FAV_CATALOG.find(f => f.id === 'DXFJW').run()`);
            assert.equal(app.val('window.__called'), 3);
        } finally { app.eval('window.exportDxfJw = window.__orig'); }
    });
});
