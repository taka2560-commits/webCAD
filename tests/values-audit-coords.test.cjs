'use strict';
// 値の監査 2: 座標の読み取り（ステータスバー・ルーペ・全画面の座標）と、プロパティ欄（選んだ図形の座標・長さ）。
// 期待値は tests/helpers/values-oracle.cjs の独立した式で求める（アプリの関数は使わない）。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const O = require('./helpers/values-oracle.cjs');
const { PER_M, R, UCS_CASES, PROP_ENTS, inUcs, screenToUcsM, coordDigits, configure, drawnTexts } = O;

describe('値の監査: 座標の読み取り（ステータスバー・ルーペ・全画面）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('画面の位置 × 図面の単位 × 座標の単位 × 桁 × UCS × 画面の回転: 出る座標が独立した計算と同じ', () => {
        const POS = [[137.3, 242.9], [520.1, 88.7], [701.6, 433.2]];
        const bad = []; let n = 0;
        for (const du of ['m', 'mm']) {
            const sc = du === 'mm' ? 0.01 : 10;
            const VIEWS = [{ x: 400, y: 300, scale: sc, rotation: 0 }, { x: 250.5, y: 410.25, scale: sc * 1.7, rotation: R(30) }, { x: 620, y: 120, scale: sc * 0.6, rotation: R(-100) }];
            for (const cu of ['auto', 'm', 'mm']) for (const cd of ['std', '0', '1', '2', '3']) for (const ucs of UCS_CASES) for (const view of VIEWS) {
                configure(app, { du, prefs: { coordUnit: cu, coordDecimals: cd }, ucs });
                app.eval(`view = ${JSON.stringify(view)};`);
                const unit = cu === 'auto' ? du : cu;
                for (const [sx, sy] of POS) {
                    const u = screenToUcsM(sx, sy, view, du, { oE: ucs.oE, oN: ucs.oN, th: R(ucs.deg) });
                    const fmt = (vM, where) => (vM * PER_M[unit]).toFixed(coordDigits(cd, where, unit));
                    const tag = `図面 ${du}・座標 ${cu}・桁 ${cd}・${ucs.name}・回転 ${Math.round(view.rotation * 180 / Math.PI)}°・画面 (${sx},${sy})`;
                    // ステータスバー（マウスを動かしたとき）
                    app.eval(`document.body.classList.remove('fullscreen-mode'); canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${sx}, clientY: ${sy}, bubbles: true }));`);
                    const bar = app.val('[...coordsDisplay.children].map((c) => c.textContent)');
                    const wantBar = ['X:' + fmt(u.n, 'bar'), 'Y:' + fmt(u.e, 'bar')];
                    n++; if (JSON.stringify(bar) !== JSON.stringify(wantBar)) bad.push(`ステータスバー ${tag}: 出た ${JSON.stringify(bar)} / 期待 ${JSON.stringify(wantBar)}`);
                    // ルーペ（指でなぞったとき。下に出る座標）
                    app.eval(`touchState.showLoupe = true; touchState.loupeX = ${sx}; touchState.loupeY = ${sy};`);
                    const loupe = drawnTexts(app, false).filter((t) => /^X:.*\s{2}Y:/.test(t));
                    app.eval('touchState.showLoupe = false');
                    const wantLoupe = `X:${fmt(u.n, 'loupe')}  Y:${fmt(u.e, 'loupe')}`;
                    n++; if (JSON.stringify(loupe) !== JSON.stringify([wantLoupe])) bad.push(`ルーペ ${tag}: 出た ${JSON.stringify(loupe)} / 期待 ${wantLoupe}`);
                    // 全画面の座標（上の帯）
                    app.eval(`document.body.classList.add('fullscreen-mode'); canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${sx}, clientY: ${sy}, bubbles: true }));`);
                    const hud = app.val(`[document.getElementById('fs-hud-x').textContent, document.getElementById('fs-hud-y').textContent]`);
                    app.eval(`document.body.classList.remove('fullscreen-mode')`);
                    const wantHud = [fmt(u.n, 'bar'), fmt(u.e, 'bar')];
                    n++; if (JSON.stringify(hud) !== JSON.stringify(wantHud)) bad.push(`全画面 ${tag}: 出た ${JSON.stringify(hud)} / 期待 ${JSON.stringify(wantHud)}`);
                }
            }
        }
        assert.ok(n >= 2000, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('スナップしているときは、スナップした点の座標を出す（指の位置ではなく）', () => {
        const bad = [];
        for (const du of ['m', 'mm']) for (const ucs of UCS_CASES) {
            const f = PER_M[du];
            configure(app, { du, prefs: { coordUnit: 'auto', coordDecimals: '3' }, ucs });
            // 線の端点 E=30.5・N=3.25（m）の近くでスナップ
            app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: ${30.5 * f}, y1: ${3.25 * f}, x2: ${40 * f}, y2: ${3.25 * f} }); _bumpGeomEpoch();
                processCommand('LINE'); view = { x: 400, y: 300, scale: ${du === 'mm' ? 0.01 : 10}, rotation: 0 };`);
            const s = app.val(`wcsToScreen(${30.5 * f}, ${3.25 * f})`);
            app.eval(`canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: ${s.x + 2}, clientY: ${s.y + 2}, bubbles: true }));`);
            const u = inUcs(30.5, 3.25, { oE: ucs.oE, oN: ucs.oN, th: R(ucs.deg) });
            const want = ['X:' + (u.n * PER_M[du]).toFixed(3), 'Y:' + (u.e * PER_M[du]).toFixed(3)];
            const got = app.val('[...coordsDisplay.children].map((c) => c.textContent)');
            if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`図面 ${du}・${ucs.name}: 出た ${JSON.stringify(got)} / 期待 ${JSON.stringify(want)}`);
        }
        assert.deepEqual(bad, []);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});

describe('値の監査: プロパティ欄（選んだ図形の座標・長さ）と、欄に入れた値の書き戻し', () => {
    let app;
    before(async () => {
        app = await loadApp();
        // 選んだ図形の欄の（見出し → 値）
        app.eval(`window.__props = function(def) {
            entities.length = 0; entities.push(JSON.parse(JSON.stringify(def))); ensureEntityIds(); cmdState.highlightIdx = 0; updatePropertiesPanel();
            const out = {};
            document.querySelectorAll('#props-content .prop-row').forEach((row) => {
                const l = row.querySelector('.prop-label'), i = row.querySelector('input.prop-val[type=number]');
                if(l && i) out[l.textContent.trim()] = i.value;
            });
            return out;
        }`);
    });
    after(() => app.close());

    it('座標・長さの欄の値が、独立した計算と同じ（m は小数3桁、mm は小数1桁。「図面どおり」でも同じ）', () => {
        const bad = []; let n = 0;
        for (const du of ['m', 'mm']) for (const cu of ['auto', 'm', 'mm']) for (const lu of ['auto', 'm', 'mm']) for (const ucs of UCS_CASES) {
            const cUnit = cu === 'auto' ? du : cu, lUnit = lu === 'auto' ? du : lu, f = PER_M[du];
            configure(app, { du, prefs: { coordUnit: cu, lenUnit: lu }, ucs });
            const toU = (E, N) => inUcs(E, N, { oE: ucs.oE, oN: ucs.oN, th: R(ucs.deg) });
            const dig = (unit) => (unit === 'mm' ? 1 : 3);
            for (const pe of PROP_ENTS) {
                const got = app.val(`window.__props(${JSON.stringify(pe.e(f))})`);
                const want = pe.fields(toU);
                for (const [label, v] of Object.entries(want)) {
                    let w;
                    if (typeof v === 'number') w = (v * PER_M[cUnit]).toFixed(dig(cUnit));
                    else if (v.len !== undefined) w = (v.len * PER_M[lUnit]).toFixed(dig(lUnit));
                    else w = v.raw;
                    n++;
                    if (got[label] !== w) bad.push(`${pe.id}「${label}」図面 ${du}・座標 ${cu}・長さ ${lu}・${ucs.name}: 出た ${got[label]} / 期待 ${w}`);
                }
            }
        }
        assert.ok(n >= 500, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('欄に入れた値が、正しい図面の座標になる（UCS・図面の単位・表示の単位をまたいで）', () => {
        const bad = []; let n = 0;
        // 入れる値は m で決めて、表示の単位に直して欄に入れる
        for (const du of ['m', 'mm']) for (const cu of ['auto', 'm', 'mm']) for (const lu of ['auto', 'm', 'mm']) for (const ucs of UCS_CASES) {
            const cUnit = cu === 'auto' ? du : cu, lUnit = lu === 'auto' ? du : lu, f = PER_M[du];
            configure(app, { du, prefs: { coordUnit: cu, lenUnit: lu }, ucs });
            const th = R(ucs.deg), tag = `図面 ${du}・座標 ${cu}・長さ ${lu}・${ucs.name}`;
            // 線の始点の X（北）だけを 5.4321m にする → UCS の（東, 北）のうち北だけが変わる
            app.eval(`entities.length = 0; entities.push(${JSON.stringify(PROP_ENTS[0].e(f))}); ensureEntityIds();`);
            const id = app.eval('entities[0].id');
            const e0 = inUcs(1.25, 2.5, { oE: ucs.oE, oN: ucs.oN, th });
            app.eval(`changeEntityPropById(${id}, 'y1', '${(5.4321 * PER_M[cUnit]).toFixed(6)}')`);
            // 期待: UCS の（東 e0.e, 北 5.4321）を図面の座標にもどす
            const wantE = ucs.oE + e0.e * Math.cos(th) - 5.4321 * Math.sin(th), wantN = ucs.oN + e0.e * Math.sin(th) + 5.4321 * Math.cos(th);
            const got = app.val('({ x: entities[0].x1, y: entities[0].y1, x2: entities[0].x2, y2: entities[0].y2 })');
            n++; if (Math.abs(got.x / f - wantE) > 1e-6 || Math.abs(got.y / f - wantN) > 1e-6) bad.push(`始点 ${tag}: 出た (${got.x / f}, ${got.y / f}) / 期待 (${wantE}, ${wantN})`);
            n++; if (Math.abs(got.x2 / f - 11.3456) > 1e-9 || Math.abs(got.y2 / f - 8.7654) > 1e-9) bad.push(`終点が動いた ${tag}`);
            // 円の半径を 3.21m にする（長さの単位）
            app.eval(`entities.length = 0; entities.push(${JSON.stringify(PROP_ENTS[1].e(f))}); ensureEntityIds();`);
            app.eval(`changeEntityPropById(entities[0].id, 'radius', '${(3.21 * PER_M[lUnit]).toFixed(6)}')`);
            const rr = app.eval('entities[0].radius');
            n++; if (Math.abs(rr / f - 3.21) > 1e-9) bad.push(`半径 ${tag}: 出た ${rr / f}m`);
            // 測点の X・Y（北・東）を入れる
            app.eval(`entities.length = 0; entities.push(${JSON.stringify(PROP_ENTS[5].e(f))}); ensureEntityIds();`);
            const pid = app.eval('entities[0].id');
            app.eval(`changeEntityPropById(${pid}, 'y', '${(4.5 * PER_M[cUnit]).toFixed(6)}'); changeEntityPropById(${pid}, 'x', '${(7.25 * PER_M[cUnit]).toFixed(6)}');`);
            const wE = ucs.oE + 7.25 * Math.cos(th) - 4.5 * Math.sin(th), wN = ucs.oN + 7.25 * Math.sin(th) + 4.5 * Math.cos(th);
            const pg = app.val('({ x: entities[0].x, y: entities[0].y })');
            n++; if (Math.abs(pg.x / f - wE) > 1e-6 || Math.abs(pg.y / f - wN) > 1e-6) bad.push(`測点 ${tag}: 出た (${pg.x / f}, ${pg.y / f}) / 期待 (${wE}, ${wN})`);
        }
        assert.ok(n >= 200, `照合した数 ${n}`);
        assert.deepEqual(bad.slice(0, 12), [], `食い違い ${bad.length}件 / 照合 ${n}件`);
    });

    it('閉じたポリライン（区画）の面積は、単位によらず ㎡ で正しい', () => {
        const bad = [];
        // 東西 20m × 南北 12.5m の長方形の区画 → 250㎡
        for (const du of ['m', 'mm']) {
            const f = PER_M[du];
            configure(app, { du, prefs: {} });
            const pl = { type: 'PLINE', layer: 0, color: null, closed: true, lotName: '1', points: [[0, 0], [20, 0], [20, 12.5], [0, 12.5]].map(([e, nn]) => ({ x: (100 + e) * f, y: (50 + nn) * f })) };
            const t = app.eval(`(() => { entities.length = 0; entities.push(${JSON.stringify(pl)}); ensureEntityIds(); cmdState.highlightIdx = 0; updatePropertiesPanel(); return document.getElementById('props-content').textContent; })()`);
            if (!/面積\s*250\.000 ㎡/.test(t)) bad.push(`図面 ${du}: ${String(t.match(/面積.{0,20}/))}`);
        }
        assert.deepEqual(bad, []);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
