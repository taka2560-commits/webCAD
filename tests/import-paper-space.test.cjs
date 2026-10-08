'use strict';
// レイアウト（ペーパー空間）はモデルに入れない。モデル空間の図形だけを図面にし、レイアウトは別の画面のレイアウトにする（DWG・DXF。v5.38 cad-layout.js）。
//   DWG: 読込エンジン（libredwg-web）は、モデル空間とすべてのレイアウトの図形を db.entities にまとめて返す。
//        図形の持ち主は ownerBlockRecordSoftId（ブロックレコードの handle）、ブロック参照の属性は db.entities にも別に入る。
//   DXF: レイアウトの図形には 67（inPaperSpace）が付く。付けないソフトもあるので、持ち主（330）が *Paper_Space でも見分ける。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

const line = (x, owner, extra) => Object.assign({ type: 'LINE', layer: '0', startPoint: { x, y: 0 }, endPoint: { x: x + 1, y: 0 }, ownerBlockRecordSoftId: owner }, extra || {});

function dwgDb() {
    const modelLine = line(10, '1F');
    const paperLine = line(9000, '1B');
    const paperLine2 = line(9100, '20');                                   // 2つ目のレイアウト
    const attrib = { type: 'ATTRIB', layer: '0', text: '表題', startPoint: { x: 9000, y: 50 }, textHeight: 5, ownerBlockRecordSoftId: '2A' };
    const paperInsert = { type: 'INSERT', layer: '0', name: 'FRAME', insertionPoint: { x: 0, y: 0 }, attribs: [attrib], ownerBlockRecordSoftId: '1B' };
    const modelInsert = { type: 'INSERT', layer: '0', name: 'MARK', insertionPoint: { x: 50, y: 50 }, ownerBlockRecordSoftId: '1F' };
    const viewport = { type: 'VIEWPORT', layer: '0', ownerBlockRecordSoftId: '1B' };
    return {
        header: {},
        tables: {
            LAYER: { entries: [{ name: '0', colorIndex: 7 }] },
            BLOCK_RECORD: { entries: [
                { name: '*Model_Space', handle: '1F', entities: [modelLine, modelInsert] },
                { name: '*Paper_Space', handle: '1B', entities: [paperLine, paperInsert, viewport] },
                { name: '*Paper_Space0', handle: '20', entities: [paperLine2] },
                { name: 'FRAME', handle: '30', entities: [line(9200, '30')] },
                { name: 'MARK', handle: '31', entities: [line(0, '31')] },
            ] },
        },
        // エンジンと同じく、モデル空間・レイアウトの図形と属性を並べる
        entities: [modelLine, modelInsert, paperLine, paperInsert, attrib, viewport, paperLine2],
    };
}

describe('取り込み: レイアウト（ペーパー空間）はモデルに入れず、別の画面のレイアウトにする', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    const clearLayouts = () => app.eval('layoutsClear()');

    it('DWG: レイアウトの図形・ブロック参照・属性・ビューポートを除き、モデル空間の図形とブロックだけ取り込む', () => {
        app.window.__db = dwgDb();
        const r = app.val(`(() => { const r = convertDwgDatabaseToApp(window.__db); return { xs: r.entities.filter(e => e.type === 'LINE').map(e => Math.min(e.x1, e.x2)).sort((a, b) => a - b), texts: r.entities.filter(e => e.type === 'TEXT').length, paper: r.paperSkipped }; })()`);
        assert.deepEqual(r.xs, [10, 50], `モデル空間の線と MARK ブロックの線だけのはず: ${JSON.stringify(r.xs)}`);
        assert.equal(r.texts, 0, 'レイアウトの表題（属性）が入っている');
        assert.equal(r.paper, 5);
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /レイアウト（ペーパー空間）の図形 5個は、モデルには入れません/);
        // レイアウトは別に変える（LAYOUT の記録が無いので、名前はブロックレコードの名前）。属性の表題は図枠のブロックといっしょに
        assert.deepEqual(app.val(`convertDwgDatabaseToApp(window.__db).layouts.map(l => [l.name, l.ents.map(e => e.type === 'TEXT' ? e.text : Math.min(e.x1, e.x2)).sort().join(',')])`),
            [['Paper_Space', '9000,9200,表題'], ['Paper_Space0', '9100']]);
    });

    it('DWG: エンジンが isInPaperSpace を付けた図形も除く', () => {
        app.window.__db = { header: {}, tables: { LAYER: { entries: [] }, BLOCK_RECORD: { entries: [] } }, entities: [line(1, '1F'), line(2, '?', { isInPaperSpace: true })] };
        const r = app.val(`convertDwgDatabaseToApp(window.__db)`);
        assert.equal(r.entities.length, 1); assert.equal(r.paperSkipped, 1);
    });

    it('DXF: 67 が無くても、持ち主（330）が *Paper_Space の図形と、その属性を除く', () => {
        const dxf = {
            header: {},
            blocks: { '*Model_Space': { name: '*Model_Space', ownerHandle: '1F' }, '*Paper_Space': { name: '*Paper_Space', ownerHandle: '1B' } },
            entities: [
                { type: 'LINE', layer: '0', handle: 'A1', ownerHandle: '1F', vertices: [{ x: 10, y: 0 }, { x: 11, y: 0 }] },
                { type: 'LINE', layer: '0', handle: 'A2', ownerHandle: '1B', vertices: [{ x: 9000, y: 0 }, { x: 9001, y: 0 }] },
                { type: 'LINE', layer: '0', handle: 'A3', inPaperSpace: true, vertices: [{ x: 9100, y: 0 }, { x: 9101, y: 0 }] },
                { type: 'INSERT', layer: '0', handle: 'A4', ownerHandle: '1B', name: 'NOPE', position: { x: 0, y: 0 } },
                { type: 'ATTRIB', layer: '0', handle: 'A5', ownerHandle: 'A4', text: '表題', startPoint: { x: 9000, y: 50 }, textHeight: 5 },
            ],
        };
        app.window.__dxf = dxf;
        app.eval(`entities.length = 0; importDxfData(window.__dxf, { skipUndo: true });`);
        const xs = app.val(`entities.filter(e => e.type === 'LINE').map(e => e.x1)`);
        assert.deepEqual(xs, [10]);
        assert.equal(app.val(`entities.filter(e => e.type === 'TEXT').length`), 0, 'レイアウトの属性が入っている');
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /レイアウト（ペーパー空間）の図形 4個は、モデルには入れません/);
        // LAYOUT の記録が無い DXF: レイアウトの図形を1枚のレイアウトにする
        assert.deepEqual(app.val(`cadLayouts.map(l => [l.name, l.ents.filter(e => e.type === 'LINE').map(e => e.x1).join(','), l.ents.filter(e => e.type === 'TEXT').map(e => e.text).join(',')])`), [['レイアウト', '9000,9100', '表題']]);
        clearLayouts();
    });

    it('DXF: レイアウトの図形しか無いときは、そう知らせる（「未対応」とは数えない）', () => {
        let toast = null;
        app.window.showToast = (m) => { toast = m; };
        app.window.__dxf = { header: {}, blocks: {}, entities: [{ type: 'LINE', layer: '0', inPaperSpace: true, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] };
        const r = app.val(`(() => { entities.length = 0; return importDxfData(window.__dxf, { skipUndo: true }); })()`);
        assert.equal(r.importCount, 0); assert.equal(r.paperSkipped, 1);
        assert.deepEqual(r.skipStats, {});
        assert.match(String(toast), /モデル空間に図形がありません。レイアウト「レイアウト」を出しました/);
        assert.equal(app.eval('layoutActive()'), true, 'モデルが空なら、レイアウトを出す');
        clearLayouts();
        assert.equal(app.eval('layoutActive()'), false);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
