'use strict';
// 図面一式のファイル（.webcad。v5.30）: 書き出して開き直すと、図形・画層・測点・UCS・線種・図面の単位・写真・下絵・系番号が元どおり。
// gzip で縮める（縮められないブラウザでは JSON のまま。どちらも開ける）。人から受け取ったファイルでも安全なように、開くときに項目の型を確かめる
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { loadApp } = require('./helpers/load-app.cjs');

const PTS = [{ num: '1', name: 'KP1', X: 10, Y: 0, z: 3.456 }, { num: '2', name: '境界2', X: 20, Y: 0, z: null }, { num: '3', name: 'T-3', X: 20, Y: 10, z: 1.25 }];
const LOTS = [{ num: '1', name: '区画1', refs: [{ num: '1' }, { num: '2' }, { num: '3' }] }];

async function exportBytes(app) {
    app.eval(`window.__name = null; window.downloadBlob = (b, name) => { window.__name = name; }; window.__OB = window.Blob;
        window.Blob = function (parts, opt) { window.__parts = parts; return new window.__OB(parts, opt); };`);
    try { await app.eval('exportWebcadFile()'); } finally { app.eval('window.Blob = window.__OB;'); }
    return Buffer.from(app.window.__parts[0]);
}
// 開く（確かめの画面は「開く」を押したことにする）
async function openBytes(app, bytes, name) {
    app.window.__file = { name: name || 'test.webcad', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    app.eval('window.__cc = window.cadConfirm; window.cadConfirm = async () => true;');
    try { return await app.eval('loadWebcadFile(window.__file)'); } finally { app.eval('window.cadConfirm = window.__cc;'); }
}
const snapshot = (app) => app.val(`({
    entities: entities.map(e => { const c = Object.assign({}, e); delete c.bbox; delete c._hits; return c; }),
    layers: JSON.parse(JSON.stringify(layers)), ucs: { originX: ucs.originX, originY: ucs.originY, angle: ucs.angle },
    saved: JSON.parse(JSON.stringify(savedUCSList)), lt: JSON.parse(JSON.stringify(drawingLineTypes)), lts: drawingLtscale,
    unit: getSurveyUnit(), zone: getGnssZone() })`);
const bytesOf = async (app, expr) => JSON.parse(await app.eval(`(async () => { const r = await ${expr}; return JSON.stringify(r && r.data ? Array.from(new Uint8Array(r.data)) : null); })()`));

describe('図面一式のファイル（.webcad）', () => {
    let app;
    before(async () => {
        app = await loadApp();
        app.window.CompressionStream = CompressionStream;
        app.window.DecompressionStream = DecompressionStream;
        app.window.URL.createObjectURL = () => 'blob:test';
        app.window.URL.revokeObjectURL = () => {};
        // 読み込むとすぐ onload が来る Image の代わり（jsdom は画像を読み込まない）
        app.eval(`window.Image = class { constructor() { this.width = 100; this.height = 50; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };`);
    });
    after(() => app.close());

    it('書き出して開き直すと、図形・画層・測点・UCS・線種・単位・写真・下絵・系番号が元どおり（gzip）', async () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); localStorage.setItem('cad_gnss_zone', '6'); entities.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }, { name: '境界', color: '#ff0000', visible: false, lt: 'DASHED', lw: 50 });
            addSurveyData(${JSON.stringify(PTS)}, ${JSON.stringify(LOTS)});
            entities.push({ type: 'TEXT', layer: 1, color: '#00ff00', x: 1, y: 2, text: '1行目' + String.fromCharCode(10) + '2行目', height: 0.5, rotation: 0.3, halign: 'center', valign: 'middle' });
            entities.push({ type: 'DIMENSION', subType: 'LINEAR', dimDir: 'H', layer: 0, color: null, p1: { x: 0, y: 0 }, p2: { x: 30, y: 20 }, offset: -3, textOverride: '約30' });
            entities.push({ type: 'HATCH', layer: 0, color: null, hidden: true, hiddenBy: 'fill', target: { type: 'PLINE', closed: true, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], holes: [[{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]] },
                pat: { name: 'ANSI31', lines: [{ a: 0.785, bx: 0, by: 0, ox: -0.1, oy: 0.1, d: [1, -0.5] }] } });
            entities.push({ type: 'LINE', layer: 1, color: null, x1: 0, y1: 0, x2: 9, y2: 9, lt: 'CENTER', lw: 35, ltScale: 2 });
            entities.push({ type: 'PIN', layer: 0, x: 5, y: 6, text: 'メモ', photos: ['phA', 'phB'], time: '2026-10-08T01:02:03.000Z', name: 'KP1' });
            ucs.originX = 100; ucs.originY = 200; ucs.angle = 0.3; savedUCSList = [{ name: '現場', originX: 1, originY: 2, angle: 0.1 }];
            drawingLineTypes = { MYLT: { d: [5, -2.5], desc: '自分の線種' } }; drawingLtscale = 250; ensureEntityIds();
            _ul.img = { src: {}, w: 100, h: 50, ow: 400, oh: 200, T: [1, 0, 0, 1, 5, 6], opacity: 0.4, on: true, mime: 'image/png', data: new Uint8Array([9, 8, 7]).buffer, name: 'scan.png' };`);
        await app.eval(`(async () => {
            await photoSave('phA', { mime: 'image/jpeg', data: new Uint8Array([1, 2, 3, 255]).buffer, w: 10, h: 20, name: 'a.jpg', time: '2026-10-08T00:00:00Z' });
            await photoSave('phB', { mime: 'image/jpeg', data: new Uint8Array([4, 5]).buffer, w: 30, h: 40, name: 'b.jpg', time: '2026-10-08T00:00:01Z' }); })()`);
        const before0 = snapshot(app);
        const bytes = await exportBytes(app);
        assert.deepEqual([bytes[0], bytes[1]], [0x1F, 0x8B], 'gzip で縮めていない');
        assert.match(app.val('window.__name'), /\.webcad$/);
        // 端末の中身を空にしてから開く
        await app.eval(`(async () => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); ucs.originX = 0; ucs.originY = 0; ucs.angle = 0;
            savedUCSList = []; drawingLineTypes = {}; drawingLtscale = null; localStorage.setItem('cad_survey_unit', 'm'); localStorage.setItem('cad_gnss_zone', '2');
            _ul.img = null; await _dbPut(STORE_AUTOSAVE, UL_DB_KEY, null); await photoDelete('phA'); await photoDelete('phB'); })()`);
        assert.equal(await bytesOf(app, `photoLoad('phA')`), null);
        assert.equal(await openBytes(app, bytes, '現場の図面.webcad'), true);
        const after0 = snapshot(app);
        assert.deepEqual(after0, before0);
        assert.deepEqual(await bytesOf(app, `photoLoad('phA')`), [1, 2, 3, 255]);
        assert.deepEqual(await bytesOf(app, `photoLoad('phB')`), [4, 5]);
        // 下絵（縮める前の大きさも。ワールドファイルで合わせ直すときに使う）
        assert.deepEqual(app.val(`(() => { const u = _ul.img; return { w: u.w, h: u.h, ow: u.ow, oh: u.oh, T: u.T, opacity: u.opacity, on: u.on, mime: u.mime, data: Array.from(new Uint8Array(u.data)), name: u.name }; })()`),
            { w: 100, h: 50, ow: 400, oh: 200, T: [1, 0, 0, 1, 5, 6], opacity: 0.4, on: true, mime: 'image/png', data: [9, 8, 7], name: 'scan.png' });
        // 保存一覧の同じ名前の図面を上書きしないよう、名前は付けずに開く
        assert.equal(app.val('getProjectState().name'), null);
        assert.equal(app.val('window._drawingName'), '現場の図面');
    });

    it('縮められないブラウザでは JSON のまま書き出し、それも開ける', async () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'm'); entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true });
            _ul.img = null; entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 3, y2: 4 }); ensureEntityIds();
            window.__CS = window.CompressionStream; delete window.CompressionStream;`);
        let bytes;
        try { bytes = await exportBytes(app); } finally { app.eval('window.CompressionStream = window.__CS;'); }
        const doc = JSON.parse(bytes.toString('utf8'));
        assert.equal(doc.format, 'webcad');
        assert.equal(doc.version, 1);
        assert.equal(doc.project.entities.length, 1);
        app.eval(`entities.length = 0;`);
        assert.equal(await openBytes(app, bytes), true);
        assert.deepEqual(app.val(`entities.map(e => [e.type, e.x1, e.y1, e.x2, e.y2])`), [['LINE', 0, 0, 3, 4]]);
    });

    it('人から受け取ったファイルでも安全: 文字は決まった項目だけ・写真の番号と色の形・画層の番号・知らない種類・__proto__ を確かめる', async () => {
        const evil = `x');alert(1);('`;
        const doc = JSON.parse(JSON.stringify({
            format: 'webcad', version: 1, gnssZone: 99,
            project: {
                name: '図', layers: [{ name: '0', color: 'red" onmouseover="x', visible: true }],
                entities: [
                    { type: 'POINT', layer: `0');alert(1);('`, color: 'red" onmouseover="x', x: 1, y: 2, size: '"><img src=x onerror=alert(1)>', onclick: 'alert(1)', name: 'KP1', num: 7 },
                    { type: 'EVIL', layer: 0, x: 0, y: 0 },
                    { type: 'PIN', layer: 0, x: 1, y: 1, text: 'm', photos: ['ok_1', evil, 5], time: 't' },
                    { type: 'HATCH', layer: 0, target: { type: 'EVIL' } },
                    { type: 'LINE', layer: 0, id: 'x', x1: 0, y1: 0, x2: 1, y2: 1, color: '#12abEF' },
                ],
                lineTypes: { DASHED: { d: [1, -1], desc: 'd', bad: 'x' } },
                savedUCSList: [{ name: 'u', originX: 'a', originY: 2, angle: 0 }, { originX: 1 }],
                currentLayerIndex: 5, surveyUnit: 'km', ltscale: -1,
            },
            photos: { ok_1: { mime: 'text/html', data: Buffer.from([1, 2]).toString('base64'), w: 'x', h: 3 }, [evil]: { mime: 'image/jpeg', data: 'AAAA' } },
            underlay: { mime: 'image/png', data: Buffer.from([7]).toString('base64'), w: 10, h: 10, T: [1, 2, 'x', 4, 5, 6], opacity: 5, on: false },
        }));
        // __proto__ は JSON の文字で入れる（オブジェクトの書き方では入らない）
        const text = JSON.stringify(doc).replace('"name":"KP1"', '"name":"KP1","__proto__":{"polluted":1}').replace('"lineTypes":{', '"lineTypes":{"__proto__":{"d":[1]},');
        app.window.__buf = new TextEncoder().encode(text).buffer;
        const d = JSON.parse(await app.eval('parseWebcadBytes(window.__buf).then(r => JSON.stringify(r, (k, v) => v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)) : v))'));
        const p = d.project;
        assert.deepEqual(p.entities.map((e) => e.type), ['POINT', 'PIN', 'LINE'], '知らない種類・形の分からない塗りつぶしを捨てる');
        const pt = p.entities[0];
        assert.equal(pt.layer, 0);
        assert.equal('color' in pt, false, '色の形');
        assert.equal('size' in pt, false, '数の項目の文字');
        assert.equal('onclick' in pt, false, '知らない項目の文字');
        assert.equal(pt.name, 'KP1'); assert.equal(pt.num, 7);
        assert.equal(Object.prototype.hasOwnProperty.call(pt, '__proto__'), false);
        assert.equal(app.val('({}).polluted'), undefined, 'Object の元が汚れた');
        assert.deepEqual(p.entities[1].photos, ['ok_1'], '写真の番号の形');
        assert.equal('id' in p.entities[2], false, '番号（id）は数だけ');
        assert.equal(p.entities[2].color, '#12abEF');
        assert.equal(p.layers[0].color, '#ffffff');
        assert.deepEqual(Object.keys(p.lineTypes), ['DASHED']);
        assert.deepEqual(p.lineTypes.DASHED, { d: [1, -1], desc: 'd' });
        assert.deepEqual(p.savedUCSList, [{ name: 'u', originX: 0, originY: 2, angle: 0 }]);
        assert.equal(p.currentLayerIndex, 0);
        assert.equal(p.surveyUnit, undefined);
        assert.equal(p.ltscale, null);
        assert.deepEqual(Object.keys(d.photos), ['ok_1']);
        assert.equal(d.photos.ok_1.mime, 'image/jpeg');
        assert.equal(d.photos.ok_1.w, 1);
        assert.equal(d.gnssZone, null);
        assert.equal(d.underlay.T, null, '下絵の合わせ方の形');
        assert.equal(d.underlay.opacity, 0.6);
        assert.equal(d.underlay.on, false);
    });

    it('図面一式でないファイルは開かず、今の図面はそのまま', async () => {
        app.eval(`entities.length = 0; entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }); ensureEntityIds(); commandLog.innerHTML = '';`);
        for (const [text, why] of [['  0\nSECTION\n  2\nHEADER\n', 'DXF'], ['{"format":"other","project":{}}', '別の JSON'], ['', '空']]) {
            assert.equal(await openBytes(app, Buffer.from(text, 'utf8'), 'x.webcad'), false, why);
            assert.equal(app.val('entities.length'), 1, why);
        }
        assert.match(app.val('commandLog.textContent'), /図面一式のファイル（\.webcad）ではない/);
    });

    it('📁開く・☰ メニュー・保存一覧・コマンド・お気に入りから使える', async () => {
        assert.equal(app.val(`!!document.querySelector('#top-menu-modal [data-fav="WEBCADOUT"]')`), true);
        assert.equal(app.val(`FAV_CATALOG.some(f => f.id === 'WEBCADOUT')`), true);
        assert.match(app.val(`document.getElementById('project-list-panel').innerHTML`), /exportWebcadFile\(\)[\s\S]*pickWebcadFile\(\)/);
        assert.match(app.val(`document.getElementById('dxf-file-input').getAttribute('accept') || ''`), /\.webcad/);
        app.eval(`window.__calls = []; window.__ow = window.exportWebcadFile; window.__ol = window.loadWebcadFile;
            window.exportWebcadFile = () => window.__calls.push('out'); window.loadWebcadFile = (f) => window.__calls.push('open:' + f.name);`);
        try {
            assert.equal(app.val(`processIOCommand('WEBCADOUT')`), true);
            assert.equal(app.val(`processIOCommand('PACK')`), true);
            app.eval(`FAV_CATALOG.find(f => f.id === 'WEBCADOUT').run()`);
            // 📁開く で .webcad を選んだとき（置き換え・追加は聞かずに、図面一式として開く）
            app.eval(`(() => { const inp = document.getElementById('dxf-file-input'); Object.defineProperty(inp, 'files', { configurable: true, value: [{ name: '現場.webcad' }] });
                inp.dispatchEvent(new window.Event('change')); delete inp.files; })()`);
            assert.deepEqual(app.val('window.__calls'), ['out', 'out', 'out', 'open:現場.webcad']);
        } finally { app.eval('window.exportWebcadFile = window.__ow; window.loadWebcadFile = window.__ol;'); }
    });

    it('📤 送る（v5.39.1）: 保存は .webcad のまま、送るときだけ LINE が受け取れる PDF（表紙＋添付ファイルに .webcad の中身）。PDF のまま開ける。図面一式の無い PDF は下絵にするかを聞く', async () => {
        await app.eval(`(async () => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true });
            addSurveyData(${JSON.stringify(PTS)}, []); setDrawingName('PDF の図面.dxf'); window._currentProjectName = null; })()`);
        const before0 = snapshot(app);
        // スマホ・タブレット（共有メニューで送れる端末）とみなす。保存したファイルと、「📤 送る」で送るファイルを控える
        app.eval(`window.__saved = null; window.__sent = null; window.__snack = null;
            window.__dlo = window.downloadBlob; window.__st = _shareTouchDevice; window.__cs = canShareFile; window.__sn = window.showSnack;
            _shareTouchDevice = () => true; canShareFile = () => true;
            showSnack = (msg, o) => { window.__snack = { msg, label: o.action.label }; window.__snackRun = o.action.run; };
            navigator.share = async (d) => { window.__sent = d.files[0]; };
            window.__dlo2 = downloadBlob; downloadBlob = (b, name, share) => { window.__saved = name; window.__savedShare = share; };`);
        try {
            await app.eval('exportWebcadFile()');
            assert.match(app.val('window.__saved'), /^PDF の図面\.webcad$/, '保存は .webcad のまま');
            assert.equal(app.val('window.__savedShare'), false, '.webcad は PDF を作る前に保存し、「📤 送る」は PDF ができてから出す');
            assert.match(app.val('window.__snack.msg'), /PDF の図面\.webcad を保存しました（LINE などへは PDF の形で送ります）/);
            await app.eval('window.__snackRun()');
            assert.equal(app.val('window.__sent.name'), 'PDF の図面_図面一式.pdf');
            assert.equal(app.val('window.__sent.type'), 'application/pdf');
        } finally {
            app.eval(`downloadBlob = window.__dlo2; _shareTouchDevice = window.__st; canShareFile = window.__cs; showSnack = window.__sn; delete navigator.share;`);
        }
        const pdf = Buffer.from(await app.eval(`new Promise(r => { const fr = new FileReader(); fr.onload = () => r(Array.from(new Uint8Array(fr.result))); fr.readAsArrayBuffer(window.__sent); })`));
        assert.equal(pdf.slice(0, 5).toString('latin1'), '%PDF-');
        const s = pdf.toString('latin1');
        assert.match(s, /\/Names << \/EmbeddedFiles << \/Names \[<FEFF[0-9A-F]+> \d+ 0 R\] >> >>/, '添付ファイルの目録');
        assert.match(s, /\/Type \/Filespec \/F \(drawing\.webcad\) \/UF <FEFF[0-9A-F]+>/);
        assert.match(s, /\/Type \/Page /);
        app.window.__pdf = new app.window.Uint8Array(pdf);
        const pk = app.val('Array.from(webcadFromPdf(window.__pdf) || [])');
        assert.deepEqual(pk.slice(0, 2), [0x1F, 0x8B], '添付ファイルは gzip の .webcad');
        // PDF のまま開く（📁開く で PDF を選ぶ）
        app.eval(`entities.length = 0;`);
        app.window.__file = { name: 'PDF の図面_図面一式.pdf', arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) };
        app.eval('window.__cc = window.cadConfirm; window.cadConfirm = async () => true;');
        try { assert.equal(await app.eval('openPdfFile(window.__file)'), true); } finally { app.eval('window.cadConfirm = window.__cc;'); }
        const after0 = snapshot(app);
        assert.deepEqual(after0.entities.map((e) => [e.type, e.name || e.text]), before0.entities.map((e) => [e.type, e.name || e.text]));
        // 図面一式の無い PDF: 下絵にするかを聞き、「下絵にする」なら下絵の読み込みへ
        const plain = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
        app.window.__file = { name: 'scan.pdf', arrayBuffer: async () => plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) };
        app.eval(`window.__asked = null; window.__cc = window.cadConfirm; window.cadConfirm = async (o) => { window.__asked = o.message; return true; };
            window.__ul = window.ulLoadPdfFile; window.__ulCalled = null; ulLoadPdfFile = (f) => { window.__ulCalled = f.name; return true; };`);
        try { await app.eval('openPdfFile(window.__file)'); } finally { app.eval('window.cadConfirm = window.__cc; ulLoadPdfFile = window.__ul;'); }
        assert.match(app.val('window.__asked'), /図面一式が入っていません[\s\S]*下絵/);
        assert.equal(app.val('window.__ulCalled'), 'scan.pdf');
        // 📁開く の .pdf は openPdfFile へ
        assert.match(app.val(`document.getElementById('dxf-file-input').getAttribute('accept') || ''`), /\.pdf/);
        assert.deepEqual(app.errors(), []);
    });

    it('点検で直したこと（v5.39.3）: 送るのを断られたら PDF も保存して手順を出す・受け取った PDF の名前・続けて押しても1回・表紙の図はコマンド欄に書かない', async () => {
        await app.eval(`(async () => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true });
            entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 100, y2: 50 }); ensureEntityIds(); window._drawingName = undefined; window._currentProjectName = null; })()`);
        app.eval(`window.__saved2 = []; window.__steps = null; window.__snackRun = null;
            window.__bk = { st: _shareTouchDevice, cs: canShareFile, sn: window.showSnack, ca: window.cadAlert, dl: window.downloadBlob,
                tb: HTMLCanvasElement.prototype.toBlob, cc: window.cadConfirm };
            _shareTouchDevice = () => true; canShareFile = () => true;
            showSnack = (msg, o) => { window.__snackRun = o.action && o.action.run; };
            cadAlert = (o) => { window.__steps = o.message; };
            // 保存は名前を控える（ほかのテストが差し替えているので、cad-io.js と同じく share が false なら「📤 送る」を出さない形で置く）
            downloadBlob = (b, name, share) => { window.__saved2.push(name); if(share !== false) offerShare(b, name); };
            navigator.share = async (d) => { window.__sent = d.files[0]; throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); };
            HTMLCanvasElement.prototype.toBlob = function (cb, type) { const b = new Uint8Array(50); b[0] = 0xFF; b[1] = 0xD8; setTimeout(() => cb(new Blob([b], { type })), 5); };
            view.x = 7; view.y = 9; view.scale = 3.5; view.rotation = 0.3;
            window.__log0 = document.getElementById('command-log').children.length;`);
        try {
            // 続けて2回押しても書き出しは1回で、表示は元のまま（以前は2回目が、全体表示にした位置を「元」と覚えた）
            await app.eval('Promise.all([exportWebcadFile(), exportWebcadFile()])');
            const saved = app.val('window.__saved2');
            assert.equal(saved.length, 1);
            assert.match(saved[0], /\.webcad$/);
            assert.deepEqual(app.val('({ x: view.x, y: view.y, scale: view.scale, rotation: view.rotation })'), { x: 7, y: 9, scale: 3.5, rotation: 0.3 });
            // 表紙の図のための全体表示は、コマンド欄に「全体表示」と書かない（練習ツアーの段階も進めない）
            assert.doesNotMatch(app.val(`Array.from(document.getElementById('command-log').children).slice(window.__log0).map(d => d.textContent).join('|')`), /全体表示/);
            // 「📤 送る」が断られたら、送ろうとした PDF も保存し、その名前で手順を出す（以前は保存していない PDF を選ぶよう案内した）
            await app.eval('window.__snackRun()');
            const base = saved[0].replace(/\.webcad$/, ''), pdfName = base + '_図面一式.pdf';
            assert.deepEqual(app.val('window.__saved2'), [saved[0], pdfName]);
            assert.ok(app.val('window.__steps').includes(`「${pdfName}」を選ぶ`));
            // 受け取った PDF を開くと、図面の名前は元の名前（以前は「…_図面一式.pdf」になり、DXF の名前が「…_図面一式.pdf.dxf」）
            const pdf = Buffer.from(await app.eval(`new Promise(r => { const fr = new FileReader(); fr.onload = () => r(Array.from(new Uint8Array(fr.result))); fr.readAsArrayBuffer(window.__sent); })`));
            app.eval(`entities.length = 0; setDrawingName('別の図面.dxf'); window.cadConfirm = async () => true;`);
            app.window.__file = { name: pdfName, arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) };
            assert.equal(await app.eval('openPdfFile(window.__file)'), true);
            assert.equal(app.val('window._drawingName'), base);
            assert.equal(app.val(`exportFileName('dxf')`), base + '.dxf');
        } finally {
            app.eval(`_shareTouchDevice = window.__bk.st; canShareFile = window.__bk.cs; showSnack = window.__bk.sn; cadAlert = window.__bk.ca; window.cadConfirm = window.__bk.cc;
                downloadBlob = window.__bk.dl; HTMLCanvasElement.prototype.toBlob = window.__bk.tb; delete navigator.share;`);
        }
        assert.deepEqual(app.errors(), []);
    });
});
