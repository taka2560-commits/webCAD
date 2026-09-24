'use strict';
// 2026-09-24 の不具合チェックで見つかった21件の再発防止テスト。
// それぞれ「以前はどうなっていたか」をコメントに残す。
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');
const DxfParser = require('dxf-parser');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

describe('不具合チェックの修正（2026-09-24）', () => {
    let app;
    before(async () => {
        app = await loadApp();
        // テストのコードをブロックで囲み、const がアプリのトップレベルに残らないようにする
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
        app.eval(`window.__touch = (type, pts) => { const ev = new Event(type, { bubbles:true, cancelable:true });
            Object.defineProperty(ev, 'touches', { value: pts.map(p => ({ clientX: p[0], clientY: p[1] })) }); canvas.dispatchEvent(ev); };`);
    });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`
            resetCommand(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            currentLayerIndex = 0; view = { x: 400, y: 300, scale: 2, rotation: 0 }; ucs = { originX: 0, originY: 0, angle: 0 };
            localStorage.removeItem('cad_survey_unit'); localStorage.removeItem('cad_display_prefs'); _displayPrefs = {};
            document.body.classList.remove('fullscreen-mode'); hidePropertyPanel(); snapResult = null;
        `);
    });
    const texts = (code) => {
        app.eval(`window.__t = []; ctx.fillText = (t) => window.__t.push(String(t));`);
        try { app.run(code); } finally { app.eval('delete ctx.fillText'); }
        return app.val('window.__t');
    };
    const exportDxfText = async () => {
        app.eval(`window.__blob = null; window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__blob = b; window.__name = n; }; exportDxf(); downloadBlob = window.__dl;`);
        return app.eval('new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(window.__blob); })');
    };

    // ---- #1 長押し削除 ----
    it('#1 座標読取モード・コマンド中は、指を止めても文字・寸法が消えない', async () => {
        app.run(`entities.push({ type:'TEXT', layer:0, color:null, x:0, y:0, text:'T-1', height:10, halign:'left', valign:'bottom' }); _drawFrame(false);
            document.body.classList.add('fullscreen-mode'); const s = wcsToScreen(3, 3); __touch('touchstart', [[s.x, s.y]]);`);
        await wait(700);
        assert.equal(app.eval('entities.length'), 1, '座標読取モードで消えた');
        app.eval(`__touch('touchend', []); document.body.classList.remove('fullscreen-mode'); processCommand('MEASURE');`);
        app.run(`const s = wcsToScreen(3, 3); __touch('touchstart', [[s.x, s.y]]);`);
        await wait(700);
        assert.equal(app.eval('entities.length'), 1, 'コマンド中に消えた');
        app.eval(`__touch('touchend', []);`);
    });
    it('#1 通常画面の待機中の長押しでは消え、↩ で戻せることを知らせる', async () => {
        app.run(`entities.push({ type:'TEXT', layer:0, color:null, x:0, y:0, text:'境界', height:10, halign:'left', valign:'bottom' }); _drawFrame(false);
            const s = wcsToScreen(3, 3); __touch('touchstart', [[s.x, s.y]]);`);
        await wait(700);
        assert.equal(app.eval('entities.length'), 0);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /↩ で元に戻せます/);
        app.eval(`__touch('touchend', []); undo();`);
        assert.equal(app.eval('entities.length'), 1);
    });
    it('#1 タッチが中断（touchcancel）されたら長押し削除しない', async () => {
        app.run(`entities.push({ type:'TEXT', layer:0, color:null, x:0, y:0, text:'境界', height:10, halign:'left', valign:'bottom' }); _drawFrame(false);
            const s = wcsToScreen(3, 3); __touch('touchstart', [[s.x, s.y]]); __touch('touchcancel', []);`);
        await wait(700);
        assert.equal(app.eval('entities.length'), 1);
    });

    // ---- #2 図面を閉じる ----
    it('#2 図面を閉じる前に確認し、「いいえ」なら何もしない', () => {
        let asked = '';
        app.window.confirm = (m) => { asked = m; return false; };
        app.eval(`entities.push({ type:'LINE', layer:0, color:null, x1:0,y1:0,x2:1,y2:1 }); closeDrawing();`);
        assert.match(asked, /図面を閉じ/);
        assert.equal(app.eval('entities.length'), 1);
    });
    it('#2 図面を閉じたあとの自動保存で、前の図面の自動保存を空にしない', async () => {
        app.eval(`entities.push({ type:'LINE', layer:0, color:null, x1:0,y1:0,x2:1,y2:1 });`);
        await app.eval('_doAutoSave()');
        app.eval('closeDrawing()');
        await app.eval('_doAutoSave()');
        const n = await app.eval(`(async () => { const d = await _dbGet(STORE_AUTOSAVE, AUTOSAVE_KEY); return d ? d.entities.length : -1; })()`);
        assert.equal(n, 1);
    });

    // ---- #3 DXF出力 ----
    it('#3 DXF出力: 平行寸法の値・単位・塗りつぶしが正しく、読み直せる', async () => {
        // 以前は横30・縦20の平行寸法が「36.06」（斜めの長さ）で出て、単位は常に mm、塗りつぶしは出なかった
        app.eval(`localStorage.setItem('cad_survey_unit', 'm');
            entities.push({ type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:0,y:0}, p2:{x:30,y:20}, offset:-3 });
            entities.push({ type:'DIMENSION', subType:'ANGULAR', layer:0, color:null, vertex:{x:0,y:0}, arm1:{x:10,y:0}, arm2:{x:0,y:10}, arcRadius:6 });
            entities.push({ type:'HATCH', layer:0, color:null, target:{ type:'RECTANG', x1:60, y1:0, x2:70, y2:10 } });`);
        const dxf = await exportDxfText();
        const parsed = new DxfParser().parseSync(dxf);
        const t = parsed.entities.filter(e => e.type === 'TEXT').map(e => e.text);
        assert.ok(t.includes('30') && !t.includes('36.06'), t.join(','));
        assert.ok(t.includes('90.0°'));
        assert.equal(parsed.header.$INSUNITS, 6); // m
        assert.ok(/\n\s*0\s*\r?\n\s*HATCH\s*\r?\n/.test(dxf), '塗りつぶしが出力されていない');
        assert.ok(parsed.entities.some(e => e.type === 'SOLID'), '矢印（SOLID）が無い');
        // 寸法線は測った点からずらした位置（y = 0 + (-3)）に引かれている
        assert.ok(parsed.entities.some(e => e.type === 'LINE' && near(e.vertices[0].y, -3) && near(e.vertices[1].y, -3)));
    });
    it('#3 DXF出力: 単位が 1mm の図面なら $INSUNITS は mm', async () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm'); entities.push({ type:'LINE', layer:0, color:null, x1:0,y1:0,x2:1,y2:1 });`);
        const parsed = new DxfParser().parseSync(await exportDxfText());
        assert.equal(parsed.header.$INSUNITS, 4);
    });
    it('#3 DXFを開くとき、ファイルの単位と設定が違えば知らせる', () => {
        app.window.__dxf = { header: { $INSUNITS: 4 }, entities: [{ type: 'LINE', layer: '0', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] };
        app.eval(`importDxfData(window.__dxf, { skipUndo: true })`);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /単位は mm/);
    });

    // ---- #4 画層名の差し込み ----
    it('#4 画層名に書かれた HTML を画面に入れない（細工した DXF を開いても）', () => {
        app.window.__dxfText = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '1',
            '0', 'LAYER', '2', '<img id="pwnT" src="x">', '70', '0', '62', '1', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC',
            '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '<img id="pwnT" src="x">', '10', '0', '20', '0', '30', '0', '11', '10', '21', '10', '31', '0',
            '0', 'ENDSEC', '0', 'EOF'].join('\n');
        app.run(`const p = new DxfParser(); importDxfData(p.parseSync(window.__dxfText), { skipUndo: true });`);
        app.eval(`showLayerManagerPanel();`);
        assert.equal(app.eval(`!!document.getElementById('pwnT')`), false, '画層一括管理');
        app.eval(`hidePropertyPanel(); window.updateLayerPanel && window.updateLayerPanel();`);
        assert.equal(app.eval(`!!document.getElementById('pwnT')`), false, '画層パネル');
        app.eval(`cmdState.highlightIdx = 0; updatePropertiesPanel();`);
        assert.equal(app.eval(`!!document.getElementById('pwnT')`), false, 'プロパティ');
        assert.match(app.eval(`document.getElementById('layer-manager-container') ? document.getElementById('layer-manager-container').textContent : document.body.textContent`), /<img id="pwnT"/);
    });

    // ---- #5 ピンチ ----
    it('#5 2本指で拡大したあと、指を1本ずつ離しても点が入らない', () => {
        app.eval(`processCommand('LINE');
            __touch('touchstart', [[300, 300]]); __touch('touchstart', [[300, 300], [400, 300]]);
            __touch('touchmove', [[280, 300], [420, 300]]); __touch('touchend', [[280, 300]]);
            __touch('touchmove', [[285, 302]]); __touch('touchend', []);`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1');
        // そのあとの普通のタップでは点が入る
        app.eval(`__touch('touchstart', [[200, 200]]); __touch('touchend', []);`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
    });

    // ---- #6 寸法の桁 ----
    it('#6 寸法・座標寸法は整数に丸めない（小数3桁まで、末尾の0は省く）', () => {
        app.eval(`entities.push({ type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:0,y:0}, p2:{x:12.345,y:0}, offset:5 });
                  entities.push({ type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:-52621.837,y:645.479}, leaderCoord:{x:-52611,y:650} });`);
        const t = texts('_drawFrame(false)');
        assert.ok(t.includes('12.345'), t.join(','));
        assert.ok(t.includes('X: 645.479') && t.includes('Y: -52621.837'), t.join(','));
        assert.equal(app.eval('dimFormat(1500)'), '1500');
        assert.equal(app.eval('dimFormat(30.10000001)'), '30.1');
        app.eval(`setDisplayPref('dimDecimals', '3')`);
        assert.equal(app.eval('dimFormat(30)'), '30.000');
    });

    // ---- #7 画面の回転（PLAN） ----
    it('#7 画面を回転しても、円弧・楕円・平行寸法が正しい位置・向きに描かれる', () => {
        app.eval(`window.__c = []; ctx.arc = (x, y, r, a0, a1, acw) => window.__c.push({ k:'arc', x, y, r, a0 }); ctx.ellipse = (x, y, rx, ry, rot) => window.__c.push({ k:'ell', rot });`);
        app.eval(`view.rotation = Math.PI / 3;
            entities.push({ type:'ARC', layer:0, color:null, cx:0, cy:0, radius:50, startAngle:0, endAngle:Math.PI/2, counterclockwise:true });
            entities.push({ type:'ELLIPSE', layer:0, color:null, cx:100, cy:0, rx:30, ry:10, rotation:0 });
            entities.push({ type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:0,y:0}, p2:{x:30,y:0}, offset:5 });
            entities.forEach(e => { if(e.type !== 'DIMENSION') e.bbox = calcBBox(e); }); _drawFrame(false);`);
        const c = app.val('window.__c');
        app.eval('delete ctx.arc; delete ctx.ellipse;');
        const arc = c.find(v => v.k === 'arc' && near(v.r, 100));
        const want = app.val('wcsToScreen(50, 0)');
        assert.ok(near(arc.x + arc.r * Math.cos(arc.a0), want.x, 1e-6) && near(arc.y + arc.r * Math.sin(arc.a0), want.y, 1e-6), '円弧の始点');
        assert.ok(near(c.find(v => v.k === 'ell').rot, -Math.PI / 3), '楕円の向き');
        const seg = app.val('entities[2]._hits[0]');
        const a = app.val('[wcsToScreen(0, 5), wcsToScreen(30, 5)]');
        assert.ok(near(seg.p1.x, a[0].x, 1e-6) && near(seg.p2.y, a[1].y, 1e-6), '寸法線が図面の横（y=5）に沿っていない');
    });
    it('#7 画面を回転しても、円弧をタップで選べる', () => {
        app.eval(`view.rotation = Math.PI / 2; entities.push({ type:'ARC', layer:0, color:null, cx:0, cy:0, radius:50, startAngle:0, endAngle:Math.PI/2, counterclockwise:true });
            entities[0].bbox = calcBBox(entities[0]); _bumpGeomEpoch();`);
        const hit = app.val(`(function(){ const s = wcsToScreen(50 * Math.cos(0.7), 50 * Math.sin(0.7)); return hitTestEntity(s.x, s.y); })()`);
        assert.equal(hit, 0);
    });
    it('角度寸法は、辺を選んだ順によらず小さい方の角に弧を描く', () => {
        app.eval(`window.__c = []; ctx.arc = (x, y, r, a0, a1, acw) => window.__c.push({ r, a0, a1, acw });
            entities.push({ type:'DIMENSION', subType:'ANGULAR', layer:0, color:null, vertex:{x:0,y:0}, arm1:{x:10,y:0}, arm2:{x:0,y:10}, arcRadius:20 });
            _drawFrame(false);`);
        const arc = app.val('window.__c').find(v => near(v.r, 40));
        app.eval('delete ctx.arc;');
        let sweep = arc.acw ? arc.a0 - arc.a1 : arc.a1 - arc.a0;
        sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        assert.ok(near(sweep, Math.PI / 2, 1e-9), '弧の開き ' + sweep);
    });

    // ---- 円弧の向き（確認中に見つけたもの） ----
    // キャンバスの arc 呼び出し c が、画面上の点 s を通るか
    const arcPasses = (c, s) => {
        const TAU = 2 * Math.PI, norm = (a) => ((a % TAU) + TAU) % TAU;
        const t = Math.atan2(s.y - c.y, s.x - c.x);
        return c.acw ? norm(c.a0 - t) <= norm(c.a0 - c.a1) + 1e-9 : norm(t - c.a0) <= norm(c.a1 - c.a0) + 1e-9;
    };
    it('円弧は3点で指定した側に描かれる（以前は残りの側が描かれていた）。画面を回転しても同じ', () => {
        for (const rot of [0, Math.PI / 3]) {
            app.eval(`resetCommand(); entities.length = 0; view.rotation = ${rot};
                window.__c = []; ctx.arc = (x, y, r, a0, a1, acw) => window.__c.push({ x, y, r, a0, a1, acw });`);
            app.run(`processCommand('ARC'); const s = Math.SQRT1_2 * 50;
                _handlePointInputCore({ x: 50, y: 0 }, false); _handlePointInputCore({ x: s, y: s }, false); _handlePointInputCore({ x: 0, y: 50 }, false);
                // 時計回りの円弧（DXF の鏡像など）: 90° → 0° を時計回り
                entities.push({ type:'ARC', layer:0, color:null, cx:200, cy:0, radius:50, startAngle:Math.PI/2, endAngle:0, counterclockwise:false });
                entities.forEach(e => e.bbox = calcBBox(e)); _drawFrame(false);`);
            const calls = app.val('window.__c').filter(c => near(c.r, 100));
            app.eval('delete ctx.arc;');
            assert.equal(app.eval('entities[0].type'), 'ARC');
            assert.equal(calls.length, 2);
            for (const [c, cx] of [[calls[0], 0], [calls[1], 200]]) {
                const mid = app.val(`wcsToScreen(${cx} + 50 * Math.SQRT1_2, 50 * Math.SQRT1_2)`);
                const opp = app.val(`wcsToScreen(${cx} - 50 * Math.SQRT1_2, -50 * Math.SQRT1_2)`);
                assert.ok(arcPasses(c, mid), `回転 ${rot}: 中心 ${cx} の円弧が指定した側（45°）を通らない`);
                assert.ok(!arcPasses(c, opp), `回転 ${rot}: 中心 ${cx} の円弧が反対側（225°）まで描かれている`);
            }
        }
    });
    it('円弧を描いている途中のプレビューも、通る点の側に描く', () => {
        app.eval(`window.__c = []; ctx.arc = (x, y, r, a0, a1, acw) => window.__c.push({ x, y, r, a0, a1, acw });`);
        app.run(`processCommand('ARC'); const s = Math.SQRT1_2 * 50;
            _handlePointInputCore({ x: 50, y: 0 }, false); _handlePointInputCore({ x: s, y: s }, false);
            mouse.wcsX = 0; mouse.wcsY = 50; drawRubberBand();`);
        const c = app.val('window.__c').find(v => near(v.r, 100));
        app.eval('delete ctx.arc; resetCommand();');
        assert.ok(c, 'プレビューの円弧が描かれていない');
        assert.ok(arcPasses(c, app.val('wcsToScreen(50 * Math.SQRT1_2, 50 * Math.SQRT1_2)')));
        assert.ok(!arcPasses(c, app.val('wcsToScreen(-50 * Math.SQRT1_2, -50 * Math.SQRT1_2)')));
    });
    it('移動のプレビューも、画面の回転・円弧の向きどおりに描く', () => {
        app.eval(`window.__p = []; ctx.moveTo = (x, y) => window.__p.push([x, y]); ctx.lineTo = (x, y) => window.__p.push([x, y]); ctx.rect = () => window.__p.push('rect');
            window.__c = []; ctx.arc = (x, y, r, a0, a1, acw) => window.__c.push({ x, y, r, a0, a1, acw });
            view.rotation = Math.PI / 6;
            drawMovePreview({ type:'RECTANG', x1:0, y1:0, x2:30, y2:20 }, 5, 5);
            drawMovePreview({ type:'ARC', cx:0, cy:0, radius:50, startAngle:0, endAngle:Math.PI/2, counterclockwise:true }, 5, 5);`);
        const p = app.val('window.__p'), c = app.val('window.__c')[0];
        app.eval('delete ctx.moveTo; delete ctx.lineTo; delete ctx.rect; delete ctx.arc;');
        assert.ok(!p.includes('rect'), '四角を画面に水平な四角で描いている');
        const want = app.val('[[5,5],[35,5],[35,25],[5,25]].map(([x, y]) => { const s = wcsToScreen(x, y); return [s.x, s.y]; })');
        want.forEach((w, i) => assert.ok(near(p[i][0], w[0], 1e-6) && near(p[i][1], w[1], 1e-6), '四角の角 ' + i));
        assert.ok(arcPasses(c, app.val('wcsToScreen(5 + 50 * Math.SQRT1_2, 5 + 50 * Math.SQRT1_2)')), '円弧が指定した側を通らない');
        assert.ok(!arcPasses(c, app.val('wcsToScreen(5 - 50 * Math.SQRT1_2, 5 - 50 * Math.SQRT1_2)')), '円弧が反対側に描かれている');
    });

    // ---- #8 回転 ----
    it('#8 回転で寸法・塗りつぶしも一緒に回り、寸法の値は変わらない', () => {
        app.eval(`
            entities.push({ type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:0,y:0}, p2:{x:30,y:20}, offset:5 });
            entities.push({ type:'DIMENSION', subType:'RADIUS', layer:0, color:null, center:{x:50,y:0}, radius:5, angle:0 });
            entities.push({ type:'HATCH', layer:0, color:null, target:{ type:'RECTANG', x1:0, y1:0, x2:10, y2:10 } });
            entities.forEach(e => rotateEntity(e, 0, 0, Math.PI / 2));`);
        const d = app.val('entities[0]');
        assert.ok(near(d.p2.x, -20) && near(d.p2.y, 30), '寸法の点');
        assert.ok(near(d.dimRot, Math.PI / 2));
        assert.ok(near(app.val('dimLinePrims("LINEAR", entities[0].p1, entities[0].p2, 5, "H", entities[0].dimRot, 1).value'), 30), '横30の寸法は回しても30');
        assert.ok(near(app.val('entities[1].angle'), Math.PI / 2));
        assert.equal(app.val('entities[2].target.type'), 'PLINE'); // 長方形は回すとポリラインになる
    });

    // ---- #9 座標の入力順 ----
    it('#9 コマンド欄の「100,200」は X（北）=100・Y（東）=200（画面の表示と同じ）', () => {
        app.eval(`processCommand('LINE'); processCommand('100,200');`);
        const u = app.val('wcsToUcs(cmdState.startWcs.x, cmdState.startWcs.y)');
        assert.equal(u.y, 100); // X＝北
        assert.equal(u.x, 200); // Y＝東
    });

    // ---- #10 #11 選択 ----
    it('#10 指で押したとき、線から10px離れていても選べる', () => {
        app.eval(`isMobile = () => true; entities.push({ type:'LINE', layer:0, color:null, x1:-50, y1:0, x2:50, y2:0 }); entities[0].bbox = calcBBox(entities[0]); _bumpGeomEpoch();`);
        const hit = app.val(`(function(){ const s = wcsToScreen(0, 0); return hitTestEntity(s.x, s.y + 10); })()`);
        assert.equal(hit, 0);
    });
    it('#11 楕円は線の上で、塗りつぶしは内側で選べる。範囲選択で寸法・塗りつぶしも選べる', () => {
        app.eval(`
            entities.push({ type:'ELLIPSE', layer:0, color:null, cx:0, cy:0, rx:30, ry:10, rotation:0 });
            entities.push({ type:'HATCH', layer:0, color:null, target:{ type:'RECTANG', x1:100, y1:0, x2:120, y2:20 } });
            entities.push({ type:'DIMENSION', subType:'ALIGNED', layer:0, color:null, p1:{x:0,y:40}, p2:{x:30,y:40}, offset:0 });
            entities.forEach(e => { if(e.type !== 'DIMENSION') e.bbox = calcBBox(e); }); _bumpGeomEpoch(); _drawFrame(false);`);
        assert.equal(app.val(`(function(){ const s = wcsToScreen(30, 0); return hitTestEntity(s.x, s.y); })()`), 0, '楕円の長軸の端');
        assert.equal(app.val(`(function(){ const s = wcsToScreen(110, 10); return hitTestEntity(s.x, s.y); })()`), 1, '塗りつぶしの内側');
        const n = app.val(`(function(){ const a = wcsToScreen(-40, 50), b = wcsToScreen(125, -15);
            mouse.selStartX = a.x; mouse.selStartY = a.y; mouse.screenX = b.x; mouse.screenY = b.y; mouse.isSelecting = true;
            window.dispatchEvent(new MouseEvent('mouseup', { button:0 })); return (cmdState.selectedIndices || []).slice().sort(); })()`);
        assert.deepEqual(n, [0, 1, 2]);
    });

    // ---- #12 DWG出力 ----
    it('#12 メニューに「DWG 出力」を出さず、DWGOUT でも DXF で保存することを知らせる', () => {
        assert.equal(app.eval(`[...document.querySelectorAll('#top-menu-modal button')].some(b => /DWG 出力/.test(b.textContent))`), false);
        app.eval(`entities.push({ type:'LINE', layer:0, color:null, x1:0,y1:0,x2:1,y2:1 }); window.__name = null; window.__dl = downloadBlob; downloadBlob = (b, n) => { window.__name = n; }; exportDwg(); downloadBlob = window.__dl;`);
        assert.match(app.eval('window.__name'), /\.dxf$/);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /DXF で保存しました/);
    });

    // ---- #13 ポリラインのオフセット ----
    it('#13 ポリラインをオフセットできる（角は延長して結ぶ）', () => {
        app.eval(`entities.push({ type:'PLINE', layer:0, color:null, closed:false, points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}] });`);
        assert.equal(app.eval(`isOffsetable(entities[0])`), true);
        // 内側（左側: 進む向きの左）へ 1
        const res = app.val(`createOffsetEntity(entities[0], 1, 5, 2)`);
        assert.deepEqual(res.points.map(p => [+p.x.toFixed(9), +p.y.toFixed(9)]), [[0, 1], [9, 1], [9, 10]]);
        // 閉じた四角形の外側へ 2
        app.eval(`entities.length = 0; entities.push({ type:'PLINE', layer:0, color:null, closed:true, points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}] });`);
        const out = app.val(`createOffsetEntity(entities[0], 2, 5, -5)`);
        const xs = out.points.map(p => p.x), ys = out.points.map(p => p.y);
        assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(v => +v.toFixed(9)), [-2, 12, -2, 12]);
        assert.equal(out.closed, true);
    });

    // ---- #14 #15 キーボード ----
    it('#14 図面の上で Esc を押すとコマンドをやめる（ポリラインは描いた部分を残す）', () => {
        app.eval(`processCommand('LINE'); document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        app.eval(`processCommand('PLINE'); handlePointInput({x:0,y:0}, true); handlePointInput({x:10,y:0}, true);
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));`);
        assert.equal(app.eval('entities.length'), 1);
    });
    it('#15 入力欄の中の Ctrl+Z・Tab は、図面の操作に取られない', () => {
        app.run(`saveUndo(); entities.push({ type:'LINE', layer:0, color:null, x1:0,y1:0,x2:1,y2:1 });
            const inp = document.createElement('input'); inp.id = '__i'; document.body.appendChild(inp); inp.focus();
            inp.dispatchEvent(new KeyboardEvent('keydown', { key:'z', ctrlKey:true, bubbles:true, cancelable:true }));`);
        assert.equal(app.eval('entities.length'), 1, 'Ctrl+Z で図形が戻った');
        app.run(`processCommand('LINE'); snapResult = { wcsX:0, wcsY:0, type:'端点', index:0, count:2 }; _snapLastArgs = [0,0,0,0];
            window.__ev = new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true }); document.getElementById('__i').dispatchEvent(window.__ev);`);
        assert.equal(app.eval('window.__ev.defaultPrevented'), false, 'Tab が止められた');
        app.eval(`document.getElementById('__i').remove()`);
        // 入力欄の外の Ctrl+Z は図面の「元に戻す」
        app.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'z', ctrlKey:true, bubbles:true, cancelable:true }))`);
        assert.equal(app.eval('entities.length'), 0);
    });

    // ---- #16 初期値 ----
    it('#16 文字の高さ・円の半径の初期値は画面に合った大きさ（変えた値はそのまま）', () => {
        app.eval(`lastParams.textHeight = DEFAULT_LAST_PARAMS.textHeight; view.scale = 20; processCommand('TEXT');`);
        assert.equal(app.eval(`document.getElementById('prop-text-h').value`), '1'); // 18px / 20px毎単位 ≒ 0.9 → 1
        app.eval(`resetCommand(); lastParams.textHeight = '3.5'; processCommand('TEXT');`);
        assert.equal(app.eval(`document.getElementById('prop-text-h').value`), '3.5');
        app.eval(`resetCommand(); lastParams.radius = DEFAULT_LAST_PARAMS.radius; view.scale = 2; processCommand('CIRCLE');`);
        assert.equal(app.eval('lastParams.radius'), '20'); // 40px / 2px毎単位 = 20
        app.eval('resetCommand()');
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
