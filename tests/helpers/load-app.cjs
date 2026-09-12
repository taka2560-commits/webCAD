'use strict';
// ===== テスト用: アプリ本体を jsdom 上で起動する =====
// index.html と public/cad-*.js を「ブラウザで読み込むのと同じ順序・同じスコープ」で実行する。
// （vm.Script で実行するため、各スクリプトのトップレベル let/const もスクリプト間で共有される）
//
//   const app = await loadApp();
//   app.eval('entities.length')          // アプリの変数・関数をそのまま評価
//   app.val('entities[0]')               // JSON 経由で取り出す（別レルムのオブジェクト比較を避ける）
//   app.errors()                         // 未捕捉エラーの一覧（テスト終了時に空であることを確認する）
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const util = require('node:util');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const ROOT = path.resolve(__dirname, '..', '..');
// index.html と同じ読み込み順（cad-errors.js は head、残りは body 末尾）
const APP_SCRIPTS = ['cad-errors.js', 'cad-text-parse.js', 'cad-dimension.js', 'cad-io.js', 'cad-core.js', 'cad-survey.js', 'cad-storage.js'];

// Canvas 2D の代用品。描画命令は何もしないが、文字幅の計測（measureText）は概算値を返す。
function fakeContext2d(canvas) {
    const state = { font: '10px sans-serif', globalAlpha: 1, lineWidth: 1 };
    const noop = () => {};
    const fontSize = () => {
        const m = /(\d+(?:\.\d+)?)px/.exec(state.font);
        return m ? parseFloat(m[1]) : 10;
    };
    const methods = {
        canvas,
        measureText: (t) => {
            const size = fontSize();
            return { width: String(t).length * size * 0.6, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 };
        },
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => ({}),
        getLineDash: () => [],
        isPointInPath: () => false,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };
    return new Proxy(methods, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k === 'string' && k in state) return state[k];
            return noop;
        },
        set(t, k, v) {
            state[k] = v;
            return true;
        },
    });
}

async function loadApp(options = {}) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const consoleErrors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (err) => consoleErrors.push(String((err && err.stack) || err)));
    if (options.verbose) virtualConsole.sendTo(console);

    const dom = new JSDOM(html, {
        url: 'http://localhost/',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole,
    });
    const { window } = dom;

    // ---- jsdom に無いブラウザ機能の代用品 ----
    window.HTMLCanvasElement.prototype.getContext = function () {
        if (!this._fakeCtx) this._fakeCtx = fakeContext2d(this);
        return this._fakeCtx;
    };
    window.indexedDB = new IDBFactory(); // テストごとに空のデータベース
    window.IDBKeyRange = IDBKeyRange;
    window.TextDecoder = util.TextDecoder;
    window.TextEncoder = util.TextEncoder;
    window.structuredClone = structuredClone;
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.scrollTo = () => {};
    Object.defineProperty(window.navigator, 'vibrate', { value: () => true, configurable: true });
    // ダイアログは既定で「OK」。テスト側で app.window.confirm を差し替えられる
    window.confirm = () => true;
    window.alert = () => {};
    window.prompt = () => null;

    // ---- 外部ライブラリ（本番では src/vendor.js が設定するもの） ----
    window.DxfParser = require('dxf-parser');
    window.Drawing = require('dxf-writer');
    window.loadLibreDwg = async () => { throw new Error('テストでは DWG 読込エンジンを使用しません'); };

    const ctx = dom.getInternalVMContext();
    const run = (code, filename) => new vm.Script(code, { filename }).runInContext(ctx);

    for (const f of APP_SCRIPTS) {
        run(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'), f);
    }
    // index.html 内のインラインスクリプト（全画面切替など。type="module" は除く）
    window.document.querySelectorAll('script:not([src])').forEach((s, i) => {
        if (s.type && s.type !== 'text/javascript') return;
        run(s.textContent, `index.html#inline-${i}`);
    });

    // DOMContentLoaded（init）と load を待つ
    if (window.document.readyState !== 'complete') {
        await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
    }
    // 起動直後の遅延処理（100ms後の画面サイズ調整、500ms後の自動保存の復元確認）が
    // テストの途中に割り込まないよう、済むまで待つ
    await new Promise((resolve) => setTimeout(resolve, options.settleMs !== undefined ? options.settleMs : 650));

    const app = {
        window,
        dom,
        /** アプリのスコープで式や文を評価する */
        eval: (code) => run(code, 'test-eval.js'),
        /** 式の値を JSON 経由で取り出す（テスト側で deepStrictEqual できる形にする） */
        val: (expr) => {
            const s = run(`JSON.stringify(${expr})`, 'test-val.js');
            return s === undefined ? undefined : JSON.parse(s);
        },
        /** テストから値を渡す（JSON で渡すのでアプリ側のレルムのオブジェクトになる） */
        set: (name, value) => run(`${name} = ${JSON.stringify(value)};`, 'test-set.js'),
        /** 未捕捉のエラー（cad-errors.js の記録 + jsdom の報告） */
        errors: () => {
            const recorded = run('JSON.stringify(window.cadErrors ? window.cadErrors.list() : [])', 'test-errors.js');
            return [...JSON.parse(recorded).map((e) => `${e.kind}: ${e.message}`), ...consoleErrors];
        },
        close: () => window.close(),
    };
    return app;
}

/** 読み込み済みのフィクスチャ（tests/fixtures/ 配下）を文字列で返す */
function fixture(name) {
    return fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');
}

/** 小数の比較（既定の許容誤差 1e-6） */
function near(actual, expected, eps = 1e-6) {
    return Math.abs(actual - expected) <= eps;
}

module.exports = { loadApp, fixture, near, ROOT };
