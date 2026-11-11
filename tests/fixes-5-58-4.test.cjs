'use strict';
// v5.58.4 で直したところのテスト（不具合の総点検で「未確認の気になる点」としていたもの）:
//   1. 角の処理: 何も変わらないとき（すでに角の2本を半径 0 で）も、↩ の履歴が1つ増えていた
//   2. ポリライン: 打ちまちがえた点を取り消せなかった（Ctrl+Z は前の作図を消した）→ ↶ 1つ戻す・U・Ctrl+Z で最後の点を取り消す
//   3. PC: 図面をクリックしたあとに打った字が、コマンド欄に入らなかった
//   4. 半径寸法・直径寸法: 選んだ円が ↩ で消えたあとでも、無い円の寸法ができていた
//   5. SIMA 出力: 区画番号がいつも 1 からの連番になり、取り込んだ番号が変わっていた
//   6. 寸法・測定・測量計算のバーを出したときも、開いているパネルをバーの上で終わらせる
// （Dropbox の知らせ・座標表の読み取りの欄は、tests/dropbox.test.cjs・tests/ai-read.test.cjs）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('v5.58.4 の修正', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            localStorage.setItem('cad_survey_unit', 'm'); cmdState.selectedIndices = []; document.body.classList.remove('fullscreen-mode');
            document.getElementById('command-line-area').classList.add('collapsed'); if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
            ucs = { originX: 0, originY: 0, angle: 0 }; view = { x: 400, y: 300, scale: 1, rotation: 0 };`);
    });
    const key = (target, init) => app.eval(`(() => { const ev = new window.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, ${JSON.stringify(init)})); ${target}.dispatchEvent(ev); window.__prevented = ev.defaultPrevented; })()`);

    it('角の処理: すでに角になっている2本を半径 0 で処理しても、↩ の履歴は増えない。変わるときは今までどおり1回分', () => {
        const run = (secondY1) => app.eval(`entities.length = 0; undoStack.length = 0;
            entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'LINE', layer: 0, color: null, x1: 10, y1: ${secondY1}, x2: 10, y2: 10 });
            lastParams.filletMode = 'fillet'; lastParams.filletR = '0';
            window.__hit = hitTestEntity; hitTestEntity = () => 1;
            try { processCommand('FILLET'); _editRef('filletFirst', 0); cmdState.filletTap = { x: 5, y: 0 }; cmdState.mode = 'WAITING_FILLET_SECOND';
                window.__r = editDoFillet({ x: 10, y: 5 }); } finally { hitTestEntity = window.__hit; }`);
        run(0);
        assert.equal(app.val('window.__r'), false);
        assert.equal(app.val('undoStack.length'), 0, '何も変わらないのに ↩ が増えない');
        assert.deepEqual({ ...app.val('({ a: entities[0].x2, b: entities[1].y1, n: entities.length })') }, { a: 10, b: 0, n: 2 });
        run(3); // 2本目が角まで届いていない: 角を出す
        assert.equal(app.val('window.__r'), true);
        assert.equal(app.val('undoStack.length'), 1);
        assert.equal(app.val('entities[1].y1'), 0);
    });

    it('ポリライン: ↶ 1つ戻す・U・Ctrl+Z で、最後に打った点だけ取り消す（前の作図は消さない）。点が無ければ、ふつうの ↩', () => {
        app.eval(`saveUndo(); entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 });
            processCommand('PLINE');`);
        const btn = () => app.val(`document.getElementById('line-undo-btn').style.display`);
        assert.equal(btn(), 'none', '点を打つ前は出さない');
        app.eval(`handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); handlePointInput({ x: 99, y: 99 }, true);`);
        assert.equal(btn(), '');
        assert.equal(app.val('lineUndoStep()'), true, '下のバーの ↶ 1つ戻す');
        assert.deepEqual([...app.val('cmdState.points.map(p => p.x)')], [0, 10]);
        app.eval(`processCommand('U')`);
        assert.equal(app.val('cmdState.points.length'), 1);
        key('document.body', { key: 'z', ctrlKey: true });
        assert.equal(app.val('cmdState.points.length'), 0);
        assert.equal(app.val('window.__prevented'), true);
        assert.equal(btn(), 'none');
        assert.deepEqual({ ...app.val('({ n: entities.length, u: undoStack.length, m: cmdState.mode })') }, { n: 1, u: 1, m: 'WAITING_PLINE_NEXT' }, '前に描いた線・↩ の履歴はそのまま');
        // 取り消したあとも、続けて描ける
        app.eval(`handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 5, y: 0 }, true); handlePointInput({ x: 5, y: 5 }, true); finishPline(false);`);
        assert.deepEqual([...app.val('entities[1].points.map(p => p.x + "," + p.y)')], ['0,0', '5,0', '5,5']);
        // 点が無いポリラインの途中の Ctrl+Z は、ふつうの ↩
        app.eval(`processCommand('PLINE')`);
        key('document.body', { key: 'z', ctrlKey: true });
        assert.equal(app.val('entities.length'), 1, 'ポリラインを取り消した');
        // ポリライン以外では、何もしない
        app.eval('resetCommand()');
        assert.equal(app.val('plineUndoStep()'), false);
    });

    it('PC: 図面をクリックしたあとに打った字は、コマンド欄に入る（たたんでいれば開く）。パネルの中・Ctrl つき・座標読取では何もしない', () => {
        const st = () => app.val(`({ c: document.getElementById('command-line-area').classList.contains('collapsed'), f: document.activeElement === document.getElementById('command-input') })`);
        key('document.body', { key: 'c', ctrlKey: true });
        assert.deepEqual({ ...st() }, { c: true, f: false });
        key('document.body', { key: 'F3' });
        assert.deepEqual({ ...st() }, { c: true, f: false }, '字でないキー');
        app.eval(`showPropertyPanel('テスト', '<div id="t-in" tabindex="0">x</div>')`);
        key(`document.getElementById('t-in')`, { key: 'c' });
        assert.deepEqual({ ...st() }, { c: true, f: false }, 'パネルの中');
        app.eval(`closePropertyPanel(); document.body.classList.add('fullscreen-mode')`);
        key('document.body', { key: 'c' });
        assert.deepEqual({ ...st() }, { c: true, f: false }, '座標読取（全画面）');
        app.eval(`document.body.classList.remove('fullscreen-mode')`);
        key('document.body', { key: 'c' });
        assert.deepEqual({ ...st() }, { c: false, f: true });
        assert.equal(app.val('window.__prevented'), false, '字はブラウザがコマンド欄に入れる（止めない）');
        // 数・@・マイナスも（座標の入力）
        for (const k of ['1', '@', '-', '.', '<']) {
            app.eval(`document.getElementById('command-input').blur(); document.getElementById('command-line-area').classList.add('collapsed')`);
            key('document.body', { key: k });
            assert.equal(st().f, true, k);
        }
        app.eval(`document.getElementById('command-input').blur()`);
    });

    it('半径寸法・直径寸法: 選んだ円が消えていたら、無い円の寸法を作らずに選び直す', () => {
        for (const [cmd, pos, sel, sub] of [['DRA', 'WAITING_DIMRAD_POS', 'WAITING_DIMRAD_SELECT', 'RADIUS'], ['DDI', 'WAITING_DIMDIA_POS', 'WAITING_DIMDIA_SELECT', 'DIAMETER']]) {
            app.eval(`resetCommand(); entities.length = 0; undoStack.length = 0;
                saveUndo(); entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 150, cy: 60, radius: 25 });
                processCommand('${cmd}'); cmdState.dimTarget = entities[0]; cmdState.mode = '${pos}'; undo();`);
            assert.equal(app.val('entities.length'), 0);
            app.eval('handlePointInput({ x: 200, y: 100 }, true)');
            assert.equal(app.val(`entities.filter(e => e.type === 'DIMENSION').length`), 0, cmd);
            assert.equal(app.val('cmdState.mode'), sel);
            // 円があれば、今までどおり
            app.eval(`entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 150, cy: 60, radius: 25 }); cmdState.dimTarget = entities[0]; cmdState.mode = '${pos}'; handlePointInput({ x: 200, y: 100 }, true);`);
            assert.deepEqual({ ...app.val(`(() => { const d = entities.find(e => e.type === 'DIMENSION'); return { s: d.subType, r: d.radius, x: d.center.x }; })()`) }, { s: sub, r: 25, x: 150 });
        }
    });

    it('SIMA 出力の区画番号: 取り込んだ番号がそろっていればそのまま。無い区画が混ざる・重なるときは 1 からの連番', () => {
        const pts = [1, 2, 3, 4, 5, 6].map((n) => ({ num: String(n), name: 'K' + n, X: n < 4 ? 0 : 20, Y: (n % 3) * 10, z: null }));
        pts[1].X = 10; pts[4].X = 30; // 三角形2つ
        const lots = (a, b) => [{ num: a, name: '848-1', refs: [{ num: '1' }, { num: '2' }, { num: '3' }] }, { num: b, name: '848-2', refs: [{ num: '4' }, { num: '5' }, { num: '6' }] }];
        const d00 = () => app.val(`buildSimaText('t').text`).split('\r\n').filter((l) => l.startsWith('D00,'));
        app.eval(`addSurveyData(${JSON.stringify(pts)}, ${JSON.stringify(lots('7', '12'))})`);
        assert.deepEqual(d00(), ['D00,7,848-1,1,', 'D00,12,848-2,1,']);
        // 読み直しても同じ番号
        assert.deepEqual([...app.val(`parseSima(buildSimaText('t').text).lots.map(l => l.num)`)], ['7', '12']);
        // 番号の無い区画（「区画」の画層に描いた閉じたポリライン）が混ざる: 連番
        app.eval(`entities.push({ type: 'PLINE', layer: entities.find(e => e.lotName).layer, color: null, closed: true, points: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }] })`);
        assert.deepEqual(d00().map((l) => l.split(',')[1]), ['1', '2', '3']);
        // 番号が重なる: 連番
        app.eval(`entities.length = 0; addSurveyData(${JSON.stringify(pts)}, ${JSON.stringify(lots('7', '7'))})`);
        assert.deepEqual(d00().map((l) => l.split(',')[1]), ['1', '2']);
        // 数でない番号: 連番
        app.eval(`entities.length = 0; addSurveyData(${JSON.stringify(pts)}, ${JSON.stringify(lots('A', '2'))})`);
        assert.deepEqual(d00().map((l) => l.split(',')[1]), ['1', '2']);
    });

    it('寸法・測定・測量計算のバーを出したときも、開いているパネルをバーの上で終わらせる', () => {
        app.eval(`window.__rects = { 'property-panel': [34, 100, 356, 700], 'fs-dim-actionbar': [20, 640, 370, 760] }; window.__oldRect = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = function() { const r = window.__rects[this.id]; if(!r) return window.__oldRect.call(this);
                return { left: r[0], top: r[1], right: r[2], bottom: r[3], width: r[2] - r[0], height: r[3] - r[1], x: r[0], y: r[1] }; };`);
        try {
            for (const show of ['_showDimActionBar(false)', `_showMeasureBar('BASE')`, '_cogoShowBar(true)']) {
                app.eval(`showPropertyPanel('テスト', '<div>x</div>'); document.getElementById('property-panel').style.maxHeight = ''; ${show};`);
                assert.equal(app.val(`document.getElementById('property-panel').style.maxHeight`), '524px', show);
                app.eval('resetCommand(); closePropertyPanel();');
            }
        } finally { app.eval('Element.prototype.getBoundingClientRect = window.__oldRect'); }
    });

    // ---- G3（別の担当が壊しにかかった点検）で見つかったもの ----
    const stubRects = (rects) => app.eval(`window.__rects = ${JSON.stringify(rects)}; if(!window.__oldRect) window.__oldRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function() { const r = window.__rects[this.id]; if(!r) return window.__oldRect.call(this);
            return { left: r[0], top: r[1], right: r[2], bottom: r[3], width: r[2] - r[0], height: r[3] - r[1], x: r[0], y: r[1] }; };`);
    const unstubRects = () => app.eval('if(window.__oldRect) { Element.prototype.getBoundingClientRect = window.__oldRect; window.__oldRect = null; }');
    const tick = () => new Promise((r) => setTimeout(r, 5));

    it('スマホの幅: 下のバーが「⌨ コマンド」「?」のボタンに重なるときは、その上に出す。重ならない幅では変えない', () => {
        const bar = () => app.val(`({ up: document.getElementById('fs-dim-actionbar').classList.contains('ab-up'), lift: document.getElementById('fs-dim-actionbar').style.getPropertyValue('--ab-lift') })`);
        try {
            app.eval(`window.__ih = window.innerHeight; window.innerHeight = 812; document.getElementById('fs-dim-actionbar').style.display = 'flex';`);
            // ボタン4つ（幅 368）: 右下の ⌨（339〜379）に重なる。上げた先で ? にも重なるので、その上まで
            stubRects({ 'fs-dim-actionbar': [11, 702, 379, 756], 'command-line-area': [339, 712, 379, 752], 'guide-help-btn': [339, 664, 379, 704] });
            app.eval('fitPanelAboveActionbar()');
            assert.deepEqual({ ...bar() }, { up: true, lift: '156px' }); // 812 - 664 + 8
            // ? が無い所（左にある・出ていない）なら、⌨ の上まで
            stubRects({ 'fs-dim-actionbar': [11, 702, 379, 756], 'command-line-area': [339, 712, 379, 752], 'guide-help-btn': [0, 0, 0, 0] });
            app.eval('fitPanelAboveActionbar()');
            assert.deepEqual({ ...bar() }, { up: true, lift: '108px' }); // 812 - 712 + 8
            // ボタン3つ（幅 276）: 重ならないので、そのまま
            stubRects({ 'fs-dim-actionbar': [57, 702, 333, 756], 'command-line-area': [339, 712, 379, 752], 'guide-help-btn': [339, 664, 379, 704] });
            app.eval('fitPanelAboveActionbar()');
            assert.equal(bar().up, false);
            // コマンド欄を開いている（CSS が欄の上に出す）・座標読取（全画面）では、何もしない
            stubRects({ 'fs-dim-actionbar': [11, 702, 379, 756], 'command-line-area': [62, 638, 365, 760], 'guide-help-btn': [339, 664, 379, 704] });
            app.eval(`document.getElementById('command-line-area').classList.remove('collapsed'); fitPanelAboveActionbar()`);
            assert.equal(bar().up, false);
            app.eval(`document.getElementById('command-line-area').classList.add('collapsed'); document.body.classList.add('fullscreen-mode'); fitPanelAboveActionbar()`);
            assert.equal(bar().up, false);
        } finally { unstubRects(); app.eval(`window.innerHeight = window.__ih; document.body.classList.remove('fullscreen-mode'); document.getElementById('fs-dim-actionbar').style.display = 'none';`); }
    });

    it('コマンド欄を開く・たたむと、開いているパネルの高さを測り直す（上がったバーに隠れない）', () => {
        try {
            stubRects({ 'property-panel': [34, 100, 356, 700], 'fs-dim-actionbar': [20, 640, 370, 694] });
            app.eval(`showPropertyPanel('テスト', '<div>x</div>'); document.getElementById('fs-dim-actionbar').style.display = 'flex'; fitPanelAboveActionbar();`);
            assert.equal(app.val(`document.getElementById('property-panel').style.maxHeight`), '524px');
            stubRects({ 'property-panel': [34, 100, 356, 700], 'fs-dim-actionbar': [20, 480, 370, 534] }); // 欄を開くと、バーが上がる
            app.eval('toggleCommandLine()');
            assert.equal(app.val(`document.getElementById('property-panel').style.maxHeight`), '364px');
            app.eval('toggleCommandLine()');
        } finally { unstubRects(); app.eval('resetCommand(); closePropertyPanel();'); }
    });

    it('メニュー・一覧・画面いっぱいのパネルを開いているあいだは、打った字を裏のコマンド欄に入れない', () => {
        const typed = () => { key('document.body', { key: 'l' }); const f = app.val(`document.activeElement === document.getElementById('command-input')`);
            app.eval(`document.getElementById('command-input').blur(); document.getElementById('command-line-area').classList.add('collapsed')`); return f; };
        assert.equal(typed(), true, '何も開いていなければ入る');
        app.eval(`document.getElementById('top-menu-modal').style.display = 'flex'`);
        assert.equal(typed(), false, '☰ メニュー');
        app.eval(`document.getElementById('top-menu-modal').style.display = 'none'; document.getElementById('osnap-panel').style.display = 'block'`);
        assert.equal(typed(), false, 'スナップの設定');
        app.eval(`document.getElementById('osnap-panel').style.display = 'none'; window.__pl = document.getElementById('project-list-panel'); window.__pld = window.__pl.style.display; window.__pl.style.display = 'flex'`);
        assert.equal(typed(), false, '保存一覧');
        app.eval(`window.__pl.style.display = window.__pld || 'none'; window.__ep = document.getElementById('cad-err-panel'); if(window.__ep) window.__ep.classList.add('show')`);
        if (app.val('!!window.__ep')) assert.equal(typed(), false, 'エラーの画面');
        app.eval(`if(window.__ep) window.__ep.classList.remove('show'); showPropertyPanel('テスト', '<div>x</div>'); setPropertyPanelMaximized(true);`);
        assert.equal(typed(), false, '画面いっぱいのパネル');
        app.eval(`setPropertyPanelMaximized(false)`);
        assert.equal(typed(), true, 'ふつうの大きさのパネル（図面が見えている）なら入る');
        app.eval(`window.__iw = window.innerWidth; window.innerWidth = 390`);
        assert.equal(typed(), false, 'スマホの幅のパネル（図面を覆う）');
        app.eval(`window.innerWidth = window.__iw; closePropertyPanel();`);
        key('document.body', { key: 'k', keyCode: 229 });
        assert.equal(app.val(`document.activeElement === document.getElementById('command-input')`), false, '日本語入力の途中（keyCode 229）');
    });

    it('ポリライン: 座標を打って入れた点も、コマンド欄が空なら Ctrl+Z で取り消せる。Ctrl+Y・Ctrl+Shift+Z で戻る（関係ない前の取り消しはやり直さない）', () => {
        // 前に取り消した線（やり直しに1件）
        app.eval(`saveUndo(); entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }); undo();`);
        assert.equal(app.val('redoStack.length'), 1);
        app.eval(`processCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); handlePointInput({ x: 10, y: 10 }, true);
            document.getElementById('command-input').value = ''; document.getElementById('command-input').focus();`);
        key(`document.getElementById('command-input')`, { key: 'z', ctrlKey: true });
        assert.equal(app.val('cmdState.points.length'), 2);
        assert.equal(app.val('window.__prevented'), true);
        key(`document.getElementById('command-input')`, { key: 'y', ctrlKey: true });
        assert.deepEqual([...app.val('cmdState.points.map(p => p.x + "," + p.y)')], ['0,0', '10,0', '10,10'], '取り消した点が戻る');
        assert.deepEqual({ ...app.val('({ n: entities.length, r: redoStack.length })') }, { n: 0, r: 1 }, '前に取り消した線は復活しない');
        // 打ちかけの字があるときは、欄の中の取り消し（ブラウザ）に任せる
        app.eval(`document.getElementById('command-input').value = '12'`);
        key(`document.getElementById('command-input')`, { key: 'z', ctrlKey: true });
        assert.equal(app.val('cmdState.points.length'), 3);
        assert.equal(app.val('window.__prevented'), false);
        app.eval(`document.getElementById('command-input').value = ''; document.getElementById('command-input').blur();`);
        // 図面の側でも: Ctrl+Z → Ctrl+Shift+Z
        key('document.body', { key: 'z', ctrlKey: true });
        key('document.body', { key: 'z', ctrlKey: true });
        assert.equal(app.val('cmdState.points.length'), 1);
        key('document.body', { key: 'Z', ctrlKey: true, shiftKey: true });
        assert.equal(app.val('cmdState.points.length'), 2);
        // 新しい点を打つと、戻せる点は捨てる
        app.eval('handlePointInput({ x: 50, y: 50 }, true)');
        assert.equal(app.val('plineRedoStep()'), false);
        assert.deepEqual([...app.val('cmdState.points.map(p => p.x)')], [0, 10, 50]);
        app.eval('resetCommand()');
    });

    it('ポリラインの途中で別のコマンドを始めたら、「⭘ 閉じる」「↶ 1つ戻す」を残さない', async () => {
        const btns = () => app.val(`[document.getElementById('pline-close-btn').style.display, document.getElementById('line-undo-btn').style.display]`);
        for (const cmd of ['TRIM', 'DLI', 'MEASURE', 'OFFSET']) {
            app.eval(`resetCommand(); processCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true);`);
            assert.deepEqual([...btns()], ['', '']);
            app.eval(`processCommand('${cmd}')`);
            await tick();
            assert.deepEqual([...btns()], ['none', 'none'], cmd);
        }
        // ポリラインのまま続くもの（打ちまちがい・U）では消さない
        app.eval(`resetCommand(); processCommand('PLINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); processCommand('U');`);
        await tick();
        assert.deepEqual([...btns()], ['', '']);
        app.eval('resetCommand()');
    });
    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
