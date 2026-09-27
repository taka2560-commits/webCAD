'use strict';
// 処理中・保存・オフラインの表示（v5.20）のテスト:
//   処理中の印（出す・段階・重なり・消す）、DXF・PDF を作るあいだの印、読めなかった DWG・SIMA で置き換えた図面を戻す、
//   一部だけ読めた写真のまとめ、💾 の未保存の印、オフラインの印、押せないボタンの見た目
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, fixture, ROOT } = require('./helpers/load-app.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('処理中・保存・オフラインの表示', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`while(busyActive()) busyEnd(); resetCommand(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            window.setCurrentProjectName(null);`);
    });
    const busy = () => app.val(`(b => b ? [b.classList.contains('show'), b.querySelector('.bz-text').textContent, document.body.getAttribute('aria-busy')] : null)(document.getElementById('cad-busy'))`);
    const toast = () => app.val(`(t => t ? [t.textContent, t.dataset.kind || ''] : null)(document.getElementById('cad-toast'))`);
    const addLine = (x) => app.eval(`saveUndo(); entities.push({ type: 'LINE', layer: 0, color: null, x1: ${x}, y1: 0, x2: ${x + 10}, y2: 0 }); ensureEntityIds();`);

    it('処理中の印: 出す・段階を変える・重なっても最後に消す。読み上げ用に aria-busy', async () => {
        app.eval(`busyStart('DWG を読み込み中…')`);
        assert.deepEqual(busy(), [true, 'DWG を読み込み中…', 'true']);
        await app.eval(`busyStep('  図形に変換中…')`);
        assert.deepEqual(busy(), [true, '図形に変換中…', 'true']);
        assert.match(app.eval('commandLog.textContent'), /図形に変換中/);
        app.eval(`busyStart('PDF を作っています…')`);
        assert.equal(busy()[1], 'PDF を作っています…');
        app.eval('busyEnd()');
        assert.deepEqual(busy().slice(0, 2), [true, '図形に変換中…'], 'まだ1つ残っていて、前の文に戻る');
        app.eval('busyEnd()');
        assert.deepEqual(busy(), [false, '図形に変換中…', null]);
        assert.equal(await app.eval(`withBusy('待っています…', async () => 7)`), 7);
        assert.equal(busy()[0], false);
        assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /@keyframes bzSpin \{ to \{ transform:rotate\(360deg\); \} \}/);
    });

    it('DXF を読み込むあいだは処理中の印を出し、終われば消す', async () => {
        app.window.__file = new app.window.File([fixture('test_drawing.dxf')], 'sample.dxf');
        app.eval('loadDxfFile(window.__file)');
        assert.deepEqual(busy().slice(0, 2), [true, 'DXF を読み込み中…']);
        for (let i = 0; i < 100 && app.eval('entities.length') === 0; i++) await wait(10);
        await wait(20);
        assert.equal(app.eval('entities.length'), 2);
        assert.equal(busy()[0], false);
        assert.deepEqual(app.errors(), []);
    });

    it('置き換えで開いた DWG・SIMA に図形・点が無かったときも、元の図面に戻す', async () => {
        addLine(0);
        app.eval('_prepareImportTarget()');
        assert.equal(app.eval('entities.length'), 0);
        app.eval(`window.__file = { name: 'x.dwg', arrayBuffer: async () => new TextEncoder().encode('not a dwg file at all').buffer }`);
        await app.eval('loadDwgFile(window.__file)');
        assert.equal(app.eval('entities.length'), 1, '形式の違う DWG');
        assert.deepEqual(toast(), ['DWGファイルの形式が不正です（中身がDWGではありません）', 'error']);
        assert.equal(busy()[0], false);
        app.eval('_prepareImportTarget()');
        app.window.__file = new app.window.File(['G00,01,test\r\n'], 'x.sim');
        await app.eval('loadSimaFile(window.__file)');
        assert.equal(app.eval('entities.length'), 1, '点の無い SIMA');
    });

    it('写真を何枚か追加して一部が追加できなかったときは、最後のお知らせにその枚数も出す', async () => {
        app.eval(`entities.push({ type: 'PIN', layer: 0, x: 0, y: 0, name: 'P1', text: '', photos: [] }); ensureEntityIds(); _ph.editing = entities[0].id;
            window.__shrink = photoShrink; photoShrink = async (f) => { if(f.name === 'bad.jpg') throw new Error('読めない画像'); return { mime: 'image/jpeg', data: new Uint8Array([255, 216, 255]).buffer, w: 1, h: 1 }; };`);
        try {
            const n = await app.eval(`photoAddFiles([new File(['a'], 'a.jpg'), new File(['b'], 'bad.jpg'), new File(['c'], 'c.jpg')])`);
            assert.equal(n, 2);
            assert.deepEqual(toast(), ['写真を 2枚 追加しました（1枚は追加できませんでした）', 'warn']);
            assert.match(app.eval('commandLog.textContent'), /写真を追加できませんでした（bad\.jpg）: 読めない画像/);
            assert.equal(busy()[0], false);
        } finally { app.eval('photoShrink = window.__shrink; _ph.editing = null;'); }
    });

    it('💾 の未保存の印: 変更すると付き、名前を付けて保存すると消える。まだ名前の無い図面は変更があれば付く', async () => {
        const mark = () => app.val(`(b => [b.classList.contains('unsaved'), b.title])(document.getElementById('btn-save'))`);
        assert.equal(mark()[0], false, '空の図面');
        addLine(0); await wait(5);
        assert.deepEqual(mark(), [true, '保存（まだ保存していない変更があります）']);
        await app.eval(`saveProject('現場D')`);
        assert.deepEqual(mark(), [false, '保存（「現場D」に保存済み）']);
        assert.deepEqual(toast(), ['「現場D」を保存しました', 'success']);
        addLine(20); await wait(5);
        assert.equal(mark()[0], true);
        app.eval('entities.length = 0; window.setCurrentProjectName(null);');
        assert.equal(mark()[0], false);
    });

    it('オフラインの印: 電波が切れると「📴 オフライン」を出して知らせ、戻ると消す', () => {
        const pill = () => app.val(`(p => p ? p.style.display : 'none')(document.getElementById('net-pill'))`);
        assert.equal(pill(), 'none');
        Object.defineProperty(app.window.navigator, 'onLine', { value: false, configurable: true });
        app.eval(`window.dispatchEvent(new Event('offline'))`);
        assert.equal(pill(), '');
        assert.equal(app.eval(`document.body.classList.contains('offline')`), true);
        assert.match(toast()[0], /オフラインになりました/);
        assert.equal(toast()[1], 'warn');
        Object.defineProperty(app.window.navigator, 'onLine', { value: true, configurable: true });
        app.eval(`window.dispatchEvent(new Event('online'))`);
        assert.equal(pill(), 'none');
        assert.equal(app.eval(`document.body.classList.contains('offline')`), false);
        assert.deepEqual(toast(), ['インターネットにつながりました', 'success']);
    });

    it('押せないボタンは薄く見える（押せるボタンと見分けられる）', () => {
        const css = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assert.match(css, /\.prop-btn:disabled, \.sel-btn:disabled, \.top-btn:disabled, \.menu-item-btn:disabled, \.status-btn:disabled \{ opacity:0\.42;/);
        app.eval(`document.body.insertAdjacentHTML('beforeend', '<button id="__dis" class="prop-btn" disabled>x</button>')`);
        assert.equal(app.eval(`getComputedStyle(document.getElementById('__dis')).opacity`), '0.42');
        app.eval(`document.getElementById('__dis').remove()`);
    });
});
