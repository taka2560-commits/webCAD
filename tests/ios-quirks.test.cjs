'use strict';
// iPhone・iPad（Safari）特有の不具合への備え。jsdom で、端末の名乗り（UA）とタッチ点の数を iPhone・iPad・PC に見せかけて確かめる。
//   ・ファイルを選ぶ欄: 端末が知らない拡張子（.dxf・.sim など）を accept に書くと、iPhone・iPad では灰色で選べない → 書かない
//   ・iPadOS の Safari は Mac と名乗る → タッチ点の数でも iPad と見分ける（TS 連携の案内）
//   ・パネルの上の2本指でページ全体が拡大されない（gesturestart を止める）
//   ・保存（ダウンロード）の一時 URL を、押した直後には消さない（Safari で保存に失敗する）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', // iPadOS の Safari
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};
function pretend(app, ua, touchPoints) {
    const nav = app.window.navigator;
    Object.defineProperty(nav, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(nav, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

describe('iPhone・iPad 特有の不具合', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    it('iPhone・iPad（Mac と名乗る iPadOS も）を見分け、Mac・PC は見分けない', () => {
        const cases = [['iphone', 5, true], ['ipad', 5, true], ['mac', 0, false], ['pc', 0, false], ['pc', 10, false]];
        for (const [k, tp, want] of cases) {
            pretend(app, UA[k], tp);
            assert.equal(app.eval('isAppleTouchDevice()'), want, `${k}（タッチ点 ${tp}）`);
        }
        // 文字列を渡したときは、その文字列だけで決める
        assert.equal(app.eval(`isAppleTouchDevice(${JSON.stringify(UA.iphone)})`), true);
        assert.equal(app.eval(`isAppleTouchDevice(${JSON.stringify(UA.mac)})`), false);
    });

    it('ファイルを選ぶ欄: iPhone・iPad では種類（accept）を書かず、PC では書く。座標一覧・ヘルマートの SIMA も同じ', () => {
        const grab = () => {
            app.eval(`window.__inputs = []; window.__oc = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { window.__inputs.push(this.getAttribute('accept')); };`);
            try { app.eval('coordListImportSima(); helmPickFile();'); } finally { app.eval('HTMLInputElement.prototype.click = window.__oc;'); }
            return app.val('window.__inputs');
        };
        pretend(app, UA.ipad, 5);
        assert.equal(app.eval(`fileAcceptFor('.dxf,.dwg')`), '');
        assert.deepEqual(grab(), ['', ''], '座標一覧・ヘルマートの SIMA の欄に種類が書かれている');
        app.eval('setupFileIO()'); // 起動時と同じ設定をし直す
        assert.equal(app.eval(`document.getElementById('dxf-file-input').hasAttribute('accept')`), false, '開く欄に種類が書かれている');

        pretend(app, UA.pc, 0);
        assert.equal(app.eval(`fileAcceptFor('.dxf,.dwg')`), '.dxf,.dwg');
        assert.deepEqual(grab(), ['.sim,.SIM,.txt', '.sim,.txt']);
        app.eval('setupFileIO()');
        assert.equal(app.eval(`document.getElementById('dxf-file-input').getAttribute('accept')`), '.dxf,.dwg,.sim,.csv,.txt,.sdr');
    });

    it('TS 連携: iPadOS の Safari（Mac と名乗る）でも「iPhone・iPad では直接つなげません」と出す（「PC は Chrome か Edge で」にしない）', () => {
        pretend(app, UA.ipad, 5);
        assert.match(app.eval('tsBrowserNote()'), /iPhone・iPad では、機械と直接つなげません/);
        pretend(app, UA.mac, 0);
        assert.match(app.eval('tsBrowserNote()'), /PC は Chrome か Edge/);
    });

    it('パネルの上の2本指で、ページ全体の拡大を止める（Safari の gesturestart・gesturechange）', () => {
        for (const t of ['gesturestart', 'gesturechange']) {
            const ev = new app.window.Event(t, { bubbles: true, cancelable: true });
            app.window.document.getElementById('properties-panel').dispatchEvent(ev);
            assert.equal(ev.defaultPrevented, true, t);
        }
    });

    it('保存の一時 URL は、押した直後には消さない（あとで消す）', () => {
        app.eval(`window.__rev = []; window.__orv = URL.revokeObjectURL; URL.revokeObjectURL = (u) => window.__rev.push(u);
            window.__ocu = URL.createObjectURL; URL.createObjectURL = () => 'blob:test'; // jsdom には無い
            window.__oto = setTimeout; window.__later = []; window.setTimeout = (fn, ms) => { window.__later.push(ms); return 0; };
            window.__ocl = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};`);
        try {
            app.eval(`downloadBlob(new Blob(['x']), 'a.txt')`);
            assert.deepEqual(app.val('window.__rev'), [], '押した直後に消している');
            assert.ok(app.val('window.__later').some((ms) => ms >= 10000), 'あとで消す予定が無い');
        } finally {
            app.eval('URL.revokeObjectURL = window.__orv; URL.createObjectURL = window.__ocu; window.setTimeout = window.__oto; HTMLAnchorElement.prototype.click = window.__ocl;');
        }
    });

    it('未捕捉エラーが起きない', () => { assert.deepEqual(app.errors(), []); });
});
