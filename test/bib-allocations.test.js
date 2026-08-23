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
    // sanitiseName strips spaces entirely (not to hyphens) and lowercases.
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/testfellrace-15-06-26\/bib-allocations/);
    const body = JSON.parse(fetchMock.calls[0].opts.body);
    assert.equal(body.raceName, 'Test Fell Race');
    assert.deepEqual(body.entries, [{ bibNumber: 1, name: 'Dave', course: 'Seniors' }]);
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
