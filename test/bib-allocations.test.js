'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installFetchMock, installWindowMock, jsonResponse, flushMicrotasks } from './helpers/mock-browser.js';
import { startBibAllocationsSync } from '../js/bib-allocations.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  localStorage.setItem('racemaster-token', 'tok');
  localStorage.setItem('racemaster-dataset', 'me/race');
  state.event   = { name: 'Test Fell Race', date: '15/06/2026' };
  state.entries = [{ bibNumber: '1', name: 'Dave', course: 'Seniors' }];
});

// pushBibAllocations/schedulePush/deriveRaceLabel/buildPayload are all module-private — the
// only way to exercise them is through this one exported entry point. Uses node:test's fake
// timers so the 2s debounce doesn't actually make the test suite slower.
describe('bib-allocations.js:startBibAllocationsSync', () => {
  it('pushes bib allocations (derived race label + entries payload) after the debounce', async (t) => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startBibAllocationsSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks(); // let the now-fired timer's async pushBibAllocations() run

    assert.equal(fetchMock.calls.length, 1);
    // sanitiseName strips spaces entirely (not to hyphens) and lowercases. Owner ("me") comes
    // from session.dataset's own owner half — not necessarily the logged-in user. Label suffix
    // is yy-mm-dd (2-digit year first), matching a phone's own raceLabel convention — not the
    // dd/mm/yyyy order state.event.date itself is stored in.
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/me\/testfellrace-26-06-15\/bib-allocations/);
    const body = JSON.parse(fetchMock.calls[0].opts.body);
    assert.equal(body.raceName, 'Test Fell Race');
    assert.deepEqual(body.entries, [{ bibNumber: 1, name: 'Dave', course: 'Seniors', category: '' }]);
  });

  it('includes each entry\'s category when set', async (t) => {
    state.entries = [{ bibNumber: '1', name: 'Dave', course: 'Seniors', category: 'MSEN' }];
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startBibAllocationsSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    const body = JSON.parse(fetchMock.calls[0].opts.body);
    assert.deepEqual(body.entries, [{ bibNumber: 1, name: 'Dave', course: 'Seniors', category: 'MSEN' }]);
  });

  it('derives the race label as yy-mm-dd, not the event date\'s own dd/mm/yyyy order — a label of "race-26-06-15" reads as 2026-06-15, not 2015-06-26 or a nonsense future date', async (t) => {
    state.event = { name: 'Race', date: '05/12/2026' }; // 5 Dec 2026
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startBibAllocationsSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.match(fetchMock.calls[0].url, /\/race-26-12-05\/bib-allocations/);
  });

  it('uses the dataset\'s own owner, not the logged-in username, when they differ (e.g. an admin working on someone else\'s dataset)', async (t) => {
    localStorage.setItem('racemaster-username', 'admin-user');
    localStorage.setItem('racemaster-dataset', 'someone-else/race');
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startBibAllocationsSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 1);
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/someone-else\/testfellrace-26-06-15\/bib-allocations/);
  });

  it('re-pushes on a racemaster-dirty-change event, debounced', async (t) => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startBibAllocationsSync();
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

    startBibAllocationsSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 0);
  });

  it('does nothing when signed out', async (t) => {
    localStorage.removeItem('racemaster-token');
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startBibAllocationsSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 0);
  });
});
