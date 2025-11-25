const CACHE_NAME = 'pachi-slo-diary-v26';

// 最低限のプリキャッシュ（JS/CSSはネットワーク優先でOK）
const urlsToCache = [
  './',
  './index.html',
  './icon-192.png',
  './icon-512.png',
  './manifest.json'
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
  console.log('[SW] Install - version:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting()) // 即座に新SWを有効化
  );
});

// アクティベート時に古いキャッシュをすべて削除
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate - version:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // 現在のキャッシュ以外は全削除
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // 即座にクライアントを制御
  );
});

// フェッチ: ネットワーク優先 → 失敗時キャッシュフォールバック
self.addEventListener('fetch', (event) => {
  // API呼び出し・外部リソースはスルー
  if (event.request.url.includes('generativelanguage.googleapis.com') ||
      event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('firebase') ||
      event.request.url.includes('googleapis.com') ||
      event.request.url.includes('gstatic.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功したらキャッシュを更新
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // ネットワーク失敗時はキャッシュから取得（オフライン対応）
        return caches.match(event.request, { ignoreSearch: true });
      })
  );
});
