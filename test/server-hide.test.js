'use strict';

// help.js is pure DOM wiring (document.getElementById/createElement/innerHTML, no logic of its
// own) — out of scope, same as ui.js/app.js/connect.js. server-hide.js has real logic
// (isServerHidden/setServerHidden + the fetch-interceptor installer) despite touching
// window.fetch, so it's covered here.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorageMock } from './helpers/mock-browser.js';
import { isServerHidden, setServerHidden, installServerHideInterceptor } from '../js/server-hide.js';

beforeEach(() => {
  installLocalStorageMock();
});

describe('server-hide.js:isServerHidden / setServerHidden', () => {
  it('defaults to not hidden, and round-trips through localStorage', () => {
    assert.equal(isServerHidden(), false);
    setServerHidden(true);
    assert.equal(isServerHidden(), true);
    setServerHidden(false);
    assert.equal(isServerHidden(), false);
    assert.equal(localStorage.getItem('racemaster-server-hidden'), null); // key removed, not just falsy
  });
});

// installServerHideInterceptor() guards against re-wrapping with a module-level `installed`
// flag that has no reset export, so it only ever actually wraps window.fetch once for this
// module's whole lifetime — both states (hidden and not) have to be exercised against that
// same one installation within a single test, not split across separate tests/window objects.
describe('server-hide.js:installServerHideInterceptor', () => {
  it('passes fetch through while not hidden, then rejects every call once hidden — without ever calling the real fetch', async () => {
    let realFetchCalls = 0;
    globalThis.window = { fetch: async (...args) => { realFetchCalls++; return { ok: true, args }; } };
    installServerHideInterceptor();

    const res = await window.fetch('/api/ping');
    assert.equal(realFetchCalls, 1);
    assert.equal(res.ok, true);

    setServerHidden(true);
    await assert.rejects(() => window.fetch('/api/ping'), TypeError);
    assert.equal(realFetchCalls, 1); // unchanged — the real fetch was never attempted this time
  });
});
