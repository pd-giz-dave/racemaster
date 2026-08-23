// Minimal in-memory stand-ins for the browser globals a handful of top-level js/*.js modules
// touch (localStorage, fetch) — see storage.js, connect.js, mule-ble.js. Everything else under
// js/ (safety.js, entries.js, finishers.js, si-entries.js, etc.) is plain logic with no browser
// globals at all and needs none of this; import it directly in a test.
'use strict';

// A real localStorage stores/returns strings only — matching that (rather than a plain Map of
// arbitrary values) catches bugs like passing an object where JSON.stringify was expected.
export function installLocalStorageMock() {
  const store = new Map();
  globalThis.localStorage = {
    getItem:    k => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear:      () => store.clear(),
  };
  return globalThis.localStorage;
}

// handler(url, opts) => a Response-shaped object (must at least implement .json() and .ok).
// Records every call in `.calls` so a test can assert on which endpoints were hit and with
// what body, without needing a real server.
export function installFetchMock(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  globalThis.fetch.calls = calls;
  return globalThis.fetch;
}

export function jsonResponse(body, { ok = true } = {}) {
  return { ok, json: async () => body };
}