// ===== Web CAD デザイン色（画面の部品の配色） =====
// cad-theme.js - オプション「デザイン色」。標準（今までの色）と、暗い配色5種（UI の配色チートシートの 09・17〜20）
//
// ・配色ごとに BASE（地）・MAIN（ボタン）・ACCENT（選んでいる印）の3色を持ち、CSS の変数の値を作って <html> に書く。
//   標準は何も書かない（index.html の :root の値＝今までの色）
// ・変えるのは画面の部品の地・ボタン・選んでいる印だけ。役割の色（確定・保存・OSNAP＝緑、削除＝赤、編集・警告＝黄、
//   寸法＝水色、座標系＝青）と図面の色・図面の背景色は変えない
// ・head で読み込み、保存してある配色を最初の表示の前に付ける（起動したときに色がちらつかない）。
//   設定の保存と切り替えは cad-prefs.js の「表示・操作」（DISPLAY_PREF_DEFS.theme）
(function () {
    'use strict';
    const PREFS_KEY = 'cad_display_prefs';
    // chips はオプションの見本に出す3色（標準は パネルの地・使っている道具の青・選んでいる印の緑）
    const LIST = [
        { key: 'std', name: '標準', words: '今までの色', base: '#111418', chips: ['#282d34', '#528bff', '#00ff88'] },
        { key: 'gold', name: 'GOLD STANDARD', words: '高級感・重厚', base: '#151719', main: '#303844', accent: '#EFC34D' },
        { key: 'blue', name: 'ELECTRIC BLUE', words: '精密・先進', base: '#111827', main: '#1643A0', accent: '#46A6FF' },
        { key: 'mint', name: 'MINT TERMINAL', words: '冷静・クリア', base: '#111D1C', main: '#08715A', accent: '#42F0A4' },
        { key: 'violet', name: 'ULTRAVIOLET', words: '未来感・創造性', base: '#171423', main: '#622CC1', accent: '#C58AFF' },
        { key: 'lime', name: 'LIME SYSTEM', words: '実験的・鋭さ', base: '#151A14', main: '#486E16', accent: '#B6F52A' },
    ];
    LIST.forEach((t) => { if (!t.chips) t.chips = [t.base, t.main, t.accent]; });
    // 配色で書き換える変数（標準に戻すときに消す）
    const NAMES = ['--bg-color', '--panel-bg', '--panel-bg-outdoor', '--float-rgb', '--shape-bg', '--btn-fill', '--btn-fill-hover',
        '--btn-glass', '--btn-glass-menu', '--highlight-color', '--hl-rgb', '--brand', '--brand-rgb'];

    function rgb(h) { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
    function hex(c) { return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); }
    function find(key) { return LIST.find((t) => t.key === key) || null; }

    // 配色の変数の値。標準（や知らないキー）は null（CSS の値のまま）。
    // パネル・バーは BASE に MAIN を2割混ぜた色を8割の濃さで（図面が少し透ける今の形のまま）、屋外モード・お知らせの地は1割、
    // ボタンの地は35%（押す前の明るさは55%）、バーのボタンは MAIN を25%重ねる。選んでいる印は ACCENT
    function tokens(key) {
        const t = find(key);
        if (!t || !t.main) return null;
        const B = rgb(t.base), M = rgb(t.main), A = rgb(t.accent);
        const panel = mix(B, M, 0.2).join(','), solid = mix(B, M, 0.1).join(',');
        return {
            '--bg-color': t.base,
            '--panel-bg': `rgba(${panel},0.8)`,
            '--panel-bg-outdoor': `rgba(${solid},0.97)`,
            '--float-rgb': solid,
            '--shape-bg': `rgba(${panel},0.92)`,
            '--btn-fill': hex(mix(B, M, 0.35)),
            '--btn-fill-hover': hex(mix(B, M, 0.55)),
            '--btn-glass': `rgba(${M.join(',')},0.25)`,
            '--btn-glass-menu': `rgba(${M.join(',')},0.2)`,
            '--highlight-color': t.accent,
            '--hl-rgb': A.join(','),
            '--brand': t.accent,
            '--brand-rgb': A.join(','),
        };
    }

    // 配色を付ける（知らないキーは標準）。付けた配色のキーを返す
    function apply(key) {
        const t = find(key) || LIST[0];
        const root = document.documentElement;
        const tk = tokens(t.key);
        NAMES.forEach((n) => root.style.removeProperty(n));
        if (tk) Object.keys(tk).forEach((n) => root.style.setProperty(n, tk[n]));
        root.dataset.theme = t.key;
        const meta = document.querySelector('meta[name="theme-color"]'); // スマホのアドレスバー・通知バーの色
        if (meta) meta.setAttribute('content', t.base);
        return t.key;
    }

    // 保存してある配色（表示・操作の設定の theme。読めないときは標準）
    function savedKey() {
        try {
            const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
            return (v && typeof v.theme === 'string') ? v.theme : 'std';
        } catch { return 'std'; }
    }

    window.cadTheme = {
        list: LIST.map((t) => Object.assign({}, t, { chips: t.chips.slice() })),
        names: NAMES.slice(),
        tokens,
        apply,
        current: () => document.documentElement.dataset.theme || 'std',
    };
    apply(savedKey());
})();
