/* ============================================================
 * sw.js — Service Worker
 *   アプリシェル（HTML/CSS/JS/manifest/icons）のみをプリキャッシュする。
 *   ユーザーの音声・動画は IndexedDB に保存されており、ここではキャッシュしない。
 *   → オフラインでアプリ起動＋保存済みメディア再生が可能。
 * ============================================================ */
const CACHE = 'verse-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/zip.js',
  './js/db.js',
  './js/storage.js',
  './js/media.js',
  './js/versions.js',
  './js/backup.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 同一オリジンのシェルのみ対象（外部通信はそもそも無い設計）
  if (url.origin !== self.location.origin) return;

  // cache-first。無ければネットワーク→取れたらキャッシュ更新。
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
