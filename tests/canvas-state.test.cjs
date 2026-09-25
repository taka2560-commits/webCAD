'use strict';
// 描画の状態（ctx.save / restore の数・点線の設定）が1コマごとに元へ戻るかのテスト。
// 以前、座標寸法の描画で save が2回・restore が1回だったため、作図中のプレビューの点線が残り、
// そのあと図面の線がすべて点線で描かれていた。図形・寸法・作図中のプレビュー・重ね表示を広く描いて確かめる
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('描画の状態が1コマごとに元へ戻る', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    const SHAPES = `[
        { type:'LINE', layer:0, color:null, x1:-80, y1:-40, x2:80, y2:40 },
        { type:'CIRCLE', layer:0, color:'#0000ff', cx:40, cy:30, radius:20 },
        { type:'ARC', layer:0, color:null, cx:-40, cy:30, radius:20, startAngle:0, endAngle:2, counterclockwise:true },
        { type:'RECTANG', layer:0, color:null, x1:-100, y1:-90, x2:-60, y2:-60 },
        { type:'PLINE', layer:0, color:null, closed:true, points:[{x:0,y:-90},{x:40,y:-90},{x:40,y:-60}] },
        { type:'ELLIPSE', layer:0, color:null, cx:100, cy:-70, rx:20, ry:10, rotation:0.3 },
        { type:'POINT', layer:0, color:null, x:10, y:10, name:'P1' },
        { type:'TEXT', layer:0, color:null, x:-120, y:60, text:'行1\\n行2', height:12 },
        { type:'HATCH', layer:0, color:null, target:{ type:'RECTANG', x1:-100, y1:-90, x2:-60, y2:-60 }, alpha:0.5 },
        { type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:-80,y:-40}, p2:{x:80,y:-40}, offset:-20 },
        { type:'DIMENSION', subType:'ALIGNED', layer:0, color:null, p1:{x:-80,y:-40}, p2:{x:80,y:40}, offset:15 },
        { type:'DIMENSION', subType:'RADIUS', layer:0, color:null, center:{x:40,y:30}, radius:20, angle:0.5 },
        { type:'DIMENSION', subType:'DIAMETER', layer:0, color:null, center:{x:40,y:30}, radius:20, angle:1 },
        { type:'DIMENSION', subType:'ANGULAR', layer:0, color:null, vertex:{x:0,y:0}, arm1:{x:50,y:0}, arm2:{x:30,y:40}, arcRadius:25 },
        { type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:10,y:10}, leaderCoord:{x:60,y:60} },
        { type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:-10,y:10}, leader:{x:-60,y:70}, isX:true },
        { type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:-10,y:-10}, leader:{x:-70,y:-30}, isX:false },
    ]`;

    beforeEach(() => {
        app.eval(`
            resetCommand(); hidePropertyPanel();
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {}; applyDisplayPrefs();
            entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 2, rotation: 0 };
            ucs = { originX: 0, originY: 0, angle: 0 };
            snapResult = null; cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
            touchState.showLoupe = false; mouse.isSelecting = false;
            mouse.screenX = 500; mouse.screenY = 250; mouse.wcsX = 50; mouse.wcsY = 25;
            cmdState.presetAngleDeg = undefined;
            ${SHAPES}.forEach(e => entities.push(e));
            _bumpGeomEpoch();
        `);
    });

    // save / restore の深さと点線の設定を追いかける。strokes は、その時の点線（図形の線が点線で描かれていないか）
    function frame(overlayOnly) {
        app.eval(`window.__st = { depth: 0, min: 0, dash: [], stack: [], strokes: [] };
            ctx.save = () => { __st.stack.push(__st.dash.slice()); __st.depth++; };
            ctx.restore = () => { __st.depth--; __st.min = Math.min(__st.min, __st.depth); if(__st.stack.length) __st.dash = __st.stack.pop(); };
            ctx.setLineDash = (d) => { __st.dash = Array.from(d || []); };
            ctx.stroke = () => __st.strokes.push(__st.dash.length);`);
        try { app.eval(`_drawFrame(${overlayOnly ? 'true' : 'false'})`); }
        finally { app.eval('delete ctx.save; delete ctx.restore; delete ctx.setLineDash; delete ctx.stroke;'); }
        return app.val('({ depth: __st.depth, min: __st.min, dash: __st.dash, strokes: __st.strokes })');
    }
    function assertBalanced(label, r) {
        assert.equal(r.depth, 0, `${label}: save と restore の数が合わない（深さ ${r.depth}）`);
        assert.ok(r.min >= 0, `${label}: restore が多すぎる`);
        assert.deepEqual(r.dash, [], `${label}: 点線の設定が残った`);
    }

    it('図形・すべての寸法（座標寸法の新旧の形も）', () => {
        assertBalanced('図形と寸法', frame(false));
        assertBalanced('重ね表示だけ', frame(true));
        app.eval(`setDisplayPref('outdoor', 'on')`);
        assertBalanced('屋外モード', frame(false));
        app.eval(`setDisplayPref('outdoor', 'off'); cmdState.highlightIdx = 0;`);
        assertBalanced('選んだ図形（グリップ）', frame(false));
    });

    it('座標寸法のプレビューのあとも、図面の線は点線にならない（報告された不具合）', () => {
        app.eval(`processCommand('DIMORDINATE'); cmdState.mode = 'WAITING_DIMORD_LEADER'; cmdState.points = [{ x:10, y:10 }];`);
        const r = frame(false);
        assertBalanced('座標寸法のプレビュー', r);
        // 次のコマ: 図形の線はすべて実線（点線の設定が残らない）
        app.eval(`resetCommand(); render();`);
        const n = frame(false);
        assertBalanced('次のコマ', n);
        assert.ok(n.strokes.length > 0);
        assert.equal(n.strokes.filter(d => d > 0).length, 0, '点線で描いた線がある: ' + JSON.stringify(n.strokes));
    });

    it('作図・寸法・編集の途中のプレビュー', () => {
        const scenarios = {
            '線分': `processCommand('LINE'); handlePointInput({x:0,y:0}, true);`,
            '円（2点）': `lastParams.circleMode = 'manual'; processCommand('CIRCLE'); hidePropertyPanel(); handlePointInput({x:0,y:0}, true);`,
            '円（固定半径）': `lastParams.circleMode = 'auto'; processCommand('CIRCLE'); hidePropertyPanel();`,
            '長方形': `processCommand('RECTANG'); hidePropertyPanel(); handlePointInput({x:0,y:0}, true);`,
            '円弧': `processCommand('ARC'); handlePointInput({x:0,y:0}, true); handlePointInput({x:20,y:20}, true);`,
            'ポリライン': `processCommand('PLINE'); handlePointInput({x:0,y:0}, true); handlePointInput({x:20,y:0}, true);`,
            '楕円': `processCommand('ELLIPSE'); handlePointInput({x:0,y:0}, true); handlePointInput({x:30,y:0}, true);`,
            '文字': `processCommand('TEXT'); startTextPlacement();`,
            '回転（参照）': `cmdState.highlightIdx = 0; processCommand('ROTATE'); hidePropertyPanel();
                handlePointInput({x:0,y:0}, true); handlePointInput({x:10,y:0}, true); handlePointInput({x:20,y:0}, true);`,
            '平行寸法': `processCommand('DIMLINEAR'); cmdState.mode = 'WAITING_DIMLIN_POS'; cmdState.points = [{x:-80,y:-40},{x:80,y:-40}];`,
            '整列寸法': `processCommand('DIMALIGNED'); cmdState.mode = 'WAITING_DIMALN_POS'; cmdState.points = [{x:-80,y:-40},{x:80,y:40}];`,
            '半径寸法': `processCommand('DIMRADIUS'); cmdState.mode = 'WAITING_DIMRAD_POS'; cmdState.dimTarget = entities[1];`,
            '直径寸法': `processCommand('DIMDIAMETER'); cmdState.mode = 'WAITING_DIMDIA_POS'; cmdState.dimTarget = entities[1];`,
            '座標寸法': `processCommand('DIMORDINATE'); cmdState.mode = 'WAITING_DIMORD_LEADER'; cmdState.points = [{x:10,y:10}];`,
            '連続寸法': `processCommand('DIMCONT'); cmdState.mode = 'WAITING_DIMCONT_NEXT'; cmdState.dimContPoints = [{x:0,y:0},{x:30,y:0}]; cmdState.dimContOffset = 20; cmdState.dimContDir = 'H';`,
            '基点測定': `processCommand('MEASURE'); handlePointInput({x:0,y:0}, true);`,
            'トリムのなぞり': `cmdState.mode = 'WAITING_TRIM'; cmdState.trimPath = [{x:-50,y:0},{x:50,y:10}];`,
            'UCS の原点': `processCommand('UCS');`,
            '2点UCS の向き': `cmdState.mode = 'WAITING_UCS_2P_XDIR'; cmdState.startWcs = {x:0,y:0};`,
            '鏡像': `cmdState.selectedIndices = [0]; processCommand('MIRROR'); handlePointInput({x:0,y:-50}, true);`,
            '配列': `cmdState.selectedIndices = [0]; processCommand('ARRAY');`,
            '範囲選択の枠': `mouse.isSelecting = true; mouse.selStartX = 100; mouse.selStartY = 100;`,
            'ルーペとスナップ': `touchState.showLoupe = true; touchState.loupeX = 400; touchState.loupeY = 300; snapResult = { wcsX: 0, wcsY: 0, type: '端点' };`,
        };
        for(const [label, code] of Object.entries(scenarios)) {
            app.eval(`resetCommand(); hidePropertyPanel(); cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
                snapResult = null; touchState.showLoupe = false; mouse.isSelecting = false; mouse.wcsX = 50; mouse.wcsY = 25;`);
            app.eval(code);
            assertBalanced(label, frame(false));
        }
    });

    it('印刷の枠・写真のピンなど、ほかの重ね表示', () => {
        app.eval(`showPrintPanel();`);
        assertBalanced('印刷の枠', frame(false));
        app.eval(`hidePropertyPanel(); if(typeof resetPrintState === 'function') resetPrintState();`);
        assertBalanced('印刷を閉じたあと', frame(false));
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
