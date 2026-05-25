// My Task – Network-first Service Worker
// HTML は毎回ネットワーク取得（古いキャッシュで動かないように）
const SW_VERSION = 'mytask-2026-05-25';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 古いキャッシュを全削除
    const names = await caches.keys();
    await Promise.all(names.map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('accept') || '';
  const isNavigation = req.mode === 'navigate' || accept.includes('text/html');

  if (isNavigation) {
    // HTML: ネットワーク優先（キャッシュ無効）
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(() => new Response(
          '<h1>オフライン</h1><p>ネットワークに接続してから再度開いてください。</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
        ))
    );
  }
  // それ以外（PNG/JSONなど）は通常のブラウザキャッシュに任せる
});
