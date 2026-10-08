'use strict';
// 座標CSV の列の割り当て（v5.32）: 開くと、プレビューを見ながら列を選ぶ画面を出す。X・Y の入れ替え・区切り（空白も）・見出しの行の数を変えられ、
// 「取り込む」を押してから置き換え・追加を聞く（やめても図面は変わらない）。見出しの無いファイルの割り当ては覚えて、次の同じ形のファイルで使う
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('座標CSV の列の割り当て', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => app.eval(`localStorage.removeItem('cad_csv_map'); localStorage.setItem('cad_survey_unit', 'm'); entities.length = 0;
        layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); hidePropertyPanel(); commandLog.innerHTML = '';`));

    const open = async (text, name) => {
        app.window.__text = text;
        await app.eval(`loadCoordCsvFile(new File([window.__text], ${JSON.stringify(name || 'pts.csv')}))`);
    };
    const panel = () => app.val(`(() => { const p = document.getElementById('property-panel');
        return { shown: p.style.display !== 'none', title: document.getElementById('property-panel-title').textContent,
            roles: [...p.querySelectorAll('select.csv-role')].map(s => s.value), result: (p.querySelector('#csv-result') || {}).textContent || '',
            disabled: !!(p.querySelector('.cogo-btns .prop-btn') || {}).disabled, html: p.innerHTML }; })()`);
    const points = () => app.val(`collectSurveyPoints().map(p => { const s = wcsToSurvey(p.x, p.y); return [p.name, Math.round(s.X * 1000) / 1000, Math.round(s.Y * 1000) / 1000, p.z]; })`);

    it('開くと列の割り当ての画面を出し（図面はまだ変えない）、「取り込む」で測点にする', async () => {
        await open('点名,X,Y,標高\r\nKP1,100.1,200.2,10.5\r\nKP2,101,201,\r\n');
        const p = panel();
        assert.equal(p.title, '📥 座標CSV の列');
        assert.deepEqual(p.roles, ['name', 'X', 'Y', 'Z']);
        assert.match(p.result, /取り込む点: 2点/);
        assert.equal(app.val('entities.length'), 0, '取り込む前に図面を変えた');
        app.eval('csvMapImport()');
        assert.deepEqual(points(), [['KP1', 100.1, 200.2, 10.5], ['KP2', 101, 201, null]]);
        assert.equal(app.val(`document.getElementById('property-panel').style.display`), 'none');
        assert.equal(app.val('window._drawingName'), 'pts.csv');
    });

    it('X と Y を入れ替える・列の役割を選ぶ・区切りと見出しの行を変えると、プレビューも変わる', async () => {
        await open('A 200.5 100.25 3\nB 201 101 4\n', 'en.txt');
        assert.deepEqual(panel().roles, ['name', 'X', 'Y', 'Z'], '空白区切りを自動で分ける');
        app.eval('csvMapSwap()');
        assert.deepEqual(panel().roles, ['name', 'Y', 'X', 'Z']);
        assert.match(panel().result, /A\u3000X 100\.250\u3000Y 200\.500\u3000標高 3\.000/);
        app.eval(`csvMapRole(3, 'skip')`);
        assert.doesNotMatch(panel().result, /標高/, '使わない列を取り込んでいる');
        app.eval(`csvMapHeader('1')`);
        assert.match(panel().result, /取り込む点: 1点/);
        app.eval(`csvMapHeader('0'); csvMapImport()`);
        assert.deepEqual(points(), [['A', 100.25, 200.5, null], ['B', 101, 201, null]]);
    });

    it('X・Y が無い・同じ役割が2つのときは取り込めず、理由を出す。やめたら何も変えない', async () => {
        await open('KP1,100,200\n');
        app.eval(`csvMapRole(1, 'skip')`);
        let p = panel();
        assert.equal(p.disabled, true);
        assert.match(p.html, /X と Y の列を選んでください/);
        app.eval(`csvMapRole(1, 'Y')`);
        p = panel();
        assert.equal(p.disabled, true);
        assert.match(p.html, /同じ役割を2つの列に選んでいます/);
        app.eval('csvMapCancel()');
        assert.equal(app.val('entities.length'), 0);
        assert.match(app.val('commandLog.textContent'), /取り込みをやめました/);
    });

    it('見出しの無いファイルで選んだ割り当ては覚えて、次の同じ形（列の数・区切り）のファイルで使う', async () => {
        await open('P1,200,100\nP2,201,101\n');
        app.eval('csvMapSwap(); csvMapImport();');
        assert.deepEqual(points().map((q) => q.slice(1, 3)), [[100, 200], [101, 201]]);
        app.eval(`entities.length = 0;`);
        await open('P3,300,150\n');
        assert.deepEqual(panel().roles, ['name', 'Y', 'X'], '前の割り当てを使っていない');
        // 見出しに名前があるファイルは、名前のほうを使う
        await open('点名,X,Y\nP4,1,2\n');
        assert.deepEqual(panel().roles, ['name', 'X', 'Y']);
    });

    it('プレビューの文字はそのまま表示する（HTML として読まない）', async () => {
        await open('<img src=x onerror="window.__xss=1">,100,200\n');
        assert.equal(app.val(`document.querySelector('#property-panel img')`), null);
        assert.equal(app.val('window.__xss'), undefined);
        assert.match(app.val(`document.getElementById('property-panel').textContent`), /<img src=x/);
    });

    it('📁開く で .csv・.txt を選ぶと、置き換え・追加を聞く前に列の画面を出す', () => {
        app.eval(`window.__calls = []; window.__ol = window.loadCoordCsvFile; window.__pt = window._prepareImportTarget;
            window.loadCoordCsvFile = (f) => window.__calls.push('csv:' + f.name); window._prepareImportTarget = () => window.__calls.push('target');`);
        try {
            app.eval(`(() => { const inp = document.getElementById('dxf-file-input'); Object.defineProperty(inp, 'files', { configurable: true, value: [{ name: '基準点.CSV' }] });
                inp.dispatchEvent(new window.Event('change')); delete inp.files; })()`);
            assert.deepEqual(app.val('window.__calls'), ['csv:基準点.CSV']);
        } finally { app.eval('window.loadCoordCsvFile = window.__ol; window._prepareImportTarget = window.__pt;'); }
    });

    it('図面の単位が mm でも、CSV の値は m として取り込む', async () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm');`);
        await open('KP1,1.5,2.25\n');
        app.eval('csvMapImport()');
        const e = app.val(`entities.find(e => e.type === 'POINT')`);
        assert.ok(near(e.x, 2250) && near(e.y, 1500));
    });
});
