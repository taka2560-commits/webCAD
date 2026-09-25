'use strict';
// お気に入りのボタン（cad-fav.js）のテスト:
//   登録（☆・長押し）・覚える・バーのボタンで始める（もう一度押すとやめる・パネルは閉じる・光る）・並べ替え・外す・上限・
//   向き・名前・たたむ・隠す・登録の画面・コマンド FAV・ヘルプ・起動時の読み込み・すべてのコマンドが動く
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('お気に入りのボタン', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => {
        app.window.confirm = () => true;
        app.eval(`resetCommand(); hidePropertyPanel(); entities.length = 0;
            _fav.items = []; Object.assign(_fav, { show: true, dir: 'v', labels: true, folded: false }); _favSave(); favRenderBar();`);
    });
    const bar = () => app.eval(`(() => { const b = document.getElementById('fav-bar'); return b ? b.style.display : 'none'; })()`);
    const ids = () => app.val(`[...document.querySelectorAll('#fav-bar .fav-btn[data-id]')].map(b => b.dataset.id)`);
    const click = (id) => app.eval(`document.querySelector('#fav-bar .fav-btn[data-id="${id}"]').click()`);
    const active = (id) => app.eval(`document.querySelector('#fav-bar .fav-btn[data-id="${id}"]').classList.contains('active')`);
    const title = () => app.eval(`document.getElementById('property-panel').style.display === 'flex' ? document.getElementById('property-panel-title').textContent : ''`);

    it('最初はバーを出さない。☆ で登録するとバーに並び、端末に覚える。もう一度押すと外す', () => {
        assert.equal(bar(), 'none');
        app.eval(`favToggle('LINE'); favToggle('COORDS'); favToggle('DIMLINEAR');`);
        assert.equal(bar(), 'flex');
        assert.deepEqual(ids(), ['LINE', 'COORDS', 'DIMLINEAR']);
        assert.equal(app.eval(`document.querySelectorAll('#fav-bar .fav-add').length`), 1, '＋（登録）のボタン');
        assert.deepEqual(JSON.parse(app.eval(`localStorage.getItem('cad_favorites')`)).items, ['LINE', 'COORDS', 'DIMLINEAR']);
        app.eval(`favToggle('COORDS')`);
        assert.deepEqual(ids(), ['LINE', 'DIMLINEAR']);
        app.eval(`favToggle('LINE'); favToggle('DIMLINEAR')`);
        assert.equal(bar(), 'none', '全部外すとバーは消える');
    });

    it('バーのボタンで始める: 描く・寸法はもう一度押すとやめる。使っているボタンは光る', () => {
        app.eval(`favToggle('LINE'); favToggle('DIMLINEAR');`);
        click('LINE');
        assert.equal(app.eval('cmdState.mode'), 'WAITING_LINE_P1');
        assert.equal(active('LINE'), true); assert.equal(active('DIMLINEAR'), false);
        click('LINE');
        assert.equal(app.eval('cmdState.mode'), 'IDLE');
        assert.equal(active('LINE'), false);
        // 左のツールバーから始めても光る
        app.eval(`toggleCommand('DIMLINEAR')`);
        assert.equal(active('DIMLINEAR'), true);
        app.eval('resetCommand()');
        assert.equal(active('DIMLINEAR'), false);
    });

    it('パネルの機能: 押すと開き（光る）、開いていればもう一度押すと閉じる。測量計算はタブまで見る', () => {
        app.eval(`favToggle('COORDS'); favToggle('AREA'); favToggle('HELMERT');`);
        click('COORDS');
        assert.equal(title(), '📍 座標一覧'); assert.equal(active('COORDS'), true);
        click('COORDS');
        assert.equal(title(), ''); assert.equal(active('COORDS'), false);
        click('AREA');
        assert.equal(title(), '🧮 測量計算'); assert.equal(app.eval('_cogo.tab'), 'area');
        assert.equal(active('AREA'), true); assert.equal(active('HELMERT'), false);
        click('HELMERT');
        assert.equal(app.eval('_cogo.tab'), 'helm', '別のタブなら切り替える（閉じない）');
        assert.equal(active('HELMERT'), true); assert.equal(active('AREA'), false);
        app.eval('hidePropertyPanel()');
        assert.equal(active('HELMERT'), false, 'パネルを閉じると光らない');
    });

    it('並べ替え・外す・16個まで。向き・名前・たたむ・隠す', () => {
        app.eval(`['LINE', 'CIRCLE', 'MEASURE'].forEach(favToggle); favMove(0, 1);`);
        assert.deepEqual(ids(), ['CIRCLE', 'LINE', 'MEASURE']);
        app.eval('favMove(2, 1)'); // 端から先へは動かない
        assert.deepEqual(ids(), ['CIRCLE', 'LINE', 'MEASURE']);
        app.eval(`FAV_CATALOG.slice(0, 20).forEach(c => { if(!_fav.items.includes(c.id)) favToggle(c.id); })`);
        assert.equal(app.val('_fav.items.length'), 16);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /16個まで/);
        const cls = () => app.eval(`document.getElementById('fav-bar').className`);
        app.eval(`favSetDir('h')`); assert.match(cls(), /fav-h/); assert.doesNotMatch(cls(), /fav-v/);
        app.eval(`favSetLabels('off')`); assert.match(cls(), /no-labels/);
        app.eval('favFold()'); assert.match(cls(), /folded/);
        app.eval('favFold()'); assert.doesNotMatch(cls(), /folded/);
        app.eval(`favSetShow('off')`); assert.equal(bar(), 'none');
        app.eval(`favSetShow('on')`); assert.equal(bar(), 'flex');
        const saved = JSON.parse(app.eval(`localStorage.getItem('cad_favorites')`));
        assert.equal(saved.dir, 'h'); assert.equal(saved.labels, false); assert.equal(saved.items.length, 16);
    });

    it('登録の画面: ⋯ メニュー・コマンド FAV で開く。☆★ と並んでいる順、見出しの ？ でヘルプ', () => {
        app.eval(`favToggle('MEASURE'); favToggle('STAKE');`);
        assert.ok(app.eval(`[...document.querySelectorAll('#top-menu-modal .menu-item-btn')].some(b => /お気に入り/.test(b.textContent))`));
        app.eval(`processCommand('FAV')`);
        assert.equal(title(), '⭐ お気に入り');
        const t = app.eval(`document.getElementById('property-panel-content').textContent`);
        assert.match(t, /登録したボタン（2 \/ 16）/);
        assert.equal(app.eval(`document.querySelectorAll('.fav-chip.on').length`), 2);
        assert.deepEqual(app.val(`[...document.querySelectorAll('.fav-row .fav-row-name')].map(e => e.textContent)`), ['測定', '杭打ち']);
        app.eval(`favToggle('TRIM')`); // 画面を開いたまま登録すると、画面も描き直す
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /登録したボタン（3 \/ 16）/);
        assert.equal(app.eval(`document.getElementById('property-panel-help').style.display`), '');
        app.eval('guidePanelHelp()');
        assert.equal(app.eval(`document.querySelector('.gh-topic[data-id="fav"]').open`), true);
        app.eval('guideHelpBack()');
        assert.equal(title(), '⭐ お気に入り');
    });

    it('長押しで登録（左のツールバー・⋯ メニュー）。そのあとのクリックでコマンドを始めない。短い押し・動かしたときは登録しない', async () => {
        const press = async (sel, ms, move) => {
            app.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); b.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
                ${move ? `b.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 10 }));` : ''} })()`);
            await wait(ms);
            app.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); b.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 })); b.click(); })()`);
        };
        await press(`#toolbar .tool-btn[onclick="toggleCommand('CIRCLE')"]`, 700);
        assert.deepEqual(app.val('_fav.items'), ['CIRCLE']);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /お気に入りに「円」を登録しました/);
        assert.equal(app.eval('_favSuppress'), null, '指を離したときのクリックは止めた');
        await press(`#top-menu-modal [data-fav="STAKE"]`, 700);
        assert.deepEqual(app.val('_fav.items'), ['CIRCLE', 'STAKE']);
        await press(`#toolbar .tool-btn[onclick="toggleCommand('ARC')"]`, 150); // 短い押し
        await press(`#toolbar .tool-btn[onclick="toggleCommand('ELLIPSE')"]`, 700, true); // 押したまま動かした（スクロール）
        assert.deepEqual(app.val('_fav.items'), ['CIRCLE', 'STAKE']);
        await press(`#toolbar .tool-btn[onclick="toggleCommand('CIRCLE')"]`, 700); // 登録してあるもの
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /登録してあります/);
        assert.equal(app.val(`document.querySelectorAll('[data-fav]').length`) >= 19, true);
    });

    it('登録できるコマンドは、すべて始められる（エラーにならない）。ヘルプとコマンド一覧にもある', async () => {
        app.eval(`window.__dl = downloadBlob; downloadBlob = () => {};`);
        const list = app.val(`FAV_CATALOG.map(c => c.id).filter(id => !['GNSS', 'COORDREAD'].includes(id))`);
        for (const id of list) {
            app.eval(`favRun('${id}'); resetCommand(); hidePropertyPanel();`);
        }
        await wait(600); // 保存一覧・保存などの後から動く処理が終わるまで
        app.eval(`downloadBlob = window.__dl; const pl = document.getElementById('project-list-panel'); if(pl) pl.style.display = 'none';`);
        assert.deepEqual(app.errors(), []);
        assert.ok(app.eval(`GUIDE_TOPICS.some(t => t.id === 'fav')`));
        assert.ok(app.eval(`GUIDE_COMMANDS.some(([, list]) => list.some(c => c[0] === 'FAV'))`));
        assert.deepEqual(app.val(`guideHelpMatches('おきにいり')`).includes('fav'), true);
    });
});

describe('お気に入りのボタン: 起動時', () => {
    it('覚えている登録を出す（知らないコマンド・重なりは除く）。座標読取モードの目印', async () => {
        const app = await loadApp({ storage: { cad_favorites: JSON.stringify({ items: ['MEASURE', 'XYZ', 'MEASURE', 'TS'], dir: 'h', labels: false }) } });
        try {
            assert.deepEqual(app.val('_fav.items'), ['MEASURE', 'TS']);
            assert.equal(app.eval(`document.getElementById('fav-bar').style.display`), 'flex');
            assert.match(app.eval(`document.getElementById('fav-bar').className`), /fav-h.*no-labels|no-labels.*fav-h/);
            assert.deepEqual(app.errors(), []);
        } finally { app.close(); }
    });
});
