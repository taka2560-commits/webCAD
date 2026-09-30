'use strict';
// 値の監査 5: 取り込んだ DXF・DWG の寸法の値（図形が無く、値の文字だけ置く寸法）。
// 約束: ファイルの単位（INSUNITS。4＝mm、6＝m）のまま、m は小数3桁まで（末尾の0は省く）、mm は整数（どちらも 1mm まで）。
//   半径は「R」、直径は「⌀」を付け、角度はラジアンを度にして「°」を付ける。
//   以前は DWG が測定値を整数に丸めていて（m の図面の 1.484 が「1」）、DXF は小数2桁（1.48）だった。
// 期待値は独立した式で求める。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const O = require('./helpers/values-oracle.cjs');
const { PER_M, R, autoNum, configure } = O;

// 見本（値は m。ファイルの単位に直して入れる）。kind: 寸法の種類
const DIM_CASES = [
    { id: '線寸法（回転）', kind: 'linear', dxfType: 0, dwg: 'AcDbRotatedDimension', vM: 12.3456, want: (u) => autoNum(12.3456 * PER_M[u], u) },
    { id: '整列寸法', kind: 'linear', dxfType: 1, dwg: 'AcDbAlignedDimension', vM: 7.8912, want: (u) => autoNum(7.8912 * PER_M[u], u) },
    { id: '半径寸法', kind: 'radius', dxfType: 4, dwg: 'AcDbRadialDimension', vM: 2.4567, want: (u) => 'R' + autoNum(2.4567 * PER_M[u], u) },
    { id: '直径寸法', kind: 'diameter', dxfType: 3, dwg: 'AcDbDiametricDimension', vM: 4.9134, want: (u) => '⌀' + autoNum(4.9134 * PER_M[u], u) },
    { id: '座標寸法', kind: 'ordinate', dxfType: 6 + 64, dwg: 'AcDbOrdinateDimension', vM: 29.510405, want: (u) => autoNum(29.510405 * PER_M[u], u) },
    { id: '角度寸法（3点）', kind: 'angular', dxfType: 5, dwg: 'AcDb3PointAngularDimension', rad: R(45.5), want: () => '45.5°' },
    { id: '角度寸法（2直線）', kind: 'angular', dxfType: 2, dwg: 'AcDb2LineAngularDimension', rad: R(12.25), want: () => '12.3°' },
];

describe('値の監査: 取り込んだ DXF の寸法の値（図形が無いとき、値の文字だけ置く）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    // DXF の寸法（dxf-parser の形）を取り込んで、置かれた文字を返す
    function importDxfDim(c, unit, extra) {
        const meas = c.kind === 'angular' ? c.rad : c.vM * PER_M[unit];
        const dim = Object.assign({ type: 'DIMENSION', layer: '0', dimensionType: c.dxfType, actualMeasurement: meas, middleOfText: { x: 10 * PER_M[unit], y: 5 * PER_M[unit] }, anchorPoint: { x: 0, y: 0 }, text: '' }, extra || {});
        app.window.__dxf = { header: { $INSUNITS: unit === 'mm' ? 4 : 6 }, entities: [dim] };
        configure(app, { du: unit, prefs: {} });
        app.eval(`_importMode = 'fresh'; importDxfData(window.__dxf, { skipUndo: true })`);
        return app.val(`entities.filter((e) => e.type === 'TEXT').map((e) => e.text)`);
    }

    it('寸法の種類ごとに、値・接頭辞（R・⌀）・単位の桁が合う（m の図面も mm の図面も）', () => {
        const bad = [];
        for (const unit of ['m', 'mm']) for (const c of DIM_CASES) {
            const got = importDxfDim(c, unit), want = [c.want(unit)];
            if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${c.id}（${unit}）: 出た ${JSON.stringify(got)} / 期待 ${JSON.stringify(want)}`);
        }
        assert.deepEqual(bad, []);
    });

    it('文字を入れた寸法: 「<>」は測定値に置き換え、そうでなければその文字のまま', () => {
        const bad = [];
        for (const unit of ['m', 'mm']) {
            const c = DIM_CASES[0], v = autoNum(c.vM * PER_M[unit], unit);
            const cases = [['<>', v], ['約<>m', `約${v}m`], ['2-<>', `2-${v}`], ['ABC', 'ABC'], ['', v]];
            for (const [text, want] of cases) {
                const got = importDxfDim(c, unit, { text });
                if (JSON.stringify(got) !== JSON.stringify([want])) bad.push(`「${text}」（${unit}）: 出た ${JSON.stringify(got)} / 期待 ${want}`);
            }
        }
        assert.deepEqual(bad, []);
    });

    it('文字の高さは、ファイルの寸法の設定（DIMTXT×DIMSCALE）に合わせる（無いときは 2.5）', () => {
        const heights = (hdr) => {
            app.window.__dxf = { header: Object.assign({ $INSUNITS: 4 }, hdr), entities: [{ type: 'DIMENSION', layer: '0', dimensionType: 0, actualMeasurement: 1234, middleOfText: { x: 0, y: 0 }, anchorPoint: { x: 0, y: 0 }, text: '' }] };
            configure(app, { du: 'mm', prefs: {} });
            app.eval(`_importMode = 'fresh'; importDxfData(window.__dxf, { skipUndo: true })`);
            return app.val(`entities.filter((e) => e.type === 'TEXT').map((e) => e.height)`);
        };
        assert.deepEqual(heights({ $DIMTXT: 2.5, $DIMSCALE: 100 }), [250], '2.5 × 100');
        assert.deepEqual(heights({ $DIMTXT: 3 }), [3], 'DIMSCALE が無ければ 1');
        assert.deepEqual(heights({ $DIMTXT: 2.5, $DIMSCALE: 0 }), [2.5], 'DIMSCALE 0 は 1');
        assert.deepEqual(heights({}), [2.5], '設定が無ければ 2.5');
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});

describe('値の監査: 取り込んだ DWG の寸法の値', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    // DWG の寸法（libredwg-web の形）を取り込んで、置かれた文字を返す
    function importDwgDim(c, unit, extra, header) {
        const meas = c.kind === 'angular' ? c.rad : c.vM * PER_M[unit];
        const dim = Object.assign({ type: 'DIMENSION', subclassMarker: c.dwg, layer: '0', definitionPoint: { x: 0, y: 0 }, textPoint: { x: 10 * PER_M[unit], y: 5 * PER_M[unit] }, measurement: meas, text: '' }, extra || {});
        app.window.__db = { header: Object.assign({ INSUNITS: unit === 'mm' ? 4 : 6 }, header || {}), tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] } }, entities: [dim] };
        configure(app, { du: unit, prefs: {} });
        return app.val(`convertDwgDatabaseToApp(window.__db).entities.filter((e) => e.type === 'TEXT').map((e) => ({ text: e.text, height: e.height }))`);
    }

    it('寸法の種類ごとに、値・接頭辞（R・⌀）・単位の桁が合う（m の図面も mm の図面も）', () => {
        const bad = [];
        for (const unit of ['m', 'mm']) for (const c of DIM_CASES) {
            const got = importDwgDim(c, unit).map((t) => t.text), want = [c.want(unit)];
            if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${c.id}（${unit}）: 出た ${JSON.stringify(got)} / 期待 ${JSON.stringify(want)}`);
        }
        assert.deepEqual(bad, []);
    });

    it('文字を入れた寸法: 「<>」は測定値に置き換え、そうでなければその文字のまま', () => {
        const bad = [];
        for (const unit of ['m', 'mm']) {
            const c = DIM_CASES[0], v = autoNum(c.vM * PER_M[unit], unit);
            for (const [text, want] of [['<>', v], ['約<>m', `約${v}m`], ['ABC', 'ABC'], ['', v]]) {
                const got = importDwgDim(c, unit, { text }).map((t) => t.text);
                if (JSON.stringify(got) !== JSON.stringify([want])) bad.push(`「${text}」（${unit}）: 出た ${JSON.stringify(got)} / 期待 ${want}`);
            }
        }
        assert.deepEqual(bad, []);
    });

    it('文字の高さは、ファイルの寸法の設定（DIMTXT×DIMSCALE）に合わせる（無いときは 2.5）', () => {
        const c = DIM_CASES[0];
        assert.deepEqual(importDwgDim(c, 'mm', null, { DIMTXT: 2.5, DIMSCALE: 100 }).map((t) => t.height), [250]);
        assert.deepEqual(importDwgDim(c, 'mm', null, {}).map((t) => t.height), [2.5]);
    });

    it('単位が書かれていない DWG は、いまの図面の単位のまま', () => {
        const c = DIM_CASES[0], got = [];
        for (const unit of ['m', 'mm']) {
            app.window.__db = { header: {}, tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] } },
                entities: [{ type: 'DIMENSION', subclassMarker: c.dwg, layer: '0', definitionPoint: { x: 0, y: 0 }, textPoint: { x: 1, y: 1 }, measurement: c.vM * PER_M[unit], text: '' }] };
            configure(app, { du: unit, prefs: {} });
            got.push(app.val(`convertDwgDatabaseToApp(window.__db).entities.filter((e) => e.type === 'TEXT').map((e) => e.text)`)[0]);
        }
        assert.deepEqual(got, [autoNum(c.vM, 'm'), autoNum(c.vM * 1000, 'mm')]);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
