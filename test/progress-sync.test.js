'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installFetchMock, installWindowMock, jsonResponse, flushMicrotasks } from './helpers/mock-browser.js';
import { startProgressSync } from '../js/progress-sync.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  localStorage.setItem('racemaster-token', 'tok');
  localStorage.setItem('racemaster-dataset', 'me/race');
  state.event            = { name: 'Test Fell Race', date: '15/06/2026' };
  state.entries          = [{ bibNumber: '1', name: 'Dave', course: 'Seniors', category: 'MSEN' }];
  state.mobileProgress   = [{ action: 'Start', number: '1', time: '00:00:00' }, { action: 'Finish', number: '1', time: '00:45:00' }];
  state.mobileCheckpoints = [{ bibNumber: '1', cpTimes: { 1: '00:10:00' } }];
});

// pushProgress/schedulePush/buildPayload/deriveRaceLabel are all module-private — the only way
// to exercise them is through this one exported entry point.
describe('progress-sync.js:startProgressSync', () => {
  it('pushes progress (derived race label + buildProgressRows() entries) after the debounce', async (t) => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 1);
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/me\/testfellrace-26-06-15\/progress/);
    const body = JSON.parse(fetchMock.calls[0].opts.body);
    assert.equal(body.raceName, 'Test Fell Race');
    assert.deepEqual(body.entries, [{
      bibNumber: 1, name: 'Dave', category: 'MSEN', course: 'Seniors',
      startTime: '00:00:00', finishTime: '00:45:00', cpTimes: { 1: '00:10:00' },
    }]);
  });

  it('uses the dataset\'s own owner, not the logged-in username, when they differ (e.g. an admin working on someone else\'s dataset)', async (t) => {
    localStorage.setItem('racemaster-username', 'admin-user');
    localStorage.setItem('racemaster-dataset', 'someone-else/race');
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 1);
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/someone-else\/testfellrace-26-06-15\/progress/);
  });

  it('re-pushes on a racemaster-dirty-change event, debounced', async (t) => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 1);

    window.dispatchEvent(new CustomEvent('racemaster-dirty-change'));
    t.mock.timers.tick(2000);
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 2);
  });

  it('does nothing once no event name/date is set (no derivable race label)', async (t) => {
    state.event = { name: '', date: '' };
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 0);
  });

  // buildProgressRows() pre-populates a row per entry (see mobile-files-progress.js) — matching
  // the former Bib Allocations tab's own "push whenever entries exist" threshold — so this only
  // stays a no-op when there are truly no entries and no mobile-recorded activity either.
  it('does nothing when there are no entries and no progress rows at all', async (t) => {
    state.entries = [];
    state.mobileProgress = [];
    state.mobileCheckpoints = [];
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 0);
  });

  it('pushes as soon as an entry exists, even with no mobile-recorded activity at all', async (t) => {
    state.mobileProgress = [];
    state.mobileCheckpoints = [];
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 1);
    const body = JSON.parse(fetchMock.calls[0].opts.body);
    assert.deepEqual(body.entries, [{
      bibNumber: 1, name: 'Dave', category: 'MSEN', course: 'Seniors',
      startTime: '', finishTime: '', cpTimes: {},
    }]);
  });

  it('does nothing when signed out', async (t) => {
    localStorage.removeItem('racemaster-token');
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 0);
  });
});
