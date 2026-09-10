import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// DWG読込エンジンなど、初回起動時にはプリキャッシュしない大きなファイル
const LAZY_ASSET_RE = /libredwg/i;

function shortHash(data) {
    return createHash('sha256').update(data).digest('hex').slice(0, 10);
}

/**
 * PWA のキャッシュ管理をビルド時に自動化するプラグイン。
 *  1. public/ の通常スクリプト（cad-*.js）に内容ハッシュのクエリ ?v= を付ける
 *     → デプロイ直後に「新しい HTML + 古い JS」の組み合わせで動く事故を防ぐ
 *  2. dist/sw.js にビルドID・プリキャッシュ一覧を書き込む
 *     → CACHE_NAME の手動更新が不要になり、上げ忘れで古い版が残る事故を防ぐ
 *  3. index.html にビルドIDとビルド日時を埋め込む（オプション画面で版を確認できる）
 */
function webcadPwaPlugin() {
    let outDir;
    return {
        name: 'webcad-pwa',
        apply: 'build',
        configResolved(cfg) {
            outDir = path.resolve(cfg.root, cfg.build.outDir);
        },
        closeBundle() {
            const indexPath = path.join(outDir, 'index.html');
            const swPath = path.join(outDir, 'sw.js');
            if (!fs.existsSync(indexPath) || !fs.existsSync(swPath)) {
                throw new Error('[webcad-pwa] dist/index.html または dist/sw.js が見つかりません');
            }

            // 1) 通常スクリプトにバージョンクエリを付与
            let html = fs.readFileSync(indexPath, 'utf8');
            const versioned = [];
            html = html.replace(/<script src="([\w.-]+\.js)"><\/script>/g, (m, file) => {
                const p = path.join(outDir, file);
                if (!fs.existsSync(p)) return m;
                const url = `${file}?v=${shortHash(fs.readFileSync(p))}`;
                versioned.push(url);
                return `<script src="${url}"></script>`;
            });

            // 2) プリキャッシュ一覧（ハッシュ付きの assets/ はすべて。巨大な遅延読込ファイルは除く）
            const assetsDir = path.join(outDir, 'assets');
            const assets = fs.existsSync(assetsDir)
                ? fs.readdirSync(assetsDir).map((f) => `assets/${f}`)
                : [];
            const lazy = assets.filter((f) => LAZY_ASSET_RE.test(f));
            const eager = assets.filter((f) => !LAZY_ASSET_RE.test(f));
            const shell = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];
            // ビルドID = HTML・スクリプト・アセット名・アイコン等の内容から算出（中身が同じなら同じID）
            const shellFiles = shell.filter((f) => f !== './'); // './' は index.html（html に含む）
            const buildId = shortHash(
                [html, fs.readFileSync(swPath, 'utf8'), ...versioned, ...assets].join('|') +
                    shellFiles.map((f) => {
                        const p = path.join(outDir, f);
                        return fs.existsSync(p) ? shortHash(fs.readFileSync(p)) : f;
                    }).join('|')
            );
            const builtAt = new Date().toISOString();

            // 3) ビルド情報を HTML に埋め込む
            html = html.replace(
                '</head>',
                `    <meta name="webcad-build" content="${buildId}" data-built-at="${builtAt}">\n</head>`
            );
            fs.writeFileSync(indexPath, html);

            let sw = fs.readFileSync(swPath, 'utf8');
            const before = sw;
            sw = sw
                .replace("'__WEBCAD_BUILD_ID__'", JSON.stringify(buildId))
                .replace('/*__WEBCAD_SHELL__*/ []', JSON.stringify(shell))
                .replace('/*__WEBCAD_IMMUTABLE__*/ []', JSON.stringify([...versioned, ...eager]))
                .replace('/*__WEBCAD_LAZY__*/ []', JSON.stringify(lazy));
            if (sw === before || sw.includes('__WEBCAD_')) {
                throw new Error('[webcad-pwa] sw.js のプレースホルダ置換に失敗しました');
            }
            fs.writeFileSync(swPath, sw);

            console.log(
                `[webcad-pwa] build ${buildId}: スクリプト${versioned.length}件にバージョン付与、` +
                    `プリキャッシュ ${shell.length + versioned.length + eager.length}件、遅延 ${lazy.length}件`
            );
        },
    };
}

export default defineConfig({
    plugins: [webcadPwaPlugin()],
    build: {
        // DWG読込エンジン(libredwg-web, WASM埋め込み)は単体で約9MBあるため警告の閾値を上げる
        chunkSizeWarningLimit: 10000,
    },
});
