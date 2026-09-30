'use strict';
// 値の監査 4: コマンドの記録（点の座標・動かした量）と、コマンド欄に入れた座標・距離の換算。
// 約束: 点の座標を書く記録は、画面の座標表示・座標寸法と同じ「X（北）・Y（東）」の順で、「X … Y …」とラベルを付ける。
//   以前は「(東,北)」とラベル無しで書いていたため、同じ点が、記録では (29510,2)・基点測定では X2 Y29510 と、食い違って読めた。
// 期待値は tests/helpers/values-oracle.cjs の独立した式で求める。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const O = require('./helpers/values-oracle.cjs');
const { PER_M, R, UCS_CASES, inUcs, coordDigits, lenText, configure, lastLog } = O;

describe('値の監査: コマンドの記録（点の座標は「X … Y …」・北が先）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    // 点（m・東 E・北 N）を、UCS で見て「X n  Y e」にした文字（記録の座標の桁。標準は m なら小数2桁、mm なら整数）
    const coordPair = (E, N, ucs, unit, cd) => {
        const u = inUcs(E, N, { oE: ucs.oE, oN: ucs.oN, th: R(ucs.deg) }), d = coordDigits(cd, 'loupe', unit);
        return `X ${(u.n * PER_M[unit]).toFixed(d)}  Y ${(u.e * PER_M[unit]).toFixed(d)}`;
    };
    const P = { E: 29.510405, N: 2.258371 };    // 見本の点（m）。2桁・3桁に丸めたとき、境目にならない値

    // 点を1つ入れたときの記録。run は、その点を入れるまでの操作（図面の単位 f を渡す）、want は期待する記録（座標の部分は {{p}}）
    const CASES = [
        { id: '線分の1点目', run: (f) => `processCommand('LINE'); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '1点目: {{p}}' },
        { id: '円の中心（手動）', run: (f) => `lastParams.circleMode = 'manual'; processCommand('CIRCLE'); hidePropertyPanel(); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '中心: {{p}} → 半径を決めて確定' },
        { id: '長方形の1点目', run: (f) => `processCommand('RECTANG'); hidePropertyPanel(); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '1点目: {{p}}' },
        { id: 'ポリラインの点', run: (f) => `processCommand('PLINE'); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '点追加: {{p}} [Enter:確定/C:閉合]' },
        { id: '楕円の中心', run: (f) => `processCommand('ELLIPSE'); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '中心: {{p}}' },
        { id: '回転の基点', run: (f) => `entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: ${f}, y2: 0 }); cmdState.highlightIdx = 0; processCommand('ROTATE'); hidePropertyPanel(); cmdState.presetAngleDeg = undefined; handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '基点: {{p}}。参照始点を指定' },
        { id: '平行寸法の1点目', run: (f) => `processCommand('DIMLINEAR'); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '1点目: {{p}}' },
        { id: '座標寸法の測定点', run: (f) => `processCommand('DIMORDINATE'); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '測定点: {{p}} - 引出先を指定' },
        { id: '基点測定の基点', run: (f) => `processCommand('MEASURE'); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '基点: {{p}} — 測る点をなぞってください' },
        { id: 'UCS の原点', run: (f) => `processCommand('UCS'); handlePointInput({ x: ${P.E * f}, y: ${P.N * f} }, true);`, want: '原点設定: {{w}}', world: true },
    ];

    it('点の座標を書く記録が、すべて「X（北）… Y（東）…」で、画面の座標表示と同じ値・同じ順になる', () => {
        const bad = []; let n = 0;
        for (const du of ['m', 'mm']) for (const cu of ['auto', 'm', 'mm']) for (const cd of ['std', '0', '3']) for (const ucs of [UCS_CASES[0], UCS_CASES[2]]) {
            const f = PER_M[du], unit = cu === 'auto' ? du : cu;
            for (const c of CASES) {
                configure(app, { du, prefs: { coordUnit: cu, coordDecimals: cd }, ucs });
                app.eval(c.run(f));
                const got = lastLog(app);
                // 原点の設定は、新しい原点の座標（WCS の値）を書く
                const pair = c.world ? coordPair(P.E, P.N, { oE: 0, oN: 0, deg: 0 }, unit, cd) : coordPair(P.E, P.N, ucs, unit, cd);
                const want = c.want.replace('{{p}}', pair).replace('{{w}}', pair + '（WCS）');
                n++;
                if (got !== want) bad.push(`${c.id} / 図面 ${du}・座標 ${cu}・桁 ${cd}・${ucs.name}: 出た「${got}」 / 期待「${want}」`);
            }
        }
        assert.ok(n >= 300, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 10), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('移動・複写の記録は、動かした量を UCS の X（北）・Y（東）で書く', () => {
        const bad = []; let n = 0;
        // 基点から 北へ 4.0m・東へ 3.0m（UCS を 30° 回していても、UCS の向きで見た量）
        for (const du of ['m', 'mm']) for (const lu of ['auto', 'm', 'mm']) for (const ucs of [UCS_CASES[0], UCS_CASES[2]]) for (const cmd of ['MOVE', 'COPY']) {
            const f = PER_M[du], unit = lu === 'auto' ? du : lu, th = R(ucs.deg);
            configure(app, { du, prefs: { lenUnit: lu }, ucs });
            // UCS の向きで「北へ 4m・東へ 3m」動かす（図面の座標では、UCS の角度ぶん回った量）
            const dWx = 3 * Math.cos(th) - 4 * Math.sin(th), dWy = 3 * Math.sin(th) + 4 * Math.cos(th);
            app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: ${f}, y2: 0 }); cmdState.highlightIdx = 0; processCommand('${cmd}');
                handlePointInput({ x: ${10 * f}, y: ${10 * f} }, true); handlePointInput({ x: ${(10 + dWx) * f}, y: ${(10 + dWy) * f} }, true);`);
            const suf = lu === 'auto' ? '' : unit;
            const word = cmd === 'MOVE' ? '移動' : 'コピー';
            const want = `1個を${word} X ${lenText(4, unit, 'auto')}${suf}  Y ${lenText(3, unit, 'auto')}${suf}`;
            n++;
            if (lastLog(app) !== want) bad.push(`${cmd} 図面 ${du}・長さ ${lu}・${ucs.name}: 出た「${lastLog(app)}」 / 期待「${want}」`);
        }
        assert.deepEqual(bad.slice(0, 10), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});

describe('値の監査: コマンド欄に入れた座標・距離が、正しい位置・大きさになる', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('「X,Y」（北,東）と「@X,Y」（北へ,東へ）と半径が、座標の単位・長さの単位・UCS をまたいで、独立した計算と同じ', () => {
        const bad = []; let n = 0;
        for (const du of ['m', 'mm']) for (const cu of ['auto', 'm', 'mm']) for (const lu of ['auto', 'm', 'mm']) for (const ucs of UCS_CASES) {
            const f = PER_M[du], cUnit = cu === 'auto' ? du : cu, lUnit = lu === 'auto' ? du : lu, th = R(ucs.deg);
            configure(app, { du, prefs: { coordUnit: cu, lenUnit: lu }, ucs });
            const tag = `図面 ${du}・座標 ${cu}・長さ ${lu}・${ucs.name}`;
            // 「X,Y」: UCS の 北 12.5m・東 30.25m の点。UCS を回した図面の座標にもどす
            const X = 12.5, Y = 30.25;
            app.eval(`processCommand('LINE'); processCommand('${X * PER_M[cUnit]},${Y * PER_M[cUnit]}');`);
            const wantW = { E: ucs.oE + Y * Math.cos(th) - X * Math.sin(th), N: ucs.oN + Y * Math.sin(th) + X * Math.cos(th) };
            const s = app.val('cmdState.startWcs');
            n++; if (Math.abs(s.x / f - wantW.E) > 1e-6 || Math.abs(s.y / f - wantW.N) > 1e-6) bad.push(`X,Y ${tag}: 出た (${s.x / f}, ${s.y / f}) / 期待 (${wantW.E}, ${wantW.N})`);
            // 「@X,Y」: 直前の点から、UCS の北へ 4m・東へ 3m（長さの単位）
            app.eval(`processCommand('@${4 * PER_M[lUnit]},${3 * PER_M[lUnit]}');`);
            const l = app.val('entities[entities.length - 1]');
            const dxw = 3 * Math.cos(th) - 4 * Math.sin(th), dyw = 3 * Math.sin(th) + 4 * Math.cos(th);
            n++; if (!l || Math.abs((l.x2 - l.x1) / f - dxw) > 1e-6 || Math.abs((l.y2 - l.y1) / f - dyw) > 1e-6) bad.push(`@X,Y ${tag}: 出た ${l && JSON.stringify([l.x2 - l.x1, l.y2 - l.y1])} / 期待 ${[dxw * f, dyw * f]}`);
            // 円の半径（手動の円: 中心を決めてから、数だけ入れる）
            configure(app, { du, prefs: { coordUnit: cu, lenUnit: lu }, ucs });
            app.eval(`lastParams.circleMode = 'manual'; processCommand('CIRCLE'); hidePropertyPanel(); handlePointInput({ x: 0, y: 0 }, true); processCommand('${(1.5 * PER_M[lUnit])}');`);
            const r = app.val(`entities.filter((e) => e.type === 'CIRCLE')[0]`);
            n++; if (!r || Math.abs(r.radius / f - 1.5) > 1e-9) bad.push(`半径 ${tag}: 出た ${r && r.radius / f}m / 期待 1.5m`);
        }
        assert.ok(n >= 150, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 10), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
