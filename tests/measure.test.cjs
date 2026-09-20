'use strict';
// 基点測定（基点からのX距離・Y距離・直線距離を出したまま見る）と
// フローティングパネルの移動のテスト
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

// jsdom には PointerEvent が無いため、MouseEvent に同じ名前を付けて代用する
function pointer(app, el, type, x, y) {
    const ev = new app.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
}

describe('基点測定', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            resetCommand(); localStorage.removeItem('cad_survey_unit');
            entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            currentLayerIndex = 0;
            view = { x: 500, y: 400, scale: 1, rotation: 0 };
            ucs = { originX: 0, originY: 0, angle: 0 };
            snapResult = null; orthoMode = false;
        `);
    });

    // 基点を置いてから、測る先の点をカーソル位置として指定する
    function measureFrom(base, to) {
        app.eval(`processCommand('MEASURE'); handlePointInput({x:${base[0]}, y:${base[1]}}, true);`);
        app.eval(`snapResult = null; mouse.wcsX = ${to[0]}; mouse.wcsY = ${to[1]};`);
    }

    it('MEASURE コマンドで基点待ちになる', () => {
        app.eval(`processCommand('MEASURE')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMMEAS_BASE');
        assert.equal(app.eval('cmdState.measBase'), null);
        // 画面下のボタン: 基点待ちでは「確定」だけを出す
        assert.equal(app.eval(`document.getElementById('fs-dim-actionbar').style.display`), 'flex');
        assert.equal(app.eval(`document.getElementById('dim-meas-write').style.display`), 'none');
    });

    it('基点を確定すると測定中になり、記入ボタンが出る', () => {
        measureFrom([0, 0], [3, 4]);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMMEAS_TO');
        assert.deepEqual(app.val('cmdState.measBase'), { x: 0, y: 0 });
        assert.equal(app.eval(`document.getElementById('dim-meas-write').style.display`), '');
        assert.equal(app.eval(`document.getElementById('dim-meas-base').style.display`), '');
    });

    it('スナップした点を測る先にする', () => {
        app.eval(`processCommand('MEASURE'); handlePointInput({x:0, y:0}, true);`);
        app.eval(`snapResult = { wcsX: 10, wcsY: 20, type: '端点' }; osnapState.main = true; mouse.wcsX = 9.7; mouse.wcsY = 19.4;`);
        app.eval(`measureWriteDims()`);
        const dims = app.val('entities.map(e => e.p2)');
        assert.deepEqual(dims[0], { x: 10, y: 20 }); // カーソル位置ではなくスナップ点で測る
    });

    it('X距離・Y距離・直線距離の3つの寸法を記入する', () => {
        measureFrom([0, 0], [3, 4]);
        app.eval(`measureWriteDims()`);
        assert.equal(app.eval('entities.length'), 3);
        const es = app.val('entities');
        assert.deepEqual(es.map(e => e.subType), ['LINEAR', 'LINEAR', 'ALIGNED']);
        assert.deepEqual(es.map(e => e.dimDir), ['H', 'V', undefined]);
        // 表示される値: Y（東西）=3, X（南北）=4, 直線=5
        assert.deepEqual(es.map(e => e.textOverride), ['3.000', '4.000', '5.000']);
        // 3つで1つのまとまり（タップするとまとめて選べる）
        assert.equal(new Set(es.map(e => e.gid)).size, 1);
        assert.ok(es[0].gid);
    });

    it('寸法線は図形から離れた位置に置かれる', () => {
        measureFrom([0, 0], [3, 4]);
        app.eval(`measureWriteDims()`);
        const es = app.val('entities');
        // 画面では測る先が基点の上にあるので、横方向の寸法線は下側（マイナス）へ
        assert.equal(es[0].offset, -24);
        // 縦方向の寸法線は、折れ点(x=3)のさらに外側
        assert.equal(es[1].offset, 27);
        assert.equal(es[2].offset, 0);
    });

    it('記入した寸法は元に戻せる', () => {
        measureFrom([0, 0], [3, 4]);
        app.eval(`measureWriteDims()`);
        assert.equal(app.eval('entities.length'), 3);
        app.eval(`undo()`);
        assert.equal(app.eval('entities.length'), 0);
    });

    it('基点と同じ位置では記入しない', () => {
        measureFrom([5, 5], [5, 5]);
        app.eval(`measureWriteDims()`);
        assert.equal(app.eval('entities.length'), 0);
    });

    it('「基点」ボタンで、いま測っている点を次の基点にする', () => {
        measureFrom([0, 0], [3, 4]);
        app.eval(`measureSetBase()`);
        assert.deepEqual(app.val('cmdState.measBase'), { x: 3, y: 4 });
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMMEAS_TO');
    });

    it('測定中にタップしても基点は動かない（値を記録するだけ）', () => {
        measureFrom([0, 0], [3, 4]);
        app.eval(`handlePointInput({x:99, y:99}, true)`);
        assert.deepEqual(app.val('cmdState.measBase'), { x: 0, y: 0 });
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMMEAS_TO');
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /測定: X 4\.000m/);
    });

    it('図面の単位が mm のときは mm の整数で表示する', () => {
        app.eval(`localStorage.setItem('cad_survey_unit', 'mm')`);
        assert.equal(app.eval(`measFormatLength(1234.56)`), '1235');
        measureFrom([0, 0], [3000, 4000]);
        app.eval(`measureWriteDims()`);
        // mm のときは寸法の標準表示（整数mm）と同じなので、文字を固定しない
        assert.deepEqual(app.val('entities.map(e => e.textOverride)'), [null, null, null]);
    });

    it('図面の単位が m のときは小数3桁で表示する', () => {
        assert.equal(app.eval(`measFormatLength(12.3456)`), '12.346');
    });

    it('コマンドを終了すると測定表示が消える', () => {
        measureFrom([0, 0], [3, 4]);
        app.eval(`resetCommand()`);
        assert.equal(app.eval('cmdState.measBase'), undefined);
        assert.equal(app.eval(`document.getElementById('dim-meas-write').style.display`), 'none');
        app.eval(`_drawFrame(false)`); // 基点が無い状態でも描画でエラーにならない
    });

    it('測定中の描画がエラーにならない（画面を動かしても基点は図面上に残る）', () => {
        measureFrom([0, 0], [3, 4]);
        app.eval(`_drawFrame(false); _drawFrame(true);`);
        app.eval(`view.x += 120; view.scale = 3; _drawFrame(false);`);
        assert.deepEqual(app.val('cmdState.measBase'), { x: 0, y: 0 }); // 画面を動かしても基点はそのまま
    });

    // 記入した直線距離の寸法は「2点を直接結ぶ」位置（offset 0）に置く。
    // 以前は offset が 0 のとき既定値の 30 が使われ、図形から大きく離れた場所に描かれていた。
    it('寸法線の位置が0のとき、測った2点を直接結ぶ位置に描く', () => {
        app.eval(`
            entities.length = 0;
            view = { x: 100, y: 100, scale: 1, rotation: 0 };
            entities.push({ type:'DIMENSION', subType:'ALIGNED', layer:0, color:null, p1:{x:0,y:0}, p2:{x:10,y:0}, offset:0 });
            entities.push({ type:'DIMENSION', subType:'LINEAR', layer:0, color:null, dimDir:'H', p1:{x:0,y:0}, p2:{x:10,y:0}, offset:0 });
            _drawFrame(false);
        `);
        const aligned = app.val('entities[0]._hits[0]');
        assert.deepEqual(aligned, { type: 'seg', p1: { x: 100, y: 100 }, p2: { x: 110, y: 100 } });
        const linear = app.val('entities[1]._hits[0]');
        assert.deepEqual(linear, { type: 'seg', p1: { x: 100, y: 100 }, p2: { x: 110, y: 100 } });
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});

describe('フローティングパネルの移動', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            localStorage.removeItem('cad_panel_pos');
            resetPanelPosition(document.getElementById('property-panel'));
            hidePropertyPanel();
        `);
    });

    function header() { return app.window.document.getElementById('property-panel-header'); }
    function panel() { return app.window.document.getElementById('property-panel'); }

    it('見出しをつまんで動かせる', () => {
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>')`);
        const h = header();
        pointer(app, h, 'pointerdown', 100, 100);
        pointer(app, h, 'pointermove', 180, 160);
        pointer(app, h, 'pointerup', 180, 160);
        assert.equal(panel().style.left, '80px');
        assert.equal(panel().style.top, '60px');
        assert.equal(panel().style.transform, 'none'); // 中央寄せを解除している
    });

    it('パネル全体が画面の中に収まる位置までしか動かせない', () => {
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>')`);
        const h = header();
        pointer(app, h, 'pointerdown', 0, 0);
        pointer(app, h, 'pointermove', 99999, 99999);
        pointer(app, h, 'pointerup', 99999, 99999);
        const w = app.eval('window.innerWidth'), hh = app.eval('window.innerHeight');
        assert.equal(panel().style.left, (w - 320) + 'px'); // パネル幅 320px
        assert.equal(parseFloat(panel().style.top) <= hh, true);
        // マイナス方向にもはみ出さない
        pointer(app, h, 'pointerdown', 10, 10);
        pointer(app, h, 'pointermove', -500, -500);
        pointer(app, h, 'pointerup', -500, -500);
        assert.equal(panel().style.left, '0px');
        assert.equal(panel().style.top, '0px');
    });

    it('動かした位置は次に開いたときも覚えている', () => {
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>')`);
        const h = header();
        pointer(app, h, 'pointerdown', 100, 100);
        pointer(app, h, 'pointermove', 250, 300);
        pointer(app, h, 'pointerup', 250, 300);
        assert.equal(app.eval(`localStorage.getItem('cad_panel_pos')`), '{"left":150,"top":200}');
        app.eval(`hidePropertyPanel(); resetPanelPosition(document.getElementById('property-panel'));`);
        // 位置の記憶（localStorage）だけが残っている状態で開き直す
        app.eval(`localStorage.setItem('cad_panel_pos', '{"left":150,"top":200}'); showPropertyPanel('別の内容', '<div>x</div>');`);
        assert.equal(panel().style.left, '150px');
        assert.equal(panel().style.top, '200px');
    });

    it('見出しのダブルタップで元の位置に戻る', () => {
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>')`);
        const h = header();
        pointer(app, h, 'pointerdown', 100, 100);
        pointer(app, h, 'pointermove', 250, 300);
        pointer(app, h, 'pointerup', 250, 300);
        pointer(app, h, 'dblclick', 250, 300);
        assert.equal(panel().style.left, '');
        assert.equal(panel().style.transform, '');
        assert.equal(app.eval(`localStorage.getItem('cad_panel_pos')`), null);
    });

    it('閉じるボタンの上からはドラッグを始めない', () => {
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>')`);
        const close = app.window.document.getElementById('property-panel-close');
        pointer(app, close, 'pointerdown', 300, 100);
        pointer(app, header(), 'pointermove', 400, 200);
        assert.equal(panel().style.left, '');
    });

    it('画面サイズが変わったらはみ出さない位置に戻す', () => {
        app.eval(`localStorage.setItem('cad_panel_pos', '{"left":900,"top":700}'); showPropertyPanel('テスト', '<div>x</div>');`);
        const w = app.eval('window.innerWidth');
        assert.equal(panel().style.left, Math.max(0, w - 320) + 'px');
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
