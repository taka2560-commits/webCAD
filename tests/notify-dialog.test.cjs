'use strict';
// お知らせと確認画面（v5.19。cad-notify.js・cad-dialog.js）のテスト:
//   お知らせの種類（✓ ⚠ ✕・読み上げ）、「元に戻す」つきのお知らせ（押すと戻す・あとに別の操作をしたら戻さない）、
//   見えないコマンド欄の結果をお知らせにも出す、アプリの確認画面（はい・いいえ・危ない操作・入力・選ぶ・Esc・図面のキーを止める）、
//   読み込みの「置き換える／今の図面に追加／やめる」、同じ名前の保存、ブラウザの confirm・prompt・alert が残っていない
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('お知らせと確認画面', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`window.__cadNativeDialogs = false; if(cadDialogOpen()) _dlgClose(_dlg.cancel); hideSnack();
            resetCommand(); entities.length = 0; undoStack.length = 0; redoStack.length = 0; cmdState.selectedIndices = []; cmdState.highlightIdx = -1;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            document.getElementById('command-line-area').classList.add('collapsed');`);
    });
    const btns = () => app.val(`[...document.querySelectorAll('#cad-dialog .cd-btn')].map(b => b.textContent)`);
    const clickBtn = (label) => app.eval(`[...document.querySelectorAll('#cad-dialog .cd-btn')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
    const dialogShown = () => app.eval(`document.getElementById('cad-dialog').classList.contains('show')`);
    const toast = () => app.val(`(t => t ? [t.textContent, t.dataset.kind || '', t.getAttribute('role')] : null)(document.getElementById('cad-toast'))`);
    const addLine = (x) => app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: ${x}, y1: 0, x2: ${x + 10}, y2: 0 }); ensureEntityIds();`);

    it('お知らせの種類: 成功 ✓・注意 ⚠・エラー ✕ は印と枠の色だけ変え、文は変えない。エラーはすぐ読み上げる（role=alert）', () => {
        app.eval(`showToast('保存しました', { kind: 'success' })`);
        assert.deepEqual(toast(), ['保存しました', 'success', 'status']);
        app.eval(`showToast('読めません', { kind: 'error', ms: 4000 })`);
        assert.deepEqual(toast(), ['読めません', 'error', 'alert']);
        app.eval(`showToast('ふつう', 1500)`); // 以前の書き方もそのまま
        assert.deepEqual(toast(), ['ふつう', '', 'status']);
        const css = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assert.match(css, /#cad-toast\[data-kind="error"\]::before \{ content:'✕ '/);
        assert.deepEqual(app.errors(), []);
    });

    it('「元に戻す」つきのお知らせ: 削除のあとに出て、押すと戻す。あとに別の操作をしていたら戻さない', () => {
        addLine(0); addLine(20);
        app.eval(`cmdState.selectedIndices = [0]; processCommand('ERASE');`);
        assert.equal(app.eval('entities.length'), 1);
        assert.equal(app.eval(`document.getElementById('cad-snack').classList.contains('show')`), true);
        assert.match(app.eval(`document.querySelector('#cad-snack .sn-msg').textContent`), /1個を削除しました/);
        app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
        assert.equal(app.eval('entities.length'), 2, '戻った');
        assert.equal(app.eval(`document.getElementById('cad-snack').classList.contains('show')`), false);
        // 消したあとに別の操作をした
        app.eval(`cmdState.selectedIndices = [0]; processCommand('ERASE'); saveUndo(); entities.push({ type: 'LINE', layer: 0, x1: 0, y1: 5, x2: 1, y2: 5 });`);
        app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
        assert.equal(app.eval('entities.length'), 2, 'あとの操作を消さない');
        assert.match(toast()[0], /別の操作をしたので/);
        // 画層のまとめて非表示も
        app.eval(`setAllLayersVisibility(false)`);
        app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
        assert.equal(app.eval('layers[0].visible'), true);
        assert.deepEqual(app.errors(), []);
    });

    it('コマンド欄を畳んでいるときは、記録にしか出なかった結果もお知らせに出す', () => {
        app.eval(`undo()`);
        assert.match(toast()[0], /元に戻す操作がありません/);
        app.eval(`document.getElementById('command-line-area').classList.remove('collapsed'); showToast('前'); notify('-> 広げているときは記録だけ');`);
        assert.equal(toast()[0], '前');
        assert.match(app.eval('commandLog.textContent'), /広げているときは記録だけ/);
    });

    it('確認画面: 題・文・ボタン。OK で true、やめる・Esc で false。出しているあいだは図面の Esc・Ctrl+Z を止める', async () => {
        let p = app.eval(`window.__r = undefined; cadConfirm({ title: '図面を閉じる', message: '閉じますか？', ok: '閉じる' }).then(v => window.__r = v)`);
        assert.equal(dialogShown(), true);
        assert.equal(app.eval(`document.getElementById('cad-dialog').getAttribute('role')`), 'dialog');
        assert.equal(app.eval(`document.getElementById('cad-dialog-title').textContent`), '図面を閉じる');
        assert.deepEqual(btns(), ['やめる', '閉じる']);
        assert.equal(app.eval(`document.activeElement.textContent`), '閉じる', 'ふつうの確認は OK を選んだ状態');
        clickBtn('閉じる'); await p;
        assert.equal(app.eval('window.__r'), true);
        assert.equal(dialogShown(), false);
        assert.equal(app.eval('cadDialogOpen()'), false);
        // 危ない操作: 初めは「やめる」を選んでいる。Esc で閉じる（図面のコマンドは取り消さない・↩ もしない）
        addLine(0); app.eval('saveUndo(); entities.push({ type: "LINE", layer: 0, x1: 0, y1: 1, x2: 1, y2: 1 });');
        app.eval(`issueCommand('LINE')`);
        p = app.eval(`cadConfirm({ title: 'プロジェクトを削除', message: '消しますか？', ok: '削除する', danger: true }).then(v => window.__r = v)`);
        assert.equal(app.eval(`document.activeElement.textContent`), 'やめる');
        assert.equal(app.eval(`document.querySelector('#cad-dialog .cd-danger').textContent`), '削除する');
        app.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
        assert.equal(app.eval('entities.length'), 2, 'Ctrl+Z は図面に届かない');
        app.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await p;
        assert.equal(app.eval('window.__r'), false);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1', '線分のコマンドは続く');
        assert.deepEqual(app.errors(), []);
    });

    it('入力の確認画面: 空なら欄の下に理由を出して閉じない。入れて OK でその文字', async () => {
        const p = app.eval(`window.__r = undefined; cadPrompt({ title: 'UCS を保存', message: '名前', value: '', ok: '保存' }).then(v => window.__r = v)`);
        clickBtn('保存'); await tick();
        assert.equal(dialogShown(), true);
        assert.equal(app.eval(`document.querySelector('#cad-dialog .cd-err').textContent`), '入れてください');
        assert.equal(app.eval(`document.querySelector('#cad-dialog .cd-input').getAttribute('aria-invalid')`), 'true');
        app.eval(`document.querySelector('#cad-dialog .cd-input').value = '現場の原点'`);
        clickBtn('保存'); await p;
        assert.equal(app.eval('window.__r'), '現場の原点');
        // saveUCS も同じ画面
        app.eval(`savedUCSList.length = 0; saveUCS()`);
        assert.equal(app.eval(`document.querySelector('#cad-dialog .cd-input').value`), 'UCS_1');
        clickBtn('保存'); await tick();
        assert.deepEqual(app.val('savedUCSList.map(u => u.name)'), ['UCS_1']);
    });

    it('ファイルを開くとき: 「置き換える／今の図面に追加／やめる」。やめると何もしない（↩ の履歴も増えない）', async () => {
        addLine(0);
        const u0 = app.eval('undoStack.length');
        app.eval(`window.__m = null; _prepareImportTarget((m) => { window.__m = m; })`);
        assert.deepEqual(btns(), ['置き換える', '今の図面に追加', 'やめる']);
        assert.equal(app.eval(`document.activeElement.textContent`), 'やめる');
        clickBtn('やめる'); await tick();
        assert.equal(app.eval('window.__m'), null, '読み込まない');
        assert.equal(app.eval('entities.length'), 1);
        assert.equal(app.eval('undoStack.length'), u0);
        app.eval(`_prepareImportTarget((m) => { window.__m = m; })`);
        clickBtn('今の図面に追加'); await tick();
        assert.equal(app.eval('window.__m'), 'append');
        assert.equal(app.eval('entities.length'), 1);
        app.eval(`_prepareImportTarget((m) => { window.__m = m; })`);
        clickBtn('置き換える'); await tick();
        assert.equal(app.eval('window.__m'), 'replace');
        assert.equal(app.eval('entities.length'), 0);
        app.eval('undo()');
        assert.equal(app.eval('entities.length'), 1, '置き換えても ↩ で戻せる');
    });

    it('同じ名前で保存: 入力 →「上書きする／別の名前にする」→ 別の名前なら「名前_2」を出して聞き直す', async () => {
        addLine(0);
        app.eval(`window.__cadNativeDialogs = true; window.__c = window.confirm; window.confirm = () => true;`);
        await app.eval(`saveProject('現場C')`);
        app.eval(`window.__cadNativeDialogs = false; window.confirm = window.__c; window.setCurrentProjectName(null);`);
        const p = app.eval(`saveProject()`);
        await tick(5);
        app.eval(`document.querySelector('#cad-dialog .cd-input').value = '現場C'`);
        clickBtn('保存');
        for (let i = 0; i < 50 && !btns().includes('上書きする'); i++) await tick(5);
        assert.deepEqual(btns(), ['別の名前にする', '上書きする']);
        assert.equal(app.eval(`document.activeElement.textContent`), '別の名前にする');
        clickBtn('別の名前にする');
        for (let i = 0; i < 50 && !btns().includes('保存'); i++) await tick(5);
        assert.equal(app.eval(`document.querySelector('#cad-dialog .cd-input').value`), '現場C_2');
        clickBtn('保存');
        await p;
        const names = (await app.eval(`_dbGetAll(STORE_PROJECTS)`)).map((x) => x.name).sort();
        assert.deepEqual(names, ['現場C', '現場C_2']);
        assert.deepEqual(app.errors(), []);
    });

    it('ブラウザの confirm・prompt・alert は使っていない（エラーの記録のコピーの予備だけ）', () => {
        const bad = [];
        for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((x) => /^cad-.*\.js$/.test(x))) {
            fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').split(/\r?\n/).forEach((line, i) => {
                const code = line.replace(/\/\/.*$/, '');
                if (/(^|[^.\w])(confirm|prompt|alert)\(/.test(code) || /window\.(confirm|prompt|alert)\(/.test(code)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
            });
        }
        const allowed = bad.filter((b) => /^cad-errors\.js:.*alert\(text\)/.test(b) || /^cad-dialog\.js:.*window\.(confirm|prompt)\(text/.test(b));
        assert.deepEqual(bad.filter((b) => !allowed.includes(b)), []);
    });
});
