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
        { type: 'LWPOLYLINE', layer: '非表示', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 10, y: 10 }], flag: 1 },
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
