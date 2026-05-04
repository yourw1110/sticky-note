const CACHE_NAME = 'sticky-note-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './icon.svg',
  './manifest.json',
  'https://unpkg.com/lucide@latest',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=Noto+Sans+JP:wght@300;400;700&display=swap'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
