'use strict';
// DWG 取り込み（convertDwgDatabaseToApp）のテスト。
// 実際の DWG ファイルの代わりに、libredwg-web の convert() が返すのと同じ形のデータを与える。
// （DWG の角度はラジアン。ブロック基点・入れ子・属性・画層の対応付けを確認する）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

const DB = {
    tables: {
        LAYER: {
            entries: [
                { name: '0', colorIndex: 7 },
                { name: '道路', colorIndex: 1 },
                { name: '非表示', colorIndex: 3, off: true },
            ],
        },
        BLOCK_RECORD: {
            entries: [
                {
                    name: 'SYM',
                    basePoint: { x: 5, y: 5 },
                    entities: [
                        { type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } },
                        { type: 'INSERT', name: 'INNER', layer: '0', insertionPoint: { x: 2, y: 0 } },
                    ],
                },
                { name: 'INNER', entities: [{ type: 'CIRCLE', layer: '0', center: { x: 0, y: 0 }, radius: 1 }] },
            ],
        },
    },
    entities: [
        {
            type: 'INSERT', name: 'SYM', layer: '0', insertionPoint: { x: 100, y: 100 }, xScale: 2, yScale: 2, rotation: Math.PI / 2,
            attributes: [{ text: 'KP-1', insertionPoint: { x: 100, y: 110 }, textHeight: 2, layer: '0' }],
        },
        { type: 'LINE', layer: '道路', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
        { type: 'ARC', layer: '道路', center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2 },
        // libredwg-web の LWPOLYLINE の flag: 512 が「閉じている」（1 は法線あり）
        { type: 'LWPOLYLINE', layer: '非表示', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10 }], flag: 512 },
        { type: 'TEXT', layer: '道路', text: '測点A', insertionPoint: { x: 5, y: 5 }, height: 3, rotation: Math.PI / 4 },
        { type: 'ATTRIB', layer: '0', text: '隠し', insertionPoint: { x: 0, y: 0 }, flags: 1 },
        { type: 'UNSUPPORTED_THING', layer: '0' },
    ],
};

describe('DWG取り込み: convertDwgDatabaseToApp', () => {
    let app;
    let ents;
    before(async () => {
        app = await loadApp();
        // 既存の画層がある状態で取り込む（以前は既存画層と重複すると割り当てがずれていた）
        app.eval(`
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }, { name: '既存', color: '#ffffff', visible: true }, { name: '道路', color: '#ffffff', visible: true });
            setImportHideArcs(true);
        `);
        app.window.__db = DB;
        ents = app.val('convertDwgDatabaseToApp(window.__db).entities');
    });
    after(() => app.close());

    const layerIndex = (name) => app.eval(`layers.findIndex(l => l.name === ${JSON.stringify(name)})`);

    it('ブロック基点・回転・縮尺を考慮して配置する', () => {
        const line = ents.find((e) => e.type === 'LINE' && e.blockName === 'SYM');
        assert.ok(near(line.x1, 110) && near(line.y1, 90), `始点 (${line.x1}, ${line.y1})`);
        assert.ok(near(line.x2, 110) && near(line.y2, 110), `終点 (${line.x2}, ${line.y2})`);
    });

    it('入れ子ブロックに親の回転・縮尺が引き継がれる', () => {
        const c = ents.find((e) => e.type === 'CIRCLE');
        assert.ok(near(c.cx, 110) && near(c.cy, 94), `中心 (${c.cx}, ${c.cy})`);
        assert.ok(near(c.radius, 2));
    });

    it('INSERT の属性は同じグループの文字になり、不可視の属性は除外する', () => {
        const sym = ents.filter((e) => e.blockName === 'SYM');
        assert.equal(new Set(sym.map((e) => e.gid)).size, 1);
        const attr = sym.find((e) => e.type === 'TEXT');
        assert.equal(attr.text, 'KP-1');
        assert.ok(near(attr.x, 100) && near(attr.y, 110));
        assert.ok(!ents.some((e) => e.text === '隠し'));
    });

    it('既存の画層と名前で対応付け、新しい画層は追加する', () => {
        const road = ents.find((e) => e.type === 'LINE' && !e.blockName);
        assert.equal(road.layer, layerIndex('道路'));
        assert.equal(layerIndex('道路'), 2, '既存の「道路」画層を使うはず');
        const pl = ents.find((e) => e.type === 'PLINE');
        assert.equal(pl.layer, layerIndex('非表示'));
        assert.equal(app.eval(`layers[${layerIndex('非表示')}].visible`), false, 'オフの画層は非表示で追加');
    });

    it('ARC の角度（ラジアン）をそのまま使う', () => {
        const arc = ents.find((e) => e.type === 'ARC');
        assert.ok(near(arc.startAngle, 0) && near(arc.endAngle, Math.PI / 2), `角度 ${arc.startAngle}〜${arc.endAngle}`);
        assert.equal(arc.hidden, true);
    });

    it('閉じたポリラインと文字の回転を取り込む', () => {
        const pl = ents.find((e) => e.type === 'PLINE');
        assert.equal(pl.closed, true);
        assert.equal(pl.points.length, 3);
        const t = ents.find((e) => e.text === '測点A');
        assert.ok(near(t.rotation, Math.PI / 4));
        assert.ok(near(t.height, 3));
    });

    it('未対応の図形は読み飛ばし、全体は失敗しない', () => {
        assert.equal(ents.length, 7);
        assert.deepEqual(app.errors(), []);
    });
});

// 閉じたポリラインの判定（libredwg-web の flag）。
// 以前は LWPOLYLINE も flag の 1 で判定していたため、DWG の閉じた四角形の閉じる辺（左上から描いた長方形では左の辺）が消えていた
describe('DWG取り込み: 閉じたポリライン（四角形の左の辺が消える不具合）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    const RECT = [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 }]; // 左上 → 右上 → 右下 → 左下
    function convert(entities) {
        app.window.__db2 = { tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] } }, entities };
        return app.val('convertDwgDatabaseToApp(window.__db2).entities');
    }

    it('LWPOLYLINE の flag 512 は閉じた形（4辺とも描く）。256（線種の連続）が付いていても同じ', () => {
        const [a, b] = convert([
            { type: 'LWPOLYLINE', layer: '0', vertices: RECT, flag: 512 },
            { type: 'LWPOLYLINE', layer: '0', vertices: RECT, flag: 768 },
        ]);
        for(const pl of [a, b]) {
            assert.equal(pl.type, 'PLINE');
            assert.equal(pl.closed, true, '閉じる辺（左下→左上＝左の辺）を描く');
            assert.equal(pl.points.length, 4);
        }
    });

    it('LWPOLYLINE の flag 1（法線あり）や 0 は開いた線のまま（勝手に閉じない）', () => {
        const [a, b] = convert([
            { type: 'LWPOLYLINE', layer: '0', vertices: RECT.slice(0, 3), flag: 1 },
            { type: 'LWPOLYLINE', layer: '0', vertices: RECT.slice(0, 3), flag: 0 },
        ]);
        assert.equal(a.closed, false);
        assert.equal(b.closed, false);
    });

    it('POLYLINE2D の flag は DXF と同じく 1 が閉じた形', () => {
        const [a, b] = convert([
            { type: 'POLYLINE2D', layer: '0', vertices: RECT, flag: 1 },
            { type: 'POLYLINE2D', layer: '0', vertices: RECT, flag: 0 },
        ]);
        assert.equal(a.closed, true);
        assert.equal(b.closed, false);
    });

    it('閉じた四角形は、画面でも左の辺を描く（最後の点から最初の点へ閉じる）', () => {
        app.eval(`entities.length = 0; view = { x: 100, y: 300, scale: 10, rotation: 0 };`);
        app.window.__db3 = { tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] } }, entities: [{ type: 'LWPOLYLINE', layer: '0', vertices: RECT, flag: 512 }] };
        app.eval(`convertDwgDatabaseToApp(window.__db3).entities.forEach(e => entities.push(e)); _bumpGeomEpoch();`);
        app.eval(`window.__cp = 0; ctx.closePath = () => window.__cp++;`);
        try { app.eval('_drawFrame(false)'); } finally { app.eval('delete ctx.closePath'); }
        assert.ok(app.eval('window.__cp') >= 1, '閉じた形として描く');
        // 左の辺（x=0 の縦の線）の上をタップすると、その四角形を選べる
        const hit = app.eval(`(() => { const s = wcsToScreen(0, 5); return hitTestEntity(s.x, s.y); })()`);
        assert.equal(hit, 0);
        assert.deepEqual(app.errors(), []);
    });
});

// 図面の単位: 開いた DWG・DXF の単位（INSUNITS: 4＝mm、6＝m）に「図面の1単位」を合わせる。
// 以前は DWG の単位を見ておらず、mm の図面でも 1m のまま座標寸法を「29510.405」（0.001mm まで）と出していた
describe('DWG・DXF を開いたとき、図面の単位に合わせる', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    const toast = () => app.eval(`document.getElementById('cad-toast').textContent`);
    const log = () => app.eval(`document.getElementById('command-log').textContent`);
    // DWG 読込エンジンの代わり（libredwg-web の convert() と同じ形を返す）
    function mockEngine(insunits) {
        app.window.__dwgDb = {
            header: insunits === undefined ? {} : { INSUNITS: insunits },
            tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] } },
            entities: [{ type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 29510.405, y: 2.258 } }],
        };
        app.eval(`window.loadLibreDwg = async () => ({ LibreDwg: { create: async () => ({
            dwg_read_data: () => ({}), convert: () => window.__dwgDb, dwg_free: () => {} }) } });`);
    }
    const dwgFile = `({ name: '図面.dwg', arrayBuffer: async () => new TextEncoder().encode('AC1032xxxx').buffer })`;
    const openDwg = async () => {
        app.eval(`entities.length = 0; _prepareImportTarget();`);
        await app.eval(`loadDwgFile(${dwgFile})`);
    };

    it('mm の DWG を開くと「図面の1単位」を 1mm にし、座標寸法は整数の mm で出る', async () => {
        app.eval(`localStorage.removeItem('cad_survey_unit')`);
        mockEngine(4);
        await openDwg();
        assert.equal(app.eval('getSurveyUnit()'), 'mm');
        assert.match(toast(), /DWGの単位は mm なので、オプションの「図面の1単位」を 1mm にしました/);
        assert.equal(app.eval('dimFormatCoord(29510.405)'), '29510');
        assert.equal(app.eval('dimFormatCoord(2.258)'), '2');
    });

    it('m の DWG を開くと 1m に戻す。単位が書かれていなければ変えずに記録に残す', async () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm')`);
        mockEngine(6);
        await openDwg();
        assert.equal(app.eval('getSurveyUnit()'), 'm');
        mockEngine(undefined);
        await openDwg();
        assert.equal(app.eval('getSurveyUnit()'), 'm');
        assert.match(log(), /単位が書かれていません（図面の1単位は 1m のまま）/);
    });

    it('今の図面に追加したときは、単位を変えずに知らせる', async () => {
        app.eval(`localStorage.removeItem('cad_survey_unit'); entities.length = 0; entities.push({ type:'LINE', layer:0, color:null, x1:0, y1:0, x2:1, y2:1 });`);
        app.window.confirm = () => false; // [キャンセル] 現在の図面に追加する
        mockEngine(4);
        app.eval(`_prepareImportTarget();`);
        await app.eval(`loadDwgFile(${dwgFile})`);
        assert.equal(app.eval('getSurveyUnit()'), 'm');
        assert.match(toast(), /今の図面に追加したので変えていません/);
        // 次に新しく開くときは、また合わせる
        app.eval(`entities.length = 0;`);
        await openDwg();
        assert.equal(app.eval('getSurveyUnit()'), 'mm');
    });

    it('DXF も同じ（$INSUNITS）', () => {
        app.eval(`localStorage.removeItem('cad_survey_unit'); entities.length = 0; _importMode = 'fresh';`);
        app.window.__dxf = { header: { $INSUNITS: 4 }, entities: [{ type: 'LINE', layer: '0', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] };
        app.eval(`importDxfData(window.__dxf, { skipUndo: true })`);
        assert.equal(app.eval('getSurveyUnit()'), 'mm');
        assert.match(toast(), /DXFの単位は mm なので/);
        app.eval(`localStorage.removeItem('cad_survey_unit')`);
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
