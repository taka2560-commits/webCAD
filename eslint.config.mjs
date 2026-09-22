import js from "@eslint/js";
import fs from "node:fs";
import path from "node:path";

// public/ のスクリプトはブラウザで「同じスコープ」に読み込まれるため、
// ファイルをまたいで関数・変数をそのまま呼び合う（cad-core.js / cad-render.js / cad-geom.js …）。
// 参照先を1つずつ手で登録していると分割・追加のたびに漏れるので、
// 各ファイルのトップレベル宣言（function / let / const / var / window.○○ = …）を集めて globals にする。
// ※ どのファイルにも無い名前（打ち間違い）は no-undef で今までどおり検出される。
function collectAppGlobals(dir) {
    const globals = {};
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".js") || file === "sw.js") continue; // sw.js は別スコープ
        const src = fs.readFileSync(path.join(dir, file), "utf8");
        for (const line of src.split(/\r?\n/)) {
            const fn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
            if (fn) { globals[fn[1]] = "readonly"; continue; }
            const win = /^\s*(?:window|globalThis|global)\.([A-Za-z_$][\w$]*)\s*=/.exec(line);
            if (win) { globals[win[1]] = "writable"; continue; }
            const decl = /^(let|const|var)\s+/.exec(line);
            if (decl) for (const name of declaredNames(line.slice(decl[0].length))) globals[name] = "writable";
        }
    }
    return globals;
}

// `const a = f(1,2), b = [3,4];` のように1行で複数宣言している場合に、宣言名だけを取り出す
function declaredNames(rest) {
    const names = [];
    let depth = 0, quote = null, expectName = true, buf = "";
    const flush = () => { if (/^[A-Za-z_$][\w$]*$/.test(buf)) names.push(buf); buf = ""; };
    for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if (quote) { if (c === quote && rest[i - 1] !== "\\") quote = null; continue; }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if ("([{".includes(c)) { depth++; continue; }
        if (")]}".includes(c)) { depth--; continue; }
        if (depth > 0) continue;
        if (c === ",") { expectName = true; continue; }
        if (expectName) {
            if (/[A-Za-z_$\w]/.test(c)) { buf += c; continue; }
            if (buf) { flush(); expectName = false; continue; }
            if (c === " ") continue;
            expectName = false;
        }
    }
    flush();
    return names;
}

const appGlobals = collectAppGlobals("public");

export default [
    js.configs.recommended,
    {
        // Service Worker はグローバルが異なる
        files: ["public/sw.js"],
        languageOptions: {
            globals: { self: "readonly", caches: "readonly", fetch: "readonly", console: "readonly", URL: "readonly", Promise: "readonly", Request: "readonly", setTimeout: "readonly" }
        }
    },
    {
        // ビルド設定（Node.js で実行）
        files: ["vite.config.js"],
        languageOptions: {
            globals: { console: "readonly", process: "readonly" }
        }
    },
    {
        // Vite でバンドルするモジュール（src/）
        files: ["src/**/*.js"],
        languageOptions: {
            globals: { window: "readonly", Event: "readonly" }
        }
    },
    {
        // 自動テスト（Node.js の node:test で実行する CommonJS）
        files: ["tests/**/*.cjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                require: "readonly", module: "writable", __dirname: "readonly", process: "readonly",
                console: "readonly", setTimeout: "readonly", structuredClone: "readonly",
                TextEncoder: "readonly", TextDecoder: "readonly", Uint8ClampedArray: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-undef": "error"
        }
    },
    {
        // アプリ本体（public/*.js）。ブラウザに <script> でそのまま読み込む古典スクリプト
        files: ["public/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: {
                // --- ブラウザの機能 ---
                window: "readonly",
                document: "readonly",
                navigator: "readonly",
                location: "readonly",
                localStorage: "readonly",
                sessionStorage: "readonly",
                indexedDB: "readonly",
                console: "readonly",
                performance: "readonly",
                Math: "readonly",
                parseFloat: "readonly",
                parseInt: "readonly",
                isNaN: "readonly",
                Blob: "readonly",
                URL: "readonly",
                FileReader: "readonly",
                TextDecoder: "readonly",
                Uint8Array: "readonly",
                Promise: "readonly",
                MessageChannel: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                requestAnimationFrame: "readonly",
                getComputedStyle: "readonly",
                alert: "readonly",
                confirm: "readonly",
                prompt: "readonly",
                module: "readonly", // cad-text-parse.js の Node 向けフォールバック
                // --- 外部ライブラリ（src/vendor.js が window に用意する） ---
                DxfParser: "readonly",
                Drawing: "readonly", // dxf-writer
                // --- アプリ本体（public/*.js のトップレベル宣言を自動収集） ---
                ...appGlobals
            }
        },
        rules: {
            // ファイルをまたいで呼び合うため、トップレベル（＝グローバル）の宣言は未使用扱いにしない。
            // 関数の中で使われていない変数だけを警告する。
            "no-unused-vars": ["warn", { "vars": "local", "argsIgnorePattern": "^_" }],
            "no-undef": "error",
            // 自分のファイルで宣言した名前は globals にも載るため、その重複は無視する
            // （同じファイル内での二重宣言は今までどおりエラー）
            "no-redeclare": ["error", { "builtinGlobals": false }],
            "no-empty": ["error", { "allowEmptyCatch": true }]
        }
    }
];
