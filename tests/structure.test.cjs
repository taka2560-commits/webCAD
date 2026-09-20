'use strict';
// ファイル構成のテスト:
//   アプリ本体（public/cad-*.js）はブラウザで同じスコープに読み込まれるため、
//   「読み込み順」と「名前の重複が無いこと」が動作の前提になる。
//   分割・追加のときにここが崩れると、画面が真っ白になる・古い関数が使われるなどの
//   気づきにくい不具合になるので、機械的に確認する。
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/load-app.cjs');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlScripts = [...html.matchAll(/<script src="([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
const appScripts = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js') && f !== 'sw.js');

// 行頭（インデント無し）の宣言だけを集める。関数の中や即時関数の中の宣言は対象外
function topLevelNames(src) {
    const names = [];
    for (const line of src.split(/\r?\n/)) {
        const fn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (fn) { names.push({ name: fn[1], kind: 'function' }); continue; }
        const decl = /^(let|const|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (decl) names.push({ name: decl[2], kind: decl[1] });
    }
    return names;
}

describe('ファイル構成', () => {
    it('index.html と自動テストのスクリプト読み込み順が一致している', () => {
        const helper = fs.readFileSync(path.join(ROOT, 'tests', 'helpers', 'load-app.cjs'), 'utf8');
        const block = /const APP_SCRIPTS = \[([\s\S]*?)\];/.exec(helper);
        assert.ok(block, 'load-app.cjs の APP_SCRIPTS が見つかりません');
        const testScripts = [...block[1].matchAll(/'([\w.-]+\.js)'/g)].map((m) => m[1]);
        assert.deepEqual(testScripts, htmlScripts);
    });

    it('public のスクリプトはすべて index.html から読み込まれている', () => {
        const missing = appScripts.filter((f) => !htmlScripts.includes(f));
        assert.deepEqual(missing, [], `index.html に <script src> が無いファイル: ${missing.join(', ')}`);
    });

    it('起動処理は一番最後に読み込む', () => {
        assert.equal(htmlScripts[htmlScripts.length - 1], 'cad-boot.js');
    });

    it('ファイルをまたいだトップレベル宣言の重複が無い', () => {
        const seen = new Map();
        const dup = [];
        for (const f of htmlScripts) {
            const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
            for (const { name, kind } of topLevelNames(src)) {
                const prev = seen.get(name);
                if (prev) dup.push(`${name}（${prev.file} の ${prev.kind} と ${f} の ${kind}）`);
                else seen.set(name, { file: f, kind });
            }
        }
        assert.deepEqual(dup, [], `同じ名前が複数のファイルで宣言されています: ${dup.join(' / ')}`);
    });

    it('1つのファイルが大きくなりすぎていない', () => {
        // 目安として1ファイル1200行まで。超えたら役割ごとに分けることを検討する
        const big = appScripts
            .map((f) => ({ f, n: fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').split(/\r?\n/).length }))
            .filter((x) => x.n > 1200)
            .map((x) => `${x.f}(${x.n}行)`);
        assert.deepEqual(big, [], `大きすぎるファイル: ${big.join(', ')}`);
    });
});
