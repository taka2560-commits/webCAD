'use strict';
// 書き出す前の確認（v5.37。cad-export-preview.js）:
//   SIMA・座標CSV・SDR33・変換後の SIMA は、中身（表・ファイルの文字）と気づいたことを見せてから書き出す。
//   「やめる」なら何も書き出さない。気づいたこと: 点番号の振り直し・付けた点番号・名前の無い点・区画の頂点に足した点・Shift-JIS で表せない文字・SDR の点名の置き換え
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('書き出す前の確認', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; _xp = null;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            localStorage.removeItem('cad_survey_unit'); localStorage.removeItem('cad_pt_label_h'); setDrawingName('genba.dxf');
            window.__downloads = []; window.__dlOrig = window.__dlOrig || downloadBlob; downloadBlob = (b, n) => window.__downloads.push(n);`);
    });
    const title = () => app.eval(`document.getElementById('property-panel').style.display === 'flex' ? document.getElementById('property-panel-title').textContent : ''`);
    const text = () => app.eval(`document.getElementById('property-panel-content').textContent.replace(/\\s+/g, ' ')`);
    const downloads = () => app.val('window.__downloads');
    const add = (pts, lots) => app.eval(`addSurveyData(${JSON.stringify(pts)}, ${JSON.stringify(lots || [])})`);

    it('SIMA: すぐには書き出さず、ファイル名・点の数・表を見せる。「📤 書き出す」で書き出す', () => {
        add([{ num: '1', name: 'K1', X: 10, Y: 20, z: 1.5 }, { num: '2', name: 'K2', X: 30, Y: 40, z: null }]);
        app.eval('exportSima()');
        assert.equal(title(), '📄 書き出す前の確認');
        assert.deepEqual(downloads(), [], 'まだ書き出さない');
        assert.match(text(), /SIMA（Shift-JIS）/);
        assert.match(text(), /genba\.sim・測点 2点/);
        const rows = app.val(`[...document.querySelectorAll('#xp-rows tbody tr')].map(tr => [...tr.children].map(td => td.textContent))`);
        assert.deepEqual(rows, [['1', 'K1', '10.000', '20.000', '1.500'], ['2', 'K2', '30.000', '40.000', '']]);
        app.eval('exportPreviewWrite()');
        assert.deepEqual(downloads(), ['genba.sim']);
        assert.equal(title(), '', '書き出したら閉じる');
        assert.deepEqual(app.errors(), []);
    });

    it('「やめる」なら書き出さない。ファイルの中身は書く文字そのまま', () => {
        add([{ num: '1', name: 'K1', X: 10, Y: 20, z: null }]);
        app.eval(`exportSima(); exportPreviewTab('text')`);
        const pre = app.eval(`document.getElementById('xp-text').textContent`);
        assert.equal(pre.split('\n')[0], 'G00,01,genba,');
        assert.ok(pre.includes('A01,1,K1,10.000,20.000,,'));
        app.eval(`exportPreviewTab('table'); exportPreviewCancel()`);
        assert.deepEqual(downloads(), []);
        assert.equal(title(), '');
    });

    it('気づいたこと: 点番号が重なっていれば振り直しを ⚠、どの点にも無ければ ℹ、名前の無い点・区画の頂点に足した点', () => {
        app.eval(`entities.push({ type: 'POINT', layer: 0, x: 1, y: 2, num: '5', name: 'A' }, { type: 'POINT', layer: 0, x: 3, y: 4, num: '5', name: '' }); ensureEntityIds();`);
        app.eval('exportSima()');
        assert.match(text(), /⚠ 点番号の無い点・重なった点番号・数でない点番号があったので、1 から振り直しました/);
        assert.match(text(), /ℹ 点名の無い 1点は「P＋点番号」にしました/);
        app.eval(`exportPreviewCancel(); entities.length = 0;`);
        add([{ num: '', name: 'A', X: 0, Y: 0 }, { num: '', name: 'B', X: 0, Y: 10 }, { num: '', name: 'C', X: 10, Y: 10 }]);
        app.eval(`entities.push({ type: 'PLINE', layer: 0, closed: true, lotName: '区画1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }); ensureEntityIds(); exportSima();`);
        assert.doesNotMatch(text(), /⚠ 点番号/, '点番号がどの点にも無いのは、振り直しではない');
        assert.match(text(), /ℹ 点番号はどの点にも無かったので、1 から順に付けました/);
        assert.match(text(), /区画の頂点に測点が無かった 1か所は、点を足しました/);
        assert.match(text(), /区画 1/);
        assert.match(app.eval(`document.getElementById('xp-rows').textContent`), /区画1（4点）/);
    });

    it('Shift-JIS で表せない文字は「?」になると ⚠ で知らせる（座標CSV は UTF-8 なので出さない）', () => {
        add([{ num: '1', name: 'Año😀', X: 1, Y: 2 }]);
        app.eval('exportSima()');
        assert.match(text(), /⚠ Shift-JIS で表せない文字（ñ 😀）は「\?」になります/);
        // 表・ファイルの中身は、実際に書く文字（Shift-JIS に直したあと）
        assert.equal(app.eval(`document.querySelector('#xp-rows tbody tr').children[1].textContent`), 'A?o?');
        app.eval(`exportPreviewTab('text')`);
        assert.ok(app.eval(`document.getElementById('xp-text').textContent`).includes('A01,1,A?o?,1.000,2.000,,'));
        app.eval(`exportPreviewCancel(); exportCoordCsv()`);
        assert.match(text(), /座標CSV（UTF-8・BOM付き/);
        assert.doesNotMatch(text(), /Shift-JIS で表せない/);
        app.eval('exportPreviewWrite()');
        assert.deepEqual(downloads(), ['genba_座標.csv']);
    });

    it('点名・点番号で検索して表を絞る。行が多いときは先頭の 300 行（書き出すのは全部）', () => {
        add(Array.from({ length: 350 }, (_, i) => ({ num: String(i + 1), name: 'T' + (i + 1), X: i, Y: i })));
        app.eval('exportSima()');
        assert.equal(app.eval(`document.querySelectorAll('#xp-rows tbody tr').length`), 300);
        assert.match(app.eval(`document.getElementById('xp-rows').textContent`), /ほか 50点/);
        app.eval(`exportPreviewSearch('T34')`);
        assert.deepEqual(app.val(`[...document.querySelectorAll('#xp-rows tbody tr')].map(tr => tr.children[1].textContent)`), ['T34', 'T340', 'T341', 'T342', 'T343', 'T344', 'T345', 'T346', 'T347', 'T348', 'T349']);
        app.eval(`exportPreviewSearch('zzz')`);
        assert.match(app.eval(`document.getElementById('xp-rows').textContent`), /該当する点がありません/);
    });

    it('SDR33: 点名を置き換えた点を ⚠ で見せる。表は書く SDR から読み直した点', () => {
        add([{ num: '1', name: '境界1', X: 1.5, Y: 2.5, z: 3 }, { num: '2', name: 'KP2', X: 4, Y: 5 }]);
        app.eval('exportSdr33()');
        assert.match(text(), /SDR33（半角の英数字）/);
        assert.match(text(), /⚠ SDR の点名に使えない.* 1点は、P0001 などにしました（境界1→P0001）/);
        const rows = app.val(`[...document.querySelectorAll('#xp-rows tbody tr')].map(tr => [...tr.children].map(td => td.textContent))`);
        assert.deepEqual(rows, [['1', 'P0001', '1.500', '2.500', '3.000'], ['2', 'KP2', '4.000', '5.000', '']]);
        app.eval('exportPreviewWrite()');
        assert.deepEqual(downloads(), ['genba.sdr']);
    });

    it('座標一覧から開いたときは、書き出したあと・やめたあとに座標一覧に戻る', () => {
        add([{ num: '1', name: 'K1', X: 1, Y: 2 }]);
        app.eval(`showCoordListPanel(); document.querySelector('#property-panel-content button[onclick="exportSima()"]') && exportSima();`);
        assert.equal(title(), '📄 書き出す前の確認');
        app.eval('exportPreviewWrite()');
        assert.equal(title(), '📍 座標一覧');
        assert.deepEqual(downloads(), ['genba.sim']);
        app.eval('exportCoordCsv(); exportPreviewCancel()');
        assert.equal(title(), '📍 座標一覧');
        assert.deepEqual(downloads(), ['genba.sim'], 'やめたら書き出さない');
    });

    it('測点が無ければ確認を出さずに知らせる。パネルの ？ は書き出しの説明', () => {
        app.eval('exportSima()');
        assert.equal(title(), '');
        assert.equal(app.eval(`GUIDE_PANEL_HELP['📄 書き出す前の確認'].topic`), 'export');
        assert.match(app.eval(`GUIDE_TOPICS.find(t => t.id === 'export').steps.join(' ')`), /書き出す前の確認/);
        app.eval('downloadBlob = window.__dlOrig');
    });
});
