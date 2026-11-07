'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { isDirty } from '../js/storage.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import { parseDate, timeToSeconds } from '../js/utils.js';
import { validateAndComputeBeaconReport, applyBeaconReportResults } from '../js/mobile-beacons.js';

// Computed the same way js/mobile-beacons.js's own raceStartMs() does, so test timestamps are
// timezone-agnostic — both sides use the same local-time arithmetic rather than a hardcoded ISO
// instant that would drift relative to "2 hours before the race started" depending on the
// machine's own timezone.
function raceStartMs() {
  return parseDate(state.event.date).getTime() + timeToSeconds(state.event.startTime) * 1000;
}
function poweredOffAtAfterHours(hoursAfterActiveFrom) {
  const activeFromMs = raceStartMs() - 2 * 60 * 60 * 1000;
  return new Date(activeFromMs + hoursAfterActiveFrom * 60 * 60 * 1000).toISOString();
}
// Expected DD/MM/YYYY for an ISO instant's own date portion — matches what
// applyBeaconReportResults() itself stores into beacon.lastUsed (see its own doc: a plain date,
// the same convention every other date field in the app uses, not the raw ISO instant).
function isoToDMY(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function beacon(number, overrides = {}) {
  return { number, owner: '', dateAcquired: '', totalHours: 0, batteryLevel: 100, lastUsed: '', lost: '', notes: '', ...overrides };
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

describe('mobile-beacons.js:validateAndComputeBeaconReport', () => {
  it('queues a returned beacon for the catalogue, computing hours since 2h before the race started', () => {
    state.beacons = [beacon(1)];
    const poweredOffAt = poweredOffAtAfterHours(5); // 5h after "2h before start"
    const plan = validateAndComputeBeaconReport({ powerOffBatch: [{ beaconNumber: 1, batteryLevel: 60, poweredOffAt }] }, 'race-26-08-23');
    assert.equal(plan.toApply.length, 1);
    assert.equal(plan.toApply[0].number, 1);
    assert.equal(plan.toApply[0].batteryLevel, 60);
    assert.ok(Math.abs(plan.toApply[0].hoursDelta - 5) < 0.01);
    assert.deepEqual(plan.returned, [1]);
  });

  it('is idempotent: a power-off event already applied for this race is excluded from toApply on a re-read', async () => {
    state.beacons = [beacon(1)];
    const poweredOffAt = poweredOffAtAfterHours(5);
    const report = { powerOffBatch: [{ beaconNumber: 1, batteryLevel: 60, poweredOffAt }] };
    const firstPlan = validateAndComputeBeaconReport(report, 'race-26-08-23');
    await applyBeaconReportResults(firstPlan, report, 'race-26-08-23');

    const secondPlan = validateAndComputeBeaconReport(report, 'race-26-08-23');
    assert.equal(secondPlan.toApply.length, 0);
    assert.deepEqual(secondPlan.returned, [1]); // still counted as returned for the missing check
  });

  it('flags an issued beacon absent from the report as missing', () => {
    state.beacons = [beacon(1), beacon(2)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }, { bibNumber: 2, dibberNumber: 2 }];
    const plan = validateAndComputeBeaconReport({ powerOffBatch: [{ beaconNumber: 1, batteryLevel: 80, poweredOffAt: poweredOffAtAfterHours(1) }] }, 'race-26-08-23');
    assert.deepEqual(plan.missing, [2]);
  });

  it('a late return (a bigger report on a re-read) drops a previously-missing beacon off the list', () => {
    state.beacons = [beacon(1), beacon(2)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }, { bibNumber: 2, dibberNumber: 2 }];
    const firstPlan = validateAndComputeBeaconReport({ powerOffBatch: [{ beaconNumber: 1, batteryLevel: 80, poweredOffAt: poweredOffAtAfterHours(1) }] }, 'race-26-08-23');
    assert.deepEqual(firstPlan.missing, [2]);

    const secondPlan = validateAndComputeBeaconReport({
      powerOffBatch: [
        { beaconNumber: 1, batteryLevel: 80, poweredOffAt: poweredOffAtAfterHours(1) },
        { beaconNumber: 2, batteryLevel: 50, poweredOffAt: poweredOffAtAfterHours(1.5) },
      ],
    }, 'race-26-08-23');
    assert.deepEqual(secondPlan.missing, []);
  });

  it('does not count a beacon with no allocated entry as missing', () => {
    state.beacons = [beacon(1), beacon(2)]; // beacon 2 never allocated to an entry
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }];
    const plan = validateAndComputeBeaconReport({ powerOffBatch: [{ beaconNumber: 1, batteryLevel: 80, poweredOffAt: poweredOffAtAfterHours(1) }] }, 'race-26-08-23');
    assert.deepEqual(plan.missing, []);
  });

  it('does not count a Dibber-timed entry\'s own number as an issued beacon', () => {
    state.beacons = [beacon(1)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1, course: 'Juniors' }]; // Juniors defaults to Stopwatch in this file's beforeEach
    const plan = validateAndComputeBeaconReport({ powerOffBatch: [] }, 'race-26-08-23');
    assert.deepEqual(plan.missing, []);
  });

  it('ignores a report record for a beacon not in the catalogue (still counted as returned)', () => {
    state.beacons = [];
    const plan = validateAndComputeBeaconReport({ powerOffBatch: [{ beaconNumber: 99, batteryLevel: 80, poweredOffAt: poweredOffAtAfterHours(1) }] }, 'race-26-08-23');
    assert.equal(plan.toApply.length, 0);
    assert.deepEqual(plan.returned, [99]);
  });
});

describe('mobile-beacons.js:applyBeaconReportResults', () => {
  it('updates batteryLevel/lastUsed and accumulates totalHours on the catalogue', async () => {
    state.beacons = [beacon(1, { totalHours: 2 })];
    const poweredOffAt = poweredOffAtAfterHours(3);
    const report = { generatedAt: '2026-08-23T00:00:00.000Z', powerOffBatch: [{ beaconNumber: 1, batteryLevel: 45, poweredOffAt }] };
    const plan = validateAndComputeBeaconReport(report, 'race-26-08-23');
    await applyBeaconReportResults(plan, report, 'race-26-08-23');

    assert.equal(state.beacons[0].batteryLevel, 45);
    assert.equal(state.beacons[0].lastUsed, isoToDMY(poweredOffAt)); // DD/MM/YYYY, not the raw ISO instant
    assert.ok(Math.abs(state.beacons[0].totalHours - 5) < 0.01); // 2 existing + 3 new
  });

  it('re-applying the identical report does not double-count hours', async () => {
    state.beacons = [beacon(1)];
    const poweredOffAt = poweredOffAtAfterHours(4);
    const report = { generatedAt: '2026-08-23T00:00:00.000Z', powerOffBatch: [{ beaconNumber: 1, batteryLevel: 50, poweredOffAt }] };

    await applyBeaconReportResults(validateAndComputeBeaconReport(report, 'race-26-08-23'), report, 'race-26-08-23');
    const firstHours = state.beacons[0].totalHours;

    await applyBeaconReportResults(validateAndComputeBeaconReport(report, 'race-26-08-23'), report, 'race-26-08-23');
    assert.equal(state.beacons[0].totalHours, firstHours);
    assert.ok(Math.abs(firstHours - 4) < 0.01);
  });

  it('a late return in a bigger report only adds the new beacon\'s hours, leaving the first beacon unchanged', async () => {
    state.beacons = [beacon(1), beacon(2)];
    state.entries = [{ bibNumber: 1, dibberNumber: 1 }, { bibNumber: 2, dibberNumber: 2 }];
    const offA = poweredOffAtAfterHours(3);
    const offB = poweredOffAtAfterHours(3.5);

    const firstReport = { generatedAt: '2026-08-23T00:00:00.000Z', powerOffBatch: [{ beaconNumber: 1, batteryLevel: 80, poweredOffAt: offA }] };
    await applyBeaconReportResults(validateAndComputeBeaconReport(firstReport, 'race-26-08-23'), firstReport, 'race-26-08-23');
    assert.deepEqual(state.beaconReports.find(r => r.raceLabel === 'race-26-08-23').missing, [2]);

    const secondReport = {
      generatedAt: '2026-08-23T01:00:00.000Z',
      powerOffBatch: [
        { beaconNumber: 1, batteryLevel: 80, poweredOffAt: offA },
        { beaconNumber: 2, batteryLevel: 60, poweredOffAt: offB },
      ],
    };
    await applyBeaconReportResults(validateAndComputeBeaconReport(secondReport, 'race-26-08-23'), secondReport, 'race-26-08-23');

    assert.ok(Math.abs(state.beacons[0].totalHours - 3) < 0.01);   // unchanged from the first apply
    assert.ok(Math.abs(state.beacons[1].totalHours - 3.5) < 0.01); // newly applied
    assert.deepEqual(state.beaconReports.find(r => r.raceLabel === 'race-26-08-23').missing, []);
  });

  it('leaves an identical re-apply unsaved (no-op short-circuit, like applyComputedResults)', async () => {
    state.beacons = [beacon(1)];
    const poweredOffAt = poweredOffAtAfterHours(2);
    const report = { generatedAt: '2026-08-23T00:00:00.000Z', powerOffBatch: [{ beaconNumber: 1, batteryLevel: 50, poweredOffAt }] };

    await applyBeaconReportResults(validateAndComputeBeaconReport(report, 'race-26-08-23'), report, 'race-26-08-23');
    localStorage.removeItem('racemaster-dirty');

    await applyBeaconReportResults(validateAndComputeBeaconReport(report, 'race-26-08-23'), report, 'race-26-08-23');
    assert.equal(isDirty(), false);
  });

  it('keeps separate races\' summaries distinct in state.beaconReports', async () => {
    state.beacons = [beacon(1)];
    const report = { generatedAt: '', powerOffBatch: [{ beaconNumber: 1, batteryLevel: 50, poweredOffAt: poweredOffAtAfterHours(1) }] };
    await applyBeaconReportResults(validateAndComputeBeaconReport(report, 'race-a'), report, 'race-a');
    await applyBeaconReportResults(validateAndComputeBeaconReport(report, 'race-b'), report, 'race-b');
    assert.equal(state.beaconReports.length, 2);
  });
});
