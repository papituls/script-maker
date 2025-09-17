const CACHE_NAME = 'script-maker-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMwM.woff2' // Tambahkan font yang digunakan
];

// Instalasi Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.error('Failed to cache during install:', err))
  );
});

// Aktivasi Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      );
    })
  );
});

// Fetch event (menangkap permintaan jaringan)
self.addEventListener('fetch', event => {
  // Hanya cache navigasi dan aset statis.
  // JANGAN cache panggilan API (Apps Script)
  const requestUrl = new URL(event.request.url);

  // Exclude external API calls from caching
  if (requestUrl.hostname === 'script.google.com' || requestUrl.hostname === 'generativelanguage.googleapis.com') {
    return fetch(event.request); // Langsung ambil dari jaringan, jangan cache
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        // Jika tidak ada di cache, ambil dari jaringan
        return fetch(event.request)
          .then(networkResponse => {
            // Cek apakah response valid untuk di-cache
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            // Klon response karena body hanya bisa dikonsumsi sekali
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            return networkResponse;
          })
          .catch(error => {
            console.error('Fetch failed for:', event.request.url, error);
            // Anda bisa mengembalikan fallback page di sini jika offline
            // return caches.match('/offline.html');
          });
      })
  );
});
