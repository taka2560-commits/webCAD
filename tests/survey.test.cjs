'use strict';
// 測量機能（cad-survey.js）のテスト:
//   SIMA・座標CSVの読み書き、Shift-JIS 変換、ブロックで描かれた測点、座標一覧、
//   緯度経度→平面直角座標の換算、現在地（GNSS）の表示の流れ
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, fixture, near } = require('./helpers/load-app.cjs');

// 実際の SIMA ファイルの例（地番 848-1 の区画と構成点）
const SAMPLE_SIMA = [
    'G00,01,法務省地図XML2sima,',
    'Z00,座標ﾃﾞｰﾀ,,',
    'A00,',
    'A01,1,5929554,645.479,-52621.837,,',
    'A01,2,5929553,642.388,-52620.022,,',
    'A01,3,5929547,591.051,-52630.159,,',
    'A01,4,5929545,589.123,-52633.108,,',
    'A01,5,5929544,599.97,-52687.927,,',
    'A01,6,4154039,650.062,-52678.061,12.5,',
    'A01,7,5929543,658.764,-52677.022,,',
    'A01,8,5929542,659.989,-52675.247,,',
    'A99,',
    'Z00,区画ﾃﾞｰﾀ,',
    'D00,1,848-1,1,',
    'B01,1,5929554,', 'B01,2,5929553,', 'B01,3,5929547,', 'B01,4,5929545,',
    'B01,5,5929544,', 'B01,6,4154039,', 'B01,7,5929543,', 'B01,8,5929542,',
    'D99,',
].join('\r\n');

describe('測量: SIMA・座標CSV', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand(); localStorage.removeItem('cad_survey_unit');
            entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            window.__download = null; downloadBlob = function (blob, name) { window.__download = { blob: blob, name: name }; };
        `);
    });

    const readDownload = () => new Promise((resolve, reject) => {
        const blob = app.eval('window.__download && window.__download.blob');
        if (!blob) { reject(new Error('ダウンロードされていない')); return; }
        const r = new app.window.FileReader();
        r.onload = () => resolve(new Uint8Array(r.result));
        r.onerror = reject;
        r.readAsArrayBuffer(blob);
    });

    it('SIMA を読み取る（点番号・点名・X・Y・標高、区画の構成点）', () => {
        app.window.__txt = SAMPLE_SIMA;
        const d = app.val('parseSima(window.__txt)');
        assert.equal(d.title, '法務省地図XML2sima');
        assert.equal(d.points.length, 8);
        assert.deepEqual(d.points[0], { num: '1', name: '5929554', X: 645.479, Y: -52621.837, z: null });
        assert.equal(d.points[5].z, 12.5);
        assert.equal(d.lots.length, 1);
        assert.equal(d.lots[0].name, '848-1');
        assert.equal(d.lots[0].refs.length, 8);
    });

    it('SIMA を図面に取り込む（X＝北＝図面の y、Y＝東＝図面の x。点名の文字と区画も作る）', () => {
        app.window.__txt = SAMPLE_SIMA;
        const r = app.val('(function(){ const d = parseSima(window.__txt); return addSurveyData(d.points, d.lots); })()');
        assert.deepEqual(r, { pointCount: 8, lotCount: 1, skippedLots: 0 });
        const p = app.val(`entities.find(e => e.type === 'POINT' && e.name === '5929554')`);
        assert.ok(near(p.x, -52621.837) && near(p.y, 645.479), JSON.stringify(p));
        assert.equal(p.num, '1');
        const label = app.val(`entities.find(e => e.type === 'TEXT' && e.text === '5929554')`);
        assert.equal(label.gid, p.gid, '点と点名は同じグループ');
        const lot = app.val(`entities.find(e => e.type === 'PLINE' && e.lotName === '848-1')`);
        assert.equal(lot.closed, true);
        assert.equal(lot.points.length, 8);
        assert.ok(near(lot.points[2].x, -52630.159) && near(lot.points[2].y, 591.051));
        const L = app.val('layers.map(l => l.name)');
        for (const n of ['測点', '測点名', '区画', '区画名']) assert.ok(L.includes(n), `画層「${n}」が無い`);
    });

    it('SIMA を書き出して読み直すと、同じ点・同じ区画になる（区画の頂点は点番号で参照）', () => {
        app.window.__txt = SAMPLE_SIMA;
        app.eval('(function(){ const d = parseSima(window.__txt); addSurveyData(d.points, d.lots); })()');
        const out = app.val(`buildSimaText('テスト図面')`);
        const lines = out.text.split('\r\n');
        assert.equal(lines[0], 'G00,01,テスト図面,');
        assert.equal(lines[1], 'Z00,座標ﾃﾞｰﾀ,,');
        assert.equal(lines[2], 'A00,');
        assert.equal(lines[3], 'A01,1,5929554,645.479,-52621.837,,');
        assert.ok(lines.includes('A01,6,4154039,650.062,-52678.061,12.500,'), '標高が出力されていない');
        assert.ok(lines.includes('D00,1,848-1,1,'));
        assert.ok(lines.includes('B01,3,5929547,'));
        assert.equal(out.pointCount, 8, '区画の頂点が点と重複して増えている');
        app.window.__out = out.text;
        const again = app.val('parseSima(window.__out)');
        const orig = app.val('parseSima(window.__txt)');
        assert.deepEqual(again.points.map((p) => [p.name, p.X, p.Y]), orig.points.map((p) => [p.name, p.X, p.Y]));
        assert.deepEqual(again.lots[0].refs.map((r) => r.name), orig.lots[0].refs.map((r) => r.name));
    });

    it('SIMA は Shift-JIS で書き出し、日本語の点名・半角カナの見出しが正しく戻る', async () => {
        app.eval(`addSurveyData([{ num: '1', name: '測点Ａ－１', X: 10, Y: 20, z: null }, { num: '2', name: 'ﾃｽﾄ〜点', X: 30, Y: 40, z: 1.5 }], []);`);
        app.eval('exportSima()');
        assert.match(app.eval('window.__download.name'), /\.sim$/);
        const bytes = await readDownload();
        const text = new TextDecoder('shift-jis').decode(bytes);
        assert.match(text, /^G00,01,/);
        assert.ok(text.includes('Z00,座標ﾃﾞｰﾀ,,'));
        assert.ok(text.includes('A01,1,測点Ａ－１,10.000,20.000,,'), text);
        assert.ok(text.includes('A01,2,ﾃｽﾄ～点,30.000,40.000,1.500,'), '「〜」は Shift-JIS の「～」にする');
        assert.ok(!text.includes('�'));
    });

    it('Shift-JIS で保存された SIMA ファイルを開ける（文字コードの自動判定）', async () => {
        const bytes = app.eval(`encodeShiftJis('G00,01,現場,\\r\\nA00,\\r\\nA01,1,境界杭,100.5,200.25,3.1,\\r\\nA99,\\r\\n')`);
        app.window.__file = new app.window.File([bytes], '現場.sim');
        const r = await app.eval('loadSimaFile(window.__file)');
        assert.equal(r.pointCount, 1);
        const p = app.val(`entities.find(e => e.type === 'POINT')`);
        assert.equal(p.name, '境界杭');
        assert.ok(near(p.x, 200.25) && near(p.y, 100.5) && near(p.z, 3.1));
        assert.equal(app.eval('window._drawingName'), '現場.sim');
    });

    it('座標CSVをいろいろな並びで読み取る（見出し行・点番号の有無・標高の有無・タブ区切り）', () => {
        app.window.__csv = [
            '点番号,点名,X,Y,標高',
            '1,KP1,100.1,200.2,10.5',
            '2,"KP,2",101,201,',
            'KP3,102,202',
            '4\t103\t203\t11',
            '5,6,104,204,12',
        ].join('\r\n');
        const d = app.val('parseCoordCsv(window.__csv)');
        assert.deepEqual(d.points.map((p) => [p.num, p.name, p.X, p.Y, p.z]), [
            ['1', 'KP1', 100.1, 200.2, 10.5],
            ['2', 'KP,2', 101, 201, null],
            ['', 'KP3', 102, 202, null],
            ['', '4', 103, 203, 11],
            ['5', '6', 104, 204, 12],
        ]);
    });

    it('座標CSVは UTF-8（BOM付き）で「点番号,点名,X,Y,標高」を書き出す', async () => {
        app.eval(`addSurveyData([{ num: '7', name: 'BM,1', X: -1.23456, Y: 2, z: 5 }], []);`);
        app.eval('exportCoordCsv()');
        const bytes = await readDownload();
        assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM が無い（Excelで文字化けする）');
        const text = new TextDecoder('utf-8').decode(bytes.slice(3));
        assert.equal(text, '点番号,点名,X,Y,標高\r\n7,"BM,1",-1.235,2.000,5.000\r\n');
    });

    it('図面の単位が mm のとき、座標を1000倍して取り込み、書き出しでは m に戻す', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); addSurveyData([{ num: '1', name: 'A', X: 1.5, Y: 2.25, z: null }], []);`);
        const p = app.val(`entities.find(e => e.type === 'POINT')`);
        assert.ok(near(p.x, 2250) && near(p.y, 1500));
        assert.ok(app.val(`buildSimaText('t').text`).includes('A01,1,A,1.500,2.250,,'));
    });

    it('点番号が無い・重複している点は 1 から振り直し、名前の無い点は P+番号にする', () => {
        app.eval(`entities.push({ type: 'POINT', layer: 0, x: 1, y: 2 }, { type: 'POINT', layer: 0, x: 3, y: 4, name: 'X' }); ensureEntityIds();`);
        const lines = app.val(`buildSimaText('t').text`).split('\r\n');
        assert.ok(lines.includes('A01,1,P1,2.000,1.000,,'));
        assert.ok(lines.includes('A01,2,X,4.000,3.000,,'));
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('測量: ブロックで描かれた測点・点のプロパティ・座標一覧', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            resetCommand(); localStorage.removeItem('cad_survey_unit');
            entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
        `);
    });

    const importBlocks = () => {
        app.window.__dxfText = fixture('test_blocks.dxf');
        app.eval(`(function () { const p = new window.DxfParser(); registerExtraDxfHandlers(p); importDxfData(p.parseSync(window.__dxfText), { skipUndo: true }); })()`);
    };

    it('DXF の属性付きブロックを測点として扱う（点名＝属性、座標＝挿入点）', () => {
        importBlocks();
        const pts = app.val('collectSurveyPoints()');
        const kp = pts.find((p) => p.name === 'KP-12');
        assert.ok(kp, `ブロックの測点が無い: ${JSON.stringify(pts)}`);
        assert.equal(kp.kind, 'block');
        assert.ok(near(kp.x, 100) && near(kp.y, 100), '挿入点が座標になっていない');
        assert.ok(!pts.some((p) => p.blockName === '寸法'), '寸法は測点ではない');
    });

    it('ブロックを移動・回転すると、測点の座標（挿入点）も一緒に動く', () => {
        importBlocks();
        app.eval(`(function () { const g = entities.find(e => e.blockName === 'SYM').gid; saveUndo(); getGroupMembers(g).forEach(i => moveEntity(entities[i], 10, 5)); })()`);
        let kp = app.val('collectSurveyPoints()').find((p) => p.name === 'KP-12');
        assert.ok(near(kp.x, 110) && near(kp.y, 105), JSON.stringify(kp));
        app.eval(`(function () { const g = entities.find(e => e.blockName === 'SYM').gid; saveUndo(); getGroupMembers(g).forEach(i => rotateEntity(entities[i], 0, 0, Math.PI / 2)); })()`);
        kp = app.val('collectSurveyPoints()').find((p) => p.name === 'KP-12');
        assert.ok(near(kp.x, -105) && near(kp.y, 110), JSON.stringify(kp));
        app.eval('undo(); undo();');
        kp = app.val('collectSurveyPoints()').find((p) => p.name === 'KP-12');
        assert.ok(near(kp.x, 100) && near(kp.y, 100), '元に戻すと挿入点も戻る');
    });

    it('点のプロパティで点名・標高を変えると、点名の文字も変わる', () => {
        app.eval(`addSurveyData([{ num: '1', name: '旧名', X: 1, Y: 2, z: 3 }], []);`);
        const id = app.val(`entities.find(e => e.type === 'POINT').id`);
        app.eval(`changeEntityPropById(${id}, 'name', '新名'); changeEntityPropById(${id}, 'z', '');`);
        const p = app.val(`getEntityById(${id})`);
        assert.equal(p.name, '新名');
        assert.equal(p.z, null);
        assert.equal(app.val(`entities.find(e => e.ptLabel).text`), '新名');
        app.eval(`cmdState.highlightIdx = entityIndexById(${id}); updatePropertiesPanel();`);
        const html = app.eval(`document.getElementById('props-content').innerHTML`);
        assert.match(html, /点名/);
        assert.match(html, /新名/);
    });

    it('座標一覧: 測点を表示し、検索で絞り込み、タップでその点へ移動して選択する', () => {
        app.eval(`addSurveyData([{ num: '1', name: 'A-1', X: 1000, Y: 2000, z: null }, { num: '2', name: 'B-2', X: 1010, Y: 2010, z: 4.5 }, { num: '3', name: 'A-3', X: 1020, Y: 2020, z: null }], []);`);
        app.eval('showCoordListPanel();');
        assert.equal(app.eval(`document.querySelectorAll('#coord-list-rows .coord-row').length`), 3);
        assert.match(app.eval(`document.querySelector('#coord-list-rows').textContent`), /X 1010\.000 {2}Y 2010\.000 {2}H 4\.500/);
        app.eval(`document.getElementById('coord-search').value = 'a-'; updateCoordListContent();`);
        assert.equal(app.eval(`document.querySelectorAll('#coord-list-rows .coord-row').length`), 2);
        app.eval(`document.querySelectorAll('#coord-list-rows .coord-row')[1].click();`); // A-3
        const s = app.val('wcsToScreen(2020, 1020)');
        assert.ok(near(s.x, app.eval('canvas.width') / 2, 0.01) && near(s.y, app.eval('canvas.height') / 2, 0.01), '画面の中央に来ていない');
        assert.equal(app.val('entities[cmdState.highlightIdx].name'), 'A-3');
    });

    it('区画（閉じたポリライン）を選ぶと面積を㎡で表示する', () => {
        // 30m × 20m の長方形の区画
        app.eval(`addSurveyData(
            [{ num: '1', name: 'a', X: 0, Y: 0, z: null }, { num: '2', name: 'b', X: 0, Y: 30, z: null }, { num: '3', name: 'c', X: 20, Y: 30, z: null }, { num: '4', name: 'd', X: 20, Y: 0, z: null }],
            [{ num: '1', name: '100番', refs: [{ num: '1' }, { num: '2' }, { num: '3' }, { num: '4' }] }]);`);
        app.eval(`cmdState.highlightIdx = entities.findIndex(e => e.lotName === '100番'); updatePropertiesPanel();`);
        const html = app.eval(`document.getElementById('props-content').textContent`);
        assert.match(html, /100番/);
        assert.match(html, /600\.000 ㎡/);
    });

    it('コマンド COORDS で座標一覧を開く', () => {
        app.eval(`processCommand('COORDS');`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '📍 座標一覧');
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('測量: 平面直角座標への換算と現在地（GNSS）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    // 独立した検算用: Redfearn の横メルカトル公式（GRS80、m0=0.9999）
    function redfearn(latDeg, lonDeg, lat0Deg, lon0Deg) {
        const a = 6378137, f = 1 / 298.257222101, k0 = 0.9999;
        const e2 = 2 * f - f * f, e4 = e2 * e2, e6 = e4 * e2;
        const A0 = 1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256, A2 = 3 / 8 * (e2 + e4 / 4 + 15 * e6 / 128), A4 = 15 / 256 * (e4 + 3 * e6 / 4), A6 = 35 * e6 / 3072;
        const m = (p) => a * (A0 * p - A2 * Math.sin(2 * p) + A4 * Math.sin(4 * p) - A6 * Math.sin(6 * p));
        const r = Math.PI / 180, p = latDeg * r, w = (lonDeg - lon0Deg) * r;
        const s = Math.sin(p), c = Math.cos(p), t = Math.tan(p), t2 = t * t;
        const nu = a / Math.sqrt(1 - e2 * s * s), rho = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), psi = nu / rho;
        const wc = w * c;
        const y = k0 * nu * wc * (1 + wc * wc / 6 * (psi - t2) + Math.pow(wc, 4) / 120 * (4 * psi ** 3 * (1 - 6 * t2) + psi * psi * (1 + 8 * t2) - 2 * psi * t2 + t2 * t2) + Math.pow(wc, 6) / 5040 * (61 - 479 * t2 + 179 * t2 * t2 - t2 ** 3));
        const x = k0 * (m(p) + nu * t * (wc * wc / 2 + Math.pow(wc, 4) / 24 * (4 * psi * psi + psi - t2) + Math.pow(wc, 6) / 720 * (8 * psi ** 4 * (11 - 24 * t2) - 28 * psi ** 3 * (1 - 6 * t2) + psi * psi * (1 - 32 * t2) - 2 * psi * t2 + t2 * t2) + Math.pow(wc, 8) / 40320 * (1385 - 3111 * t2 + 543 * t2 * t2 - t2 ** 3)));
        return { X: x - k0 * m(lat0Deg * r), Y: y };
    }

    it('各系の原点は (0, 0) になる', () => {
        for (let z = 1; z <= 19; z++) {
            const o = app.val(`JPRCS_ZONES[${z}]`);
            const p = app.val(`latLonToJprcs(${o.lat}, ${o.lon}, ${z})`);
            assert.ok(Math.abs(p.X) < 1e-6 && Math.abs(p.Y) < 1e-6, `${z}系: ${JSON.stringify(p)}`);
        }
    });

    it('独立した公式（Redfearn）と 5mm 以内で一致する（東京・札幌・那覇付近）', () => {
        const cases = [
            [35.681236, 139.767125, 9],   // 東京駅付近
            [36.5, 140.4, 9],
            [43.068661, 141.350755, 12],  // 札幌付近
            [26.2125, 127.6809, 15],      // 那覇付近
            [34.0, 132.9, 4],
        ];
        for (const [lat, lon, zone] of cases) {
            const o = app.val(`JPRCS_ZONES[${zone}]`);
            const got = app.val(`latLonToJprcs(${lat}, ${lon}, ${zone})`);
            const ref = redfearn(lat, lon, o.lat, o.lon);
            assert.ok(Math.abs(got.X - ref.X) < 0.005 && Math.abs(got.Y - ref.Y) < 0.005,
                `${lat},${lon} (${zone}系): GSI式 ${got.X.toFixed(4)}, ${got.Y.toFixed(4)} / Redfearn ${ref.X.toFixed(4)}, ${ref.Y.toFixed(4)}`);
        }
    });

    it('東西に対称で、北へ行くと X が増え、東へ行くと Y が増える', () => {
        const e = app.val('latLonToJprcs(36.1, 139.9, 9)');
        const w = app.val(`latLonToJprcs(36.1, ${139 + 50 / 60 - (139.9 - (139 + 50 / 60))}, 9)`);
        assert.ok(near(e.X, w.X, 1e-6) && near(e.Y, -w.Y, 1e-6));
        assert.ok(e.X > 0 && e.Y > 0);
    });

    it('現在地の表示: 位置を受け取ると図面上に置き、中央に表示し、点を追加できる', () => {
        let success = null;
        const geo = { watchPosition: (s) => { success = s; return 7; }, clearWatch: () => { geo.cleared = true; } };
        Object.defineProperty(app.window.navigator, 'geolocation', { value: geo, configurable: true });
        app.eval(`entities.length = 0; localStorage.setItem('cad_gnss_zone', '9'); localStorage.removeItem('cad_survey_unit'); toggleGnss();`);
        assert.equal(app.eval(`document.getElementById('gnss-bar').style.display`), 'flex');
        assert.ok(success, '位置の監視が始まっていない');
        success({ coords: { latitude: 36.001, longitude: 139 + 50 / 60, accuracy: 4.2 }, timestamp: Date.now() });
        const fix = app.val('_gnss.fix');
        const expectX = app.val(`latLonToJprcs(36.001, ${139 + 50 / 60}, 9)`).X;
        assert.ok(near(fix.y, expectX, 1e-6) && near(fix.x, 0, 1e-6), JSON.stringify(fix));
        const s = app.val(`wcsToScreen(${fix.x}, ${fix.y})`);
        assert.ok(near(s.x, app.eval('canvas.width') / 2, 0.01) && near(s.y, app.eval('canvas.height') / 2, 0.01), '現在地が中央にない');
        assert.match(app.eval(`document.getElementById('gnss-text').textContent`), /±4\.2m/);
        app.eval('addPointAtGnss();');
        const p = app.val(`entities.find(e => e.type === 'POINT')`);
        assert.equal(p.name, 'GNSS-1');
        assert.ok(near(p.y, expectX, 1e-6));
        app.eval('stopGnss();');
        assert.equal(app.eval(`document.getElementById('gnss-bar').style.display`), 'none');
        assert.equal(geo.cleared, true);
    });

    it('系番号が未設定なら、先に系番号の選択を出してから測位を始める', () => {
        let started = false;
        Object.defineProperty(app.window.navigator, 'geolocation', { value: { watchPosition: () => { started = true; return 1; }, clearWatch() {} }, configurable: true });
        app.eval(`localStorage.removeItem('cad_gnss_zone'); toggleGnss();`);
        assert.equal(started, false);
        assert.match(app.eval(`document.getElementById('property-panel-title').textContent`), /系番号/);
        app.eval('setGnssZone(9);');
        assert.equal(started, true);
        assert.equal(app.eval(`localStorage.getItem('cad_gnss_zone')`), '9');
        app.eval('stopGnss();');
    });

    it('現在地が図面から大きく離れていれば、系番号・単位の確認を促す', () => {
        let success = null;
        Object.defineProperty(app.window.navigator, 'geolocation', { value: { watchPosition: (s) => { success = s; return 1; }, clearWatch() {} }, configurable: true });
        app.eval(`
            entities.length = 0; entities.push({ type: 'LINE', layer: 0, x1: 500000, y1: 500000, x2: 500100, y2: 500100 });
            localStorage.setItem('cad_gnss_zone', '9'); toggleGnss();
        `);
        success({ coords: { latitude: 36, longitude: 139 + 50 / 60, accuracy: 3 }, timestamp: Date.now() });
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /大きく離れて/);
        app.eval('stopGnss();');
    });

    it('位置情報が許可されていないときは理由を表示して終了する', () => {
        let fail = null;
        Object.defineProperty(app.window.navigator, 'geolocation', { value: { watchPosition: (s, e) => { fail = e; return 1; }, clearWatch() {} }, configurable: true });
        app.eval(`localStorage.setItem('cad_gnss_zone', '9'); toggleGnss();`);
        fail({ code: 1 });
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /許可/);
        assert.equal(app.eval('_gnss.on'), false);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
