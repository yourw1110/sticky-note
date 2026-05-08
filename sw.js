const CACHE_NAME = 'sticky-note-v8';
const ASSETS_TO_CACHE = [
  'index.html',
  'style.css',
  'script.js',
  'icon.svg',
  'manifest.json',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => {
          return fetch(url, { mode: 'no-cors' })
            .then((response) => cache.put(url, response))
            .catch((err) => console.warn('Cache failed:', url));
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  
  // Origins that should be handled by the Service Worker
  const isLocal = url.origin === self.location.origin;
  const isFirebase = url.origin === 'https://www.gstatic.com';
  const isLucide = url.origin === 'https://unpkg.com';
  const isGoogleImg = url.origin.includes('googleusercontent.com');

  if (isLocal || isFirebase || isLucide || isGoogleImg) {
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            const resClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
            return response;
          })
          .catch(() => caches.match('index.html'))
      );
      return;
    }

    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          }
          return networkResponse;
        }).catch(() => {});
        return cachedResponse || fetchPromise;
      })
    );
  }
});
