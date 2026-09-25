'use strict';
// 角度の表示（オプション「角度の表示」: 度 / 度分秒）と、単位の切り替えボタン（お気に入り LENUNIT・COORDUNIT、
// コマンド UNIT・CUNIT）のテスト
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('角度の表示・単位の切り替えボタン', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            resetCommand(); hidePropertyPanel();
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {}; applyDisplayPrefs();
            localStorage.removeItem('cad_survey_unit');
            entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 1, rotation: 0 };
            ucs = { originX: 0, originY: 0, angle: 0 };
            snapResult = null;
            _fav.items = []; Object.assign(_fav, { show: true, dir: 'v', labels: true, folded: false }); _favSave(); favRenderBar();
        `);
    });

    function drawnTexts() {
        app.eval(`window.__t = []; ctx.fillText = (t) => window.__t.push(String(t));`);
        try { app.eval('_drawFrame(false)'); } finally { app.eval('delete ctx.fillText'); }
        return app.val('window.__t');
    }
    const log = () => app.eval(`document.getElementById('command-log').textContent`);
    // 30.5° の角度寸法（頂点 0,0・辺は 0° と 30.5°）
    const ANG = `{ type:'DIMENSION', subType:'ANGULAR', layer:0, color:null, vertex:{x:0,y:0}, arm1:{x:100,y:0},
        arm2:{x:100*Math.cos(30.5*Math.PI/180), y:100*Math.sin(30.5*Math.PI/180)}, arcRadius:40, textOverride:null }`;

    it('「度」（初期値）は以前と同じ表示', () => {
        assert.equal(app.eval(`displayPrefKey('angleFormat')`), 'deg');
        assert.equal(app.eval(`dimFormatAngle(45.5)`), '45.5°');
        assert.equal(app.eval(`angleText(12.345678)`), '12.3457°');
        app.eval(`entities.push(${ANG})`);
        assert.ok(drawnTexts().includes('30.5°'));
    });

    it('「度分秒」: 角度寸法・DXF の文字・秒の繰り上がり・マイナス', () => {
        app.eval(`setDisplayPref('angleFormat', 'dms')`);
        assert.equal(app.eval(`dimFormatAngle(45 + 30/60 + 15/3600)`), '45°30′15″');
        assert.equal(app.eval(`formatDmsAngle(59.99999)`), '60°00′00″');     // 59°59′59.964″ → 60°00′00″
        assert.equal(app.eval(`formatDmsAngle(-12.5)`), '-12°30′00″');      // 右回り
        assert.equal(app.eval(`formatDmsAngle(-0.00001)`), '0°00′00″');     // -0″ にしない
        assert.equal(app.eval(`angleText(90)`), '90°00′00″');
        app.eval(`entities.push(${ANG})`);
        const t = drawnTexts();
        assert.ok(t.includes('30°30′00″'), t.join(','));
        assert.equal(app.eval(`dimExportPrims(entities[0], 1).texts[0].s`), '30°30′00″');
        // 度に戻すとすぐ描き直す
        app.eval(`setDisplayPref('angleFormat', 'deg')`);
        assert.ok(drawnTexts().includes('30.5°'));
    });

    it('角度の入力: 度の数・度 分 秒・全角・マイナス（右回り）', () => {
        assert.equal(app.eval(`parseAngleInput('45.5')`), 45.5);
        assert.ok(near(app.eval(`parseAngleInput('45 30 15')`), 45 + 30 / 60 + 15 / 3600));
        assert.ok(near(app.eval(`parseAngleInput('45°30′00″')`), 45.5));
        assert.ok(near(app.eval(`parseAngleInput('４５\\u3000３０\\u3000００')`), 45.5)); // 全角の数字と全角の空白
        assert.ok(near(app.eval(`parseAngleInput('-45-30-00')`), -45.5));
        assert.ok(near(app.eval(`parseAngleInput('−30')`), -30));
        assert.ok(Number.isNaN(app.eval(`parseAngleInput('')`)));
    });

    it('回転: 度分秒のときは「度 分 秒」で入れられ、記録も度分秒', () => {
        // 度（初期値）: これまでどおり数の欄
        app.eval(`lastParams.angle = '90'; processCommand('ROTATE');`);
        assert.equal(app.eval(`document.getElementById('prop-rotate-a').type`), 'number');
        app.eval(`resetCommand(); hidePropertyPanel(); setDisplayPref('angleFormat', 'dms'); processCommand('ROTATE');`);
        const el = `document.getElementById('prop-rotate-a')`;
        assert.equal(app.eval(`${el}.type`), 'text');
        assert.equal(app.eval(`${el}.value`), '90°00′00″');
        assert.match(app.eval(`document.getElementById('property-panel-content').innerHTML`), /角度\(度 分 秒\)/);
        app.eval(`${el}.value = '45 30 15'; applyRotatePreset();`);
        assert.ok(near(app.eval('cmdState.presetAngleDeg'), 45 + 30 / 60 + 15 / 3600));
        assert.match(log(), /角度 45°30′15″ を設定/);
        // 図形を回すと、記録も度分秒
        app.eval(`entities.push({ type:'LINE', layer:0, color:null, x1:0, y1:0, x2:10, y2:0 }); cmdState.highlightIdx = 0;
                  cmdState.mode = 'WAITING_ROTATE_BASE'; handlePointInput({ x:0, y:0 }, true);`);
        assert.match(log(), /回転完了 \(角度: 45°30′15″/);
        assert.ok(near(app.eval('entities[0].y2'), 10 * Math.sin((45 + 30 / 60 + 15 / 3600) * Math.PI / 180)));
        // 空欄なら参照点方式（角度は決めない）
        app.eval(`resetCommand(); cmdState.presetAngleDeg = undefined; processCommand('ROTATE'); ${el}.value = ''; applyRotatePreset();`);
        assert.equal(app.eval('cmdState.presetAngleDeg'), undefined);
    });

    it('UCS の角度の記録も設定どおり', () => {
        app.eval(`setUCS(0, 0, Math.PI / 6)`);
        assert.match(log(), /∠30°/);
        app.eval(`setDisplayPref('angleFormat', 'dms'); setUCS(0, 0, (30 + 15 / 60) * Math.PI / 180)`);
        assert.match(log(), /∠30°15′00″/);
        app.eval(`resetUCS()`);
    });

    it('オプション画面に「角度の表示」', () => {
        app.eval(`showOptionsPanel()`);
        const html = app.eval(`document.getElementById('property-panel-content').innerHTML`);
        assert.match(html, /角度の表示/);
        assert.match(html, /度分秒/);
        app.eval(app.eval(`document.querySelector('.opt-pref-btn[data-pref="angleFormat"][data-key="dms"]').getAttribute('onclick')`));
        assert.equal(app.eval(`displayPrefKey('angleFormat')`), 'dms');
    });

    it('単位の切り替え: 押すたびに m ⇔ mm。図面と同じ単位に戻すと「図面どおり」', () => {
        // 1単位＝1m の図面
        app.eval(`toggleDisplayUnit('len')`);
        assert.equal(app.eval(`displayPrefKey('lenUnit')`), 'mm');
        assert.match(log(), /長さの単位: mm/);
        app.eval(`toggleDisplayUnit('len')`);
        assert.equal(app.eval(`displayPrefKey('lenUnit')`), 'auto');
        // 1単位＝1mm の図面では m ⇔ 図面どおり（mm）
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); toggleDisplayUnit('coord')`);
        assert.equal(app.eval(`displayPrefKey('coordUnit')`), 'm');
        app.eval(`toggleDisplayUnit('coord')`);
        assert.equal(app.eval(`displayPrefKey('coordUnit')`), 'auto');
        // オプションで選んだ単位からも切り替わる
        app.eval(`localStorage.removeItem('cad_survey_unit'); setDisplayPref('lenUnit', 'm'); toggleDisplayUnit('len')`);
        assert.equal(app.eval(`displayPrefKey('lenUnit')`), 'mm');
    });

    it('コマンド UNIT（長さ）・CUNIT（座標）', () => {
        app.eval(`processCommand('UNIT')`);
        assert.equal(app.eval(`displayUnit('len')`), 'mm');
        app.eval(`processCommand('CUNIT')`);
        assert.equal(app.eval(`displayUnit('coord')`), 'mm');
        app.eval(`processCommand('unit'); processCommand('cunit')`);
        assert.equal(app.eval(`displayUnit('len')`), 'm');
        assert.equal(app.eval(`displayUnit('coord')`), 'm');
    });

    it('お気に入りのボタン: いまの単位を出し、押すと切り替わる。オプションで変えてもボタンが変わる', () => {
        const icon = (id) => app.eval(`document.querySelector('#fav-bar .fav-btn[data-id="${id}"] .fav-icon').textContent`);
        app.eval(`favToggle('LENUNIT'); favToggle('COORDUNIT');`);
        assert.deepEqual(app.val(`[...document.querySelectorAll('#fav-bar .fav-btn[data-id]')].map(b => b.dataset.id)`), ['LENUNIT', 'COORDUNIT']);
        assert.equal(icon('LENUNIT'), 'm');
        assert.equal(icon('COORDUNIT'), 'm');
        app.eval(`document.querySelector('#fav-bar .fav-btn[data-id="LENUNIT"]').click()`);
        assert.equal(app.eval(`displayPrefKey('lenUnit')`), 'mm');
        assert.equal(icon('LENUNIT'), 'mm');
        assert.equal(icon('COORDUNIT'), 'm');
        // オプションで座標を mm にすると、座標のボタンも mm
        app.eval(`setDisplayPref('coordUnit', 'mm')`);
        assert.equal(icon('COORDUNIT'), 'mm');
        // 図面の1単位を mm にすると「図面どおり」の長さは… 選んだ mm のまま
        app.eval(`setSurveyUnit('mm')`);
        assert.equal(icon('LENUNIT'), 'mm');
        app.eval(`setSurveyUnit('m')`);
        // 登録の画面にも、いまの単位
        app.eval(`showFavPanel()`);
        assert.match(app.eval(`document.getElementById('property-panel-content').innerHTML`), /長さ単位/);
        app.eval(`favToggle('LENUNIT'); favToggle('COORDUNIT');`);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
