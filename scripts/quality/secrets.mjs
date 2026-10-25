// 秘密の文字の検査（G1 の一部。v5.56）: API キー・token・秘密の鍵に見える文字が、ソース・説明書き・設定・CI・ビルド（dist）に無いか。
// ビルドの「後」に走らせる（npm run check と CI の両方で、build のすぐ後）。dist が無ければ止める（調べたつもりで調べていない、を防ぐ）。
// 本物に見える長さのものだけを止める（テストのキーは実行するときに作るので、ここには引っかからない）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.quality']);
const EXTS = ['.js', '.mjs', '.cjs', '.json', '.html', '.md', '.yml', '.yaml', '.txt', '.dxf', '.sim', '.csv', '.sdr', '.env', '.css', '.svg'];
function walk(dir, out = []) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return out;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel, out); }
        else if (EXTS.some((x) => e.name.toLowerCase().endsWith(x)) || e.name.startsWith('.env')) out.push(rel);
    }
    return out;
}
const SECRET_RES = [
    [/sk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{30,}/g, 'Claude の API キー'],
    [/\bsl\.[A-Za-z0-9._-]{60,}/g, 'Dropbox の token'],
    [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, '秘密の鍵'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, 'GitHub の token'],
    [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS のキー'],
    [/\bxox[abposr]-[A-Za-z0-9-]{20,}/g, 'Slack の token'],
];
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('✖ 秘密の文字の検査: dist がありません（npm run build の後に走らせてください）');
    process.exit(1);
}
const files = walk('.');
const errors = [];
for (const f of files) {
    let s;
    try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    for (const [re, name] of SECRET_RES) {
        const m = [...s.matchAll(re)];
        if (m.length) errors.push(`${f}:${s.slice(0, m[0].index).split('\n').length} に ${name} に見える文字があります`);
    }
}
if (errors.length) {
    console.error('✖ 秘密の文字の検査に通りませんでした（キーはファイルに書かず、すぐに無効にして作り直してください）:');
    errors.forEach((e) => console.error('  - ' + e));
    process.exit(1);
}
console.log(`✔ 秘密の文字の検査: ${files.length} ファイル（ソース・説明書き・設定・CI・dist）にキー・token・秘密の鍵は見つかりませんでした`);
