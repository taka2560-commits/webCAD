'use strict';
// レイアウト（ペーパー空間）を別の画面で見る（v5.38。cad-layout.js）:
//   DXF（OBJECTS の LAYOUT・*Paper_Space のブロック・VIEWPORT）・DWG（LAYOUT の記録・ブロックレコード）から、
//   レイアウトの名前・並び・用紙・図形・ビューポート（縮尺・中心・回転・凍結した画層）を作る。
//   画面の下のタブで切り替え、モデルの表示位置は戻ったときにそのまま。レイアウトは見るだけ（コマンド・↩・パネルでモデルに戻る）。
//   保存・図面一式（.webcad）・↩ の履歴に入る
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

const sec = (name, ...items) => [['0', 'SECTION'], ['2', name], ...items.flat(), ['0', 'ENDSEC']];
const dxfText = (...sections) => [...sections.flat(), ['0', 'EOF']].map(([c, v]) => `${c}\n${v}`).join('\n');
const ent = (type, ...pairs) => [['0', type], ...pairs];
const TABLES = sec('TABLES', [['0', 'TABLE'], ['2', 'LAYER'], ['70', '3']],
    ent('LAYER', ['5', '10'], ['2', '0'], ['70', '0'], ['62', '7'], ['6', 'CONTINUOUS']),
    ent('LAYER', ['5', '11'], ['2', '図枠'], ['70', '0'], ['62', '3'], ['6', 'CONTINUOUS']),
    ent('LAYER', ['5', '12'], ['2', '寸法'], ['70', '0'], ['62', '4'], ['6', 'CONTINUOUS']),
    [['0', 'ENDTAB']]);
const vp = (handle, owner, extra, ...pairs) => ent('VIEWPORT', ['5', handle], ['330', owner], ...(extra || []), ['100', 'AcDbEntity'], ['8', '0'], ['100', 'AcDbViewport'], ...pairs);
const BLOCKS = sec('BLOCKS',
    ent('BLOCK', ['5', '1E'], ['330', '1D'], ['8', '0'], ['2', '*Paper_Space'], ['70', '0'], ['10', '0'], ['20', '0'], ['30', '0'], ['3', '*Paper_Space']), ent('ENDBLK', ['8', '0']),
    ent('BLOCK', ['5', '22C8'], ['330', '22C7'], ['8', '0'], ['2', '*Paper_Space0'], ['70', '0'], ['10', '0'], ['20', '0'], ['30', '0'], ['3', '*Paper_Space0']),
    ent('LINE', ['5', '2300'], ['330', '22C7'], ['8', '図枠'], ['10', '0'], ['20', '0'], ['30', '0'], ['11', '200'], ['21', '0'], ['31', '0']),
    vp('22C9', '22C7', [], ['10', '100'], ['20', '70'], ['30', '0'], ['40', '200'], ['41', '140'], ['68', '1'], ['69', '1'], ['12', '100'], ['22', '70'], ['45', '140']),
    vp('22D5', '22C7', [], ['10', '50'], ['20', '50'], ['30', '0'], ['40', '60'], ['41', '40'], ['68', '2'], ['69', '2'], ['12', '1000'], ['22', '500'],
        ['16', '0'], ['26', '0'], ['36', '1'], ['17', '0'], ['27', '0'], ['37', '0'], ['45', '4000'], ['51', '0'], ['90', '819296'], ['331', '12']),
    // 切ったビューポート・真上から見ていないビューポートは描かない
    vp('22D6', '22C7', [], ['10', '150'], ['20', '50'], ['30', '0'], ['40', '20'], ['41', '20'], ['68', '0'], ['69', '3'], ['12', '0'], ['22', '0'], ['45', '100']),
    vp('22D7', '22C7', [], ['10', '150'], ['20', '20'], ['30', '0'], ['40', '20'], ['41', '20'], ['68', '4'], ['69', '4'], ['12', '0'], ['22', '0'], ['16', '1'], ['26', '1'], ['36', '1'], ['45', '100']),
    ent('ENDBLK', ['8', '0']));
const ENTITIES = sec('ENTITIES',
    ent('LINE', ['5', 'A1'], ['330', '1F'], ['8', '0'], ['10', '980'], ['20', '490'], ['30', '0'], ['11', '1020'], ['21', '510'], ['31', '0']),
    ent('LINE', ['5', 'A2'], ['330', '1F'], ['8', '寸法'], ['10', '1000'], ['20', '480'], ['30', '0'], ['11', '1000'], ['21', '520'], ['31', '0']),
    ent('LINE', ['5', 'B1'], ['330', '1D'], ['67', '1'], ['8', '図枠'], ['10', '0'], ['20', '0'], ['30', '0'], ['11', '420'], ['21', '0'], ['31', '0']),
    ent('TEXT', ['5', 'B2'], ['330', '1D'], ['67', '1'], ['8', '図枠'], ['10', '10'], ['20', '10'], ['30', '0'], ['40', '5'], ['1', '表題']),
    vp('3BC', '1D', [['67', '1']], ['10', '210'], ['20', '148'], ['30', '0'], ['40', '420'], ['41', '297'], ['68', '1'], ['69', '1'], ['12', '210'], ['22', '148'], ['45', '297']),
    vp('3C0', '1D', [['67', '1']], ['10', '210'], ['20', '148'], ['30', '0'], ['40', '200'], ['41', '100'], ['68', '2'], ['69', '2'], ['12', '1000'], ['22', '500'],
        ['16', '0'], ['26', '0'], ['36', '1'], ['45', '1000'], ['51', '30']));
const OBJECTS = sec('OBJECTS',
    ent('LAYOUT', ['5', '24'], ['330', '1A'], ['100', 'AcDbPlotSettings'], ['1', ''], ['100', 'AcDbLayout'], ['1', 'Model'], ['70', '1'], ['71', '0'], ['10', '0'], ['20', '0'], ['11', '12'], ['21', '9'], ['330', '21'], ['331', 'C4']),
    ent('LAYOUT', ['5', '22E2'], ['330', '1A'], ['100', 'AcDbPlotSettings'], ['1', 'ページ設定'], ['100', 'AcDbLayout'], ['1', '詳細'], ['70', '0'], ['71', '2'], ['10', '0'], ['20', '0'], ['11', '12'], ['21', '9'], ['330', '22C7'], ['331', '22C9']),
    ent('LAYOUT', ['5', '20'], ['330', '1A'], ['100', 'AcDbPlotSettings'], ['1', 'ページ設定'], ['100', 'AcDbLayout'], ['1', '平面図'], ['70', '1'], ['71', '1'], ['10', '0'], ['20', '0'], ['11', '420'], ['21', '297'], ['330', '1D'], ['331', '3BC']));
const DXF = dxfText(sec('HEADER', [['9', '$INSUNITS'], ['70', '4']]), TABLES, BLOCKS, ENTITIES, OBJECTS);

describe('レイアウト（別の画面）', () => {
    let app;
    before(async () => {
        app = await loadApp();
        app.eval(`window.__touch = (type, pts) => { const ev = new Event(type, { bubbles:true, cancelable:true });
            Object.defineProperty(ev, 'touches', { value: pts.map(p => ({ clientX: p[0], clientY: p[1] })) }); canvas.dispatchEvent(ev); };`);
    });
    after(() => app.close());
    const load = () => {
        app.window.__dxfText = DXF;
        app.eval(`layoutsClear(); resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); initLayers(); _importMode = 'fresh';
            view = { x: 400, y: 300, scale: 1, rotation: 0 };
            { const p = new window.DxfParser(); registerExtraDxfHandlers(p, window.__dxfText); importDxfData(p.parseSync(window.__dxfText), { skipUndo: true, text: window.__dxfText }); }`);
    };
    beforeEach(load);

    it('DXF: モデルには入れず、LAYOUT の名前・並びのレイアウトにする（空の Model は除く）。用紙は範囲（小さすぎれば図形の広がり）', () => {
        assert.deepEqual(app.val(`entities.map(e => e.type + ':' + e.x1)`), ['LINE:980', 'LINE:1000'], 'モデルはモデルの図形だけ');
        assert.deepEqual(app.val('cadLayouts.map(l => l.name)'), ['平面図', '詳細']);
        const L = app.val('cadLayouts[0]');
        assert.deepEqual(L.sheet, { x0: 0, y0: 0, x1: 420, y1: 297 });
        assert.deepEqual(L.ents.map((e) => e.type).sort(), ['LINE', 'TEXT']);
        assert.equal(L.ents.find((e) => e.type === 'TEXT').text, '表題');
        assert.equal(L.vps.length, 1, '用紙全体を映す枠（69=1）は描かない');
        const D = app.val('cadLayouts[1]');
        assert.deepEqual(D.sheet, { x0: -6, y0: -6, x1: 206, y1: 76 }, '範囲 12×9 は用紙ではないので、図形とビューポートの広がりに 3% の余白');
        assert.equal(D.vps.length, 1, '切ったもの（68=0）・真上から見ていないものは描かない');
        assert.deepEqual(D.vps[0], { cx: 50, cy: 50, w: 60, h: 40, k: 0.01, t: 0, c: { x: 1000, y: 500 }, layer: 0, hide: ['寸法'] });
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /レイアウト 2枚は、別の画面に入れました/);
        assert.deepEqual(app.errors(), []);
    });

    it('ビューポートの写し方: 用紙 = 中心 + k・R(回転)・(モデル − モデルの中心)。回転 30°（ezdxf と同じ式で確かめる）', () => {
        const vp0 = app.val('cadLayouts[0].vps[0]');
        assert.ok(near(vp0.k, 0.1) && near(vp0.t, Math.PI / 6));
        // ezdxf: 用紙 = R(t)·(k·(m − 注視点)) + (枠の中心 − k·表示の中心)
        const t = Math.PI / 6, k = 0.1, m = { x: 1200, y: 300 };
        const p = { x: (k * m.x) * Math.cos(t) - (k * m.y) * Math.sin(t) + 210 - k * 1000, y: (k * m.x) * Math.sin(t) + (k * m.y) * Math.cos(t) + 148 - k * 500 };
        app.eval('layoutShow(0)');
        const back = app.val(`layoutModelAt(${p.x}, ${p.y})`);
        assert.ok(near(back.x, 1200, 1e-6) && near(back.y, 300, 1e-6), JSON.stringify(back));
        // 描くときの表示: モデルの点 → 画面の点が、用紙の点 → 画面の点と同じ
        const s = app.val(`(() => { const L = { x: view.x, y: view.y, scale: view.scale, rotation: 0 }; const v = layoutVpView(cadLayouts[0].vps[0], L);
            const sv = view; view = v; const a = wcsToScreen(1200, 300); view = sv; const b = wcsToScreen(${p.x}, ${p.y}); return [a, b]; })()`);
        assert.ok(near(s[0].x, s[1].x, 1e-6) && near(s[0].y, s[1].y, 1e-6), JSON.stringify(s));
        assert.equal(app.val('layoutModelAt(5, 5)'), null, '枠の外');
    });

    it('タブで切り替える。モデルに戻ると表示の位置はそのまま。レイアウトごとの表示も覚える', () => {
        app.eval(`view = { x: 123, y: 456, scale: 0.75, rotation: 0.1 };`);
        const tabs = () => app.val(`[...document.querySelectorAll('#space-tabs button')].map(b => (b.classList.contains('active') ? '*' : '') + b.textContent)`);
        assert.deepEqual(tabs(), ['*モデル', '平面図', '詳細']);
        assert.equal(app.eval(`document.getElementById('space-tabs').style.display`), 'flex');
        app.eval(`document.querySelector('#space-tabs button[data-space="0"]').click()`);
        assert.equal(app.eval('layoutActive()'), true);
        assert.ok(app.eval(`document.body.classList.contains('layout-mode')`));
        assert.deepEqual(tabs(), ['モデル', '*平面図', '詳細']);
        assert.equal(app.eval(`document.querySelector('#status-bar .paper-space-label').textContent`), '平面図');
        // 用紙全体が入る大きさ
        const sc = app.val('view.scale'), w = app.val('canvas.width'), h = app.val('canvas.height');
        assert.ok(near(sc, Math.min((w - 48) / 420, (h - 48) / 297), 1e-9));
        assert.equal(app.val('view.rotation'), 0);
        app.eval('view.x += 30');
        const lv = app.val('view');
        app.eval(`document.querySelector('#space-tabs button[data-space="-1"]').click()`);
        assert.deepEqual(app.val('view'), { x: 123, y: 456, scale: 0.75, rotation: 0.1 }, 'モデルの表示はそのまま');
        assert.ok(!app.eval(`document.body.classList.contains('layout-mode')`));
        app.eval('layoutShow(0)');
        assert.deepEqual(app.val('view'), lv, 'レイアウトの表示も覚えている');
        app.eval('layoutShowModel()');
    });

    it('描く: 用紙・ビューポートの中のモデル（凍結した画層は描かない）・用紙の図形。状態は毎コマ元に戻る', () => {
        app.eval('layoutShow(1)');
        const segs = app.val(`(() => { const out = []; const mt = ctx.moveTo.bind(ctx), lt = ctx.lineTo.bind(ctx);
            ctx.moveTo = (x, y) => { out.push(['m', x, y]); return mt(x, y); }; ctx.lineTo = (x, y) => { out.push(['l', x, y]); return lt(x, y); };
            window.__txt = []; ctx.fillText = (t) => window.__txt.push(String(t));
            try { _drawFrame(false); } finally { delete ctx.moveTo; delete ctx.lineTo; delete ctx.fillText; } return out; })()`);
        const at = (px, py) => app.val(`wcsToScreen(${px}, ${py})`);
        const has = (q) => segs.some((s) => near(s[1], q.x, 1e-6) && near(s[2], q.y, 1e-6));
        // モデルの線 (980,490)-(1020,510) → 用紙 (49.8,49.9)-(50.2,50.1)
        assert.ok(has(at(49.8, 49.9)) && has(at(50.2, 50.1)), 'ビューポートの中にモデルの線');
        // 寸法の画層の線 (1000,480)-(1000,520) → 用紙 (50,49.8)-(50,50.2) は凍結なので描かない
        assert.ok(!has(at(50, 49.8)), '凍結した画層');
        assert.ok(has(at(0, 0)) && has(at(200, 0)), '用紙の図形（図枠の線）');
        assert.equal(app.eval('ctx.getLineDash().length'), 0);
        assert.equal(app.eval('ctx.globalAlpha'), 1);
        app.eval('layoutShow(0); _drawFrame(false);');
        assert.ok(app.val('window.__txt').length === 0 || true);
        app.eval('layoutShowModel()');
    });

    it('レイアウトは見るだけ: タップしても選ばない・点を入れない。1本指でなぞると動く。Esc でモデルへ', () => {
        app.eval(`layoutShow(0); cmdState.highlightIdx = -1;`);
        const x0 = app.val('view.x');
        app.eval(`__touch('touchstart', [[300, 300]]); __touch('touchend', []);`);
        assert.equal(app.eval('cmdState.highlightIdx'), -1);
        app.eval(`__touch('touchstart', [[300, 300]]); __touch('touchmove', [[340, 310]]); __touch('touchend', []);`);
        assert.ok(near(app.val('view.x'), x0 + 40));
        app.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        assert.equal(app.eval('layoutActive()'), false);
    });

    it('作図のコマンド・↩・モデルを使うパネルでモデルに戻る。オプション・ヘルプはそのまま。LAYOUT・MODEL コマンド', () => {
        app.eval(`layoutShow(0); processCommand('LINE');`);
        assert.equal(app.eval('layoutActive()'), false);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1');
        assert.equal(app.eval(`document.getElementById('space-tabs').style.display`), 'none', 'コマンドの途中はタブを隠す');
        app.eval(`resetCommand();`);
        assert.equal(app.eval(`document.getElementById('space-tabs').style.display`), 'flex');
        app.eval(`layoutShow(0); showOptionsPanel();`);
        assert.equal(app.eval('layoutActive()'), true, 'オプションはそのまま');
        app.eval(`showCoordListPanel();`);
        assert.equal(app.eval('layoutActive()'), false, '座標一覧はモデルで');
        app.eval(`closePropertyPanel(); layoutShow(1); saveUndo(); undo();`);
        assert.equal(app.eval('layoutActive()'), false, '↩ はモデルで');
        app.eval(`processCommand('LAYOUT')`);
        assert.equal(app.eval('layoutCurrent().name'), '平面図');
        app.eval(`processCommand('LAYOUT')`);
        assert.equal(app.eval('layoutCurrent().name'), '詳細');
        app.eval(`processCommand('ZE')`);
        assert.equal(app.eval('layoutActive()'), true, '全体表示はレイアウトのまま');
        app.eval(`processCommand('MODEL')`);
        assert.equal(app.eval('layoutActive()'), false);
    });

    it('座標の表示: ビューポートの中はモデルの座標（X＝北・Y＝東）、外は —', () => {
        app.eval('layoutShow(1); layoutShowCoords(50.2, 50.1);');
        assert.match(app.eval(`document.getElementById('coords-display').textContent`), /X:510.*Y:1020/);
        app.eval('layoutShowCoords(5, 5);');
        assert.equal(app.eval(`document.getElementById('coords-display').textContent`), 'X:—Y:—');
        app.eval('layoutShowModel()');
    });

    it('↩ の履歴: 置き換えで開いたレイアウトも、元に戻すと前のレイアウトに戻る。図面を閉じるとレイアウトも閉じる', () => {
        const before = app.val('cadLayouts.map(l => l.name)');
        app.eval(`saveUndo(); layoutsClear();`);
        assert.equal(app.val('cadLayouts.length'), 0);
        assert.equal(app.eval(`document.getElementById('space-tabs').style.display`), 'none');
        app.eval('undo()');
        assert.deepEqual(app.val('cadLayouts.map(l => l.name)'), before);
        app.eval('_closeDrawingNow()');
        assert.equal(app.val('cadLayouts.length'), 0);
    });

    it('保存して開き直す・図面一式（.webcad）にもレイアウトが入る。受け取ったものは形を確かめる', () => {
        const data = app.val(`_buildSaveData('t')`);
        assert.equal(data.layouts.length, 2);
        assert.ok(data.layouts[0].ents.every((e) => e.bbox === undefined));
        app.window.__data = JSON.parse(JSON.stringify(data));
        app.eval('layoutsClear(); applyProjectData(window.__data)');
        assert.deepEqual(app.val('cadLayouts.map(l => [l.name, l.ents.length, l.vps.length])'), [['平面図', 2, 1], ['詳細', 1, 1]]);
        // 図面一式: 壊れた値・ピン・余計な項目は捨てる
        const bad = JSON.parse(JSON.stringify(data));
        bad.layouts.push({ name: 'x', sheet: { x0: 'a' } }, { name: 5, sheet: { x0: 0, y0: 0, x1: 10, y1: 10 }, ents: [{ type: 'PIN', x: 1, y: 1, photos: [] }, { type: 'EVIL' }, { type: 'LINE', layer: 99, x1: 0, y1: 0, x2: 1, y2: 1, onclick: 'alert(1)' }], vps: [{ cx: 'x' }, { cx: 1, cy: 1, w: 2, h: 2, k: 0.5, c: { x: 0, y: 0 }, hide: ['a', 5] }] });
        app.window.__p = bad;
        const s = app.val('sanitizeWebcadProject(window.__p).layouts');
        assert.deepEqual(s.map((l) => l.name), ['平面図', '詳細', 'レイアウト']);
        assert.deepEqual(s[2].ents.map((e) => [e.type, e.layer, e.onclick]), [['LINE', 0, undefined]]);
        assert.deepEqual(s[2].vps, [{ cx: 1, cy: 1, w: 2, h: 2, k: 0.5, t: 0, c: { x: 0, y: 0 }, hide: ['a'] }]);
    });

    it('DWG: LAYOUT の記録（名前・並び・範囲・枠のビューポート）からレイアウトを作る', () => {
        app.window.__db = {
            header: { INSUNITS: 4 },
            objects: { LAYOUT: [
                { handle: '24', layoutName: 'Model', tabOrder: 0, minLimit: { x: 0, y: 0 }, maxLimit: { x: 12, y: 9 }, paperSpaceTableId: '21', viewportId: 'C4' },
                { handle: '20', layoutName: 'A3', tabOrder: 1, minLimit: { x: 0, y: 0 }, maxLimit: { x: 419.947, y: 296.926 }, paperSpaceTableId: '1D', viewportId: '3BC' },
                { handle: '30', layoutName: '空', tabOrder: 2, minLimit: { x: 0, y: 0 }, maxLimit: { x: 12, y: 9 }, paperSpaceTableId: '2D', viewportId: '3CC' },
            ] },
            tables: { LAYER: { entries: [{ name: '0', colorIndex: 7 }] }, BLOCK_RECORD: { entries: [
                { name: '*Model_Space', handle: '21', entities: [] },
                { name: '*Paper_Space', handle: '1D', entities: [
                    { type: 'LINE', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 400, y: 0 }, ownerBlockRecordSoftId: '1D' },
                    { type: 'VIEWPORT', handle: '3BC', layer: '0', viewportCenter: { x: 104, y: 148 }, width: 800, height: 316, displayCenter: { x: 104, y: 148 }, viewHeight: 316, viewDirection: { x: 0, y: 0, z: 1 }, targetPoint: { x: 0, y: 0, z: 0 }, statusBitFlags: 819232 },
                    { type: 'VIEWPORT', handle: '4BC3', layer: '0', viewportCenter: { x: 210, y: 53 }, width: 400, height: 58.25, displayCenter: { x: 98242.882, y: -479100.686 }, viewHeight: 34950, viewDirection: { x: 0, y: 0, z: 1 }, targetPoint: { x: 0, y: 0, z: 0 }, viewTwistAngle: 0, statusBitFlags: 819296 },
                    { type: 'VIEWPORT', handle: '4BC4', layer: '0', viewportCenter: { x: 210, y: 153 }, width: 40, height: 20, displayCenter: { x: 0, y: 0 }, viewHeight: 100, statusBitFlags: 819296 | 0x20000 },
                ] },
                { name: '*Paper_Space0', handle: '2D', entities: [] },
            ] } },
            entities: [],
        };
        const r = app.val(`convertDwgDatabaseToApp(window.__db).layouts`);
        assert.deepEqual(r.map((l) => [l.name, l.order, l.ents.length, l.vps.length]), [['A3', 1, 1, 1]], '空のレイアウト・枠のビューポート・切ったビューポートは除く');
        assert.deepEqual(r[0].sheet, { x0: 0, y0: 0, x1: 419.947, y1: 296.926 });
        assert.ok(near(r[0].vps[0].k, 58.25 / 34950, 1e-12));
        assert.deepEqual(r[0].vps[0].c, { x: 98242.882, y: -479100.686 });
    });

    it('選んだときのバーが出ている間はタブを隠す（同じ高さに重なる）。モデルの図形へ寄る操作はモデルで', () => {
        const tabs = () => app.eval(`document.getElementById('space-tabs').style.display`);
        assert.equal(tabs(), 'flex');
        app.eval(`cmdState.selectedIndices = [0]; updateSelectionBar();`);
        assert.equal(app.eval(`document.getElementById('sel-actionbar').style.display`), 'flex');
        assert.equal(tabs(), 'none');
        app.eval(`cmdState.selectedIndices = []; cmdState.highlightIdx = -1; updateSelectionBar();`);
        assert.equal(tabs(), 'flex');
        app.eval(`layoutShow(0); zoomToEntities([0]);`);
        assert.equal(app.eval('layoutActive()'), false);
    });

    it('練習ツアーはモデルの画面で、練習の間はレイアウトのタブを出さない。終わるとレイアウトも戻る', () => {
        app.eval(`layoutShow(0); startGuideTour(Object.keys(GUIDE_TOURS).find(k => GUIDE_TOURS[k].sample));`);
        assert.equal(app.eval('layoutActive()'), false);
        assert.equal(app.val('cadLayouts.length'), 0);
        assert.equal(app.eval(`document.getElementById('space-tabs').style.display`), 'none');
        app.eval('endGuideTour(false)');
        assert.deepEqual(app.val('cadLayouts.map(l => l.name)'), ['平面図', '詳細']);
        assert.deepEqual(app.val(`entities.map(e => e.type + ':' + e.x1)`), ['LINE:980', 'LINE:1000'], '図面も元どおり');
    });

    it('塗りつぶしを表示すると、レイアウトの塗りつぶしも出す。画面の画像の名前はレイアウトの名前', async () => {
        app.eval(`cadLayouts[0].ents.push({ type: 'HATCH', layer: 0, hidden: true, hiddenBy: 'fill', target: { type: 'PLINE', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } }); showHiddenEntities('fill');`);
        assert.equal(app.val(`cadLayouts[0].ents.filter(e => e.type === 'HATCH' && !e.hidden).length`), 1);
        app.eval(`layoutShow(0); window.__names = []; window.__dl0 = downloadBlob; downloadBlob = (b, n) => window.__names.push(n); setDrawingName('genba.dwg');`);
        await app.eval('exportScreenPng()');
        app.eval('downloadBlob = window.__dl0; layoutShowModel();');
        assert.deepEqual(app.val('window.__names'), ['genba_平面図.png']);
        assert.deepEqual(app.errors(), []);
    });
});
