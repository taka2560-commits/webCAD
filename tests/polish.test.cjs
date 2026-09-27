'use strict';
// 仕上げ（v5.22）のテスト:
//   入・切の設定はスイッチ（中身はチェックボックス）、入・切のボタンの aria-pressed と言葉、⋯ のエラーのバッジ、
//   アプリが新しくなったときの ？ の「新」と「新しくなったこと」、ツアーの「前へ」、Esc で ⋯ メニューを閉じる、
//   上・左のバーの続きの印、使っていなかったものの片付け
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

describe('仕上げ', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => { app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0;`); });

    it('入・切の設定はスイッチ（role=switch。チェックボックスのままなので checked・onchange はそのまま）', () => {
        app.eval('showOptionsPanel()');
        assert.equal(app.eval(`document.querySelectorAll('#property-panel-content input[type=checkbox].sw[role=switch]').length`), 2);
        app.eval('showLayerManagerPanel()');
        assert.equal(app.eval(`document.getElementById('ghost-layer-toggle').getAttribute('role')`), 'switch');
        const css = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assert.match(css, /input\[type="checkbox"\]\.sw \{ -webkit-appearance:none; appearance:none;/);
        // スナップの種類（いくつでも選ぶ）はチェックボックスのまま
        assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'public', 'cad-snap.js'), 'utf8'), /osnap-chk"><input type="checkbox" class="sw"/);
    });

    it('入・切のボタンは aria-pressed で状態を伝える。範囲の言葉は「範囲: ON／OFF」にそろえる', () => {
        const st = (id) => app.val(`(b => [b.textContent, b.getAttribute('aria-pressed')])(document.getElementById('${id}'))`);
        assert.deepEqual(st('btn-ortho'), ['ORTHO', 'false']);
        app.eval('toggleOrtho()');
        assert.deepEqual(st('btn-ortho'), ['ORTHO', 'true']);
        app.eval('toggleOrtho()');
        assert.deepEqual(st('btn-area-select'), ['範囲: OFF', 'false']);
        app.eval('toggleAreaSelect()');
        assert.deepEqual(st('btn-area-select'), ['範囲: ON', 'true']);
        app.eval('toggleAreaSelect()');
        assert.deepEqual(st('btn-area-select'), ['範囲: OFF', 'false']);
        assert.equal(st('btn-osnap')[1], 'true');
        assert.deepEqual(app.errors(), []);
    });

    it('⋯ にエラーの数のバッジ（エラーが無いときは出さない）', () => {
        const badge = () => app.val(`(b => [b.hidden, b.textContent])(document.querySelector('#btn-top-menu .err-badge'))`);
        app.eval('window.cadErrors.clear()');
        assert.equal(badge()[0], true);
        app.eval(`window.cadErrors.record('test', 'テストのエラー', '', { silent: true })`);
        assert.deepEqual(badge(), [false, '1']);
        assert.match(app.eval(`document.getElementById('btn-top-menu').getAttribute('aria-label')`), /エラー 1件/);
        app.eval('window.cadErrors.clear()');
        assert.equal(badge()[0], true);
    });

    it('アプリが新しくなったら ？ に「新」。ヘルプを開くと上に「新しくなったこと」を出し、「新」は消える', () => {
        app.eval(`localStorage.removeItem('cad_seen_build'); localStorage.removeItem('cad_whats_new'); guideCheckWhatsNew('build-1');`);
        const hasNew = () => app.eval(`!!document.querySelector('#guide-help-btn .nb-new')`);
        assert.equal(hasNew(), false, '初めて開いたときは出さない');
        app.eval(`guideCheckWhatsNew('build-1')`);
        assert.equal(hasNew(), false, '同じ版');
        app.eval(`guideCheckWhatsNew('build-2')`);
        assert.equal(hasNew(), true);
        assert.equal(app.eval(`getComputedStyle(document.getElementById('guide-help-btn')).position`), 'absolute', '？ は右下に置いたまま（バッジのために position を変えない）');
        app.eval('showGuideHelp()');
        assert.equal(hasNew(), false);
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /新しくなったこと[\s\S]*デザイン色/);
        app.eval('showGuideHelp()');
        assert.doesNotMatch(app.eval(`document.getElementById('property-panel-content').textContent`), /新しくなったこと/, '2回目からは出さない');
        app.eval('closePropertyPanel()');
    });

    it('ツアーに「◀ 前へ」（2つ目の手順から）', () => {
        app.eval(`startGuideTour('basic')`);
        assert.equal(app.eval(`!!document.querySelector('#guide-card .gc-prev')`), false);
        app.eval('guideTourNext()');
        assert.equal(app.eval(`document.querySelector('#guide-card .gc-prev').textContent`), '◀ 前へ');
        app.eval('guideTourPrev()');
        assert.match(app.eval(`document.querySelector('#guide-card .gc-prog').textContent`), /1 \//);
        app.eval('endGuideTour(false)');
    });

    it('Esc で ⋯ メニューを閉じる（開いているコマンドはそのまま）', () => {
        app.eval(`issueCommand('LINE'); toggleTopMenu();`);
        assert.equal(app.eval(`document.getElementById('top-menu-modal').style.display`), 'flex');
        app.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
        assert.equal(app.eval(`document.getElementById('top-menu-modal').style.display`), 'none');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1');
        app.eval('resetCommand()');
    });

    it('上・左のバーは、続きがある側の端を薄くする', () => {
        const cls = (id) => app.val(`[...document.getElementById('${id}').classList].filter(c => c.startsWith('more-')).sort()`);
        const set = (id, props) => app.eval(`(el => { for (const [k, v] of Object.entries(${JSON.stringify(props)})) Object.defineProperty(el, k, { value: v, configurable: true }); })(document.getElementById('${id}'))`);
        set('top-bar', { scrollWidth: 900, clientWidth: 400, scrollLeft: 0 });
        app.eval(`scrollCue(document.getElementById('top-bar'), 'x')`);
        assert.deepEqual(cls('top-bar'), ['more-right']);
        set('top-bar', { scrollLeft: 200 });
        app.eval(`scrollCue(document.getElementById('top-bar'), 'x')`);
        assert.deepEqual(cls('top-bar'), ['more-left', 'more-right']);
        set('top-bar', { scrollLeft: 500 });
        app.eval(`scrollCue(document.getElementById('top-bar'), 'x')`);
        assert.deepEqual(cls('top-bar'), ['more-left']);
        set('toolbar', { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
        app.eval(`scrollCue(document.getElementById('toolbar'), 'y')`);
        assert.deepEqual(cls('toolbar'), [], '入りきっていれば出さない');
    });

    it('片付け: 使っていなかったもの（toggleToolbar・.cg-btn・出てこない全画面の終了ボタン）を消し、⋯ メニューは横に跳ねない動きで開く', () => {
        assert.equal(app.eval('typeof toggleToolbar'), 'undefined');
        assert.equal(app.eval(`!!document.getElementById('btn-exit-fullscreen')`), false);
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assert.doesNotMatch(html, /\.cg-btn/);
        assert.match(html, /animation: menuIn 0\.2s/);
        assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'public', 'cad-panels.js'), 'utf8'), /fs-btn-area-select/);
    });
});
