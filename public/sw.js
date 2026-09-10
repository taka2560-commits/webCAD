// ===== Web CAD Service Worker =====
// 下の3つのプレースホルダは `npm run build` 時に vite.config.js のプラグインが書き換える。
// （手動で CACHE_NAME を上げる必要はない。開発サーバーでは SW を登録しない）
const BUILD_ID = '__WEBCAD_BUILD_ID__';
// アプリ本体（HTML・manifest・アイコン）: ビルドごとに作り直すキャッシュに入れる
const SHELL_ASSETS = /*__WEBCAD_SHELL__*/ [];
// 内容ハッシュ付きのファイル（?v=… 付きスクリプト / assets/*）: 内容が変わると URL も変わる
const IMMUTABLE_ASSETS = /*__WEBCAD_IMMUTABLE__*/ [];
// 大きいため初回はキャッシュせず、使ったとき（または明示的な保存操作）にキャッシュするもの
const LAZY_ASSETS = /*__WEBCAD_LAZY__*/ [];

const SHELL_CACHE = 'webcad-shell-' + BUILD_ID;
// ハッシュ付きファイルは版をまたいで使い回せるので別キャッシュに置き、
// 版の更新時は「今の版で使わないもの」だけを消す（DWG読込エンジンを毎回再取得しないため）
const ASSET_CACHE = 'webcad-assets';
// 電波が弱い現場で HTML の取得を待ち続けないためのタイムアウト
const NAV_TIMEOUT_MS = 4000;

const scopeUrl = (p) => new URL(p, self.registration.scope).href;
// サーバーが Vary: Origin を返すと、Origin ヘッダー付きで要求されるモジュールスクリプト
// （Vite が束ねたライブラリ）がキャッシュと一致せず、オフラインで読めなくなる。
// このアプリは内容の出し分けをしないため、照合では常に Vary を無視する。
const MATCH = { ignoreVary: true };
const MATCH_ANY_VERSION = { ignoreVary: true, ignoreSearch: true };

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // HTTP キャッシュを経由せず、確実に今の版を取得する
    await shell.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    const assets = await caches.open(ASSET_CACHE);
    const missing = [];
    for (const u of IMMUTABLE_ASSETS) {
      if (!(await assets.match(scopeUrl(u), MATCH))) missing.push(u);
    }
    await assets.addAll(missing);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 古い版のアプリ本体キャッシュを削除（旧形式 webcad-pwa-cache-vNN も含む）
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n !== SHELL_CACHE && n !== ASSET_CACHE) ? caches.delete(n) : undefined));
    // 今の版で参照しないハッシュ付きファイルを削除
    const keep = new Set([...IMMUTABLE_ASSETS, ...LAZY_ASSETS].map(scopeUrl));
    const assets = await caches.open(ASSET_CACHE);
    for (const req of await assets.keys()) {
      if (!keep.has(req.url)) await assets.delete(req);
    }
    await self.clients.claim();
  })());
});

// ページからの要求: DWG読込エンジンなど遅延ファイルの保存状況の確認・事前保存
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const reply = (data) => event.ports[0] && event.ports[0].postMessage(data);
  if (msg.type === 'lazy-status' || msg.type === 'lazy-cache') {
    event.waitUntil((async () => {
      const assets = await caches.open(ASSET_CACHE);
      try {
        if (msg.type === 'lazy-cache') {
          for (const u of LAZY_ASSETS) {
            if (!(await assets.match(scopeUrl(u), MATCH))) await assets.add(u);
          }
        }
        let cached = 0;
        for (const u of LAZY_ASSETS) if (await assets.match(scopeUrl(u), MATCH)) cached++;
        reply({ ok: true, total: LAZY_ASSETS.length, cached, build: BUILD_ID });
      } catch (err) {
        reply({ ok: false, error: String(err && err.message || err) });
      }
    })());
  }
});

function isCacheable(res) {
  return res && (res.status === 200 || res.type === 'opaque');
}

function isImmutableUrl(url) {
  return url.origin === self.location.origin &&
    (url.pathname.includes('/assets/') || url.searchParams.has('v'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) HTML ナビゲーション: ネットワーク優先（デプロイが即反映）。
  //    ただし電波が弱く NAV_TIMEOUT_MS 以内に返らなければキャッシュを先に表示する。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) cache.put(scopeUrl('./'), res.clone());
        return res;
      });
      network.catch(() => {}); // タイムアウト後に失敗しても未処理エラーにしない
      const fallback = () => cache.match(scopeUrl('./'), MATCH).then((r) => r || caches.match(req, MATCH_ANY_VERSION));
      const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS));
      try {
        const first = await Promise.race([network, timeout]);
        if (first) return first;
        const cached = await fallback();
        return cached || await network;
      } catch (err) {
        const cached = await fallback();
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // 2) ハッシュ付きファイル: キャッシュ優先（不変）。無ければ取得して保存。
  if (isImmutableUrl(url)) {
    event.respondWith((async () => {
      const assets = await caches.open(ASSET_CACHE);
      const hit = await assets.match(req, MATCH);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (isCacheable(res)) assets.put(req, res.clone());
        return res;
      } catch (err) {
        // オフラインで版が食い違った場合の最終手段: 同じファイルの別の版を返す
        const any = await caches.match(req, MATCH_ANY_VERSION);
        if (any) return any;
        throw err;
      }
    })());
    return;
  }

  // 3) その他の同一オリジン（manifest・アイコン等）: キャッシュを即返しつつ裏で更新
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req, MATCH_ANY_VERSION);
      const network = fetch(req).then((res) => {
        if (isCacheable(res)) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
    return;
  }

  // 4) クロスオリジン: スクリプト・フォント・スタイルのみキャッシュ優先で保存する
  if (['script', 'style', 'font'].includes(req.destination)) {
    event.respondWith(
      caches.match(req, MATCH).then((cached) => cached || fetch(req).then((res) => {
        if (isCacheable(res)) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
