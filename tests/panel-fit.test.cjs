'use strict';
// パネルの高さの上限（v5.58.2。cad-core.js の fitPanelAboveActionbar）: 書く所は1か所。
// 下のバー（☑確定・終了）と、スマホの幅の別窓（cad-subview.js）の両方を見て、小さい方にする。
// 以前は別窓の側も max-height を書いていて、一度ヘルマート変換の別窓を使うと、下のバーに合わせた高さを消していた
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

describe('パネルの高さの上限', () => {
    let app;
    before(async () => {
        app = await loadApp();
        // jsdom は大きさを持たないので、決めた位置を返す
        app.eval(`window.__rects = {}; window.__oldRect = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = function() { const r = window.__rects[this.id];
                if(!r) return window.__oldRect.call(this);
                return { left: r[0], top: r[1], right: r[2], bottom: r[3], width: r[2] - r[0], height: r[3] - r[1], x: r[0], y: r[1] }; };`);
    });
    after(() => { app.eval('Element.prototype.getBoundingClientRect = window.__oldRect'); app.close(); });
    beforeEach(() => app.eval(`resetCommand(); closePropertyPanel(); _panelFitSubviews.length = 0; window.innerWidth = 390;
        window.__rects = { 'property-panel': [34, 100, 356, 700], 'fs-dim-actionbar': [20, 640, 370, 760] };`));
    const mh = () => app.val(`document.getElementById('property-panel').style.maxHeight`);
    const openWithBar = () => app.eval(`showPropertyPanel('テスト', '<div>x</div>'); document.getElementById('fs-dim-actionbar').style.display = 'flex'; fitPanelAboveActionbar();`);

    it('下のバーが出ていれば、バーの上で終わらせる。バーが消えたら外す。横に離れていれば制限しない', () => {
        openWithBar();
        assert.equal(mh(), '524px'); // 640 - 100 - 16
        app.eval(`document.getElementById('fs-dim-actionbar').style.display = 'none'; fitPanelAboveActionbar();`);
        assert.equal(mh(), '');
        app.eval(`window.__rects['property-panel'] = [400, 100, 700, 700];`);
        openWithBar();
        assert.equal(mh(), '', 'パネルを横へ動かしてバーと重ならなければ、縮めない');
    });

    it('別窓（変換の図）を一度使ったあとも、下のバーに合わせた高さを消さない。両方あるときは小さい方', () => {
        // 別窓が閉じている（display none）: バーの高さがそのまま効く
        app.eval(`window.__sv = document.createElement('div'); window.__sv.id = 'test-subview'; window.__sv.style.display = 'none'; document.body.appendChild(window.__sv);`);
        openWithBar();
        app.eval('_subviewFitPanel(window.__sv)');
        assert.equal(mh(), '524px', '別窓の側が max-height を空に戻さない');
        // 別窓が出ている（スマホの幅）: 別窓の上まで
        app.eval(`window.__sv.style.display = 'flex'; window.__rects['test-subview'] = [0, 420, 390, 800]; _subviewFitPanel(window.__sv);`);
        assert.equal(mh(), '314px'); // 420 - 100 - 6
        // 広い画面では、別窓の分は縮めない（バーの分だけ）
        app.eval(`window.innerWidth = 1024; fitPanelAboveActionbar();`);
        assert.equal(mh(), '524px');
        app.eval('window.__sv.remove()');
    });

    it('max-height を書くのは fitPanelAboveActionbar だけ（別窓の側では書かない）', () => {
        const sub = fs.readFileSync(path.join(ROOT, 'public/cad-subview.js'), 'utf8').replace(/\/\/.*$/gm, '');
        assert.ok(!/maxHeight\s*=/.test(sub), 'cad-subview.js は max-height を書かない');
        const hel = fs.readFileSync(path.join(ROOT, 'public/cad-helmert.js'), 'utf8').replace(/\/\/.*$/gm, '');
        assert.ok(!/property-panel[^\n]*maxHeight\s*=/.test(hel));
    });

    it('画面いっぱい（□）・たたんだ（▁）ときは制限しない', () => {
        openWithBar();
        app.eval(`document.getElementById('property-panel').classList.add('win-max'); fitPanelAboveActionbar();`);
        assert.equal(mh(), '');
        app.eval(`document.getElementById('property-panel').classList.remove('win-max');`);
    });
});
