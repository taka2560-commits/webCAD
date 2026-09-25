'use strict';
// 現場で使いやすく: オプション「ボタンの大きさ」（--btn-k）と「屋外モード」（線を太く・文字を太字で縁取り・
// 背景との明るさの差を広げる・パネルを不透明に）、お気に入りの「屋外」ボタン、コマンド OUTDOOR のテスト
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('屋外モード・ボタンの大きさ', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            resetCommand(); hidePropertyPanel();
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {}; applyDisplayPrefs();
            setCanvasBackground('#000');
            entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 1, rotation: 0 };
            ucs = { originX: 0, originY: 0, angle: 0 };
            snapResult = null; cmdState.highlightIdx = -1; cmdState.selectedIndices = [];
            _fav.items = []; Object.assign(_fav, { show: true, dir: 'v', labels: true, folded: false }); _favSave(); favRenderBar();
        `);
    });

    const cssVar = (name) => app.eval(`document.documentElement.style.getPropertyValue('${name}')`);
    const outdoorClass = () => app.eval(`document.body.classList.contains('outdoor-mode')`);
    const lum = (hex) => app.eval(`_rgbLum(_hexRgb('${hex}'))`);
    // 図形を描いたときの線の太さ・色と、文字（縁取り・太さ）を集める
    function capture() {
        app.eval(`window.__c = { strokes: [], halos: [], fonts: [] };
            ctx.stroke = () => window.__c.strokes.push({ w: ctx.lineWidth, c: String(ctx.strokeStyle) });
            ctx.strokeText = (t) => window.__c.halos.push({ t: String(t), w: ctx.lineWidth, c: String(ctx.strokeStyle) });
            ctx.fillText = (t) => window.__c.fonts.push({ t: String(t), f: String(ctx.font) });`);
        try { app.eval('_drawFrame(false)'); } finally { app.eval('delete ctx.stroke; delete ctx.strokeText; delete ctx.fillText;'); }
        return app.val('window.__c');
    }

    it('初期値（中・切）は以前と同じ', () => {
        assert.equal(app.eval(`displayPrefKey('btnSize')`), 'm');
        assert.equal(app.eval(`displayPrefKey('outdoor')`), 'off');
        assert.equal(cssVar('--btn-k'), '1');
        assert.equal(outdoorClass(), false);
        assert.equal(app.eval(`lineWidthPx(1)`), 1);
        assert.equal(app.eval(`outdoorFontWeight()`), '');
        assert.equal(app.eval(`outdoorColor('#0000ff')`), '#0000ff');
        app.eval(`entities.push({ type:'LINE', layer:0, color:'#0000ff', x1:-50, y1:0, x2:50, y2:0 });
                  entities.push({ type:'TEXT', layer:0, color:null, x:0, y:20, text:'P1', height:12 });`);
        const c = capture();
        assert.ok(c.strokes.some(s => s.w === 1 && s.c === '#0000ff'), JSON.stringify(c.strokes));
        assert.equal(c.halos.length, 0);
        assert.ok(c.fonts.some(f => f.t === 'P1' && /^12px/.test(f.f)), JSON.stringify(c.fonts));
    });

    it('ボタンの大きさ: CSS の --btn-k を変え、画面の部品の位置を合わせ直す（resize）', () => {
        app.eval(`window.__rs = 0; window.addEventListener('resize', () => window.__rs++);`);
        app.eval(`setDisplayPref('btnSize', 'xl')`);
        assert.equal(cssVar('--btn-k'), '1.5');
        assert.ok(app.eval('window.__rs') >= 1);
        app.eval(`setDisplayPref('btnSize', 's')`);
        assert.equal(cssVar('--btn-k'), '0.85');
        // 読み直しても同じ（次に開いたとき）
        app.eval(`_displayPrefs = _loadDisplayPrefs(); applyDisplayPrefs();`);
        assert.equal(cssVar('--btn-k'), '0.85');
        app.eval(`resetDisplayPrefs()`);
        assert.equal(cssVar('--btn-k'), '1');
    });

    it('屋外モード: 線を太く、文字を太字にして背景色で縁取る', () => {
        app.eval(`setDisplayPref('outdoor', 'on')`);
        assert.equal(outdoorClass(), true);
        assert.equal(app.eval(`lineWidthPx(1)`), 2);
        assert.equal(app.eval(`lineWidthPx(2, 1.5)`), 3);
        app.eval(`entities.push({ type:'LINE', layer:0, color:'#ffffff', x1:-50, y1:0, x2:50, y2:0 });
                  entities.push({ type:'TEXT', layer:0, color:null, x:0, y:20, text:'P1', height:12 });
                  entities.push({ type:'DIMENSION', subType:'LINEAR', dimDir:'H', layer:0, color:null, p1:{x:-50,y:0}, p2:{x:50,y:0}, offset:-20 });`);
        const c = capture();
        assert.ok(c.strokes.some(s => s.w === 2 && s.c === '#ffffff'), '図形の線は2倍: ' + JSON.stringify(c.strokes));
        assert.ok(c.fonts.some(f => f.t === 'P1' && /^bold 12px/.test(f.f)), JSON.stringify(c.fonts));
        assert.ok(c.halos.some(h => h.t === 'P1' && h.c === '#000' && h.w >= 2), '文字の縁取り（背景色）: ' + JSON.stringify(c.halos));
        // 寸法も線を太く・文字を太字で縁取る
        assert.ok(c.fonts.some(f => f.t === '100' && /^bold /.test(f.f)), JSON.stringify(c.fonts));
        assert.ok(c.halos.some(h => h.t === '100'));
        // 切にすると元どおり
        app.eval(`setDisplayPref('outdoor', 'off')`);
        assert.equal(outdoorClass(), false);
        const d = capture();
        assert.equal(d.halos.length, 0);
        assert.ok(d.strokes.some(s => s.w === 1 && s.c === '#ffffff'));
    });

    it('屋外モードの色: 背景との明るさの差が小さい色だけ、色味を残して明るく・暗くする', () => {
        app.eval(`setDisplayPref('outdoor', 'on')`);
        // 黒の背景: 暗い青は明るく（青の成分がいちばん大きいまま）、白・明るい色はそのまま
        const blue = app.eval(`outdoorColor('#0000ff')`);
        assert.ok(lum(blue) >= 0.54, blue);
        assert.ok(/^#([0-9a-f]{2})\1ff$/.test(blue), blue);
        assert.equal(app.eval(`outdoorColor('#ffffff')`), '#ffffff');
        assert.equal(app.eval(`outdoorColor('#00ff88')`), '#00ff88');
        assert.equal(app.eval(`outdoorColor('rgb(1,2,3)')`), 'rgb(1,2,3)'); // 読めない色はそのまま
        // 白の背景: 水色は暗く（緑と青は同じ量のまま）、黒はそのまま
        app.eval(`setCanvasBackground('#ffffff')`);
        const cyan = app.eval(`outdoorColor('#00ffff')`);
        assert.ok(lum(cyan) <= 0.46, cyan);
        assert.equal(cyan.slice(3, 5), cyan.slice(5, 7));
        assert.equal(app.eval(`outdoorColor('#000000')`), '#000000');
        // グレーの背景: 背景に近い赤は暗く、近い緑は明るく
        app.eval(`setCanvasBackground('#808080')`);
        assert.ok(lum(app.eval(`outdoorColor('#ff0000')`)) < lum('#ff0000'));
        assert.ok(lum(app.eval(`outdoorColor('#00ff00')`)) > lum('#00ff00'));
        // 図形の線の色も、背景を変えるとすぐ変わる（色の控えは背景・屋外モードごと）
        app.eval(`setCanvasBackground('#ffffff'); entities.push({ type:'LINE', layer:0, color:'#00ffff', x1:-50, y1:0, x2:50, y2:0 });`);
        assert.ok(capture().strokes.some(s => s.c === cyan));
    });

    it('お気に入りの「屋外」ボタン: 押すたびに入・切、入のあいだは光る。コマンド OUTDOOR・SUN', () => {
        app.eval(`favToggle('OUTDOOR')`);
        const btn = `document.querySelector('#fav-bar .fav-btn[data-id="OUTDOOR"]')`;
        assert.equal(app.eval(`${btn}.classList.contains('active')`), false);
        app.eval(`${btn}.click()`);
        assert.equal(outdoorClass(), true);
        assert.equal(app.eval(`${btn}.classList.contains('active')`), true);
        assert.match(app.eval(`document.getElementById('command-log').textContent`), /屋外モード: 入/);
        app.eval(`${btn}.click()`);
        assert.equal(outdoorClass(), false);
        assert.equal(app.eval(`${btn}.classList.contains('active')`), false);
        app.eval(`processCommand('OUTDOOR')`);
        assert.equal(outdoorClass(), true);
        app.eval(`processCommand('sun')`);
        assert.equal(outdoorClass(), false);
        app.eval(`favToggle('OUTDOOR')`);
    });

    it('オプション画面: 「ボタンの大きさ」「屋外モード」の行と説明', () => {
        app.eval(`showOptionsPanel()`);
        const html = app.eval(`document.getElementById('property-panel-content').innerHTML`);
        assert.match(html, /ボタンの大きさ/);
        assert.match(html, /屋外モード/);
        assert.match(html, /手袋/);
        app.eval(app.eval(`document.querySelector('.opt-pref-btn[data-pref="outdoor"][data-key="on"]').getAttribute('onclick')`));
        assert.equal(outdoorClass(), true);
        app.eval(app.eval(`document.querySelector('.opt-pref-btn[data-pref="btnSize"][data-key="l"]').getAttribute('onclick')`));
        assert.equal(cssVar('--btn-k'), '1.25');
        app.eval(`resetDisplayPrefs()`);
        assert.equal(outdoorClass(), false);
        assert.equal(cssVar('--btn-k'), '1');
    });

    it('未捕捉エラーが起きない', () => {
        app.eval(`setCanvasBackground('#000')`);
        assert.deepEqual(app.errors(), []);
    });
});
