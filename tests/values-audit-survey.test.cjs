'use strict';
// 値の監査 3: 座標一覧・SIMA・座標 CSV（図面の単位 m / mm・UCS をまたいで）と、測量計算（逆計算・放射・夾角・交点・求積・地積）。
// 期待値は独立した式で求める（アプリの cogo 関数の結果は、別の式・別の道すじで確かめる）。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const O = require('./helpers/values-oracle.cjs');
const { PER_M, R, UCS_CASES, configure } = O;

// 3桁（1mm）に丸めた文字。-0.000 にはしない
function fix3(v) { const s = v.toFixed(3); return /^-0\.0+$/.test(s) ? s.slice(1) : s; }
// 再現できる乱数（線形合同法）
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

const SURVEY_PTS = [
    { num: '1', name: 'A2-8', X: 0.002258, Y: 29.510405, z: 1.353 },
    { num: '2', name: 'A2-7', X: 1.214, Y: 29.884606, z: 1.319 },
    { num: '3', name: '基準点', X: 45678.9012, Y: 100123.4567, z: null },
    { num: '4', name: '', X: -12.3456, Y: -0.0004, z: 0 },
    { num: '5', name: 'P5', X: -35000.1234, Y: 20000.4567, z: -2.5 },
];

describe('値の監査: 座標一覧・SIMA・座標 CSV', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('測量座標（m）→ 図面 → 座標一覧・SIMA・CSV → 読み直し: 図面の単位（m・mm）と UCS によらず、同じ値に戻る', () => {
        const bad = []; let n = 0;
        for (const du of ['m', 'mm']) for (const ucs of UCS_CASES) {
            const f = PER_M[du], tag = `図面 ${du}・${ucs.name}`;
            configure(app, { du, prefs: {}, ucs });
            app.eval(`addSurveyData(${JSON.stringify(SURVEY_PTS)}, [])`);
            // 図面の座標: x＝東（Y）、y＝北（X）に、図面の単位の倍率をかけた値
            const ents = app.val(`entities.filter((e) => e.type === 'POINT')`);
            SURVEY_PTS.forEach((p, i) => {
                n += 2;
                if (Math.abs(ents[i].x - p.Y * f) > 1e-9 * f) bad.push(`図面の x ${tag} 点${p.num}: 出た ${ents[i].x} / 期待 ${p.Y * f}`);
                if (Math.abs(ents[i].y - p.X * f) > 1e-9 * f) bad.push(`図面の y ${tag} 点${p.num}: 出た ${ents[i].y} / 期待 ${p.X * f}`);
            });
            // SIMA の座標の行（X＝北・Y＝東・標高。3桁）
            const lines = app.val(`buildSimaPointLines('t').lines`);
            SURVEY_PTS.forEach((p, i) => {
                const want = `A01,${p.num},${p.name || 'P' + p.num},${fix3(p.X)},${fix3(p.Y)},${p.z === null ? '' : fix3(p.z)},`;
                n++; if (lines[3 + i] !== want) bad.push(`SIMA ${tag} 点${p.num}: 出た ${lines[3 + i]} / 期待 ${want}`);
            });
            // 座標 CSV（点番号・点名・X・Y・標高）
            const csv = app.val('buildCoordCsvText().text').split(/\r?\n/);
            SURVEY_PTS.forEach((p) => {
                const row = csv.find((l) => l.startsWith(`${p.num},`));
                const want = [p.num, p.name || 'P' + p.num, fix3(p.X), fix3(p.Y), p.z === null ? '' : fix3(p.z)].join(',');
                n++; if (row !== want) bad.push(`CSV ${tag} 点${p.num}: 出た ${row} / 期待 ${want}`);
            });
            // 出した SIMA を読み直すと、3桁に丸めた値に戻る
            app.eval(`window.__sima = buildSimaText('t').text`);
            const back = app.val('parseSima(window.__sima).points');
            SURVEY_PTS.forEach((p, i) => {
                n += 2;
                if (Math.abs(back[i].X - Number(fix3(p.X))) > 1e-9) bad.push(`読み直し X ${tag} 点${p.num}: 出た ${back[i].X}`);
                if (Math.abs(back[i].Y - Number(fix3(p.Y))) > 1e-9) bad.push(`読み直し Y ${tag} 点${p.num}: 出た ${back[i].Y}`);
            });
            // 座標一覧の画面の文字（X・Y・H）
            app.eval('showCoordListPanel()');
            const panel = app.eval(`document.getElementById('property-panel-content').textContent`);
            SURVEY_PTS.forEach((p) => {
                const want = `X ${fix3(p.X)}  Y ${fix3(p.Y)}` + (p.z !== null ? `  H ${fix3(p.z)}` : '');
                n++; if (!panel.replace(/\s+/g, ' ').includes(want.replace(/\s+/g, ' '))) bad.push(`座標一覧 ${tag} 点${p.num}: 「${want}」が見当たらない`);
            });
            // 座標一覧の値は UCS を使わない（UCS を移動・回転していても、測量座標のまま）
            const sv = app.val(`collectSurveyPoints().map((q) => wcsToSurvey(q.x, q.y))`);
            SURVEY_PTS.forEach((p, i) => {
                n += 2;
                if (Math.abs(sv[i].X - p.X) > 1e-9) bad.push(`測量座標 X ${tag} 点${p.num}: 出た ${sv[i].X} / 期待 ${p.X}`);
                if (Math.abs(sv[i].Y - p.Y) > 1e-9) bad.push(`測量座標 Y ${tag} 点${p.num}: 出た ${sv[i].Y} / 期待 ${p.Y}`);
            });
        }
        assert.ok(n >= 200, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});

describe('値の監査: 測量計算（別の式で求めた値と、ランダムな入力で照合）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    const rnd = rng(20260930);
    const pt = (scale) => ({ X: Math.round(rnd() * scale * 1000) / 1000 - scale / 2, Y: Math.round(rnd() * scale * 1000) / 1000 - scale / 2 });
    const close = (a, b, eps, what, bad, tag) => { if (!(Math.abs(a - b) <= eps)) bad.push(`${tag} ${what}: 出た ${a} / 期待 ${b}`); };
    const normDeg = (d) => ((d % 360) + 360) % 360;

    it('逆計算・放射・夾角（杭打ち）: 距離・方向角が、別の式と一致する', () => {
        const bad = []; let n = 0;
        for (let i = 0; i < 400; i++) {
            const a = pt(200000), b = { X: a.X + (rnd() - 0.5) * 1000, Y: a.Y + (rnd() - 0.5) * 1000 };
            const inv = app.val(`cogoInverse(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
            const dX = b.X - a.X, dY = b.Y - a.Y;
            // 方向角（北から時計回り）: 東の軸からの角 atan2(北, 東) を使う別の道すじ
            const az = normDeg(90 - Math.atan2(dX, dY) * 180 / Math.PI);
            n += 4;
            close(inv.dX, dX, 1e-9, 'ΔX', bad, `#${i}`); close(inv.dY, dY, 1e-9, 'ΔY', bad, `#${i}`);
            close(inv.dist, Math.sqrt(dX * dX + dY * dY), 1e-9 * Math.max(1, inv.dist), '距離', bad, `#${i}`);
            const dd = Math.abs(normDeg(inv.az - az + 180) - 180); // 0°と360°をまたいでも正しく比べる
            close(dd, 0, 1e-8, '方向角', bad, `#${i}`);
            // 放射: 逆計算の方向角と距離で、もとの点に戻る
            const back = app.val(`cogoPolar(${JSON.stringify(a)}, ${inv.az}, ${inv.dist})`);
            n += 2; close(back.X, b.X, 1e-7, '放射 X', bad, `#${i}`); close(back.Y, b.Y, 1e-7, '放射 Y', bad, `#${i}`);
        }
        assert.ok(n >= 2000);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('杭打ち: 器械点・後視点から見た杭の夾角（右回り）・水平距離が、座標を回して求めた値と一致する', () => {
        const bad = []; let n = 0;
        for (let i = 0; i < 400; i++) {
            const st = pt(100000), bs = { X: st.X + (rnd() - 0.5) * 400, Y: st.Y + (rnd() - 0.5) * 400 }, tg = { X: st.X + (rnd() - 0.5) * 400, Y: st.Y + (rnd() - 0.5) * 400 };
            const r = app.val(`stakeFromStation(${JSON.stringify(st)}, ${JSON.stringify(bs)}, ${JSON.stringify(tg)})`);
            // 後視の向きが「北」になるように座標を回して、杭の方向を測る（右回りの角）
            const azB = Math.atan2(bs.Y - st.Y, bs.X - st.X);
            const vn = tg.X - st.X, ve = tg.Y - st.Y;
            const n2 = vn * Math.cos(azB) + ve * Math.sin(azB), e2 = -vn * Math.sin(azB) + ve * Math.cos(azB);
            const ang = normDeg(Math.atan2(e2, n2) * 180 / Math.PI);
            n += 2;
            close(Math.abs(normDeg(r.ang - ang + 180) - 180), 0, 1e-8, '夾角', bad, `#${i}`);
            close(r.dist, Math.hypot(vn, ve), 1e-9 * Math.max(1, r.dist), '水平距離', bad, `#${i}`);
        }
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('交点: 2直線・方向角の交会・距離の交会の点が、条件を満たす（線上にある・距離が合う）', () => {
        const bad = []; let n = 0;
        for (let i = 0; i < 300; i++) {
            const p1 = pt(2000), p2 = pt(2000), p3 = pt(2000), p4 = pt(2000);
            const ip = app.val(`cogoIntersectLines(${JSON.stringify(p1)}, ${JSON.stringify(p2)}, ${JSON.stringify(p3)}, ${JSON.stringify(p4)})`);
            if (ip) {
                // 両方の線の上にある（外積が 0）
                const c1 = (p2.X - p1.X) * (ip.Y - p1.Y) - (p2.Y - p1.Y) * (ip.X - p1.X), c2 = (p4.X - p3.X) * (ip.Y - p3.Y) - (p4.Y - p3.Y) * (ip.X - p3.X);
                const s1 = Math.hypot(p2.X - p1.X, p2.Y - p1.Y) * Math.max(1, Math.hypot(ip.X - p1.X, ip.Y - p1.Y)), s2 = Math.hypot(p4.X - p3.X, p4.Y - p3.Y) * Math.max(1, Math.hypot(ip.X - p3.X, ip.Y - p3.Y));
                n += 2; close(c1 / s1, 0, 1e-9, '線1の上', bad, `#${i}`); close(c2 / s2, 0, 1e-9, '線2の上', bad, `#${i}`);
            }
            // 距離の交会: a から da、b から db
            const a = pt(2000), b = { X: a.X + 100 + rnd() * 400, Y: a.Y + (rnd() - 0.5) * 400 }, d = Math.hypot(b.X - a.X, b.Y - a.Y);
            const da = d * (0.6 + rnd() * 0.6), db = d * (0.6 + rnd() * 0.6);
            const r = app.val(`cogoIntersectDistances(${JSON.stringify(a)}, ${da}, ${JSON.stringify(b)}, ${db})`);
            if (r) for (const k of ['right', 'left']) {
                n += 2;
                close(Math.hypot(r[k].X - a.X, r[k].Y - a.Y), da, 1e-7, `距離(a) ${k}`, bad, `#${i}`);
                close(Math.hypot(r[k].X - b.X, r[k].Y - b.Y), db, 1e-7, `距離(b) ${k}`, bad, `#${i}`);
            }
            // 方向角の交会: a から azA、b から azB の線の交点が、どちらの線の上にもある
            const azA = rnd() * 360, azB = rnd() * 360, az = app.val(`cogoIntersectAzimuths(${JSON.stringify(a)}, ${azA}, ${JSON.stringify(b)}, ${azB})`);
            if (az) {
                const va = [Math.cos(R(azA)), Math.sin(R(azA))], vb = [Math.cos(R(azB)), Math.sin(R(azB))];
                const ca = va[0] * (az.Y - a.Y) - va[1] * (az.X - a.X), cb = vb[0] * (az.Y - b.Y) - vb[1] * (az.X - b.X);
                const sa = Math.max(1, Math.hypot(az.X - a.X, az.Y - a.Y)), sb = Math.max(1, Math.hypot(az.X - b.X, az.Y - b.Y));
                n += 2; close(ca / sa, 0, 1e-9, '方位線A', bad, `#${i}`); close(cb / sb, 0, 1e-9, '方位線B', bad, `#${i}`);
            }
        }
        assert.ok(n >= 500, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('座標求積: 面積・周長が、重心から三角形に分けて求めた値と一致する。地積は端数を切り捨てる', () => {
        const bad = []; let n = 0;
        for (let i = 0; i < 200; i++) {
            // 中心のまわりに角度順に並べた点（ねじれない多角形）
            const cx = (rnd() - 0.5) * 100000, cy = (rnd() - 0.5) * 100000, k = 3 + Math.floor(rnd() * 9);
            const angs = Array.from({ length: k }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b);
            const pts = angs.map((a, j) => { const r = 5 + rnd() * 95; return { name: String(j + 1), X: Math.round((cx + r * Math.cos(a)) * 1000) / 1000, Y: Math.round((cy + r * Math.sin(a)) * 1000) / 1000 }; });
            const t = app.val(`cogoAreaTable(${JSON.stringify(pts)})`);
            // 重心（頂点の平均）から各辺への三角形の面積の和
            const mx = pts.reduce((s, p) => s + p.X, 0) / k, my = pts.reduce((s, p) => s + p.Y, 0) / k;
            let area2 = 0, per = 0;
            for (let j = 0; j < k; j++) { const p = pts[j], q = pts[(j + 1) % k]; area2 += (p.X - mx) * (q.Y - my) - (q.X - mx) * (p.Y - my); per += Math.hypot(q.X - p.X, q.Y - p.Y); }
            n += 3;
            close(t.area, Math.abs(area2) / 2, 1e-6 * Math.max(1, t.area), '面積', bad, `#${i}`);
            close(t.twice, Math.abs(area2), 2e-6 * Math.max(1, t.twice), '倍面積', bad, `#${i}`);
            close(t.perimeter, per, 1e-9 * Math.max(1, per), '周長', bad, `#${i}`);
        }
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
        // 地積（登記）の端数: 1㎡の1/100未満を切り捨て（'cm'）、10㎡を超える土地は1㎡未満を切り捨て（'m'）
        const land = (a, m) => app.eval(`cogoLandArea(${a}, '${m}')`);
        assert.equal(land(12.349999, 'cm'), '12.34'); assert.equal(land(12.35, 'cm'), '12.35'); assert.equal(land(250, 'cm'), '250.00');
        assert.equal(land(12.999, 'm'), '12'); assert.equal(land(9.999, 'm'), '9.99'); assert.equal(land(0.005, 'cm'), '0.00');
    });

    it('度分秒: 繰り上がり（59.9″→1′）・360° をまたぐ・負の角を、整数の秒で数えた文字と一致する', () => {
        const bad = []; let n = 0;
        const indep = (deg) => { let u = Math.round((((deg % 360) + 360) % 360) * 3600); if (u >= 1296000) u -= 1296000; const D = Math.floor(u / 3600), M = Math.floor((u % 3600) / 60), S = u % 60; return `${D}°${String(M).padStart(2, '0')}′${String(S).padStart(2, '0')}″`; };
        const cases = [0, 45.5, 359.99999, 359.999, 0.00013, 89.99999, 123.75170833, -45.5, -0.0001, 720.5, 10 + 29 / 60 + 59.6 / 3600, 10 + 59 / 60 + 59.6 / 3600];
        for (let i = 0; i < 300; i++) cases.push(rnd() * 360 - 30);
        for (const d of cases) { n++; const got = app.eval(`cogoFmtDms(${d})`), want = indep(d); if (got !== want) bad.push(`${d}: 出た ${got} / 期待 ${want}`); }
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('現在地（GNSS）: 緯度経度 → 平面直角（m）→ 図面の座標。m・mm の図面と UCS によらず、x＝東・y＝北に図面の倍率がかかり、測量座標に戻せる', () => {
        // 緯度経度 → 平面直角の換算そのものは、survey.test.cjs が独立の式（Redfearn）と 5mm 以内で照合済み。ここは、その先の
        // 「図面の座標（WCS）への置き方（東が x・北が y・倍率）」「精度の倍率」「帯の文字」を確かめる
        const bad = []; let n = 0;
        const sites = [[35.681236, 139.767125, 9], [36.5, 140.4, 9], [43.068661, 141.350755, 12], [26.2125, 127.6809, 15], [35.0, 135.0, 6]];
        app.eval('_gnssBar()'); // 帯（id=gnss-text）は測位を始めるまで無いので、文字の照合が空振りしないよう先に作る
        assert.equal(app.eval(`!!document.getElementById('gnss-text')`), true);
        for (const du of ['m', 'mm']) for (const ucs of UCS_CASES) for (const [lat, lon, zone] of sites) {
            const f = PER_M[du], tag = `図面 ${du}・${ucs.name}・${zone}系 (${lat},${lon})`;
            configure(app, { du, prefs: {}, ucs });
            app.eval(`localStorage.setItem('cad_gnss_zone', '${zone}'); _applyGnssFix({ lat: ${lat}, lon: ${lon}, acc: 4.2, time: 0 });`);
            const fix = app.val('_gnss.fix'), ref = app.val(`latLonToJprcs(${lat}, ${lon}, ${zone})`);
            const back = app.val(`wcsToSurvey(${fix.x}, ${fix.y})`);
            const bar = app.eval(`document.getElementById('gnss-text').textContent`);
            const chk = (got, want, what, tol) => { n++; if (!(Math.abs(got - want) <= tol)) bad.push(`${what} ${tag}: 出た ${got} / 期待 ${want}`); };
            chk(fix.x, ref.Y * f, '図面 x（東）', 1e-9 * f); chk(fix.y, ref.X * f, '図面 y（北）', 1e-9 * f);
            chk(fix.X, ref.X, '測量 X（北・m）', 1e-9); chk(fix.Y, ref.Y, '測量 Y（東・m）', 1e-9);
            chk(fix.accU, 4.2 * f, '精度（図面の単位）', 1e-9 * f);
            chk(back.X, ref.X, '戻した X', 1e-6); chk(back.Y, ref.Y, '戻した Y', 1e-6);
            n++; if (!bar.includes(`X ${fix3(ref.X)}  Y ${fix3(ref.Y)}`) || !bar.includes('±4.2m')) bad.push(`帯の文字 ${tag}: ${bar}`);
        }
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
        assert.ok(n >= 240, `照合が少なすぎる ${n}`);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
