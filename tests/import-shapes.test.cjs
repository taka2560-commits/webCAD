'use strict';
// 取り込みの取りこぼし対策（v5.26）: 塗りつぶし（穴・模様）・SOLID・引出線・マルチ引出線・読めない図形の知らせ（DXF・DWG）、
// DWG の寸法のブロック・3D ポリライン・属性定義・属性の二重、塗りつぶしの非表示（初期値）と表示・隠す、
// 移動・回転・鏡像で穴と模様も動く、DXF に書き出して読み直す、印刷（PDF）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

// DXF の文字を作る（[コード, 値] の並びを、セクションごとに）
const sec = (name, ...items) => [['0', 'SECTION'], ['2', name], ...items.flat(), ['0', 'ENDSEC']];
const dxfText = (...sections) => [...sections.flat(), ['0', 'EOF']].map(([c, v]) => `${c}\n${v}`).join('\n');
const ent = (type, ...pairs) => [['0', type], ...pairs];

const HEADER = sec('HEADER', [['9', '$DIMASZ'], ['40', '2'], ['9', '$DIMSCALE'], ['40', '2']]);
// 外の四角（ふくらみ付き折れ線）と、穴（線・左回りの円弧の辺）
const SOLID_HATCH = ent('HATCH', ['5', 'A1'], ['330', '1F'], ['100', 'AcDbEntity'], ['8', '塗り'], ['62', '1'], ['100', 'AcDbHatch'],
    ['10', '0'], ['20', '0'], ['30', '0'], ['210', '0'], ['220', '0'], ['230', '1'], ['2', 'SOLID'], ['70', '1'], ['71', '0'], ['91', '2'],
    ['92', '7'], ['72', '1'], ['73', '1'], ['93', '4'], ['10', '0'], ['20', '0'], ['42', '0'], ['10', '10'], ['20', '0'], ['42', '0'], ['10', '10'], ['20', '10'], ['42', '0'], ['10', '0'], ['20', '10'], ['42', '0'], ['97', '0'],
    ['92', '16'], ['93', '4'],
    ['72', '1'], ['10', '2'], ['20', '2'], ['11', '4'], ['21', '2'],
    ['72', '2'], ['10', '4'], ['20', '3'], ['40', '1'], ['50', '270'], ['51', '90'], ['73', '1'],
    ['72', '1'], ['10', '4'], ['20', '4'], ['11', '2'], ['21', '4'],
    ['72', '1'], ['10', '2'], ['20', '4'], ['11', '2'], ['21', '2'], ['97', '0'],
    ['75', '0'], ['76', '1'], ['98', '0']);
// 斜線の模様（ANSI31）。右回りの円弧の辺（下に膨らむ半円）
const PAT_HATCH = ent('HATCH', ['5', 'A2'], ['330', '1F'], ['100', 'AcDbEntity'], ['8', '斜線'], ['100', 'AcDbHatch'],
    ['10', '0'], ['20', '0'], ['30', '0'], ['210', '0'], ['220', '0'], ['230', '1'], ['2', 'ANSI31'], ['70', '0'], ['71', '0'], ['91', '1'],
    ['92', '1'], ['93', '2'], ['72', '1'], ['10', '100'], ['20', '0'], ['11', '110'], ['21', '0'],
    ['72', '2'], ['10', '105'], ['20', '0'], ['40', '5'], ['50', '0'], ['51', '180'], ['73', '0'], ['97', '0'],
    ['75', '0'], ['76', '1'], ['52', '0'], ['41', '1'], ['77', '0'], ['78', '1'],
    ['53', '45'], ['43', '0'], ['44', '0'], ['45', '-2.2450640303'], ['46', '2.2450640303'], ['79', '0'], ['98', '0']);
const LEADER = ent('LEADER', ['5', 'B1'], ['330', '1F'], ['100', 'AcDbEntity'], ['8', '引出'], ['100', 'AcDbLeader'], ['3', 'Standard'], ['71', '1'], ['72', '0'],
    ['73', '3'], ['74', '1'], ['75', '0'], ['40', '0'], ['41', '0'], ['76', '3'], ['10', '0'], ['20', '0'], ['30', '0'], ['10', '10'], ['20', '10'], ['30', '0'], ['10', '20'], ['20', '10'], ['30', '0'],
    ['77', '256'], ['210', '0'], ['220', '0'], ['230', '1'], ['211', '1'], ['221', '0'], ['231', '0'], ['212', '0'], ['222', '0'], ['232', '0'], ['213', '0'], ['223', '0'], ['233', '0']);
const MLEADER = ent('MULTILEADER', ['5', 'C1'], ['330', '1F'], ['100', 'AcDbEntity'], ['8', '引出'], ['100', 'AcDbMLeader'], ['270', '2'],
    ['300', 'CONTEXT_DATA{'], ['40', '1'], ['10', '30'], ['20', '10'], ['30', '0'], ['41', '2.5'], ['140', '3'], ['145', '1'], ['290', '1'], ['304', '引出の文字'],
    ['12', '31'], ['22', '12'], ['32', '0'], ['42', '0'],
    ['302', 'LEADER{'], ['290', '1'], ['291', '1'], ['10', '30'], ['20', '10'], ['30', '0'], ['11', '1'], ['21', '0'], ['31', '0'], ['90', '0'], ['40', '2'],
    ['304', 'LEADER_LINE{'], ['10', '20'], ['20', '0'], ['30', '0'], ['91', '0'], ['305', '}'], ['271', '0'], ['303', '}'], ['301', '}'], ['340', '0']);
const WIPEOUT = ent('WIPEOUT', ['5', 'D1'], ['330', '1F'], ['100', 'AcDbEntity'], ['8', '0'], ['100', 'AcDbWipeout'], ['10', '0'], ['20', '0'], ['30', '0']);
const SOLID = ent('SOLID', ['8', '0'], ['10', '50'], ['20', '0'], ['11', '60'], ['21', '0'], ['12', '50'], ['22', '10'], ['13', '60'], ['23', '10']);
const DIM = ent('DIMENSION', ['8', '寸法'], ['2', '*D1'], ['10', '10'], ['20', '0'], ['11', '5'], ['21', '1'], ['70', '0'], ['42', '10']);
const INSERT = ent('INSERT', ['8', '0'], ['2', 'SYMB'], ['10', '200'], ['20', '0'], ['30', '0']);
const BLOCKS = sec('BLOCKS',
    ent('BLOCK', ['8', '0'], ['2', '*D1'], ['70', '1'], ['10', '0'], ['20', '0'], ['30', '0'], ['3', '*D1']),
    ent('LINE', ['8', '寸法'], ['10', '0'], ['20', '0'], ['11', '10'], ['21', '0']),
    ent('SOLID', ['8', '寸法'], ['10', '0'], ['20', '0'], ['11', '1'], ['21', '0.2'], ['12', '1'], ['22', '-0.2'], ['13', '1'], ['23', '-0.2']),
    ent('ENDBLK', ['8', '0']),
    ent('BLOCK', ['8', '0'], ['2', 'SYMB'], ['70', '0'], ['10', '0'], ['20', '0'], ['30', '0'], ['3', 'SYMB']),
    ent('IMAGE', ['8', '0'], ['10', '0'], ['20', '0'], ['30', '0']),
    ent('LINE', ['8', '0'], ['10', '0'], ['20', '0'], ['11', '1'], ['21', '1']),
    ent('ENDBLK', ['8', '0']));
const DXF = dxfText(HEADER, BLOCKS, sec('ENTITIES', SOLID_HATCH, PAT_HATCH, LEADER, MLEADER, WIPEOUT, SOLID, DIM, INSERT));

function importDxf(app, text, hideFills) {
    app.window.__t = text;
    return app.val(`(() => {
        entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true });
        setImportHideFills(${hideFills === false ? 'false' : 'true'});
        document.getElementById('command-log').textContent = '';
        const p = new window.DxfParser(); registerExtraDxfHandlers(p, window.__t);
        return importDxfData(p.parseSync(window.__t), { skipUndo: true });
    })()`);
}
const byLayer = (app, name) => app.val(`entities.filter(e => layers[e.layer] && layers[e.layer].name === ${JSON.stringify(name)})`);

describe('取り込みの取りこぼし対策: DXF', () => {
    let app, res;
    before(async () => { app = await loadApp(); res = importDxf(app, DXF); });
    after(() => app.close());

    it('塗りつぶし: 外の四角がいちばん広い輪（target）、中の輪（線と円弧の辺）が穴。初期値では非表示', () => {
        const [h] = byLayer(app, '塗り');
        assert.equal(h.type, 'HATCH'); assert.equal(h.imp, 1);
        assert.deepEqual(h.target.points, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
        assert.equal(h.target.holes.length, 1);
        const hole = h.target.holes[0];
        assert.ok(hole.some((p) => near(p.x, 5, 1e-6) && near(p.y, 3, 1e-6)), '円弧の辺が右へ膨らんでいない（中心(4,3)・半径1・270°→90°左回り）');
        assert.ok(hole.every((p) => p.x >= 2 - 1e-9 && p.x <= 5 + 1e-9 && p.y >= 2 - 1e-9 && p.y <= 4 + 1e-9));
        assert.equal(h.pat, undefined, '塗り（SOLID）に模様は無い');
        assert.equal(h.hidden, true); assert.equal(h.hiddenBy, 'fill');
        assert.equal(res.hiddenFills, 3, '塗りつぶし2つと SOLID 1つ（寸法の矢印は数えない）');
    });

    it('斜線の模様（ANSI31）: 線の定義（45°・間隔 3.175）を持つ。右回りの円弧の辺は下に膨らむ', () => {
        const [h] = byLayer(app, '斜線');
        assert.equal(h.pat.name, 'ANSI31');
        assert.equal(h.pat.lines.length, 1);
        const l = h.pat.lines[0];
        assert.ok(near(l.a, Math.PI / 4, 1e-9) && near(l.ox, -2.2450640303, 1e-9) && near(l.oy, 2.2450640303, 1e-9), JSON.stringify(l));
        assert.ok(near(Math.hypot(l.ox, l.oy), 3.175, 1e-6));
        const pts = h.target.points;
        assert.ok(pts.some((p) => near(p.x, 105, 1e-6) && near(p.y, -5, 1e-6)), '右回りの半円が (105,-5) を通らない');
        assert.ok(pts.every((p) => p.y <= 1e-9));
    });

    it('引出線: 折れ線と、始めの点の矢印（長さ DIMASZ × DIMSCALE = 4、塗り。非表示にしない）', () => {
        const ls = byLayer(app, '引出');
        const pl = ls.find((e) => e.type === 'PLINE' && e.points.length === 3);
        assert.deepEqual(pl.points, [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }]);
        const arrows = ls.filter((e) => e.type === 'HATCH' && e.arrow);
        const a = arrows.find((e) => near(e.target.points[0].x, 0) && near(e.target.points[0].y, 0));
        assert.ok(a && !a.hidden, '矢印が無いか、隠れている');
        const tip = a.target.points[0], b1 = a.target.points[1], b2 = a.target.points[2];
        const mid = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
        assert.ok(near(Math.hypot(mid.x - tip.x, mid.y - tip.y), 4, 1e-9), '矢印の長さ');
        assert.ok(near(Math.hypot(b1.x - b2.x, b1.y - b2.y), 4 / 3, 1e-9), '矢印の幅（長さの 1/3）');
    });

    it('マルチ引出線: 引出の線（最後の点まで）・矢印（長さ 3）・水平の線（向き×長さ 2）・文字', () => {
        const ls = byLayer(app, '引出');
        assert.ok(ls.some((e) => e.type === 'PLINE' && e.points.length === 2 && near(e.points[0].x, 20) && near(e.points[1].x, 30) && near(e.points[1].y, 10)));
        assert.ok(ls.some((e) => e.type === 'LINE' && near(e.x1, 30) && near(e.y1, 10) && near(e.x2, 32) && near(e.y2, 10)), '水平の線');
        const t = ls.find((e) => e.type === 'TEXT');
        assert.equal(t.text, '引出の文字'); assert.ok(near(t.x, 31) && near(t.y, 12) && near(t.height, 2.5));
        assert.ok(ls.some((e) => e.type === 'HATCH' && e.arrow && near(e.target.points[0].x, 20) && near(e.target.points[0].y, 0)));
    });

    it('SOLID は塗り（非表示）。寸法のブロックの SOLID（矢印）は非表示にしない', () => {
        const all = app.val('entities');
        const so = all.find((e) => e.type === 'HATCH' && near(e.target.points[0].x, 50));
        assert.equal(so.hidden, true);
        const dimArrow = all.find((e) => e.type === 'HATCH' && e.blockName === '寸法');
        assert.ok(dimArrow && !dimArrow.hidden && dimArrow.arrow === 1, JSON.stringify(dimArrow));
    });

    it('読めない図形を黙って捨てない: ワイプアウト（ENTITIES）・画像の参照（ブロックの中）を数えて、日本語の名前で知らせる', () => {
        assert.deepEqual(res.skipStats, { WIPEOUT: 1, IMAGE: 1 });
        const log = app.eval(`document.getElementById('command-log').textContent`);
        assert.match(log, /取り込めなかった図形: (ワイプアウト（白抜き）（WIPEOUT）×1、画像の参照（IMAGE）×1|画像の参照（IMAGE）×1、ワイプアウト（白抜き）（WIPEOUT）×1)/);
        assert.match(log, /塗りつぶし 3個は非表示にしました/);
        assert.equal(app.eval(`importResultNote({ WIPEOUT: 2, IMAGE: 1 }, 5)`), '\n取り込めなかった図形: ワイプアウト（白抜き） 2・画像の参照 1（詳しくはコマンド欄）\n塗りつぶし 5個は非表示にしました（画層管理の「塗りつぶしを表示」で表示）');
    });

    it('オプションで「塗りつぶしを非表示」を切ると、はじめから表示する', () => {
        const r = importDxf(app, DXF, false);
        assert.equal(r.hiddenFills, 0);
        assert.equal(app.val(`entities.filter(e => e.type === 'HATCH' && e.hidden).length`), 0);
        importDxf(app, DXF, true);
    });

    it('画層管理: 「塗りつぶしを表示」で塗りつぶしだけ表示し、「塗りつぶしを隠す」でまた隠す（矢印は残す）', () => {
        app.eval('showLayerManagerPanel()');
        assert.match(app.eval(`document.getElementById('property-panel-content').innerHTML`), /▨ 塗りつぶしを表示 \(3個\)/);
        app.eval(`showHiddenEntities('fill')`);
        assert.equal(app.val(`entities.filter(e => e.hiddenBy === 'fill').length`), 0);
        assert.equal(app.val(`entities.filter(e => e.type === 'ARC' && e.hidden).length`), 0, '円弧は無い');
        app.eval('hideImportedFills()');
        assert.equal(app.val(`entities.filter(e => e.type === 'HATCH' && e.hidden).length`), 3);
        assert.ok(app.val(`entities.filter(e => e.type === 'HATCH' && e.arrow).every(e => !e.hidden)`));
        app.eval(`showHiddenEntities('fill')`);
    });

    it('画面に描く: 穴は偶奇の規則で、模様は輪で切り抜いて線で（例外が起きない）', () => {
        app.eval('zoomExtents(); _drawFrame(false);');
        assert.deepEqual(app.errors(), []);
    });

    it('移動・回転・鏡像で、穴の輪と模様の線も一緒に動く', () => {
        app.eval(`window.__h = entities.find(e => e.type === 'HATCH' && e.pat);`);
        const before0 = app.val('window.__h.pat.lines[0]');
        app.eval('moveEntity(window.__h, 10, 5)');
        let l = app.val('window.__h.pat.lines[0]');
        assert.ok(near(l.bx, before0.bx + 10) && near(l.by, before0.by + 5) && near(l.ox, before0.ox) && near(l.a, before0.a));
        app.eval('rotateEntity(window.__h, 0, 0, Math.PI / 2)');
        l = app.val('window.__h.pat.lines[0]');
        assert.ok(near(l.a, Math.PI * 3 / 4, 1e-9), `回転後の向き ${l.a}`);
        assert.ok(near(l.ox, -before0.oy, 1e-9) && near(l.oy, before0.ox, 1e-9));
        // 穴の輪: 塗り（穴あり）を y 軸で鏡にすると、穴も x が負になる
        app.eval(`window.__s = entities.find(e => e.type === 'HATCH' && e.target.holes); editTransformEntity(window.__s, editMirrorXform({ x: 0, y: 0 }, { x: 0, y: 1 }));`);
        const s = app.val('window.__s.target');
        assert.ok(s.points.every((p) => p.x <= 1e-9) && s.holes[0].every((p) => p.x <= -2 + 1e-9), JSON.stringify(s.holes[0].slice(0, 3)));
        const bb = app.val('calcBBox(window.__s.target)');
        assert.ok(near(bb.minX, -10) && near(bb.maxX, 0));
    });

    it('DXF に書き出して読み直すと、穴（ほかの輪）と模様の線の定義が残る', () => {
        importDxf(app, DXF, false);
        app.eval(`window.downloadBlob = () => {}; window.__OB = window.Blob; window.Blob = function (parts, opt) { window.__parts = parts; return new window.__OB(parts, opt); }; exportDxf(); window.Blob = window.__OB;`);
        const out = app.val('window.__parts.join("")');
        importDxf(app, out, false);
        const hs = app.val(`entities.filter(e => e.type === 'HATCH' && !e.arrow)`);
        const withHole = hs.find((e) => e.target.holes && e.target.holes.length === 1);
        assert.ok(withHole, '穴のある塗りつぶしが戻らない');
        const pat = hs.find((e) => e.pat && e.pat.name === 'ANSI31');
        assert.ok(pat && pat.pat.lines.length === 1 && near(pat.pat.lines[0].a, Math.PI / 4, 1e-9), JSON.stringify(pat && pat.pat));
    });

    it('印刷（PDF）: 穴は偶奇の規則（f*）で塗り、模様は輪で切り抜いて（W* n）線を引く', () => {
        importDxf(app, DXF, false);
        const pg = app.val(`(() => { entities.forEach(e => { e.bbox = (e.type === 'HATCH' ? null : calcBBox(e)); }); return printCompose({ paper: 'A3', orient: 'land', scale: 100, color: 'color' }, { x: 50, y: 5 }, 0, { title: 'T' }); })()`);
        assert.match(pg.content, /\nf\*\n/);
        assert.match(pg.content, /W\* n/);
        assert.match(pg.content, /S Q/);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});

describe('取り込みの取りこぼし対策: DWG（読込エンジンが返す形）', () => {
    let app, r;
    before(async () => {
        app = await loadApp();
        const attrib = { type: 'ATTRIB', layer: '0', text: 'KP-1', tag: '点名', startPoint: { x: 100, y: 100 }, textHeight: 1, ownerBlockRecordSoftId: '50' };
        app.window.__db = {
            header: { DIMASZ: 2.5, DIMSCALE: 1, DIMTXT: 2.5 },
            tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] }, BLOCK_RECORD: { entries: [
                { name: '*Model_Space', handle: '1F', entities: [] },
                { name: '*D1', handle: '40', entities: [
                    { type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } },
                    { type: 'SOLID', layer: '0', corner1: { x: 0, y: 0 }, corner2: { x: 1, y: 0.2 }, corner3: { x: 1, y: -0.2 }, corner4: { x: 1, y: -0.2 } },
                    { type: 'MTEXT', layer: '0', insertionPoint: { x: 5, y: 1 }, text: '10', textHeight: 2.5, attachmentPoint: 8 },
                ] },
                { name: '測点', handle: '41', basePoint: { x: 0, y: 0 }, entities: [
                    { type: 'POINT', layer: '0', position: { x: 0, y: 0 } },
                    { type: 'ATTDEF', layer: '0', tag: '点名', text: '', startPoint: { x: 0.5, y: 0.5 }, textHeight: 1, flags: 0 },
                ] },
            ] } },
            entities: [
                { type: 'SOLID', layer: '0', corner1: { x: 0, y: 0 }, corner2: { x: 10, y: 0 }, corner3: { x: 0, y: 10 }, corner4: { x: 10, y: 10 }, ownerBlockRecordSoftId: '1F' },
                { type: 'HATCH', layer: '0', patternName: 'SOLID', solidFill: 1, ownerBlockRecordSoftId: '1F', boundaryPaths: [
                    { boundaryPathTypeFlag: 2, vertices: [{ x: 20, y: 0, bulge: 0 }, { x: 30, y: 0, bulge: 0 }, { x: 30, y: 10, bulge: 0 }, { x: 20, y: 10, bulge: 0 }] },
                    { boundaryPathTypeFlag: 16, edges: [{ type: 1, start: { x: 22, y: 2 }, end: { x: 28, y: 2 } }, { type: 2, center: { x: 25, y: 2 }, radius: 3, startAngle: 0, endAngle: Math.PI, isCCW: 1 }] },
                ] },
                { type: 'HATCH', layer: '0', patternName: 'ANSI31', solidFill: 0, patternScale: 0, ownerBlockRecordSoftId: '1F', definitionLines: [],
                    boundaryPaths: [{ boundaryPathTypeFlag: 2, vertices: [{ x: 40, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 40, y: 40 }] }] },
                { type: 'LEADER', layer: '0', vertices: [{ x: 0, y: 50, z: 1 }, { x: 10, y: 60, z: 1 }], isArrowheadEnabled: true, ownerBlockRecordSoftId: '1F' },
                { type: 'POLYLINE3D', layer: '0', flag: 1, vertices: [{ x: 0, y: 70, z: 5 }, { x: 10, y: 70, z: 6 }, { x: 10, y: 80, z: 7 }], ownerBlockRecordSoftId: '1F' },
                { type: 'DIMENSION', subclassMarker: 'AcDbAlignedDimension', name: '*D1', layer: '0', textPoint: { x: 5, y: 1 }, measurement: 10, text: '', ownerBlockRecordSoftId: '1F' },
                { type: 'DIMENSION', subclassMarker: 'AcDbAlignedDimension', name: '*NONE', layer: '0', textPoint: { x: 5, y: 90 }, measurement: 7, text: '', ownerBlockRecordSoftId: '1F' },
                { type: 'ATTDEF', layer: '0', tag: 'タグ名', text: '', startPoint: { x: 0, y: 95 }, textHeight: 1, flags: 0, ownerBlockRecordSoftId: '1F' },
                { type: 'INSERT', layer: '0', name: '測点', insertionPoint: { x: 100, y: 100 }, attribs: [attrib], ownerBlockRecordSoftId: '1F' },
                attrib, // 読込エンジンは、属性を図形一覧にも入れて返す
                { type: 'WIPEOUT', layer: '0', ownerBlockRecordSoftId: '1F' },
            ],
        };
        app.eval(`setImportHideFills(true); document.getElementById('command-log').textContent = '';`);
        r = app.val(`(() => { const r = convertDwgDatabaseToApp(window.__db); return { ents: r.entities, skip: r.skipStats, hiddenFills: r.hiddenFills }; })()`);
    });
    after(() => app.close());

    it('SOLID: 角（corner1〜4）を 1-2-4-3 の順で、塗り（非表示）にする', () => {
        const so = r.ents.find((e) => e.type === 'HATCH' && near(e.target.points[0].x, 0) && near(e.target.points[0].y, 0) && !e.gid);
        assert.deepEqual(so.target.points, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
        assert.equal(so.hiddenBy, 'fill');
    });

    it('塗りつぶし: 外の輪と穴（線と円弧の辺）。模様の定義が無い ANSI31 は、範囲の大きさから決めた間隔の 45° の線', () => {
        const h = r.ents.find((e) => e.type === 'HATCH' && near(e.target.points[0].x, 20));
        assert.equal(h.target.holes.length, 1);
        assert.ok(h.target.holes[0].some((p) => near(p.x, 25, 1e-6) && near(p.y, 5, 1e-6)), '半円の頂点 (25,5)');
        const p = r.ents.find((e) => e.type === 'HATCH' && e.pat);
        assert.equal(p.pat.name, 'ANSI31');
        const l = p.pat.lines[0];
        assert.ok(near(l.a, Math.PI / 4, 1e-9));
        assert.ok(near(Math.hypot(l.ox, l.oy), Math.hypot(40, 40) / 40, 1e-9), '間隔＝範囲の対角線の 1/40');
        assert.equal(r.hiddenFills, 3);
    });

    it('引出線（矢印つき）・3D ポリライン（平面にして閉じる）', () => {
        assert.ok(r.ents.some((e) => e.type === 'PLINE' && e.points.length === 2 && near(e.points[0].y, 50)));
        assert.ok(r.ents.some((e) => e.type === 'HATCH' && e.arrow && near(e.target.points[0].x, 0) && near(e.target.points[0].y, 50)));
        const p3 = r.ents.find((e) => e.type === 'PLINE' && e.points.length === 3 && near(e.points[0].y, 70));
        assert.ok(p3 && p3.closed === true);
    });

    it('寸法: ブロック（寸法線・矢印・文字）を広げてまとめる。矢印は非表示にしない。ブロックが無いときは値の文字', () => {
        const dim = r.ents.filter((e) => e.blockName === '寸法');
        assert.ok(dim.some((e) => e.type === 'LINE') && dim.some((e) => e.type === 'TEXT' && e.text === '10'));
        const arrow = dim.find((e) => e.type === 'HATCH');
        assert.ok(arrow && !arrow.hidden && arrow.arrow === 1);
        assert.equal(new Set(dim.filter((e) => near(e.y, 1) || e.type !== 'TEXT').map((e) => e.gid)).size, 1, '1つのまとまり');
        assert.ok(r.ents.some((e) => e.type === 'TEXT' && e.text === '7' && near(e.y, 90)), 'ブロックが無い寸法の値の文字');
    });

    it('属性定義: ブロックの外は名前（タグ）を出し、ブロックの中の可変属性は出さない。属性の文字は二重にしない', () => {
        assert.ok(r.ents.some((e) => e.type === 'TEXT' && e.text === 'タグ名'));
        assert.equal(r.ents.filter((e) => e.type === 'TEXT' && e.text === 'KP-1').length, 1);
        assert.ok(!r.ents.some((e) => e.type === 'TEXT' && e.text === '点名'));
        assert.deepEqual(r.skip, { WIPEOUT: 1 });
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
