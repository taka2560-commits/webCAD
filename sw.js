const CACHE_NAME = 'webcad-pwa-cache-v13';
const urlsToCache = [
  './',
  './index.html',
  './cad-core.js',
  './cad-dimension.js',
  './cad-io.js',
  './cad-storage.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/dxf-parser/dist/dxf-parser.min.js',
  'https://cdn.jsdelivr.net/npm/dxf-writer@1.4.0/dist/Drawing.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // キャッシュ内に該当のレスポンスがあればそれを返す
        if (response) {
          return response;
        }
        
        // 重要: リクエストをクローンする
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(
          response => {
            // レスポンスが正しいかチェック
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // 重要: レスポンスをクローンしてキャッシュとブラウザ両方に渡す
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});

// 新しいService Workerが更新されたら古いキャッシュを削除する
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
