'use strict';
// v5.18.1 で直した不具合のテスト:
//   1. 同じ名前で保存すると黙って上書きしていた → 上書きしてよいか聞き、やめたら空いている名前を出して聞き直す
//   2. 置き換えで開いたファイルが読めないと図面が空のままだった → 元の図面（とプロジェクト名）に戻す
//   3. プロパティ欄を空にすると NaN、半径にマイナスが入った → 受け付けず元の値に戻す（コマンド欄の半径も）
//   4. コマンド欄の打ち間違いで作図中のコマンドが取り消され、打った字も消えた → 続けて、字を残す。全角の数も読む
//   5. 相対入力の符号つきの欄が数字だけのキーボードで、iPhone ではマイナスが打てなかった → 正の数の欄だけにする。全角も読む
//   6. 印刷の PDF・写真台帳を2回押すと2つできた → 作っているあいだは受け付けない
//   7. 一度読めなかった地図のタイルを読み直さなかった → 30秒たつと・電波が戻ると読み直す
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('v5.18.1 の不具合の修正', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.window.prompt = () => null;
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            window.setCurrentProjectName(null); cmdState.selectedIndices = [];
            ucs = { originX: 0, originY: 0, angle: 0 }; view = { x: 400, y: 300, scale: 1, rotation: 0 };`);
    });
    const toast = () => app.eval(`(document.getElementById('cad-toast') || {}).textContent || ''`);
    const projectNames = async () => (await app.eval(`_dbGetAll(STORE_PROJECTS)`)).map((p) => p.name).sort();
    const addLine = (x) => app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: ${x}, y1: 0, x2: ${x + 10}, y2: 0 });`);

    it('1. 同じ名前のプロジェクトがあると上書きしてよいか聞く。やめると「名前_2」を出して聞き直す', async () => {
        addLine(0);
        await app.eval(`saveProject('現場A')`);
        // 新しい図面を、同じ名前で保存しようとする
        app.eval(`entities.length = 0; window.setCurrentProjectName(null);`);
        addLine(100); addLine(200);
        const asked = [], suggested = [];
        let n = 0;
        app.window.prompt = (msg, def) => { suggested.push(def); n++; return n === 1 ? '現場A' : def; };
        app.window.confirm = (m) => { asked.push(m); return false; }; // 上書きしない
        await app.eval(`saveProject()`);
        assert.equal(asked.length, 1);
        assert.match(asked[0], /「現場A」はすでに保存されています。上書きしますか/);
        assert.equal(suggested[1], '現場A_2', '空いている名前を出して聞き直す');
        assert.deepEqual(await projectNames(), ['現場A', '現場A_2']);
        assert.equal((await app.eval(`_dbGet(STORE_PROJECTS, '現場A')`)).entities.length, 1, '先の図面は消えていない');
        // 上書きを選べば上書きする
        app.eval(`window.setCurrentProjectName(null);`);
        app.window.prompt = () => '現場A';
        app.window.confirm = () => true;
        await app.eval(`saveProject()`);
        assert.equal((await app.eval(`_dbGet(STORE_PROJECTS, '現場A')`)).entities.length, 2);
        // 「名前を付けて保存」も同じ（キャンセルなら保存しない）
        app.window.prompt = () => null;
        await app.eval(`saveProjectAs()`);
        assert.deepEqual(await projectNames(), ['現場A', '現場A_2']);
        assert.deepEqual(app.errors(), []);
    });

    it('2. 置き換えで開いたファイルが読めないときは、元の図面とプロジェクト名に戻す（↩ の履歴も戻す）', async () => {
        addLine(0); addLine(50);
        app.eval(`layers.push({ name: '道路', color: '#ff0000', visible: true }); initLayers(); window.setCurrentProjectName('現場B');`);
        const undoBefore = app.eval('undoStack.length');
        app.window.confirm = () => true; // 置き換える
        assert.equal(app.eval('_prepareImportTarget()'), 'replace');
        assert.equal(app.eval('entities.length'), 0);
        app.eval(`reportImportFailure('DXF', 'こわれた.dxf', new Error('読めない形式'))`);
        assert.equal(app.eval('entities.length'), 2, '図面が戻る');
        assert.deepEqual(app.val('layers.map(l => l.name)'), ['0', '道路']);
        assert.equal(app.eval('undoStack.length'), undoBefore, '使った ↩ 1回分も戻す');
        assert.equal(app.val('getProjectState().name'), '現場B');
        assert.match(toast(), /読み込みに失敗しました[\s\S]*今までの図面はそのままです/);
        // バイナリの DXF（読めない）を実際に開いた場合も戻す
        app.window.alert = () => {};
        app.eval('_prepareImportTarget()');
        app.window.__f = new app.window.File(['AutoCAD Binary DXF\r\n\x1a\x00'], 'bin.dxf');
        app.eval('loadDxfFile(window.__f)');
        for (let i = 0; i < 100 && app.eval('entities.length') === 0; i++) await wait(10);
        assert.equal(app.eval('entities.length'), 2);
        // 読み込みのあいだに別の操作をしていたら、その操作を消さないよう戻さない
        app.eval('_prepareImportTarget(); saveUndo(); entities.push({ type: "LINE", layer: 0, x1: 0, y1: 0, x2: 1, y2: 1 });');
        app.eval(`reportImportFailure('DXF', 'x.dxf', new Error('x'))`);
        assert.equal(app.eval('entities.length'), 1);
        // 追加で開いて読めなかったときは、今の図面をさわらない
        app.window.confirm = () => false;
        app.eval('_prepareImportTarget()');
        app.eval(`reportImportFailure('SIMA', 'x.sim', new Error('x'))`);
        assert.equal(app.eval('entities.length'), 1);
        app.window.confirm = () => true;
        // 読めなかったことはエラーログに残る（わざと起こしたものなので、確かめてから消す）
        assert.deepEqual(app.errors(), ['import: DXF読込失敗: こわれた.dxf - 読めない形式', 'import: DXF読込失敗: x.dxf - x', 'import: SIMA読込失敗: x.sim - x']);
        app.eval('window.cadErrors.clear()');
    });

    it('3. プロパティ欄: 数でない値・0 以下の半径・範囲外の透明度は受け付けず、元の値のまま。全角の数は読む', () => {
        app.eval(`entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 10, cy: 20, radius: 5 }); ensureEntityIds();`);
        const undo0 = app.eval('undoStack.length');
        for (const [prop, v] of [['cx', ''], ['cx', 'abc'], ['radius', '-3'], ['radius', '0'], ['alpha', '2']]) {
            app.eval(`changeEntityProp(0, '${prop}', '${v}')`);
            assert.deepEqual(app.val('[entities[0].cx, entities[0].cy, entities[0].radius, entities[0].alpha]'), [10, 20, 5, null], `${prop}=${v}`);
            assert.match(toast(), /元の値に戻しました/);
        }
        assert.equal(app.eval('undoStack.length'), undo0, '受け付けなかった変更は ↩ の履歴にも入れない');
        app.eval(`changeEntityProp(0, 'radius', '１２．５')`);
        assert.equal(app.eval('entities[0].radius'), 12.5);
        app.eval(`changeEntityProp(0, 'name', '')`); // 文字の欄は空でもよい
        assert.equal(app.eval('entities[0].name'), '');
        assert.deepEqual(app.errors(), []);
    });

    it('4. コマンド欄: 作図中の打ち間違いではコマンドを続け、打った字を残す。0 以下の半径は受け付けない。全角の座標も読む', () => {
        const enter = (v) => app.run(`commandInput.value = ${JSON.stringify(v)}; commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
        app.eval(`issueCommand('LINE')`);
        enter('０，０'); // 全角の「X,Y」
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        enter('abc');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2', 'コマンドは続く');
        assert.equal(app.eval('commandInput.value'), 'abc', '打った字は残る（直して打ち直せる）');
        assert.match(app.eval('commandLog.textContent'), /読めない入力です "abc"（コマンドはそのまま続きます）/);
        enter('１０，２０');
        assert.equal(app.eval('entities.length'), 1);
        assert.deepEqual(app.val('[entities[0].x2, entities[0].y2]'), [20, 10], 'X＝北（y）、Y＝東（x）');
        app.eval('resetCommand()');
        // 半径
        app.eval(`cmdState.mode = 'WAITING_CIRCLE_RADIUS'; cmdState.startWcs = { x: 0, y: 0 };`);
        assert.equal(app.eval(`processCommand('-5')`), false);
        assert.equal(app.eval(`entities.filter(e => e.type === 'CIRCLE').length`), 0);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_RADIUS');
        app.eval(`processCommand('5')`);
        assert.equal(app.eval(`entities.filter(e => e.type === 'CIRCLE').length`), 1);
        // 何もしていないときの知らないコマンド
        app.eval('resetCommand()');
        enter('zzz');
        assert.match(app.eval('commandLog.textContent'), /不明なコマンドです "zzz"/);
        assert.equal(app.eval('commandInput.value'), 'zzz');
        app.eval(`commandInput.value = ''`);
        assert.deepEqual(app.errors(), []);
    });

    it('5. 相対入力: 符号つきの欄・方向角の欄は数字だけのキーボードにしない（iPhone でマイナスが打てる）。全角の数も読む', () => {
        app.eval(`issueCommand('LINE'); handlePointInput({ x: 0, y: 0 }, true); showRelativeInputPanel();`);
        const im = () => app.val(`['rel-a', 'rel-b'].map(id => document.getElementById(id).getAttribute('inputmode'))`);
        assert.deepEqual(im(), [null, null], '北へ・東へ（マイナスあり）');
        app.eval(`document.getElementById('rel-a').value = '－５'; document.getElementById('rel-b').value = '３'; applyRelativeInput();`);
        assert.equal(app.eval('entities.length'), 1);
        assert.deepEqual(app.val('[entities[0].x2, entities[0].y2]'), [3, -5], '北へ −5・東へ 3');
        app.eval(`setRelativeMode('polar')`);
        assert.deepEqual(im(), ['decimal', null], '距離だけ数字のキーボード（方向角は「45 30 15」のように空白を使う）');
        app.eval('resetCommand(); closePropertyPanel();');
        assert.deepEqual(app.errors(), []);
    });

    it('6. 印刷の PDF・写真台帳は、作っているあいだにもう一度押しても受け付けない', async () => {
        addLine(0);
        app.eval(`entities[0].bbox = calcBBox(entities[0]); processCommand('PRINT');`);
        app.eval(`window.__n = 0; window.__dl = downloadBlob; downloadBlob = () => { window.__n++; };
            window.__pb = pdfBuild; pdfBuild = async (...a) => { await new Promise(r => setTimeout(r, 30)); return window.__pb(...a); };`);
        try {
            const r = await app.eval(`Promise.all([printMakePdf(false), printMakePdf(false)])`);
            assert.equal(app.eval('window.__n'), 1, 'PDF は1つ');
            assert.equal(r[1], null);
            await app.eval('printMakePdf(false)'); // 終われば、また作れる
            assert.equal(app.eval('window.__n'), 2);
        } finally { app.eval('downloadBlob = window.__dl; pdfBuild = window.__pb; closePropertyPanel();'); }
        assert.equal(app.eval('_phLedgerBusy'), false);
        assert.deepEqual(app.errors(), []);
    });

    it('7. 読めなかった地図のタイルは、30秒たつと・電波が戻ると読み直す', () => {
        app.eval(`_ul.tiles.clear(); window.__Img = window.Image; window.Image = class { set src(v) { this._src = v; } get src() { return this._src; } };`);
        try {
            const t1 = app.eval(`window.__t1 = _ulTile('std', 10, 1, 2)`);
            assert.ok(t1);
            app.eval(`window.__t1.img.onerror()`); // 読めなかった
            assert.equal(app.eval(`_ulTile('std', 10, 1, 2) === window.__t1`), true, 'すぐには読み直さない');
            app.eval(`window.__t1.errAt = Date.now() - UL_RETRY_MS - 1`);
            assert.equal(app.eval(`_ulTile('std', 10, 1, 2) === window.__t1`), false, '30秒たつと読み直す');
            // 電波が戻ったとき
            app.eval(`window.__t2 = _ulTile('std', 10, 3, 4); window.__t2.img.onerror(); window.dispatchEvent(new Event('online'));`);
            assert.equal(app.eval(`_ul.tiles.has('std/10/3/4')`), false);
            assert.equal(app.eval(`_ul.tiles.has('std/10/1/2')`), true, '読めているタイルは残す');
        } finally { app.eval(`window.Image = window.__Img; _ul.tiles.clear(); _ul.warned = {};`); }
    });
});
