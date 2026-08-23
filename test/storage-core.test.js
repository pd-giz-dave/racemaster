'use strict';

// flushPendingMobileFiles is covered in test/storage-mobile.test.js — this file covers the rest of
// js/storage.js. downloadCSV is deliberately not covered — it's pure DOM/Blob wiring
// (document.createElement, URL.createObjectURL), no logic of its own beyond formatCSV
// (already tested in test/csv.test.js).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorageMock, installFetchMock, installWindowMock, jsonResponse, flushMicrotasks } from './helpers/mock-browser.js';

const storage = await import('../js/storage.js');

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
});

describe('storage.js:session management', () => {
  it('getSession requires both a token and a dataset', () => {
    assert.equal(storage.getSession(), null);
    localStorage.setItem('racemaster-token', 't');
    assert.equal(storage.getSession(), null); // dataset still missing
    storage.setSession('tok', 'me/race');
    assert.deepEqual(storage.getSession(), { token: 'tok', dataset: 'me/race' });
  });

  it('setSession clears standalone mode; clearSession removes token+dataset only', () => {
    storage.setStandalone(true);
    storage.setSession('tok', 'me/race');
    assert.equal(storage.isStandalone(), false);
    storage.setUsername('dave');
    storage.clearSession();
    assert.equal(storage.getSession(), null);
    assert.equal(storage.getUsername(), 'dave'); // clearSession doesn't touch credentials
  });

  it('clearCredentials removes username and admin flag', () => {
    storage.setUsername('dave');
    storage.setIsAdmin(true);
    storage.clearCredentials();
    assert.equal(storage.getUsername(), '');
    assert.equal(storage.getIsAdmin(), false);
  });

  it('getUsername/getIsAdmin default to empty/false when unset', () => {
    assert.equal(storage.getUsername(), '');
    assert.equal(storage.getIsAdmin(), false);
  });

  it('isStandalone/setStandalone round-trip, false removes the key entirely', () => {
    storage.setStandalone(true);
    assert.equal(storage.isStandalone(), true);
    storage.setStandalone(false);
    assert.equal(storage.isStandalone(), false);
    assert.equal(localStorage.getItem('racemaster-standalone'), null);
  });

  it('isDirty reflects the dirty flag literally', () => {
    assert.equal(storage.isDirty(), false);
    localStorage.setItem('racemaster-dirty', 'true');
    assert.equal(storage.isDirty(), true);
  });

  it('getVersion reads _version from the cache, 0 if absent', () => {
    assert.equal(storage.getVersion(), 0);
    localStorage.setItem('racemaster-data', JSON.stringify({ _version: 7 }));
    assert.equal(storage.getVersion(), 7);
  });

  it('hasCachedData is true only when some table in the cache is a non-empty array', () => {
    assert.equal(storage.hasCachedData(), false);
    localStorage.setItem('racemaster-data', JSON.stringify({ entries: [] }));
    assert.equal(storage.hasCachedData(), false);
    localStorage.setItem('racemaster-data', JSON.stringify({ entries: [{ bibNumber: '1' }] }));
    assert.equal(storage.hasCachedData(), true);
  });
});

describe('storage.js:readTable / writeTable / dumpState', () => {
  it('readTable returns [] for a missing/non-array table', async () => {
    assert.deepEqual(await storage.readTable('entries'), []);
    localStorage.setItem('racemaster-data', JSON.stringify({ entries: 'not an array' }));
    assert.deepEqual(await storage.readTable('entries'), []);
  });

  it('writeTable saves to the cache immediately, marks dirty, and round-trips through readTable', async () => {
    await storage.writeTable('entries', [{ bibNumber: '1' }]);
    assert.equal(storage.isDirty(), true);
    assert.deepEqual(await storage.readTable('entries'), [{ bibNumber: '1' }]);
  });

  it('dumpState returns the whole cache object', async () => {
    await storage.writeTable('entries', [{ bibNumber: '1' }]);
    assert.deepEqual(storage.dumpState(), { entries: [{ bibNumber: '1' }] });
  });
});

describe('storage.js:restoreState', () => {
  it('replaces the cache, marks dirty, and force-pushes to the server', async (t) => {
    storage.setSession('tok', 'me/race');
    const fetchMock = installFetchMock(() => jsonResponse({ version: 2 }));
    await storage.restoreState({ entries: [{ bibNumber: '1' }] });
    assert.deepEqual(storage.dumpState().entries, [{ bibNumber: '1' }]);
    assert.equal(fetchMock.calls.length, 1);
    assert.match(fetchMock.calls[0].url, /force=true/);
    assert.equal(storage.isDirty(), false); // synced immediately (restoreState awaits the push)
  });
});

describe('storage.js:discardConflict', () => {
  it('clears the dirty flag (conflict-resolution escape hatch)', () => {
    localStorage.setItem('racemaster-dirty', 'true');
    storage.discardConflict();
    assert.equal(storage.isDirty(), false);
    assert.equal(storage.isConflicted(), false);
  });
});

describe('storage.js:restoreDirectory', () => {
  it('standalone (no session) returns true immediately, using the cache as-is', async () => {
    const result = await storage.restoreDirectory();
    assert.equal(result, true);
  });

  it('pulls fresh state from the server when not dirty', async () => {
    storage.setSession('tok', 'me/race');
    installFetchMock(() => jsonResponse({ entries: [{ bibNumber: '9' }] }));
    const result = await storage.restoreDirectory();
    assert.equal(result, true);
    assert.deepEqual(storage.dumpState().entries, [{ bibNumber: '9' }]);
  });

  it('clears the session on a 401 (expired token), falling back to the cache', async () => {
    storage.setSession('tok', 'me/race');
    // jsonResponse's `ok` flag alone doesn't carry a status code, so build the 401 shape directly.
    installFetchMock(() => ({ ok: false, status: 401, json: async () => ({}) }));
    await storage.restoreDirectory();
    assert.equal(storage.getSession(), null);
  });

  it('falls back to the cache (returns false) when the server is unreachable', async () => {
    storage.setSession('tok', 'me/race');
    installFetchMock(() => { throw new Error('offline'); });
    const result = await storage.restoreDirectory();
    assert.equal(result, false);
    assert.equal(storage.getSession() !== null, true); // session preserved, not cleared, on network error
  });

  it('pushes pending local changes first when dirty, and does not overwrite them on a 409 conflict', async () => {
    storage.setSession('tok', 'me/race');
    await storage.writeTable('entries', [{ bibNumber: 'local-only' }]); // marks dirty
    installFetchMock(() => ({ ok: false, status: 409, json: async () => ({}) }));
    const result = await storage.restoreDirectory();
    assert.equal(result, true);
    assert.equal(storage.isConflicted(), true);
    // Must NOT have fallen through to a GET that would overwrite the local edit.
    assert.deepEqual(storage.dumpState().entries, [{ bibNumber: 'local-only' }]);
  });
});

describe('storage.js:switchDataset', () => {
  it('sets the session and, by default, discards the local cache before fetching', async () => {
    await storage.writeTable('entries', [{ bibNumber: 'old-dataset' }]);
    installFetchMock(() => jsonResponse({ entries: [{ bibNumber: 'new-dataset' }] }));
    await storage.switchDataset('tok', 'me', 'race2-private');
    assert.deepEqual(storage.getSession(), { token: 'tok', dataset: 'me/race2-private' });
    assert.deepEqual(storage.dumpState().entries, [{ bibNumber: 'new-dataset' }]);
  });

  it('with pushFirst, keeps (and pushes) the local cache instead of discarding it', async () => {
    await storage.writeTable('entries', [{ bibNumber: 'unsynced' }]);
    const fetchMock = installFetchMock(() => jsonResponse({ entries: [{ bibNumber: 'unsynced' }] }));
    await storage.switchDataset('tok', 'me', 'race2-private', { pushFirst: true });
    // dirty -> restoreDirectory's own push-first branch fires a PUT before the GET
    assert.ok(fetchMock.calls.some(c => c.opts.method === 'PUT'));
  });
});

describe('storage.js:representative API wrappers', () => {
  it('apiLogin posts credentials and returns the parsed response', async () => {
    const fetchMock = installFetchMock(() => jsonResponse({ token: 'tok', username: 'dave' }));
    const r = await storage.apiLogin('dave', 'pw');
    assert.deepEqual(r, { token: 'tok', username: 'dave' });
    assert.equal(fetchMock.calls[0].url, '/api/auth/login');
    assert.deepEqual(JSON.parse(fetchMock.calls[0].opts.body), { username: 'dave', password: 'pw' });
  });

  it('apiListDatasets/apiListMobileFiles return [] on a non-ok response instead of throwing', async () => {
    installFetchMock(() => ({ ok: false, json: async () => ({ error: 'nope' }) }));
    assert.deepEqual(await storage.apiListDatasets('tok'), []);
    assert.deepEqual(await storage.apiListMobileFiles('tok'), []);
  });

  it('apiReadDataset throws on a non-ok response instead of returning an error shape', async () => {
    installFetchMock(() => ({ ok: false, status: 404, json: async () => ({}) }));
    await assert.rejects(() => storage.apiReadDataset('tok', 'me', 'race'), /HTTP 404/);
  });

  it('apiDeleteDataset sends a DELETE with an auth header', async () => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    await storage.apiDeleteDataset('tok', 'me', 'race-private');
    assert.equal(fetchMock.calls[0].opts.method, 'DELETE');
    assert.equal(fetchMock.calls[0].opts.headers['Authorization'], 'Bearer tok');
  });
});

describe('storage.js:saveAsDataset', () => {
  it('creates the dataset, then force-pushes the current cache into it', async () => {
    await storage.writeTable('entries', [{ bibNumber: '1' }]);
    const calls = [];
    installFetchMock((url, opts) => {
      calls.push(url);
      if (url === '/api/datasets') return jsonResponse({ fullName: 'race-private' });
      return jsonResponse({ ok: true });
    });
    const r = await storage.saveAsDataset('tok', 'me', 'race', 'private');
    assert.equal(r.fullName, 'race-private');
    assert.equal(calls[1], '/api/data/me/race-private?force=true');
  });

  it('stops and returns the error if dataset creation itself fails', async () => {
    installFetchMock(() => jsonResponse({ error: 'name taken' }));
    const r = await storage.saveAsDataset('tok', 'me', 'race', 'private');
    assert.equal(r.error, 'name taken');
  });

  it('reports a distinct error when creation succeeds but the push fails', async () => {
    installFetchMock((url) => url === '/api/datasets'
      ? jsonResponse({ fullName: 'race-private' })
      : jsonResponse({}, { ok: false }));
    const r = await storage.saveAsDataset('tok', 'me', 'race', 'private');
    assert.match(r.error, /push failed/);
  });
});

describe('storage.js:debounced sync to server (via writeTable)', () => {
  it('syncs to the server ~2s after a write, when reachable', async (t) => {
    storage.setSession('tok', 'me/race');
    const fetchMock = installFetchMock(() => jsonResponse({ version: 3 }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    await storage.writeTable('entries', [{ bibNumber: '1' }]);
    assert.equal(storage.isDirty(), true);
    t.mock.timers.tick(2000);
    await flushMicrotasks(); // let the full syncToServer -> fetchTimed -> res.json() chain settle

    assert.equal(fetchMock.calls.length, 1);
    assert.equal(fetchMock.calls[0].opts.method, 'PUT');
    assert.equal(storage.isDirty(), false);
    assert.equal(storage.getVersion(), 3);
  });

  it('a second write within the debounce window resets the timer rather than firing twice', async (t) => {
    storage.setSession('tok', 'me/race');
    const fetchMock = installFetchMock(() => jsonResponse({ version: 1 }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    await storage.writeTable('entries', [{ bibNumber: '1' }]);
    t.mock.timers.tick(1000);
    await storage.writeTable('entries', [{ bibNumber: '1' }, { bibNumber: '2' }]); // resets the debounce
    t.mock.timers.tick(1000); // total 2000ms since first write, but only 1000ms since second
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 0);

    t.mock.timers.tick(1000); // now 2000ms since the second write
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 1);
  });
});
