'use strict';
// 縮尺印刷・PDF（cad-print.js）のテスト:
//   数値・文字（UTF-16BE）・幅・色の変換、用紙の大きさ、縮尺どおりの寸法（1/500 で 10m → 20mm）、画面の回転、
//   見えない画層・範囲外の図形を描かない、PDF の構造（xref の位置・拡大縮小しない指定）、Flate 圧縮、保存、パネル
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { Blob, Buffer } = require('node:buffer');
const { CompressionStream } = require('node:stream/web');
const { loadApp, near } = require('./helpers/load-app.cjs');

const MM = 72 / 25.4;

describe('縮尺印刷・PDF', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); entities.length = 0; undoStack.length = 0; localStorage.removeItem('cad_survey_unit'); localStorage.removeItem('cad_print_opts');
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }, { name: '隠す', color: '#ffffff', visible: false }); currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 4, rotation: 0 };`);
    });
    // 描画命令から「x y m x y l S」の線を取り出す
    const lines = (content) => [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/g)].map((m) => m.slice(1, 5).map(Number));

    it('数値・文字・幅・色の変換', () => {
        assert.equal(app.eval('pdfNum(12.5)'), '12.5');
        assert.equal(app.eval('pdfNum(3.0001)'), '3');
        assert.equal(app.eval('pdfNum(-0.0001)'), '0');
        assert.equal(app.eval('pdfNum(-1.23456)'), '-1.235');
        assert.equal(app.eval(`pdfHexText('A境')`), '00415883');
        assert.equal(app.eval(`pdfHexText('😀')`), '003F'); // BMP の外は ?
        assert.ok(near(app.eval(`pdfTextWidth('AB境界', 10)`), 30));
        assert.deepEqual(app.val(`printColor('#ff0000', 'mono')`), [0, 0, 0]);
        assert.deepEqual(app.val(`printColor('#ffffff', 'color')`), [0, 0, 0]);
        assert.deepEqual(app.val(`printColor('#ff0000', 'color')`), [1, 0, 0]);
        const y = app.val(`printColor('#ffff00', 'color')`);
        assert.ok(y[2] === 0 && y[0] < 0.6 && near(y[0], y[1]), JSON.stringify(y)); // 黄色は濃くする
    });
    it('用紙の大きさ（横・縦）と図枠の内側', () => {
        assert.deepEqual(app.val(`printPaperMm({ paper: 'A3', orient: 'land' })`), { W: 420, H: 297, inner: { x: 10, y: 10, w: 400, h: 277 } });
        assert.deepEqual(app.val(`printPaperMm({ paper: 'A4', orient: 'port' }).inner`), { x: 10, y: 10, w: 190, h: 277 });
    });
    it('縮尺どおり: 1/500 で 10m の線は 20mm。用紙の中央が印刷の中心。画面の回転も同じ', () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }); entities[0].bbox = calcBBox(entities[0]);`);
        let pg = app.val(`printCompose({ paper: 'A3', orient: 'land', scale: 500, color: 'mono' }, { x: 5, y: 0 }, 0, { title: 'T' })`);
        assert.ok(near(pg.W, 420 * MM, 1e-6) && near(pg.H, 297 * MM, 1e-6));
        const L = lines(pg.content)[0];
        assert.ok(near(L[2] - L[0], 20 * MM, 0.002), JSON.stringify(L));
        assert.ok(near((L[0] + L[2]) / 2, 210 * MM, 0.002) && near(L[1], 148.5 * MM, 0.002), JSON.stringify(L)); // 用紙の中央
        // 図面の単位が mm なら 10000 単位 = 10m
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); entities[0].x2 = 10000; entities[0].bbox = calcBBox(entities[0]);`);
        pg = app.val(`printCompose({ paper: 'A3', orient: 'land', scale: 500, color: 'mono' }, { x: 5000, y: 0 }, 0, { title: 'T' })`);
        const Lm = lines(pg.content)[0];
        assert.ok(near(Lm[2] - Lm[0], 20 * MM, 0.002));
        app.eval(`localStorage.removeItem('cad_survey_unit'); entities[0].x2 = 10; entities[0].bbox = calcBBox(entities[0]);`);
        // 画面を 90° 回すと、東向きの線は用紙の上向きになる
        pg = app.val(`printCompose({ paper: 'A3', orient: 'land', scale: 500, color: 'mono' }, { x: 5, y: 0 }, Math.PI / 2, { title: 'T' })`);
        const R = lines(pg.content)[0];
        assert.ok(near(R[0], R[2], 0.002) && near(R[3] - R[1], 20 * MM, 0.002), JSON.stringify(R));
    });
    it('見えない画層・範囲の外の図形は描かない。文字は UTF-16 の16進で、表題欄も入る', () => {
        app.eval(`
            entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 });
            entities.push({ type: 'LINE', layer: 1, color: null, x1: 0, y1: 5, x2: 10, y2: 5 });          // 見えない画層
            entities.push({ type: 'LINE', layer: 0, color: null, x1: 5000, y1: 0, x2: 5010, y2: 0 });     // 用紙の外
            entities.push({ type: 'TEXT', layer: 0, color: null, x: 0, y: 2, text: '境界', height: 1, halign: 'center', valign: 'middle' });
            entities.push({ type: 'DIMENSION', subType: 'LINEAR', dimDir: 'H', layer: 0, color: null, p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: -3 });
            entities.push({ type: 'CIRCLE', layer: 0, color: '#ff0000', cx: 5, cy: 5, radius: 2 });
            entities.push({ type: 'ARC', layer: 0, color: null, cx: 5, cy: 5, radius: 3, startAngle: 0, endAngle: Math.PI / 2, counterclockwise: true });
            entities.push({ type: 'ELLIPSE', layer: 0, color: null, cx: 5, cy: 5, rx: 3, ry: 1, rotation: 0 });
            entities.push({ type: 'HATCH', layer: 0, color: null, target: { type: 'RECTANG', x1: 0, y1: 0, x2: 2, y2: 2 } });
            entities.push({ type: 'POINT', layer: 0, color: null, x: 1, y: 1 });
            entities.forEach(e => { if(e.type !== 'DIMENSION' && e.type !== 'HATCH') e.bbox = calcBBox(e); });`);
        const pg = app.val(`printCompose({ paper: 'A4', orient: 'land', scale: 200, color: 'color' }, { x: 5, y: 2 }, 0, { title: '現況平面図', author: '太郎', date: '2026年9月25日' })`);
        assert.equal(pg.count, 8); // 10個のうち、見えない画層と範囲外を除く
        assert.match(pg.content, /<5883754C> Tj/);            // 境界
        assert.match(pg.content, /<73FE6CC15E73976256F3> Tj/); // 現況平面図（表題欄）
        assert.match(pg.content, /1 0 0 RG/);                  // 赤い円（カラー）
        assert.match(pg.content, /\/GS1 gs/);                 // 塗りつぶしは半透明
        assert.match(pg.content, / c\n/);                     // 円・円弧はベジェ
        assert.match(pg.content, /re W n/);                   // 図枠で切り抜く
    });
    it('PDF の構造: 見出し・xref の位置・拡大縮小しない指定・日本語フォント', async () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }); entities[0].bbox = calcBBox(entities[0]);
            window.__pg = printCompose({ paper: 'A4', orient: 'land', scale: 500, color: 'mono' }, { x: 5, y: 0 }, 0, { title: 'T' });`);
        const bytes = Buffer.from(await app.eval(`pdfBuild(window.__pg, { title: '現況' }, false)`));
        const s = bytes.toString('latin1');
        assert.ok(s.startsWith('%PDF-1.4\n'));
        assert.ok(s.trimEnd().endsWith('%%EOF'));
        assert.match(s, /\/PrintScaling \/None/);
        assert.match(s, /\/Encoding \/UniJIS-UCS2-HW-H/);
        assert.match(s, /\/Title <FEFF73FE6CC1>/);
        // xref の各位置が、その番号の obj の始まりを指している
        const xrefAt = +/startxref\n(\d+)/.exec(s)[1];
        assert.ok(s.slice(xrefAt).startsWith('xref'));
        const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => +m[1]);
        assert.equal(entries.length, 10);
        entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `obj ${i + 1} at ${off}`));
        // ストリームの長さが合っている
        const m = /4 0 obj\n<< \/Length (\d+) >>\nstream\n/.exec(s);
        const start = m.index + m[0].length;
        assert.equal(s.slice(start + +m[1], start + +m[1] + 10), '\nendstream');
    });
    it('Flate で縮めた PDF も、ほどくと同じ描画命令', async () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }); entities[0].bbox = calcBBox(entities[0]);
            window.__pg = printCompose({ paper: 'A4', orient: 'land', scale: 500, color: 'mono' }, { x: 5, y: 0 }, 0, { title: 'T' });`);
        const jb = app.window.Blob;
        app.window.CompressionStream = CompressionStream; app.window.Response = globalThis.Response; app.window.Blob = Blob;
        let bytes;
        try { bytes = Buffer.from(await app.eval(`pdfBuild(window.__pg, { title: 'T' }, true)`)); }
        finally { app.window.Blob = jb; delete app.window.CompressionStream; delete app.window.Response; }
        const s = bytes.toString('latin1');
        const m = /4 0 obj\n<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/.exec(s);
        assert.ok(m, 'FlateDecode のストリームが無い');
        const start = m.index + m[0].length;
        const inflated = zlib.inflateSync(bytes.subarray(start, start + +m[1])).toString('utf8');
        assert.equal(inflated, app.eval('window.__pg.content'));
    });
    it('PDF を保存（ファイル名に縮尺と用紙）。パネル・枠の重ね表示・画面に合わせた縮尺・コマンド', async () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 100, y2: 60 }); entities[0].bbox = calcBBox(entities[0]); zoomExtents();`);
        app.eval(`processCommand('PRINT')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🖨 印刷・PDF');
        app.eval(`printSetPaper('A4'); printSetOrient('port'); printSetColor('color'); printSet('scale', '250')`);
        assert.deepEqual(app.val(`[printOpts().paper, printOpts().orient, printOpts().color, printOpts().scale]`), ['A4', 'port', 'color', 250]);
        app.eval('_drawFrame(false)'); // 枠の重ね表示
        app.eval('printFitScale()');
        const s = app.eval('printOpts().scale');
        // 画面に見えている範囲（図面の単位 m）が、図枠（190×277mm）に入る
        const vw = app.eval('canvas.width / view.scale'), vh = app.eval('canvas.height / view.scale');
        assert.ok(vw * 1000 / s <= 190 + 1e-6 && vh * 1000 / s <= 277 + 1e-6, `1/${s}`);
        app.eval(`window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; };`);
        await app.eval('printMakePdf(false)');
        app.eval('downloadBlob = window.__dl');
        assert.match(app.eval('window.__name'), new RegExp(`_1-${s}_A4\\.pdf$`));
        assert.equal(app.eval('window.__blob.type'), 'application/pdf');
        assert.deepEqual(app.errors(), []);
    });
});
