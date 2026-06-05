const CACHE_NAME = 'driver-binder-shell-v1';
const APP_SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then(res => res || caches.match('/index.html')))
  );
});
