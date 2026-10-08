'use strict';
// 下絵のワールドファイル・PDF のページ（v5.33）: ワールドファイル（.jgw など）を画像と一緒に選ぶと、座標の位置に自動で合わせる
// （平面直角座標・緯度経度・ウェブメルカトル。縮めた画像・回した画像も）。PDF の下絵は、あとでページを選び直せる（大きさが同じなら位置はそのまま）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

const nearArr = (a, b, eps) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));

describe('下絵のワールドファイル・PDF のページ', () => {
    let app;
    before(async () => {
        app = await loadApp();
        // 読み込むとすぐ onload が来る Image の代わり（大きさは window.__imgSize）。jsdom の Blob に arrayBuffer が無いので足す
        app.eval(`window.__imgSize = [256, 256];
            window.Image = class { constructor() { this.width = window.__imgSize[0]; this.height = window.__imgSize[1]; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
            if(!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsArrayBuffer(this); }); };
            URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {};`);
    });
    after(() => app.close());
    beforeEach(() => app.eval(`localStorage.setItem('cad_survey_unit', 'm'); localStorage.setItem('cad_gnss_zone', '9'); _ul.img = null; window.__imgSize = [256, 256];
        document.getElementById('cad-toast') && document.getElementById('cad-toast').classList.remove('show'); commandLog.innerHTML = '';`));

    it('ワールドファイルを読む（6行の数。読めないものは null）と、座標の種類を見分ける', () => {
        assert.deepEqual(app.val(`ulParseWorldFile('0.1\\r\\n0\\r\\n0\\r\\n-0.1\\r\\n-52000.05\\r\\n645100.05\\r\\n')`), { A: 0.1, D: 0, B: 0, E: -0.1, C: -52000.05, F: 645100.05 });
        assert.equal(app.val(`ulParseWorldFile('0.1\\n0\\n0\\n-0.1\\n5')`), null);
        assert.equal(app.val(`ulParseWorldFile('0.1\\n0\\n0\\nx\\n5\\n6')`), null);
        assert.equal(app.val(`ulParseWorldFile('0\\n0\\n0\\n0\\n5\\n6')`), null, '大きさが 0');
        assert.equal(app.val(`ulWorldKind({ A: 0.1, D: 0, B: 0, E: -0.1, C: -52000, F: 645100 })`), 'plane');
        assert.equal(app.val(`ulWorldKind({ A: 1e-5, D: 0, B: 0, E: -1e-5, C: 139.76, F: 35.68 })`), 'deg');
        assert.equal(app.val(`ulWorldKind({ A: 0.5, D: 0, B: 0, E: -0.5, C: 15558000, F: 4257000 })`), 'merc');
    });

    it('平面直角座標: 左上の画素の中心 → 画像の角。縮めた画像（w・h）にも合わせ、mm の図面は 1000 倍', () => {
        const wf = '{ A: 0.1, D: 0, B: 0, E: -0.1, C: -52000.05, F: 645100.05 }';
        assert.ok(nearArr(app.val(`ulWorldTransform(${wf}, 1000, 500, 1000, 500, 9).T`), [0.1, 0, 0, -0.1, -52000.1, 645100.1], 1e-9));
        assert.ok(nearArr(app.val(`ulWorldTransform(${wf}, 1000, 500, 500, 250, 9).T`), [0.2, 0, 0, -0.2, -52000.1, 645100.1], 1e-9));
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm')`);
        assert.ok(nearArr(app.val(`ulWorldTransform(${wf}, 1000, 500, 1000, 500, 9).T`), [100, 0, 0, -100, -52000100, 645100100], 1e-6));
    });

    it('回した画像: 画像の四隅が、ワールドファイルの四隅に重なる', () => {
        const th = 30 * Math.PI / 180, s = 0.05;
        const W = { A: s * Math.cos(th), D: s * Math.sin(th), B: s * Math.sin(th), E: -s * Math.cos(th), C: 1000, F: 2000 };
        const T = app.val(`ulWorldTransform(${JSON.stringify(W)}, 400, 300, 200, 150, 9).T`);
        const map = (px, py) => [T[0] * px + T[2] * py + T[4], T[1] * px + T[3] * py + T[5]];
        const x0 = W.C - (W.A + W.B) / 2, y0 = W.F - (W.D + W.E) / 2; // 世界の座標（x＝東・y＝北）＝図面の x・y
        const corner = (c, r) => [x0 + W.A * c + W.B * r, y0 + W.D * c + W.E * r];
        assert.ok(nearArr(map(0, 0), corner(0, 0), 1e-9) && nearArr(map(200, 0), corner(400, 0), 1e-9) && nearArr(map(0, 150), corner(0, 300), 1e-9) && nearArr(map(200, 150), corner(400, 300), 1e-9));
    });

    it('緯度経度・ウェブメルカトル: 系番号で平面直角座標に直す。系番号が無ければ合わせない', () => {
        const deg = { A: 1e-5, D: 0, B: 0, E: -1e-5, C: 139.76, F: 35.68 };
        const T = app.val(`ulWorldTransform(${JSON.stringify(deg)}, 100, 100, 100, 100, 9).T`);
        const tl = app.val(`(() => { const p = latLonToJprcs(35.68 + 0.5e-5, 139.76 - 0.5e-5, 9); return surveyToWcs(p.X, p.Y); })()`);
        assert.ok(near(T[4], tl.x, 1e-6) && near(T[5], tl.y, 1e-6));
        assert.ok(near(T[0], 0.9, 0.2) && near(-T[3], 1.1, 0.2), '1画素はおよそ 1m');
        assert.equal(app.val(`ulWorldTransform(${JSON.stringify(deg)}, 100, 100, 100, 100, null)`), null);
        // メルカトル: 東京駅（139.7671, 35.6812）を左上の角にしたもの
        const R = 6378137, lon = 139.7671, lat = 35.6812;
        const mx = lon * Math.PI / 180 * R, my = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
        const merc = { A: 0.5, D: 0, B: 0, E: -0.5, C: mx + 0.25, F: my - 0.25 };
        const T2 = app.val(`ulWorldTransform(${JSON.stringify(merc)}, 10, 10, 10, 10, 9).T`);
        const tl2 = app.val(`(() => { const p = latLonToJprcs(${lat}, ${lon}, 9); return surveyToWcs(p.X, p.Y); })()`);
        assert.ok(near(T2[4], tl2.x, 1e-4) && near(T2[5], tl2.y, 1e-4), `${T2[4]},${T2[5]} ≠ ${tl2.x},${tl2.y}`);
    });

    it('画像とワールドファイルを一緒に選ぶと、名前の同じ画像をその位置に置く', async () => {
        await app.eval(`ulPickFiles([new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
            new File(['0.1\\n0\\n0\\n-0.1\\n-52000.05\\n645100.05\\n'], 'B.JGW')])`);
        assert.equal(app.val('_ul.img.name'), 'b.jpg');
        assert.ok(nearArr(app.val('_ul.img.T'), [0.1, 0, 0, -0.1, -52000.1, 645100.1], 1e-9));
        assert.match(app.val(`document.getElementById('cad-toast').textContent`), /ワールドファイル（B\.JGW・平面直角座標・1画素 0\.1000m）で位置を合わせました/);
        // 端末に保存して読み直しても同じ（縮める前の大きさも）
        await app.eval('ulRestore()');
        assert.deepEqual(app.val('[_ul.img.ow, _ul.img.oh]'), [256, 256]);
    });

    it('今の下絵にワールドファイルだけを当てる。読めない・系番号が無いときは知らせて、置き方は変えない', async () => {
        await app.eval(`ulLoadImageFile(new File(['a'], 'scan.png', { type: 'image/png' }))`);
        const T0 = app.val('_ul.img.T');
        assert.equal(await app.eval(`ulApplyWorldFile(new File(['1\\n2\\n3'], 'scan.pgw'))`), false);
        assert.match(app.val(`document.getElementById('cad-toast').textContent`), /6行の数ではありません/);
        app.eval(`localStorage.removeItem('cad_gnss_zone')`);
        assert.equal(await app.eval(`ulApplyWorldFile(new File(['1e-5\\n0\\n0\\n-1e-5\\n139.76\\n35.68'], 'scan.pgw'))`), false);
        assert.match(app.val(`document.getElementById('cad-toast').textContent`), /緯度経度のワールドファイルです。.*系番号/);
        assert.deepEqual(app.val('_ul.img.T'), T0);
        assert.equal(await app.eval(`ulApplyWorldFile(new File(['0.5\\n0\\n0\\n-0.5\\n100.25\\n200.25'], 'scan.pgw'))`), true);
        assert.ok(nearArr(app.val('_ul.img.T'), [0.5, 0, 0, -0.5, 100, 200.5], 1e-9));
        // ワールドファイルだけを選んだときも、今の下絵に当てる
        await app.eval(`ulPickFiles([new File(['0.25\\n0\\n0\\n-0.25\\n0.125\\n-0.125'], 'scan.pgw')])`);
        assert.ok(nearArr(app.val('_ul.img.T'), [0.25, 0, 0, -0.25, 0, 0], 1e-9));
        app.eval('showUnderlayPanel()');
        assert.match(app.val(`document.getElementById('property-panel-content').textContent`), /📐 ワールドファイルで合わせる/);
    });

    it('PDF の下絵: あとでページを選び直せる（同じ大きさなら位置はそのまま、違えば置き直して知らせる）', async () => {
        app.eval(`window.__got = []; window.__sizes = { 1: [842, 595], 2: [595, 842], 3: [842, 595] };
            window.loadPdfJs = async () => ({ getDocument: ({ data }) => { window.__got.push(data.length); return { promise: Promise.resolve({ numPages: 3,
                getPage: async (n) => ({ getViewport: ({ scale }) => ({ width: window.__sizes[n][0] * scale, height: window.__sizes[n][1] * scale }), render: () => ({ promise: Promise.resolve() }) }) }) }; } });`);
        app.window.prompt = () => '1';
        assert.equal(await app.eval(`ulLoadPdfFile(new File([new Uint8Array([37, 80, 68, 70, 45])], 'kouzu.pdf', { type: 'application/pdf' }))`), true);
        assert.deepEqual(app.val('[_ul.img.page, _ul.img.pages, _ul.img.pdfName, _ul.img.pdf.byteLength]'), [1, 3, 'kouzu.pdf', 5]);
        app.eval('_ul.img.T = [0.01, 0, 0, -0.01, 50, 60]; _ul.img.opacity = 0.3;');
        app.window.prompt = () => '３';
        assert.equal(await app.eval('ulChangePdfPage()'), true);
        assert.deepEqual(app.val('[_ul.img.page, _ul.img.name, _ul.img.T, _ul.img.opacity]'), [3, 'kouzu.pdf（3ページ）', [0.01, 0, 0, -0.01, 50, 60], 0.3]);
        app.window.prompt = () => '2';
        await app.eval('ulChangePdfPage()');
        assert.equal(app.val('_ul.img.page'), 2);
        assert.notDeepEqual(app.val('_ul.img.T'), [0.01, 0, 0, -0.01, 50, 60], '大きさが違うのに位置をそのままにした');
        assert.match(app.val(`document.getElementById('cad-toast').textContent`), /大きさが違うので/);
        assert.deepEqual(app.val('window.__got'), [5, 5, 5], 'PDF の写しを渡していない');
        // 端末に保存して読み直しても、ページを選び直せる
        await app.eval('ulRestore()');
        assert.deepEqual(app.val('[_ul.img.page, _ul.img.pages, _ul.img.pdf.byteLength]'), [2, 3, 5]);
        app.eval('showUnderlayPanel()');
        assert.match(app.val(`document.getElementById('property-panel-content').textContent`), /📄 ページを変える（2\/3）/);
        assert.doesNotMatch(app.val(`document.getElementById('property-panel-content').textContent`), /ワールドファイルで合わせる/);
    });
});
