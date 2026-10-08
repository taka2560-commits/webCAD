'use strict';
// 線種・線の太さ（v5.27）: DXF・DWG の取り込み（線種表・LTSCALE・画層の線種と太さ・図形ごと・BYBLOCK）、画面の点線と太さ、
// 印刷（PDF）の点線と太さ、DXF への書き出しと読み直し、プロパティ・画層の変更、保存と復元、コマンド（LTSCALE・LWDISPLAY）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

const sec = (name, ...items) => [['0', 'SECTION'], ['2', name], ...items.flat(), ['0', 'ENDSEC']];
const dxfText = (...sections) => [...sections.flat(), ['0', 'EOF']].map(([c, v]) => `${c}\n${v}`).join('\n');
const ent = (type, ...pairs) => [['0', type], ...pairs];
const DXF = dxfText(
    sec('HEADER', [['9', '$LTSCALE'], ['40', '50'], ['9', '$INSUNITS'], ['70', '4']]),
    sec('TABLES',
        ent('TABLE', ['2', 'LTYPE'], ['70', '1']),
        ent('LTYPE', ['2', 'CENTER2'], ['70', '0'], ['3', 'Center (.5x)'], ['72', '65'], ['73', '4'], ['40', '28.575'], ['49', '19.05'], ['74', '0'], ['49', '-3.175'], ['74', '0'], ['49', '3.175'], ['74', '0'], ['49', '-3.175'], ['74', '0']),
        ent('ENDTAB'),
        ent('TABLE', ['2', 'LAYER'], ['70', '2']),
        ent('LAYER', ['2', '中心線'], ['70', '0'], ['62', '1'], ['6', 'CENTER2'], ['370', '50']),
        ent('LAYER', ['2', '0'], ['70', '0'], ['62', '7'], ['6', 'CONTINUOUS']),
        ent('ENDTAB')),
    sec('BLOCKS',
        ent('BLOCK', ['8', '0'], ['2', 'SYM'], ['70', '0'], ['10', '0'], ['20', '0'], ['30', '0'], ['3', 'SYM']),
        ent('LINE', ['8', '0'], ['6', 'BYBLOCK'], ['370', '-2'], ['10', '0'], ['20', '0'], ['11', '1'], ['21', '0']),
        ent('ENDBLK', ['8', '0'])),
    sec('ENTITIES',
        ent('LINE', ['8', '中心線'], ['10', '0'], ['20', '0'], ['11', '1000'], ['21', '0']),
        ent('LINE', ['8', '0'], ['6', 'DASHED'], ['370', '35'], ['48', '2'], ['10', '0'], ['20', '100'], ['11', '1000'], ['21', '100']),
        ent('INSERT', ['8', '0'], ['6', 'HIDDEN'], ['370', '70'], ['2', 'SYM'], ['10', '0'], ['20', '200'], ['30', '0'])));

function importDxf(app, text) {
    app.window.__t = text;
    app.eval(`(() => {
        entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true });
        drawingLineTypes = {}; drawingLtscale = null; _importMode = 'fresh';
        const p = new window.DxfParser(); registerExtraDxfHandlers(p, window.__t);
        importDxfData(p.parseSync(window.__t), { skipUndo: true, text: window.__t });
    })()`);
}
const lineOn = (app, layerName, y) => app.val(`entities.find(e => e.type === 'LINE' && layers[e.layer].name === ${JSON.stringify(layerName)} && Math.abs(e.y1 - ${y}) < 1e-9)`);

describe('線種・線の太さ', () => {
    let app;
    before(async () => { app = await loadApp(); importDxf(app, DXF); });
    after(() => app.close());

    it('DXF: 線種表・LTSCALE・画層の線種と太さ（画層表の 6・370）・図形の線種と太さと尺度・BYBLOCK はブロック参照の値', () => {
        assert.deepEqual(app.val(`drawingLineTypes.CENTER2.d`), [19.05, -3.175, 3.175, -3.175]);
        assert.equal(app.val('drawingLtscale'), 50);
        const L = app.val(`layers.find(l => l.name === '中心線')`);
        assert.equal(L.lt, 'CENTER2'); assert.equal(L.lw, 50);
        assert.equal(app.val(`layers.find(l => l.name === '0').lt`), undefined, 'CONTINUOUS の画層は線種を持たない');
        const a = lineOn(app, '中心線', 0);
        assert.equal(a.lt, undefined, '画層に従う図形は線種を持たない');
        assert.equal(app.eval(`effectiveLinetype(entities.find(e => e.type === 'LINE' && layers[e.layer].name === '中心線'))`), 'CENTER2');
        const b = lineOn(app, '0', 100);
        assert.equal(b.lt, 'DASHED'); assert.equal(b.lw, 35); assert.equal(b.ltScale, 2);
        const c = lineOn(app, '0', 200);
        assert.equal(c.lt, 'HIDDEN', 'BYBLOCK の線は、ブロック参照の線種'); assert.equal(c.lw, 70);
    });

    it('DWG: 線種表（模様の要素）・LTSCALE・画層の線種（引き直した名前）と太さ（番号）・図形の値・ByBlock', () => {
        app.window.__db = {
            header: { LTSCALE: 25 },
            __layerLt: { 境界: 'DASHED2' },
            tables: {
                LAYER: { entries: [{ name: '境界', colorIndex: 1, lineweight: 9, lineType: '' }, { name: '0', colorIndex: 7, lineweight: 31, lineType: '' }] },
                LTYPE: { entries: [{ name: 'DASHED2', description: 'Dashed (.5x)', pattern: [{ elementLength: 6.35 }, { elementLength: -3.175 }] }] },
                BLOCK_RECORD: { entries: [{ name: 'B', handle: '30', entities: [{ type: 'LINE', layer: '0', lineType: 'ByBlock', lineweight: 30, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } }] }] },
            },
            entities: [
                { type: 'LINE', layer: '境界', lineType: '', lineweight: 29, startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } },
                { type: 'LINE', layer: '0', lineType: 'CENTER', lineweight: 11, lineTypeScale: 0.5, startPoint: { x: 0, y: 5 }, endPoint: { x: 10, y: 5 } },
                { type: 'INSERT', layer: '0', name: 'B', lineType: 'PHANTOM', lineweight: 7, insertionPoint: { x: 0, y: 9 } },
            ],
        };
        const r = app.val(`(() => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); drawingLineTypes = {}; drawingLtscale = null; _importMode = 'fresh'; return convertDwgDatabaseToApp(window.__db).entities; })()`);
        assert.deepEqual(app.val('drawingLineTypes.DASHED2.d'), [6.35, -3.175]);
        assert.equal(app.val('drawingLtscale'), 25);
        const L = app.val(`layers.find(l => l.name === '境界')`);
        assert.equal(L.lt, 'DASHED2'); assert.equal(L.lw, 35, '番号 9 は 0.35mm');
        assert.equal(app.val(`layers.find(l => l.name === '0').lw`), undefined, '番号 31（既定）は持たない');
        assert.equal(r[0].lt, undefined); assert.equal(r[0].lw, undefined);
        assert.equal(r[1].lt, 'CENTER'); assert.equal(r[1].lw, 50); assert.equal(r[1].ltScale, 0.5);
        assert.equal(r[2].lt, 'PHANTOM', 'ByBlock の線は、ブロック参照の線種'); assert.equal(r[2].lw, 25, '番号 7 は 0.25mm');
        importDxf(app, DXF);
    });

    it('線種の尺度の既定: m の図面 0.5・mm の図面 500（1/500 の用紙で模様が mm どおり）。標準の線種は 2（半分）・X2（2倍）も分かる', () => {
        app.eval(`drawingLtscale = null; localStorage.setItem('cad_survey_unit', 'm');`);
        assert.equal(app.eval('getDrawingLtscale()'), 0.5);
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm');`);
        assert.equal(app.eval('getDrawingLtscale()'), 500);
        assert.deepEqual(app.val(`ltypePattern('HIDDEN2')`), [3.175, -1.5875]);
        assert.deepEqual(app.val(`ltypePattern('CENTERX2')`), [63.5, -12.7, 12.7, -12.7]);
        assert.equal(app.val(`ltypePattern('CONTINUOUS')`), null);
        assert.equal(app.eval(`ltypeLabel('CENTER')`), '一点鎖線（CENTER）');
        importDxf(app, DXF);
    });

    it('画面: 線種の模様 × LTSCALE × 図形の尺度 × 表示の倍率を点線にする。細かすぎると実線。線の太さは mm × 4px', () => {
        app.eval('view.scale = 0.02;'); // 1px = 50 図面単位
        const st = (y) => app.val(`(() => { const s = makeLineStyler(); return s(entities.find(e => e.type === 'LINE' && Math.abs(e.y1 - ${y}) < 1e-9)); })()`);
        // 中心線: CENTER2 × 50 × 0.02 = [19.05, 3.175, 3.175, 3.175]
        const a = st(0);
        assert.ok(a.dash && a.dash.length === 4 && near(a.dash[0], 19.05, 1e-9) && near(a.dash[1], 3.175, 1e-9), JSON.stringify(a));
        assert.equal(a.w, 2, '0.50mm → 2px');
        // DASHED（12.7, -6.35）× 50 × 2 × 0.02
        const b = st(100);
        assert.ok(near(b.dash[0], 25.4, 1e-9) && near(b.dash[1], 12.7, 1e-9)); assert.ok(near(b.w, 1.4, 1e-9));
        app.eval('view.scale = 0.0001;');
        assert.equal(st(0).dash, null, '模様が画面で細かすぎるときは実線');
        app.eval(`setShowLineweights(false); view.scale = 0.02;`);
        assert.equal(st(0).w, 1, '線の太さを表示しないときは 1px');
        app.eval('setShowLineweights(true)');
    });

    it('画面: まとめて描くときに点線と太さを切り替える（setLineDash に模様が渡る）', () => {
        app.eval(`window.__dashes = []; window.__oSD = ctx.setLineDash; ctx.setLineDash = (a) => window.__dashes.push(a.slice()); view.scale = 0.02; zoomExtents(); view.scale = 0.02;`);
        try { app.eval('_drawFrame(false)'); } finally { app.eval('ctx.setLineDash = window.__oSD;'); }
        const ds = app.val('window.__dashes');
        assert.ok(ds.some((d) => d.length === 4 && near(d[0], 19.05, 1e-6)), JSON.stringify(ds.slice(0, 6)));
        assert.ok(ds.some((d) => d.length === 0), '実線に戻すことがある');
        assert.deepEqual(app.errors(), []);
    });

    it('印刷（PDF）: 点線（[…] 0 d）と線の太さ（mm）', () => {
        const pg = app.val(`(() => { entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 300, x2: 1000, y2: 300 }); entities.forEach(e => { e.bbox = calcBBox(e); }); return printCompose({ paper: 'A3', orient: 'land', scale: 100, color: 'color' }, { x: 500, y: 100 }, 0, { title: 'T' }); })()`);
        assert.match(pg.content, /\[[0-9. ]+\] 0 d/);
        assert.match(pg.content, /\n1\.417 w\n/, '0.50mm の線（1.417pt）');
        assert.match(pg.content, /\[\] 0 d/, '実線に戻す');
    });

    it('DXF の書き出し: 線種表・画層の線種・図形の線種と太さと尺度・LTSCALE。読み直すと同じ', () => {
        app.eval(`window.downloadBlob = () => {}; window.__OB = window.Blob; window.Blob = function (parts, opt) { window.__parts = parts; return new window.__OB(parts, opt); }; exportDxf(); window.Blob = window.__OB;`);
        const out = app.val('window.__parts.join("")');
        assert.match(out, /LTYPE\r?\n\s*5\r?\n[0-9A-F]+[\s\S]*?\n\s*2\r?\nCENTER2\r?\n/);
        assert.match(out, /\$LTSCALE\r?\n\s*40\r?\n50\r?\n/);
        importDxf(app, out);
        assert.equal(app.val(`layers.find(l => l.name === '中心線').lt`), 'CENTER2');
        const b = lineOn(app, '0', 100);
        assert.equal(b.lt, 'DASHED'); assert.equal(b.lw, 35); assert.equal(b.ltScale, 2);
        assert.equal(app.val('drawingLtscale'), 50);
        assert.deepEqual(app.val('drawingLineTypes.CENTER2.d'), [19.05, -3.175, 3.175, -3.175]);
    });

    it('プロパティ: 図形の線種・太さ・尺度を変え、空で「画層に従う」に戻す。画層の線種・太さも変えられる', () => {
        app.eval(`cmdState.highlightIdx = entities.findIndex(e => e.type === 'LINE' && layers[e.layer].name === '中心線'); updatePropertiesPanel();`);
        const html = app.eval(`document.getElementById('props-content').innerHTML`);
        assert.match(html, /線種/); assert.match(html, /線の太さ/); assert.match(html, /画層の線/);
        const id = app.eval('entities[cmdState.highlightIdx].id');
        app.eval(`changeEntityPropById(${id}, 'lt', 'PHANTOM'); changeEntityPropById(${id}, 'lw', '100'); changeEntityPropById(${id}, 'ltScale', '3');`);
        let e = app.val('entities[cmdState.highlightIdx]');
        assert.equal(e.lt, 'PHANTOM'); assert.equal(e.lw, 100); assert.equal(e.ltScale, 3);
        app.eval(`changeEntityPropById(${id}, 'lt', ''); changeEntityPropById(${id}, 'lw', '');`);
        e = app.val('entities[cmdState.highlightIdx]');
        assert.equal(e.lt, undefined); assert.equal(e.lw, undefined);
        app.eval(`changeLayerLinetype(entities[cmdState.highlightIdx].layer, 'DOT'); changeLayerLineweight(entities[cmdState.highlightIdx].layer, '18');`);
        assert.equal(app.eval(`effectiveLinetype(entities[cmdState.highlightIdx])`), 'DOT');
        assert.equal(app.eval(`effectiveLineweight(entities[cmdState.highlightIdx])`), 18);
        app.eval(`changeLayerLinetype(entities[cmdState.highlightIdx].layer, 'CONTINUOUS')`);
        assert.equal(app.eval(`effectiveLinetype(entities[cmdState.highlightIdx])`), null);
        // 画層管理の行に線種の選択がある
        app.eval('showLayerManagerPanel()');
        assert.ok(app.eval(`document.querySelectorAll('#property-panel-content select.lm-lt').length`) >= 2);
    });

    it('保存と復元: 線種表と線種の尺度も図面と一緒に戻る。置き換えで開くと新しいファイルのものになる', () => {
        app.eval(`drawingLtscale = 77; window.__st = JSON.parse(JSON.stringify(_buildSaveData('t'))); drawingLineTypes = {}; drawingLtscale = null; applyProjectData(window.__st);`);
        assert.equal(app.val('drawingLtscale'), 77);
        assert.ok(app.val('drawingLineTypes.CENTER2'));
        app.eval('_clearForReplace()');
        assert.deepEqual(app.val('drawingLineTypes'), {}); assert.equal(app.val('drawingLtscale'), null);
    });

    it('コマンド: LWDISPLAY で線の太さの表示を切り替える。LTSCALE は 0 より大きい数だけ', () => {
        const before0 = app.val('showLineweights');
        app.eval(`processCommand('LWDISPLAY')`);
        assert.equal(app.val('showLineweights'), !before0);
        app.eval(`processCommand('LWDISPLAY')`);
        assert.equal(app.val('setDrawingLtscale("0")'), false);
        assert.equal(app.val('setDrawingLtscale("2.5")'), true); assert.equal(app.val('drawingLtscale'), 2.5);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
