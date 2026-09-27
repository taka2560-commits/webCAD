'use strict';
// UIの動き（試用。cad-motion.js）のテスト:
//   オプションの入・切（初期値は切＝これまでと同じ）、お気に入りの「動き」・コマンド MOTION、端末の「動きを減らす」のときは動かさない、
//   押した位置からの波紋、切り替えボタンの列の印、パネルの出入り（描き直しでは動かさない・閉じる前の形で消える）、
//   ▁・□ の形のつながり、スナップの印と輪（描画の状態は毎コマ元に戻る）、長押しの輪（途中で離すと消える）、
//   知らないコマンドの揺れ、保存の ✓、ヘルプ
//   jsdom には見た目の大きさと animate が無いので、四角（getBoundingClientRect）と animate を仮に決めて確かめる
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, near } = require('./helpers/load-app.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// jsdom には PointerEvent が無いため、MouseEvent に同じ名前を付けて代用する
function pointer(app, el, type, x, y) {
    el.dispatchEvent(new app.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
}

describe('UIの動き（試用）', () => {
    let app;
    before(async () => {
        app = await loadApp();
        app.eval(`
            window.__anims = [];
            HTMLElement.prototype.animate = function(kf, opt) {
                window.__anims.push({ id: this.id, cls: String(this.className), kf, opt });
                return { onfinish: null, cancel() {}, finish() {} };
            };
            // 仮の四角: パネル（ふつう・画面いっぱい・たたんだとき）、切り替えボタンの列（左から 60px おき）、そのほかのボタン
            Element.prototype.getBoundingClientRect = function() {
                const R = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
                if(this.id === 'property-panel') {
                    if(this.classList.contains('win-min')) return R(100, 100, 320, 43);
                    return this.classList.contains('win-max') ? R(8, 68, 984, 633) : R(100, 100, 320, 400);
                }
                if(this.parentElement && this.parentElement.matches('.cogo-seg, .opt-pref-seg')) {
                    const i = [...this.parentElement.children].indexOf(this);
                    return R(110 + i * 60, 150, 56, 30);
                }
                if(this.tagName === 'BUTTON') return R(12, 67, 46, 44);
                return R(0, 0, 0, 0);
            };
        `);
    });
    after(() => app.close());
    beforeEach(() => {
        app.eval(`
            resetCommand(); closePropertyPanel();
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {}; applyDisplayPrefs();
            delete window.matchMedia; window.__anims = []; snapResult = null; osnapState.main = true; _moSnap = { key: '', t0: -1e9 };
            document.querySelectorAll('.mo-ripple-host, .mo-pill, .mo-shape, .mo-hold').forEach((e) => e.remove());
        `);
    });
    const motion = () => app.eval(`setDisplayPref('motion', 'on')`);
    const count = (sel) => app.eval(`document.querySelectorAll('${sel}').length`);
    const has = (id, cls) => app.eval(`document.getElementById('${id}').classList.contains('${cls}')`);

    it('初期値は切（これまでと同じ）: body に motion-ui が無く、押しても・閉じても動きを付けない', () => {
        assert.equal(app.eval(`displayPrefKey('motion')`), 'off');
        assert.equal(app.eval(`document.body.classList.contains('motion-ui')`), false);
        assert.equal(app.eval('motionOn()'), false);
        pointer(app, app.window.document.getElementById('btn-extents'), 'pointerdown', 20, 80);
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>'); togglePropertyPanelMax(); closePropertyPanel(); issueCommand('XYZZY');`);
        assert.equal(count('.mo-ripple-host'), 0);
        assert.equal(count('.mo-shape'), 0);
        assert.equal(has('command-line-area', 'mo-shake'), false);
        assert.deepEqual(app.val('window.__anims'), []);
        app.eval(`snapResult = { wcsX: 10, wcsY: 20, type: '端点' };`);
        assert.equal(app.eval('motionSnapScale()'), 1);
    });

    it('入・切: オプション・お気に入りの「動き」・コマンド MOTION。端末の「動きを減らす」が入なら動かさず、そのことを知らせる', () => {
        motion();
        assert.equal(app.eval(`document.body.classList.contains('motion-ui')`), true);
        assert.equal(app.eval('motionOn()'), true);
        app.eval(`issueCommand('MOTION')`);
        assert.equal(app.eval(`displayPrefKey('motion')`), 'off');
        app.eval(`favRun('MOTION')`);
        assert.equal(app.eval(`displayPrefKey('motion')`), 'on');
        assert.equal(app.eval(`favDef('MOTION').activeFn()`), true);
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /UIの動き（試用）: 入/);
        app.eval(`window.matchMedia = (q) => ({ matches: /reduce/.test(q) });`);
        assert.equal(app.eval('motionOn()'), false);
        app.eval(`toggleMotionUI(); toggleMotionUI();`); // 切 → 入
        assert.match(app.eval(`document.getElementById('cad-toast').textContent`), /動きを減らす/);
        pointer(app, app.window.document.getElementById('btn-extents'), 'pointerdown', 20, 80);
        assert.equal(count('.mo-ripple-host'), 0);
        app.eval(`showOptionsPanel()`);
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /この端末はいま「動きを減らす」が入です/);
        app.eval(`resetDisplayPrefs()`);
        assert.equal(app.eval(`displayPrefKey('motion')`), 'off');
        assert.equal(app.eval(`document.body.classList.contains('motion-ui')`), false);
    });

    it('押したとき: 押した位置を中心に、ボタンと同じ四角の枠の中で波紋を広げ、時間で消す', async () => {
        motion();
        pointer(app, app.window.document.getElementById('btn-extents'), 'pointerdown', 20, 80); // ボタンの四角（仮）: (12, 67) から 46×44
        const h = app.val(`(h => h && { box: [h.style.left, h.style.top, h.style.width, h.style.height], dot: h.firstChild.className,
            l: parseFloat(h.firstChild.style.left), t: parseFloat(h.firstChild.style.top), d: parseFloat(h.firstChild.style.width) })(document.querySelector('.mo-ripple-host'))`);
        assert.deepEqual(h.box, ['12px', '67px', '46px', '44px']);
        assert.equal(h.dot, 'mo-ripple');
        // ボタンの中の (8, 13) から、いちばん遠い角 (46, 44) までが半径
        const r = Math.hypot(38, 31);
        assert.ok(near(h.d, 2 * r, 1e-6) && near(h.l, 8 - r, 1e-6) && near(h.t, 13 - r, 1e-6), JSON.stringify(h));
        await wait(600);
        assert.equal(count('.mo-ripple-host'), 0);
    });

    it('切り替えボタンの列（測量計算のタブ）: 選んだ印が、前のボタンから両方を包むまで伸びて、新しいボタンへ縮む', async () => {
        motion();
        app.eval(`showCogoPanel('area'); window.__anims = [];`);
        const tabs = app.window.document.querySelectorAll('#property-panel-content .cogo-seg button');
        tabs[4].click(); app.eval(`cogoSetTab('helm')`); // jsdom ではボタンの onclick が動かないので、押したときの処理を続けて呼ぶ
        await wait(20);
        const pill = app.val(`window.__anims.find((a) => a.cls === 'mo-pill')`);
        assert.ok(pill, '印を動かしていない');
        assert.deepEqual(pill.kf.map((k) => [k.left, k.width, k.opacity]), [['110px', '56px', 1], ['110px', '296px', 1], ['350px', '56px', 1], ['350px', '56px', 0]]);
        // いま選んでいるボタンを押しても動かさない
        app.eval(`window.__anims = []`);
        app.window.document.querySelectorAll('#property-panel-content .cogo-seg button')[4].click();
        await wait(20);
        assert.equal(app.val(`window.__anims.filter((a) => a.cls === 'mo-pill').length`), 0);
        await wait(450);
        assert.equal(count('.mo-pill'), 0);
    });

    it('パネル: 閉じていたパネルを出すときだけ上がりながら出す（描き直しでは動かさない）。閉じるときは閉じる前の形で縮んで消える', async () => {
        motion();
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>')`);
        const enter = app.val('window.__anims');
        assert.deepEqual(enter.map((a) => a.id), ['property-panel']);
        assert.deepEqual(enter[0].kf.map((k) => [k.opacity, k.translate]), [[0, '0 10px'], [1, '0 0']]);
        app.eval(`window.__anims = []; showPropertyPanel('テスト', '<div>描き直し</div>')`);
        assert.deepEqual(app.val('window.__anims'), [], 'タブの切り替えなどの描き直しでは動かさない');
        app.eval(`togglePropertyPanelMax(); document.querySelectorAll('.mo-shape').forEach((e) => e.remove()); window.__anims = []; closePropertyPanel();`);
        assert.equal(app.eval(`document.getElementById('property-panel').style.display`), 'none', 'パネル自体はすぐ閉じる');
        assert.deepEqual(app.val(`(g => [g.style.left, g.style.top, g.style.width, g.style.height])(document.querySelector('.mo-shape'))`),
            ['8px', '68px', '984px', '633px'], '画面いっぱいのまま消える');
        assert.deepEqual(app.val(`window.__anims.find((a) => a.cls === 'mo-shape').kf.map((k) => [k.opacity, k.scale])`), [[1, '1'], [0, '0.94']]);
        await wait(350);
        assert.equal(count('.mo-shape'), 0);
    });

    it('▁ たたむ・□ 画面いっぱい: 形の写しが前の四角から新しい四角へ動き、本物は途中から出る', () => {
        motion();
        app.eval(`showPropertyPanel('テスト', '<div>中身</div>'); window.__anims = []; togglePropertyPanelMax();`);
        let a = app.val('window.__anims');
        const g = a.find((x) => x.cls === 'mo-shape'), p = a.find((x) => x.id === 'property-panel');
        assert.deepEqual([g.kf[0].left, g.kf[0].width, g.kf[1].left, g.kf[1].width, g.kf[2].opacity], ['100px', '320px', '8px', '984px', 0]);
        assert.deepEqual(p.kf.map((k) => k.opacity), [0, 0, 1]);
        assert.equal(app.eval(`document.getElementById('property-panel').classList.contains('win-max')`), true, '大きさはすぐ変わる');
        app.eval(`window.__anims = []; togglePropertyPanelMin();`);
        a = app.val('window.__anims');
        const f = a.find((x) => x.cls === 'mo-shape');
        assert.deepEqual([f.kf[0].top, f.kf[0].height, f.kf[1].top, f.kf[1].height], ['68px', '633px', '100px', '43px']);
    });

    it('スナップ: 別の点に吸い付くと印を1.6倍から戻し、輪を1回広げる。同じ点のあいだ・切のときは出さない。描画の状態は元に戻る', () => {
        const frame = () => {
            app.eval(`window.__c = { arcs: [], depth: 0, min: 0 };
                ctx.arc = (x, y, r) => window.__c.arcs.push(r);
                ctx.save = () => { window.__c.depth++; };
                ctx.restore = () => { window.__c.depth--; window.__c.min = Math.min(window.__c.min, window.__c.depth); };`);
            try { app.eval('_drawFrame(false)'); } finally { app.eval('delete ctx.arc; delete ctx.save; delete ctx.restore;'); }
            return app.val('window.__c');
        };
        app.eval(`snapResult = { wcsX: 10, wcsY: 20, type: '端点' };`);
        const base = frame().arcs.length; // 切のとき
        motion();
        app.eval(`_moSnap = { key: '', t0: -1e9 };`);
        let c = frame();
        assert.equal(c.arcs.length, base + 1, '輪を描く');
        assert.ok(c.arcs.some((r) => near(r, 7, 0.5)), JSON.stringify(c.arcs));
        assert.equal(c.depth, 0); assert.equal(c.min, 0);
        assert.ok(app.eval('motionSnapScale()') > 1.5, '吸い付いた直後は印を大きめに');
        app.eval(`_moSnap.t0 -= 500;`); // 時間がたった
        c = frame();
        assert.equal(c.arcs.length, base, '同じ点のあいだは繰り返さない');
        assert.equal(app.eval('motionSnapScale()'), 1);
        app.eval(`snapResult = { wcsX: 30, wcsY: 20, type: '端点' };`);
        assert.equal(frame().arcs.length, base + 1, '別の点に吸い付くと、また知らせる');
        app.eval(`snapResult = null; _drawFrame(false); _moSnap.t0 -= 500; snapResult = { wcsX: 30, wcsY: 20, type: '端点' };`);
        assert.equal(frame().arcs.length, base + 1, '離れてから同じ点に戻ったときも知らせる');
        app.eval(`setDisplayPref('motion', 'off'); _moSnap = { key: '', t0: -1e9 };`);
        assert.equal(frame().arcs.length, base);
    });

    it('長押し（お気に入りの登録）: 押して少したつと輪を出し、満了で ✓。途中で離すと輪を消して登録しない', async () => {
        motion();
        app.eval(`_fav.items = []; _favSave(); favRenderBar();`);
        const b = app.window.document.querySelector(`#toolbar .tool-btn[onclick="toggleCommand('CIRCLE')"]`);
        pointer(app, b, 'pointerdown', 30, 80);
        await wait(80);
        assert.equal(count('.mo-hold'), 0, 'ふつうのタップでは出さない');
        await wait(150);
        assert.equal(count('.mo-hold'), 1);
        pointer(app, b, 'pointerup', 30, 80);
        assert.equal(count('.mo-hold'), 0, '途中で離すと消す');
        assert.deepEqual(app.val('_fav.items'), []);
        pointer(app, b, 'pointerdown', 30, 80);
        await wait(700);
        assert.equal(app.eval(`document.querySelector('.mo-hold').classList.contains('done')`), true, '満了で ✓');
        assert.deepEqual(app.val('_fav.items'), ['CIRCLE']);
        pointer(app, b, 'pointerup', 30, 80);
        await wait(600);
        assert.equal(count('.mo-hold'), 0);
        app.eval(`_fav.items = []; _favSave(); favRenderBar();`);
    });

    it('知らないコマンドはコマンド欄を揺らし、保存できたら 💾 に ✓ を出す（どちらも時間で外す）', async () => {
        motion();
        app.eval(`issueCommand('XYZZY')`);
        assert.equal(has('command-line-area', 'mo-shake'), true);
        app.eval(`setCurrentProjectName('動きのテスト')`);
        await app.eval('saveProject()');
        assert.equal(has('btn-save', 'mo-success'), true);
        await wait(1000);
        assert.equal(has('btn-save', 'mo-success'), false);
        assert.equal(has('command-line-area', 'mo-shake'), false);
    });

    it('ヘルプ（UIの動き）・コマンド一覧（MOTION）・オプションの説明がある。未捕捉のエラーが無い', () => {
        assert.ok(app.eval(`GUIDE_TOPICS.some((t) => t.id === 'motion')`));
        assert.ok(app.eval(`GUIDE_COMMANDS.some(([, list]) => list.some((c) => c[0] === 'MOTION'))`));
        assert.ok(app.val(`guideHelpMatches('うごき')`).includes('motion'));
        app.eval(`showOptionsPanel()`);
        assert.match(app.eval(`document.getElementById('property-panel-content').textContent`), /UIの動き（試用）/);
        assert.deepEqual(app.errors(), []);
    });
});
