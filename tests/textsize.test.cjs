'use strict';
// 文字の大きさ（一括）と点名の大きさ（v5.36。cad-textsize.js）:
//   対象（選んだ文字・画層・すべて）・種類・今の高さで絞り、高さの指定・倍率で変える（↩ で戻せる。点名は点の右上に置き直す）、
//   座標一覧の「点名の大きさ」（自動・指定）が SIMA・座標CSV・点の追加の点名に効く、「今の点名をこの大きさに」
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('文字の大きさ（一括）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }, { name: '注記', color: '#ffff00', visible: true }); currentLayerIndex = 0; initLayers();
            view = { x: 400, y: 300, scale: 1, rotation: 0 }; localStorage.removeItem('cad_survey_unit'); localStorage.removeItem('cad_pt_label_h');
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {};
            document.querySelectorAll('.field-err').forEach(e => e.remove());
            // 文字いろいろ: ふつうの文字（高さ 1・1・2）、点と点名（高さ 0.5）、寸法の値（取り込み）、アプリの寸法
            entities.push({ type: 'TEXT', layer: 0, color: null, x: 0, y: 0, text: 'A', height: 1 });
            entities.push({ type: 'TEXT', layer: 1, color: null, x: 5, y: 0, text: 'B', height: 1 });
            entities.push({ type: 'TEXT', layer: 1, color: null, x: 9, y: 0, text: 'C', height: 2 });
            entities.push({ type: 'POINT', layer: 0, color: null, x: 10, y: 10, name: 'P1', gid: 'p1', blockName: '測点' });
            entities.push({ type: 'TEXT', layer: 0, color: null, x: 10.25, y: 10.15, text: 'P1', height: 0.5, halign: 'left', valign: 'bottom', gid: 'p1', blockName: '測点', ptLabel: true });
            entities.push({ type: 'TEXT', layer: 0, color: null, x: 20, y: 20, text: '12.5', height: 0.5, gid: 'd1', blockName: '寸法' });
            entities.push({ type: 'DIMENSION', subType: 'LINEAR', dimDir: 'H', layer: 0, color: null, p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 3 });
            ensureEntityIds();`);
    });
    const heights = () => app.val(`entities.filter(e => e.type === 'TEXT').map(e => e.text + ':' + (+e.height.toFixed(6)))`);
    const panel = () => app.eval(`document.getElementById('property-panel-content').textContent.replace(/\\s+/g, ' ')`);
    const setVal = (v) => app.eval(`document.getElementById('tsz-val').value = ${JSON.stringify(v)}`);

    it('☰・コマンド TEXTSIZE で開き、すべての文字の高さを指定の高さにする（アプリの寸法は変えない）。↩ で戻せる', () => {
        app.eval(`processCommand('TEXTSIZE')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🔠 文字の大きさ');
        assert.match(panel(), /変える文字: 5個/);
        assert.match(panel(), /文字（3）.*点名（1）.*寸法の値（1）/);
        assert.match(panel(), /1 ×2/, '今の高さ: 1 が2つ');
        setVal('3'); app.eval('textSizeApply()');
        assert.deepEqual(heights(), ['A:3', 'B:3', 'C:3', 'P1:3', '12.5:3']);
        assert.deepEqual(app.val(`entities.find(e => e.type === 'DIMENSION').p2`), { x: 10, y: 0 });
        assert.match(app.eval(`document.querySelector('#cad-snack .sn-msg').textContent`), /文字 5個の大きさを変えました（高さ 3/);
        app.eval('undo()');
        assert.deepEqual(heights(), ['A:1', 'B:1', 'C:2', 'P1:0.5', '12.5:0.5']);
        assert.deepEqual(app.errors(), []);
    });

    it('種類で絞る: 点名だけを変え、点名は点の右上に置き直す（動かした点名はその場のまま）', () => {
        app.eval(`showTextSizePanel(); textSizeKind('pt');`);
        assert.match(panel(), /変える文字: 1個/);
        setVal('2'); app.eval('textSizeApply()');
        assert.deepEqual(heights(), ['A:1', 'B:1', 'C:2', 'P1:2', '12.5:0.5']);
        assert.deepEqual(app.val(`(e => [e.x, e.y])(entities.find(e => e.ptLabel))`), [11, 10.6], '点 (10,10) の右上: 高さの 0.5・0.3');
        // 動かした点名は位置を変えない
        app.eval(`{ const t = entities.find(e => e.ptLabel); t.x = 30; t.y = 30; showTextSizePanel(); textSizeKind('pt'); }`);
        setVal('4'); app.eval('textSizeApply()');
        assert.deepEqual(app.val(`(e => [e.x, e.y, e.height])(entities.find(e => e.ptLabel))`), [30, 30, 4]);
    });

    it('今の高さで絞る・倍率で変える', () => {
        app.eval(`showTextSizePanel(); textSizeHeight('1'); textSizeHow('mul');`);
        assert.match(panel(), /変える文字: 2個/);
        setVal('1.5'); app.eval('textSizeApply()');
        assert.deepEqual(heights(), ['A:1.5', 'B:1.5', 'C:2', 'P1:0.5', '12.5:0.5']);
    });

    it('画層で絞る', () => {
        app.eval(`showTextSizePanel('layer'); textSizeLayer('1');`);
        assert.match(panel(), /変える文字: 2個/);
        assert.match(app.eval(`document.getElementById('tsz-layer').textContent`), /注記（2）/);
        setVal('0.8'); app.eval('textSizeApply()');
        assert.deepEqual(heights(), ['A:1', 'B:0.8', 'C:0.8', 'P1:0.5', '12.5:0.5']);
    });

    it('選んだ文字: 選んだときのバーに「🔠 文字」（文字が無ければ出さない）。選んだ文字だけを変える', () => {
        app.eval(`cmdState.selectedIndices = [1, 6]; updateSelectionBar();`);
        assert.equal(app.eval(`document.getElementById('sel-textsize-btn').style.display`), '');
        assert.equal(app.eval(`document.getElementById('sel-textsize-btn').getAttribute('onclick')`), "showTextSizePanel('sel')");
        app.eval(`showTextSizePanel('sel')`);
        assert.match(panel(), /選んだ文字（1）.*変える文字: 1個/);
        setVal('5'); app.eval('textSizeApply()');
        assert.deepEqual(heights(), ['A:1', 'B:5', 'C:2', 'P1:0.5', '12.5:0.5']);
        app.eval(`cmdState.selectedIndices = [6]; updateSelectionBar();`);
        assert.equal(app.eval(`document.getElementById('sel-textsize-btn').style.display`), 'none');
    });

    it('まちがった数（空・0・文字）は欄の下に理由を出し、何も変えない。表示の単位が mm なら mm で入れる', () => {
        app.eval(`showTextSizePanel();`);
        for (const bad of ['', '0', 'abc']) {
            setVal(bad); app.eval('textSizeApply()');
            assert.ok(app.eval(`document.getElementById('tsz-val').getAttribute('aria-invalid') === 'true'`), bad);
        }
        assert.deepEqual(heights(), ['A:1', 'B:1', 'C:2', 'P1:0.5', '12.5:0.5']);
        app.eval(`setDisplayPref('lenUnit', 'mm'); showTextSizePanel();`);
        assert.match(panel(), /\(mm\)/);
        setVal('250'); app.eval('textSizeApply()');
        assert.deepEqual(heights(), ['A:0.25', 'B:0.25', 'C:0.25', 'P1:0.25', '12.5:0.25']);
    });

    it('お気に入り・ヘルプ・パネルの ？ にもある', () => {
        assert.ok(app.eval(`FAV_CATALOG.some(c => c.id === 'TEXTSIZE')`));
        assert.ok(app.eval(`!!document.querySelector('#top-menu-modal [data-fav="TEXTSIZE"]')`));
        assert.ok(app.eval(`GUIDE_TOPICS.some(t => t.id === 'textsize')`));
        assert.equal(app.eval(`GUIDE_PANEL_HELP['🔠 文字の大きさ'].topic`), 'textsize');
        assert.ok(app.val(`guideHelpMatches('もじのおおきさ')`).includes('textsize'));
        assert.ok(app.val(`guideHelpMatches('文字の大きさ')`).includes('textsize'));
    });
});

describe('点名の大きさ（座標一覧）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            view = { x: 400, y: 300, scale: 1, rotation: 0 }; localStorage.removeItem('cad_survey_unit'); localStorage.removeItem('cad_pt_label_h');
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {};`);
    });
    const sima = 'G00,01,t,\nA00,\nA01,1,K1,0.000,0.000,,\nA01,2,K2,100.000,200.000,,\nA99,\n';
    const labelHeights = () => app.val(`entities.filter(e => e.ptLabel).map(e => +e.height.toFixed(6))`);

    it('初めは「自動」（点の広がりの 1/50）。「指定」にすると、読み込む SIMA の点名をその高さにする', () => {
        app.eval(`addSurveyData(parseSima(${JSON.stringify(sima)}).points, [])`);
        assert.deepEqual(labelHeights(), [4, 4], '広がり 200m の 1/50');
        app.eval(`entities.length = 0; showCoordListPanel();`);
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /点名の大きさ/);
        assert.equal(app.eval(`document.querySelector('.pl-ctl .pl-h').disabled`), true, '自動のあいだは高さの欄を使わない');
        app.eval(`{ const el = document.querySelector('.pl-ctl .pl-h'); el.value = '1.25'; ptLabelSetHeight(el); }`);
        assert.deepEqual(app.val(`ptLabelSetting()`), { mode: 'fix', m: 1.25 });
        assert.equal(app.eval(`document.querySelector('.pl-ctl .pl-mode.active').dataset.mode`), 'fix');
        app.eval(`addSurveyData(parseSima(${JSON.stringify(sima)}).points, [])`);
        assert.deepEqual(labelHeights(), [1.25, 1.25]);
        // 点の右上（高さの 0.5・0.3）
        assert.deepEqual(app.val(`(e => [e.x, e.y])(entities.find(e => e.ptLabel && e.text === 'K2'))`), [200.625, 100.375]);
        // 「自動」に戻す
        app.eval(`ptLabelSetMode('auto'); entities.length = 0; addSurveyData(parseSima(${JSON.stringify(sima)}).points, [])`);
        assert.deepEqual(labelHeights(), [4, 4]);
    });

    it('点の追加（測量計算・点のコマンド）も指定の高さ。図面の1単位が mm なら mm に直す', () => {
        app.eval(`{ ptLabelSetMode('fix'); const el = document.createElement('input'); el.value = '2'; ptLabelSetHeight(el); }`);
        app.eval(`cogoAddSurveyPoint(10, 20, 'Q1', null, 7)`);
        assert.deepEqual(labelHeights(), [2]);
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); cogoAddSurveyPoint(10, 20, 'Q2', null, 7)`);
        assert.deepEqual(labelHeights(), [2, 2000]);
    });

    it('「今の点名をこの大きさに」で図面の点名をそろえる（↩ で戻せる）', () => {
        app.eval(`{ addSurveyData(parseSima(${JSON.stringify(sima)}).points, []); ptLabelSetMode('fix'); const el = document.createElement('input'); el.value = '0.5'; ptLabelSetHeight(el); ptLabelApplyExisting(); }`);
        assert.deepEqual(labelHeights(), [0.5, 0.5]);
        app.eval('undo()');
        assert.deepEqual(labelHeights(), [4, 4]);
    });

    it('座標CSV の列の画面にも同じ欄があり、取り込む点名に効く', () => {
        app.eval(`{ ptLabelSetMode('fix'); const el = document.createElement('input'); el.value = '3'; ptLabelSetHeight(el);
            loadCoordCsvFile(new File(['点名,X,Y\\nC1,1,2\\nC2,3,4\\n'], 'a.csv')); }`);
        return new Promise((r) => setTimeout(r, 50)).then(() => {
            assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /点名の大きさ/);
            assert.equal(app.eval(`document.querySelector('.pl-ctl .pl-h').value`), '3');
            app.eval(`_prepareImportTarget = (fn) => fn(); csvMapImport();`);
            assert.deepEqual(labelHeights(), [3, 3]);
            assert.deepEqual(app.errors(), []);
        });
    });
});
