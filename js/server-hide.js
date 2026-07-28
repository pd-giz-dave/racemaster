'use strict';

// Testing facility (Datasets page's "Hide Server" toggle) — lets you simulate the server
// being completely unreachable, exactly as it would be out on the course with no signal, so
// offline behaviour (cached data, the local sync queue, Bluetooth pulls into Mobile Files)
// can be verified without actually needing to go find somewhere with no signal.
//
// Implemented by wrapping window.fetch once, globally, rather than touching every individual
// api* function — every fetch() call this app makes, in any module, present or future, goes
// through the same wrapper with nothing to remember to route through it specially. A hidden
// fetch rejects the exact same way a real network outage does (fetch's own TypeError), so
// every existing "server unreachable" code path is exercised completely unmodified.

const HIDDEN_KEY = 'racemaster-server-hidden';
let installed = false;

export function isServerHidden() {
  return localStorage.getItem(HIDDEN_KEY) === 'true';
}

export function setServerHidden(hidden) {
  if (hidden) localStorage.setItem(HIDDEN_KEY, 'true');
  else localStorage.removeItem(HIDDEN_KEY);
}

export function installServerHideInterceptor() {
  if (installed) return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    if (isServerHidden()) return Promise.reject(new TypeError('Failed to fetch (server hidden for testing)'));
    return realFetch(...args);
  };
}
