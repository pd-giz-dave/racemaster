'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorageMock, installFetchMock, jsonResponse } from './helpers/mock-browser.js';

// storage.js reads localStorage/fetch at call time (not at import time), so the mocks just need
// to be in place before each call — no need to re-import the module between tests.
const storage = await import('../js/storage.js');

function signIn({ username = 'me' } = {}) {
  localStorage.setItem('racemaster-token', 'tok');
  localStorage.setItem('racemaster-dataset', 'me/race');
  localStorage.setItem('racemaster-username', username);
}

function seedPending(files) {
  localStorage.setItem('racemaster-pending-mobile', JSON.stringify(files));
}

describe('storage.js:flushPendingMobileFiles', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it('pushes and clears only the signed-in user\'s pending files', async () => {
    signIn({ username: 'me' });
    seedPending([
      { owner: 'me',           raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ recordUuid: '1' }] },
      { owner: 'me',           raceLabel: 'r2', deviceName: 'PhoneB', deviceId: 'b', lines: [{ recordUuid: '2' }] },
      { owner: 'someone-else', raceLabel: 'r3', deviceName: 'PhoneC', deviceId: 'c', lines: [] },
    ]);
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));

    await storage.flushPendingMobileFiles();

    assert.equal(fetchMock.calls.length, 2);
    assert.deepEqual(fetchMock.calls.map(c => c.url), ['/api/mobile/r1', '/api/mobile/r2']);
    const remaining = storage.getPendingMobileFiles();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].owner, 'someone-else');
  });

  it('a file the server rejects with {error} stays queued for the next attempt', async () => {
    signIn();
    seedPending([{ owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ recordUuid: '1' }] }]);
    installFetchMock(() => jsonResponse({ error: 'bad payload' }));

    await storage.flushPendingMobileFiles();

    assert.equal(storage.getPendingMobileFiles().length, 1);
  });

  it('a network error mid-flush stops immediately, leaving everything queued for the next tick', async () => {
    signIn();
    seedPending([
      { owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ recordUuid: '1' }] },
      { owner: 'me', raceLabel: 'r2', deviceName: 'PhoneB', deviceId: 'b', lines: [{ recordUuid: '2' }] },
    ]);
    let calls = 0;
    installFetchMock(() => { calls++; throw new Error('offline'); });

    await storage.flushPendingMobileFiles();

    assert.equal(calls, 1); // bailed after the first failure rather than trying the second
    assert.equal(storage.getPendingMobileFiles().length, 2);
  });

  it('does nothing when signed out', async () => {
    seedPending([{ owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ recordUuid: '1' }] }]);
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));

    await storage.flushPendingMobileFiles();

    assert.equal(fetchMock.calls.length, 0);
    assert.equal(storage.getPendingMobileFiles().length, 1);
  });

  it('does nothing when the pending queue is empty (no network call at all)', async () => {
    signIn();
    seedPending([]);
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));

    await storage.flushPendingMobileFiles();

    assert.equal(fetchMock.calls.length, 0);
  });
});