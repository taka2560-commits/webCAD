'use strict';
// 表示の単位（オプションの「座標の単位」「長さの単位」: 図面どおり / m / mm）のテスト:
//   座標・寸法・測定・コマンドの記録・プロパティ欄の表示と、入力（コマンド欄・作図の設定・編集・相対入力）の換算
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('表示の単位（m / mm）', () => {
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
            snapResult = null; osnapState.main = true; _lastInputWcs = null;
        `);
    });

    // 図形を描いたときの文字を集める
    function drawnTexts() {
        app.eval(`window.__t = []; ctx.fillText = (t) => window.__t.push(String(t));`);
        try { app.eval('_drawFrame(false)'); } finally { app.eval('delete ctx.fillText'); }
        return app.val('window.__t');
    }
    const log = () => app.eval(`document.getElementById('command-log').textContent`);
    const panelInput = (id) => app.eval(`document.getElementById('${id}').value`);
    const panelHtml = () => app.eval(`document.getElementById('property-panel-content').innerHTML`);

    it('「図面どおり」（初期値）は以前と同じ表示', () => {
        assert.equal(app.eval(`displayPrefKey('coordUnit')`), 'auto');
        assert.equal(app.eval(`displayPrefKey('lenUnit')`), 'auto');
        assert.equal(app.eval(`displayUnitScale('len')`), 1);
        assert.equal(app.eval(`formatCoordValue(12.3456, 'loupe')`), '12.35');
        assert.equal(app.eval(`dimFormat(12.3456)`), '12.346');
        assert.equal(app.eval(`measFormatLength(12.3456)`), '12.346');
        assert.equal(app.eval(`lengthText(0.5)`), '0.5'); // 単位を選んでいなければ単位は付けない（以前と同じ）
        assert.equal(app.eval(`displayUnitTag('len')`), '');
    });

    it('1単位＝1m の図面を mm で表示: 寸法・測定・座標', () => {
        app.eval(`setDisplayPref('lenUnit', 'mm'); setDisplayPref('coordUnit', 'mm');`);
        assert.equal(app.eval(`displayUnit('len')`), 'mm');
        assert.equal(app.eval(`displayUnitScale('coord')`), 1000);
        // 長さの「自動」は mm なら整数（m の小数3桁と同じ細かさ）
        assert.equal(app.eval(`dimFormat(12.3456)`), '12346');
        assert.equal(app.eval(`measFormatLength(12.3456)`), '12346');
        assert.equal(app.eval(`_measUnitLabel()`), 'mm');
        assert.equal(app.eval(`lengthText(0.5)`), '500mm');
        // 座標の「標準」: ステータスバーもルーペも整数
        assert.equal(app.eval(`formatCoordValue(12.3456, 'bar')`), '12346');
        assert.equal(app.eval(`formatCoordValue(12.3456, 'loupe')`), '12346');
        // 座標の桁を選べば、その桁（mm の小数1桁）
        app.eval(`setDisplayPref('coordDecimals', '1')`);
        assert.equal(app.eval(`formatCoordValue(12.3456, 'loupe')`), '12345.6');
        // 寸法の桁を選べば、長さもその桁
        app.eval(`setDisplayPref('dimDecimals', '1')`);
        assert.equal(app.eval(`dimFormat(1.23456)`), '1234.6');
        assert.equal(app.eval(`measFormatLength(1.23456)`), '1234.6');
    });

    it('1単位＝1mm の図面を m で表示', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); setDisplayPref('lenUnit', 'm'); setDisplayPref('coordUnit', 'm');`);
        assert.equal(app.eval(`displayUnitScale('len')`), 0.001);
        assert.equal(app.eval(`dimFormat(1500)`), '1.5');
        assert.equal(app.eval(`measFormatLength(1234.56)`), '1.235');
        assert.equal(app.eval(`lengthText(250)`), '0.25m');
        assert.equal(app.eval(`formatCoordValue(12345.6, 'loupe')`), '12.35');
        assert.equal(app.eval(`formatCoordValue(12345.6, 'bar')`), '12');
        // 入力は m → 図面の mm に直す（換算の端数は出さない）
        assert.equal(app.eval(`fromDisplayUnit(0.3, 'len')`), 300);
        assert.equal(app.eval(`displayUnitNum(300, 'len')`), '0.3');
    });

    it('図面の1単位を切り替えると、選んだ単位のまま換算が変わる', () => {
        app.eval(`setDisplayPref('lenUnit', 'mm')`);
        assert.equal(app.eval(`dimFormat(1)`), '1000');
        app.eval(`setSurveyUnit('mm')`);
        assert.equal(app.eval(`dimFormat(1)`), '1');
        app.eval(`setSurveyUnit('m')`);
        assert.equal(app.eval(`dimFormat(1)`), '1000');
    });

    it('寸法の文字・座標寸法・DXF・印刷の文字が単位に合わせて変わる', () => {
        app.eval(`entities.push({ type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:0,y:0}, p2:{x:12.345,y:0}, offset:5 });
                  entities.push({ type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:-52621.837,y:645.479}, leaderCoord:{x:-52611,y:650} });`);
        let t = drawnTexts();
        assert.ok(t.includes('12.345') && t.includes('X: 645.479'), t.join(','));
        app.eval(`setDisplayPref('lenUnit', 'mm')`);
        t = drawnTexts();
        assert.ok(t.includes('12345'), t.join(','));
        assert.ok(t.includes('X: 645.479'), '座標寸法は座標の単位（図面どおりの m のまま）: ' + t.join(','));
        app.eval(`setDisplayPref('coordUnit', 'mm')`);
        t = drawnTexts();
        assert.ok(t.includes('X: 645479') && t.includes('Y: -52621837'), t.join(','));
        // DXF・印刷は同じ文字（dimExportPrims）
        assert.equal(app.eval(`dimExportPrims(entities[0], 1).texts[0].s`), '12345');
        assert.deepEqual(app.val(`dimExportPrims(entities[1], 1).texts.map(x => x.s)`), ['X: 645479', 'Y: -52621837']);
    });

    it('基点測定: 表示・記入した寸法が長さの単位に合わせて変わる（文字を固定しない）', () => {
        app.eval(`processCommand('MEASURE'); handlePointInput({x:0, y:0}, true); snapResult = null; mouse.wcsX = 3; mouse.wcsY = 4;`);
        app.eval(`setDisplayPref('lenUnit', 'mm'); handlePointInput({x:3, y:4}, true);`);
        assert.match(log(), /測定: X 4000mm \/ Y 3000mm \/ 直線 5000mm/);
        app.eval(`measureWriteDims(); resetCommand();`);
        let t = drawnTexts();
        for(const s of ['3000', '4000', '5000']) assert.ok(t.includes(s), t.join(','));
        // 単位を戻すと、記入済みの寸法も m（小数3桁）で描く
        app.eval(`setDisplayPref('lenUnit', 'auto')`);
        t = drawnTexts();
        for(const s of ['3.000', '4.000', '5.000']) assert.ok(t.includes(s), t.join(','));
    });

    it('以前の版で文字を固定した測定の寸法も単位に合わせる（書き換えた文字はそのまま）', () => {
        app.eval(`entities.push({ type:'DIMENSION', subType:'ALIGNED', layer:0, color:null, gid:'m1', blockName:'測定', p1:{x:0,y:0}, p2:{x:3,y:4}, offset:0, textOverride:'5.000' });
                  entities.push({ type:'DIMENSION', subType:'ALIGNED', layer:0, color:null, gid:'m2', blockName:'測定', p1:{x:10,y:0}, p2:{x:13,y:4}, offset:0, textOverride:'約5m' });
                  setDisplayPref('lenUnit', 'mm');`);
        const t = drawnTexts();
        assert.ok(t.includes('5000'), t.join(','));
        assert.ok(t.includes('約5m') && !t.includes('5.000'), t.join(','));
    });

    it('コマンドの記録: 円の半径などを表示の単位で出す', () => {
        app.eval(`setDisplayPref('lenUnit', 'mm'); lastParams.circleMode = 'manual'; processCommand('CIRCLE'); handlePointInput({x:0, y:0}, true);`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_RADIUS');
        // コマンド欄の数は表示の単位（500mm → 図面の 0.5m）
        app.eval(`processCommand('500')`);
        assert.equal(app.val('entities[entities.length - 1].radius'), 0.5);
        assert.match(log(), /円作成 半径: 500mm/);
    });

    it('コマンド欄の座標「X,Y」は座標の単位、相対「@X,Y」は長さの単位', () => {
        app.eval(`setDisplayPref('coordUnit', 'mm'); setDisplayPref('lenUnit', 'mm');`);
        app.eval(`processCommand('LINE'); processCommand('10000,20000');`);
        assert.deepEqual(app.val('cmdState.startWcs'), { x: 20, y: 10 }); // X（北）10m・Y（東）20m
        app.eval(`processCommand('@1000,-500');`); // 北へ 1m・西へ 0.5m
        const ln = app.val('entities[entities.length - 1]');
        assert.deepEqual([ln.x1, ln.y1, ln.x2, ln.y2], [20, 10, 19.5, 11]);
        // 座標は m のまま、長さだけ mm（測量でよく使う組み合わせ）
        app.eval(`resetCommand(); setDisplayPref('coordUnit', 'auto'); processCommand('LINE'); processCommand('10,20'); processCommand('@1000,0');`);
        const l2 = app.val('entities[entities.length - 1]');
        assert.deepEqual([l2.x1, l2.y1, l2.x2, l2.y2], [20, 10, 20, 11]);
    });

    it('オフセット: コマンド欄・設定の距離を表示の単位で受け取る', () => {
        app.eval(`setDisplayPref('lenUnit', 'mm'); processCommand('OFFSET'); processCommand('250');`);
        assert.equal(app.eval('cmdState.offsetDist'), 0.25);
        app.eval(`resetCommand(); lastParams.offset = '0.1'; processCommand('OFFSET');`);
        assert.match(panelHtml(), /距離\(mm\)/);
        assert.equal(panelInput('prop-offset-d'), '100');
        app.eval(`document.getElementById('prop-offset-d').value = '150'; applyOffsetPreset();`);
        assert.equal(app.eval('cmdState.offsetDist'), 0.15);
        assert.equal(app.eval('lastParams.offset'), '0.15');
    });

    it('円・長方形・文字の設定の数を表示の単位で出し、図面の単位で覚える', () => {
        app.eval(`setDisplayPref('lenUnit', 'mm'); lastParams.circleMode = 'auto'; lastParams.radius = '0.75'; processCommand('CIRCLE');`);
        assert.match(panelHtml(), /半径\(mm\)/);
        assert.equal(panelInput('prop-circle-r'), '750');
        app.eval(`document.getElementById('prop-circle-r').value = '1200'; applyCirclePreset();`);
        assert.equal(app.eval('lastParams.radius'), '1.2');
        assert.match(app.eval(`document.getElementById('dim-mode-toggle').textContent`), /半径:1200mm/);

        app.eval(`resetCommand(); processCommand('RECTANG');`);
        app.eval(`document.getElementById('prop-rect-w').value = '2000'; document.getElementById('prop-rect-h').value = '1000'; applyRectPreset();`);
        assert.deepEqual([app.eval('cmdState.presetW'), app.eval('cmdState.presetH')], [2, 1]);
        app.eval(`handlePointInput({x:0, y:0}, true);`);
        const r = app.val('entities[entities.length - 1]');
        assert.deepEqual([r.x2, r.y2], [2, 1]);

        app.eval(`resetCommand(); lastParams.textHeight = '0.25'; processCommand('TEXT');`);
        assert.equal(panelInput('prop-text-h'), '250');
        app.eval(`document.getElementById('prop-text-h').value = '350'; startTextPlacement();`);
        assert.equal(app.eval('cmdState.textHeight'), 0.35);
    });

    it('編集の設定（配列の間隔・フィレットの半径）も表示の単位', () => {
        app.eval(`setDisplayPref('lenUnit', 'mm'); lastParams.arrKind = 'rect'; lastParams.arrDX = '2.5'; lastParams.arrDY = '1'; _editArrayPanel();`);
        assert.equal(panelInput('edit-ar-dx'), '2500');
        assert.match(panelHtml(), /横の間隔\(mm\)/);
        app.eval(`editSetLenParam('arrDX', '1500')`);
        assert.equal(app.eval('lastParams.arrDX'), '1.5');
        app.eval(`editSetLenParam('arrDX', '')`); // 空欄はそのまま（入力の途中）
        assert.equal(app.eval('lastParams.arrDX'), '');
        // フィレット: コマンド欄の数も mm
        app.eval(`resetCommand(); lastParams.filletMode = 'fillet'; processCommand('FILLET'); processCommand('300');`);
        assert.equal(app.eval('lastParams.filletR'), '0.3');
        assert.equal(panelInput('edit-fl-r'), '300');
        assert.match(log(), /半径 300mm/);
    });

    it('相対入力パネル: 北へ・東へ・距離を長さの単位で入れる', () => {
        app.eval(`setDisplayPref('lenUnit', 'mm'); processCommand('LINE'); snapResult = { wcsX: 50, wcsY: 0, type: '端点' }; showRelativeInputPanel();`);
        assert.match(panelHtml(), /北へ X \(mm\)/);
        app.eval(`document.getElementById('rel-a').value = '2000'; document.getElementById('rel-b').value = '-500'; applyRelativeInput();`);
        const s = app.val('cmdState.startWcs');
        assert.ok(near(s.x, 49.5) && near(s.y, 2), JSON.stringify(s));
        assert.match(log(), /相対入力: 北へ 2000mm 東へ -500mm/);
    });

    it('プロパティ欄: 座標・長さを選んだ単位で出し、入れた数を図面の単位に直す', () => {
        app.eval(`entities.push({ type:'LINE', layer:0, color:null, x1:1.5, y1:2.25, x2:4, y2:6 });
                  entities.push({ type:'CIRCLE', layer:0, color:null, cx:10, cy:20, radius:0.75 });
                  cmdState.highlightIdx = 0; updatePropertiesPanel();`);
        const vals = () => app.val(`[...document.querySelectorAll('#props-content input.prop-val[type=number]')].map(i => i.value)`);
        assert.deepEqual(vals(), ['2.3', '1.5', '6.0', '4.0']); // 図面どおり: 以前と同じ（小数1桁）
        assert.equal(app.eval(`document.querySelector('#props-content .prop-unit-note')`), null);
        // 単位を変えると、開いているプロパティ欄もすぐ変わる
        app.eval(`setDisplayPref('coordUnit', 'mm')`);
        assert.deepEqual(vals(), ['2250.0', '1500.0', '6000.0', '4000.0']);
        assert.match(app.eval(`document.querySelector('#props-content .prop-unit-note').textContent`), /座標 mm・長さ m/);
        const id = app.eval('entities[0].id');
        app.eval(`changeEntityPropById(${id}, 'y1', '3000')`);
        assert.equal(app.eval('entities[0].y1'), 3);
        // 円の半径は長さの単位
        app.eval(`setDisplayPref('lenUnit', 'mm'); cmdState.highlightIdx = 1; updatePropertiesPanel();`);
        assert.deepEqual(vals().slice(-3), ['20000.0', '10000.0', '750.0']);
        const cid = app.eval('entities[1].id');
        app.eval(`changeEntityPropById(${cid}, 'radius', '1000')`);
        assert.equal(app.eval('entities[1].radius'), 1);
        // m を選ぶと小数3桁
        app.eval(`setDisplayPref('lenUnit', 'm')`);
        assert.equal(vals().slice(-1)[0], '1.000');
        app.eval('cmdState.highlightIdx = -1;');
    });

    it('オプション画面: 単位の行と、いまの単位の説明', () => {
        app.eval(`showOptionsPanel()`);
        const html = panelHtml();
        assert.match(html, /座標の単位/);
        assert.match(html, /長さの単位/);
        assert.match(html, /図面どおり/);
        const note = () => app.eval(`document.getElementById('opt-unit-note').textContent`);
        assert.match(note(), /いまは 1m/);
        assert.doesNotMatch(note(), /座標 m・長さ/);
        app.eval(app.eval(`document.querySelector('.opt-pref-btn[data-pref="lenUnit"][data-key="mm"]').getAttribute('onclick')`));
        assert.equal(app.eval(`displayPrefKey('lenUnit')`), 'mm');
        assert.match(note(), /座標 m・長さ mm/);
        assert.equal(app.eval(`document.querySelector('.opt-pref-btn.active[data-pref="lenUnit"]').textContent`), 'mm');
        app.eval(`resetDisplayPrefs()`);
        assert.equal(app.eval(`displayPrefKey('lenUnit')`), 'auto');
        assert.doesNotMatch(note(), /座標 m・長さ/);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
