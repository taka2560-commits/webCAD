// 品質のチェック（G1。npm run check と CI の中で動く）
// 1. 見えない文字: ソース（public・src・tests・scripts・index.html）に、BOM・ゼロ幅・NBSP・制御文字・文字化けの印（U+FFFD）が無いか
//    （置き換えのときに混ざりやすく、見ても気づけない。説明書き（.md）は BOM・ゼロ幅・制御文字・U+FFFD だけ）
// 2. 版番号: README の「現在のバージョン」・操作マニュアルの「対応バージョン」・更新履歴のいちばん上 が同じか
// 3. テストの件数: README の「自動テスト（N件）」が、いま走らせたテストの件数（.quality/test-count.json）と同じか
// （秘密の文字の検査は、ビルドの後に scripts/quality/secrets.mjs で）
// 失敗があれば理由を出して終了コード 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const errors = [];

// ---- 1. 見えない文字 ----
/* eslint-disable no-control-regex -- 制御文字そのものを探すため */
const CODE_BAD = [[/\uFEFF/g, 'BOM（U+FEFF）'], [/\u00A0/g, 'NBSP（U+00A0）'], [/[\u200B-\u200F\u2028\u2029\u2060]/g, 'ゼロ幅など'],
    [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '制御文字'], [/\uFFFD/g, '文字化けの印（U+FFFD）']];
// 説明書きは NBSP と、絵文字をつなぐ ZWJ（U+200D。人と道具の絵文字など）を許す
const DOC_BAD = [[/\uFEFF/g, 'BOM（U+FEFF）'], [/[\u200B\u200C\u200E\u200F\u2028\u2029\u2060]/g, 'ゼロ幅など'], [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '制御文字'], [/\uFFFD/g, '文字化けの印（U+FFFD）']];
function walk(dir, exts, out = []) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return out;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel, exts, out); }
        else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
    }
    return out;
}
const codeFiles = ['index.html', 'vite.config.js', 'eslint.config.mjs', ...walk('public', ['.js', '.json']), ...walk('src', ['.js']), ...walk('tests', ['.cjs', '.js']), ...walk('scripts', ['.mjs', '.js', '.cjs'])];
const docFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')).concat(walk('docs', ['.md']));
/* eslint-enable no-control-regex */
const scan = (files, bad) => files.forEach((f) => {
    const s = rd(f);
    bad.forEach(([re, name]) => {
        const m = [...s.matchAll(re)];
        if (!m.length) return;
        const line = s.slice(0, m[0].index).split('\n').length;
        errors.push(`見えない文字: ${f}:${line} に ${name} が ${m.length} 個（エスケープ \\u… で書くか、消してください）`);
    });
});
scan(codeFiles, CODE_BAD);
scan(docFiles, DOC_BAD);

// ---- 2. 版番号 ----
const vReadme = (/現在のバージョン:\s*v([\d.]+)/.exec(rd('README.md')) || [])[1];
const vManual = (/対応バージョン:\s*v([\d.]+)/.exec(rd('WebCAD操作マニュアル.md')) || [])[1];
const vHist = (/^## バージョン([\d.]+)/m.exec(rd('更新履歴.md')) || [])[1];
if (!vReadme || !vManual || !vHist) errors.push(`版番号が見つかりません（README ${vReadme} / マニュアル ${vManual} / 更新履歴 ${vHist}）`);
else if (!(vReadme === vManual && vManual === vHist)) errors.push(`版番号が合いません: README v${vReadme} / 操作マニュアル v${vManual} / 更新履歴 v${vHist}`);

// ---- 3. テストの件数 ----
const countFile = path.join(ROOT, '.quality/test-count.json');
const nReadme = Number((/自動テスト（(\d+)件/.exec(rd('README.md')) || [])[1]);
let counted = false;
if (fs.existsSync(countFile)) {
    counted = true;
    const c = JSON.parse(fs.readFileSync(countFile, 'utf8'));
    if (c.fail) errors.push(`テストに失敗が ${c.fail} 件あります`);
    if (nReadme !== c.tests) errors.push(`README の「自動テスト（${nReadme}件）」が、いまのテストの件数 ${c.tests} 件と合いません`);
} else console.log('（テストの件数のファイルが無いので、件数の照合は飛ばしました。npm test のあとに走らせてください）');

if (errors.length) {
    console.error('✖ 品質のチェック（G1）に通りませんでした:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
}
console.log(`✔ 品質のチェック（G1）: 見えない文字なし（${codeFiles.length + docFiles.length} ファイル）・版 v${vReadme} がそろっている・${counted ? `テストの件数 ${nReadme} 件が合っている` : 'テストの件数は未照合'}`);
