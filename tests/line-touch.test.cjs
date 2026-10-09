'use strict';
// 線分のタッチの誤爆を防ぐ（v5.35。cad-line.js）:
//   タッチは指を離した所が仮の点 → ☑確定 で引く（タップし直すと動く・ピンチでは置かない）、
//   ↶ 1つ戻す（コマンド U）、長さ0の線は作らない、マウス・座標の入力はすぐ、オプション「線分のタッチ」で「離したらすぐ」
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('線分のタッチ（仮の点 → ☑確定）', () => {
    let app;
    before(async () => {
        app = await loadApp();
        app.eval(`window.__touch = (type, pts) => { const ev = new Event(type, { bubbles:true, cancelable:true });
            Object.defineProperty(ev, 'touches', { value: pts.map(p => ({ clientX: p[0], clientY: p[1] })) }); canvas.dispatchEvent(ev); };`);
    });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); entities.length = 0; undoStack.length = 0; redoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            view = { x: 400, y: 300, scale: 1, rotation: 0 }; ucs = { originX: 0, originY: 0, angle: 0 }; snapResult = null; orthoMode = false;
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {};
            Object.keys(osnapState).forEach(k => { if(typeof osnapState[k] === 'boolean') osnapState[k] = false; });`);
    });
    // 画面の (sx, sy) をタップする（なぞるときは途中の点も）
    const tap = (sx, sy) => app.eval(`__touch('touchstart', [[${sx}, ${sy}]]); __touch('touchend', []);`);
    const drag = (pts) => {
        const [s, ...rest] = pts;
        app.eval(`__touch('touchstart', [[${s[0]}, ${s[1]}]]);` + rest.map((p) => `__touch('touchmove', [[${p[0]}, ${p[1]}]]);`).join('') + `__touch('touchend', []);`);
    };
    const lines = () => app.val(`entities.filter(e => e.type === 'LINE').map(e => [e.x1, e.y1, e.x2, e.y2].map(v => +v.toFixed(6)))`);
    const confirmBtn = () => app.eval(`document.querySelector('#fs-dim-actionbar button[onclick="dimConfirmPoint()"]').style.display`);
    const undoBtn = () => app.eval(`document.getElementById('line-undo-btn').style.display`);
    const prompt = () => app.eval(`document.getElementById('command-prompt').textContent`);

    it('指を離しても線は引かれず、仮の点になる。☑確定 で始点 → 次の点を決めて線を引く', () => {
        app.eval(`processCommand('LINE')`);
        assert.equal(app.eval(`document.getElementById('fs-dim-actionbar').style.display`), 'flex', '下のバー（❌ 終了）');
        assert.equal(confirmBtn(), 'none', '仮の点を置くまでは ☑確定 を出さない');
        tap(400, 300); // 図面の (0, 0)
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1', 'まだ始点は決まらない');
        assert.deepEqual(app.val('cmdState.lineCand'), { x: 0, y: 0 });
        assert.equal(confirmBtn(), '', '仮の点を置いたら ☑確定 を出す');
        assert.match(prompt(), /☑確定 で決める/);
        app.eval('dimConfirmPoint()');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        assert.equal(app.eval('cmdState.lineCand'), null);
        assert.equal(confirmBtn(), 'none');
        assert.equal(undoBtn(), '', '始点を決めたら ↶ 1つ戻す');
        tap(500, 300); // (100, 0)
        assert.deepEqual(lines(), [], '2点目も、指を離しただけでは引かない');
        app.eval('dimConfirmPoint()');
        assert.deepEqual(lines(), [[0, 0, 100, 0]]);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2', '続けて引ける');
        assert.deepEqual(app.val('cmdState.startWcs'), { x: 100, y: 0 });
        assert.deepEqual(app.errors(), []);
    });

    it('タップし直すと仮の点が動き、☑確定 では最後の仮の点だけを使う（触れてしまった所には引かれない）', () => {
        app.eval(`processCommand('LINE')`);
        tap(400, 300); app.eval('dimConfirmPoint()');
        tap(450, 350); tap(420, 250); tap(500, 200); // 3回タップ（誤って触れた2回を含む）
        assert.deepEqual(lines(), []);
        app.eval('dimConfirmPoint()');
        assert.deepEqual(lines(), [[0, 0, 100, 100]]);
        assert.match(app.eval(`document.getElementById('guide-tip') ? document.getElementById('guide-tip').textContent : ''`), /☑確定|^$/);
    });

    it('なぞって離すと、離した所が仮の点（ルーペで合わせる使い方はそのまま）', () => {
        app.eval(`processCommand('LINE')`);
        drag([[300, 300], [350, 300], [380, 280]]);
        assert.deepEqual(app.val('cmdState.lineCand'), { x: -20, y: 20 });
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1');
    });

    it('2本指で拡大・移動しても仮の点は変わらない（拡大して確かめてから ☑確定 できる）', () => {
        app.eval(`processCommand('LINE')`);
        tap(400, 300);
        app.eval(`__touch('touchstart', [[300, 300]]); __touch('touchstart', [[300, 300], [400, 300]]);
            __touch('touchmove', [[280, 300], [420, 300]]); __touch('touchend', [[280, 300]]); __touch('touchend', []);`);
        assert.deepEqual(app.val('cmdState.lineCand'), { x: 0, y: 0 });
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1');
    });

    it('仮の点を置く前の ☑確定 は何もせず知らせる。❌ 終了（Esc）で仮の点も消える', () => {
        app.eval(`processCommand('LINE'); dimConfirmPoint();`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1');
        assert.match(app.eval(`document.getElementById('cad-toast') ? document.getElementById('cad-toast').textContent : document.body.textContent`), /タップしてから ☑確定/);
        tap(400, 300);
        app.eval(`processCommand('CANCEL')`);
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(app.eval('cmdState.lineCand'), undefined);
        assert.equal(undoBtn(), 'none');
        assert.equal(app.eval(`document.getElementById('fs-dim-actionbar').style.display`), 'none');
    });

    it('↶ 1つ戻す: 最後の線を消してその始点から。線が無ければ始点を取り消す。コマンド U も同じ（↩ の履歴にも残る）', () => {
        app.eval(`processCommand('LINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); handlePointInput({ x: 10, y: 10 }, true);`);
        assert.equal(lines().length, 2);
        app.eval('lineUndoStep()');
        assert.deepEqual(lines(), [[0, 0, 10, 0]]);
        assert.deepEqual(app.val('cmdState.startWcs'), { x: 10, y: 0 }, '消した線の始点から引き直す');
        app.eval(`processCommand('U')`);
        assert.deepEqual(lines(), []);
        assert.deepEqual(app.val('cmdState.startWcs'), { x: 0, y: 0 });
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        assert.equal(app.eval(`document.getElementById('line-undo-btn').getAttribute('onclick')`), 'lineUndoStep()');
        app.eval('lineUndoStep()');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1', '線が無ければ始点を取り消す');
        assert.equal(undoBtn(), 'none');
        // 引き直せる
        app.eval(`handlePointInput({ x: 5, y: 5 }, true); handlePointInput({ x: 6, y: 5 }, true);`);
        assert.deepEqual(lines(), [[5, 5, 6, 5]]);
        // ↩（元に戻す）で消した線も戻せる
        app.eval('resetCommand(); undo(); undo();');
        assert.equal(lines().length >= 1, true);
        // 線分の外の U はこれまでどおり ↩
        app.eval(`entities.length = 0; undoStack.length = 0; saveUndo(); entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 1, y2: 1 }); processCommand('U');`);
        assert.deepEqual(lines(), []);
    });

    it('↶ 1つ戻す は、ほかの操作で消えた線を飛ばす', () => {
        app.eval(`processCommand('LINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 0 }, true); handlePointInput({ x: 20, y: 0 }, true);`);
        app.eval(`entities.splice(1, 1);`); // 2本目がほかの操作で消えた
        app.eval('lineUndoStep()');
        assert.deepEqual(lines(), []);
        assert.deepEqual(app.val('cmdState.startWcs'), { x: 0, y: 0 });
    });

    it('点検で直したこと（v5.39.3）: U のあとの「@X,Y」は戻した点から・仮の点だけの U・別のコマンドに替えたら ↶ を残さない', async () => {
        const tick = () => new Promise((r) => setTimeout(r, 0));
        // U のあとの相対座標は、戻した始点から（以前は消した線の終点から引いた）
        app.eval(`processCommand('LINE'); processCommand('0,0'); processCommand('0,100'); processCommand('U'); processCommand('@0,50');`);
        assert.deepEqual(lines(), [[0, 0, 50, 0]]);
        // 始点の前の仮の点だけで U: 仮の点を消し、☑確定・案内も戻す
        app.eval(`resetCommand(); entities.length = 0; processCommand('LINE');`);
        tap(400, 300);
        assert.equal(confirmBtn(), '');
        app.eval(`processCommand('U')`);
        assert.equal(app.val('cmdState.lineCand'), null);
        assert.equal(confirmBtn(), 'none');
        assert.doesNotMatch(prompt(), /☑確定 で決める/);
        // 途中で使うコマンド（ZE）なら、線分の ↶ はそのまま
        app.eval(`resetCommand(); toggleCommand('LINE'); processCommand('0,0'); processCommand('ZE');`);
        await tick();
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        assert.equal(undoBtn(), '');
        // 別のコマンド（円弧）に替えると、線分の ↶ と下のバーを残さない
        app.eval(`toggleCommand('ARC')`);
        await tick();
        assert.equal(app.eval('cmdState.mode'), 'WAITING_ARC_P1');
        assert.equal(undoBtn(), 'none');
        assert.equal(app.eval(`document.getElementById('fs-dim-actionbar').style.display`), 'none');
        app.eval('resetCommand();');
    });

    it('⇄ で候補を替えると仮の点も替わり、☑確定 ではその点を使う（v5.39.3。以前は古い仮の点が入った）', () => {
        app.eval(`osnapState.main = true; osnapState.end = true; osnapState.mid = true;
            entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 6, y2: 0 }); ensureEntityIds(); processCommand('LINE');`);
        tap(403, 300); // 中点 (3, 0) の近く。端点も 3px
        assert.deepEqual(app.val('cmdState.lineCand'), { x: 3, y: 0 });
        app.eval('cycleSnapCandidate()');
        const s = app.val('({ x: snapResult.wcsX, y: snapResult.wcsY })');
        assert.notDeepEqual(s, { x: 3, y: 0 });
        assert.deepEqual(app.val('cmdState.lineCand'), s, '仮の点も選んだ候補に');
        app.eval('dimConfirmPoint()');
        assert.deepEqual(app.val('cmdState.startWcs'), s);
        app.eval('resetCommand();');
    });

    it('長さ0の線は作らない（同じ点をもう一度・指の二度押し）', () => {
        app.eval(`processCommand('LINE'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 0, y: 0 }, true);`);
        assert.deepEqual(lines(), []);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        // タッチは画面で 3px 未満も作らない（倍率 1 なら 2 単位）。マウス・座標は作る
        app.eval(`handlePointInput({ x: 2, y: 0 }, false)`);
        assert.deepEqual(lines(), []);
        app.eval(`handlePointInput({ x: 2, y: 0 }, true)`);
        assert.deepEqual(lines(), [[0, 0, 2, 0]]);
        app.eval(`processCommand('0.001,0')`); // 打ち込んだ座標は小さくても作る（X＝北・Y＝東: 図面の (0, 0.001)）
        assert.equal(lines().length, 2);
    });

    it('マウスのクリック・座標の入力はこれまでどおりすぐ引く（☑確定 は要らない）', () => {
        app.eval(`processCommand('LINE'); lastTouchTime = 0;`); // 直前のテストのタッチの直後のマウスは、タッチから来た偽のマウスとして無視される
        app.eval(`canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300, bubbles: true }));
            canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300, button: 0, bubbles: true }));`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        app.eval(`processCommand('0,50')`);
        assert.deepEqual(lines(), [[0, 0, 50, 0]]);
        assert.equal(app.eval('cmdState.lineCand'), null);
    });

    it('オプション「線分のタッチ」を「離したらすぐ」にすると、指を離した所ですぐ引く', () => {
        app.eval(`setDisplayPref('lineTouch', 'now'); processCommand('LINE')`);
        tap(400, 300);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2');
        tap(400, 200);
        assert.deepEqual(lines(), [[0, 0, 0, 100]]);
        assert.equal(app.eval('cmdState.lineCand'), null);
        tap(401, 200); // 二度押し（1px）は線にしない
        assert.equal(lines().length, 1);
        assert.match(app.eval(`displayPrefsSectionHtml()`), /線分のタッチ[\s\S]*☑確定で引く[\s\S]*離したらすぐ/);
    });

    it('仮の点は緑の輪で描き、2点目の仮の線は仮の点まで（描画の状態は毎コマ元に戻る）', () => {
        app.eval(`processCommand('LINE'); handlePointInput({ x: 0, y: 0 }, true);`);
        tap(500, 300);
        app.eval(`window.__arcs = []; const a = ctx.arc.bind(ctx); ctx.arc = (x, y, r, ...rest) => { window.__arcs.push([x, y, r]); return a(x, y, r, ...rest); };
            window.__segs = []; const l = ctx.lineTo.bind(ctx); ctx.lineTo = (x, y) => { window.__segs.push([x, y]); return l(x, y); };
            _drawFrame(false); delete ctx.arc; delete ctx.lineTo;`);
        assert.ok(app.val('window.__arcs').some((c) => c[0] === 500 && c[1] === 300 && c[2] === 9), '仮の点の輪');
        assert.ok(app.val('window.__segs').some((p) => p[0] === 500 && p[1] === 300), '始点から仮の点への線');
        assert.equal(app.eval('ctx.getLineDash().length'), 0);
    });
});
