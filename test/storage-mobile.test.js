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

describe('storage.js:savePendingMobileFile', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it('append-merges into an existing pending entry, deduped by lineNumber', () => {
    seedPending([{ owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ lineNumber: 1 }], pulledAt: '2026-01-01T00:00:00.000Z' }]);

    storage.savePendingMobileFile('me', 'r1', 'PhoneA', 'a', [{ lineNumber: 1 }, { lineNumber: 2 }]);

    const [entry] = storage.getPendingMobileFiles();
    assert.deepEqual(entry.lines.map(l => l.lineNumber), [1, 2]);
  });

  it('a NewRace marker replaces the whole pending entry instead of merging with stale content', () => {
    // The pending entry here is from a different, since-superseded race that happened to reuse
    // the same label — merging would leave its stale rows sitting alongside the new race's.
    seedPending([{ owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ action: 'Reset', lineNumber: 1 }], pulledAt: '2026-01-01T00:00:00.000Z' }]);

    storage.savePendingMobileFile('me', 'r1', 'PhoneA', 'a', [{ action: 'NewRace', lineNumber: 1 }, { action: 'Stop', lineNumber: 2 }]);

    const [entry] = storage.getPendingMobileFiles();
    assert.deepEqual(entry.lines.map(l => l.action), ['NewRace', 'Stop']);
  });

  it('a NewRace marker with no existing pending entry just creates one normally', () => {
    storage.savePendingMobileFile('me', 'r1', 'PhoneA', 'a', [{ action: 'NewRace', lineNumber: 1 }]);

    const [entry] = storage.getPendingMobileFiles();
    assert.equal(entry.lines.length, 1);
  });
});

describe('storage.js:flushPendingMobileFiles', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it('pushes and clears only the signed-in user\'s pending files', async () => {
    signIn({ username: 'me' });
    seedPending([
      { owner: 'me',           raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ lineNumber: 1 }] },
      { owner: 'me',           raceLabel: 'r2', deviceName: 'PhoneB', deviceId: 'b', lines: [{ lineNumber: 2 }] },
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
    seedPending([{ owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ lineNumber: 1 }] }]);
    installFetchMock(() => jsonResponse({ error: 'bad payload' }));

    await storage.flushPendingMobileFiles();

    assert.equal(storage.getPendingMobileFiles().length, 1);
  });

  it('a network error mid-flush stops immediately, leaving everything queued for the next tick', async () => {
    signIn();
    seedPending([
      { owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ lineNumber: 1 }] },
      { owner: 'me', raceLabel: 'r2', deviceName: 'PhoneB', deviceId: 'b', lines: [{ lineNumber: 2 }] },
    ]);
    let calls = 0;
    installFetchMock(() => { calls++; throw new Error('offline'); });

    await storage.flushPendingMobileFiles();

    assert.equal(calls, 1); // bailed after the first failure rather than trying the second
    assert.equal(storage.getPendingMobileFiles().length, 2);
  });

  it('does nothing when signed out', async () => {
    seedPending([{ owner: 'me', raceLabel: 'r1', deviceName: 'PhoneA', deviceId: 'a', lines: [{ lineNumber: 1 }] }]);
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