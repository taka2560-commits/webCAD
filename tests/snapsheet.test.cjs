'use strict';
// スナップのシート（v5.46。cad-snapsheet.js）と、点の横の ☑確定 を円・寸法にも（cad-line.js）
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('スナップのシート・点の横の ☑確定（円・寸法）', () => {
    let app;
    before(async () => {
        app = await loadApp();
        app.eval(`window.__ptr = (el, type, x, y) => { const ev = new Event(type, { bubbles: true, cancelable: true });
            Object.assign(ev, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', button: 0 }); el.dispatchEvent(ev); };
            window.__touch = (type, pts) => { const ev = new Event(type, { bubbles:true, cancelable:true });
            Object.defineProperty(ev, 'touches', { value: pts.map(p => ({ clientX: p[0], clientY: p[1] })) }); canvas.dispatchEvent(ev); };`);
    });
    after(() => app.close());
    beforeEach(() => app.eval(`resetCommand(); snapSheetClose(); entities.length = 0; osnapState.main = true; osnapState.end = true; osnapState.mid = true; osnapState.cen = false;
        view = { x: 400, y: 300, scale: 1, rotation: 0 }; localStorage.removeItem('cad_display_prefs'); _displayPrefs = {}; window.__keyAt = null;
        document.elementFromPoint = () => window.__keyAt ? document.querySelector('#snap-sheet [data-ss="' + window.__keyAt + '"]') : document.body;`));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    it('長押しで開き、指を滑らせて種類の上で離すと入／切して閉じる。OSNAP の入／切はしない', async () => {
        app.eval(`__ptr(document.getElementById('btn-osnap'), 'pointerdown', 500, 590);`);
        assert.equal(app.val('snapSheetIsOpen()'), false, 'すぐには開かない（短いタップは今までどおり）');
        await wait(320);
        assert.equal(app.val('snapSheetIsOpen()'), true);
        assert.equal(app.val(`document.querySelectorAll('#snap-sheet .ss-chip').length`) > 10, true);
        app.eval(`window.__keyAt = 'cen'; __ptr(document.getElementById('btn-osnap'), 'pointermove', 300, 450);`);
        assert.equal(app.val(`document.querySelector('#snap-sheet [data-ss="cen"]').classList.contains('hover')`), true, '指の下の種類を光らせる');
        app.eval(`__ptr(document.getElementById('btn-osnap'), 'pointerup', 300, 450); document.getElementById('btn-osnap').click();`);
        assert.equal(app.val('osnapState.cen'), true, '中心を入に');
        assert.equal(app.val('osnapState.main'), true, '長押しのあとの click では OSNAP を切らない');
        assert.equal(app.val(`JSON.parse(localStorage.getItem(OSNAP_PREFS_KEY)).cen`), true, '覚える');
        await wait(260);
        assert.equal(app.val('snapSheetIsOpen()'), false, '変えたら閉じる');
    });

    it('上へなぞっても開く。種類の外で離すと開いたままで、押して変えられる。外を押すと閉じる', async () => {
        app.eval(`__ptr(document.getElementById('btn-osnap-panel'), 'pointerdown', 520, 590); __ptr(document.getElementById('btn-osnap-panel'), 'pointermove', 520, 560);`);
        assert.equal(app.val('snapSheetIsOpen()'), true);
        app.eval(`__ptr(document.getElementById('btn-osnap-panel'), 'pointerup', 520, 560);`);
        await wait(260);
        assert.equal(app.val('snapSheetIsOpen()'), true, '開いたまま');
        app.eval(`document.querySelector('#snap-sheet [data-ss="mid"]').click();`);
        assert.equal(app.val('osnapState.mid'), false);
        assert.equal(app.val('snapSheetIsOpen()'), true, '押して変えたときは閉じない');
        app.eval(`document.querySelector('#snap-sheet [data-ss="main"]').click();`);
        assert.equal(app.val('osnapState.main'), false, 'OSNAP の入／切');
        app.eval(`const ev = new Event('pointerdown', { bubbles: true }); canvas.dispatchEvent(ev);`);
        assert.equal(app.val('snapSheetIsOpen()'), false, '外を押すと閉じる');
    });

    it('「次の1点だけ」はコマンドの途中で、指を離した種類に', async () => {
        app.eval(`processCommand('LINE');`);
        app.eval(`__ptr(document.getElementById('fs-btn-osnap'), 'pointerdown', 700, 500);`);
        await wait(320);
        app.eval(`window.__keyAt = 'once:end'; __ptr(document.getElementById('fs-btn-osnap'), 'pointerup', 400, 500);`);
        assert.equal(app.val('snapOverrideLabel()'), '端点');
        app.eval('resetCommand();');
    });

    it('点検で直したこと: Esc はシートだけ閉じる・OSNAP の入／切は実際の状態から・長押しのあと click が来なくても次のタップは効く', async () => {
        app.eval(`processCommand('LINE'); processCommand('0,0'); snapSheetOpen();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
        assert.equal(app.val('snapSheetIsOpen()'), false);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P2', 'コマンドは続く');
        app.eval('resetCommand();');
        // 全画面の ⊕ がずれていても、表示と入／切は osnapState.main に合わせる
        app.eval(`osnapState.main = false; document.body.classList.add('fullscreen-mode'); snapSheetOpen();`);
        assert.match(app.eval(`document.querySelector('#snap-sheet [data-ss="main"]').textContent`), /切/);
        app.eval(`document.querySelector('#snap-sheet [data-ss="main"]').click();`);
        assert.equal(app.val('osnapState.main'), true, '1回で入になる');
        app.eval(`snapSheetClose(); document.body.classList.remove('fullscreen-mode');`);
        // 長押しで開いて click が来なかった → 次のふつうのタップは効く
        const b = `document.getElementById('btn-osnap')`;
        app.eval(`__ptr(${b}, 'pointerdown', 500, 590);`);
        await wait(320);
        app.eval(`__ptr(${b}, 'pointerup', 500, 590); snapSheetClose(); __ptr(${b}, 'pointerdown', 500, 590); __ptr(${b}, 'pointerup', 500, 590);
            window.__clicked = false; ${b}.addEventListener('click', () => { window.__clicked = true; }, { once: true }); ${b}.click();`);
        assert.equal(app.val('window.__clicked'), true, 'ふつうのタップの click は捨てない');
        app.eval('osnapState.main = true;');
    });

    it('点検で直したこと: 点の横の ☑確定 はレイアウトに替えたら消え、パネルが図面を覆うときは出さない', () => {
        const shown = () => app.val(`(() => { const b = document.getElementById('line-float-confirm'); return !!b && b.style.display === 'block'; })()`);
        app.eval(`window.innerWidth = 800; window.innerHeight = 600; processCommand('LINE'); __touch('touchstart', [[300, 300]]); __touch('touchend', []);`);
        assert.equal(shown(), true);
        app.eval(`window.innerWidth = 500; showOptionsPanel(); lineFloatUpdate();`);
        assert.equal(shown(), false, 'スマホの幅でパネルが開いていれば出さない');
        app.eval(`closePropertyPanel(); window.innerWidth = 800; lineFloatUpdate();`);
        assert.equal(shown(), true);
        app.eval(`window.__la = layoutActive; layoutActive = () => true; _drawFrame(false);`);
        assert.equal(shown(), false, 'レイアウトでは消す');
        app.eval('layoutActive = window.__la; resetCommand(); _drawFrame(false);');
        // ほかのアプリから開いたときは、起動の復元の確認を出さない
        app.eval(`window.__oif = openIncomingFile; openIncomingFile = () => {}; window.__launchedFile = false; _launchOpen(new File(['0'], 'a.dxf'), 'テスト'); openIncomingFile = window.__oif;`);
        assert.equal(app.val('window.__launchedFile'), true);
    });

    it('点の横の ☑確定: 寸法は指を離したあと、円の 3点は指で入れた仮の円の横に。押すと決まる', async () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 100, y2: 0 }); ensureEntityIds(); window.innerWidth = 800; window.innerHeight = 600;`);
        const shown = () => app.val(`(() => { const b = document.getElementById('line-float-confirm'); return !!b && b.style.display === 'block'; })()`);
        app.eval(`processCommand('DIMLINEAR');`);
        assert.equal(shown(), false);
        app.eval(`__touch('touchstart', [[400, 300]]); __touch('touchend', []);`);
        assert.equal(shown(), true, '寸法: 指を離したら出す');
        const m0 = app.eval('cmdState.mode');
        await wait(280);
        app.eval(`document.getElementById('line-float-confirm').click()`);
        assert.notEqual(app.eval('cmdState.mode'), m0, '押すと次の段階へ');
        assert.equal(shown(), false, '点が入ったら次に指を離すまで出さない');
        app.eval('resetCommand(); _drawFrame(false);');
        // 基点測定: 基点は出す、2点目（指を離して値を読むだけ）は出さない（v5.49.3）
        app.eval(`processCommand('MEASURE'); __touch('touchstart', [[400, 300]]); __touch('touchend', []);`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMMEAS_BASE');
        assert.equal(shown(), true, '基点は出す');
        app.eval(`dimConfirmPoint(); __touch('touchstart', [[500, 300]]); __touch('touchend', []);`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_DIMMEAS_TO');
        assert.equal(shown(), false, '2点目は出さない');
        app.eval('resetCommand(); _drawFrame(false);');
        // 円の 3点: マウスでは出さない、指なら出す
        app.eval(`processCommand('CIRCLE'); hidePropertyPanel(); processCommand('3P'); handlePointInput({ x: 0, y: 10 }, true); handlePointInput({ x: 10, y: 0 }, true); handlePointInput({ x: 0, y: -10 }, true); _drawFrame(false);`);
        assert.equal(shown(), false, 'マウス・座標では出さない');
        app.eval(`handlePointInput({ x: -10, y: 0 }, false); _drawFrame(false);`);
        assert.equal(shown(), true, '指なら出す');
        await wait(280);
        app.eval(`document.getElementById('line-float-confirm').click()`);
        const c = app.val(`entities.filter(e => e.type === 'CIRCLE').map(e => [e.cx, e.cy, e.radius])[0]`);
        near(c[0], 0); near(c[1], 0); near(c[2], 10);
        app.eval('resetCommand();');
        assert.deepEqual(app.errors(), []);
    });
});
