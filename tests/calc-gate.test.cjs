'use strict';
// 計算ゲート: 測量・作図の計算の関数を、独立に組み立てた答え（tests/helpers/calc-oracle.cjs）と照らす。
//   (a) 手で選んだ端の場合（0・負・軸に沿う・ほぼ平行・公共座標・ごく短い／長い距離・0/90/180/270/360° 付近・mm の図面）
//   (b) 種を決めた乱数の場合（関数ごとに 300 件以上）
// 許容誤差（このファイルの TOL）:
//   長さ・座標 1e-9 m（交わる角が浅いときは 1e-9 m ÷ sin(交わる角)）、角度 1e-9°、回転 1e-12 rad、
//   面積 1e-6 ㎡（公共座標の倍面積は数十億になるため）、ヘルマートの精度の値 相対 1e-6、
//   平面直角座標 1e-6 m（順）・1e-10°（逆）・往復 1e-9°、地積の文字は完全一致
// 新しい計算の関数を足したら、下の CALC_FUNCS に入れて照合を足す（入れないと最後の「登録の点検」が落ちる）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');
const O = require('./helpers/calc-oracle.cjs');

const TOL = {
    len: 1e-9,          // m（座標・距離）
    deg: 1e-9,          // 度（方向角）
    rad: 1e-12,         // ラジアン（回転）
    area: 1e-6,         // ㎡
    rel: 1e-6,          // 相対（標準偏差など）
    gk: 1e-6,           // m（平面直角座標の順変換）
    gkDeg: 1e-10,       // 度（平面直角座標の逆変換。約 0.01mm）
    trip: 1e-9,         // 度（往復）
};
const N_RANDOM = 300;

// ===== 照らし合わせの道具（いちばん大きかった差を覚えておき、最後に書き出す） =====
const STATS = {};
function note(name, err) { if(!(STATS[name] >= err)) STATS[name] = err; }
function closeTo(name, actual, expected, tol, ctx) {
    const err = Math.abs(actual - expected);
    note(name, err);
    if(!(err <= tol)) assert.fail(`${name}: アプリ ${actual} ／ 答え ${expected}（差 ${err} > 許容 ${tol}）${ctx === undefined ? '' : ' ' + JSON.stringify(ctx)}`);
}
function closeDeg(name, actual, expected, tol, ctx) {
    const err = O.angDiff(actual, expected);
    note(name, err);
    if(!(err <= tol)) assert.fail(`${name}: アプリ ${actual}° ／ 答え ${expected}°（差 ${err}° > 許容 ${tol}°）${ctx === undefined ? '' : ' ' + JSON.stringify(ctx)}`);
}
function closePt(name, a, e, tol, ctx, kx = 'X', ky = 'Y') {
    assert.ok(a && e, `${name}: 点がありません（アプリ ${JSON.stringify(a)} ／ 答え ${JSON.stringify(e)}）${JSON.stringify(ctx)}`);
    const err = Math.hypot(a[kx] - e[kx], a[ky] - e[ky]);
    note(name, err);
    if(!(err <= tol)) assert.fail(`${name}: アプリ (${a[kx]}, ${a[ky]}) ／ 答え (${e[kx]}, ${e[ky]})（差 ${err} > 許容 ${tol}）${ctx === undefined ? '' : ' ' + JSON.stringify(ctx)}`);
}
// 点の集まりを、近いもの同士で照らす（並びは問わない）
function closeSet(name, A, E, tol, ctx) {
    assert.equal(A.length, E.length, `${name}: 点の数が違います（アプリ ${JSON.stringify(A)} ／ 答え ${JSON.stringify(E)}）${JSON.stringify(ctx)}`);
    const used = new Set();
    A.forEach((a) => {
        let best = -1, bd = Infinity;
        E.forEach((e, k) => { if(used.has(k)) return; const d = Math.hypot(a.x - e.x, a.y - e.y); if(d < bd) { bd = d; best = k; } });
        used.add(best);
        note(name, bd);
        if(!(bd <= tol)) assert.fail(`${name}: アプリ ${JSON.stringify(a)} に近い答えがありません（差 ${bd} > 許容 ${tol}）${JSON.stringify(ctx)}`);
    });
}

// ===== 乱数の場合を作る道具 =====
// 公共座標の範囲（X −150000〜150000・Y −50000〜50000）か、原点の近く
function randBase(g) { return g.r() < 0.7 ? { X: g.u(-150000, 150000), Y: g.u(-50000, 50000) } : { X: g.u(-100, 100), Y: g.u(-100, 100) }; }
// 基点のまわりの点（距離は 1mm〜2km を対数で）
function randNear(g, b) { const d = Math.pow(10, g.u(-3, 3.3)), az = g.u(0, 360); return { X: b.X + d * Math.cos(az * O.D2R), Y: b.Y + d * Math.sin(az * O.D2R) }; }
// 星形の単純な多角形（重心のまわりに角度順）
function randPolygon(g, n, base, size) {
    const angs = Array.from({ length: n }, () => g.u(0, 2 * Math.PI)).sort((a, b) => a - b);
    return angs.map((t, i) => { const r = size * g.u(0.3, 1); return { name: 'P' + (i + 1), X: base.X + r * Math.cos(t), Y: base.Y + r * Math.sin(t) }; });
}

describe('計算ゲート（独立した答えとの照合）', () => {
    let app, W;
    before(async () => {
        app = await loadApp();
        W = app.window;
        app.eval(`localStorage.setItem('cad_survey_unit', 'm'); ucs = { originX: 0, originY: 0, angle: 0 };`);
    });
    after(() => {
        const lines = Object.keys(STATS).sort().map((k) => `  ${k}: 最大の差 ${STATS[k].toExponential(2)}`);
        console.log('計算ゲート: いちばん大きかった差\n' + lines.join('\n'));
        app.close();
    });
    const setUnit = (u) => app.eval(`localStorage.setItem('cad_survey_unit', '${u}')`);

    // ===================== 測量計算（cad-cogo.js） =====================
    it('cogoInverse: 距離・方向角（北から右回り）', () => {
        const cases = [
            [{ X: 0, Y: 0 }, { X: 0, Y: 0 }], [{ X: 0, Y: 0 }, { X: 10, Y: 0 }], [{ X: 0, Y: 0 }, { X: 0, Y: 10 }],
            [{ X: 0, Y: 0 }, { X: -10, Y: 0 }], [{ X: 0, Y: 0 }, { X: 0, Y: -10 }], [{ X: 0, Y: 0 }, { X: 1, Y: 1 }],
            [{ X: 0, Y: 0 }, { X: 1, Y: -1e-12 }], [{ X: 0, Y: 0 }, { X: 1, Y: 1e-12 }], [{ X: 0, Y: 0 }, { X: -1, Y: -1e-12 }],
            [{ X: -149999.9995, Y: 49999.9995 }, { X: -149999.9985, Y: 49999.9985 }], [{ X: 150000, Y: -50000 }, { X: -150000, Y: 50000 }],
            [{ X: 123456.789, Y: -34567.891 }, { X: 123456.789, Y: -34567.890 }], [{ X: 1e-7, Y: 0 }, { X: 0, Y: 1e-7 }],
        ];
        const g = O.rng(101);
        for(let i = 0; i < N_RANDOM; i++) { const a = randBase(g); cases.push([a, randNear(g, a)]); }
        cases.forEach(([a, b], k) => {
            const r = W.cogoInverse(a, b), e = O.inverse(a, b);
            closeTo('cogoInverse.dX', r.dX, e.dX, TOL.len, k); closeTo('cogoInverse.dY', r.dY, e.dY, TOL.len, k);
            closeTo('cogoInverse.dist', r.dist, e.dist, TOL.len, k);
            closeDeg('cogoInverse.az', r.az, e.az, TOL.deg, { k, a, b });
            assert.ok(r.az >= 0 && r.az < 360, `方向角は 0 以上 360 未満: ${r.az}`);
        });
        assert.equal(W.cogoInverse({ X: 5, Y: 5 }, { X: 5, Y: 5 }).az, 0);
    });

    it('cogoPolar: 方向角と距離で点を出す（0/90/180/270/360°・負の角・距離 0・負の距離）', () => {
        const cases = [[0, 10], [90, 10], [180, 10], [270, 10], [360, 10], [-90, 10], [450, 10], [45, 0], [30, -5], [359.9999999999, 1e5], [1e-10, 1e5], [89.9999999, 0.001]]
            .map(([az, d]) => [{ X: 120000.123, Y: -45000.456 }, az, d]);
        const g = O.rng(102);
        for(let i = 0; i < N_RANDOM; i++) cases.push([randBase(g), g.u(-720, 720), Math.pow(10, g.u(-3, 5))]);
        cases.forEach(([a, az, d], k) => closePt('cogoPolar', W.cogoPolar(a, az, d), O.polar(a, az, d), TOL.len, { k, az, d }));
        // 逆計算との往復
        cases.forEach(([a, az, d], k) => {
            if(!(d > 1e-3)) return;
            const r = W.cogoInverse(a, W.cogoPolar(a, az, d));
            closeTo('cogoPolar→cogoInverse.dist', r.dist, d, TOL.len, k);
            // 点の座標の丸め（公共座標で約 3e-11 m）が、短い距離では方向角のずれになる分を見込む
            closeDeg('cogoPolar→cogoInverse.az', r.az, az, TOL.deg + 1e-15 * Math.max(Math.abs(a.X), Math.abs(a.Y)) / d * 57.3, k);
        });
    });

    it('cogoAzFromBacksight: 後視を 0° とした夾角から方向角', () => {
        const cases = [[{ X: 0, Y: 0 }, { X: 10, Y: 0 }, 0], [{ X: 0, Y: 0 }, { X: 10, Y: 0 }, 90], [{ X: 0, Y: 0 }, { X: 0, Y: 10 }, 270],
            [{ X: 0, Y: 0 }, { X: 0, Y: 10 }, 270.0000000001], [{ X: 0, Y: 0 }, { X: -10, Y: 0 }, -180], [{ X: 0, Y: 0 }, { X: 1, Y: -1e-9 }, 1e-9], [{ X: 0, Y: 0 }, { X: 10, Y: 0 }, 720]];
        const g = O.rng(103);
        for(let i = 0; i < N_RANDOM; i++) { const s = randBase(g); cases.push([s, randNear(g, s), g.u(-400, 800)]); }
        cases.forEach(([s, b, ang], k) => {
            const r = W.cogoAzFromBacksight(s, b, ang);
            closeDeg('cogoAzFromBacksight', r, O.azFromBacksight(s, b, ang), TOL.deg, { k, ang });
            assert.ok(r >= 0 && r < 360);
        });
    });

    it('cogoIntersectLines: 2直線の交点（軸に沿う・平行・同じ点・ほぼ平行・公共座標）', () => {
        const P = (X, Y) => ({ X, Y });
        assert.equal(W.cogoIntersectLines(P(0, 0), P(10, 0), P(0, 5), P(10, 5)), null, '平行');
        assert.equal(W.cogoIntersectLines(P(0, 0), P(10, 0), P(20, 0), P(30, 0)), null, '同じ直線');
        assert.equal(W.cogoIntersectLines(P(1, 1), P(1, 1), P(0, 5), P(10, 5)), null, '長さ 0');
        closePt('cogoIntersectLines', W.cogoIntersectLines(P(0, 0), P(10, 0), P(5, -3), P(5, 7)), P(5, 0), TOL.len);
        closePt('cogoIntersectLines', W.cogoIntersectLines(P(-150000, -50000), P(-149990, -50000), P(-149000, -49990), P(-149000, -49980)), P(-149000, -50000), TOL.len);
        // ほぼ平行（交わる角 1e-6 rad）
        const nearPar = [P(100000, 30000), P(100100, 30000), P(100000, 30001), P(100100, 30001 + 100 * 1e-6)];
        const e0 = O.intersectLines(...nearPar);
        closePt('cogoIntersectLines.ほぼ平行', W.cogoIntersectLines(...nearPar), e0, TOL.len / e0.sin * 100, 'ほぼ平行');
        const g = O.rng(104);
        let n = 0;
        while(n < N_RANDOM) {
            const b = randBase(g), p1 = randNear(g, b), p2 = randNear(g, p1), p3 = randNear(g, b), p4 = randNear(g, p3);
            const e = O.intersectLines(p1, p2, p3, p4);
            if(!e || e.sin < 1e-3) continue;
            n++;
            const L = Math.max(...[p1, p2, p3, p4].map((p) => Math.hypot(p.X - e.X, p.Y - e.Y)));
            closePt('cogoIntersectLines', W.cogoIntersectLines(p1, p2, p3, p4), e, TOL.len * Math.max(1, L / 1000) / e.sin, { n });
        }
    });

    it('cogoIntersectAzimuths: 方向角の交会', () => {
        const P = (X, Y) => ({ X, Y });
        assert.equal(W.cogoIntersectAzimuths(P(0, 0), 30, P(10, 0), 30), null, '平行');
        assert.equal(W.cogoIntersectAzimuths(P(0, 0), 30, P(10, 0), 210), null, '逆向きの平行');
        closePt('cogoIntersectAzimuths', W.cogoIntersectAzimuths(P(0, 0), 90, P(10, 10), 180), P(0, 10), TOL.len);
        closePt('cogoIntersectAzimuths', W.cogoIntersectAzimuths(P(0, 0), 0, P(10, 10), 270), P(10, 0), TOL.len);
        closePt('cogoIntersectAzimuths', W.cogoIntersectAzimuths(P(0, 0), 45, P(0, 10), 135), P(5, 5), TOL.len); // 2本目は延長線上（後ろ）
        closePt('cogoIntersectAzimuths', W.cogoIntersectAzimuths(P(-120000, 40000), 360, P(-119990, 40010), 270), P(-119990, 40000), TOL.len);
        const g = O.rng(105);
        let n = 0;
        while(n < N_RANDOM) {
            const a = randBase(g), b = randNear(g, a), azA = g.u(0, 360), azB = g.u(-360, 720);
            const e = O.intersectAzimuths(a, azA, b, azB);
            if(!e || e.sin < 1e-3) continue;
            const L = Math.max(Math.hypot(a.X - e.X, a.Y - e.Y), Math.hypot(b.X - e.X, b.Y - e.Y));
            if(L > 1e5) continue;
            n++;
            // アプリは向きを「点＋長さ 1」で表すので、公共座標では向きが座標の丸め（約 3e-11）だけずれる分を見込む
            const big = Math.max(Math.abs(a.X), Math.abs(a.Y), Math.abs(b.X), Math.abs(b.Y));
            closePt('cogoIntersectAzimuths', W.cogoIntersectAzimuths(a, azA, b, azB), e, (TOL.len * Math.max(1, L / 1000) + L * 4e-16 * big) / e.sin, { n, azA, azB });
        }
    });

    it('cogoIntersectDistances: 距離の交会（右・左、接する、届かない）', () => {
        const P = (X, Y) => ({ X, Y });
        assert.equal(W.cogoIntersectDistances(P(0, 0), 3, P(10, 0), 3), null, '届かない');
        assert.equal(W.cogoIntersectDistances(P(0, 0), 20, P(10, 0), 3), null, '中に入る');
        assert.equal(W.cogoIntersectDistances(P(0, 0), 0, P(10, 0), 10), null, '距離 0');
        assert.equal(W.cogoIntersectDistances(P(1, 1), 5, P(1, 1), 5), null, '同じ点');
        // 北へ 10 の線: 右は東（Y＋）
        let r = W.cogoIntersectDistances(P(0, 0), 5 * Math.SQRT2, P(10, 0), 5 * Math.SQRT2);
        closePt('cogoIntersectDistances', r.right, P(5, 5), TOL.len); closePt('cogoIntersectDistances', r.left, P(5, -5), TOL.len);
        r = W.cogoIntersectDistances(P(0, 0), 4, P(10, 0), 6); // 外に接する
        closePt('cogoIntersectDistances', r.right, P(4, 0), TOL.len); closePt('cogoIntersectDistances', r.left, P(4, 0), TOL.len);
        r = W.cogoIntersectDistances(P(-150000, 50000), 5, P(-149997, 50004), 10); // 公共座標の 3-4-5
        const e = O.intersectDistances(P(-150000, 50000), 5, P(-149997, 50004), 10);
        closePt('cogoIntersectDistances', r.right, e.right, TOL.len); closePt('cogoIntersectDistances', r.left, e.left, TOL.len);
        const g = O.rng(106);
        for(let n = 0; n < N_RANDOM; n++) {
            // 交点 Q を先に決め、a・b からの距離を測る（Q での交わる角は 20°〜160°）
            const a = randBase(g), q = randNear(g, a);
            const daz = O.inverse(q, a).az + (g.r() < 0.5 ? 1 : -1) * g.u(20, 160), db = Math.pow(10, g.u(-1, 3.3));
            const b = O.polar(q, daz, db), da = O.inverse(a, q).dist;
            if(da < 0.1) { n--; continue; }
            const want = O.intersectDistances(a, da, b, O.inverse(b, q).dist), got = W.cogoIntersectDistances(a, da, b, O.inverse(b, q).dist);
            const L = Math.max(da, db), tol = TOL.len * Math.max(1, L / 100) * 10;
            closePt('cogoIntersectDistances', got.right, want.right, tol, { n, da, db });
            closePt('cogoIntersectDistances', got.left, want.left, tol, { n, da, db });
        }
    });

    it('cogoAreaTable: 座標求積（面積・周長・行ごとの Yn+1−Yn−1・積・辺長）', () => {
        const cases = [
            [{ name: 'A', X: 0, Y: 0 }, { name: 'B', X: 10, Y: 0 }, { name: 'C', X: 10, Y: 10 }, { name: 'D', X: 0, Y: 10 }],
            [{ name: 'A', X: 0, Y: 0 }, { name: 'B', X: 0, Y: 10 }, { name: 'C', X: 10, Y: 10 }, { name: 'D', X: 10, Y: 0 }],
            [{ name: 'A', X: -150000, Y: -50000 }, { name: 'B', X: -149999.999, Y: -50000 }, { name: 'C', X: -150000, Y: -49999.999 }],
            [{ name: 'A', X: 149000.123, Y: 49000.456 }, { name: 'B', X: 149100.789, Y: 49010.111 }, { name: 'C', X: 149090.222, Y: 49120.333 }, { name: 'D', X: 148995.444, Y: 49100.555 }],
        ];
        const g = O.rng(107);
        for(let i = 0; i < N_RANDOM; i++) cases.push(randPolygon(g, g.int(3, 20), randBase(g), Math.pow(10, g.u(0, 3))));
        cases.forEach((pts, k) => {
            const t = W.cogoAreaTable(pts), e = O.shoelace(pts), n = pts.length;
            const size = Math.max(...pts.map((p) => Math.hypot(p.X - pts[0].X, p.Y - pts[0].Y)));
            closeTo('cogoAreaTable.area', t.area, e.area, TOL.area, k);
            closeTo('cogoAreaTable.twice', t.twice, 2 * e.area, 2 * TOL.area, k);
            closeTo('cogoAreaTable.twiceSigned', t.twiceSigned, e.twiceSigned, 2 * TOL.area, k);
            closeTo('cogoAreaTable.perimeter', t.perimeter, e.perimeter, TOL.len * n * Math.max(1, size / 1000), k);
            assert.equal(t.rows.length, n);
            t.rows.forEach((r, i) => {
                const p = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
                assert.equal(r.name, p.name); assert.equal(r.toName, next.name);
                assert.equal(r.X, p.X); assert.equal(r.Y, p.Y);
                closeTo('cogoAreaTable.dY', r.dY, next.Y - prev.Y, 0, { k, i }); // 引き算1回（丸めは同じ）
                closeTo('cogoAreaTable.prod', r.prod, p.X * (next.Y - prev.Y), Math.abs(p.X * (next.Y - prev.Y)) * 1e-15, { k, i });
                closeTo('cogoAreaTable.side', r.side, Math.hypot(next.X - p.X, next.Y - p.Y), TOL.len, { k, i });
            });
        });
        assert.equal(W.cogoAreaTable(cases[0]).area, 100);
    });

    it('cogoLandArea: 地積の端数（cm: 0.01㎡未満を切り捨て、m: 10㎡を超えたら 1㎡未満を切り捨て）', () => {
        const fixed = [
            [12.345, 'cm', '12.34'], [12.345, 'm', '12'], [12.3399999999, 'cm', '12.34'], [9.999, 'm', '9.99'], [10, 'm', '10.00'],
            [10.0000004, 'm', '10.00'], [10.000001, 'm', '10'], [0, 'cm', '0.00'], [0.009, 'cm', '0.00'], [-12.345, 'cm', '12.34'],
            [1234.5699999999, 'cm', '1234.57'], [99.995, 'cm', '99.99'], [100.0099999996, 'cm', '100.01'], [100.0099999994, 'cm', '100.01'], [100.0099994, 'cm', '100.00'],
            [123456789.987654, 'm', '123456789'], [123456789.987654, 'cm', '123456789.98'], [0.1 + 0.2, 'cm', '0.30'], [10.5, 'cm', '10.50'],
        ];
        fixed.forEach(([v, m, want]) => {
            assert.equal(O.landArea(v, m), want, `答えの道具の確認: ${v} ${m}`);
            assert.equal(W.cogoLandArea(v, m), want, `地積 ${v}（${m}）`);
        });
        const g = O.rng(108);
        for(let i = 0; i < 2000; i++) {
            let v;
            const kind = i % 4;
            if(kind === 0) v = g.u(0, 1e6);
            else if(kind === 1) v = Math.round(g.u(0, 1e5) * 100) / 100 + g.pick([-1e-7, -5e-7, -4e-7, 0, 4e-7, 5e-7, 1e-7]); // 0.01㎡ の境目
            else if(kind === 2) v = g.u(9, 11);
            else v = Number(g.u(0, 1e4).toFixed(g.int(0, 8)));
            ['cm', 'm'].forEach((m) => assert.equal(W.cogoLandArea(v, m), O.landArea(v, m), `地積 ${v}（${m}）`));
        }
    });

    it('cogoAreaFooter: 合計欄（倍面積・面積は小数6桁、地積）', () => {
        const fix6 = (v) => { const u = O.microOf(v); return (v < 0 && u > 0n ? '-' : '') + String(u / 1000000n) + '.' + String(u % 1000000n).padStart(6, '0'); };
        const g = O.rng(109);
        for(let i = 0; i < N_RANDOM; i++) {
            const pts = randPolygon(g, g.int(3, 12), randBase(g), Math.pow(10, g.u(0, 3)));
            const t = W.cogoAreaTable(pts), mode = i % 2 ? 'm' : 'cm';
            const f = Array.from(W.cogoAreaFooter(t, mode), (r) => Array.from(r));
            assert.deepEqual(f, [['倍面積（㎡）', fix6(t.twice)], ['面積（㎡）', fix6(t.area)], ['地積（㎡）', O.landArea(t.area, mode)]]);
        }
    });

    it('cogoSelfIntersects: ねじれた多角形（知っている形と総当たりの答え）', () => {
        const S = (arr) => arr.map(([X, Y]) => ({ X, Y }));
        const known = [
            [S([[0, 0], [10, 0], [10, 10], [0, 10]]), false], [S([[0, 0], [10, 10], [10, 0], [0, 10]]), true],
            [S([[0, 0], [10, 0], [5, 8]]), false], [S([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]), false],
            [S([[0, 10], [6, -8], [-9.5, 3], [9.5, 3], [-6, -8]]), true], // 五芒星
            [S([[100000, 40000], [100010, 40010], [100010, 40000], [100000, 40010]]), true],
        ];
        known.forEach(([p, want], k) => { assert.equal(W.cogoSelfIntersects(p), want, `形 ${k}`); assert.equal(O.polySelfIntersects(p), want, `答えの道具 ${k}`); });
        const g = O.rng(110);
        let crossed = 0;
        for(let i = 0; i < N_RANDOM; i++) {
            const pts = randPolygon(g, g.int(4, 10), randBase(g), Math.pow(10, g.u(0, 3)));
            if(i % 2) { const a = g.int(0, pts.length - 1), b = g.int(0, pts.length - 1); [pts[a], pts[b]] = [pts[b], pts[a]]; }
            const want = O.polySelfIntersects(pts);
            if(want) crossed++;
            assert.equal(W.cogoSelfIntersects(pts), want, `乱数の形 ${i}`);
        }
        assert.ok(crossed > 50, 'ねじれた形も十分に試す');
    });

    // ===================== ヘルマート変換（cad-helmert.js） =====================
    // 張り合わせ点の組を作る（真の変換は scale・rot（右回りが正）・移動。noise は各座標に足す ± の大きさ）
    function makePairs(g, n, mode, noise) {
        const src0 = randBase(g), spread = Math.pow(10, g.u(0.5, 3));
        const scale = mode === 'sim' ? g.u(0.999, 1.001) : 1, rot = g.u(-Math.PI, Math.PI), shift = { X: g.u(-150000, 150000), Y: g.u(-50000, 50000) };
        const T = (p) => ({ X: shift.X + scale * (Math.cos(rot) * p.X - Math.sin(rot) * p.Y), Y: shift.Y + scale * (Math.sin(rot) * p.X + Math.cos(rot) * p.Y) });
        const pairs = Array.from({ length: n }, () => {
            const src = { X: src0.X + g.u(-spread, spread), Y: src0.Y + g.u(-spread, spread) };
            const d = T({ X: src.X - src0.X, Y: src.Y - src0.Y });
            return { src, dst: { X: d.X + g.u(-noise, noise), Y: d.Y + g.u(-noise, noise) } };
        });
        return { pairs, scale, rot, T: (p) => T({ X: p.X - src0.X, Y: p.Y - src0.Y }), src0, spread };
    }
    it('helmSolve・helmApply: 誤差の無い組から変換（縮尺・回転・移動）を取り戻す', () => {
        const g = O.rng(201);
        for(let i = 0; i < N_RANDOM; i++) {
            const mode = i % 2 ? 'sim' : 'rigid', c = makePairs(g, g.int(2, 10), mode, 0);
            const s = W.helmSolve(c.pairs, mode);
            assert.ok(s.ok, s.error);
            assert.equal(s.mode, mode); assert.equal(s.n, c.pairs.length);
            closeTo('helmSolve.scale（真の値）', s.scale, c.scale, 1e-13 * Math.max(1, 1e4 / c.spread), i); // 公共座標の丸め ÷ 広がり
            closeTo('helmSolve.rot（真の値）', O.radDiff(s.rot, c.rot), 0, 1e-11 * Math.max(1, 1000 / c.spread), i);
            for(let k = 0; k < 5; k++) {
                const p = { X: c.src0.X + g.u(-2, 2) * c.spread, Y: c.src0.Y + g.u(-2, 2) * c.spread };
                closePt('helmApply（真の値）', W.helmApply(s, p.X, p.Y), c.T(p), 1e-8, i);
            }
            s.residuals.forEach((r) => closeTo('helmSolve.residual（誤差なし）', r.d, 0, 1e-8, i));
        }
    });
    it('helmSolve・helmApply・helmPointSigma: 誤差のある組は、正規方程式の最小二乗と同じ（σ₀・残差・各標準偏差）', () => {
        const g = O.rng(202);
        for(let i = 0; i < N_RANDOM; i++) {
            const mode = i % 2 ? 'sim' : 'rigid', c = makePairs(g, g.int(3, 12), mode, Math.pow(10, g.u(-3, -1)));
            const s = W.helmSolve(c.pairs, mode), e = O.helmertLsq(c.pairs, mode);
            assert.ok(s.ok);
            assert.equal(s.dof, e.dof);
            closeTo('helmSolve.scale', s.scale, e.scale, 1e-13 * Math.max(1, 1e4 / c.spread), i);
            closeTo('helmSolve.rot', O.radDiff(s.rot, e.rot), 0, TOL.rad * Math.max(1, 1000 / c.spread), i);
            for(let k = 0; k < 5; k++) {
                const p = { X: c.src0.X + g.u(-2, 2) * c.spread, Y: c.src0.Y + g.u(-2, 2) * c.spread };
                closePt('helmApply', W.helmApply(s, p.X, p.Y), e.apply(p.X, p.Y), TOL.len * 10, i);
                const ps = W.helmPointSigma(s, p.X, p.Y), pe = e.pointSigma(p.X, p.Y);
                if(e.sigma0 === null) { assert.equal(ps, null); continue; }
                if(mode === 'sim') {
                    closeTo('helmPointSigma（相似・X）', ps / pe.sX, 1, TOL.rel, i);
                    closeTo('helmPointSigma（相似・Y）', ps / pe.sY, 1, TOL.rel, i);
                } else {
                    // 1/1 では、アプリは X・Y の大きい方を超える目安（σ₀·√(1/n + r²/S)）を出す
                    assert.ok(ps >= Math.max(pe.sX, pe.sY) * (1 - TOL.rel), `helmPointSigma（1/1）は伝播した値以上: ${ps} < ${Math.max(pe.sX, pe.sY)}`);
                    assert.ok(ps <= Math.hypot(pe.sX, pe.sY) * (1 + TOL.rel), `helmPointSigma（1/1）は大きすぎない: ${ps}`);
                }
            }
            s.residuals.forEach((r, k) => { closeTo('helmSolve.residual.dX', r.dX, e.residuals[k].dX, TOL.len * 10, i); closeTo('helmSolve.residual.dY', r.dY, e.residuals[k].dY, TOL.len * 10, i); });
            if(e.sigma0 === null) { assert.equal(s.sigma0, null); continue; }
            closeTo('helmSolve.sigma0', s.sigma0 / e.sigma0, 1, TOL.rel, i);
            closeTo('helmSolve.sRot', s.sRot / e.sRot, 1, TOL.rel, i);
            if(mode === 'sim') closeTo('helmSolve.sScale', s.sScale / e.sScale, 1, TOL.rel, i); else assert.equal(s.sScale, 0);
            closeTo('helmSolve.sShift', s.sShift / e.sShift, 1, TOL.rel, i);
            closeTo('helmPointSigma（重心＝移動の標準偏差）', W.helmPointSigma(s, s.X0, s.Y0) / e.sShift, 1, TOL.rel, i);
        }
    });
    it('helmSolve: 端の場合（1組・同じ位置・2組で自由度0・縮尺1/1）', () => {
        const P = (X, Y) => ({ X, Y });
        assert.equal(W.helmSolve([{ src: P(0, 0), dst: P(1, 1) }], 'sim').ok, false);
        assert.equal(W.helmSolve([{ src: P(5, 5), dst: P(1, 1) }, { src: P(5, 5), dst: P(2, 2) }], 'sim').ok, false);
        assert.equal(W.helmSolve([{ src: P(0, 0), dst: P(1, 1) }, { src: P(10, 0), dst: P(1, 1) }], 'sim').ok, false, '図面側が同じ位置');
        const s = W.helmSolve([{ src: P(0, 0), dst: P(100, 200) }, { src: P(10, 0), dst: P(100, 210) }], 'sim'); // 北→東へ 90° 右回り
        assert.equal(s.dof, 0); assert.equal(s.sigma0, null); assert.equal(W.helmPointSigma(s, 0, 0), null);
        closeTo('helmSolve.rot（90°）', s.rot, Math.PI / 2, TOL.rad); closeTo('helmSolve.scale（1）', s.scale, 1, 1e-15);
        closePt('helmApply（90°）', W.helmApply(s, 0, 10), P(90, 200), TOL.len);
        const r = W.helmSolve([{ src: P(0, 0), dst: P(0, 0) }, { src: P(10, 0), dst: P(20, 0) }], 'rigid'); // 1/1 は縮尺を変えない
        assert.equal(r.scale, 1); closePt('helmApply（1/1）', W.helmApply(r, 10, 0), P(15, 0), TOL.len);
    });
    it('helmLeaveOneOut: 1組を除いた変換とのずれ（外れた組だけを知らせる）', () => {
        const g = O.rng(203);
        let flagged = 0, falseFlags = 0, checks = 0;
        for(let i = 0; i < 100; i++) {
            const mode = i % 2 ? 'sim' : 'rigid', c = makePairs(g, g.int(5, 9), mode, 0.002);
            const bad = g.int(0, c.pairs.length - 1);
            c.pairs[bad].dst = { X: c.pairs[bad].dst.X + 0.3, Y: c.pairs[bad].dst.Y - 0.4 }; // 0.5m 外れた組
            c.pairs.forEach((p, k) => {
                const lo = W.helmLeaveOneOut(c.pairs, mode, k);
                const e = O.helmertLsq(c.pairs.filter((_, j) => j !== k), mode), q = e.apply(p.src.X, p.src.Y);
                closeTo('helmLeaveOneOut.d', lo.d, Math.hypot(q.X - p.dst.X, q.Y - p.dst.Y), TOL.len * 100, { i, k });
                const sig = Math.max(e.sigma0, 0.001), ps = e.pointSigma(p.src.X, p.src.Y);
                if(mode === 'sim') closeTo('helmLeaveOneOut.sig', lo.sig / Math.sqrt(sig * sig + (ps.sX * sig / e.sigma0) ** 2), 1, TOL.rel, { i, k });
                assert.equal(lo.flag, lo.d > 3 * lo.sig);
                if(k === bad) { assert.equal(lo.flag, true, `外れた組 ${k} を知らせる（${lo.d} / ${lo.sig}）`); flagged++; }
            });
            // 外れた組を除けば、知らせる組はほとんど無い（3σ を超えるのは偶然だけ）
            const good = c.pairs.filter((_, k) => k !== bad);
            good.forEach((_, k) => { checks++; if(W.helmLeaveOneOut(good, mode, k).flag) falseFlags++; });
        }
        assert.equal(flagged, 100);
        assert.ok(falseFlags <= checks * 0.03, `正しい組を知らせすぎ: ${falseFlags} / ${checks}`);
        const P = (X, Y) => ({ X, Y });
        assert.equal(W.helmLeaveOneOut([{ src: P(0, 0), dst: P(0, 0) }, { src: P(10, 0), dst: P(10, 0) }, { src: P(0, 10), dst: P(0, 10) }], 'sim', 0), null, '除くと自由度が無い');
    });
    it('helmIsExtrapolated: 張り合わせ点で囲んだ範囲の外か', () => {
        const g = O.rng(204);
        for(let i = 0; i < N_RANDOM; i++) {
            const c = makePairs(g, g.int(3, 8), 'sim', 0.001), s = W.helmSolve(c.pairs, 'sim');
            assert.equal(W.helmIsExtrapolated(s, s.X0, s.Y0), false, '重心は内');
            c.pairs.forEach((p) => assert.equal(W.helmIsExtrapolated(s, p.src.X, p.src.Y), false, '張り合わせ点は内'));
            const far = O.polar({ X: s.X0, Y: s.Y0 }, g.u(0, 360), s.rMax * 3);
            assert.equal(W.helmIsExtrapolated(s, far.X, far.Y), true, '広がりの3倍の所は外');
            // 一番遠い張り合わせ点の、重心から見て少しだけ外（広がりの 2%）は内とみなす
            const fp = c.pairs.reduce((m, p) => (Math.hypot(p.src.X - s.X0, p.src.Y - s.Y0) > Math.hypot(m.src.X - s.X0, m.src.Y - s.Y0) ? p : m));
            const d = Math.hypot(fp.src.X - s.X0, fp.src.Y - s.Y0), k = (d + 0.02 * s.rMax) / d;
            assert.equal(W.helmIsExtrapolated(s, s.X0 + (fp.src.X - s.X0) * k, s.Y0 + (fp.src.Y - s.Y0) * k), false, '5% までの外は内');
        }
        assert.equal(W.helmIsExtrapolated({ ok: false }, 0, 0), false);
    });

    // ===================== 図面を SIMA に合わせる（cad-helmert-rev.js） =====================
    ['m', 'mm'].forEach((unit) => it(`helmReverseSolve・helmReverseXform・helmReverseApply: 図面 → SIMA の変換（${unit} の図面）`, () => {
        setUnit(unit);
        const f = unit === 'mm' ? 1000 : 1, g = O.rng(unit === 'mm' ? 302 : 301);
        try {
            for(let i = 0; i < 40; i++) {
                const mode = i % 2 ? 'sim' : 'rigid', c = makePairs(g, g.int(3, 7), mode, i % 4 < 2 ? 0 : 0.005);
                // 図面の点（src）↔ SIMA の点（dst）。アプリの _helm では src が SIMA の点、pairs[].dst が図面の点
                app.eval(`_helm.src = { name: 't.sim', points: ${JSON.stringify(c.pairs.map((p, k) => ({ num: String(k + 1), name: 'K' + k, X: p.dst.X, Y: p.dst.Y })))} };
                    _helm.mode = '${mode}'; _helm.pairs = ${JSON.stringify(c.pairs.map((p, k) => ({ si: k, dst: { X: p.src.X, Y: p.src.Y }, use: true })))};`);
                const e = O.helmertLsq(c.pairs, mode);
                const test = Array.from({ length: 6 }, () => ({ X: c.src0.X + g.u(-1.5, 1.5) * c.spread, Y: c.src0.Y + g.u(-1.5, 1.5) * c.spread }));
                const got = app.val(`(() => { const sol = helmReverseSolve(); const T = helmReverseXform(sol);
                    return { ok: sol.ok, sig: sol.sigma0, pts: ${JSON.stringify(test)}.map((p) => { const w = surveyToWcs(p.X, p.Y), q = editXformPoint(T, w.x, w.y); return wcsToSurvey(q.x, q.y); }),
                        direct: ${JSON.stringify(test)}.map((p) => helmApply(sol, p.X, p.Y)) }; })()`);
                assert.ok(got.ok);
                if(e.sigma0 === null) assert.equal(got.sig, null); else closeTo('helmReverseSolve.sigma0', got.sig, e.sigma0, 1e-9 + e.sigma0 * TOL.rel, i);
                // 図面の座標を経る分の許容: m・mm とも 0.1µm（v5.49.2 で行列を式から作るようにした。以前は mm で 0.2mm ずれた）
                const xtol = () => 1e-7;
                test.forEach((p, k) => {
                    const want = e.apply(p.X, p.Y);
                    closePt('helmReverseSolve（helmApply）', got.direct[k], want, TOL.len * 10, { unit, i, k });
                    closePt(`helmReverseXform（${unit}）`, got.pts[k], want, xtol(p), { unit, i, k });
                });
                // helmReverseApply: すべての図形を動かす（点・線）と、張り合わせ点の図面側も動く
                const ents = test.slice(0, 4).map((p) => O.surveyToWcs(f, p.X, p.Y));
                const moved = app.val(`(() => { entities.length = 0; undoStack.length = 0;
                    const E = ${JSON.stringify(ents)};
                    E.forEach((w) => entities.push({ type: 'POINT', layer: 0, color: null, x: w.x, y: w.y }));
                    entities.push({ type: 'LINE', layer: 0, color: null, x1: E[0].x, y1: E[0].y, x2: E[1].x, y2: E[1].y });
                    ensureEntityIds(); const sol = helmReverseSolve(); helmReverseApply(sol, entities.map((_, i) => i));
                    return { pts: entities.filter((e) => e.type === 'POINT').map((e) => wcsToSurvey(e.x, e.y)),
                        line: (() => { const l = entities.find((e) => e.type === 'LINE'); return [wcsToSurvey(l.x1, l.y1), wcsToSurvey(l.x2, l.y2)]; })(),
                        pairDst: _helm.pairs.map((p) => p.dst) }; })()`);
                test.slice(0, 4).forEach((p, k) => closePt(`helmReverseApply（${unit}・点）`, moved.pts[k], e.apply(p.X, p.Y), xtol(p), { i, k }));
                closePt(`helmReverseApply（${unit}・線）`, moved.line[1], e.apply(test[1].X, test[1].Y), xtol(test[1]), i);
                c.pairs.forEach((p, k) => closePt('helmReverseApply（張り合わせ点）', moved.pairDst[k], e.apply(p.src.X, p.src.Y), TOL.len * 10, { i, k }));
            }
        } finally {
            app.eval(`_helm.src = null; _helm.pairs = []; _helm.sol = null; entities.length = 0; undoStack.length = 0;`);
            setUnit('m');
        }
    }));

    it('（v5.49.2 で直した）helmReverseXform: mm の図面で、任意座標の図面を公共座標の SIMA に合わせても、離れた所が 0.01mm 以内', () => {
        // 図面の点は原点の近く（任意座標）、SIMA は公共座標。広がり 3km の張り合わせ点・重心から 5km までの点。
        // 以前は変換の向きを「重心と、そこから 1 単位（mm の図面では 1mm）ずらした点の写り先の差」で求めていて、
        // 写り先（約 1.5e8 mm）の丸めが 1mm あたりの向きのずれになり、5km 先で 0.22mm ずれていた（計算ゲートで発見）
        const run = (unit) => {
            setUnit(unit);
            const g = O.rng(305);
            let worst = { err: 0 };
            try {
                for(let i = 0; i < 100; i++) {
                    const th = g.u(0, 2 * Math.PI), sh = { X: g.u(-150000, 150000), Y: g.u(-50000, 50000) }, spread = 3000;
                    const pairs = Array.from({ length: 4 }, () => { const s = { X: g.u(-spread, spread), Y: g.u(-spread, spread) }; return { src: s, dst: { X: sh.X + Math.cos(th) * s.X - Math.sin(th) * s.Y, Y: sh.Y + Math.sin(th) * s.X + Math.cos(th) * s.Y } }; });
                    app.eval(`_helm.src = { name: 't.sim', points: ${JSON.stringify(pairs.map((p) => p.dst))} }; _helm.mode = 'rigid';
                        _helm.pairs = ${JSON.stringify(pairs.map((p, k) => ({ si: k, dst: p.src, use: true })))};`);
                    const e = O.helmertLsq(pairs, 'rigid'), pts = Array.from({ length: 5 }, () => ({ X: g.u(-5000, 5000), Y: g.u(-5000, 5000) }));
                    const got = app.val(`(() => { const T = helmReverseXform(helmReverseSolve());
                        return ${JSON.stringify(pts)}.map((p) => { const w = surveyToWcs(p.X, p.Y), q = editXformPoint(T, w.x, w.y); return wcsToSurvey(q.x, q.y); }); })()`);
                    pts.forEach((p, k) => { const w = e.apply(p.X, p.Y), err = Math.hypot(got[k].X - w.X, got[k].Y - w.Y); if(err > worst.err) worst = { err, unit, i, point: p, want: w, got: got[k] }; });
                }
            } finally { app.eval(`_helm.src = null; _helm.pairs = []; _helm.sol = null;`); setUnit('m'); }
            return worst;
        };
        const m = run('m'), mm = run('mm');
        note('helmReverseXform（任意座標→公共座標・m の図面）', m.err);
        note('helmReverseXform（任意座標→公共座標・mm の図面）', mm.err);
        assert.ok(m.err <= 1e-5, `m の図面: ${m.err} m`);
        assert.ok(mm.err <= 1e-5, `mm の図面で ${(mm.err * 1000).toFixed(4)} mm ずれる（${JSON.stringify(mm)}）。m の図面は ${m.err.toExponential(2)} m`);
    });

    // ===================== 円（cad-circle.js・cad-geom.js） =====================
    it('circleFrom3・circumcenter: 3点を通る円（一直線・同じ点は無し）', () => {
        const p = (x, y) => ({ x, y });
        assert.equal(W.circleFrom3(p(0, 0), p(1, 1), p(2, 2)), null);
        assert.equal(W.circleFrom3(p(0, 0), p(0, 0), p(2, 2)), null);
        assert.equal(W.circumcenter(0, 0, 1, 1, 2, 2), null);
        const c0 = W.circleFrom3(p(10, 0), p(0, 10), p(-10, 0));
        closeTo('circleFrom3.cx', c0.cx, 0, TOL.len); closeTo('circleFrom3.cy', c0.cy, 0, TOL.len); closeTo('circleFrom3.r', c0.r, 10, TOL.len);
        const g = O.rng(401);
        for(let i = 0; i < N_RANDOM; i++) {
            const big = i % 2 === 0, mm = i % 3 === 0;
            const f = mm ? 1000 : 1, cx = big ? g.u(-50000, 50000) * f : g.u(-100, 100) * f, cy = big ? g.u(-150000, 150000) * f : g.u(-100, 100) * f;
            const r = Math.pow(10, g.u(-1, 3)) * f, angs = [0, 1, 2].map(() => g.u(0, 2 * Math.PI)).sort((a, b) => a - b);
            if(Math.min(angs[1] - angs[0], angs[2] - angs[1], 2 * Math.PI - angs[2] + angs[0]) < 0.2) { i--; continue; }
            const [a, b, c] = angs.map((t) => p(cx + r * Math.cos(t), cy + r * Math.sin(t)));
            const e = O.circleThrough3(a, b, c), got = W.circleFrom3(a, b, c);
            const tol = TOL.len * f * Math.max(1, r / f / 100);
            closePt('circleFrom3', { x: got.cx, y: got.cy }, { x: e.cx, y: e.cy }, tol, { i, r }, 'x', 'y');
            closeTo('circleFrom3.r', got.r, e.r, tol, i);
            if(!big) { // 原点の近く: circumcenter も同じ答え（公共座標は下のテスト）
                const cc = W.circumcenter(a.x, a.y, b.x, b.y, c.x, c.y);
                closePt('circumcenter（原点の近く）', cc, { x: e.cx, y: e.cy }, tol * 100, { i, r }, 'x', 'y');
            }
        }
    });
    it('circumcenter: 公共座標でも桁が落ちない（v5.49.2 で1点目からの差で計算するように直した。以前は 0.015mm ずれた）', () => {
        // 3点の円弧（ARC コマンド）の中心。公共座標・半径 0.1〜100m の円弧で、中心のずれが 1e-8 m（0.01µm）以下
        const g = O.rng(402);
        let worst = { err: 0 };
        for(let i = 0; i < N_RANDOM; i++) {
            const mm = i % 2 === 1, f = mm ? 1000 : 1;
            const cx = g.u(-50000, 50000) * f, cy = g.u(-150000, 150000) * f, r = Math.pow(10, g.u(-1, 2)) * f;
            const [a, b, c] = [0, 2.1, 4.2].map((t) => ({ x: cx + r * Math.cos(t + i), y: cy + r * Math.sin(t + i) }));
            const e = O.circleThrough3(a, b, c), cc = W.circumcenter(a.x, a.y, b.x, b.y, c.x, c.y);
            const err = cc ? Math.hypot(cc.x - e.cx, cc.y - e.cy) / f : Infinity; // m
            if(err > worst.err) worst = { err, unit: mm ? 'mm' : 'm', rM: r / f, centerM: { x: cx / f, y: cy / f } };
        }
        note('circumcenter（公共座標・m）', worst.err);
        assert.ok(worst.err <= 1e-8, `circumcenter の中心のずれ ${worst.err} m（${JSON.stringify(worst)}）`);
    });
    it('circleFrom2: 直径の両端', () => {
        assert.equal(W.circleFrom2({ x: 3, y: 3 }, { x: 3, y: 3 }), null);
        const g = O.rng(403);
        for(let i = 0; i < N_RANDOM; i++) {
            const a = { x: g.u(-50000, 50000), y: g.u(-150000, 150000) }, b = { x: a.x + Math.pow(10, g.u(-3, 3)) * g.u(-1, 1), y: a.y + Math.pow(10, g.u(-3, 3)) * g.u(-1, 1) };
            const e = O.circleDiameter(a, b), got = W.circleFrom2(a, b);
            closePt('circleFrom2', { x: got.cx, y: got.cy }, { x: e.cx, y: e.cy }, TOL.len, i, 'x', 'y');
            closeTo('circleFrom2.r', got.r, e.r, TOL.len, i);
        }
    });
    it('circleTanTanRadius: 2つに接する半径 r の円（線・線、線・円、円・円。タップに近い解）', () => {
        const L = (ax, ay, bx, by) => ({ k: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } }), C = (x, y, r) => ({ k: 'circle', c: { x, y }, r });
        // 手で選んだ場合: 直交する2本の線（x 軸・y 軸）に接する半径 2 の円。第1象限をタップ → 中心 (2, 2)
        let got = W.circleTanTanRadius(L(0, 0, 10, 0), { x: 5, y: 0.1 }, L(0, 0, 0, 10), { x: 0.1, y: 5 }, 2);
        closePt('circleTanTanRadius', { x: got.cx, y: got.cy }, { x: 2, y: 2 }, TOL.len, '直交', 'x', 'y');
        got = W.circleTanTanRadius(L(0, 0, 10, 0), { x: -5, y: 0 }, L(0, 0, 0, 10), { x: 0, y: -5 }, 2); // 第3象限
        closePt('circleTanTanRadius', { x: got.cx, y: got.cy }, { x: -2, y: -2 }, TOL.len, '直交（第3象限）', 'x', 'y');
        assert.equal(W.circleTanTanRadius(L(0, 0, 10, 0), { x: 1, y: 0 }, L(0, 5, 10, 5), { x: 1, y: 5 }, 1), null, '平行な2本（幅5）に半径1は無い');
        assert.equal(W.circleTanTanRadius(C(0, 0, 1), { x: 1, y: 0 }, C(100, 0, 1), { x: 99, y: 0 }, 2), null, '離れた2つの円に半径2は届かない');
        assert.equal(W.circleTanTanRadius(C(0, 0, 1), { x: 1, y: 0 }, C(100, 0, 1), { x: 99, y: 0 }, 0), null, '半径0');
        got = W.circleTanTanRadius(C(0, 0, 5), { x: 5, y: 0 }, C(20, 0, 5), { x: 15, y: 0 }, 5); // 2つの円にちょうど外接（中心 (10, 0)）
        closePt('circleTanTanRadius', { x: got.cx, y: got.cy }, { x: 10, y: 0 }, 1e-6, '外接ちょうど', 'x', 'y');

        const g = O.rng(404);
        const randShape = (base, kind) => {
            if(kind === 'line') { const a = { x: base.x + g.u(-50, 50), y: base.y + g.u(-50, 50) }, t = g.u(0, Math.PI), l = g.u(5, 80); return L(a.x, a.y, a.x + l * Math.cos(t), a.y + l * Math.sin(t)); }
            return C(base.x + g.u(-50, 50), base.y + g.u(-50, 50), g.u(1, 40));
        };
        const onShape = (s) => { if(s.k === 'line') { const t = g.u(-0.5, 1.5); return { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) }; } const t = g.u(0, 2 * Math.PI); return { x: s.c.x + s.r * Math.cos(t), y: s.c.y + s.r * Math.sin(t) }; };
        let solved = 0, none = 0;
        for(let i = 0; i < N_RANDOM; i++) {
            const kinds = [['line', 'line'], ['line', 'circle'], ['circle', 'line'], ['circle', 'circle']][i % 4];
            const base = i % 2 ? { x: g.u(-50000, 50000), y: g.u(-150000, 150000) } : { x: 0, y: 0 };
            const s1 = randShape(base, kinds[0]), s2 = randShape(base, kinds[1]), r = Math.pow(10, g.u(-0.5, 1.7));
            if(kinds[0] === 'line' && kinds[1] === 'line') { // ほぼ平行な2本は除く
                const u = { x: s1.b.x - s1.a.x, y: s1.b.y - s1.a.y }, v = { x: s2.b.x - s2.a.x, y: s2.b.y - s2.a.y };
                if(Math.abs(u.x * v.y - u.y * v.x) < 0.05 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) { i--; continue; }
            }
            const p1 = onShape(s1), p2 = onShape(s2);
            const all = O.tanTanRadiusAll(s1, p1, s2, p2, r);
            got = W.circleTanTanRadius(s1, p1, s2, p2, r);
            if(!all.length) { assert.equal(got, null, `解が無いのに円が出た ${i}`); none++; continue; }
            assert.ok(got, `解があるのに null（${i}）`);
            solved++;
            const tol = 1e-7 * Math.max(1, r / 10); // 公共座標でも 0.1µm
            // 性質: 半径・それぞれの形に接する（中心から形までの距離が r。円は外接 R+r か内接 |R−r|）
            assert.equal(got.r, r);
            [[s1, got.t1], [s2, got.t2]].forEach(([s, t]) => {
                const c = { x: got.cx, y: got.cy };
                if(s.k === 'line') { closeTo('circleTanTanRadius（線までの距離＝r）', O.distToLine(c, s.a, s.b), r, tol, i); closeTo('circleTanTanRadius（接点は線の上）', O.distToLine(t, s.a, s.b), 0, tol, i); }
                else {
                    const d = Math.hypot(c.x - s.c.x, c.y - s.c.y);
                    closeTo('circleTanTanRadius（円と接する）', Math.min(Math.abs(d - (s.r + r)), Math.abs(d - Math.abs(s.r - r))), 0, tol, i);
                    closeTo('circleTanTanRadius（接点は相手の円の上）', Math.hypot(t.x - s.c.x, t.y - s.c.y), s.r, tol, i);
                }
                closeTo('circleTanTanRadius（接点は求めた円の上）', Math.hypot(t.x - c.x, t.y - c.y), r, tol, i);
            });
            // タップに一番近い解（ほぼ同じ近さの解が2つあるときは、どちらでもよい）
            const myScore = Math.hypot(got.t1.x - p1.x, got.t1.y - p1.y) + Math.hypot(got.t2.x - p2.x, got.t2.y - p2.y);
            closeTo('circleTanTanRadius（一番近い解の近さ）', myScore, all[0].score, 1e-6, { i, all: all.map((a) => a.score) });
            if(all.length < 2 || all[1].score - all[0].score > 1e-6) closePt('circleTanTanRadius（一番近い解）', { x: got.cx, y: got.cy }, { x: all[0].cx, y: all[0].cy }, tol, i, 'x', 'y');
        }
        assert.ok(solved > 150 && none > 5, `解あり ${solved}・解なし ${none}`);
    });

    // ===================== 交点・距離・面積（cad-geom.js・cad-survey.js） =====================
    it('intersectSegCircle: 線分と円の交点（接する・端・外れる）', () => {
        const S = (x1, y1, x2, y2, cx, cy, r) => Array.from(W.intersectSegCircle(x1, y1, x2, y2, cx, cy, r), (p) => ({ x: p.x, y: p.y }));
        closeSet('intersectSegCircle', S(-10, 0, 10, 0, 0, 0, 5), [{ x: -5, y: 0 }, { x: 5, y: 0 }], TOL.len);
        closeSet('intersectSegCircle', S(-10, 5, 10, 5, 0, 0, 5), [{ x: 0, y: 5 }], TOL.len); // 接する
        closeSet('intersectSegCircle', S(0, 0, 3, 0, 0, 0, 5), [], TOL.len); // 線分が円の中
        closeSet('intersectSegCircle', S(0, 0, 5, 0, 0, 0, 5), [{ x: 5, y: 0 }], TOL.len); // 端がちょうど円の上
        closeSet('intersectSegCircle', S(1, 1, 1, 1, 0, 0, 5), [], TOL.len); // 長さ 0
        const g = O.rng(501);
        for(let i = 0; i < N_RANDOM; i++) {
            const base = i % 2 ? { x: g.u(-50000, 50000), y: g.u(-150000, 150000) } : { x: 0, y: 0 };
            const c = { x: base.x + g.u(-10, 10), y: base.y + g.u(-10, 10) }, r = g.u(1, 50);
            const a = { x: base.x + g.u(-80, 80), y: base.y + g.u(-80, 80) }, b = { x: base.x + g.u(-80, 80), y: base.y + g.u(-80, 80) };
            const e = O.segCircle(a, b, c, r);
            if(e.some((q) => q.t < 1e-6 || q.t > 1 - 1e-6)) { i--; continue; } // 端すれすれは除く
            if(O.distToLine(c, a, b) > r * (1 - 1e-6) && O.distToLine(c, a, b) < r * (1 + 1e-6)) { i--; continue; } // 接するすれすれも除く
            closeSet('intersectSegCircle', S(a.x, a.y, b.x, b.y, c.x, c.y, r), e, 1e-8, i);
        }
    });
    it('intersectCircleCircle: 2つの円の交点（外接・内接・同心・離れる）', () => {
        const C = (cx, cy, radius) => ({ cx, cy, radius });
        const S = (a, b) => Array.from(W.intersectCircleCircle(a, b), (p) => ({ x: p.x, y: p.y }));
        closeSet('intersectCircleCircle', S(C(0, 0, 5), C(8, 0, 5)), [{ x: 4, y: 3 }, { x: 4, y: -3 }], TOL.len);
        closeSet('intersectCircleCircle', S(C(0, 0, 5), C(10, 0, 5)), [{ x: 5, y: 0 }], TOL.len);
        closeSet('intersectCircleCircle', S(C(0, 0, 10), C(5, 0, 5)), [{ x: 10, y: 0 }], TOL.len);
        closeSet('intersectCircleCircle', S(C(0, 0, 5), C(0, 0, 3)), [], TOL.len);
        closeSet('intersectCircleCircle', S(C(0, 0, 5), C(20, 0, 5)), [], TOL.len);
        closeSet('intersectCircleCircle', S(C(0, 0, 10), C(2, 0, 3)), [], TOL.len);
        const g = O.rng(502);
        for(let i = 0; i < N_RANDOM; i++) {
            const base = i % 2 ? { x: g.u(-50000, 50000), y: g.u(-150000, 150000) } : { x: 0, y: 0 };
            const a = C(base.x + g.u(-30, 30), base.y + g.u(-30, 30), g.u(1, 40)), b = C(base.x + g.u(-30, 30), base.y + g.u(-30, 30), g.u(1, 40));
            const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
            if(Math.abs(d - (a.radius + b.radius)) < 1e-3 || Math.abs(d - Math.abs(a.radius - b.radius)) < 1e-3) { i--; continue; } // 接するすれすれは除く
            const e = O.circlesMeet({ x: a.cx, y: a.cy }, a.radius, { x: b.cx, y: b.cy }, b.radius);
            closeSet('intersectCircleCircle', S(a, b), e, 1e-7, i);
        }
    });
    it('intersectLineLine: 線分と線分の交点（範囲の外・平行は無し）', () => {
        assert.equal(W.intersectLineLine(0, 0, 10, 0, 0, 5, 10, 5), null);
        assert.equal(W.intersectLineLine(0, 0, 10, 0, 20, -5, 20, 5), null, '延長線上は無し');
        closePt('intersectLineLine', W.intersectLineLine(0, 0, 10, 0, 5, -5, 5, 5), { x: 5, y: 0 }, TOL.len, '', 'x', 'y');
        closePt('intersectLineLine', W.intersectLineLine(0, 0, 10, 0, 10, -5, 10, 5), { x: 10, y: 0 }, TOL.len, '端', 'x', 'y');
        const g = O.rng(503);
        let hit = 0;
        for(let i = 0; i < N_RANDOM; i++) {
            const base = i % 2 ? { x: g.u(-50000, 50000), y: g.u(-150000, 150000) } : { x: 0, y: 0 };
            const P = () => ({ x: base.x + g.u(-50, 50), y: base.y + g.u(-50, 50) });
            const a = P(), b = P(), c = P(), d = P(), e = O.segSeg(a, b, c, d);
            if(!e) { i--; continue; }
            const inside = e.t >= 0 && e.t <= 1 && e.s >= 0 && e.s <= 1;
            if([e.t, e.s].some((t) => Math.abs(t) < 1e-6 || Math.abs(t - 1) < 1e-6)) { i--; continue; }
            const got = W.intersectLineLine(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
            if(!inside) { assert.equal(got, null, `範囲の外 ${i}`); continue; }
            hit++;
            const sin = Math.abs((b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)) / (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(d.x - c.x, d.y - c.y));
            closePt('intersectLineLine', got, e, TOL.len * 10 / Math.max(sin, 1e-3), i, 'x', 'y');
        }
        assert.ok(hit > 50);
    });
    it('intersectSegWithEntity: 線分と図形（線・円・円弧・長方形・ポリライン）の交点', () => {
        const g = O.rng(504);
        for(let i = 0; i < N_RANDOM; i++) {
            const P = () => ({ x: g.u(-50, 50), y: g.u(-50, 50) }), a = P(), b = P();
            const kind = ['LINE', 'CIRCLE', 'RECTANG', 'PLINE', 'ARC'][i % 5];
            let ent, want = [];
            if(kind === 'LINE') { const c = P(), d = P(); ent = { type: 'LINE', x1: c.x, y1: c.y, x2: d.x, y2: d.y }; const e = O.segSeg(a, b, c, d); if(e && e.t >= 0 && e.t <= 1 && e.s >= 0 && e.s <= 1) want = [e]; }
            else if(kind === 'CIRCLE' || kind === 'ARC') {
                const c = P(), r = g.u(5, 40);
                ent = { type: kind, cx: c.x, cy: c.y, radius: r };
                want = O.segCircle(a, b, c, r);
                if(kind === 'ARC') { // 左回りの円弧（0〜π/2 ＋ 乱数のずらし）
                    const s0 = g.u(0, 2 * Math.PI), sw = g.u(0.3, 5);
                    Object.assign(ent, { startAngle: s0, endAngle: (s0 + sw) % (2 * Math.PI), counterclockwise: true });
                    const rel = (q) => { const t = Math.atan2(q.y - c.y, q.x - c.x) - s0; return ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); };
                    if(want.some((q) => rel(q) < 1e-6 || Math.abs(rel(q) - sw) < 1e-6 || rel(q) > 2 * Math.PI - 1e-6)) { i--; continue; } // 円弧の端すれすれは除く
                    want = want.filter((q) => rel(q) <= sw);
                }
            } else {
                const pts = kind === 'RECTANG' ? (() => { const c = P(), d = P(); ent = { type: 'RECTANG', x1: c.x, y1: c.y, x2: d.x, y2: d.y }; return [c, { x: d.x, y: c.y }, d, { x: c.x, y: d.y }, c]; })()
                    : (() => { const q = [P(), P(), P(), P()]; ent = { type: 'PLINE', points: q, closed: true }; return q.concat([q[0]]); })();
                for(let k = 1; k < pts.length; k++) { const e = O.segSeg(a, b, pts[k - 1], pts[k]); if(e && e.t >= 0 && e.t <= 1 && e.s >= 0 && e.s <= 1) want.push(e); }
            }
            const edge = want.some((q) => q.t < 1e-6 || q.t > 1 - 1e-6 || (q.s !== undefined && (q.s < 1e-6 || q.s > 1 - 1e-6)));
            if(edge) { i--; continue; }
            const got = Array.from(W.intersectSegWithEntity(a.x, a.y, b.x, b.y, ent), (p) => ({ x: p.x, y: p.y }));
            closeSet('intersectSegWithEntity.' + kind, got, want, 1e-8, i);
        }
    });
    it('distPointToSeg: 点と線分の距離（端で止まる・長さ 0）', () => {
        closeTo('distPointToSeg', W.distPointToSeg(5, 5, 0, 0, 10, 0), 5, TOL.len);
        closeTo('distPointToSeg', W.distPointToSeg(13, 4, 0, 0, 10, 0), 5, TOL.len);
        closeTo('distPointToSeg', W.distPointToSeg(3, 4, 0, 0, 0, 0), 5, TOL.len);
        const g = O.rng(505);
        for(let i = 0; i < N_RANDOM; i++) {
            const base = i % 2 ? { x: g.u(-50000, 50000), y: g.u(-150000, 150000) } : { x: 0, y: 0 };
            const P = () => ({ x: base.x + g.u(-100, 100), y: base.y + g.u(-100, 100) }), p = P(), a = P(), b = i % 50 ? P() : a;
            closeTo('distPointToSeg', W.distPointToSeg(p.x, p.y, a.x, a.y, b.x, b.y), O.distToSeg(p, a, b), 1e-9, i);
        }
    });
    it('polygonArea: 図面の多角形の面積（原点の近く）', () => {
        closeTo('polygonArea', W.polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 100, 0);
        const g = O.rng(506);
        for(let i = 0; i < N_RANDOM; i++) {
            const pts = randPolygon(g, g.int(3, 30), { X: g.u(-1000, 1000), Y: g.u(-1000, 1000) }, Math.pow(10, g.u(-1, 3))).map((p) => ({ x: p.Y, y: p.X }));
            closeTo('polygonArea（原点の近く）', W.polygonArea(pts), O.polyAreaXY(pts), TOL.area, i);
        }
    });
    it('polygonArea: 公共座標・mm の図面でも桁が落ちない（v5.49.2 で1点目からの差で計算するように直した。以前は 2e-6㎡ ずれた）', () => {
        // プロパティ欄の面積は polygonArea(図面の座標) ÷ 単位²。1e-8㎡ 以下
        const g = O.rng(507);
        let worst = { err: 0 };
        for(let i = 0; i < N_RANDOM; i++) {
            const f = i % 2 ? 1000 : 1;
            const pts = randPolygon(g, g.int(3, 30), { X: g.u(-150000, 150000), Y: g.u(-50000, 50000) }, Math.pow(10, g.u(0, 3))).map((p) => ({ x: p.Y * f, y: p.X * f }));
            const err = Math.abs(W.polygonArea(pts) - O.polyAreaXY(pts)) / (f * f); // ㎡
            if(err > worst.err) worst = { err, unit: f === 1 ? 'm' : 'mm', n: pts.length, areaM2: O.polyAreaXY(pts) / (f * f) };
        }
        note('polygonArea（公共座標・㎡）', worst.err);
        assert.ok(worst.err <= 1e-8, `polygonArea のずれ ${worst.err} ㎡（${JSON.stringify(worst)}）`);
    });

    // ===================== 平面直角座標（cad-survey.js） =====================
    it('latLonToJprcs・jprcsToLatLon: 19の系すべて（原点は (0,0)・答えとの差・往復）', () => {
        const g = O.rng(601);
        let n = 0;
        for(let zone = 1; zone <= 19; zone++) {
            const z = O.ZONES[zone];
            const o = W.latLonToJprcs(z.lat, z.lon, zone);
            closeTo('latLonToJprcs（原点 X）', o.X, 0, 1e-8, zone); // 約 4400km の差し引き（1ulp ≈ 1e-9） closeTo('latLonToJprcs（原点 Y）', o.Y, 0, 1e-9, zone);
            const back = W.jprcsToLatLon(0, 0, zone);
            closeTo('jprcsToLatLon（原点 緯度）', back.lat, z.lat, 1e-12, zone); closeTo('jprcsToLatLon（原点 経度）', back.lon, z.lon, 1e-12, zone);
            // 中央子午線の上: X ＝ m0·(子午線弧長(φ) − 子午線弧長(φ0))（級数を使わない数値積分の答え）
            [-1.3, -0.4, 0.7, 1.4].forEach((dl) => {
                const lat = z.lat + dl, p = W.latLonToJprcs(lat, z.lon, zone);
                closeTo('latLonToJprcs（中央子午線・弧長）', p.X, O.K0 * (O.meridianArc(lat * O.D2R) - O.meridianArc(z.lat * O.D2R)), TOL.gk, { zone, lat });
                closeTo('latLonToJprcs（中央子午線 Y=0）', p.Y, 0, 1e-9, { zone, lat });
            });
            for(let k = 0; k < 20; k++, n++) {
                const lat = z.lat + g.u(-1.4, 1.4), lon = z.lon + g.u(-1.6, 1.6);
                const p = W.latLonToJprcs(lat, lon, zone), e = O.gkForward(lat, lon, zone);
                closeTo('latLonToJprcs.X', p.X, e.X, TOL.gk, { zone, lat, lon }); closeTo('latLonToJprcs.Y', p.Y, e.Y, TOL.gk, { zone, lat, lon });
                const q = W.jprcsToLatLon(e.X, e.Y, zone), qe = O.gkInverse(e.X, e.Y, zone);
                closeTo('jprcsToLatLon.lat', q.lat, qe.lat, TOL.gkDeg, { zone, lat, lon }); closeTo('jprcsToLatLon.lon', q.lon, qe.lon, TOL.gkDeg, { zone, lat, lon });
                closeTo('jprcsToLatLon.lat（答えの往復）', qe.lat, lat, TOL.gkDeg, { zone }); closeTo('jprcsToLatLon.lon（答えの往復）', qe.lon, lon, TOL.gkDeg, { zone });
                const r = W.jprcsToLatLon(p.X, p.Y, zone);
                closeTo('latLon→Jprcs→latLon 往復.lat', r.lat, lat, TOL.trip, { zone }); closeTo('latLon→Jprcs→latLon 往復.lon', r.lon, lon, TOL.trip, { zone });
                // 公共座標の範囲の X・Y から
                const X = g.u(-150000, 150000), Y = g.u(-50000, 50000), ll = W.jprcsToLatLon(X, Y, zone), b2 = W.latLonToJprcs(ll.lat, ll.lon, zone);
                closeTo('Jprcs→latLon→Jprcs 往復.X', b2.X, X, 1e-6, { zone, X, Y }); closeTo('Jprcs→latLon→Jprcs 往復.Y', b2.Y, Y, 1e-6, { zone, X, Y });
                const le = O.gkInverse(X, Y, zone);
                closeTo('jprcsToLatLon.lat（公共座標）', ll.lat, le.lat, TOL.gkDeg, { zone, X, Y }); closeTo('jprcsToLatLon.lon（公共座標）', ll.lon, le.lon, TOL.gkDeg, { zone, X, Y });
            }
        }
        assert.ok(n >= 380);
        // 等角（形が変わらない）: 北と東への小さな動きで、縮尺が同じ・直交（アプリの式だけで確かめる）
        for(let zone = 1; zone <= 19; zone++) {
            const z = O.ZONES[zone], lat = z.lat + 0.9, lon = z.lon + 1.1, h = 1e-5;
            const p = W.latLonToJprcs(lat, lon, zone), pn = W.latLonToJprcs(lat + h, lon, zone), pe = W.latLonToJprcs(lat, lon + h, zone);
            const s = Math.sin(lat * O.D2R), e2 = 0.00669438002290, Wd = Math.sqrt(1 - e2 * s * s);
            const M = 6378137 * (1 - e2) / Wd ** 3, N = 6378137 / Wd; // 子午線・卯酉線の曲率半径
            const kN = Math.hypot(pn.X - p.X, pn.Y - p.Y) / (M * h * O.D2R), kE = Math.hypot(pe.X - p.X, pe.Y - p.Y) / (N * Math.cos(lat * O.D2R) * h * O.D2R);
            closeTo('latLonToJprcs（等角: 北と東の縮尺）', kN / kE, 1, 1e-5, zone);
            const dot = (pn.X - p.X) * (pe.X - p.X) + (pn.Y - p.Y) * (pe.Y - p.Y);
            closeTo('latLonToJprcs（等角: 直交）', dot / (Math.hypot(pn.X - p.X, pn.Y - p.Y) * Math.hypot(pe.X - p.X, pe.Y - p.Y)), 0, 1e-5, zone);
        }
        assert.throws(() => W.latLonToJprcs(35, 139, 0)); assert.throws(() => W.jprcsToLatLon(0, 0, 20));
    });

    // ===================== 座標の変換（cad-survey.js・cad-view.js・cad-editgeom.js） =====================
    it('surveyToWcs・wcsToSurvey: 測量座標（X 北・Y 東）⇔ 図面（m・mm）', () => {
        const g = O.rng(701);
        ['m', 'mm'].forEach((unit) => {
            setUnit(unit);
            const f = unit === 'mm' ? 1000 : 1;
            const cases = [[0, 0], [1, 0], [0, 1], [-150000, -50000], [150000, 50000], [0.0005, -0.0005]];
            for(let i = 0; i < N_RANDOM; i++) cases.push([g.u(-150000, 150000), g.u(-50000, 50000)]);
            cases.forEach(([X, Y], i) => {
                const w = W.surveyToWcs(X, Y), e = O.surveyToWcs(f, X, Y);
                closePt(`surveyToWcs（${unit}）`, w, e, 0, i, 'x', 'y');
                const s = W.wcsToSurvey(w.x, w.y);
                closePt(`wcsToSurvey（${unit}）`, s, O.wcsToSurvey(f, w.x, w.y), 0, i);
                closePt(`surveyToWcs→wcsToSurvey 往復（${unit}）`, s, { X, Y }, 1e-10, i);
            });
        });
        setUnit('m');
    });
    it('ucsToWcs・wcsToUcs: UCS（原点・回転）', () => {
        const g = O.rng(702);
        const ucss = [{ originX: 0, originY: 0, angle: 0 }, { originX: 1000.5, originY: -2000.25, angle: 0 }, { originX: 12.5, originY: -7.25, angle: Math.PI / 6 },
            { originX: 0, originY: 0, angle: Math.PI / 2 }, { originX: 0, originY: 0, angle: Math.PI }, { originX: 0, originY: 0, angle: -Math.PI / 2 }, { originX: 45000123, originY: -149000456, angle: 2 * Math.PI - 1e-9 }];
        for(let i = 0; i < 30; i++) ucss.push({ originX: g.u(-5e7, 5e7), originY: g.u(-1.5e8, 1.5e8), angle: g.u(-7, 7) });
        try {
            ucss.forEach((u, k) => {
                app.eval(`ucs = ${JSON.stringify(u)};`);
                for(let i = 0; i < 12; i++) {
                    const ux = g.u(-1000, 1000) * (i % 2 ? 1000 : 1), uy = g.u(-1000, 1000) * (i % 2 ? 1000 : 1);
                    const tol = 1e-12 + 1e-15 * (Math.max(Math.abs(u.originX), Math.abs(u.originY)) + Math.max(Math.abs(ux), Math.abs(uy))); // 座標の大きさの 1e-15
                    const w = W.ucsToWcs(ux, uy);
                    closePt('ucsToWcs', w, O.ucsToWcs(u, ux, uy), tol, { k, i }, 'x', 'y');
                    closePt('wcsToUcs', W.wcsToUcs(w.x, w.y), O.wcsToUcs(u, w.x, w.y), tol, { k, i }, 'x', 'y');
                    closePt('ucsToWcs→wcsToUcs 往復', W.wcsToUcs(w.x, w.y), { x: ux, y: uy }, tol * 2, { k, i }, 'x', 'y');
                }
            });
        } finally { app.eval(`ucs = { originX: 0, originY: 0, angle: 0 };`); }
    });
    it('editXform・editXformPoint・editXformAngle・editRotateXform・editScaleXform・editMirrorXform・editMoveXform: 図形の変換', () => {
        const g = O.rng(703);
        const P = () => (g.r() < 0.5 ? { x: g.u(-50000, 50000) * (g.r() < 0.5 ? 1000 : 1), y: g.u(-150000, 150000) } : { x: g.u(-100, 100), y: g.u(-100, 100) });
        // 手で選んだ場合（90°・180°・軸の鏡は座標がそのまま）
        let T = W.editRotateXform({ x: 10, y: 20 }, Math.PI / 2);
        closePt('editRotateXform（90°）', W.editXformPoint(T, 11, 20), { x: 10, y: 21 }, 0, '', 'x', 'y');
        T = W.editMirrorXform({ x: 0, y: 5 }, { x: 10, y: 5 });
        closePt('editMirrorXform（横の鏡）', W.editXformPoint(T, 3, 8), { x: 3, y: 2 }, 0, '', 'x', 'y');
        assert.equal(T.flip, true);
        T = W.editMirrorXform({ x: 7, y: 0 }, { x: 7, y: -3 });
        closePt('editMirrorXform（縦の鏡）', W.editXformPoint(T, 10, 4), { x: 4, y: 4 }, 0, '', 'x', 'y');
        T = W.editScaleXform({ x: 1, y: 1 }, 0);
        closePt('editScaleXform（0倍）', W.editXformPoint(T, 5, 9), { x: 1, y: 1 }, 0, '', 'x', 'y');
        T = W.editMoveXform(-150000, 50000.001);
        closePt('editMoveXform', W.editXformPoint(T, 150000, -50000), { x: 0, y: 0.001 }, 1e-9, '', 'x', 'y');
        for(let i = 0; i < N_RANDOM; i++) {
            const kind = i % 5, o = P();
            let Tr, ref, k = 1, flip = false;
            if(kind === 0) { const ang = g.u(-10, 10); Tr = W.editRotateXform(o, ang); ref = (p) => O.rotateAbout(o, ang, p); }
            else if(kind === 1) { const ks = g.pick([g.u(0.001, 1000), -2, 0.5]); Tr = W.editScaleXform(o, ks); ref = (p) => O.scaleAbout(o, ks, p); k = Math.abs(ks); }
            else if(kind === 2) { const b = { x: o.x + g.u(-100, 100), y: o.y + g.u(-100, 100) }; Tr = W.editMirrorXform(o, b); ref = (p) => O.mirrorAcross(o, b, p); flip = true; }
            else if(kind === 3) { const dx = g.u(-1e5, 1e5), dy = g.u(-1e5, 1e5); Tr = W.editMoveXform(dx, dy); ref = (p) => ({ x: p.x + dx, y: p.y + dy }); }
            else {
                const M = { a: g.u(-2, 2), b: g.u(-2, 2), c: g.u(-2, 2), d: g.u(-2, 2) }, t = P();
                Tr = W.editXform(M.a, M.b, M.c, M.d, o, t); ref = (p) => O.affine(M, o, t, p);
                k = Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)); flip = M.a * M.d - M.b * M.c < 0;
            }
            closeTo('editXform.k', Tr.k, k, 1e-12 * Math.max(1, k), { i, kind }); assert.equal(Tr.flip, flip, `flip ${i}`);
            for(let j = 0; j < 4; j++) {
                const p = { x: o.x + g.u(-500, 500), y: o.y + g.u(-500, 500) }, q = { x: p.x + g.u(-50, 50), y: p.y + g.u(-50, 50) };
                const tp = W.editXformPoint(Tr, p.x, p.y), tq = W.editXformPoint(Tr, q.x, q.y);
                const scl = 4e-15 * Math.max(Math.abs(o.x), Math.abs(o.y), Math.abs(tp.x), Math.abs(tp.y)); // 座標の大きさの丸め
                closePt('editXformPoint', tp, ref(p), TOL.len + scl * Math.max(1, k), { i, kind }, 'x', 'y');
                if(kind === 4) continue; // 一般の変換は相似とは限らない
                // 距離は k 倍・向きは editXformAngle どおり
                const d0 = Math.hypot(q.x - p.x, q.y - p.y), d1 = Math.hypot(tq.x - tp.x, tq.y - tp.y);
                closeTo('editXform（距離は k 倍）', d1, k * d0, 1e-8 * Math.max(1, k), { i, kind });
                if(k * d0 > 1e-3) {
                    const a0 = Math.atan2(q.y - p.y, q.x - p.x), a1 = Math.atan2(tq.y - tp.y, tq.x - tp.x);
                    closeTo('editXformAngle', O.radDiff(W.editXformAngle(Tr, a0), a1), 0, 1e-8, { i, kind });
                }
            }
        }
    });

    // ===================== トータルステーションの観測 → 座標（cad-sdr.js の parseSdr） =====================
    const A = (s, w = 16) => String(s).padEnd(w).slice(0, w);
    const Rn = (v, w = 16) => (v === null ? '' : String(v)).padEnd(w).slice(0, w);
    const hdr33 = (angle = '1') => '00NM' + A('SDR33 V04-04.02') + '0000' + A('25-Sep-26 12:00') + angle + '1' + '1111';
    const instr = (vopt) => '01NM' + '1' + A('') + '000000' + A('') + '000000' + '3' + vopt + A('') + A('') + A('');
    const num = (v, d) => Number(v.toFixed(d)); // 欄に書いた数（ファイルの数そのもの）
    function sdrCase(seed, opt) {
        const g = O.rng(seed), lines = [hdr33(opt.grad ? '2' : '1'), instr(opt.vopt || '1')], want = [];
        const A2D = opt.grad ? 0.9 : 1;
        let sf = 1;
        if(opt.sf) { sf = num(g.u(0.9990, 1.0001), 6); lines.push('06NM' + Rn(sf)); }
        for(let s = 0; s < opt.stations; s++) {
            const st = { X: num(g.u(-150000, 150000), 4), Y: num(g.u(-50000, 50000), 4), Z: num(g.u(-10, 3000), 3), ih: num(g.u(0, 2), 3) };
            const bsAzU = num(g.u(0, opt.grad ? 400 : 360), 5), bsHU = num(g.u(0, opt.grad ? 400 : 360), 5);
            lines.push('02TP' + A('ST' + s) + Rn(st.X) + Rn(st.Y) + Rn(st.Z) + Rn(st.ih) + A(''));
            lines.push('07TP' + A('ST' + s) + A('BS' + s) + Rn(bsAzU) + Rn(bsHU));
            const th = num(g.u(0, 3), 3);
            lines.push('03NM' + Rn(th));
            for(let k = 0; k < opt.obs; k++) {
                const id = `P${s}_${k}`, deriv = g.pick(opt.derivs);
                const sd = num(Math.pow(10, g.u(-0.5, 3.3)), 4);
                let zU = num(g.u(opt.grad ? 50 : 45, opt.grad ? 150 : 135), 5), hU = num(g.u(0, opt.grad ? 400 : 360), 5);
                if(k === 0) { zU = opt.grad ? 100 : 90; hU = 0; } // 水平・後視の向き
                if(k === 1) { hU = opt.grad ? 399.99999 : 359.99999; }
                // 機械が書く値: F2 は反の値（天頂角 360−z・水平角 +180）、高低角の機械は 90−z
                let zRec = zU, hRec = hU;
                const full = opt.grad ? 400 : 360, half = full / 2, quarter = full / 4;
                if(deriv === 'F2') { zRec = num(full - zU, 5); hRec = num((hU + half) % full, 5); }
                else if(deriv !== 'MC' && opt.vopt === '2') zRec = num(quarter - zU, 5);
                lines.push('09' + deriv + A('ST' + s) + A(id) + Rn(sd) + Rn(zRec) + Rn(hRec) + A(''));
                // 答え: ファイルに書いた数から、度に直して計算する
                let zDeg = zRec * A2D, hDeg = hRec * A2D;
                if(deriv === 'F2') { zDeg = 360 - zDeg; hDeg -= 180; }
                else if(deriv !== 'MC' && opt.vopt === '2') zDeg = 90 - zDeg;
                const r = deriv === 'MC'
                    ? O.tsReduce(st, 0, 0, { sd, z: zDeg, h: hDeg }, th, sf)
                    : O.tsReduce(st, bsAzU * A2D, bsHU * A2D, { sd, z: zDeg, h: hDeg }, th, sf);
                want.push({ id, deriv, ...r });
            }
        }
        return { text: lines.join('\r\n'), want };
    }
    [
        { name: 'SDR33・度・天頂角（正・反・補正済み）', seed: 801, stations: 6, obs: 60, derivs: ['F1', 'F2', 'MC'] },
        { name: 'SDR33・グラード・縮尺係数', seed: 802, stations: 3, obs: 40, derivs: ['F1', 'F2'], grad: true, sf: true },
        { name: 'SDR33・高低角の機械（水平 0°）', seed: 803, stations: 3, obs: 40, derivs: ['F1', 'MD'], vopt: '2' },
    ].forEach((opt) => it(`parseSdr（観測 → 座標）: ${opt.name}`, () => {
        const c = sdrCase(opt.seed, opt);
        W.__sdr = c.text;
        const r = app.val('parseSdr(window.__sdr)');
        assert.deepEqual(r.warnings.filter((w) => !/角度の単位/.test(w)), []);
        const byId = new Map(r.points.map((p) => [p.id, p]));
        c.want.forEach((w) => {
            const p = byId.get(w.id);
            assert.ok(p, `点 ${w.id} がありません`);
            const tol = 1e-8 * Math.max(1, w.hd / 1000); // 公共座標の丸め（約 3e-11 m）と角度の度→ラジアン
            closePt('parseSdr（観測の X・Y）', p, w, tol, { id: w.id, deriv: w.deriv });
            closeTo('parseSdr（観測の標高）', p.Z, w.Z, tol, { id: w.id });
        });
        assert.ok(c.want.length >= 120 || opt.stations * opt.obs === c.want.length);
    }));

    // ===================== 杭打ち（cad-stake.js） =====================
    it('stakeFromStation: 器械点・後視点から見た杭の方向角・夾角・水平距離', () => {
        const P = (X, Y) => ({ X, Y });
        const cases = [[P(0, 0), P(10, 0), P(0, 10)], [P(0, 0), P(0, 10), P(10, 0)], [P(0, 0), P(10, 0), P(10, 0)], [P(0, 0), P(10, 0), P(10, -1e-9)],
            [P(-150000, 50000), P(-149000, 50000), P(-150000.001, 49999.999)], [P(0, 0), P(-10, 0), P(0, -10)]];
        const g = O.rng(901);
        for(let i = 0; i < N_RANDOM * 2; i++) { const s = randBase(g); cases.push([s, randNear(g, s), randNear(g, s)]); }
        cases.forEach(([st, bs, tg], i) => {
            const r = W.stakeFromStation(st, bs, tg), e = O.inverse(st, tg);
            closeDeg('stakeFromStation.az', r.az, e.az, TOL.deg, i);
            closeDeg('stakeFromStation.ang（夾角）', r.ang, O.normDeg(e.az - O.inverse(st, bs).az), TOL.deg, i);
            assert.ok(r.ang >= 0 && r.ang < 360);
            closeTo('stakeFromStation.dist', r.dist, e.dist, TOL.len, i);
            closeTo('stakeFromStation.dX', r.dX, e.dX, TOL.len, i); closeTo('stakeFromStation.dY', r.dY, e.dY, TOL.len, i);
        });
    });
    ['m', 'mm'].forEach((unit) => it(`_stakeTsData・_stakeTsHtml: 図面の器械点・後視点・杭から（${unit} の図面。夾角・水平距離・高低差の表示）`, () => {
        setUnit(unit);
        const f = unit === 'mm' ? 1000 : 1, g = O.rng(unit === 'mm' ? 903 : 902);
        try {
            app.eval(`_cogo.slots = {}; _stake.list = [];`);
            assert.equal(app.val('_stakeTsData()'), null, '器械点・後視点が無ければ null');
            app.eval(`_cogo.slots = { KS: { x: 5, y: 5, name: 'S' }, KB: { x: 5, y: 5, name: 'B' } };`);
            assert.match(app.val('_stakeTsData().error'), /同じ位置/);
            for(let i = 0; i < 60; i++) {
                const st = { X: num(g.u(-150000, 150000), 3), Y: num(g.u(-50000, 50000), 3) }, bs = randNear(g, st), tg = randNear(g, st);
                const zS = num(g.u(0, 100), 3), zT = num(g.u(0, 100), 3);
                const ws = O.surveyToWcs(f, st.X, st.Y), wb = O.surveyToWcs(f, bs.X, bs.Y), wt = O.surveyToWcs(f, tg.X, tg.Y);
                app.eval(`entities.length = 0; addSurveyData([{ num: '1', name: 'S', X: ${st.X}, Y: ${st.Y}, z: ${zS} }, { num: '2', name: 'T', X: ${tg.X}, Y: ${tg.Y}, z: ${zT} }], []);
                    _cogo.slots = { KS: { x: ${ws.x}, y: ${ws.y}, name: 'S' }, KB: { x: ${wb.x}, y: ${wb.y}, name: 'B' } };`);
                const d = app.val('_stakeTsData()');
                closePt(`_stakeTsData.st（${unit}）`, d.st, st, 1e-9, i); closePt(`_stakeTsData.bs（${unit}）`, d.bs, bs, 1e-9, i);
                closeTo('_stakeTsData.stZ', d.stZ, zS, 0, i);
                const html = app.val(`_stakeTsHtml({ x: ${wt.x}, y: ${wt.y} })`);
                const ang = O.normDeg(O.inverse(st, tg).az - O.inverse(st, bs).az), dist = O.inverse(st, tg).dist, dz = zT - zS;
                // 秒・mm の丸めの境目すれすれは、丸め方の違いではなく誤差なので除く
                const safe = (v, k) => Math.abs(((Math.abs(v) * k) % 1) - 0.5) > 1e-4;
                const az = O.inverse(st, tg).az;
                if(safe(ang, 3600)) assert.ok(html.includes(O.dmsText(ang)), `夾角 ${O.dmsText(ang)} が出ていません（${i}）`);
                if(safe(az, 3600)) assert.ok(html.includes(O.dmsText(az)), `方向角 ${O.dmsText(az)}（${i}）`);
                if(safe(dist, 1000)) assert.ok(html.includes(fmt3(dist) + ' m'), `水平距離 ${fmt3(dist)}（${i}）`);
                if(safe(dz, 1000)) assert.ok(html.includes((dz > 0 ? '+' : '') + fmt3(dz) + ' m'), `高低差 ${fmt3(dz)}（${i}）`);
            }
        } finally { app.eval(`_cogo.slots = {}; entities.length = 0; undoStack.length = 0;`); setUnit('m'); }
    }));
    // 小数3桁の文字（-0.000 にしない）。答えの道具の microOf を使って正確に丸める（ちょうど半分は上へ）
    function fmt3(v) { const u = O.microOf(v), k = (u + 500n) / 1000n; return (v < 0 && k > 0n ? '-' : '') + String(k / 1000n) + '.' + String(k % 1000n).padStart(3, '0'); }

    // ===================== 登録の点検 =====================
    const CALC_FUNCS = [
        'cogoInverse', 'cogoPolar', 'cogoAzFromBacksight', 'cogoIntersectLines', 'cogoIntersectAzimuths', 'cogoIntersectDistances',
        'cogoAreaTable', 'cogoLandArea', 'cogoAreaFooter', 'cogoSelfIntersects',
        'helmSolve', 'helmApply', 'helmPointSigma', 'helmLeaveOneOut', 'helmIsExtrapolated', 'helmReverseSolve', 'helmReverseXform', 'helmReverseApply',
        'circleFrom3', 'circleFrom2', 'circleTanTanRadius', 'circumcenter',
        'intersectSegCircle', 'intersectCircleCircle', 'intersectLineLine', 'intersectSegWithEntity', 'distPointToSeg', 'polygonArea',
        'latLonToJprcs', 'jprcsToLatLon', 'surveyToWcs', 'wcsToSurvey', 'ucsToWcs', 'wcsToUcs',
        'editXform', 'editXformPoint', 'editXformAngle', 'editRotateXform', 'editScaleXform', 'editMirrorXform', 'editMoveXform',
        'parseSdr', 'stakeFromStation', '_stakeTsData', '_stakeTsHtml',
    ];
    const EXEMPT = {
        cogoAreaCsv: '求積表の CSV の文字（値は cogoAreaTable・cogoAreaFooter で照合済み。cogo.test.cjs で書式を確認）',
        cogoAreaTableEntities: '求積表を図面の文字・線にする（値は cogoAreaTable で照合済み。cogo.test.cjs で確認）',
        cogoAreaLabelEntity: '辺長・面積の文字を図面に置く（値は cogoAreaTable で照合済み）',
    };
    const FILES = ['cad-cogo.js', 'cad-helmert.js', 'cad-helmert-rev.js', 'cad-circle.js', 'cad-geom.js', 'cad-survey.js', 'cad-editgeom.js', 'cad-sdr.js', 'cad-stake.js', 'cad-view.js'];
    const NAME_RE = /^(cogo(Inverse|Polar|Az|Intersect|Area|LandArea|SelfIntersects)|helm(Solve|Apply|PointSigma|LeaveOneOut|IsExtrapolated|Reverse)|circle(From|TanTan)|circumcenter|intersect|distPointToSeg|polygonArea|latLonTo|jprcsTo|surveyToWcs|wcsToSurvey|ucsToWcs|wcsToUcs|edit(Xform|Rotate|Scale|Mirror|Move)|sdr.*(Coord|Calc|Compute|Reduce)|_?stake.*(Ts|Station|Calc))/;
    it('登録の点検: 計算の関数はすべて照合しているか（照合しないものは理由つきで EXEMPT）', () => {
        const found = [];
        FILES.forEach((f) => {
            const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
            for(const m of src.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)) if(NAME_RE.test(m[1])) found.push({ name: m[1], file: f });
        });
        assert.ok(found.length >= 40, `見つけた計算の関数が少なすぎます（${found.length}）`);
        const missing = found.filter((x) => !CALC_FUNCS.includes(x.name) && !(typeof EXEMPT[x.name] === 'string' && EXEMPT[x.name].length > 0));
        assert.deepEqual(missing.map((x) => `${x.file}: ${x.name}`), [], '新しい計算の関数は calc-gate に照合を足してください');
        // 登録した名前がアプリにあるか（名前を変えたら直す）
        CALC_FUNCS.concat(Object.keys(EXEMPT)).forEach((n) => assert.equal(app.eval(`typeof ${n}`), 'function', `${n} がアプリにありません`));
    });
});
