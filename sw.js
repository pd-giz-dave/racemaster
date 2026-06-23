'use strict';

const CACHE = 'racemaster-20260623121149';

const PRECACHE = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/css/app.css',
  '/css/print.css',
  '/js/app.js',
  '/js/connect.js',
  '/js/ui.js',
  '/js/constants.js',
  '/js/csv.js',
  '/js/storage.js',
  '/js/state.js',
  '/js/utils.js',
  '/js/categories.js',
  '/js/time-utils.js',
  '/js/data.js',
  '/js/entries.js',
  '/js/helpers.js',
  '/js/finishers.js',
  '/js/si-entries.js',
  '/js/si-results.js',
  '/js/results.js',
  '/js/forms/preview.js',
  '/js/forms/entry-form.js',
  '/js/forms/entry-form.css',
  '/js/forms/registration-sheet.js',
  '/js/forms/registration-sheet.css',
  '/js/forms/finish-sheet.js',
  '/js/forms/finish-sheet.css',
  '/js/forms/number-matrix.js',
  '/js/forms/number-matrix.css',
  '/js/forms/results.js',
  '/js/forms/results.css',
  '/js/forms/prize-list.js',
  '/js/forms/prize-list.css',
  '/js/views/home.js',
  '/js/views/event.js',
  '/js/views/entries.js',
  '/js/views/helpers.js',
  '/js/views/finishers.js',
  '/js/views/results.js',
  '/js/views/pre-entries.js',
  '/js/views/safety.js',
  '/js/views/people.js',
  '/js/views/clubs.js',
  '/js/views/roles.js',
  '/js/views/dibbers.js',
  '/js/views/categories.js',
  '/js/views/forms.js',
  '/js/views/si-results.js',
  '/js/help.js',
  '/js/locale.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const DEV_MODE = false; // set false for production cache-first behaviour

self.addEventListener('fetch', e => {
  // Only cache GET requests for same origin
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Never cache API requests — auth headers are added by the client and
  // responses must always be fresh from the server
  if (url.pathname.startsWith('/api/')) return;

  // In dev mode: network-first (always fetch fresh, fall back to cache)
  if (DEV_MODE) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') return caches.match('/index.html');
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => {
        // Fallback to index for navigation
        if (e.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});