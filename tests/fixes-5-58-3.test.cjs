'use strict';
// v5.58.3 で直した不具合のテスト（本物の Chrome で作図・編集・保存・取り込みを総当たりして見つけたもの）:
//   1. OFFSET で選んだ図形が消えたあと（↩・ファイルの置き換え）にクリックすると、クリックのたびにエラーになっていた
//   2. コマンドの途中でファイルを「置き換える」で開いても、コマンドが続いて、前の図面の点・図形で作図していた
//   3. DXF に書き出して開き直すと、区画名が消えて、SIMA 出力が「区画1」になっていた
//   4. ポリライン: 2点で C と打つと、2点の「閉じた」ポリラインができていた（下のバーは3点以上と断る）
//   5. PC: 図面をクリックしたあとの Enter が効かなかった（フォーカスがコマンド欄に無いとき）
//   6. 「置き換える」で開いた直後に ↩ すると、現在の画層が 0 のままだった
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

function exportText(app) {
    app.eval(`window.downloadBlob = () => {}; window.__OB = window.Blob; window.Blob = function (parts, opt) { window.__parts = parts; return new window.__OB(parts, opt); }; exportDxf(); window.Blob = window.__OB;`);
    return app.val('window.__parts.join("")');
}
function reimport(app, text) {
    app.window.__t = text;
    app.eval(`(() => { entities.length = 0; layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); _importMode = 'fresh';
        const p = new window.DxfParser(); registerExtraDxfHandlers(p, window.__t); importDxfData(p.parseSync(window.__t), { skipUndo: true, text: window.__t }); })()`);
}
const LINE = `{ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 100, y2: 0 }`;

describe('v5.58.3 の不具合の修正', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            localStorage.setItem('cad_survey_unit', 'm'); cmdState.selectedIndices = [];
            ucs = { originX: 0, originY: 0, angle: 0 }; view = { x: 400, y: 300, scale: 1, rotation: 0 };`);
    });

    it('OFFSET: 選んだ図形が ↩ で消えたあとにクリックしても、エラーにならず対象を選び直す', () => {
        app.eval(`saveUndo(); entities.push(${LINE}); processCommand('OFFSET'); processCommand('5');
            cmdState.offsetTarget = 0; cmdState.highlightIdx = 0; cmdState.mode = 'WAITING_OFFSET_SIDE'; undo();`);
        assert.equal(app.val('entities.length'), 0);
        assert.doesNotThrow(() => app.eval('handlePointInput({ x: 50, y: 20 }, true)'));
        assert.equal(app.val('cmdState.mode'), 'WAITING_OFFSET_SELECT');
        assert.equal(app.val('entities.length'), 0, '図形はできない');
        assert.equal(app.val('createOffsetEntity(undefined, 5, 0, 0)'), null);
        // 図形があれば、今までどおりオフセットできる
        app.eval(`entities.push(${LINE}); cmdState.offsetTarget = 0; cmdState.mode = 'WAITING_OFFSET_SIDE'; handlePointInput({ x: 50, y: 20 }, true);`);
        assert.equal(app.val('entities.length'), 2);
        assert.equal(app.val('entities[1].y1'), 5);
    });

    it('「置き換える」で開くと、途中のコマンドをやめる（前の図面の点から線を引かない）。「追加」では続ける', () => {
        app.eval(`entities.push(${LINE}); processCommand('LINE'); handlePointInput({ x: 150, y: 0 }, true);`);
        assert.equal(app.val('cmdState.mode'), 'WAITING_LINE_P2');
        app.eval(`window.__cc = cadChoose; cadChoose = (o, cb) => cb('replace'); try { _prepareImportTarget(() => {}); } finally { cadChoose = window.__cc; }`);
        assert.equal(app.val('cmdState.mode'), 'IDLE');
        assert.equal(app.val('entities.length'), 0);
        assert.equal(app.val(`document.getElementById('fs-dim-actionbar').style.display`), 'none', '下のバーも片付ける');
        app.eval('handlePointInput({ x: 900, y: 900 }, true)');
        assert.equal(app.val(`entities.filter(e => e.type === 'LINE').length`), 0, '前の図面の点からの線ができない');
        // 追加: 図形は残るので、コマンドは続けてよい
        app.eval(`resetCommand(); entities.push(${LINE}); processCommand('LINE'); handlePointInput({ x: 150, y: 0 }, true);
            cadChoose = (o, cb) => cb('append'); try { _prepareImportTarget(() => {}); } finally { cadChoose = window.__cc; }`);
        assert.equal(app.val('cmdState.mode'), 'WAITING_LINE_P2');
    });

    it('DXF に書き出して開き直しても、区画名・区画番号が残る（SIMA 出力の区画名が同じ）', () => {
        const pts = [{ num: '1', name: 'K1', X: 0, Y: 0, z: null }, { num: '2', name: 'K2', X: 0, Y: 10, z: null }, { num: '3', name: 'K3', X: 10, Y: 10, z: null }, { num: '4', name: 'K4', X: 10, Y: 0, z: null }];
        const lots = [{ num: '7', name: '848-1', refs: [{ num: '1' }, { num: '2' }, { num: '3' }, { num: '4' }] }];
        app.eval(`addSurveyData(${JSON.stringify(pts)}, ${JSON.stringify(lots)}); entities.push({ type: 'PLINE', layer: 0, color: null, closed: true, points: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }] });`);
        const sima0 = app.val(`buildSimaText('t').text`);
        assert.match(sima0, /D00,1,848-1,1,/);
        const out = exportText(app);
        const L = out.split(/\r?\n/);
        const i = L.findIndex((s) => s.startsWith('WEBCAD:') && s.includes('"lot":1'));
        assert.ok(i > 0 && L[i - 1].trim() === '1000' && L[i - 2] === 'WEBCAD' && L[i - 3].trim() === '1001', '区画の拡張データ（1001 WEBCAD・1000）');
        assert.equal(L.filter((s) => s.startsWith('WEBCAD:') && s.includes('"lot":1')).length, 1, '区画でないポリラインには書かない');
        reimport(app, out);
        const pl = app.val(`entities.filter(e => e.type === 'PLINE').map(e => ({ n: e.lotName, k: e.lotNum, c: e.closed, p: e.points.length }))`);
        assert.equal(pl.length, 2);
        assert.deepEqual({ ...pl.find((e) => e.n) }, { n: '848-1', k: '7', c: true, p: 4 });
        assert.equal(pl.filter((e) => e.n === undefined).length, 1, 'ふつうのポリラインは区画にしない');
        assert.match(app.val(`buildSimaText('t').text`), /D00,1,848-1,1,/);
    });

    it('区画の拡張データ: DWG に保存し直したもの（読込エンジンの形）でも戻る。中身がおかしければ区画にしない', () => {
        const chunks = app.val(`dxfOutXdataChunks({ lot: 1, lotName: '宅地A', lotNum: '12' })`);
        assert.ok(chunks[0].startsWith('WEBCAD:') && !/[^\x20-\x7e]/.test(chunks.join('')), '日本語は \\uXXXX にする');
        assert.deepEqual({ ...app.val(`webcadLotFromXdata(${JSON.stringify([...chunks])})`) }, { lotName: '宅地A', lotNum: '12' });
        assert.equal(app.val(`webcadLotFromXdata(['WEBCAD:{"type":"DIMENSION"}'])`), null);
        assert.equal(app.val(`webcadLotFromXdata(['WEBCAD:{"lot":1}'])`), null, '名前も番号も無い');
        assert.equal(app.val(`webcadLotFromXdata(['WEBCAD:{"lot":1,"lotName":{"a":1}}'])`), null, '文字でない');
        assert.equal(app.val(`webcadLotFromXdata(['WEBCAD:こわれた'])`), null);
        assert.equal(app.val(`webcadLotFromXdata(null)`), null);
        assert.equal(app.val(`webcadEntityFromXdata(${JSON.stringify([...chunks])})`), null, '区画は寸法として扱わない');
        app.window.__db = {
            header: {}, tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] }, BLOCK_RECORD: { entries: [] } },
            entities: [
                { type: 'LWPOLYLINE', layer: '0', flag: 512, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], xdata: [{ appName: 'WEBCAD', value: chunks.map((v) => ({ code: 1000, value: v })) }] },
                { type: 'LWPOLYLINE', layer: '0', flag: 0, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], xdata: [{ appName: 'WEBCAD', value: chunks.map((v) => ({ code: 1000, value: v })) }] },
                { type: 'LWPOLYLINE', layer: '0', flag: 512, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
            ],
        };
        const r = app.val(`(() => { entities.length = 0; return convertDwgDatabaseToApp(window.__db).entities.map(e => ({ n: e.lotName, k: e.lotNum, c: e.closed })); })()`);
        assert.deepEqual(r.map((e) => ({ ...e })), [{ n: '宅地A', k: '12', c: true }, { c: false }, { c: true }]);
    });

    it('ポリライン: C で閉じるには3点以上（2点では閉じず、続けられる）', () => {
        app.eval(`processCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true);`);
        assert.equal(app.val(`processCommand('C')`), false);
        assert.equal(app.val('cmdState.mode'), 'WAITING_PLINE_NEXT');
        assert.equal(app.val('entities.length'), 0);
        assert.equal(app.val('cmdState.points.length'), 2, '打った点は残る');
        app.eval(`handlePointInput({ x: 10, y: 10 }, true); processCommand('C');`);
        assert.deepEqual({ ...app.val(`({ n: entities.length, c: entities[0].closed, p: entities[0].points.length, m: cmdState.mode })`) }, { n: 1, c: true, p: 3, m: 'IDLE' });
    });

    it('PC: フォーカスがコマンド欄に無くても、Enter でポリライン・線分を終える（ボタンにフォーカスがあるときは何もしない）', () => {
        const key = (target) => app.eval(`(() => { const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); ${target}.dispatchEvent(ev); window.__prevented = ev.defaultPrevented; })()`);
        app.eval(`processCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); handlePointInput({ x: 10, y: 10 }, true);`);
        // ボタンにフォーカス: そのボタンを押す動きに任せる
        app.eval(`window.__b = document.createElement('button'); document.body.appendChild(window.__b);`);
        key('window.__b');
        assert.equal(app.val('cmdState.mode'), 'WAITING_PLINE_NEXT');
        app.eval('window.__b.remove()');
        key('document.body');
        assert.deepEqual({ ...app.val(`({ n: entities.length, c: entities[0].closed, p: entities[0].points.length, m: cmdState.mode, pd: window.__prevented })`) }, { n: 1, c: false, p: 3, m: 'IDLE', pd: true });
        // 線分
        app.eval(`processCommand('LINE'); handlePointInput({ x: 0, y: 50 }, true); handlePointInput({ x: 10, y: 50 }, true);`);
        assert.equal(app.val('cmdState.mode'), 'WAITING_LINE_P2');
        key('document.body');
        assert.equal(app.val('cmdState.mode'), 'IDLE');
        assert.equal(app.val(`entities.filter(e => e.type === 'LINE').length`), 1);
        // 何もしていないとき・ほかのコマンドの途中では、何もしない
        key('document.body');
        assert.equal(app.val('window.__prevented'), false);
        app.eval(`processCommand('CIRCLE'); hidePropertyPanel();`);
        const m = app.val('cmdState.mode');
        key('document.body');
        assert.equal(app.val('cmdState.mode'), m);
        // 入力欄の中の Enter は、今までどおりその欄のもの
        app.eval(`resetCommand(); processCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true);
            window.__i = document.createElement('input'); document.body.appendChild(window.__i);`);
        key('window.__i');
        assert.equal(app.val('cmdState.mode'), 'WAITING_PLINE_NEXT');
        app.eval('window.__i.remove(); resetCommand();');
    });

    it('「置き換える」を ↩ で戻すと、現在の画層も戻る。ふつうの作図の ↩ では、選んでいる画層を変えない', () => {
        app.eval(`layers.push({ name: 'A', color: '#ff0000', visible: true }, { name: 'MYLAYER', color: '#00ff00', visible: true }); currentLayerIndex = 2; initLayers();
            entities.push(${LINE});
            window.__cc = cadChoose; cadChoose = (o, cb) => cb('replace'); try { _prepareImportTarget(() => {}); } finally { cadChoose = window.__cc; }
            layers.push({ name: '新しい図面の画層', color: '#ffffff', visible: true }); entities.push({ type: 'LINE', layer: 1, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }); initLayers();`);
        assert.equal(app.val('currentLayerIndex'), 0, '置き換えた直後は 0');
        app.eval('undo()');
        assert.equal(app.val('layers[currentLayerIndex].name'), 'MYLAYER');
        assert.equal(app.val(`document.getElementById('layer-select').value`), '2', '画層の欄も同じ');
        app.eval('redo()');
        assert.equal(app.val('layers[currentLayerIndex].name'), '0');
        app.eval('undo()');
        assert.equal(app.val('layers[currentLayerIndex].name'), 'MYLAYER', 'やり直してから戻しても同じ');
        // ふつうの作図: 線を描く → 画層を切り替える → ↩。切り替えた画層のまま
        app.eval(`saveUndo(); entities.push({ type: 'LINE', layer: 2, color: null, x1: 0, y1: 5, x2: 9, y2: 5 }); currentLayerIndex = 1; initLayers(); undo();`);
        assert.equal(app.val('layers[currentLayerIndex].name'), 'A');
        // 無くなった画層を指していたら、そのときの現在の画層に戻す（以前は番号のままで、別の画層を指した）
        app.eval(`currentLayerIndex = 2; initLayers(); saveUndo(); layers.push({ name: '追加', color: '#ffffff', visible: true }); currentLayerIndex = 3; initLayers(); undo();`);
        assert.equal(app.val('layers[currentLayerIndex].name'), 'MYLAYER');
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
