'use strict';
// マイナスを打てる（v5.58.1。cad-form.js の signToggleBtn・fieldToggleSign）: iPhone の数字だけのキーボード（inputmode="decimal"）には
// マイナスが無いので、マイナスになる欄（円の座標・点の標高）の横に ± を置く。押すと符号が入れ替わり、その値で描ける
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

describe('マイナスを打てる（± ボタン）', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('± で符号が入れ替わる（空なら「-」、全角のマイナスも）。円の X・Y にマイナスを入れて、その座標に描ける', () => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; ucs = { originX: 0, originY: 0, angle: 0 }; processCommand('C');`);
        assert.equal(app.val(`document.querySelectorAll('#circle-coord .sign-btn').length`), 2, 'X・Y の横に ±');
        const t = (v) => app.val(`(() => { const el = document.getElementById('circle-cx'); el.value = ${JSON.stringify(v)}; fieldToggleSign('circle-cx'); return el.value; })()`);
        assert.equal(t('12345.678'), '-12345.678');
        assert.equal(t('-12345.678'), '12345.678');
        assert.equal(t('－5'), '5');
        assert.equal(t('+5'), '-5');
        assert.equal(t(''), '-', '空なら「-」を入れて、続けて数を打てる');
        app.eval(`document.getElementById('circle-cx').value = '12345.678'; fieldToggleSign('circle-cx');
            document.getElementById('circle-cy').value = '23456.789'; fieldToggleSign('circle-cy');
            document.getElementById('circle-cr').value = '1'; circleDrawAtCoord();`);
        assert.deepEqual(app.val(`entities.filter((e) => e.type === 'CIRCLE').map((e) => [e.cx, e.cy])`), [[-23456.789, -12345.678]]);
        app.eval('resetCommand(); closePropertyPanel();');
        assert.deepEqual(app.errors(), []);
    });

    it('点の標高の欄にも ±', () => {
        app.eval(`resetCommand(); closePropertyPanel(); processCommand('POINT');`);
        assert.equal(app.val(`!!document.querySelector('#property-panel-content .sign-btn')`), true);
        app.eval(`document.getElementById('prop-point-z').value = '1.5'; fieldToggleSign('prop-point-z');`);
        assert.equal(app.val(`document.getElementById('prop-point-z').value`), '-1.5');
        app.eval('resetCommand(); closePropertyPanel();');
    });

    it('数字だけのキーボード（inputmode="decimal"）の欄は、正の数の欄か、横に ± がある（マイナスを打てない欄を作らない）', () => {
        const src = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')]);
        const bad = [];
        // 正の数だけの欄（距離・半径・文字の高さ）。マイナスになる欄はここに入れず、± を付ける
        const POSITIVE = /circle-cr|pl-h|tsz-val|positive|numeric|'dist'|'dA'|'dB'/;
        for(const [f, s] of src) {
            s.split('\n').forEach((line, i) => {
                if(!/inputmode="decimal"/.test(line) || /^\s*\/\//.test(line)) return;
                if(/signToggleBtn\(/.test(line) || POSITIVE.test(line)) return;
                bad.push(`${f}:${i + 1}`);
            });
        }
        assert.deepEqual(bad, [], 'マイナスを打てないかもしれない欄: ' + bad.join(', '));
    });
});
