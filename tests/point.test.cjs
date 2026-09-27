'use strict';
// 点のコマンド（v5.23。cad-point.js・左のツールバーの「点」）とメニューボタンの絵のテスト:
//   設定（点名の案・標高・まちがい）、マウス・座標の入力ではその場に置く、タッチは位置を決めて ☑確定、点名は次の番号（同じ点名は飛ばす）、
//   座標一覧に入る、「元に戻す」、置く前の印、コマンド PO、メニューボタンは「☰ メニュー」
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

describe('点のコマンド', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); entities.length = 0; undoStack.length = 0; _pt.next = ''; _pt.z = null;
            layers.splice(0, layers.length, { name: '0', color: '#ffffff', visible: true }); currentLayerIndex = 0; initLayers();
            ucs = { originX: 0, originY: 0, angle: 0 }; view = { x: 400, y: 300, scale: 1, rotation: 0 }; snapResult = null;
            document.querySelectorAll('.field-err').forEach(e => e.remove());`);
    });
    const points = () => app.val(`collectSurveyPoints().map(p => [p.name, +p.x.toFixed(6), +p.y.toFixed(6), p.z])`);
    const start = (name, z) => {
        app.eval(`toggleCommand('POINT')`);
        if (name !== undefined) app.eval(`document.getElementById('prop-point-name').value = ${JSON.stringify(name)}`);
        if (z !== undefined) app.eval(`document.getElementById('prop-point-z').value = ${JSON.stringify(z)}`);
        app.eval('applyPointPreset()');
    };

    it('左のツールバーに「点」。押すと点名の案（P1）と標高の欄が出て、置き始めると ☑確定・終了のバー', () => {
        assert.match(app.eval(`[...document.querySelectorAll('#toolbar .tool-btn')].map(b => b.textContent).join('|')`), /⊙点POINT/);
        app.eval(`toggleCommand('POINT')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '点 作図設定');
        assert.equal(app.eval(`document.getElementById('prop-point-name').value`), 'P1');
        assert.equal(app.eval(`document.querySelector('#toolbar .tool-btn.active .tool-cmd').textContent`), 'POINT');
        app.eval('applyPointPreset()');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_POINT_PLACE');
        assert.equal(app.eval(`document.getElementById('fs-dim-actionbar').style.display`), 'flex');
        assert.match(app.eval(`document.getElementById('command-prompt').textContent`), /次の点名 P1/);
    });

    it('マウスのクリックはその場に置き、座標一覧に入る。点名は次の番号に。「元に戻す」で消せる', () => {
        start();
        app.eval('handlePointInput({ x: 10, y: 20 }, true)');
        app.eval('handlePointInput({ x: 30, y: 40 }, true)');
        assert.deepEqual(points(), [['P1', 10, 20, null], ['P2', 30, 40, null]]);
        assert.deepEqual(app.val(`entities.filter(e => e.type === 'TEXT').map(e => e.height)`), [20, 20], '点名が無い図面では、画面で読める高さ（倍率 1 なら 20）');
        assert.match(app.eval(`document.querySelector('#cad-snack .sn-msg').textContent`), /点「P2」を置きました（座標一覧に入ります）/);
        app.eval(`document.querySelector('#cad-snack .sn-act').click()`);
        assert.deepEqual(points().map((p) => p[0]), ['P1']);
        app.eval('showCoordListPanel()');
        assert.match(app.eval(`document.getElementById('coord-list-rows').textContent`), /P1/);
        assert.deepEqual(app.errors(), []);
    });

    it('タッチも、指を離した所にすぐ置く（確定を待たないので、座標一覧を開いてもすぐ載っている）。下のバーは「終了」だけ', () => {
        start('A1');
        assert.equal(app.eval(`document.querySelector('#fs-dim-actionbar button[onclick="dimConfirmPoint()"]').style.display`), 'none');
        app.eval('handlePointInput({ x: 5, y: 5 }, false)');
        assert.deepEqual(points(), [['A1', 5, 5, null]]);
        app.eval('showCoordListPanel()');
        assert.match(app.eval(`document.getElementById('coord-list-rows').textContent`), /A1/);
        app.eval('handlePointInput({ x: 6, y: 7 }, false)');
        assert.match(app.eval(`document.getElementById('coord-list-rows').textContent`), /A1[\s\S]*A2/, '開いている一覧もすぐ新しくなる');
    });

    it('同じ点名が図面にあれば飛ばす。設定のまちがいは欄のそばに。標高も入る。コマンド欄の PO と「X,Y」でも置ける', () => {
        start('K1');
        app.eval('handlePointInput({ x: 0, y: 0 }, true)');
        app.eval(`cogoAddSurveyPoint(9, 9, 'K2')`); // 次の点名 K2 がほかで使われた
        app.eval('handlePointInput({ x: 1, y: 0 }, true)');
        assert.deepEqual(points().map((p) => p[0]), ['K1', 'K2', 'K3']);
        app.eval('resetCommand()');
        app.eval(`toggleCommand('POINT'); document.getElementById('prop-point-name').value = 'K1'; applyPointPreset();`);
        assert.match(app.eval(`document.querySelector('.field-err').textContent`), /点名「K1」はもう図面にあります.*案: K4/);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_POINT_PRESET');
        app.eval(`document.getElementById('prop-point-name').value = 'K9'; document.getElementById('prop-point-z').value = '12.5'; applyPointPreset();`);
        app.eval(`processCommand('100,200')`); // X＝北 100・Y＝東 200
        const p = points().find((q) => q[0] === 'K9');
        assert.deepEqual(p, ['K9', 200, 100, 12.5]);
        app.eval(`resetCommand(); processCommand('PO')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '点 作図設定');
        assert.equal(app.eval(`document.getElementById('prop-point-name').value`), 'K10');
        app.eval('resetCommand()');
        assert.deepEqual(app.errors(), []);
    });

    it('メニューのボタンは「☰ メニュー」（絵と名前）。説明の「⋯」も「☰」にそろえた', () => {
        assert.match(app.eval(`document.getElementById('btn-top-menu').textContent`), /^☰ メニュー/);
        const bad = [];
        for (const f of ['index.html', ...fs.readdirSync(path.join(ROOT, 'public')).filter((x) => /^cad-.*\.js$/.test(x)).map((x) => 'public/' + x)]) {
            if (fs.readFileSync(path.join(ROOT, f), 'utf8').includes('⋯')) bad.push(f);
        }
        assert.deepEqual(bad, []);
        assert.ok(app.val(`GUIDE_COMMANDS[0][1].some(c => c[0] === 'POINT')`));
        assert.ok(app.val(`FAV_CATALOG.some(d => d.id === 'POINT')`));
    });
});
