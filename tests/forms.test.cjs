'use strict';
// 入力欄（v5.21。cad-form.js と各パネル）のテスト:
//   数の読み取り（全角・範囲）、欄のそばのまちがいの理由（出す・直し始めたら消す）、作図の設定（円・長方形・オフセット・文字）、
//   プロパティ欄、相対入力、点の欄（見つからない・点名の候補）、単位の見出し、TS の通信の設定、検索の ×
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('入力欄', () => {
    let app;
    before(async () => {
        app = await loadApp();
        const ev = app.eval; app.run = (c) => ev('{' + c + '\n}');
    });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; cmdState.selectedIndices = [];
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            ucs = { originX: 0, originY: 0, angle: 0 }; view = { x: 400, y: 300, scale: 1, rotation: 0 };
            document.querySelectorAll('.field-err').forEach(e => e.remove()); // 前のテストで閉じたパネルに残っている理由`);
    });
    const err = () => app.val(`[...document.querySelectorAll('.field-err')].map(e => e.textContent)`);
    const setVal = (id, v) => app.eval(`document.getElementById('${id}').value = ${JSON.stringify(v)}`);

    it('数の読み取り: 全角もよい。空・数でない・範囲の外は理由を返す', () => {
        const p = (t, o) => app.val(`parseNumInput(${JSON.stringify(t)}, ${JSON.stringify(o || {})})`);
        assert.deepEqual(p('１２．５'), { ok: true, value: 12.5, error: '' });
        assert.deepEqual(p('-.5'), { ok: true, value: -0.5, error: '' });
        assert.equal(p('', { what: '半径' }).error, '半径を入れてください');
        assert.deepEqual(p('', { allowEmpty: true }), { ok: true, value: null, error: '' });
        assert.equal(p('12a').error, '数で入れてください（例 12.5）');
        assert.equal(p('0', { gt: 0 }).error, '0 より大きい数を入れてください');
        assert.equal(p('5', { max: 1 }).error, '1 以下の数を入れてください');
    });

    it('欄のそばに理由を出し（赤い枠・aria-invalid・読み上げ）、直し始めたら消す。打った字は残す', () => {
        app.eval(`document.body.insertAdjacentHTML('beforeend', '<div id="__f"><div class="prop-row"><input id="__in" class="prop-val" value="abc"></div></div>')`);
        app.eval(`fieldError(document.getElementById('__in'), '数を入れてください')`);
        assert.deepEqual(err(), ['数を入れてください']);
        assert.deepEqual(app.val(`(e => [e.getAttribute('aria-invalid'), e.classList.contains('field-bad'), e.getAttribute('aria-describedby'), e.value, document.activeElement === e])(document.getElementById('__in'))`),
            ['true', true, '__in-err', 'abc', true]);
        assert.equal(app.eval(`document.getElementById('__in-err').getAttribute('role')`), 'alert');
        app.eval(`document.getElementById('__in').dispatchEvent(new Event('input'))`);
        assert.deepEqual(err(), []);
        assert.equal(app.eval(`document.getElementById('__in').getAttribute('aria-invalid')`), null);
        app.eval(`document.getElementById('__f').remove()`);
    });

    it('円（固定半径）: 0 以下・読めない半径では始めず、欄に理由を出す。見出しには単位', () => {
        app.eval(`lastParams.circleMode = 'auto'; showCirclePanel();`);
        assert.match(app.eval(`document.getElementById('circle-r-row').textContent`), /半径\(m\)/);
        setVal('prop-circle-r', '-1');
        app.eval('applyCirclePreset()');
        assert.equal(app.eval('cmdState.mode'), 'IDLE', '始めない');
        assert.deepEqual(err(), ['0 より大きい数を入れてください']);
        setVal('prop-circle-r', '5'); // 数の欄（type=number）は、ブラウザが全角・文字を値にしない
        app.eval('applyCirclePreset()');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_CIRCLE_CENTER');
        assert.equal(app.eval('cmdState.presetRadius'), 5);
    });

    it('長方形: 両方空欄なら2点で作図。片方だけ・0 以下は欄に理由。オフセット・文字も欄に理由', () => {
        app.eval(`issueCommand('RECTANG')`);
        setVal('prop-rect-w', '10'); setVal('prop-rect-h', '');
        app.eval('applyRectPreset()');
        assert.deepEqual(err(), ['高さを入れてください']);
        setVal('prop-rect-w', ''); setVal('prop-rect-h', '');
        app.eval('applyRectPreset()');
        assert.equal(app.eval(`document.getElementById('property-panel').style.display`), 'none', '2点で作図へ');
        app.eval('resetCommand()');
        app.eval(`issueCommand('OFFSET')`);
        setVal('prop-offset-d', '0');
        app.eval('applyOffsetPreset()');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_OFFSET_DIST');
        assert.deepEqual(err(), ['0 より大きい数を入れてください']);
        setVal('prop-offset-d', '2');
        app.eval('applyOffsetPreset()');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_OFFSET_SELECT');
        app.eval('resetCommand()');
        app.eval(`issueCommand('TEXT')`);
        setVal('prop-text-val', '');
        app.eval('startTextPlacement()');
        assert.deepEqual(err(), ['文字を入れてください']);
        setVal('prop-text-val', '境界'); setVal('prop-text-h', '-2');
        app.eval('startTextPlacement()');
        assert.deepEqual(err(), ['0 より大きい数を入れてください']);
        assert.notEqual(app.eval('cmdState.mode'), 'WAITING_TEXT_PLACE');
        app.eval('resetCommand()');
        assert.deepEqual(app.errors(), []);
    });

    it('プロパティ欄: まちがった値は欄のそばに理由を出し、打った字を残す（図形は変えない）', () => {
        app.eval(`entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 10, cy: 20, radius: 5 }); ensureEntityIds(); cmdState.highlightIdx = 0; updatePropertiesPanel();`);
        const inp = `[...document.querySelectorAll('input.prop-val')].find(i => /'radius'/.test(i.getAttribute('onchange') || ''))`;
        assert.match(app.eval(`${inp}.getAttribute('onchange')`), /this\.value, this\)/);
        app.run(`const el = ${inp}; el.value = '-3'; changeEntityPropById(entities[0].id, 'radius', el.value, el);`);
        assert.equal(app.eval('entities[0].radius'), 5);
        assert.deepEqual(err(), ['0 より大きい数を入れてください（この欄はまだ変わっていません）']);
        assert.equal(app.eval(`${inp}.value`), '-3');
    });

    it('相対入力: 空の欄に理由を出す', () => {
        app.eval(`issueCommand('LINE'); handlePointInput({ x: 0, y: 0 }, true); showRelativeInputPanel(); setRelativeMode('polar');`);
        setVal('rel-b', '45');
        app.eval('applyRelativeInput()');
        assert.deepEqual(err(), ['距離を入れてください（例 12.345）']);
        assert.equal(app.eval(`document.activeElement.id`), 'rel-a');
        app.eval('resetCommand(); closePropertyPanel();');
    });

    it('点の欄: 打つと点名の候補を出し、押すとその点になる。見つからない点名は欄の下に理由（前の点は残す）', () => {
        app.eval(`['KP1', 'KP2', 'KP10', 'BM1'].forEach((n, i) => entities.push({ type: 'POINT', layer: 0, color: null, x: i * 10, y: 0, name: n, num: String(i + 1) })); ensureEntityIds(); showCogoPanel(); cogoSetTab('inv');`);
        app.run(`const el = document.getElementById('cogo-slot-IA'); el.value = 'kp'; pointSuggestUpdate(el, (v) => cogoSlotTyped('IA', v));`);
        assert.deepEqual(app.val(`[...document.querySelectorAll('#cogo-slot-IA-sug .pt-chip')].map(b => b.textContent)`), ['KP1（1）', 'KP2（2）', 'KP10（3）']);
        app.eval(`document.querySelector('#cogo-slot-IA-sug .pt-chip:nth-child(2)').click()`);
        assert.equal(app.eval(`_cogo.slots.IA.name`), 'KP2');
        assert.equal(app.eval(`document.getElementById('cogo-slot-IA').value`), 'KP2');
        app.eval(`cogoSlotTyped('IA', 'ZZ9')`);
        assert.match(err().join(), /点「ZZ9」が見つかりません.*前に入れた点のまま/);
        assert.equal(app.eval(`_cogo.slots.IA.name`), 'KP2');
        app.eval(`cogoSlotTyped('IA', 'BM1')`);
        assert.deepEqual(err(), [], '正しく入れたら理由は消える');
        app.eval('closePropertyPanel()');
    });

    it('TS の通信の設定: データ長・パリティ・ストップビットは並んだボタンで、押すとすぐ変わる', () => {
        app.eval(`window.navigator.serial = { requestPort: async () => { throw new Error('x'); } }; localStorage.removeItem('cad_ts_opts'); showTsPanel();`);
        try {
            const segs = app.val(`[...document.querySelectorAll('#property-panel-content .cogo-seg')].map(s => [...s.querySelectorAll('button')].map(b => (b.classList.contains('active') ? '*' : '') + b.textContent))`);
            assert.deepEqual(segs.slice(-3), [['*8 ビット', '7 ビット'], ['*なし', '偶数', '奇数'], ['*1 ビット', '2 ビット']]);
            app.eval(app.eval(`[...document.querySelectorAll('#property-panel-content .cogo-seg button')].find(b => b.textContent === '偶数').getAttribute('onclick')`));
            assert.equal(app.eval(`_tsOpts().parity`), 'even');
            assert.equal(app.eval(`[...document.querySelectorAll('#property-panel-content .cogo-seg button')].find(b => b.textContent === '偶数').classList.contains('active')`), true);
        } finally { app.eval(`delete window.navigator.serial; localStorage.removeItem('cad_ts_opts'); closePropertyPanel();`); }
    });

    it('検索の欄の × で文字を消し、一覧を元に戻す（座標一覧・ヘルプ）', () => {
        app.eval(`showCoordListPanel(); document.getElementById('coord-search').value = 'KP';`);
        assert.ok(app.eval(`!!document.querySelector('#property-panel-content .search-x')`));
        app.eval(app.eval(`document.querySelector('#property-panel-content .search-x').getAttribute('onclick')`)); // テスト環境は onclick 属性を実行しないので中身を実行
        assert.equal(app.eval(`document.getElementById('coord-search').value`), '');
        app.eval(`showGuideHelp(); document.getElementById('gh-search').value = 'きゅうせき'; guideHelpSearch('きゅうせき');`);
        app.eval(app.eval(`document.querySelector('.gh-search-row .search-x').getAttribute('onclick')`));
        assert.equal(app.eval(`document.getElementById('gh-search').value`), '');
        app.eval('closePropertyPanel()');
        assert.deepEqual(app.errors(), []);
    });
});
