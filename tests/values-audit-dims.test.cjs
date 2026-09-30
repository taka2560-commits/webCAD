'use strict';
// 値の監査 1: 寸法の文字（画面・DXF 出力）と、基点測定（測ったままの表示・記録・記入した寸法）。
// 期待値は tests/helpers/values-oracle.cjs の独立した式で求める（アプリの関数は使わない）。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const O = require('./helpers/values-oracle.cjs');
const { PER_M, R, DIMS, UCS_CASES, expectedTexts, measText, configure, drawnTexts, lastLog, installAuditDim } = O;

describe('値の監査: 寸法の文字（画面・DXF 出力）', () => {
    let app;
    before(async () => { app = await loadApp(); installAuditDim(app); });
    after(() => app.close());

    function setup(c) {
        configure(app, { du: c.du, ucs: c.ucs, rot: c.rot, prefs: { lenUnit: c.lu, coordUnit: c.cu, dimDecimals: c.dd, angleFormat: c.af } });
    }
    function* combos(opts) {
        for (const du of ['m', 'mm']) for (const lu of opts.lu) for (const cu of opts.cu) for (const dd of opts.dd) for (const af of opts.af) for (const ucs of opts.ucs) yield { du, lu, cu, dd, af, ucs };
    }
    const label = (c, d) => `${d.id} / 図面 ${c.du}・長さ ${c.lu}・座標 ${c.cu}・桁 ${c.dd}・角度 ${c.af}・${c.ucs.name}`;

    it('すべての寸法 × 図面の単位 × 表示の単位 × 桁 × UCS: 画面と DXF の文字が独立した計算と同じ', () => {
        const bad = []; let n = 0;
        for (const c of combos({ lu: ['auto', 'm', 'mm'], cu: ['auto', 'm', 'mm'], dd: ['auto', '0', '1', '2', '3'], af: ['deg', 'dms'], ucs: UCS_CASES })) {
            setup(c);
            for (const d of DIMS) {
                const got = app.val(`window.__auditDim(${JSON.stringify(d.e(PER_M[c.du]))})`);
                const want = expectedTexts(d, c);
                n += 2;
                if (JSON.stringify(got.screen) !== JSON.stringify(want)) bad.push(`画面 ${label(c, d)}: 出た ${JSON.stringify(got.screen)} / 期待 ${JSON.stringify(want)}`);
                if (JSON.stringify(got.dxf) !== JSON.stringify(want)) bad.push(`DXF ${label(c, d)}: 出た ${JSON.stringify(got.dxf)} / 期待 ${JSON.stringify(want)}`);
            }
        }
        assert.ok(n > 5000, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('画面を回しても（PLAN）、寸法の値は変わらない', () => {
        const bad = [];
        for (const rot of [0, R(30), R(-75), R(180)]) {
            const c = { du: 'mm', lu: 'auto', cu: 'auto', dd: 'auto', af: 'deg', ucs: UCS_CASES[2], rot };
            setup(c);
            for (const d of DIMS) {
                const got = app.val(`window.__auditDim(${JSON.stringify(d.e(1000))})`).screen;
                const want = expectedTexts(d, c);
                if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`回転 ${Math.round(rot * 180 / Math.PI)}° ${d.id}: 出た ${JSON.stringify(got)} / 期待 ${JSON.stringify(want)}`);
            }
        }
        assert.deepEqual(bad.slice(0, 12), []);
    });

    it('文字を書き換えた寸法は、その文字のまま出る（画面も DXF も。座標寸法は1行）', () => {
        const bad = [];
        for (const d of DIMS) {
            if (d.kind === 'coordOld') continue;
            setup({ du: 'mm', lu: 'auto', cu: 'auto', dd: 'auto', af: 'deg', ucs: UCS_CASES[0] });
            const e = Object.assign(d.e(1000), { textOverride: '約12m' });
            const got = app.val(`window.__auditDim(${JSON.stringify(e)})`);
            if (JSON.stringify(got.screen) !== JSON.stringify(['約12m'])) bad.push(`画面 ${d.id}: 出た ${JSON.stringify(got.screen)}`);
            if (JSON.stringify(got.dxf) !== JSON.stringify(['約12m'])) bad.push(`DXF ${d.id}: 出た ${JSON.stringify(got.dxf)}`);
        }
        assert.deepEqual(bad, []);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});

describe('値の監査: 基点測定（測ったままの表示・記録・記入した寸法）', () => {
    let app;
    before(async () => { app = await loadApp(); installAuditDim(app); });
    after(() => app.close());

    it('X距離・Y距離・直線距離: 画面の表示・コマンドの記録・記入した3つの寸法が、独立した計算と同じ', () => {
        // 基点から見て、西へ 12.3456m・南へ 7.891m の点（向きが逆でも、距離は正の値で出る）
        const base = { E: 100.25, N: 50.5 }, tgt = { E: 100.25 - 12.3456, N: 50.5 - 7.891 };
        const dE = Math.abs(tgt.E - base.E), dN = Math.abs(tgt.N - base.N), dL = Math.hypot(dE, dN);
        const bad = []; let n = 0;
        for (const du of ['m', 'mm']) for (const lu of ['auto', 'm', 'mm']) for (const dd of ['auto', '0', '1', '2', '3']) for (const ucs of [UCS_CASES[0], UCS_CASES[2]]) {
            const f = PER_M[du], unit = lu === 'auto' ? du : lu, fm = (v) => measText(v, unit, dd);
            const tag = `図面 ${du}・長さ ${lu}・桁 ${dd}・${ucs.name}`;
            configure(app, { du, prefs: { lenUnit: lu, dimDecimals: dd }, ucs });
            app.eval(`processCommand('MEASURE'); handlePointInput({ x: ${base.E * f}, y: ${base.N * f} }, true);
                snapResult = null; mouse.wcsX = ${tgt.E * f}; mouse.wcsY = ${tgt.N * f};`);
            // 画面: 測っている途中の3つの値（基点測定は図面本来の軸 X＝北・Y＝東で測る。UCS を回していても同じ）
            const want = [`Y ${fm(dE)}${unit}`, `X ${fm(dN)}${unit}`, `${fm(dL)}${unit}`];
            const got = drawnTexts(app, false);
            n++; if (JSON.stringify(got.slice().sort()) !== JSON.stringify(want.slice().sort())) bad.push(`画面 ${tag}: 出た ${JSON.stringify(got)} / 期待 ${JSON.stringify(want)}`);
            // 記録: 測定中にタップすると、いま測っている値を記録する
            app.eval('handlePointInput({ x: 0, y: 0 }, true)');
            const wantLog = `測定: X ${fm(dN)}${unit} / Y ${fm(dE)}${unit} / 直線 ${fm(dL)}${unit}`;
            n++; if (lastLog(app) !== wantLog) bad.push(`記録 ${tag}: 出た ${lastLog(app)} / 期待 ${wantLog}`);
            // 記入した3つの寸法（横＝Y東西、縦＝X南北、直線）の文字
            app.eval('measureWriteDims(); resetCommand();'); // 測定を終えてから（途中の表示が重ならないように）描く
            const dims = app.val('entities.filter((e) => e.type === "DIMENSION")');
            n++; if (dims.length !== 3) { bad.push(`記入 ${tag}: 寸法が ${dims.length} 個`); continue; }
            const wantDim = { 'LINEAR-H': fm(dE), 'LINEAR-V': fm(dN), 'ALIGNED-': fm(dL) };
            for (const d of dims) {
                const key = d.subType + '-' + (d.dimDir || '');
                const got1 = app.val(`window.__auditDim(${JSON.stringify(d)})`);
                n += 2;
                if (JSON.stringify(got1.screen) !== JSON.stringify([wantDim[key]])) bad.push(`寸法 ${key} ${tag}: 出た ${JSON.stringify(got1.screen)} / 期待 ${wantDim[key]}`);
                if (JSON.stringify(got1.dxf) !== JSON.stringify([wantDim[key]])) bad.push(`DXF ${key} ${tag}: 出た ${JSON.stringify(got1.dxf)} / 期待 ${wantDim[key]}`);
            }
        }
        assert.ok(n >= 500, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
