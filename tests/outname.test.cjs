'use strict';
// 出力名（v5.41。cad-outname.js）:
//   図面ごとの出力名（☰「🏷 出力名」・OUTNAME）をすべての書き出しの名前のもとにする（保存・図面一式に入る、別のファイルで置き換えると消える）。
//   保存の前に名前の欄を出し、その回だけ変えられる（拡張子は自動。やめれば保存しない。オプションで聞かない）。
//   書き出す前の確認（SIMA など）は、確認の画面の名前の欄で決める
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('出力名（書き出すファイルの名前）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {}; outputNameSet(''); setDrawingName('genba.dxf');
            // 名前の欄を出す（ほかのテストでは出さない）。保存はファイル名を控える
            window.__cadNoOutNamePrompt = false; window.__asked = []; window.__answer = null;
            window.prompt = (m, v) => { window.__asked.push({ m, v }); return typeof window.__answer === 'function' ? window.__answer(v) : window.__answer; };
            window.__saved = []; window.__oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__saved.push(this.download); };
            window.URL.createObjectURL = () => 'blob:test'; window.URL.revokeObjectURL = () => {};`);
    });
    afterEach(() => app.eval(`window.__cadNoOutNamePrompt = true; window.prompt = () => null; HTMLAnchorElement.prototype.click = window.__oc;`));
    const saved = () => app.val('window.__saved');
    const log = () => app.val(`Array.from(document.getElementById('command-log').children).slice(-3).map(d => d.textContent).join('|')`);

    it('名前の決め方: 使えない文字は _・拡張子を打っても重ねない・空ならもとの名前', () => {
        assert.equal(app.val(`outNameClean(' a/b:c*d?. ')`), 'a_b_c_d_');
        assert.equal(app.val(`outNameFinal('現場A', 'genba.dxf')`), '現場A.dxf');
        assert.equal(app.val(`outNameFinal('現場A.DXF', 'genba.dxf')`), '現場A.dxf');
        assert.equal(app.val(`outNameFinal('   ', 'genba_写真台帳.pdf')`), 'genba_写真台帳.pdf');
        assert.equal(app.val(`outNameFinal('x', 'README')`), 'x');
    });

    it('保存の前に名前の欄（今の名前が入っている）。変えればその名前、やめれば保存しない。オプションで聞かない', async () => {
        app.eval(`window.__answer = 'genba_最終';`);
        assert.equal(await app.eval(`downloadBlob(new Blob(['x']), 'genba.dxf')`), 'genba_最終.dxf');
        assert.deepEqual(saved(), ['genba_最終.dxf']);
        assert.equal(app.val('window.__asked[0].v'), 'genba', '拡張子を除いた今の名前');
        assert.match(app.val('window.__asked[0].m'), /拡張子「\.dxf」は自動で付きます/);
        // やめる
        app.eval(`window.__answer = null;`);
        assert.equal(await app.eval(`downloadBlob(new Blob(['x']), 'genba.sim')`), null);
        assert.deepEqual(saved(), ['genba_最終.dxf'], '保存しない');
        assert.match(log(), /genba\.sim の書き出しをやめました/);
        // オプション「書き出すときの名前」を「聞かない」
        app.eval(`setDisplayPref('outName', 'no'); window.__asked = [];`);
        assert.equal(await app.eval(`downloadBlob(new Blob(['x']), 'genba.csv')`), 'genba.csv');
        assert.equal(app.val('window.__asked.length'), 0);
        // 名前が決まっている保存（書き出す前の確認・送れなかった PDF）は聞かない
        app.eval(`setDisplayPref('outName', 'ask');`);
        assert.equal(await app.eval(`downloadBlob(new Blob(['x']), 'a.sim', undefined, { named: true })`), 'a.sim');
        assert.equal(app.val('window.__asked.length'), 0);
    });

    it('DXF・画面の画像は、名前の欄で決めた名前で保存し、その名前を知らせる', async () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }); ensureEntityIds(); window.__answer = '提出用';`);
        app.eval('exportDxf()');
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(saved(), ['提出用.dxf']);
        assert.match(log(), /DXF を書き出しました: 提出用\.dxf/);
        app.eval(`window.__answer = null;`);
        app.eval('exportDxfJw()');
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(saved(), ['提出用.dxf'], 'やめたら保存しない');
        assert.doesNotMatch(log(), /Jw_cad 向け.*を書き出しました/);
    });

    it('図面ごとの出力名: ☰「🏷 出力名」で決めると、すべての書き出しの名前のもと。空にすると図面の名前', async () => {
        app.eval(`window.__answer = '現場A_平面図';`);
        await app.eval('showOutputNamePanel()');
        assert.equal(app.val('outputNameGet()'), '現場A_平面図');
        assert.equal(app.val(`exportFileName('dxf')`), '現場A_平面図.dxf');
        assert.equal(app.val('_baseName()'), '現場A_平面図');
        // 書き出す前の確認の名前の欄にも
        app.eval(`addSurveyData([{ num: '1', name: 'K1', X: 10, Y: 20, z: null }], []); exportSima();`);
        assert.equal(app.eval(`document.getElementById('xp-name').value`), '現場A_平面図');
        app.eval('exportPreviewCancel()');
        // 空にすると外れる
        app.eval(`window.__answer = '';`);
        await app.eval('showOutputNamePanel()');
        assert.equal(app.val('outputNameGet()'), null);
        assert.equal(app.val(`exportFileName('dxf')`), 'genba.dxf');
        // ☰ のボタン・お気に入り・コマンド・コマンド一覧
        assert.ok(app.val(`!!document.querySelector('[data-fav="OUTNAME"]')`));
        assert.ok(app.val(`FAV_CATALOG.some(d => d.id === 'OUTNAME')`));
        app.eval(`window.__answer = 'B'; processCommand('OUTNAME');`);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(app.val('outputNameGet()'), 'B');
        assert.ok(app.val(`GUIDE_COMMANDS.flatMap(([, l]) => l).some(([c]) => c === 'OUTNAME')`));
    });

    it('書き出す前の確認の名前の欄: 変えた名前で書き出す（拡張子は重ねない）', () => {
        app.eval(`addSurveyData([{ num: '1', name: 'K1', X: 10, Y: 20, z: null }], []); window.__names = []; window.__dl0 = downloadBlob;
            downloadBlob = (b, n, s, o) => { window.__names.push([n, !!(o && o.named)]); return Promise.resolve(n); };`);
        try {
            app.eval(`exportSima(); exportPreviewName('境界_最終.sim'); exportPreviewTab('text'); exportPreviewTab('table');`);
            assert.equal(app.eval(`document.getElementById('xp-name').value`), '境界_最終.sim', '切り替えても打った名前のまま');
            app.eval('exportPreviewWrite()');
            app.eval(`exportCoordCsv(); exportPreviewName(''); exportPreviewWrite();`);
            assert.deepEqual(app.val('window.__names'), [['境界_最終.sim', true], ['genba_座標.csv', true]], '確認の画面で決めたので、もう聞かない');
        } finally { app.eval('downloadBlob = window.__dl0;'); }
    });

    it('保存・図面一式に入り、開くと戻る。図面を閉じる・別のファイルで置き換えると消え、読めなかったら戻る', async () => {
        app.eval(`outputNameSet('現場A');`);
        const d = app.val(`_buildSaveData('t')`);
        assert.equal(d.outputName, '現場A');
        app.eval(`outputNameSet(''); applyProjectData(${JSON.stringify(d)});`);
        assert.equal(app.val('outputNameGet()'), '現場A');
        // 図面一式（受け取ったものの確かめでも残る）
        assert.equal(app.val(`sanitizeWebcadProject(${JSON.stringify(d)}).outputName`), '現場A');
        // 以前の保存データ（出力名なし）を開くと無し
        app.eval(`{ const d0 = _buildSaveData('t'); delete d0.outputName; applyProjectData(d0); }`);
        assert.equal(app.val('outputNameGet()'), null);
        // 図面を閉じる
        app.eval(`outputNameSet('X'); _closeDrawingNow();`);
        assert.equal(app.val('outputNameGet()'), null);
        // 置き換えで開く → 消える。読めなかったら元の図面の出力名に戻る
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 0 }); ensureEntityIds(); outputNameSet('元の図面');
            window.__cf0 = window.confirm; window.confirm = () => true;`);
        try { assert.equal(app.val('_prepareImportTarget()'), 'replace'); } finally { app.eval('window.confirm = window.__cf0;'); }
        assert.equal(app.val('outputNameGet()'), null);
        assert.equal(app.val('_restoreAfterFailedImport()'), true);
        assert.equal(app.val('outputNameGet()'), '元の図面');
        assert.deepEqual(app.errors(), []);
    });
});
