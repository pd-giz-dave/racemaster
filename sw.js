'use strict';

const CACHE = 'racemaster-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/css/print.css',
  '/js/app.js',
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
  '/js/forms.js',
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
  '/js/views/dibbers.js',
  '/js/views/categories.js',
  '/js/views/view-forms.js',
  '/js/views/si-results.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only cache GET requests for same origin
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

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