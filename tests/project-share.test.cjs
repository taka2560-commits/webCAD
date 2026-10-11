'use strict';
// 保存一覧から図面一式で送る（v5.43。cad-storage.js の shareProjectFromList）:
//   一覧の各行の 📤 で、その図面を開いて図面一式に（保存は .webcad、スマホでは「📤 送る」で LINE でも送れる PDF）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('保存一覧から図面一式で送る', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('各行に 📤。押すとその図面を開いて図面一式に。開いていて変更が無ければ聞かずに。やめれば何もしない', async () => {
        await app.eval(`(async () => { entities.length = 0; entities.push({ type: 'LINE', layer: 0, color: null, x1: 0, y1: 0, x2: 10, y2: 0 }); ensureEntityIds();
            setDrawingName('a.dxf'); await saveProject('現場A');
            entities.length = 0; entities.push({ type: 'CIRCLE', layer: 0, color: null, cx: 0, cy: 0, radius: 5 }); ensureEntityIds();
            setDrawingName('b.dxf'); await saveProject('現場B'); })()`);
        app.eval(`window.__exported = []; window.__ex0 = window.exportWebcadFile; exportWebcadFile = async () => { window.__exported.push([_currentProjectName, entities.map(e => e.type).join()]); };
            window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return true; };`);
        try {
            await app.eval('showProjectList()');
            const rows = app.val(`[...document.querySelectorAll('#project-list-items .project-item')].map(r => [r.querySelector('.project-name').textContent, !!r.querySelector('.project-send-btn')])`);
            assert.deepEqual(rows.map((r) => r[1]), [true, true]);
            // 別の図面（現場A）: 開いてから図面一式
            await app.eval(`shareProjectFromList('現場A')`);
            assert.deepEqual(app.val('window.__exported'), [['現場A', 'LINE']]);
            assert.match(app.val('window.__asked[0]'), /「現場A」を開いて、図面一式/);
            assert.equal(app.eval(`document.getElementById('project-list-panel').style.display`), 'none');
            // 開いていて変更が無い図面は聞かない
            app.eval('window.__asked = [];');
            await app.eval(`shareProjectFromList('現場A')`);
            assert.equal(app.val('window.__asked.length'), 0);
            assert.equal(app.val('window.__exported.length'), 2);
            // やめる
            app.eval('window.confirm = () => false;');
            assert.equal(await app.eval(`shareProjectFromList('現場B')`), false);
            assert.equal(app.val('window.__exported.length'), 2);
            assert.equal(app.val('_currentProjectName'), '現場A');
            // 行の 📤 は開くこと（行を押す）とは別
            app.eval('window.confirm = () => true;');
            await app.eval('showProjectList()');
            app.eval(`[...document.querySelectorAll('#project-list-items .project-item')].find(r => r.querySelector('.project-name').textContent.startsWith('現場B')).querySelector('.project-send-btn').click()`);
            await new Promise((r) => setTimeout(r, 50));
            assert.deepEqual(app.val('window.__exported[2]'), ['現場B', 'CIRCLE']);
            assert.match(app.eval(`document.getElementById('project-list-panel').textContent`), /今の図面を一式で書き出す/);
        } finally { app.eval('exportWebcadFile = window.__ex0; window.confirm = () => true;'); }
        assert.deepEqual(app.errors(), []);
    });
});
