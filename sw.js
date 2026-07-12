// ===== Web CAD Service Worker =====
// 更新時はCACHE_NAMEのバージョンを上げること（旧キャッシュはactivateで削除される）
const CACHE_NAME = 'webcad-pwa-cache-v12';

// 必須アセット（1つでも失敗するとインストール失敗＝全て確実にキャッシュ）
const CORE_ASSETS = [
  './',
  './index.html',
  './cad-text-parse.js',
  './cad-core.js',
  './cad-dimension.js',
  './cad-io.js',
  './cad-storage.js',
  './manifest.json',
  './icon-192.png'
];

// 任意アセット（CDN・大容量。失敗してもインストールは続行し、
// オンライン時の初回利用で実行時キャッシュに載る）
const OPTIONAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.min.js',
  // dxf-writer は index.html から +esm で読み込む（実行時キャッシュで対応）
  'https://cdn.jsdelivr.net/npm/dxf-writer@1.18.4/+esm',
  // DWG読み込み用（オフラインでのDWG利用に必要）
  'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.6.6/dist/libredwg-web.js',
  'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.6.6/wasm/libredwg-web.wasm'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(CORE_ASSETS).then(() =>
        Promise.all(OPTIONAL_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('SW: 任意アセットのキャッシュに失敗:', url, err))
        ))
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(n => (n !== CACHE_NAME) ? caches.delete(n) : undefined))
    ).then(() => self.clients.claim())
  );
});

// キャッシュ可能なレスポンスか（opaque=CORSなしCDNも許容）
function isCacheable(res) {
  return res && (res.status === 200 || res.type === 'opaque');
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) HTMLナビゲーション: ネットワーク優先（デプロイが即反映される）
  //    オフライン時のみキャッシュへフォールバック
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).then(res => {
        if (isCacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 2) 同一オリジンのアセット: stale-while-revalidate
  //    （キャッシュを即返しつつ裏で更新→次回ロードで新版になる）
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (isCacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 3) クロスオリジン(CDNライブラリ・WASM): キャッシュ優先
  //    バージョン固定URLのため一度取得すれば不変。初回取得時に保存し
  //    オフラインでのDWG/DXF読み込みを可能にする
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (isCacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
