'use strict';
// 畳んだパネル・閉じた道具箱のテスト:
//   プロパティ・画層パネル（.collapsed）と座標読取モードの道具箱（閉じたとき）は、画面の外へずらして隠しているだけ。
//   以前は Tab で中の見えないボタン・欄にフォーカスが移っていた。パネルでは、ブラウザがそれを見せようと body を横にスクロールして、
//   画面全体が左にずれたまま（右に黒い帯）になっていた（プロパティの「半径」で Tab → 畳んだ画層パネルの ✖、body.scrollLeft = 328）。
//   消したエラーのお知らせ（透明にして残す）も同じ。
//   jsdom にはレイアウトも Tab の移動も無いので、inert（Tab・フォーカスで入れない）の状態と、ずれを戻す処理・CSS を確かめる
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('畳んだパネル・閉じた道具箱にフォーカスが入らない', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    const inert = (sel) => app.eval(`document.querySelector('${sel}').hasAttribute('inert')`);
    const collapsed = (sel) => app.eval(`document.querySelector('${sel}').classList.contains('collapsed')`);
    const drawerOpen = () => app.eval(`document.getElementById('fs-tools-drawer').classList.contains('fs-drawer-open')`);

    it('起動したとき: 畳んだプロパティ・画層パネルと、閉じた道具箱の中身は inert', () => {
        assert.equal(collapsed('#properties-panel'), true);
        assert.equal(inert('#properties-panel'), true);
        assert.equal(collapsed('#layer-panel'), true);
        assert.equal(inert('#layer-panel'), true);
        // 以前 Tab で移っていた画層パネルの ✖ も、inert の中
        assert.equal(app.eval(`!!document.querySelector('#layer-panel .props-header button').closest('[inert]')`), true);
        assert.equal(drawerOpen(), false);
        assert.equal(inert('#fs-tools'), true);
        assert.equal(app.eval(`!!document.getElementById('fs-drawer-toggle').closest('[inert]')`), false); // 道具箱を開く ◀ は押せる
    });

    it('📋 でプロパティパネルを開くと inert を外し（中の欄を Tab で移れる）、畳むと inert に戻す', () => {
        app.eval(`entities.length = 0; entities.push({ type:'CIRCLE', layer:0, color:null, cx:0, cy:0, radius:50 });
            cmdState.highlightIdx = 0; cmdState.selectedIndices = [0]; updatePropertiesPanel();`);
        app.eval('togglePropertiesPanel()');
        assert.equal(collapsed('#properties-panel'), false);
        assert.equal(inert('#properties-panel'), false);
        const inFields = app.val(`[...document.querySelectorAll('#props-content input')].map(i => !!i.closest('[inert]'))`);
        assert.ok(inFields.length >= 3, '中心 X・中心 Y・半径などの欄が無い');
        assert.ok(inFields.every(v => v === false), '開いたパネルの欄が inert の中にある');
        app.eval('togglePropertiesPanel()');
        assert.equal(collapsed('#properties-panel'), true);
        assert.equal(inert('#properties-panel'), true);
        assert.deepEqual(app.errors(), []);
    });

    it('道具箱: ◀ で開くと中身の inert を外し、閉じると（道具のボタンで自動で閉じたときも）inert に戻す', () => {
        app.eval('toggleFsDrawer()');
        assert.equal(drawerOpen(), true);
        assert.equal(inert('#fs-tools'), false);
        app.eval('autoCloseDrawer()'); // 道具のボタンを押したあと
        assert.equal(drawerOpen(), false);
        assert.equal(inert('#fs-tools'), true);
        app.eval('toggleFsDrawer(); toggleFsDrawer()'); // ▶ で閉じたとき
        assert.equal(drawerOpen(), false);
        assert.equal(inert('#fs-tools'), true);
    });

    it('body・html は overflow: clip（フォーカスの移動などでもスクロールしない）', () => {
        assert.equal(app.eval('getComputedStyle(document.body).overflow'), 'clip');
        assert.equal(app.eval('getComputedStyle(document.documentElement).overflow'), 'clip');
    });

    it('clip に対応していない古いブラウザ向け: body・ページが横にずれたら、すぐ 0 に戻す', () => {
        app.eval(`document.body.scrollLeft = 328; document.body.scrollTop = 40; document.body.dispatchEvent(new Event('scroll'));`);
        assert.deepEqual(app.val('[document.body.scrollLeft, document.body.scrollTop]'), [0, 0]);
        app.eval(`document.documentElement.scrollLeft = 120; window.dispatchEvent(new Event('scroll'));`);
        assert.equal(app.eval('document.documentElement.scrollLeft'), 0);
        assert.deepEqual(app.errors(), []);
    });

    it('エラーのお知らせ: 出ているあいだは押せて、消したら inert（透明にして残すので、Tab で見えない「詳細」「✕」に移らないように）', () => {
        const shown = () => app.eval(`document.getElementById('cad-err-banner').classList.contains('show')`);
        try {
            app.eval(`cadErrors.record('error', 'フォーカスのテスト用のエラー')`);
            assert.equal(shown(), true);
            assert.equal(inert('#cad-err-banner'), false);
            app.eval(`document.querySelector('#cad-err-banner [data-act="close"]').click()`); // ✕
            assert.equal(shown(), false);
            assert.equal(inert('#cad-err-banner'), true);
            app.eval(`cadErrors.record('error', 'フォーカスのテスト用のエラー（2回目）')`); // もう一度出すと押せる
            assert.equal(shown(), true);
            assert.equal(inert('#cad-err-banner'), false);
        } finally { app.eval('cadErrors.clear()'); }
    });
});
