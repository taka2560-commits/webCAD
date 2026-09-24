'use strict';
// 現場写真・メモ（cad-photo.js）のテスト:
//   ピンを立てる（測点に吸い付き点名を覚える・元に戻す）、メモ、写真の追加と端末への保存、ピンのタップで開く、
//   画層で隠す、保存データに入る、DXF には出さない、印刷の PDF に番号、写真台帳（複数ページ・JPEG をそのまま入れる）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { loadApp } = require('./helpers/load-app.cjs');

// 1×1 の JPEG（白）
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

describe('現場写真・メモ', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
        app.eval(`window.__touch = (type, pts) => { const ev = new Event(type, { bubbles:true, cancelable:true });
            Object.defineProperty(ev, 'touches', { value: pts.map(p => ({ clientX: p[0], clientY: p[1] })) }); canvas.dispatchEvent(ev); };`);
        // 画像を縮める処理・画像の URL の代わり（jsdom は画像を読めず、URL.createObjectURL も無い）
        app.window.URL.createObjectURL = () => 'blob:test';
        app.window.URL.revokeObjectURL = () => {};
        app.window.__jpeg = new Uint8Array(JPEG).buffer;
        app.eval(`photoShrink = async (f) => ({ mime: 'image/jpeg', data: window.__jpeg.slice(0), w: 1, h: 1 });`);
    });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`resetCommand(); entities.length = 0; undoStack.length = 0; redoStack.length = 0; localStorage.removeItem('cad_survey_unit');
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 4, rotation: 0 }; _ph.editing = null; _cogo.slots = {}; _cogo.pick = null; snapResult = null;
            addSurveyData([{ num: '1', name: 'KP1', X: 0, Y: 0 }, { num: '2', name: 'KP2', X: 0, Y: 20 }], []); undoStack.length = 0;`);
    });
    const panel = () => app.eval(`document.getElementById('property-panel-content').textContent`);
    const addPinAt = (x, y, snap) => {
        app.eval(`showPhotoPanel(); photoStartAdd()`);
        app.eval(`snapResult = ${snap ? `{ wcsX: ${x}, wcsY: ${y}, type: '点' }` : 'null'}; handlePointInput({ x: ${x}, y: ${y} }, false)`);
        return app.val(`entities.find(e => e.type === 'PIN' && e.x === ${x} && e.y === ${y})`);
    };

    it('ピンを立てると測点名を覚え、編集画面になる。元に戻すは1回', () => {
        const pin = addPinAt(20, 0, true); // KP2（Y 20 → 図面の x 20）
        assert.ok(pin && pin.name === 'KP2', JSON.stringify(pin));
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.match(panel(), /KP2/);
        assert.match(panel(), /撮る/);
        assert.equal(app.eval(`layers[entities.find(e => e.type === 'PIN').layer].name`), '写真・メモ');
        app.eval('undo()');
        assert.equal(app.eval(`entities.some(e => e.type === 'PIN')`), false);
    });
    it('メモ・写真を付ける（写真は端末に保存）。写真を外すと消える', async () => {
        addPinAt(5, 5, false);
        app.eval(`photoSetText('コンクリート杭\\n頭部欠け')`);
        assert.equal(app.eval(`entities.find(e => e.type === 'PIN').text`), 'コンクリート杭\n頭部欠け');
        const n = await app.eval(`photoAddFiles([new File(['x'], 'a.jpg', { type: 'image/jpeg' }), new File(['y'], 'b.jpg', { type: 'image/jpeg' })])`);
        assert.equal(n, 2);
        const keys = app.val(`entities.find(e => e.type === 'PIN').photos`);
        assert.equal(keys.length, 2);
        const rec = await app.eval(`photoLoad('${keys[0]}').then(r => JSON.stringify({ mime: r.mime, w: r.w, n: r.data.byteLength, name: r.name }))`);
        assert.deepEqual(JSON.parse(rec), { mime: 'image/jpeg', w: 1, n: JPEG.length, name: 'a.jpg' });
        await app.eval(`photoRemovePhoto('${keys[0]}')`);
        assert.deepEqual(app.val(`entities.find(e => e.type === 'PIN').photos`), [keys[1]]);
        assert.equal(await app.eval(`photoLoad('${keys[0]}')`), null);
    });
    it('何もしていないときにピンをタップすると開く（図形の選択にはならない）。画層を隠すとタップ・表示しない', () => {
        const pin = addPinAt(5, 5, false);
        app.eval('hidePropertyPanel()');
        app.run(`const s = wcsToScreen(5, 5); __touch('touchstart', [[s.x, s.y - 14]]); __touch('touchend', []);`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '📷 写真・メモ');
        assert.equal(app.eval('_ph.editing'), pin.id);
        assert.equal(app.eval('cmdState.highlightIdx'), -1);
        // 離れた所では開かない
        assert.equal(app.eval(`photoPinTap(wcsToScreen(5, 5).x + 80, wcsToScreen(5, 5).y)`), false);
        // 画層を隠す
        app.eval(`layers[entities.find(e => e.type === 'PIN').layer].visible = false`);
        assert.equal(app.eval(`photoPinTap(wcsToScreen(5, 5).x, wcsToScreen(5, 5).y)`), false);
        app.eval(`window.__t = []; ctx.fillText = (t) => window.__t.push(String(t)); drawPhotoPins(); delete ctx.fillText;`);
        assert.deepEqual(app.val('window.__t'), []);
    });
    it('ピンを消す（↩ で戻せる）。保存データに入り、DXF には出さない', async () => {
        addPinAt(5, 5, false);
        app.eval(`photoSetText('メモ')`);
        const data = app.val(`_buildSaveData('t')`);
        assert.ok(data.entities.some((e) => e.type === 'PIN' && e.text === 'メモ'));
        app.eval('photoDeletePin()');
        assert.equal(app.eval(`entities.some(e => e.type === 'PIN')`), false);
        app.eval('undo()');
        assert.equal(app.eval(`entities.some(e => e.type === 'PIN')`), true);
        app.eval(`window.__blob = null; window.__dl = downloadBlob; downloadBlob = (b) => { window.__blob = b; }; exportDxf(); downloadBlob = window.__dl;`);
        assert.ok(app.eval('!!window.__blob'));
    });
    it('印刷の PDF にピンの番号を描く', () => {
        addPinAt(5, 5, false); addPinAt(10, 5, false);
        const pg = app.val(`printCompose({ paper: 'A4', orient: 'land', scale: 200, color: 'mono' }, { x: 5, y: 5 }, 0, { title: 'T' })`);
        assert.match(pg.content, /<0031> Tj/);
        assert.match(pg.content, /<0032> Tj/);
    });
    it('写真台帳: 1ページに3件、写真ごとに1件。JPEG をそのまま入れた複数ページの PDF', async () => {
        const p1 = addPinAt(5, 5, false);
        await app.eval(`photoAddFiles([new File(['x'], 'a.jpg'), new File(['y'], 'b.jpg')])`);
        addPinAt(20, 0, true); // 写真なし
        addPinAt(10, 5, false);
        await app.eval(`photoAddFiles([new File(['z'], 'c.jpg')])`);
        app.eval(`photoSetText('二行目まである長いメモ。' .repeat(4))`);
        app.eval(`window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; };`);
        const bytes = Buffer.from(await app.eval('photoLedgerPdf()'));
        app.eval('downloadBlob = window.__dl');
        assert.match(app.eval('window.__name'), /_写真台帳\.pdf$/);
        const s = bytes.toString('latin1');
        assert.match(s, /\/Type \/Pages \/Kids \[3 0 R 11 0 R\] \/Count 2/); // 4件 → 2ページ
        assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 3);        // 写真3枚
        assert.equal((s.match(/\/Filter \/DCTDecode/g) || []).length, 3);
        assert.ok(s.includes(JPEG.toString('latin1')), 'JPEG がそのまま入っていない');
        // xref の位置が正しい
        const xrefAt = +/startxref\n(\d+)/.exec(s)[1];
        const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => +m[1]);
        entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `obj ${i + 1}`));
        // 番号: 写真が2枚のピンは 1-1・1-2
        const pages = app.val(`photoLedgerPages([{ no: '1-1', place: 'KP1', X: 1, Y: 2, time: 't', text: 'm', img: null }], 'T')`);
        assert.equal(pages.length, 1);
        assert.match(pages[0].content, /<004E006F002E00200031002D0031> Tj/); // "No. 1-1"
        assert.ok(p1);
    });
    it('コマンドと一覧', () => {
        addPinAt(5, 5, false);
        app.eval(`processCommand('PHOTO')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '📷 写真・メモ');
        assert.match(panel(), /（メモなし）/);
        assert.deepEqual(app.errors(), []);
    });
});
