'use strict';
// デザイン色（cad-theme.js・オプション「表示・操作」のデザイン色）のテスト:
//   初期値は標準（今までの色のまま）、見本を押すと配色が変わり端末に覚える、初期値に戻すで標準、保存した配色で起動する、
//   どの配色も文字・印の読みやすさ（コントラスト比）が標準以上、役割の色は変えない、屋外モードは配色の色味のまま不透明、
//   標準の CSS の値は変数にする前と同じ、背景色を選んでもほかの切り替えボタンの選択が外れない
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, ROOT } = require('./helpers/load-app.cjs');

// ---- 色の計算（WCAG 2 のコントラスト比）----
function rgbOf(s) {
    s = String(s).trim();
    if (s[0] === '#') {
        let h = s.slice(1);
        if (h.length === 3) h = h.split('').map((x) => x + x).join('');
        const n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const m = /rgba?\(([^)]+)\)/.exec(s);
    const p = m[1].split(',').map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
function lum(c) {
    const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
function over(fg, a, bg) { return fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a)); }

const TEXT = rgbOf('#e0e0e0'), DIM = rgbOf('#9aa3ad'), RED = rgbOf('#ff6b6b');
const CANVAS = { 黒: [0, 0, 0], グレー: [128, 128, 128], 白: [255, 255, 255] };
// 読みやすさの数（パネルは図面の上に8割ほどの濃さで重なるので、図面の背景ごとに計算する）
function readability(tk) {
    const p = rgbOf(tk['--panel-bg']), fill = rgbOf(tk['--btn-fill']);
    const hl = rgbOf(tk['--highlight-color']), brand = rgbOf(tk['--brand']);
    const r = {};
    for (const [name, c] of Object.entries(CANVAS)) {
        const P = over(p, p[3], c);
        r[`${name}:文字`] = contrast(TEXT, P);
        r[`${name}:薄い文字`] = contrast(DIM, P);
        r[`${name}:赤`] = contrast(RED, P);
        r[`${name}:使っている道具`] = contrast(hl, over(hl, 0.25, P)); // .tool-btn.active（ACCENT 25% の地に ACCENT の文字）
    }
    r['ボタン:文字'] = contrast(TEXT, fill);
    r['ボタン:薄い文字'] = contrast(DIM, fill);
    r['ボタン:赤'] = contrast(RED, fill);
    r['ボタン:選んでいる印'] = contrast(brand, over(brand, 0.1, fill)); // .opt-bg-btn.active
    return r;
}

describe('デザイン色', () => {
    let app;
    before(async () => { app = await loadApp(); });
    after(() => app.close());
    beforeEach(() => { app.eval(`resetDisplayPrefs(); closePropertyPanel(); if(typeof setCanvasBackground === 'function') setCanvasBackground('#000');`); });

    const rootVar = (n) => app.eval(`getComputedStyle(document.documentElement).getPropertyValue('${n}').trim()`);
    const inlineVar = (n) => app.eval(`document.documentElement.style.getPropertyValue('${n}')`);
    const meta = () => app.eval(`document.querySelector('meta[name="theme-color"]').getAttribute('content')`);

    it('初めは標準（今までの色）: 変数を書き足さず、:root の値のまま', () => {
        assert.equal(app.eval('document.documentElement.dataset.theme'), 'std');
        assert.equal(app.eval('cadTheme.current()'), 'std');
        for (const n of app.val('cadTheme.names')) assert.equal(inlineVar(n), '', n);
        assert.equal(rootVar('--brand'), '#00ff88');
        assert.equal(rootVar('--highlight-color'), '#528bff');
        assert.equal(rootVar('--btn-fill'), '#2a2e35');
        assert.equal(meta(), '#111418');
        assert.deepEqual(app.errors(), []);
    });

    it('オプションに6つの見本があり、押すと配色が変わって端末に覚える。初期値に戻すと標準', () => {
        app.eval('showOptionsPanel()');
        const sw = app.val(`[...document.querySelectorAll('.opt-theme-btn')].map(b => [b.dataset.key, b.classList.contains('active'), b.getAttribute('aria-pressed')])`);
        assert.deepEqual(sw.map((s) => s[0]), ['std', 'gold', 'blue', 'mint', 'violet', 'lime']);
        assert.deepEqual(sw.filter((s) => s[1]).map((s) => s[0]), ['std']);
        assert.equal(app.eval(`document.querySelector('.opt-theme-btn[data-key="std"]').getAttribute('aria-pressed')`), 'true');
        assert.match(app.eval(`document.querySelector('.opt-theme-btn[data-key="gold"]').textContent`), /GOLD STANDARD.*高級感/);
        assert.equal(app.eval(`document.querySelectorAll('.opt-theme-btn[data-key="blue"] .opt-theme-chips i').length`), 3);
        // 見本を押す（テスト環境は onclick 属性を実行しないので、その中身を実行する）
        app.eval(app.eval(`document.querySelector('.opt-theme-btn[data-key="gold"]').getAttribute('onclick')`));
        assert.equal(app.eval('document.documentElement.dataset.theme'), 'gold');
        assert.equal(inlineVar('--brand'), '#EFC34D');
        assert.equal(inlineVar('--panel-bg'), 'rgba(26,30,34,0.8)');
        assert.equal(inlineVar('--btn-fill'), '#1e2328');
        assert.equal(meta(), '#151719');
        assert.equal(JSON.parse(app.eval(`localStorage.getItem('cad_display_prefs')`)).theme, 'gold');
        assert.deepEqual(app.val(`[...document.querySelectorAll('.opt-theme-btn.active')].map(b => b.dataset.key)`), ['gold']);
        assert.equal(app.eval(`document.querySelector('.opt-theme-btn[data-key="std"]').getAttribute('aria-pressed')`), 'false');
        // 別の配色へ。使わない変数が残らない（標準に戻すと全部消える）
        app.eval(`setDisplayPref('theme', 'mint')`);
        assert.equal(inlineVar('--brand'), '#42F0A4');
        app.eval('resetDisplayPrefs()');
        assert.equal(app.eval('document.documentElement.dataset.theme'), 'std');
        for (const n of app.val('cadTheme.names')) assert.equal(inlineVar(n), '', n);
        assert.equal(meta(), '#111418');
        assert.deepEqual(app.val(`[...document.querySelectorAll('.opt-theme-btn.active')].map(b => b.dataset.key)`), ['std']);
        // ほかの設定（ボタンの大きさなど）の変数は消さない
        assert.notEqual(inlineVar('--btn-k'), '');
        // 知らない値は受け付けない
        app.eval(`setDisplayPref('theme', 'pink')`);
        assert.equal(app.eval('document.documentElement.dataset.theme'), 'std');
        assert.deepEqual(app.errors(), []);
    });

    it('どの配色も、文字・薄い文字・赤・使っている道具の読みやすさは標準以上（図面の背景が黒・グレー・白のどれでも）。ボタンの上も基準以上', () => {
        const std = readability({ '--panel-bg': rootVar('--panel-bg'), '--btn-fill': rootVar('--btn-fill'), '--highlight-color': rootVar('--highlight-color'), '--brand': rootVar('--brand') });
        const keys = app.val(`cadTheme.list.map(t => t.key)`).filter((k) => k !== 'std');
        assert.equal(keys.length, 5);
        for (const k of keys) {
            const r = readability(app.val(`cadTheme.tokens('${k}')`));
            for (const name of Object.keys(CANVAS)) {
                for (const what of ['文字', '薄い文字', '赤', '使っている道具']) {
                    const key = `${name}:${what}`;
                    assert.ok(r[key] >= std[key] - 1e-9, `${k} ${key}: ${r[key].toFixed(2)}（標準 ${std[key].toFixed(2)}）`);
                }
                assert.ok(r[`${name}:文字`] >= 4.5, `${k} ${name}:文字 ${r[`${name}:文字`].toFixed(2)}`);
            }
            assert.ok(r['黒:使っている道具'] >= 3, `${k} 黒:使っている道具`);
            assert.ok(r['ボタン:文字'] >= 7, `${k} ボタン:文字 ${r['ボタン:文字'].toFixed(2)}`);
            for (const what of ['薄い文字', '赤', '選んでいる印']) assert.ok(r[`ボタン:${what}`] >= 4.5, `${k} ボタン:${what} ${r[`ボタン:${what}`].toFixed(2)}`);
        }
    });

    it('役割の色（確定・保存の緑、削除の赤、寸法の水色、座標系の青、UCS の黄）は配色で変えない。WCS の表示は座標系の青', () => {
        for (const k of app.val(`cadTheme.list.map(t => t.key)`)) {
            const tk = app.val(`cadTheme.tokens('${k}')`) || {};
            for (const n of ['--green', '--warn', '--cyan', '--ucs-color', '--coord-color']) assert.equal(tk[n], undefined, `${k} ${n}`);
        }
        app.eval(`setDisplayPref('theme', 'blue'); resetUCS();`);
        assert.equal(app.eval(`document.getElementById('ucs-label').style.color`), 'var(--coord-color)');
        app.eval(`_syncUcsLabels()`);
        assert.equal(app.eval(`document.getElementById('ucs-label').style.color`), 'var(--coord-color)');
        assert.equal(rootVar('--coord-color'), '#528bff');
    });

    it('屋外モードは、配色の色味のままパネルを不透明にする', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        assert.match(html, /body\.outdoor-mode \{\s*--panel-bg: var\(--panel-bg-outdoor\);/);
        assert.equal(rootVar('--panel-bg-outdoor'), 'rgba(10,12,16,0.97)');
        for (const k of ['gold', 'blue', 'mint', 'violet', 'lime']) {
            const v = rgbOf(app.val(`cadTheme.tokens('${k}')['--panel-bg-outdoor']`));
            assert.ok(v[3] >= 0.97, `${k} は不透明に近い`);
        }
        app.eval(`setDisplayPref('theme', 'violet'); setDisplayPref('outdoor', 'on');`);
        assert.equal(inlineVar('--panel-bg-outdoor'), 'rgba(31,22,51,0.97)');
        assert.equal(app.eval(`document.body.classList.contains('outdoor-mode')`), true);
        assert.deepEqual(app.errors(), []);
    });

    it('標準の値は、変数にする前の色と同じ（CSS の変数を :root の値に戻すと、以前の文字と一致する）', () => {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const sub = (s) => s.replace(/var\((--[\w-]+)\)/g, (m, n) => rootVar(n));
        // [いまの CSS, 変数にする前の CSS]
        const pairs = [
            ['.top-btn { flex:0 0 auto;height:34px;padding:0 10px;background-color:var(--btn-glass);', '.top-btn { flex:0 0 auto;height:34px;padding:0 10px;background-color:rgba(255,255,255,0.06);'],
            ['.tool-btn.active { background-color:rgba(var(--hl-rgb),0.25);', '.tool-btn.active { background-color:rgba(82,139,255,0.25);'],
            ['box-shadow:0 0 12px rgba(var(--hl-rgb),0.3); }', 'box-shadow:0 0 12px rgba(82,139,255,0.3); }'],
            ['.status-btn { background:var(--btn-glass);', '.status-btn { background:rgba(255,255,255,0.06);'],
            ['background:rgba(var(--hl-rgb),0.2);border-color:var(--highlight-color);', 'background:rgba(82,139,255,0.2);border-color:#528bff;'],
            ['.menu-item-btn { min-height: 36px; padding: 0 8px; border-radius: var(--r-sub); background: var(--btn-glass-menu);', '.menu-item-btn { min-height: 36px; padding: 0 8px; border-radius: 8px; background: rgba(255,255,255,0.05);'],
            ['background:rgba(var(--float-rgb),0.94); color:#e0e0e0; border:1px solid rgba(var(--brand-rgb),0.4);', 'background:rgba(18,22,28,0.94); color:#e0e0e0; border:1px solid rgba(0,255,136,0.4);'],
            ['#sel-label { color:var(--brand);', '#sel-label { color:#00ff88;'],
            ['            font-weight: bold;\n            color: var(--brand);\n', '            font-weight: bold;\n            color: #00ff88;\n'],
            ['.opt-bg-btn { background:var(--btn-fill) !important;', '.opt-bg-btn { background:#2a2e35 !important;'],
            ['.opt-bg-btn:hover { background:var(--btn-fill-hover) !important; }', '.opt-bg-btn:hover { background:#3a4049 !important; }'],
            ['.opt-bg-btn.active { border-color:var(--brand) !important; color:var(--brand) !important; background:rgba(var(--brand-rgb),0.10) !important; }',
                '.opt-bg-btn.active { border-color:#00ff88 !important; color:#00ff88 !important; background:rgba(0,255,136,0.10) !important; }'],
            ['.prop-btn.btn-sub { background:var(--btn-fill);', '.prop-btn.btn-sub { background:#2a2e35;'],
            ['.subview-title { flex:1; min-width:0; font-size:12px; font-weight:bold; color:var(--brand);', '.subview-title { flex:1; min-width:0; font-size:12px; font-weight:bold; color:#00ff88;'],
            ['.fav-btn.active { background-color:rgba(var(--hl-rgb),0.25);', '.fav-btn.active { background-color:rgba(82,139,255,0.25);'],
            ['.fav-chip:hover { background:var(--btn-fill-hover); }', '.fav-chip:hover { background:#3a4049; }'],
            ['--panel-bg: var(--panel-bg-outdoor);', '--panel-bg: rgba(10,12,16,0.97);'],
            ['border: 1px solid var(--brand); border-radius: 6px; background: rgba(var(--brand-rgb),0.16);', 'border: 1px solid #00ff88; border-radius: 6px; background: rgba(0,255,136,0.16);'],
            ['.mo-shape { position: fixed; pointer-events: none; box-sizing: border-box; background: var(--shape-bg);', '.mo-shape { position: fixed; pointer-events: none; box-sizing: border-box; background: rgba(28,32,38,0.92);'],
            ['#guide-spot { position:fixed; z-index:1000001; pointer-events:none; display:none; border:2px solid var(--brand);', '#guide-spot { position:fixed; z-index:1000001; pointer-events:none; display:none; border:2px solid #00ff88;'],
            ['title="WCS（押すと UCS 管理）" style="color:var(--coord-color);font-weight:bold;">WCS</span>', 'title="WCS（押すと UCS 管理）" style="color:#528bff;font-weight:bold;">WCS</span>'], // 下の欄の UCS の見出し（v5.42 で押すと UCS 管理）
        ];
        const text = html.replace(/\r\n/g, '\n');
        for (const [now, before] of pairs) {
            assert.ok(text.includes(now), `index.html に無い: ${now.slice(0, 60)}`);
            assert.equal(sub(now), before);
        }
    });

    it('背景色を選んでも、ほかの切り替えボタン（表示・操作・測量の単位・デザイン色）の選択は外れない', () => {
        app.eval(`setDisplayPref('loupeZoom', '4'); showOptionsPanel();`);
        const actives = () => app.val(`[...document.querySelectorAll('#property-panel-content .active')].map(b => b.dataset.bg || b.dataset.pref || b.textContent.trim())`);
        const before = actives();
        assert.ok(before.includes('loupeZoom') && before.includes('theme') && before.includes('#000'), JSON.stringify(before));
        app.eval(`setCanvasBackground('#808080')`);
        const after = actives();
        assert.deepEqual(after.filter((x) => x[0] === '#'), ['#808080']);
        assert.deepEqual(after.filter((x) => x[0] !== '#'), before.filter((x) => x[0] !== '#'));
        assert.deepEqual(app.errors(), []);
    });
});

describe('デザイン色: 起動時', () => {
    it('保存してある配色で最初から表示する（知らない値・読めない値は標準）', async () => {
        let app = await loadApp({ storage: { cad_display_prefs: '{"theme":"violet"}' } });
        try {
            assert.equal(app.eval('document.documentElement.dataset.theme'), 'violet');
            assert.equal(app.eval(`document.documentElement.style.getPropertyValue('--brand')`), '#C58AFF');
            assert.equal(app.eval(`document.querySelector('meta[name="theme-color"]').getAttribute('content')`), '#171423');
            assert.equal(app.eval(`displayPrefKey('theme')`), 'violet');
        } finally { app.close(); }
        for (const bad of ['{"theme":"pink"}', 'こわれた値', '{"theme":3}']) {
            app = await loadApp({ storage: { cad_display_prefs: bad } });
            try {
                assert.equal(app.eval('document.documentElement.dataset.theme'), 'std', bad);
                assert.equal(app.eval(`document.documentElement.style.getPropertyValue('--brand')`), '', bad);
            } finally { app.close(); }
        }
    });
});
