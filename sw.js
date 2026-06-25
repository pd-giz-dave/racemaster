'use strict';

// auto updated if anything changes
const CACHE = 'racemaster-20260625145805';

// auto computed when the server sees a request for this file
const PRECACHE = [];

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