'use strict';
// 背景地図・下絵（cad-underlay.js）と平面直角座標の逆換算（cad-survey.js）のテスト:
//   平面直角座標 ⇔ 緯度経度の往復、タイルの番号、画面に要るタイル（ズーム・枚数・日本の外）、
//   地図のタイルと下絵をアフィン変換で描く、2点で合わせる（計算・点の指定の流れ・画像の点はスナップしない）、端末に保存
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('背景地図・下絵', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
        // 読み込むとすぐ onload が来る Image の代わり（jsdom は画像を読み込まない）
        app.eval(`window.__imgs = []; window.Image = class { constructor() { this.width = 256; this.height = 256; window.__imgs.push(this); } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };`);
    });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`resetCommand(); entities.length = 0; localStorage.removeItem('cad_survey_unit'); localStorage.removeItem('cad_underlay_opts'); localStorage.setItem('cad_gnss_zone', '9');
            _ul.img = null; _ul.tiles.clear(); _ul.aligning = false; _ul.warned = {}; _cogo.slots = {}; _cogo.pick = null; window.__imgs.length = 0;
            view = { x: 400, y: 300, scale: 1, rotation: 0 };`);
    });
    // ctx の setTransform・drawImage・fillText を記録する
    const record = (code) => {
        app.eval(`window.__c = []; ctx.setTransform = (a, b, c, d, e, f) => window.__c.push({ k: 'T', v: [a, b, c, d, e, f] }); ctx.drawImage = (img) => window.__c.push({ k: 'img', src: img._src || img.name || '' }); ctx.fillText = (t) => window.__c.push({ k: 'txt', t: String(t) });`);
        try { app.run(code); } finally { app.eval('delete ctx.setTransform; delete ctx.drawImage; delete ctx.fillText;'); }
        return app.val('window.__c');
    };

    it('平面直角座標 ⇔ 緯度経度（往復の差は 1e-9 度未満・原点）', () => {
        const worst = app.eval(`(() => { let w = 0; for (const [la, lo, z] of [[35.6812, 139.7671, 9], [34.7025, 135.4959, 6], [43.0686, 141.3508, 12], [26.2124, 127.6809, 15], [33.5902, 130.4017, 2], [38.2682, 140.8694, 10]]) {
            const p = latLonToJprcs(la, lo, z), q = jprcsToLatLon(p.X, p.Y, z); w = Math.max(w, Math.abs(q.lat - la), Math.abs(q.lon - lo)); } return w; })()`);
        assert.ok(worst < 1e-9, String(worst));
        const o = app.val('jprcsToLatLon(0, 0, 9)');
        assert.ok(near(o.lat, 36, 1e-12) && near(o.lon, 139 + 50 / 60, 1e-12));
    });
    it('タイルの番号（東京駅 z=10 は 909/403）と往復', () => {
        const t = app.val('ulLonLatToTile(139.7671, 35.6812, 10)');
        assert.equal(Math.floor(t.x), 909);
        assert.equal(Math.floor(t.y), 403);
        const b = app.val(`ulTileToLonLat(${t.x}, ${t.y}, 10)`);
        assert.ok(near(b.lon, 139.7671, 1e-9) && near(b.lat, 35.6812, 1e-9));
        assert.equal(app.eval(`ulTileUrl('std', 10, 909, 403)`), 'https://cyberjapandata.gsi.go.jp/xyz/std/10/909/403.png');
        assert.equal(app.eval(`ulTileUrl('seamlessphoto', 18, 1, 2)`), 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/18/1/2.jpg');
    });
    it('画面に要るタイル: ズームは画面の細かさに合わせ、枚数は上限まで。系番号なし・日本の外は描かない', () => {
        // 東京駅を画面の中央に（1px ＝ 約 0.5m）
        app.run(`const p = latLonToJprcs(35.6812, 139.7671, 9), w = surveyToWcs(p.X, p.Y); view.scale = 2; _reanchorView(canvas.width / 2, canvas.height / 2, w);`);
        const r = app.val(`ulVisibleTiles('std')`);
        assert.ok(r.z >= 16 && r.z <= 18, 'z=' + r.z);
        assert.ok(r.list.length >= 1 && r.list.length <= 80);
        // 広く見ると粗いズーム（枚数は上限まで）
        app.run(`const c = screenToWcs(canvas.width / 2, canvas.height / 2); view.scale = 0.0005; _reanchorView(canvas.width / 2, canvas.height / 2, c);`);
        const wide = app.val(`ulVisibleTiles('std')`);
        assert.ok(wide.z < r.z && wide.list.length <= 80, JSON.stringify({ z: wide.z, n: wide.list.length }));
        app.eval(`localStorage.removeItem('cad_gnss_zone')`);
        assert.equal(app.eval(`ulVisibleTiles('std')`), null);
        app.eval(`localStorage.setItem('cad_gnss_zone', '9'); view = { x: 400, y: 300, scale: 1, rotation: 0 }; _reanchorView(canvas.width / 2, canvas.height / 2, { x: 0, y: 9000000 });`);
        assert.deepEqual(app.val(`ulVisibleTiles('std')`), { outside: true });
    });
    it('地図: 読み込めたタイルをアフィン変換で描き、出典を出す（画面の回転にも合わせる）', async () => {
        app.run(`const p = latLonToJprcs(35.6812, 139.7671, 9), w = surveyToWcs(p.X, p.Y); view.scale = 2; view.rotation = 0.3; _reanchorView(canvas.width / 2, canvas.height / 2, w);
            localStorage.setItem('cad_underlay_opts', JSON.stringify({ map: 'pale', mapOpacity: 0.5 }));`);
        record('drawUnderlays()'); // 1回目: タイルを読み込み始める
        await new Promise((r) => setTimeout(r, 20));
        const c = record('drawUnderlays()');
        const imgs = c.filter((x) => x.k === 'img');
        assert.ok(imgs.length >= 1, JSON.stringify(c.slice(0, 5)));
        assert.match(imgs[0].src, /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/\d+\/\d+\/\d+\.png$/);
        assert.ok(c.some((x) => x.k === 'txt' && x.t === '出典：地理院タイル'));
        // 1枚目のタイルの左上が、その緯度経度の画面の位置に来ている
        const m = /pale\/(\d+)\/(\d+)\/(\d+)/.exec(imgs[0].src).slice(1).map(Number);
        const T = c[c.findIndex((x) => x.k === 'img') - 1].v;
        const want = app.val(`(() => { const ll = ulTileToLonLat(${m[1]}, ${m[2]}, ${m[0]}); const p = latLonToJprcs(ll.lat, ll.lon, 9), w = surveyToWcs(p.X, p.Y); return wcsToScreen(w.x, w.y); })()`);
        assert.ok(near(T[4], want.x, 1e-6) && near(T[5], want.y, 1e-6));
        // 回転していると、タイルも回って描かれる（b が 0 でない）
        assert.ok(Math.abs(T[1]) > 0.01, JSON.stringify(T));
    });
    it('下絵: 画面の中央に画面と同じ向きで置き、アフィン変換で描く。隠す・濃さ', () => {
        app.eval(`ulSetImage({ name: 'scan' }, 1000, 500, null)`);
        const T = app.val('_ul.img.T');
        // 画像の中心が画面の中央
        const ctr = app.val(`wcsToScreen(${T[4]} + ${T[0]} * 500 + ${T[2]} * 250, ${T[5]} + ${T[1]} * 500 + ${T[3]} * 250)`);
        assert.ok(near(ctr.x, app.eval('canvas.width / 2'), 1e-6) && near(ctr.y, app.eval('canvas.height / 2'), 1e-6));
        const c = record('drawUnderlays()');
        assert.equal(c.filter((x) => x.k === 'img').length, 1);
        app.eval('ulToggleImage()');
        assert.equal(record('drawUnderlays()').filter((x) => x.k === 'img').length, 0);
        app.eval('ulToggleImage(); ulSetImageOpacity(30)');
        assert.ok(near(app.eval('_ul.img.opacity'), 0.3));
    });
    it('2点で合わせる計算: 画像の2点を図面の2点に重ねる（倍率・回転・移動）', () => {
        const r = app.val(`ulAlignTwoPoints([1, 0, 0, -1, 100, 200], { x: 100, y: 200 }, { x: 10, y: 10 }, { x: 110, y: 200 }, { x: 10, y: 30 })`);
        assert.ok(near(r.k, 2) && near(r.th, Math.PI / 2));
        // 画像の (10, 0) px（図面の 110,200）→ 図面の 10,30
        const T = r.T, u = 10, v = 0;
        assert.ok(near(T[4] + T[0] * u + T[2] * v, 10) && near(T[5] + T[1] * u + T[3] * v, 30));
        assert.equal(app.eval(`ulAlignTwoPoints([1, 0, 0, -1, 0, 0], { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 })`), null);
    });
    it('2点で合わせる操作: 画像の点はスナップせずに指の位置、図面の点はスナップ。終わると下絵が重なる', () => {
        app.eval(`ulSetImage({ name: 'scan' }, 1000, 500, null, [0.01, 0, 0, -0.01, 0, 5]); showUnderlayPanel(); ulStartAlign();`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT');
        // 画像の点1: 近くに測点があっても、指の位置（1, 4）を使う
        app.eval(`mouse.wcsX = 1; mouse.wcsY = 4; snapResult = { wcsX: 1.2, wcsY: 4.1, type: '端点' }; handlePointInput({ x: 1.2, y: 4.1 }, false)`);
        assert.deepEqual(app.val('[_cogo.slots.UA.x, _cogo.slots.UA.y]'), [1, 4]);
        app.eval(`snapResult = { wcsX: 100, wcsY: 100, type: '点' }; handlePointInput({ x: 100, y: 100 }, false)`); // 図面の点1
        app.eval(`mouse.wcsX = 6; mouse.wcsY = 4; snapResult = null; handlePointInput({ x: 6, y: 4 }, false)`);        // 画像の点2
        app.eval(`snapResult = { wcsX: 150, wcsY: 100, type: '点' }; handlePointInput({ x: 150, y: 100 }, false)`); // 図面の点2
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(app.eval('_ul.aligning'), false);
        // 画像の px で (100, 100) だった点（図面の 1,4）が、図面の 100,100 に来ている
        const T = app.val('_ul.img.T');
        assert.ok(near(T[4] + T[0] * 100 + T[2] * 100, 100, 1e-9) && near(T[5] + T[1] * 100 + T[3] * 100, 100, 1e-9), JSON.stringify(T));
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /下絵を2点で合わせました（倍率 ×10\.000/);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🗺 地図・下絵');
    });
    it('下絵は端末に保存し、消すと空にする', async () => {
        app.window.__buf = new Uint8Array([1, 2, 3]).buffer;
        app.eval(`ulSetImage({ name: 'scan' }, 10, 20, { mime: 'image/png', data: window.__buf, name: 'scan.png' })`);
        await app.eval('ulSaveImage()');
        const r = await app.eval(`_dbGet(STORE_AUTOSAVE, 'underlay').then(r => JSON.stringify({ mime: r.mime, w: r.w, h: r.h, T: r.T, name: r.name, n: r.data.byteLength }))`);
        const v = JSON.parse(r);
        assert.equal(v.mime, 'image/png');
        assert.equal(v.n, 3);
        assert.deepEqual([v.w, v.h, v.name], [10, 20, 'scan.png']);
        assert.deepEqual(v.T, app.val('_ul.img.T'));
        app.eval('ulRemoveImage()');
        await new Promise((r2) => setTimeout(r2, 30));
        assert.equal(await app.eval(`_dbGet(STORE_AUTOSAVE, 'underlay')`), null);
    });
    it('パネル・コマンド・系番号の案内', () => {
        app.eval(`processCommand('MAP')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🗺 地図・下絵');
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /IX系/);
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /画像を読み込む/);
        app.eval(`localStorage.removeItem('cad_gnss_zone'); ulSetMap('std')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🛰 系番号の選択'); // 系番号を選ぶ画面
        app.eval('setGnssZone(9)');
        assert.equal(app.eval('ulOpts().map'), 'std');
        assert.deepEqual(app.errors(), []);
    });
});
