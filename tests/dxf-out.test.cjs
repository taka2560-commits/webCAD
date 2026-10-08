'use strict';
// DXF の書き出し（v5.28）: 測点をブロック「測点」と属性（点番号・点名・標高。Z つき）で、複数行の文字を MTEXT で、寸法を DIMENSION で書く。
// 読み直すと、座標一覧の点・複数行の文字・アプリの寸法に戻る。DXF の作り（ハンドル・ブロックの表と中身・APPID・寸法スタイル）も確かめる
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

function exportText(app) {
    app.eval(`window.downloadBlob = () => {}; window.__OB = window.Blob; window.Blob = function (parts, opt) { window.__parts = parts; return new window.__OB(parts, opt); }; exportDxf(); window.Blob = window.__OB;`);
    return app.val('window.__parts.join("")');
}
function reimport(app, text) {
    app.window.__t = text;
    app.eval(`(() => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); _importMode = 'fresh';
        const p = new window.DxfParser(); registerExtraDxfHandlers(p, window.__t); importDxfData(p.parseSync(window.__t), { skipUndo: true, text: window.__t }); })()`);
}
// DXF をタグ（[コード, 値]）に分ける
const tagsOf = (text) => { const L = text.split(/\r?\n/); const out = []; for (let i = 0; i + 1 < L.length; i += 2) out.push([L[i].trim(), L[i + 1]]); return out; };
const PTS = [{ num: '1', name: 'KP1', X: 10.5, Y: 20.25, z: 3.456 }, { num: '2', name: '境界2', X: -4, Y: 5, z: null }];

describe('DXF の書き出し: 測点・複数行の文字・寸法', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    for (const unit of ['m', 'mm']) {
        it(`測点（図面の単位 ${unit}）: ブロック「測点」と属性で書き、Z は挿入点の高さ。読み直すと点名・点番号・標高と点名の文字が戻る`, () => {
            app.eval(`localStorage.setItem('cad_survey_unit', '${unit}'); entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true });
                addSurveyData(${JSON.stringify(PTS)}, []);`);
            const before0 = app.val('collectSurveyPoints().map(p => ({ name: p.name, num: p.num, x: p.x, y: p.y, z: p.z }))');
            const lbl0 = app.val(`entities.filter(e => e.ptLabel).map(e => ({ x: e.x, y: e.y, h: e.height, text: e.text }))`);
            const out = exportText(app);
            const T = tagsOf(out);
            assert.ok(T.some(([c, v], i) => c === '0' && v === 'BLOCK' && T.slice(i, i + 12).some(([c2, v2]) => c2 === '2' && v2 === '測点')), 'ブロック「測点」が無い');
            assert.deepEqual(['点番号', '点名', '標高'].map((tag) => T.some(([c, v], i) => c === '2' && v === tag && T[i - 1] && T[i - 1][0] === '3' && T[i - 1][1] === tag)), [true, true, true], '属性定義（ATTDEF）');
            const inserts = T.map(([c, v], i) => (c === '0' && v === 'INSERT') ? i : -1).filter((i) => i >= 0);
            assert.equal(inserts.length, 2);
            const f = unit === 'mm' ? 1000 : 1;
            const z0 = T.slice(inserts[0]).find(([c]) => c === '30');
            assert.ok(near(Number(z0[1]), 3.456 * f, 1e-9), `Z ${z0[1]}`);
            assert.ok(!T.some(([c, v], i) => c === '0' && v === 'TEXT' && T.slice(i, i + 20).some(([c2, v2]) => c2 === '1' && v2 === 'KP1')), '点名を TEXT でも書いている（二重）');
            reimport(app, out);
            const after0 = app.val('collectSurveyPoints().map(p => ({ name: p.name, num: p.num, x: p.x, y: p.y, z: p.z }))');
            assert.equal(after0.length, 2);
            after0.forEach((p, i) => {
                assert.equal(p.name, before0[i].name); assert.equal(p.num, before0[i].num);
                assert.ok(near(p.x, before0[i].x, 1e-9) && near(p.y, before0[i].y, 1e-9));
                assert.equal(p.z === null ? null : Number(p.z.toFixed(6)), before0[i].z === null ? null : Number(before0[i].z.toFixed(6)));
            });
            const lbl1 = app.val(`entities.filter(e => e.ptLabel).map(e => ({ x: e.x, y: e.y, h: e.height, text: e.text }))`);
            assert.equal(lbl1.length, lbl0.length);
            lbl1.forEach((l, i) => { assert.equal(l.text, lbl0[i].text); assert.ok(near(l.x, lbl0[i].x, 1e-9) && near(l.y, lbl0[i].y, 1e-9) && near(l.h, lbl0[i].h, 1e-9)); });
            // SIMA に書き出しても同じ（座標一覧の点として扱える）
            assert.match(app.val(`buildSimaText('t').text`), /A01,1,KP1,10\.500,20\.250,3\.456,/);
        });
    }

    it('複数行の文字は MTEXT（\\P で改行・書式の記号は打ち消す）。読み直すと同じ文字', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'm'); entities.length = 0;
            entities.push({ type: 'TEXT', layer: 0, color: null, x: 1, y: 2, text: '1行目 {A}\\n2行目', height: 0.5, rotation: Math.PI / 6, halign: 'left', valign: 'top' });`);
        const out = exportText(app);
        assert.match(out, /\n\s*0\r?\nMTEXT\r?\n/);
        assert.match(out, /\n\s*1\r?\n1行目 \\\{A\\\}\\P2行目\r?\n/);
        reimport(app, out);
        const t = app.val(`entities.find(e => e.type === 'TEXT')`);
        assert.equal(t.text, '1行目 {A}\n2行目');
        assert.ok(near(t.rotation, Math.PI / 6, 1e-9) && near(t.height, 0.5));
    });

    it('寸法（6種類）は DIMENSION と寸法のブロック。拡張データから、読み直すとアプリの寸法に戻る', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'm'); entities.length = 0;
            entities.push({ type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:0,y:0}, p2:{x:30,y:20}, offset:-3 });
            entities.push({ type:'DIMENSION', subType:'ALIGNED', layer:0, color:null, p1:{x:0,y:0}, p2:{x:30,y:40}, offset:5 });
            entities.push({ type:'DIMENSION', subType:'RADIUS', layer:0, color:null, center:{x:50,y:0}, radius:5, angle:0.5 });
            entities.push({ type:'DIMENSION', subType:'DIAMETER', layer:0, color:null, center:{x:70,y:0}, radius:4, angle:1 });
            entities.push({ type:'DIMENSION', subType:'ANGULAR', layer:0, color:null, vertex:{x:0,y:0}, arm1:{x:10,y:0}, arm2:{x:0,y:10}, arcRadius:6 });
            entities.push({ type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:12.5,y:7.25}, leaderCoord:{x:15,y:9} });`);
        const before0 = app.val('entities.map(e => { const c = Object.assign({}, e); delete c.id; delete c.bbox; delete c._hits; delete c.layer; return c; })');
        const out = exportText(app);
        const T = tagsOf(out);
        const dims = T.filter(([c, v]) => c === '0' && v === 'DIMENSION');
        assert.equal(dims.length, 6);
        ['AcDbRotatedDimension', 'AcDbAlignedDimension', 'AcDbRadialDimension', 'AcDbDiametricDimension', 'AcDb3PointAngularDimension', 'AcDbOrdinateDimension']
            .forEach((s) => assert.ok(T.some(([c, v]) => c === '100' && v === s), s));
        assert.ok(T.some(([c, v]) => c === '1001' && v === 'WEBCAD'), '拡張データ WEBCAD');
        assert.ok(T.some(([c, v], i) => c === '0' && v === 'APPID' && T.slice(i, i + 8).some(([c2, v2]) => c2 === '2' && v2 === 'WEBCAD')), 'APPID WEBCAD');
        assert.ok(T.some(([c, v], i) => c === '0' && v === 'DIMSTYLE' && T[i + 1][0] === '105' && T.slice(i, i + 8).some(([c2, v2]) => c2 === '2' && v2 === 'STANDARD')), '寸法スタイル STANDARD（ハンドルは 105）');
        // 座標寸法のブロックの2段（X・Y）は、文字の高さの 1.4 倍あける（AutoCAD では文字が画面より大きく見え、14/16 だと重なる）
        const ordText = (p) => { const i = T.findIndex(([c, v]) => c === '1' && v.startsWith(p)); assert.deepEqual([T[i - 3][0], T[i - 1][0]], ['20', '40']); return { y: Number(T[i - 3][1]), h: Number(T[i - 1][1]) }; };
        const ox = ordText('X: '), oy = ordText('Y: ');
        assert.ok(near(ox.y - oy.y, ox.h * 1.4, 1e-9), `座標寸法の2段の間 ${ox.y - oy.y}（高さ ${ox.h}）`);
        reimport(app, out);
        const after0 = app.val(`entities.filter(e => e.type === 'DIMENSION').map(e => { const c = Object.assign({}, e); delete c.id; delete c.bbox; delete c._hits; delete c.layer; return c; })`);
        assert.deepEqual(after0, before0);
        assert.equal(app.val(`entities.filter(e => e.type !== 'DIMENSION').length`), 0, '寸法のブロックの線・文字を、別に取り込んでいる');
    });

    it('DXF の作り: ハンドル（5・105）は重ならず $HANDSEED より小さい。寸法のブロックはブロックの表にもある', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'm'); entities.length = 0; addSurveyData(${JSON.stringify(PTS)}, []);
            entities.push({ type:'DIMENSION', subType:'ALIGNED', layer:0, color:null, p1:{x:0,y:0}, p2:{x:30,y:40}, offset:5 });
            entities.push({ type: 'TEXT', layer: 0, color: null, x: 1, y: 2, text: 'a\\nb', height: 0.5 });`);
        const T = tagsOf(exportText(app));
        const hs = T.map(([c, v], i) => (((c === '5' && T[i - 1][1] !== '$HANDSEED') || (c === '105' && T[i - 1][1] === 'DIMSTYLE')) ? parseInt(v, 16) : null)).filter((v) => v !== null); // ヘッダーの $HANDSEED の値（これも 5）は除く
        assert.equal(new Set(hs).size, hs.length, 'ハンドルが重なっている');
        const seedAt = T.findIndex(([c, v]) => c === '9' && v === '$HANDSEED');
        const seed = parseInt(T[seedAt + 1][1], 16);
        assert.ok(hs.every((h) => h < seed), `$HANDSEED ${seed.toString(16)} 以上のハンドルがある`);
        const names = (kind) => T.map(([c, v], i) => (c === '0' && v === kind) ? (T.slice(i, i + 12).find(([c2]) => c2 === '2') || [])[1] : null).filter(Boolean);
        const recs = new Set(names('BLOCK_RECORD')), blks = names('BLOCK');
        blks.forEach((b) => assert.ok(recs.has(b), `ブロックの表に無い: ${b}`));
        T.forEach(([c, v], i) => { if (c === '0' && v === 'DIMENSION') { const b = T.slice(i, i + 12).find(([c2]) => c2 === '2')[1]; assert.ok(blks.includes(b), `寸法のブロックが無い: ${b}`); } });
    });

    it('DWG に保存し直したもの（読込エンジンの形）でも、測点と寸法に戻る', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'm');`);
        const dim = { type: 'DIMENSION', subType: 'RADIUS', color: null, center: { x: 50, y: 0 }, radius: 5, angle: 0.5 };
        const chunks = app.val(`dxfOutXdataChunks(${JSON.stringify(dim)})`);
        app.window.__db = {
            header: {}, tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }, { name: '寸法', colorIndex: 4 }] }, BLOCK_RECORD: { entries: [] } },
            entities: [
                { type: 'INSERT', layer: '0', name: '測点', insertionPoint: { x: 20.25, y: 10.5, z: 3.456 }, attribs: [
                    { type: 'ATTRIB', tag: '点番号', text: '7', flags: 1, startPoint: { x: 20.25, y: 10.5 }, textHeight: 1, layer: '0' },
                    { type: 'ATTRIB', tag: '点名', text: 'BM1', flags: 0, startPoint: { x: 21, y: 11 }, textHeight: 1, layer: '0' },
                    { type: 'ATTRIB', tag: '標高', text: '3.456', flags: 1, startPoint: { x: 20.25, y: 10.5 }, textHeight: 1, layer: '0' }] },
                { type: 'DIMENSION', subclassMarker: 'AcDbRadialDimension', layer: '寸法', name: '*D9', measurement: 5, text: '', xdata: [{ appName: 'ACAD', value: [] }, { appName: 'WEBCAD', value: chunks.map((v) => ({ code: 1000, value: v })) }] },
            ],
        };
        const r = app.val(`(() => { entities.length = 0; return convertDwgDatabaseToApp(window.__db).entities; })()`);
        const pt = r.find((e) => e.type === 'POINT');
        assert.equal(pt.name, 'BM1'); assert.equal(pt.num, '7'); assert.equal(pt.z, 3.456);
        assert.ok(r.some((e) => e.type === 'TEXT' && e.ptLabel && e.text === 'BM1'));
        const d = r.find((e) => e.type === 'DIMENSION');
        assert.equal(d.subType, 'RADIUS'); assert.equal(d.radius, 5);
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
