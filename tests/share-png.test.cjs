'use strict';
// 共有メニューで送る・画面の画像（v5.31）: スマホ・タブレットでは書き出したあとに「📤 送る」（共有メニュー）を出し、PC では出さない。
// 画面の画像（PNG）は、選択・カーソル・スナップ・軸などの印を入れず、背景の下絵・図形・写真のピンを画面の2倍の細かさで描く
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('共有メニューで送る・画面の画像（PNG）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => app.eval(`hideSnack(); window.__shared = []; window.__shareErr = null;
        navigator.canShare = () => true;
        navigator.share = async (d) => { if (window.__shareErr) throw window.__shareErr; window.__shared.push(d.files.map(f => f.name)); };
        window.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' && window.__coarse, addEventListener() {}, removeEventListener() {} });
        window.__coarse = true;`));

    const snack = () => app.val(`(() => { const s = document.getElementById('cad-snack'); return s ? { show: s.classList.contains('show'), msg: s.querySelector('.sn-msg').textContent, act: s.querySelector('.sn-act').textContent } : null; })()`);

    it('スマホ・タブレットでは、書き出したあとに「📤 送る」を出し、押すと共有メニューでそのファイルを送る', async () => {
        // 書き出しはすべて downloadBlob を通る（保存のあとに出す）
        app.eval(`window.__oc = window.HTMLAnchorElement.prototype.click; window.HTMLAnchorElement.prototype.click = function () {};
            window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};`);
        try { app.eval(`downloadBlob(new Blob(['1,KP1,10,20'], { type: 'text/csv' }), '現場.csv')`); } finally { app.eval('window.HTMLAnchorElement.prototype.click = window.__oc;'); }
        assert.deepEqual(snack(), { show: true, msg: '現場.csv を保存しました', act: '📤 送る' });
        app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(app.val('window.__shared'), [['現場.csv']]);
        assert.equal(snack().show, false, '押したら閉じる');
    });

    it('PC（マウスで操作する端末）・送れない種類のファイルでは出さない', () => {
        app.eval('window.__coarse = false;');
        assert.equal(app.val(`offerShare(new Blob(['x']), 'a.dxf')`), false);
        assert.equal(snack() === null || snack().show === false, true);
        app.eval('window.__coarse = true; navigator.canShare = () => false;');
        assert.equal(app.val(`offerShare(new Blob(['x'], { type: 'application/pdf' }), 'a.pdf')`), false);
        // iPad（Mac と同じ名乗り）は指で操作する端末として扱う
        app.eval(`window.__coarse = false; navigator.canShare = () => true; window.__iat = window.isAppleTouchDevice; window.isAppleTouchDevice = () => true;`);
        try { assert.equal(app.val(`offerShare(new Blob(['x']), 'a.pdf')`), true); } finally { app.eval('window.isAppleTouchDevice = window.__iat;'); }
    });

    it('Android（Chromium）では、共有メニューが断る種類（DXF・SIMA・SDR）は「📤 送り方」を出し、押すと LINE の側から選ぶ手順（v5.39.2）', () => {
        app.eval(`window.__oc = window.HTMLAnchorElement.prototype.click; window.HTMLAnchorElement.prototype.click = function () {};
            window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};
            window.__cf = window.confirm; window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return true; };`);
        try {
            app.eval(`downloadBlob(new Blob(['0'], { type: 'application/dxf' }), '現場.dxf')`);
            assert.deepEqual(snack(), { show: true, msg: '現場.dxf を保存しました', act: '📤 送り方' });
            app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
            const asked = app.val('window.__asked');
            assert.equal(asked.length, 1);
            assert.match(asked[0], /LINE などで送るには/);
            assert.match(asked[0], /「\.dxf」のファイルを共有メニューで渡せません/);
            assert.match(asked[0], /＋ →「ファイル」/);
            assert.match(asked[0], /「ダウンロード」（Download）フォルダの「現場\.dxf」/);
            assert.deepEqual(app.val('window.__shared'), [], '共有メニューは呼ばない（呼ぶと Permission denied）');
            // 種類ごとの見分け（拡張子と MIME の両方が合うものだけ「📤 送る」）
            const kind = (name, type) => app.val(`shareTypeOk(new File(['x'], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }))`);
            assert.equal(kind('現場.sim', 'text/plain'), false);
            assert.equal(kind('機械.sdr', 'text/plain'), false);
            assert.equal(kind('図面.webcad', 'application/octet-stream'), false);
            assert.equal(kind('図面_図面一式.pdf', 'application/pdf'), true);
            assert.equal(kind('座標.csv', 'text/csv'), true);
            assert.equal(kind('画面.png', 'image/png'), true);
            assert.equal(kind('x.txt', 'application/dxf'), false, 'MIME も合わないと断られる');
            // iPhone・iPad は種類で断らないので、DXF も「📤 送る」
            app.eval('window.__iat = window.isAppleTouchDevice; window.isAppleTouchDevice = () => true;');
            try {
                app.eval(`downloadBlob(new Blob(['0'], { type: 'application/dxf' }), '現場.dxf')`);
                assert.equal(snack().act, '📤 送る');
            } finally { app.eval('window.isAppleTouchDevice = window.__iat;'); }
        } finally { app.eval('window.HTMLAnchorElement.prototype.click = window.__oc; window.confirm = window.__cf;'); }
    });

    it('送ろうとして断られた（NotAllowedError）ときは、エラーの代わりに LINE の側から選ぶ手順を出す（v5.39.2）', async () => {
        app.eval(`window.__shareErr = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
            document.getElementById('cad-toast') && document.getElementById('cad-toast').classList.remove('show');
            window.__cf = window.confirm; window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return true; };`);
        try {
            await app.eval(`shareFile(new File(['x'], '現場.pdf', { type: 'application/pdf' }))`);
            const asked = app.val('window.__asked');
            assert.equal(asked.length, 1);
            assert.match(asked[0], /共有メニューで渡せませんでした/);
            assert.match(asked[0], /「現場\.pdf」を選ぶ/);
            assert.equal(app.val(`!!(document.getElementById('cad-toast') && document.getElementById('cad-toast').classList.contains('show'))`), false, 'Permission denied のエラーは出さない');
        } finally { app.eval('window.confirm = window.__cf;'); }
    });

    it('共有メニューを閉じたときは何も言わず、送れなかったときは知らせる', async () => {
        app.eval(`window.__shareErr = Object.assign(new Error('cancel'), { name: 'AbortError' }); document.getElementById('cad-toast') && document.getElementById('cad-toast').classList.remove('show');`);
        await app.eval(`shareFile(new File(['x'], 'a.csv'))`);
        assert.equal(app.val(`!!(document.getElementById('cad-toast') && document.getElementById('cad-toast').classList.contains('show'))`), false);
        app.eval(`window.__shareErr = new Error('だめ');`);
        await app.eval(`shareFile(new File(['x'], 'a.csv'))`);
        assert.match(app.val(`document.getElementById('cad-toast').textContent`), /送れませんでした: だめ/);
    });

    it('画面の画像: 2倍の細かさで、選択・カーソル・スナップ・グリップを描かず、下絵・写真のピンは描く。終わったら元の画面に戻す', async () => {
        app.eval(`entities.length = 0; entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }); ensureEntityIds();
            cmdState.highlightIdx = 0; cmdState.selectedIndices = [0];
            _ul.img = { src: {}, w: 10, h: 10, T: [1, 0, 0, 1, 0, 0], opacity: 0.5, on: true };
            window.__calls = []; window.__tr = [];
            window.__saved = { cross: window.drawCrosshair, snap: window.drawSnapMarker, grip: window.drawGripOverlay, pins: window.drawPhotoPins };
            window.drawCrosshair = () => window.__calls.push('cross'); window.drawSnapMarker = () => window.__calls.push('snap');
            window.drawGripOverlay = () => window.__calls.push('grip'); window.drawPhotoPins = () => window.__calls.push('pins');
            ctx.setTransform = (...a) => window.__tr.push(a);
            window.__w0 = [canvas.width, canvas.height];
            canvas.toBlob = (cb, type) => { window.__snap = { w: canvas.width, h: canvas.height, type, sel: cmdState.selectedIndices.length, hi: cmdState.highlightIdx, calls: window.__calls.slice() }; cb(new Blob(['png'], { type: 'image/png' })); };
            window.__dl = null; window.__odl = window.downloadBlob; window.downloadBlob = (b, n) => { window.__dl = n; };`);
        const s0 = app.val('wcsToScreen(0, 0)');
        try { await app.eval('exportScreenPng()'); } finally {
            app.eval(`Object.assign(window, { drawCrosshair: window.__saved.cross, drawSnapMarker: window.__saved.snap, drawGripOverlay: window.__saved.grip, drawPhotoPins: window.__saved.pins });
                delete ctx.setTransform; delete canvas.toBlob; window.downloadBlob = window.__odl; _ul.img = null;`);
        }
        const [w0, h0] = app.val('window.__w0');
        const snap = app.val('window.__snap');
        assert.deepEqual({ w: snap.w, h: snap.h, type: snap.type }, { w: w0 * 2, h: h0 * 2, type: 'image/png' });
        assert.deepEqual([snap.sel, snap.hi], [0, -1], '選んだ図形の色を付けて描いた');
        assert.deepEqual(snap.calls, ['pins'], 'カーソル・スナップ・グリップを描いた');
        const tr = app.val('window.__tr');
        assert.deepEqual(tr[0], [2, 0, 0, 2, 0, 0], '2倍で描いていない');
        // 下絵の画像も2倍の位置に描く（画像の左上 = 図面の (0, 0)）
        assert.ok(tr.some((a) => Math.abs(a[4] - 2 * s0.x) < 1e-9 && Math.abs(a[5] - 2 * s0.y) < 1e-9 && Math.abs(a[0] - 2 * (app.val('view.scale') / 1)) < 1e-6), JSON.stringify(tr.slice(0, 4)));
        assert.deepEqual(app.val('[canvas.width, canvas.height]'), [w0, h0], '画面の大きさを戻していない');
        assert.deepEqual(app.val('[cmdState.highlightIdx, cmdState.selectedIndices]'), [0, [0]], '選択を戻していない');
        assert.equal(app.val('window.__dl'), 'webcad_画面.png');
    });

    it('☰ メニュー・コマンド（PNGOUT・PNG）・お気に入りから画面の画像を作れる', () => {
        assert.equal(app.val(`!!document.querySelector('#top-menu-modal [data-fav="PNGOUT"]')`), true);
        assert.equal(app.val(`FAV_CATALOG.some(f => f.id === 'PNGOUT')`), true);
        app.eval(`window.__n = 0; window.__op = window.exportScreenPng; window.exportScreenPng = () => { window.__n++; };`);
        try {
            assert.equal(app.val(`processIOCommand('PNGOUT')`), true);
            assert.equal(app.val(`processIOCommand('PNG')`), true);
            app.eval(`FAV_CATALOG.find(f => f.id === 'PNGOUT').run()`);
            assert.equal(app.val('window.__n'), 3);
        } finally { app.eval('window.exportScreenPng = window.__op;'); }
    });
});
