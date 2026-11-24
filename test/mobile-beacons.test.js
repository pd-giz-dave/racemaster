'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { isDirty } from '../js/storage.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import { parseDate, timeToSeconds } from '../js/utils.js';
import { computeBeaconCatalogueUpdates, applyBeaconCatalogueUpdates, computeBeaconStatusUpdates, applyBeaconStatusUpdates, applyManualBeaconReturn, toPhoneTimestamp } from '../js/mobile-beacons.js';

// Computed the same way js/mobile-beacons.js's own raceStartMs() does, so test timestamps are
// timezone-agnostic — both sides use the same local-time arithmetic rather than a hardcoded ISO
// instant that would drift relative to "2 hours before the race started" depending on the
// machine's own timezone.
function raceStartMs() {
  return parseDate(state.event.date).getTime() + timeToSeconds(state.event.startTime) * 1000;
}
// "yyyy/MM/dd HH:mm:ss" — the same phone-local-time wire format a device's own Close row carries
// (see js/mobile-files-progress.js's own computeCloseByBeacon) — built from an epoch ms instant
// so test cases can still reason in "hours after active-from".
function closedAtAfterHours(hoursAfterActiveFrom) {
  const activeFromMs = raceStartMs() - 2 * 60 * 60 * 1000;
  const d = new Date(activeFromMs + hoursAfterActiveFrom * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// Expected DD/MM/YYYY for a closedAt's own date portion — matches what
// applyBeaconCatalogueUpdates() itself stores into beacon.lastUsed (see its own doc: a plain
// date, the same convention every other date field in the app uses, not the raw wire timestamp).
function closedAtToDMY(closedAt) {
  const [y, m, d] = closedAt.slice(0, 10).split('/');
  return `${d}/${m}/${y}`;
}

function beacon(number, overrides = {}) {
  return { number, owner: '', dateAcquired: '', totalHours: 0, batteryLevel: 100, lastUsed: '', lost: '', notes: '', ...overrides };
}

function closeMap(entries) {
  // entries: [[number, { closedAt, batteryPercent, closeCount? }], ...] — mirrors
  // js/mobile-files-progress.js's own closeByBeacon map shape.
  return new Map(entries.map(([number, e]) => [number, { closeCount: 1, ...e }]));
}

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.beacons = [];
  state.entries = [];
  state.beaconReports = [];
  state.event = {
    date: '23/08/2026', startTime: '10:00:00', juniorStartTime: '', juniorLimit: 'None',
    timingMethod: 'Beacons', juniorTimingMethod: 'Stopwatch',
  };
});

describe('mobile-beacons.js:computeBeaconCatalogueUpdates', () => {
  it('queues a returned beacon for the catalogue, computing hours since 2h before the race started', () => {
    state.beacons = [beacon(1)];
    const closedAt = closedAtAfterHours(5); // 5h after "2h before start"
    const plan = computeBeaconCatalogueUpdates(closeMap([[1, { closedAt, batteryPercent: 60 }]]), 'race-26-08-23');
    assert.equal(plan.toApply.length, 1);
    assert.equal(plan.toApply[0].number, 1);
    assert.equal(plan.toApply[0].batteryLevel, 60);
    assert.ok(Math.abs(plan.toApply[0].hoursDelta - 5) < 0.01);
    assert.deepEqual(plan.returned, [1]);
  });

  it('is idempotent: a close already applied for this race is excluded from toApply on a re-read', async () => {
    state.beacons = [beacon(1)];
    const closedAt = closedAtAfterHours(5);
    const close = closeMap([[1, { closedAt, batteryPercent: 60 }]]);
    const firstPlan = computeBeaconCatalogueUpdates(close, 'race-26-08-23');
    await applyBeaconCatalogueUpdates(firstPlan, 'race-26-08-23');

    const secondPlan = computeBeaconCatalogueUpdates(close, 'race-26-08-23');
    assert.equal(secondPlan.toApply.length, 0);
    assert.deepEqual(secondPlan.returned, [1]); // still counted as returned for the missing check
  });

  it('flags an issued beacon absent from the selection as missing', () => {
    state.beacons = [beacon(1), beacon(2)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }, { bibNumber: 2, dibberNumber: 2 }];
    const plan = computeBeaconCatalogueUpdates(closeMap([[1, { closedAt: closedAtAfterHours(1), batteryPercent: 80 }]]), 'race-26-08-23');
    assert.deepEqual(plan.missing, [2]);
  });

  it('a late return (a bigger selection on a re-run) drops a previously-missing beacon off the list', () => {
    state.beacons = [beacon(1), beacon(2)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }, { bibNumber: 2, dibberNumber: 2 }];
    const firstPlan = computeBeaconCatalogueUpdates(closeMap([[1, { closedAt: closedAtAfterHours(1), batteryPercent: 80 }]]), 'race-26-08-23');
    assert.deepEqual(firstPlan.missing, [2]);

    const secondPlan = computeBeaconCatalogueUpdates(closeMap([
      [1, { closedAt: closedAtAfterHours(1), batteryPercent: 80 }],
      [2, { closedAt: closedAtAfterHours(1.5), batteryPercent: 50 }],
    ]), 'race-26-08-23');
    assert.deepEqual(secondPlan.missing, []);
  });

  it('does not count a beacon with no allocated entry as missing', () => {
    state.beacons = [beacon(1), beacon(2)]; // beacon 2 never allocated to an entry
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const plan = computeBeaconCatalogueUpdates(closeMap([[1, { closedAt: closedAtAfterHours(1), batteryPercent: 80 }]]), 'race-26-08-23');
    assert.deepEqual(plan.missing, []);
  });

  it('does not count a Dibber-timed entry\'s own number as an issued beacon', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1, course: 'Juniors' }]; // Juniors defaults to Stopwatch in this file's beforeEach
    const plan = computeBeaconCatalogueUpdates(closeMap([]), 'race-26-08-23');
    assert.deepEqual(plan.missing, []);
  });

  it('ignores a close for a beacon not in the catalogue (still counted as returned)', () => {
    state.beacons = [];
    const plan = computeBeaconCatalogueUpdates(closeMap([[99, { closedAt: closedAtAfterHours(1), batteryPercent: 80 }]]), 'race-26-08-23');
    assert.equal(plan.toApply.length, 0);
    assert.deepEqual(plan.returned, [99]);
  });

  it('carries each returned beacon\'s closeCount through, defaulting to 1 when the map omits it', () => {
    state.beacons = [beacon(1), beacon(2)];
    const plan = computeBeaconCatalogueUpdates(new Map([
      [1, { closedAt: closedAtAfterHours(1), batteryPercent: 80, closeCount: 3 }],
      [2, { closedAt: closedAtAfterHours(1), batteryPercent: 70 }], // no closeCount field
    ]), 'race-26-08-23');
    assert.equal(plan.closeCounts[1], 3);
    assert.equal(plan.closeCounts[2], 1);
  });

  // The feature this session added: a beacon reopened since its last close (computeCloseByBeacon's
  // own entry shape for that case — no closedAt at all, see its own doc) must not show as
  // returned here — it's still out and needs closing again, so it falls through to `missing`
  // instead, exactly as if it had never been closed this race.
  it('treats a reopened beacon (no closedAt in its map entry) as still missing, not returned', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const plan = computeBeaconCatalogueUpdates(new Map([[1, { closeCount: 1 }]]), 'race-26-08-23');
    assert.deepEqual(plan.returned, []);
    assert.deepEqual(plan.missing, [1]);
    assert.equal(plan.toApply.length, 0);
  });

  it('does not zero out a previously-applied battery reading when a beacon is later reopened', async () => {
    state.beacons = [beacon(1)];
    const closedAt = closedAtAfterHours(1);
    const firstPlan = computeBeaconCatalogueUpdates(closeMap([[1, { closedAt, batteryPercent: 80 }]]), 'race-26-08-23');
    await applyBeaconCatalogueUpdates(firstPlan, 'race-26-08-23');
    assert.equal(state.beacons[0].batteryLevel, 80);

    // Same race, later Update Progress run: beacon 1 has since been reopened (no closedAt).
    const secondPlan = computeBeaconCatalogueUpdates(new Map([[1, { closeCount: 1 }]]), 'race-26-08-23');
    assert.equal(secondPlan.toApply.length, 0);
    await applyBeaconCatalogueUpdates(secondPlan, 'race-26-08-23');
    assert.equal(state.beacons[0].batteryLevel, 80); // untouched, not reset to 0
  });
});

describe('mobile-beacons.js:applyBeaconCatalogueUpdates', () => {
  it('updates batteryLevel/lastUsed and accumulates totalHours on the catalogue', async () => {
    state.beacons = [beacon(1, { totalHours: 2 })];
    const closedAt = closedAtAfterHours(3);
    const plan = computeBeaconCatalogueUpdates(closeMap([[1, { closedAt, batteryPercent: 45 }]]), 'race-26-08-23');
    await applyBeaconCatalogueUpdates(plan, 'race-26-08-23');

    assert.equal(state.beacons[0].batteryLevel, 45);
    assert.equal(state.beacons[0].lastUsed, closedAtToDMY(closedAt)); // DD/MM/YYYY, not the raw wire timestamp
    assert.ok(Math.abs(state.beacons[0].totalHours - 5) < 0.01); // 2 existing + 3 new
  });

  it('re-applying the identical close map does not double-count hours', async () => {
    state.beacons = [beacon(1)];
    const close = closeMap([[1, { closedAt: closedAtAfterHours(4), batteryPercent: 50 }]]);

    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(close, 'race-26-08-23'), 'race-26-08-23');
    const firstHours = state.beacons[0].totalHours;

    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(close, 'race-26-08-23'), 'race-26-08-23');
    assert.equal(state.beacons[0].totalHours, firstHours);
    assert.ok(Math.abs(firstHours - 4) < 0.01);
  });

  it('a late return in a bigger selection only adds the new beacon\'s hours, leaving the first beacon unchanged', async () => {
    state.beacons = [beacon(1), beacon(2)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }, { bibNumber: 2, dibberNumber: 2 }];
    const offA = closedAtAfterHours(3);
    const offB = closedAtAfterHours(3.5);

    const first = closeMap([[1, { closedAt: offA, batteryPercent: 80 }]]);
    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(first, 'race-26-08-23'), 'race-26-08-23');
    assert.deepEqual(state.beaconReports.find(r => r.raceLabel === 'race-26-08-23').missing, [2]);

    const second = closeMap([
      [1, { closedAt: offA, batteryPercent: 80 }],
      [2, { closedAt: offB, batteryPercent: 60 }],
    ]);
    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(second, 'race-26-08-23'), 'race-26-08-23');

    assert.ok(Math.abs(state.beacons[0].totalHours - 3) < 0.01);   // unchanged from the first apply
    assert.ok(Math.abs(state.beacons[1].totalHours - 3.5) < 0.01); // newly applied
    assert.deepEqual(state.beaconReports.find(r => r.raceLabel === 'race-26-08-23').missing, []);
  });

  it('leaves an identical re-apply unsaved (no-op short-circuit, like applyComputedResults)', async () => {
    state.beacons = [beacon(1)];
    const close = closeMap([[1, { closedAt: closedAtAfterHours(2), batteryPercent: 50 }]]);

    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(close, 'race-26-08-23'), 'race-26-08-23');
    localStorage.removeItem('racemaster-dirty');

    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(close, 'race-26-08-23'), 'race-26-08-23');
    assert.equal(isDirty(), false);
  });

  it('keeps separate races\' summaries distinct in state.beaconReports', async () => {
    state.beacons = [beacon(1)];
    const close = closeMap([[1, { closedAt: closedAtAfterHours(1), batteryPercent: 50 }]]);
    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(close, 'race-a'), 'race-a');
    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(close, 'race-b'), 'race-b');
    assert.equal(state.beaconReports.length, 2);
  });

  it('persists closeCounts onto the race\'s own state.beaconReports entry', async () => {
    state.beacons = [beacon(1)];
    const close = new Map([[1, { closedAt: closedAtAfterHours(1), batteryPercent: 50, closeCount: 2 }]]);
    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(close, 'race-26-08-23'), 'race-26-08-23');
    assert.equal(state.beaconReports.find(r => r.raceLabel === 'race-26-08-23').closeCounts[1], 2);
  });

  it('a later run with a changed closeCount is not treated as a no-op re-apply', async () => {
    state.beacons = [beacon(1)];
    const closedAt = closedAtAfterHours(2);
    const first = new Map([[1, { closedAt, batteryPercent: 50, closeCount: 1 }]]);
    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(first, 'race-26-08-23'), 'race-26-08-23');
    localStorage.removeItem('racemaster-dirty');

    // Same close (so toApply is empty, as in the idempotency test above), but the beacon was
    // re-presented and closed again afterwards, bumping closeCount — that's new information worth
    // persisting even though nothing else in the selection changed.
    const second = new Map([[1, { closedAt, batteryPercent: 50, closeCount: 2 }]]);
    await applyBeaconCatalogueUpdates(computeBeaconCatalogueUpdates(second, 'race-26-08-23'), 'race-26-08-23');
    assert.equal(isDirty(), true);
    assert.equal(state.beaconReports.find(r => r.raceLabel === 'race-26-08-23').closeCounts[1], 2);
  });
});

describe('mobile-beacons.js:computeBeaconStatusUpdates/applyBeaconStatusUpdates', () => {
  it('derives \'issued\' for an allocated beacon with no close/count data at all', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const updates = computeBeaconStatusUpdates(new Map(), new Map());
    assert.deepEqual(updates.get(1), { status: 'issued', asAt: '' });
  });

  it('derives \'on-course\' for a counted beacon', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const countedAt = closedAtAfterHours(1);
    const updates = computeBeaconStatusUpdates(new Map(), new Map([[1, { at: countedAt, countedAt }]]));
    assert.deepEqual(updates.get(1), { status: 'on-course', asAt: countedAt });
  });

  it('derives \'returned\' for a closed beacon, taking priority over issued/counted', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const closedAt = closedAtAfterHours(2);
    const earlierCountedAt = closedAtAfterHours(1);
    const updates = computeBeaconStatusUpdates(closeMap([[1, { closedAt }]]), new Map([[1, { at: earlierCountedAt, countedAt: earlierCountedAt }]]));
    assert.deepEqual(updates.get(1), { status: 'returned', asAt: closedAt });
  });

  // An ejected beacon's countByBeacon entry carries countedAt:null (see
  // mobile-files-progress.js's own computeCountByBeacon doc) — must fall through to issued, not be
  // reported on-course with a blank/null asAt.
  it('an ejected beacon (countedAt null in its map entry) falls through to issued, not on-course', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const updates = computeBeaconStatusUpdates(new Map(), new Map([[1, { at: closedAtAfterHours(1), countedAt: null }]]));
    assert.deepEqual(updates.get(1), { status: 'issued', asAt: '' });
  });

  it('leaves out a beacon untouched this race (not issued, not counted, not closed)', () => {
    state.beacons = [beacon(1), beacon(2)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }]; // beacon 2 not allocated this race
    const updates = computeBeaconStatusUpdates(new Map(), new Map());
    assert.equal(updates.has(2), false);
  });

  it('a reopened beacon (no closedAt in its map entry) falls through to on-course/issued, not returned', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const updates = computeBeaconStatusUpdates(new Map([[1, { closeCount: 1 }]]), new Map());
    assert.deepEqual(updates.get(1), { status: 'issued', asAt: '' });
  });

  it('applyBeaconStatusUpdates persists status and asAt onto the catalogue', async () => {
    state.beacons = [beacon(1)];
    const countedAt = closedAtAfterHours(1);
    const changed = await applyBeaconStatusUpdates(new Map([[1, { status: 'on-course', asAt: countedAt }]]));
    assert.equal(changed, true);
    assert.equal(state.beacons[0].status, 'on-course');
    assert.equal(state.beacons[0].asAt, countedAt);
  });

  // The behaviour that lets status/asAt cross race boundaries (ToDo.MD): a beacon this race
  // never touches at all (absent from the updates Map entirely) keeps whatever an earlier race
  // already left on its catalogue record, rather than being reset to blank.
  it('does not touch a beacon absent from the updates Map at all', async () => {
    state.beacons = [beacon(1, { status: 'returned', asAt: '2026/08/01 12:00:00' })];
    const changed = await applyBeaconStatusUpdates(new Map());
    assert.equal(changed, false);
    assert.equal(state.beacons[0].status, 'returned');
    assert.equal(state.beacons[0].asAt, '2026/08/01 12:00:00');
  });

  it('an \'issued\' update (blank asAt) does not overwrite an earlier, still-relevant asAt', async () => {
    state.beacons = [beacon(1, { status: 'returned', asAt: '2026/08/01 12:00:00' })];
    const changed = await applyBeaconStatusUpdates(new Map([[1, { status: 'issued', asAt: '' }]]));
    assert.equal(changed, true); // status itself did change
    assert.equal(state.beacons[0].status, 'issued');
    assert.equal(state.beacons[0].asAt, '2026/08/01 12:00:00'); // untouched
  });

  it('reports no change and does not save when nothing actually differs', async () => {
    state.beacons = [beacon(1, { status: 'on-course', asAt: '2026/08/01 12:00:00' })];
    const changed = await applyBeaconStatusUpdates(new Map([[1, { status: 'on-course', asAt: '2026/08/01 12:00:00' }]]));
    assert.equal(changed, false);
  });
});

describe('mobile-beacons.js:applyManualBeaconReturn', () => {
  it('marks the beacon returned, applying the same battery/lastUsed/hours math a real close would', async () => {
    state.beacons = [beacon(1, { totalHours: 1 })];
    const closedAt = closedAtAfterHours(4);
    await applyManualBeaconReturn(1, closedAt, 65);
    const b = state.beacons[0];
    assert.equal(b.status, 'returned');
    assert.equal(b.asAt, closedAt);
    assert.equal(b.batteryLevel, 65);
    assert.equal(b.lastUsed, closedAtToDMY(closedAt));
    assert.ok(Math.abs(b.totalHours - 5) < 0.01); // 1 existing + 4 new
  });

  it('does nothing for a beacon not in the catalogue', async () => {
    state.beacons = [];
    await applyManualBeaconReturn(99, closedAtAfterHours(1), 50); // must not throw
    assert.equal(state.beacons.length, 0);
  });

  it('toPhoneTimestamp round-trips through parsePhoneTimestamp-shaped consumers', () => {
    const ts = toPhoneTimestamp(new Date(2026, 7, 23, 14, 5, 9)); // month is 0-based: August
    assert.equal(ts, '2026/08/23 14:05:09');
  });
});
