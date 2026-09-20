'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installFetchMock, installWindowMock, jsonResponse, flushMicrotasks } from './helpers/mock-browser.js';
import { startProgressSync, pushProgressNow, resetProgressPushCacheForTests } from '../js/progress-sync.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  // The delta-push cache (see progress-sync.js's own doc) is in-memory, not localStorage, so
  // installLocalStorageMock() alone doesn't reset it between tests — every test here otherwise
  // assumes a full "nothing pushed yet" push, same as a fresh page load.
  resetProgressPushCacheForTests();
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
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/me\/testfellrace-seniors-26-06-15\/progress/);
    const body = JSON.parse(fetchMock.calls[0].opts.body);
    assert.equal(body.raceName, 'Test Fell Race');
    assert.deepEqual(body.entries, [{
      bibNumber: 1, name: 'Dave', category: 'MSEN', course: 'Seniors',
      startTime: '00:00:00', finishTime: '00:45:00', cpTimes: { 1: '00:10:00' }, cpTimesOfDay: {},
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
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/someone-else\/testfellrace-seniors-26-06-15\/progress/);
  });

  // The actual fix this session's "progress file is not getting to the server" report led to:
  // progress itself has no course of its own (one event covers Seniors AND Juniors at once), but
  // a phone's own race folder does from the moment a course is chosen at Start time — pushing one
  // combined progress.json to a single course-less label never actually landed where a
  // course-assigned phone looks for it. Pushed instead as one course-filtered payload per course,
  // each to that course's own race label — and a course with no entries at all gets no push,
  // rather than an empty one nobody needs.
  it('pushes each course separately, to that course\'s own race label, when both have entries', async (t) => {
    // Juniors only counts as "in use" (coursesInUse(), categories.js) once Event Settings
    // actually configures a junior age limit — without this, both bibs below would correctly
    // sweep into the one Seniors course instead (see the "all in one course" test further down).
    state.event.juniorLimit = 'U18';
    state.entries = [
      { bibNumber: '1', name: 'Dave', course: 'Seniors', category: 'MSEN' },
      { bibNumber: '2', name: 'Amy',  course: 'Juniors', category: 'U16' },
    ];
    state.mobileProgress = [];
    state.mobileCheckpoints = [];
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 2);
    const seniorsCall = fetchMock.calls.find(c => c.url.includes('-seniors-'));
    const juniorsCall = fetchMock.calls.find(c => c.url.includes('-juniors-'));
    assert.match(seniorsCall.url, /\/api\/mobile\/me\/testfellrace-seniors-26-06-15\/progress/);
    assert.match(juniorsCall.url, /\/api\/mobile\/me\/testfellrace-juniors-26-06-15\/progress/);
    assert.deepEqual(JSON.parse(seniorsCall.opts.body).entries.map(e => e.bibNumber), [1]);
    assert.deepEqual(JSON.parse(juniorsCall.opts.body).entries.map(e => e.bibNumber), [2]);
  });

  it('re-pushes on a racemaster-dirty-change event that actually changes something, debounced', async (t) => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 1);

    // A dirty-change with no actual data change behind it must NOT trigger a second network
    // call at all — that's the whole point of pushing deltas rather than the full state every
    // time (see progress-sync.js's own diffEntries doc). Only once something genuinely differs
    // (a new checkpoint time here) does the next debounce actually push again.
    window.dispatchEvent(new CustomEvent('racemaster-dirty-change'));
    t.mock.timers.tick(2000);
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 1);

    state.mobileCheckpoints = [{ bibNumber: '1', cpTimes: { 1: '00:10:00', 2: '00:20:00' } }];
    window.dispatchEvent(new CustomEvent('racemaster-dirty-change'));
    t.mock.timers.tick(2000);
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 2);
    assert.deepEqual(JSON.parse(fetchMock.calls[1].opts.body).entries[0].cpTimes, { 1: '00:10:00', 2: '00:20:00' });
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
  // stays a no-op when there are truly no entries and no mobile-recorded activity either. Not
  // forced through even as a course's first push of the session: server/mobile.js's own
  // mergeProgress() deliberately refuses to create a progress.json from an empty delta with
  // nothing already on disk (so a stray "Clear previous event" or an idle empty dataset never
  // spawns one) — Activate Race (touchProgress()) is the one deliberate action that creates a
  // file from nothing, not this background auto-push.
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

  // The other half of the same story: with no junior age limit configured at all, there's only
  // ever one course (coursesInUse()), so even a bib whose own stored `course` field happens to
  // say 'Juniors' (stale from before the limit was removed, say) still lands in the one Seniors
  // push — never silently dropped, and never causing a separate (pointless) Juniors push either.
  it('sweeps every entry into the one Seniors push when no junior age limit is configured, regardless of their own course field', async (t) => {
    state.entries = [
      { bibNumber: '1', name: 'Dave', course: 'Seniors', category: 'MSEN' },
      { bibNumber: '2', name: 'Amy',  course: 'Juniors', category: 'U16' },
    ];
    state.mobileProgress = [];
    state.mobileCheckpoints = [];
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 1);
    assert.match(fetchMock.calls[0].url, /\/api\/mobile\/me\/testfellrace-seniors-26-06-15\/progress/);
    assert.deepEqual(JSON.parse(fetchMock.calls[0].opts.body).entries.map(e => e.bibNumber), [1, 2]);
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
      startTime: '', finishTime: '', cpTimes: {}, cpTimesOfDay: {},
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

  it('reports a deleted entry as `removed`, and still pushes even though `entries` is now empty', async (t) => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync();
    t.mock.timers.tick(2000);
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 1);
    assert.deepEqual(JSON.parse(fetchMock.calls[0].opts.body).removed, []);

    state.entries = []; // bib 1 deleted from Entries entirely
    state.mobileProgress = [];
    state.mobileCheckpoints = [];
    window.dispatchEvent(new CustomEvent('racemaster-dirty-change'));
    t.mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(fetchMock.calls.length, 2);
    const body = JSON.parse(fetchMock.calls[1].opts.body);
    assert.deepEqual(body.entries, []);
    assert.deepEqual(body.removed, [1]);
  });
});

// pushProgressNow — used by Clear Progress so the persisted progress.json reflects an explicit
// clear right away, rather than however long the usual debounce takes to fire (or never, if the
// tab closes/navigates away before it does).
describe('progress-sync.js:pushProgressNow', () => {
  it('pushes immediately, with no debounce wait at all', async () => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));

    await pushProgressNow();

    assert.equal(fetchMock.calls.length, 1);
  });

  it('cancels an already-scheduled debounced push rather than letting both fire', async (t) => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));
    t.mock.timers.enable({ apis: ['setTimeout'] });

    startProgressSync(); // schedules its own initial debounced push
    await pushProgressNow();
    assert.equal(fetchMock.calls.length, 1);

    // The debounce startProgressSync() itself scheduled must not also fire later and double-push.
    t.mock.timers.tick(2000);
    await flushMicrotasks();
    assert.equal(fetchMock.calls.length, 1);
  });

  it('reflects the very latest state, not whatever it was when some earlier debounce was scheduled', async () => {
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));

    state.mobileProgress = [];
    state.mobileCheckpoints = [];
    await pushProgressNow();
    const firstBody = JSON.parse(fetchMock.calls[0].opts.body);
    assert.equal(firstBody.entries[0].finishTime, '');

    state.mobileProgress = [{ action: 'Finish', number: '1', time: '00:45:00' }];
    await pushProgressNow();
    const secondBody = JSON.parse(fetchMock.calls[1].opts.body);
    assert.equal(secondBody.entries[0].finishTime, '00:45:00');
  });

  it('does nothing when signed out, same as the debounced path', async () => {
    localStorage.removeItem('racemaster-token');
    const fetchMock = installFetchMock(() => jsonResponse({ ok: true }));

    await pushProgressNow();

    assert.equal(fetchMock.calls.length, 0);
  });
});
