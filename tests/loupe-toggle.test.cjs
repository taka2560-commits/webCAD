'use strict';
// ルーペの入／切（v5.57。cad-prefs.js の toggleLoupe・cad-input.js）: 🔍（下のバー・全画面）・コマンド LOUPE・オプションの「ルーペ」が同じ設定。
// 切ならなぞってもルーペを出さない（スナップ・座標はそのまま）。端末に覚える
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('ルーペの入／切', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('🔍・コマンド・オプションで切り替わり、切ならなぞってもルーペを出さない。端末に覚える', () => {
        assert.equal(app.val('loupeEnabled()'), true, '初めは入（今までどおり）');
        assert.equal(app.val(`document.getElementById('btn-loupe').getAttribute('aria-pressed')`), 'true');
        assert.equal(app.val(`document.getElementById('btn-loupe').classList.contains('active')`), true);
        // 指でなぞる（線分のコマンド中）: 入ならルーペが出る
        const drag = () => app.eval(`(() => {
            const r = canvas.getBoundingClientRect();
            const T = (type, x, y) => { const t = { identifier: 1, clientX: r.left + x, clientY: r.top + y, pageX: r.left + x, pageY: r.top + y, target: canvas };
                const ev = new Event(type, { bubbles: true, cancelable: true }); ev.touches = type === 'touchend' ? [] : [t]; ev.changedTouches = [t]; ev.targetTouches = ev.touches; canvas.dispatchEvent(ev); };
            T('touchstart', 100, 100); T('touchmove', 140, 130); T('touchmove', 180, 160); window.__loupe = touchState.showLoupe; T('touchend', 180, 160);
        })()`);
        app.eval(`resetCommand(); issueCommand('LINE')`);
        drag();
        assert.equal(app.val('window.__loupe'), true, '入ならなぞるとルーペ');
        app.eval(`document.getElementById('btn-loupe').getAttribute('onclick') && toggleLoupe()`);
        assert.equal(app.val('loupeEnabled()'), false);
        assert.equal(app.val(`document.getElementById('btn-loupe').getAttribute('aria-pressed')`), 'false');
        assert.equal(app.val(`document.getElementById('fs-btn-loupe').classList.contains('fs-active')`), false, '全画面の 🔍 もそろう');
        assert.equal(app.val(`JSON.parse(localStorage.getItem('cad_display_prefs')).loupe`), 'off', '端末に覚える');
        app.eval(`resetCommand(); issueCommand('LINE')`);
        drag();
        assert.equal(app.val('window.__loupe'), false, '切ならなぞってもルーペを出さない');
        // コマンド・オプションでも同じ設定
        app.eval(`resetCommand(); processCommand('LOUPE')`);
        assert.equal(app.val('loupeEnabled()'), true);
        app.eval(`processCommand('LP')`);
        assert.equal(app.val('loupeEnabled()'), false);
        app.eval(`setDisplayPref('loupe', 'on')`);
        assert.equal(app.val(`document.getElementById('btn-loupe').classList.contains('active')`), true, 'オプションで変えてもボタンがそろう');
        app.eval('resetCommand()');
        assert.deepEqual(app.errors(), []);
    });
});
