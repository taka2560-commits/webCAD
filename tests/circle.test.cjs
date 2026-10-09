'use strict';
// 円の描き方（v5.40。cad-circle.js）:
//   固定半径・中心と半径（以前から）に、3点（円周の3点を通る）・2点（直径の両端）・接線・接線・半径（2つの線・円に接する）を足した。
//   最後の点・2つ目の線のあとに仮の円を出し、☑確定 で描く。コマンド欄の 3P・2P・TTR・CEN で切り替え、接線・接線・半径では数を打つと半径
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('円の描き方（3点・2点・接線・接線・半径）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            view = { x: 400, y: 300, scale: 1, rotation: 0 }; ucs = { originX: 0, originY: 0, angle: 0 }; snapResult = null; orthoMode = false;
            Object.keys(osnapState).forEach(k => { if(typeof osnapState[k] === 'boolean') osnapState[k] = false; });
            lastParams.circleMode = 'auto'; lastParams.radius = '10'; localStorage.removeItem('cad_display_prefs'); _displayPrefs = {};`);
    });
    // 円のコマンドを始めて、描き方を打って切り替える
    const start = (key) => app.eval(`processCommand('CIRCLE'); hidePropertyPanel(); ${key ? `processCommand('${key}');` : ''}`);
    const pt = (x, y) => app.eval(`handlePointInput({ x: ${x}, y: ${y} }, true)`);
    // 線・円をタップする（接線・接線・半径）: その場所にカーソルを置いて点を入れる
    const tapAt = (x, y) => app.eval(`{ const s = wcsToScreen(${x}, ${y}); mouse.screenX = s.x; mouse.screenY = s.y; handlePointInput({ x: ${x}, y: ${y} }, true); }`);
    const circles = () => app.val(`entities.filter(e => e.type === 'CIRCLE').map(e => ({ cx: e.cx, cy: e.cy, r: e.radius }))`);
    const confirmBtn = () => app.eval(`document.querySelector('#fs-dim-actionbar button[onclick="dimConfirmPoint()"]').style.display`);
    const lastLog = () => app.val(`Array.from(document.getElementById('command-log').children).slice(-1)[0].textContent`);
    const nearCircle = (c, cx, cy, r, eps = 1e-6) => { near(c.cx, cx, eps); near(c.cy, cy, eps); near(c.r, r, eps); };

    it('3点: 円周の3点を通る円。3点目で仮の円が出て、☑確定 で描く（中心と半径をコマンド欄に）。続けて次の円', () => {
        start('3P');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_3P');
        assert.equal(confirmBtn(), 'none', '円が決まるまでは ☑確定 を出さない');
        pt(0, 10); pt(10, 0); pt(0, -10);
        assert.deepEqual(circles(), [], 'まだ描かない');
        assert.equal(confirmBtn(), '');
        assert.match(lastLog(), /中心 .*・半径 10/);
        // 3点目はタップし直すと動く（1点目・2点目はそのまま）
        pt(-10, 0);
        nearCircle(app.val('cmdState.circlePreview'), 0, 0, 10);
        app.eval('dimConfirmPoint()');
        assert.equal(circles().length, 1);
        nearCircle(circles()[0], 0, 0, 10);
        assert.match(lastLog(), /円作成（3点）: 中心 .*・半径 10/);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_3P', '続けて次の円');
        assert.deepEqual(app.val('cmdState.points'), []);
        assert.equal(app.val('lastParams.radius'), '10', '次の固定半径の案にも');
        app.eval('undo()');
        assert.deepEqual(circles(), [], '↩ で1回で戻る');
    });

    it('3点: 座標が大きくても（平面直角座標）桁が落ちない。一直線・同じ点なら知らせて円にしない', () => {
        start('3P');
        const cx = -16188.123, cy = 87345.678, r = 12.345;
        [0.3, 2.1, 4.4].forEach((a) => pt(cx + r * Math.cos(a), cy + r * Math.sin(a)));
        app.eval('dimConfirmPoint()');
        nearCircle(circles()[0], cx, cy, r, 1e-7);
        // 一直線
        pt(0, 0); pt(5, 5);
        app.eval(`window.__toast = null; window.__st0 = window.showToast; window.showToast = (m) => { window.__toast = m; };`);
        try { pt(10, 10); } finally { app.eval('window.showToast = window.__st0;'); }
        assert.match(app.val('window.__toast'), /一直線/);
        assert.equal(app.val('cmdState.circlePreview'), null);
        app.eval('dimConfirmPoint()');
        assert.equal(circles().length, 1, '描かない');
    });

    it('2点（直径）: 両端の2点。2点目の「@X,Y」は1点目から', () => {
        start('2P');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_2P');
        pt(0, 0);
        app.eval(`processCommand('@0,10')`); // 東へ 10
        app.eval('dimConfirmPoint()');
        nearCircle(circles()[0], 5, 0, 5);
        assert.match(lastLog(), /円作成（2点・直径）/);
    });

    it('接線・接線・半径: 直交する2本の線。タップした側に接する円を選ぶ', () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: -100, y1: 0, x2: 100, y2: 0 }, { type: 'LINE', layer: 0, color: null, x1: 0, y1: -100, x2: 0, y2: 100 }); ensureEntityIds();`);
        start('TTR');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_TTR');
        tapAt(50, 0); tapAt(0, 50);
        nearCircle(app.val('cmdState.circlePreview'), 10, 10, 10);
        // 2つ目を選び直す（下側の縦線の延長ではなく、下の側）
        tapAt(0, -50);
        nearCircle(app.val('cmdState.circlePreview'), 10, -10, 10);
        app.eval('dimConfirmPoint()');
        nearCircle(circles()[0], 10, -10, 10);
        assert.match(lastLog(), /円作成（接線・接線・半径）/);
    });

    it('接線・接線・半径: 線と円・円と円・ポリラインの辺（長方形の角）。数を打つと半径が変わる', () => {
        // 線と円: 円（中心 0,0 半径 20）と、その上の線 y = 30 → 間に半径 5 の円
        app.eval(`entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 0, cy: 0, radius: 20 }, { type: 'LINE', layer: 0, color: null, x1: -100, y1: 30, x2: 100, y2: 30 }); ensureEntityIds();`);
        start('TTR');
        app.eval(`processCommand('5')`);
        tapAt(0, 20); tapAt(0, 30);
        nearCircle(app.val('cmdState.circlePreview'), 0, 25, 5);
        // 円と円: 離れた2つの円（中心 0,0 と 30,0、半径 10）の間（すき間 10）に半径 5 の円
        app.eval(`resetCommand(); entities.length = 0; entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 0, cy: 0, radius: 10 }, { type: 'CIRCLE', layer: 0, color: null, cx: 30, cy: 0, radius: 10 }); ensureEntityIds();`);
        start('TTR');
        app.eval(`processCommand('5')`);
        tapAt(10, 0); tapAt(20, 0);
        nearCircle(app.val('cmdState.circlePreview'), 15, 0, 5);
        // 半径を変えると作り直す（間が狭すぎれば上か下に出る）
        app.eval(`processCommand('8')`);
        const c8 = app.val('cmdState.circlePreview');
        near(c8.r, 8);
        near(Math.hypot(c8.cx, c8.cy), 18); near(Math.hypot(c8.cx - 30, c8.cy), 18);
        // 長方形の角（2つの辺）
        app.eval(`resetCommand(); entities.length = 0; entities.push({ type: 'RECTANG', layer: 0, color: null, x1: 0, y1: 0, x2: 50, y2: 30 }); ensureEntityIds();`);
        start('TTR');
        app.eval(`processCommand('4')`);
        tapAt(25, 0); tapAt(0, 15);
        nearCircle(app.val('cmdState.circlePreview'), 4, 4, 4);
        app.eval('dimConfirmPoint()');
        nearCircle(circles()[0], 4, 4, 4);
        assert.equal(app.val('lastParams.radius'), '4');
    });

    it('接線・接線・半径: 接する円が無い・同じ線・線でないものは知らせる', () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 100, y2: 0 }, { type: 'LINE', layer: 0, color: null, x1: 0, y1: 100, x2: 100, y2: 100 },
            { type: 'TEXT', layer: 0, color: null, x: 200, y: 200, text: 'A', height: 5 }); ensureEntityIds();
            window.__toasts = []; window.__st0 = window.showToast; window.showToast = (m) => { window.__toasts.push(m); };`);
        try {
            start('TTR');
            tapAt(50, 0); tapAt(50, 0);
            assert.match(app.val('window.__toasts.join("|")'), /別の線・円/);
            tapAt(50, 100); // 平行で 100 離れている・半径 10
            assert.equal(app.val('cmdState.circlePreview'), null);
            assert.match(app.val('window.__toasts.join("|")'), /2つに接する円がありません/);
            app.eval(`processCommand('50')`); // 半径は変えられる（平行な2本に接する円は無数にあるので、作らない）
            tapAt(201, 201);
            assert.match(app.val('window.__toasts.join("|")'), /線・ポリライン・長方形・円・円弧をタップ/);
        } finally { app.eval('window.showToast = window.__st0;'); }
        app.eval('dimConfirmPoint()');
        assert.deepEqual(circles().filter((c) => c.r !== undefined).length, 0);
    });

    it('切り替え: コマンド欄の 3P・2P・TTR・CEN、下のバーの 🔄 の文字、作図設定の描き方（半径の欄は固定半径・接線接線半径だけ）', () => {
        start();
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_CENTER');
        assert.match(app.eval(`document.getElementById('dim-mode-toggle').textContent`), /自動 \(半径:10/);
        app.eval(`processCommand('2P')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_2P');
        assert.match(app.eval(`document.getElementById('dim-mode-toggle').textContent`), /2点（直径）/);
        app.eval(`processCommand('T')`);
        assert.match(app.eval(`document.getElementById('dim-mode-toggle').textContent`), /接線・接線・半径 \(半径:10/);
        app.eval(`processCommand('CEN')`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_CENTER');
        assert.equal(app.val('lastParams.circleMode'), 'manual');
        // 🔄 は描き方を選ぶ画面（テストでは confirm が「いいえ」なら2つ目の「中心と半径」）
        app.eval(`lastParams.circleMode = '3p'; window.__cf0 = window.confirm; window.confirm = () => true;`);
        try { app.eval('toggleCircleMode()'); } finally { app.eval('window.confirm = window.__cf0;'); }
        assert.equal(app.val('lastParams.circleMode'), 'auto');
        // 作図設定: 5つの描き方。3点にすると半径の欄は薄く、説明も変わる。「この設定で作図開始」で 3点 の作図
        app.eval('resetCommand(); processCommand("CIRCLE");');
        assert.equal(app.val(`document.querySelectorAll('input[name="circle-mode-radio"]').length`), 5);
        app.eval(`onCircleModeRadioChange('3p')`);
        assert.equal(app.eval(`document.getElementById('circle-r-row').style.opacity`), '0.5');
        assert.match(app.eval(`document.getElementById('circle-mode-desc').textContent`), /3点を通る/);
        app.eval('applyCirclePreset()');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_3P');
        // 接線・接線・半径は半径の欄を確かめる（0 は欄の下に理由）
        app.eval(`resetCommand(); processCommand("CIRCLE"); onCircleModeRadioChange('ttr'); document.getElementById('prop-circle-r').value = '0'; applyCirclePreset();`);
        assert.notEqual(app.eval('cmdState.mode'), 'WAITING_CIRCLE_TTR');
        app.eval(`document.getElementById('prop-circle-r').value = '7'; applyCirclePreset();`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_TTR');
        assert.equal(app.val('lastParams.radius'), '7');
    });

    it('仮の円・選んだ線を描いてもエラーにならず、Esc で終わる。手順カード・ヘルプにも描き方', () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: -100, y1: 0, x2: 100, y2: 0 }, { type: 'LINE', layer: 0, color: null, x1: 0, y1: -100, x2: 0, y2: 100 }); ensureEntityIds();`);
        for(const [key, pts] of [['3P', [[0, 10], [10, 0]]], ['2P', [[0, 0]]]]) {
            start(key);
            pts.forEach(([x, y]) => pt(x, y));
            app.eval(`mouse.wcsX = -10; mouse.wcsY = 0; _drawFrame(false);`);
        }
        start('TTR'); tapAt(50, 0); app.eval('_drawFrame(false);'); tapAt(0, 50); app.eval('_drawFrame(false);');
        app.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.ok(app.val(`GUIDE_COMMANDS.flatMap(([, l]) => l).some(([c, , d]) => c === 'CIRCLE' && /3P/.test(d))`));
        assert.deepEqual(app.errors(), []);
    });
});
