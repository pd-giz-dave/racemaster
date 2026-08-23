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

// state.js's save*() functions (saveEntries, savePeople, ...) go through storage.js's
// writeTable(), which fires a `window.dispatchEvent(new CustomEvent(...))` on every write
// (notifyDirty()). Node has no `window`; without this, that call throws inside writeTable's
// own try/catch and just logs a console.warn on every save — harmless but noisy. Node's
// built-in EventTarget gives real addEventListener/dispatchEvent semantics for free.
export function installWindowMock() {
  globalThis.window = new EventTarget();
  return globalThis.window;
}

// For tests using node:test's fake timers (t.mock.timers.enable/tick) against code with a
// multi-await chain after the timer fires (e.g. writeTable's debounced syncToServer(), which
// awaits fetchTimed() which awaits fetch() then awaits res.json()) — a fixed number of chained
// `await Promise.resolve()` calls is fragile since it has to exactly match the chain's depth.
// setImmediate is a real (unmocked) macrotask, so it only fires once the entire microtask queue
// from the timer callback has drained, regardless of how deep that chain is.
export function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

// Node (21+) defines its own global `navigator` (e.g. navigator.userAgent) as a getter-only
// accessor property — a plain `globalThis.navigator = {...}` throws "Cannot set property
// navigator ... which has only a getter" in strict-mode ES modules. It's configurable, so
// redefine it outright instead. `delete globalThis.navigator` still works fine to remove it.
export function installNavigatorMock(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  return globalThis.navigator;
}