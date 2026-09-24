'use strict';
// 測量計算（cad-cogo.js・cad-cogo-ui.js）のテスト:
//   座標求積（座標法）・地積の端数・辺長・逆計算・放射（方向角／後視と夾角）・交点（2直線・方向角・距離）、
//   求積表（CSV・図面の表）、パネルでの点の指定・キャンセル・測点の追加・元に戻す
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

// 独立に計算した面積（靴ひも公式）
const shoelace = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.X * q.Y - q.X * p.Y; } return Math.abs(a) / 2; };

describe('測量計算: 計算', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => app.eval(`localStorage.removeItem('cad_survey_unit'); entities.length = 0;`));

    it('度分秒の表記（秒の繰り上がり・360°の折り返し）', () => {
        assert.equal(app.eval('cogoFmtDms(0)'), '0°00′00″');
        assert.equal(app.eval('cogoFmtDms(45.5)'), '45°30′00″');
        assert.equal(app.eval('cogoFmtDms(123 + 45/60 + 6/3600)'), '123°45′06″');
        assert.equal(app.eval('cogoFmtDms(10 + 59/60 + 59.6/3600)'), '11°00′00″'); // 59.6″ は 60″ に繰り上がる
        assert.equal(app.eval('cogoFmtDms(359.9999999)'), '0°00′00″');
        assert.equal(app.eval('cogoFmtDms(-90)'), '270°00′00″');
        assert.equal(app.eval('cogoFmtDms(12 + 3/60 + 4.56/3600, 1)'), '12°03′04.6″');
    });
    it('逆計算: 方向角は北から時計回り（4つの向き）', () => {
        const inv = (X, Y) => app.val(`cogoInverse({ X: 0, Y: 0 }, { X: ${X}, Y: ${Y} })`);
        assert.ok(near(inv(10, 0).az, 0) && near(inv(10, 0).dist, 10));
        assert.ok(near(inv(0, 10).az, 90));
        assert.ok(near(inv(-10, 0).az, 180));
        assert.ok(near(inv(0, -10).az, 270));
        const r = inv(3, 4);
        assert.ok(near(r.dist, 5) && near(r.dX, 3) && near(r.dY, 4));
        assert.ok(near(r.az, Math.atan2(4, 3) * 180 / Math.PI));
    });
    it('放射: 逆計算と往復すると元の点に戻る。後視点を 0° とした夾角', () => {
        const p = app.val(`cogoPolar({ X: 100, Y: 200 }, 123.456, 45.678)`);
        const r = app.val(`cogoInverse({ X: 100, Y: 200 }, ${JSON.stringify(p)})`);
        assert.ok(near(r.az, 123.456, 1e-9) && near(r.dist, 45.678, 1e-9));
        // 器械点(0,0)・後視点は北。右回りに 90° は東
        assert.ok(near(app.eval(`cogoAzFromBacksight({ X: 0, Y: 0 }, { X: 10, Y: 0 }, 90)`), 90));
        // 後視点が東なら、右回り 90° は南
        assert.ok(near(app.eval(`cogoAzFromBacksight({ X: 0, Y: 0 }, { X: 0, Y: 10 }, 90)`), 180));
        assert.ok(near(app.eval(`cogoAzFromBacksight({ X: 0, Y: 0 }, { X: 0, Y: -10 }, 270)`), 180));
    });
    it('交点: 2直線（延長線上も）・平行・方向角', () => {
        const p = app.val(`cogoIntersectLines({ X: 0, Y: 0 }, { X: 10, Y: 10 }, { X: 0, Y: 10 }, { X: 10, Y: 0 })`);
        assert.ok(near(p.X, 5) && near(p.Y, 5));
        const e = app.val(`cogoIntersectLines({ X: 0, Y: 0 }, { X: 1, Y: 0 }, { X: 5, Y: 3 }, { X: 5, Y: 4 })`); // 延長線上
        assert.ok(near(e.X, 5) && near(e.Y, 0));
        assert.equal(app.eval(`cogoIntersectLines({ X: 0, Y: 0 }, { X: 1, Y: 1 }, { X: 0, Y: 1 }, { X: 2, Y: 3 })`), null);
        const a = app.val(`cogoIntersectAzimuths({ X: 0, Y: 0 }, 45, { X: 0, Y: 10 }, 315)`);
        assert.ok(near(a.X, 5) && near(a.Y, 5));
    });
    it('交点: 距離×2 は A→B の右側・左側の2つ。届かなければ null', () => {
        // A(0,0)→B(北へ 10)。右側は東（Y+）
        const r = app.val(`cogoIntersectDistances({ X: 0, Y: 0 }, 5 * Math.SQRT2, { X: 10, Y: 0 }, 5 * Math.SQRT2)`);
        assert.ok(near(r.right.X, 5) && near(r.right.Y, 5), JSON.stringify(r));
        assert.ok(near(r.left.X, 5) && near(r.left.Y, -5));
        assert.equal(app.eval(`cogoIntersectDistances({ X: 0, Y: 0 }, 2, { X: 10, Y: 0 }, 3)`), null);
        assert.equal(app.eval(`cogoIntersectDistances({ X: 0, Y: 0 }, 20, { X: 10, Y: 0 }, 3)`), null);
    });
    it('座標求積: 倍面積・面積・周長・辺長（靴ひも公式と一致、回る向きによらない）', () => {
        const pts = [{ name: 'A', X: 0, Y: 0 }, { name: 'B', X: 0, Y: 20 }, { name: 'C', X: 15, Y: 25 }, { name: 'D', X: 20, Y: 5 }];
        const t = app.val(`cogoAreaTable(${JSON.stringify(pts)})`);
        assert.ok(near(t.area, shoelace(pts)));
        assert.ok(near(t.twice, 2 * t.area));
        assert.equal(t.rows.length, 4);
        assert.ok(near(t.rows[0].dY, 20 - 5)); // Yn+1 − Yn−1（B と D）
        assert.ok(near(t.rows[0].side, 20));   // A→B
        assert.ok(near(t.perimeter, t.rows.reduce((s, r) => s + r.side, 0)));
        const rev = app.val(`cogoAreaTable(${JSON.stringify(pts.slice().reverse())})`);
        assert.ok(near(rev.area, t.area));
        assert.ok(Math.sign(rev.twiceSigned) === -Math.sign(t.twiceSigned));
        // 大きな公共座標（平面直角座標）でも精度が落ちない
        const big = pts.map((p) => ({ name: p.name, X: p.X - 35000.123, Y: p.Y + 20000.456 }));
        assert.ok(near(app.val(`cogoAreaTable(${JSON.stringify(big)})`).area, t.area, 1e-6));
    });
    it('地積の端数: 0.01㎡未満を切り捨て／1㎡未満を切り捨て（10㎡以下はそのまま）。誤差で1つ下にならない', () => {
        assert.equal(app.eval(`cogoLandArea(123.456789, 'cm')`), '123.45');
        assert.equal(app.eval(`cogoLandArea(0.1 + 0.2 + 12.04, 'cm')`), '12.34'); // 12.339999… にならない
        assert.equal(app.eval(`cogoLandArea(123.999, 'm')`), '123');
        assert.equal(app.eval(`cogoLandArea(9.876, 'm')`), '9.87');
    });
    it('ねじれた（辺が交わる）区画を見分ける', () => {
        assert.equal(app.eval(`cogoSelfIntersects([{ X: 0, Y: 0 }, { X: 10, Y: 10 }, { X: 10, Y: 0 }, { X: 0, Y: 10 }])`), true);
        assert.equal(app.eval(`cogoSelfIntersects([{ X: 0, Y: 0 }, { X: 0, Y: 10 }, { X: 10, Y: 10 }, { X: 10, Y: 0 }])`), false);
        assert.equal(app.eval(`cogoSelfIntersects([{ X: 0, Y: 0 }, { X: 0, Y: 10 }, { X: 10, Y: 0 }])`), false);
    });
    it('全角の数字・マイナス・「X,Y」を読む', () => {
        assert.equal(app.eval(`cogoParseNum('１２．５')`), 12.5);
        assert.equal(app.eval(`cogoParseNum('－３')`), -3);
        assert.ok(Number.isNaN(app.eval(`cogoParseNum('12a')`)));
        assert.ok(near(app.eval(`cogoParseAngle('４５\u3000３０\u3000００')`), 45.5));
        assert.deepEqual(app.val(`cogoParseXY('100,200')`), { x: 200, y: 100 }); // X＝北＝図面の y
        assert.deepEqual(app.val(`cogoParseXY('－１０，２０')`), { x: 20, y: -10 });
        assert.equal(app.eval(`cogoParseXY('KP1')`), null);
    });
    it('求積表の CSV と、図面に置く表（線と文字）', () => {
        const pts = [{ name: 'KP1', X: 0, Y: 0 }, { name: 'KP2', X: 0, Y: 10 }, { name: 'KP3', X: 10, Y: 10 }, { name: 'KP4', X: 10, Y: 0 }];
        const csv = app.eval(`cogoAreaCsv('848-1', cogoAreaTable(${JSON.stringify(pts)}), 'cm')`);
        const L = csv.trim().split('\r\n');
        assert.equal(L[0], '座標求積表,848-1');
        assert.equal(L[1], '点名,X,Y,Yn+1−Yn−1,Xn×(Yn+1−Yn−1),辺長');
        assert.equal(L[2], 'KP1,0.000,0.000,10.000,0.000000,10.000');
        assert.ok(L.includes(',,,,地積（㎡）,100.00'), csv);
        const r = app.val(`cogoAreaTableEntities(cogoAreaTable(${JSON.stringify(pts)}), { left: 100, top: 50, h: 1, layer: 0, title: '848-1', landMode: 'cm' })`);
        const texts = r.entities.filter((e) => e.type === 'TEXT').map((e) => e.text);
        assert.ok(texts.includes('座標求積表\u3000848-1') && texts.includes('KP3') && texts.includes('地積（㎡）') && texts.includes('100.00'));
        assert.ok(r.entities.some((e) => e.type === 'LINE'));
        // 表は左上（100, 50）から右下へ広がる
        r.entities.forEach((e) => { if (e.type === 'LINE') { assert.ok(e.x1 >= 100 - 1e-9 && e.y1 <= 50 + 1e-9); } });
        assert.ok(near(r.height, (2 + 4 + 3) * 1.8));
    });
    it('辺長の文字は区画の外側・逆さまにならない向き', () => {
        const ents = app.val(`cogoSideLabelEntities([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], 1, 0)`);
        assert.equal(ents.length, 4);
        assert.deepEqual(ents.map((e) => e.text), ['10.000', '5.000', '10.000', '5.000']);
        assert.ok(ents[0].y < 0 && ents[2].y > 5 && ents[1].x > 10 && ents[3].x < 0, JSON.stringify(ents));
        ents.forEach((e) => assert.ok(e.rotation > -Math.PI / 2 - 1e-9 && e.rotation <= Math.PI / 2 + 1e-9, String(e.rotation)));
    });
    it('点名の引き当て・次の点名の案', () => {
        app.eval(`addSurveyData([{ num: '1', name: 'KP1', X: 10, Y: 20 }, { num: '2', name: 'P5', X: 30, Y: 40 }], [])`);
        assert.deepEqual(app.val(`cogoFindPoint('KP1')`), { x: 20, y: 10, name: 'KP1' });
        assert.deepEqual(app.val(`cogoFindPoint('kp1')`), { x: 20, y: 10, name: 'KP1' });
        assert.equal(app.eval(`cogoFindPoint('2').name`), 'P5');
        assert.equal(app.eval(`cogoFindPoint('無い点')`), null);
        assert.equal(app.eval(`cogoPointNameAt(20, 10)`), 'KP1');
        assert.equal(app.eval(`cogoPointNameAt(20.1, 10)`), '');
        assert.equal(app.eval(`cogoNextName('P4')`), 'P6'); // P5 はすでにある
        assert.equal(app.eval(`cogoNextName('No.09')`), 'No.10');
        assert.equal(app.eval(`cogoNextName('')`), 'P1');
    });
});

describe('測量計算: パネルと図面での指定', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand(); localStorage.removeItem('cad_survey_unit');
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true }); currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 4, rotation: 0 }; snapResult = null;
            _cogo.slots = {}; _cogo.vals = {}; _cogo.area = null; _cogo.pick = null; _cogo.lastName = '';
            addSurveyData([{ num: '1', name: 'KP1', X: 0, Y: 0 }, { num: '2', name: 'KP2', X: 0, Y: 20 }, { num: '3', name: 'KP3', X: 15, Y: 20 }, { num: '4', name: 'KP4', X: 15, Y: 0 }],
                [{ num: '1', name: '848-1', refs: [{ num: '1' }, { num: '2' }, { num: '3' }, { num: '4' }] }]);
            undoStack.length = 0;
        `);
    });
    const panelText = () => app.eval(`document.getElementById('property-panel-content').textContent`);
    const panelTitle = () => app.eval(`document.getElementById('property-panel').style.display === 'flex' ? document.getElementById('property-panel-title').textContent : ''`);
    const lotIdx = () => app.eval(`entities.findIndex(e => e.type === 'PLINE' && e.lotName === '848-1')`);

    it('区画から選ぶと求積表を出す（点名は測点から）', () => {
        app.eval(`showCogoPanel('area'); cogoChooseLot(String(entities[${lotIdx()}].id))`);
        assert.equal(panelTitle(), '🧮 測量計算');
        const t = panelText();
        assert.match(t, /KP1/); assert.match(t, /KP3/);
        assert.match(t, /300\.000000/); // 面積 15×20
        assert.match(t, /300\.00/);
        assert.match(t, /周長（m）/);
    });
    // 図面の (x, y) をタップ（指の位置 = 画面の座標と図面の座標の両方）
    const tap = (x, y) => app.run(`entities.forEach(e => { if(e.type !== 'DIMENSION') e.bbox = calcBBox(e); }); _bumpGeomEpoch();
        const s = wcsToScreen(${x}, ${y}); mouse.screenX = s.x; mouse.screenY = s.y; mouse.wcsX = ${x}; mouse.wcsY = ${y}; handlePointInput({ x: ${x}, y: ${y} }, false);`);
    it('「区画をタップ」で選ぶ（何も無い所では選ばない）', () => {
        app.eval(`cogoPickLot()`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_COGO_LOT');
        tap(100, 100); // 何も無い所: そのまま待つ
        assert.equal(app.eval('cmdState.mode'), 'WAITING_COGO_LOT');
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /線か内側/);
        tap(10, 15); // 区画の辺（北側の辺の中ほど）
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(panelTitle(), '🧮 測量計算');
        assert.match(panelText(), /300\.00/);
    });
    it('区画の内側・区画名の文字をタップしても、その区画を選ぶ（重なっていれば小さい方）', () => {
        app.eval(`entities.push({ type: 'RECTANG', layer: 0, color: null, x1: 1, y1: 1, x2: 6, y2: 5 }); ensureEntityIds();`); // 区画の中の小さな形
        app.eval(`cogoPickLot()`); tap(12, 11); // 区画の内側（線・文字から離れた所）
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(app.eval(`_cogo.area.id === entities[${lotIdx()}].id`), true);
        app.eval(`cogoPickLot()`); tap(3, 3); // 小さな形の内側
        assert.equal(app.eval(`entities[entityIndexById(_cogo.area.id)].type`), 'RECTANG');
        // 区画名の文字（区画の重心）をタップ
        const c = app.val(`(() => { const t = entities.find(e => e.type === 'TEXT' && e.text === '848-1'); return { x: t.x, y: t.y }; })()`);
        app.eval(`cogoPickLot()`); tap(c.x, c.y);
        assert.equal(app.eval(`_cogo.area.id === entities[${lotIdx()}].id`), true);
    });
    it('点の指定中にタブを切り替えると、指定をやめる（見えない欄に点が入らない）', () => {
        app.eval(`showCogoPanel('inv'); cogoPick('IA'); cogoSetTab('pt')`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(app.eval('_cogo.pick'), null);
        assert.equal(panelTitle(), '🧮 測量計算');
    });
    it('逆計算: 📍 で始点→終点を続けて指定（点名は測点から）、ログに残す', () => {
        app.eval(`showCogoPanel('inv'); cogoPick('IA')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT');
        app.eval(`snapResult = { wcsX: 0, wcsY: 0, type: '点' }; handlePointInput({ x: 0, y: 0 }, false)`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMCOGO_PT', '終点の指定へ進んでいない');
        app.eval(`snapResult = { wcsX: 20, wcsY: 15, type: '点' }; handlePointInput({ x: 20, y: 15 }, false)`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(panelTitle(), '🧮 測量計算');
        const t = panelText();
        assert.match(t, /25\.000 m/);            // 3:4:5
        assert.match(t, /53°07′48″/);            // atan2(20, 15)
        assert.match(t, /233°07′48″/);           // 逆方向角
        assert.equal(app.eval(`_cogo.slots.IA.name`), 'KP1');
        assert.equal(app.eval(`_cogo.slots.IB.name`), 'KP3');
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /逆計算 KP1→KP3: 距離 25\.000m 方向角 53°07′48″/);
    });
    it('点の指定を ❌終了・Esc でやめるとパネルに戻る', () => {
        app.eval(`showCogoPanel('inv'); cogoPick('IA'); issueCommand('CANCEL')`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(panelTitle(), '🧮 測量計算');
        app.eval(`cogoPick('IA'); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(panelTitle(), '🧮 測量計算');
    });
    it('欄に点名・点番号・「X,Y」を入れて指定できる。無い点名は知らせる', () => {
        app.eval(`showCogoPanel('inv'); cogoSlotTyped('IA', 'KP2'); cogoSlotTyped('IB', '4')`);
        assert.match(panelText(), /25\.000 m/); // KP2(0,20)→KP4(15,0)
        app.eval(`cogoSlotTyped('IB', '15,20')`);
        assert.equal(app.eval(`_cogo.slots.IB.name`), 'KP3'); // 座標で入れても同じ位置の測点名を使う
        app.eval(`cogoSlotTyped('IA', '無い点')`);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /見つかりません/);
        assert.equal(app.eval(`_cogo.slots.IA.name`), 'KP2'); // 前の指定は残る
    });
    it('点の追加: 方向角と距離・後視点と夾角・座標。元に戻すは1回で1点', () => {
        app.eval(`showCogoPanel('pt'); cogoSetPtMode('azi'); cogoSlotTyped('PS', 'KP1'); cogoValInput('az', '90 00 00'); cogoValInput('dist', '10'); cogoValInput('ptName', 'N1'); cogoAddPoint()`);
        let p = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'N1')`);
        assert.ok(p && near(p.x, 10) && near(p.y, 0), JSON.stringify(p)); // 東へ 10
        assert.equal(app.eval(`_cogo.vals.ptName`), 'N2'); // 次の名前の案
        app.eval(`cogoSetPtMode('bs'); cogoSlotTyped('PB', 'KP2'); cogoValInput('ang', '90'); cogoValInput('dist', '５'); cogoAddPoint()`);
        p = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'N2')`);
        assert.ok(p && near(p.x, 0) && near(p.y, -5), JSON.stringify(p)); // 後視 KP2（東）から右回り 90° ＝ 南
        app.eval(`cogoSetPtMode('xy'); cogoValInput('X', '-1.5'); cogoValInput('Y', '2.5'); cogoAddPoint()`);
        p = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'N3')`);
        assert.ok(p && near(p.x, 2.5) && near(p.y, -1.5));
        const n = app.eval(`entities.length`);
        app.eval('undo()');
        assert.equal(app.eval(`entities.length`), n - 2); // 点と点名の文字
        assert.equal(app.eval(`entities.some(e => e.name === 'N3')`), false);
    });
    it('点の追加: 同じ点名があるときは確かめる（やめたら追加しない）', () => {
        let asked = '';
        app.window.confirm = (m) => { asked = m; return false; };
        const n = app.eval('entities.length');
        app.eval(`showCogoPanel('pt'); cogoSetPtMode('xy'); cogoValInput('X', '1'); cogoValInput('Y', '1'); cogoValInput('ptName', 'KP1'); cogoAddPoint()`);
        assert.match(asked, /KP1/);
        assert.equal(app.eval('entities.length'), n);
    });
    it('交点: 2直線（点名で指定）・距離×2 の右／左を選んで追加', () => {
        app.eval(`showCogoPanel('int'); cogoSetIntMode('ll');
            cogoSlotTyped('LA1', 'KP1'); cogoSlotTyped('LA2', 'KP3'); cogoSlotTyped('LB1', 'KP2'); cogoSlotTyped('LB2', 'KP4');
            cogoValInput('intName', 'C1'); cogoAddPoint()`);
        let p = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'C1')`);
        assert.ok(p && near(p.x, 10) && near(p.y, 7.5), JSON.stringify(p)); // 対角線の交点
        app.eval(`cogoSetIntMode('dd'); cogoSlotTyped('DA', 'KP1'); cogoSlotTyped('DB', 'KP4'); cogoValInput('dA', String(Math.hypot(7.5, 5))); cogoValInput('dB', String(Math.hypot(7.5, 5)))`);
        assert.match(panelText(), /A→B の右側/);
        app.eval(`cogoSetDdSide('right'); cogoValInput('intName', 'C2'); cogoAddPoint(); cogoSetDdSide('left'); cogoValInput('intName', 'C3'); cogoAddPoint()`);
        p = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'C2')`);
        assert.ok(p && near(p.x, 5) && near(p.y, 7.5), JSON.stringify(p)); // KP1→KP4（北）の右＝東
        p = app.val(`entities.find(e => e.type === 'POINT' && e.name === 'C3')`);
        assert.ok(p && near(p.x, -5) && near(p.y, 7.5), JSON.stringify(p));
        // 届かない距離は知らせる
        app.eval(`cogoValInput('dA', '1'); cogoValInput('dB', '1')`);
        assert.match(panelText(), /交わりません/);
    });
    it('求積表を図面に置く・辺長・面積の記入はそれぞれ1つのまとまりで、元に戻すは1回', () => {
        app.eval(`showCogoPanel('area'); cogoChooseLot(String(entities[${lotIdx()}].id))`);
        const n0 = app.eval('entities.length');
        app.eval('cogoPlaceAreaTable()');
        const tbl = app.val(`entities.slice(${n0})`);
        assert.ok(tbl.length > 10);
        assert.equal(new Set(tbl.map((e) => e.gid)).size, 1);
        assert.ok(tbl.every((e) => e.blockName === '求積表'));
        assert.ok(tbl.some((e) => e.type === 'TEXT' && e.text === '座標求積表\u3000848-1'));
        assert.ok(tbl.every((e) => e.type !== 'TEXT' || e.x > 20), '表が区画に重なっている'); // 区画の右（東）に置く
        app.eval('cogoWriteSides(); cogoWriteArea()');
        const notes = app.val(`entities.slice(${n0 + tbl.length})`);
        assert.deepEqual(notes.filter((e) => e.blockName === '辺長').map((e) => e.text).sort(), ['15.000', '15.000', '20.000', '20.000']);
        assert.ok(notes.some((e) => e.blockName === '面積' && e.text === '300.00㎡'));
        app.eval('undo(); undo(); undo()');
        assert.equal(app.eval('entities.length'), n0);
    });
    it('求積表の CSV を出力する（ファイル名に区画名）', async () => {
        app.eval(`showCogoPanel('area'); cogoChooseLot(String(entities[${lotIdx()}].id));
            window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; }; cogoExportAreaCsv(); downloadBlob = window.__dl;`);
        assert.match(app.eval('window.__name'), /_求積表_848-1\.csv$/);
        const text = await app.eval('new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(window.__blob); })');
        assert.match(text, /^\uFEFF?座標求積表,848-1/);
        assert.match(text, /地積（㎡）,300\.00/);
    });
    it('図面の単位が mm でも、面積は ㎡・距離は m で計算する', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm');
            entities.push({ type: 'PLINE', layer: 0, color: null, closed: true, points: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 5000 }, { x: 0, y: 5000 }] });
            ensureEntityIds(); showCogoPanel('area'); _cogoUseEntity(entities.length - 1); _cogoRender();`);
        assert.match(panelText(), /50\.000000/);
        app.eval(`cogoSetTab('inv'); cogoSlotTyped('IA', '0,0'); cogoSlotTyped('IB', '3,4')`);
        assert.match(panelText(), /5\.000 m/);
        assert.deepEqual(app.val('[_cogo.slots.IB.x, _cogo.slots.IB.y]'), [4000, 3000]);
    });
    it('ねじれた区画は注意を出す', () => {
        app.eval(`entities.push({ type: 'PLINE', layer: 0, color: null, closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }] });
            ensureEntityIds(); showCogoPanel('area'); _cogoUseEntity(entities.length - 1); _cogoRender();`);
        assert.match(panelText(), /辺が交わっています/);
    });
    it('区画名に書かれた HTML を画面に入れない', () => {
        app.eval(`entities.push({ type: 'PLINE', layer: 0, color: null, closed: true, lotName: '<img id="pwnC" src="x">', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
            ensureEntityIds(); showCogoPanel('area'); _cogoUseEntity(entities.length - 1); _cogoRender();`);
        assert.equal(app.eval(`!!document.getElementById('pwnC')`), false);
    });
    it('コマンド（AREA・INV・COGO）でパネルを開く。重ね表示を描いてもエラーにならない', () => {
        app.eval(`processCommand('AREA')`);
        assert.equal(app.eval('_cogo.tab'), 'area');
        assert.equal(panelTitle(), '🧮 測量計算');
        app.eval(`processCommand('INV'); cogoSlotTyped('IA', 'KP1'); cogoSlotTyped('IB', 'KP3'); _drawFrame(false)`);
        app.eval(`cogoSetTab('int'); cogoSetIntMode('aa'); cogoSlotTyped('AA', 'KP1'); cogoSlotTyped('AB', 'KP2'); cogoValInput('azA', '30'); cogoValInput('azB', '150'); _drawFrame(false)`);
        app.eval(`cogoSetIntMode('dd'); cogoSlotTyped('DA', 'KP1'); cogoSlotTyped('DB', 'KP2'); cogoValInput('dA', '15'); cogoValInput('dB', '15'); _drawFrame(false)`);
        app.eval(`processCommand('COGO'); cogoSetTab('area'); cogoChooseLot(String(entities[${lotIdx()}].id)); _drawFrame(false)`);
        assert.deepEqual(app.errors(), []);
    });
    it('点の指定中は手順カード「🧮 測量計算」を出す', () => {
        assert.equal(app.eval(`_guideHintFor('WAITING_DIMCOGO_PT').key`), 'COGO');
        assert.equal(app.eval(`_guideHintFor('WAITING_COGO_LOT').key`), 'COGOLOT');
    });
});
