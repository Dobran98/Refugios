/**
 * ============================================================
 *  REFUGIOS PWA — Service Worker
 *  Cachea todos los archivos para funcionamiento offline total
 * ============================================================
 */

const CACHE_NAME = 'refugios-pwa-v1';

// Archivos críticos a cachear para funcionamiento offline
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './api.js',
  './db.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Librerías CDN (descargadas localmente)
  './libs/chart.umd.min.js',
  './libs/xlsx.full.min.js',
  './libs/material-icons.css',
  './libs/inter-font.css',
  './libs/inter-300.woff2',
  './libs/inter-400.woff2',
  './libs/inter-500.woff2',
  './libs/inter-600.woff2',
  './libs/inter-700.woff2',
];

// ─── INSTALACIÓN ───────────────────────────────────────────

self.addEventListener('install', event => {
  console.log('[SW] Instalando Service Worker v1');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando assets...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Error al cachear:', err))
  );
});

// ─── ACTIVACIÓN ────────────────────────────────────────────

self.addEventListener('activate', event => {
  console.log('[SW] Activando Service Worker');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Eliminando caché antigua:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ─── INTERCEPCIÓN DE PETICIONES ────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // No interceptar peticiones al servidor GAS (deben ir a la red)
  if (url.hostname.includes('script.google.com') || 
      url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Estrategia: Cache primero, red como fallback
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // No está en caché, intentar la red
        return fetch(event.request)
          .then(networkResponse => {
            // Guardar en caché para futuras visitas
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Sin red y sin caché: retornar página de error offline
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// ─── MENSAJES ──────────────────────────────────────────────

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
