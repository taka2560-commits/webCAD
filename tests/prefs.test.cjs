'use strict';
// 表示・操作の設定（cad-prefs.js）のテスト:
//   ルーペの大きさ・倍率、座標の文字の大きさ・桁数、寸法の文字、スナップの吸着範囲
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

describe('表示・操作の設定', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());

    beforeEach(() => {
        app.eval(`
            resetCommand(); hidePropertyPanel();
            localStorage.removeItem('cad_display_prefs'); _displayPrefs = {}; applyDisplayPrefs();
            localStorage.removeItem('cad_survey_unit');
            entities.length = 0; undoStack.length = 0;
            layers.splice(0, layers.length, { name: '0', color: '#00ffff', visible: true });
            currentLayerIndex = 0;
            view = { x: 400, y: 300, scale: 1, rotation: 0 };
            ucs = { originX: 0, originY: 0, angle: 0 };
            snapResult = null; osnapState.main = true;
            touchState.showLoupe = false;
        `);
    });

    // canvas の fillText を横取りして、描かれた文字を集める
    function captureText(fn) {
        app.eval(`window.__texts = []; ctx.fillText = (t) => { window.__texts.push(String(t)); };`);
        try { fn(); } finally { app.eval(`delete ctx.fillText`); }
        return app.val('window.__texts');
    }

    it('何も変えなければ以前と同じ値になる', () => {
        assert.equal(app.eval(`displayPref('loupeSize')`), 70);
        assert.equal(app.eval(`displayPref('loupeZoom')`), 3);
        assert.equal(app.eval(`displayPref('coordFont')`), 1);
        assert.equal(app.eval(`displayPref('dimText')`), 1);
        assert.equal(app.eval(`displayPref('snapRange')`), 1);
        // 座標の桁「標準」: ステータスバーは整数、ルーペは小数2桁（以前と同じ）
        assert.equal(app.eval(`formatCoordValue(12.3456, 'bar')`), '12');
        assert.equal(app.eval(`formatCoordValue(12.3456, 'loupe')`), '12.35');
        assert.equal(app.eval(`dimSizePx(DIM_TEXT_SIZE)`), 16);
        assert.equal(app.eval(`dimSizePx(DIM_ARROW_SIZE)`), 10);
        assert.equal(app.eval(`snapRadiusPx()`), app.eval(`(isMobile() ? SNAP_R * 1.4 : SNAP_R)`));
    });

    it('選んだ設定を端末に保存する', () => {
        app.eval(`setDisplayPref('loupeSize', 'l'); setDisplayPref('coordDecimals', '3');`);
        assert.deepEqual(JSON.parse(app.eval(`localStorage.getItem('cad_display_prefs')`)), { loupeSize: 'l', coordDecimals: '3' });
        // 読み直しても同じ（次に開いたとき）
        app.eval(`_displayPrefs = _loadDisplayPrefs();`);
        assert.equal(app.eval(`displayPref('loupeSize')`), 90);
        assert.equal(app.eval(`formatCoordValue(1.5, 'bar')`), '1.500');
    });

    it('壊れた保存値・知らない値は既定値として扱う', () => {
        app.eval(`localStorage.setItem('cad_display_prefs', 'こわれた値'); _displayPrefs = _loadDisplayPrefs();`);
        assert.equal(app.eval(`displayPref('loupeSize')`), 70);
        app.eval(`localStorage.setItem('cad_display_prefs', JSON.stringify({ loupeSize: 'huge', loupeZoom: '4' })); _displayPrefs = _loadDisplayPrefs();`);
        assert.equal(app.eval(`displayPref('loupeSize')`), 70);  // 知らない値は既定
        assert.equal(app.eval(`displayPref('loupeZoom')`), 4);   // 正しい値は使う
        // 不正な値を設定しようとしても変わらない
        app.eval(`setDisplayPref('loupeZoom', '99'); setDisplayPref('nothing', 's');`);
        assert.equal(app.eval(`displayPref('loupeZoom')`), 4);
    });

    it('座標の桁数を変えるとステータスバーの座標がすぐ変わる', () => {
        app.eval(`mouse.ucsX = 1234.56789; mouse.ucsY = -52.1; snapResult = null;`);
        app.eval(`setDisplayPref('coordDecimals', '2')`);
        // 測量の並び: X（北）が先。X と Y は別の枠（狭い画面では2段に折り返す）
        const shown = () => app.eval(`[...coordsDisplay.children].map(s => s.textContent).join(' ')`);
        assert.equal(shown(), 'X:-52.10 Y:1234.57');
        app.eval(`setDisplayPref('coordDecimals', '0')`);
        assert.equal(shown(), 'X:-52 Y:1235');
        assert.equal(app.eval(`coordsDisplay.children.length`), 2);
    });

    it('座標の文字の大きさは CSS 変数で画面に反映する', () => {
        app.eval(`setDisplayPref('coordFont', 'xl')`);
        assert.equal(app.eval(`document.documentElement.style.getPropertyValue('--coord-scale')`), '1.6');
        app.eval(`resetDisplayPrefs()`);
        assert.equal(app.eval(`document.documentElement.style.getPropertyValue('--coord-scale')`), '1');
    });

    it('寸法の文字と矢印の大きさが変わる', () => {
        app.eval(`setDisplayPref('dimText', 'l')`);
        assert.equal(app.eval(`dimSizePx(DIM_TEXT_SIZE)`), 21);   // 16 × 1.3
        assert.equal(app.eval(`dimSizePx(DIM_ARROW_SIZE)`), 13);  // 10 × 1.3
        assert.equal(app.eval(`dimSizePx(MEAS_TEXT_SIZE)`), 20);  // 15 × 1.3（基点測定の文字）
        // 座標寸法の下線も文字に合わせて伸びる（タップ判定の位置も同じ）
        app.eval(`entities.push({ type:'DIMENSION', subType:'ORDINATE', layer:0, color:null, point:{x:0,y:0}, leaderCoord:{x:50,y:0} }); _drawFrame(false);`);
        const hits = app.val('entities[0]._hits');
        // 80px × (21 / 16)。文字の大きさ（16px×1.3を丸めた21px）と同じ比率で伸ばす
        assert.equal(Math.round(hits[1].p2.x - hits[1].p1.x), 105);
    });

    it('吸着の範囲を広げると、離れた点にもスナップする', () => {
        // 線の端点がカーソルから画面上 14px の位置（線はカーソルから離れる向き）
        app.eval(`entities.push({ type:'LINE', layer:0, color:null, x1:14, y1:0, x2:200, y2:0 }); _drawFrame(false); processCommand('LINE');`);
        const base = app.eval(`snapRadiusPx()`);
        const snapAt = () => app.eval(`(function(){ const s = wcsToScreen(0, 0); const r = findSnap(s.x, s.y, 0, 0); return r ? r.type : null; })()`);
        if(base < 14) assert.equal(snapAt(), null);   // 標準（10px）では届かない
        app.eval(`setDisplayPref('snapRange', 'l')`);  // 1.6倍
        assert.ok(app.eval(`snapRadiusPx()`) >= 16);
        assert.equal(snapAt(), '端点');
    });

    it('ルーペの大きさ・倍率を変えても描画でエラーにならない', () => {
        app.eval(`entities.push({ type:'LINE', layer:0, color:null, x1:-50, y1:0, x2:50, y2:0 });`);
        for(const size of ['s', 'm', 'l', 'xl']) {
            for(const zoom of ['2', '6']) {
                app.eval(`setDisplayPref('loupeSize', '${size}'); setDisplayPref('loupeZoom', '${zoom}');`);
                app.eval(`touchState.showLoupe = true; touchState.loupeX = 400; touchState.loupeY = 300; _drawFrame(false);`);
            }
        }
        app.eval(`touchState.showLoupe = false;`);
    });

    it('ルーペの座標は設定の桁数で、スナップ中はスナップ点の座標を出す', () => {
        app.eval(`setDisplayPref('coordDecimals', '3')`);
        // スナップ無し: 指の位置（画面 400,300 = WCS 0,0）
        let texts = captureText(() => app.eval(`touchState.showLoupe = true; touchState.loupeX = 400; touchState.loupeY = 300; snapResult = null; _drawFrame(true);`));
        assert.ok(texts.includes('X:0.000  Y:0.000'), texts.join(' | '));
        // スナップ中: 確定で入る点（スナップ点）の座標
        texts = captureText(() => app.eval(`snapResult = { wcsX: 12.5, wcsY: 3.25, type: '端点' }; _drawFrame(true);`));
        assert.ok(texts.includes('X:3.250  Y:12.500'), texts.join(' | '));
        assert.ok(texts.includes('SNAP: 端点'));
        app.eval(`touchState.showLoupe = false; snapResult = null;`);
    });

    it('設定を変えると見本（ルーペ・吸着範囲）を少しの間表示する', () => {
        app.eval(`showOptionsPanel(); setDisplayPref('loupeSize', 'xl');`);
        assert.equal(app.eval(`_prefPreview && _prefPreview.kind`), 'loupe');
        app.eval(`_drawFrame(true);`); // 見本の描画でエラーにならない
        app.eval(`setDisplayPref('snapRange', 'xl');`);
        assert.equal(app.eval(`_prefPreview && _prefPreview.kind`), 'snap');
        const texts = captureText(() => app.eval(`_drawFrame(true);`));
        assert.ok(texts.includes('この円の中の点に吸着'));
        app.eval(`clearTimeout(_prefPreviewTimer); _prefPreview = null; document.getElementById('property-panel').style.opacity = '';`);
    });

    it('オプション画面に「表示・操作」欄があり、選んだボタンが強調される', () => {
        app.eval(`setDisplayPref('loupeZoom', '4'); showOptionsPanel();`);
        const html = app.eval(`document.getElementById('property-panel-content').innerHTML`);
        assert.match(html, /表示・操作/);
        for(const label of ['ルーペの大きさ', 'ルーペの倍率', '座標の文字', '座標の桁', '寸法の文字', '吸着の範囲']) assert.match(html, new RegExp(label));
        const active = app.eval(`[...document.querySelectorAll('.opt-pref-btn.active[data-pref="loupeZoom"]')].map(b => b.textContent).join()`);
        assert.equal(active, '4倍');
        // ボタンを押すと強調が移る（テスト環境は onclick 属性を実行しないので、属性の中身をそのまま実行する）
        app.eval(app.eval(`document.querySelector('.opt-pref-btn[data-pref="loupeZoom"][data-key="2"]').getAttribute('onclick')`));
        assert.equal(app.eval(`document.querySelector('.opt-pref-btn.active[data-pref="loupeZoom"]').textContent`), '2倍');
        assert.equal(app.eval(`displayPref('loupeZoom')`), 2);
    });

    it('初期値に戻すと、すべて以前と同じ値になる', () => {
        app.eval(`showOptionsPanel(); ['loupeSize','coordFont','dimText','snapRange'].forEach(n => setDisplayPref(n, 'xl')); setDisplayPref('coordDecimals', '3');`);
        app.eval(`resetDisplayPrefs()`);
        assert.equal(app.eval(`displayPref('loupeSize')`), 70);
        assert.equal(app.eval(`displayPref('coordDecimals')`), null);
        assert.equal(app.eval(`localStorage.getItem('cad_display_prefs')`), '{}');
        const active = app.eval(`[...document.querySelectorAll('.opt-pref-btn.active')].map(b => b.dataset.pref + '=' + b.dataset.key).sort().join()`);
        assert.equal(active, 'coordDecimals=std,coordFont=m,dimDecimals=auto,dimText=m,loupeSize=m,loupeZoom=3,snapRange=m');
    });

    it('未捕捉エラーが起きない', () => {
        assert.deepEqual(app.errors(), []);
    });
});
