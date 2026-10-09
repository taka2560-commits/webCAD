'use strict';
// UCS の登録・管理（v5.42。cad-ucs.js）:
//   決めた直後の「＋ 登録」、今の UCS の名前（下の欄・全画面の上）、UCS 管理（切り替え・名前・上書き・消す）、
//   数値・点・線で作る、全画面の道具箱の「＋ 登録・管理・🗑」。図面一式で登録した UCS の原点が消えていたのを直した
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

describe('UCS の登録・管理', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`resetCommand(); closePropertyPanel(); hideSnack(); entities.length = 0; savedUCSList.length = 0; resetUCS(); updateUCSDropdowns();
            view = { x: 400, y: 300, scale: 1, rotation: 0 }; localStorage.removeItem('cad_display_prefs'); _displayPrefs = {};
            window.__answers = []; window.prompt = () => window.__answers.length ? window.__answers.shift() : null; window.confirm = () => true;
            window.__snack = null; window.__sn0 = window.__sn0 || window.showSnack; showSnack = (msg, o) => { window.__snack = { msg, label: o && o.action && o.action.label, run: o && o.action && o.action.run }; };`);
    });
    const label = () => app.eval(`document.getElementById('ucs-label').textContent`);
    const hud = () => app.eval(`document.getElementById('fs-hud-ucs').textContent`);
    const ucsNow = () => app.val('({ x: ucs.originX, y: ucs.originY, a: ucs.angle })');
    const panelText = () => app.eval(`document.getElementById('property-panel-content').textContent.replace(/\\s+/g, ' ')`);

    it('原点移動・2点で決めたら「＋ 登録」。押して名前を付けると、下の欄・全画面の上に「UCS: 名前」、UCS読込の欄もその UCS', () => {
        app.eval(`issueCommand('UCS'); handlePointInput({ x: 100, y: 200 }, true);`);
        assert.equal(label(), 'UCS');
        assert.equal(app.val('window.__snack.label'), '＋ 登録');
        app.eval(`window.__answers = ['現場A']; window.__snack.run();`);
        assert.deepEqual(app.val('savedUCSList'), [{ name: '現場A', x: 100, y: 200, angle: 0 }]);
        assert.equal(label(), 'UCS: 現場A');
        assert.equal(hud(), 'UCS: 現場A');
        assert.equal(app.eval(`document.getElementById('fs-ucs-select').value`), '0');
        assert.equal(app.eval(`document.getElementById('ucs-select').value`), '0');
        // 2点UCS でも出る。作り直すと名前は外れる
        app.eval(`window.__snack = null; issueCommand('UCS2P'); handlePointInput({ x: 0, y: 0 }, true); handlePointInput({ x: 10, y: 10 }, true);`);
        near(app.val('ucs.angle'), Math.PI / 4);
        assert.equal(app.val('window.__snack.label'), '＋ 登録');
        assert.equal(label(), 'UCS');
        assert.equal(app.eval(`document.getElementById('fs-ucs-select').value`), '');
        // WCS に戻すと WCS
        app.eval(`issueCommand('WCS')`);
        assert.equal(label(), 'WCS');
        assert.equal(hud(), 'WCS');
    });

    it('同じ名前は上書きするか聞く。WCS のときの登録は知らせるだけ', () => {
        app.eval(`setUCS(1, 2, 0); ucsRegister('A'); setUCS(3, 4, 0.5);`);
        app.eval(`window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return true; }; ucsRegister('A');`);
        assert.match(app.val('window.__asked[0]'), /もう登録されています/);
        assert.deepEqual(app.val('savedUCSList'), [{ name: 'A', x: 3, y: 4, angle: 0.5 }]);
        app.eval(`resetUCS(); window.__toast = null; window.__st0 = window.showToast; window.showToast = (m) => { window.__toast = m; }; processUcsCommand('UCSSAVE'); window.showToast = window.__st0;`);
        assert.match(app.val('window.__toast'), /WCS/);
        assert.equal(app.val('savedUCSList.length'), 1);
    });

    it('UCS 管理: 押して切り替え（今のものに印）・名前の変更・上書き・消す（消しても今の座標系はそのまま）', () => {
        app.eval(`setUCS(10, 20, 0); ucsRegister('A'); setUCS(30, 40, 0.2); ucsRegister('B'); showUcsManager();`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🎯 UCS 管理');
        assert.equal(app.val(`document.querySelectorAll('.ucs-row').length`), 2);
        assert.match(app.eval(`document.querySelector('.ucs-row.on .ucs-name').textContent`), /B/);
        app.eval('ucsUse(0)');
        assert.deepEqual(ucsNow(), { x: 10, y: 20, a: 0 });
        assert.match(app.eval(`document.querySelector('.ucs-row.on .ucs-name').textContent`), /A/, '今のものに印');
        // 名前の変更（今のものなら見出しも）
        app.eval(`window.__answers = ['A2']; ucsRename(0);`);
        assert.equal(label(), 'UCS: A2');
        // 上書き: 今の UCS（動かしたもの）で
        app.eval(`setUCS(11, 22, 0); ucsOverwrite(0);`);
        assert.deepEqual(app.val('savedUCSList[0]'), { name: 'A2', x: 11, y: 22, angle: 0 });
        assert.equal(label(), 'UCS: A2');
        // 消す: 今の座標系はそのまま（以前は WCS に戻っていた）
        app.eval('ucsDeleteAt(0)');
        assert.deepEqual(app.val('savedUCSList.map(u => u.name)'), ['B']);
        assert.deepEqual(ucsNow(), { x: 11, y: 22, a: 0 });
        assert.equal(label(), 'UCS');
        // 下の欄の見出しを押すと UCS 管理
        app.eval(`closePropertyPanel(); document.getElementById('ucs-label').click();`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🎯 UCS 管理');
    });

    it('数値で作る: 原点の座標（X＝北・Y＝東）と回転角（度分秒も）。名前を入れればそのまま登録', () => {
        app.eval(`showUcsManager(); ucsOpenForm();
            document.getElementById('ucs-f-x').value = '100'; document.getElementById('ucs-f-y').value = '200';
            document.getElementById('ucs-f-a').value = '30 15 00'; document.getElementById('ucs-f-n').value = '通り芯';
            ucsApplyForm();`);
        const u = ucsNow();
        near(u.x, 200); near(u.y, 100); near(u.a, 30.25 * Math.PI / 180);
        assert.equal(app.val('savedUCSList[0].name'), '通り芯');
        assert.equal(label(), 'UCS: 通り芯');
        // 読めない角度は欄の下に理由
        app.eval(`ucsOpenForm(); document.getElementById('ucs-f-a').value = 'あ'; ucsApplyForm();`);
        assert.ok(app.val(`!!document.querySelector('#ucs-f-a[aria-invalid="true"]') || /角度を読めません/.test(document.getElementById('property-panel-content').textContent)`));
    });

    it('点を決めた座標に: タップした点が、入れた座標（X,Y）になるよう原点を動かす（向きは今の UCS のまま）', () => {
        app.eval(`setUCS(0, 0, 0.3); ucsStartMatch();`);
        assert.equal(app.eval('cmdState.mode'), 'WAITING_UCS_MATCH');
        app.eval(`window.__answers = ['10,20']; handlePointInput({ x: 50, y: 60 }, true);`);
        const u = app.val('wcsToUcs(50, 60)');
        near(u.y, 10); near(u.x, 20); // X＝北・Y＝東
        near(app.val('ucs.angle'), 0.3);
        assert.equal(app.val('window.__snack.label'), '＋ 登録');
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
    });

    it('線の向きで: タップした側の端が原点、線の向きが横軸（ポリライン・長方形の辺も）。線でなければ知らせる', () => {
        app.eval(`entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 10 }, { type: 'RECTANG', layer: 0, color: null, x1: 50, y1: 0, x2: 80, y2: 20 }); ensureEntityIds();`);
        const tap = (x, y) => app.eval(`{ const s = wcsToScreen(${x}, ${y}); mouse.screenX = s.x; mouse.screenY = s.y; handlePointInput({ x: ${x}, y: ${y} }, true); }`);
        app.eval('ucsStartLine()');
        tap(1, 1);
        assert.deepEqual(app.val('({ x: ucs.originX, y: ucs.originY })'), { x: 0, y: 0 });
        near(app.val('ucs.angle'), Math.PI / 4);
        app.eval('ucsStartLine()');
        tap(9, 9);
        assert.deepEqual(app.val('({ x: ucs.originX, y: ucs.originY })'), { x: 10, y: 10 });
        near(app.val('ucs.angle'), -3 * Math.PI / 4);
        app.eval('ucsStartLine()');
        tap(79, 0); // 長方形の下の辺の右の端の近く
        assert.deepEqual(app.val('({ x: ucs.originX, y: ucs.originY })'), { x: 80, y: 0 });
        near(Math.abs(app.val('ucs.angle')), Math.PI);
    });

    it('図面一式・保存: 登録した UCS の原点が残り（以前は消えていた）、今の UCS の名前も戻る。以前の形（originX）も読む', () => {
        app.eval(`setUCS(100, 200, 0.5); ucsRegister('現場A');`);
        const d = app.val(`_buildSaveData('t')`);
        assert.equal(d.ucsName, '現場A');
        app.eval(`savedUCSList.length = 0; resetUCS(); applyProjectData(sanitizeWebcadProject(${JSON.stringify(d)}));`);
        assert.deepEqual(app.val('savedUCSList'), [{ name: '現場A', x: 100, y: 200, angle: 0.5 }]);
        assert.equal(label(), 'UCS: 現場A');
        app.eval(`resetUCS(); loadUCS('0');`);
        assert.deepEqual(ucsNow(), { x: 100, y: 200, a: 0.5 });
        // 以前の図面一式で入った形
        app.eval(`savedUCSList = [{ name: 'old', originX: 5, originY: 6, angle: 0 }]; loadUCS('0');`);
        assert.deepEqual(ucsNow(), { x: 5, y: 6, a: 0 });
    });

    it('全画面の道具箱に「＋ 登録・🗂 管理・🗑」、☰ に「＋ UCS登録・🗂 UCS管理」。コマンド UC・UCSMAN・UCSSAVE、お気に入り、ヘルプ', () => {
        const fs = app.val(`[...document.querySelectorAll('#fs-tools .fsd-btn')].map(b => b.textContent.trim())`);
        assert.ok(fs.includes('＋ 登録') && fs.includes('🗂 管理') && fs.includes('🗑'));
        assert.ok(!fs.includes('💾 保存'), '図面の保存と紛らわしい「💾 保存」は無くした');
        assert.ok(app.val(`!!document.querySelector('[data-fav="UCSMAN"]') && !!document.querySelector('[data-fav="UCSSAVE"]')`));
        assert.ok(app.val(`FAV_CATALOG.some(d => d.id === 'UCSMAN') && FAV_CATALOG.some(d => d.id === 'UCSSAVE')`));
        app.eval(`processCommand('UC')`);
        assert.equal(app.eval(`document.getElementById('property-panel-title').textContent`), '🎯 UCS 管理');
        assert.ok(app.val(`!!GUIDE_PANEL_HELP['🎯 UCS 管理'] && GUIDE_COMMANDS.flatMap(([, l]) => l).some(([c]) => c === 'UCSMAN')`));
        assert.match(panelText(), /数値で/);
        app.eval('showSnack = window.__sn0;');
        assert.deepEqual(app.errors(), []);
    });
});
