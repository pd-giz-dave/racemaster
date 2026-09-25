'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  validateAndCompute, clearProgressData, applyComputedResults,
  buildProgressColumns, buildProgressRows, CP_RETIRE,
} from '../js/mobile-files-progress.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.entries = [
    { bibNumber: '1', name: 'Alice', category: 'MSEN', course: 'Seniors' },
    { bibNumber: '2', name: 'Bob',   category: 'MSEN', course: 'Seniors' },
  ];
  state.mobileProgress = [];
  state.mobileCheckpoints = [];
  state.finishers = [];
  state.siResults = [];
});

// A minimal Finish-location device row: one Time-mode phone with a ModeStart marker + one Split,
// one Bibs-mode phone with one Finish — enough for validateAndCompute() to pair a real finish time.
function finishRow(overrides = {}) {
  const merged = {
    owner: 'alice', raceLabel: 'race-a',
    device: {
      name: 'Finish Phone',
      lines: [
        // note:'Time' (even though this marker's own splitTime is always null now — see
        // SyncRecord's own doc) is what buildSegmentView classifies this as the Time-mode
        // family, not the Bibs-mode one, by — a Bibs-mode per-bib "Start" action also exists (a
        // runner's own early/late start, unrelated to this device marker — see
        // BIBS_ACTION_TO_FINISHER's own doc); action:'ModeStart' itself (ToDo.MD: "use the
        // ModeStart records and not start or clock records") is what identifies this specific
        // row as the family's own session-start marker, not an ordinary entry.
        { lineNumber: 1, action: 'ModeStart', splitNumber: 0, splitTime: null, note: 'Time', timestamp: '2026/08/30 09:00:00.00', location: 'Finish' },
        { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: 1200, timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
        { lineNumber: 3, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
      ],
    },
    ...overrides,
  };
  // validateAndCompute() reads r.device.resolvedLines (the current, interpreted picture — see
  // mobile-files-devices.js's own flattenDevices() doc for why that's kept apart from
  // r.device.lines, the genuinely raw array). Every fixture in this file builds `device.lines`
  // directly, by hand, with `.location` already set on each line — exactly what flattenDevices()
  // would have produced as resolvedLines — so defaulting resolvedLines to the same array here,
  // once, means every finishRow({ device: {...} }) override throughout this file gets a matching
  // resolvedLines for free, without needing to be touched individually.
  if (!merged.device.resolvedLines) merged.device.resolvedLines = merged.device.lines;
  return merged;
}

describe('mobile-files-progress.js:validateAndCompute', () => {
  it('rejects a selection spanning more than one race', () => {
    const r1 = finishRow({ raceLabel: 'race-a' });
    const r2 = finishRow({ raceLabel: 'race-b' });
    return validateAndCompute([r1, r2]).then(result => {
      assert.match(result.error, /different races/);
    });
  });

  // Field report: three phones in the current race, a fourth still reporting "unknown-26-09-25" —
  // ticking it (which is what adopts it) put it in the selection before it had renamed, and the
  // different-races check refused the whole computation.
  it('counts an adopted phone as part of the race it was adopted into', () => {
    const known = finishRow({ raceLabel: 'webtest-seniors-26-09-15' });
    const adopted = finishRow({ raceLabel: 'unknown-26-09-25', adoptedInto: 'webtest-seniors-26-09-15' });
    return validateAndCompute([known, adopted]).then(result => {
      assert.doesNotMatch(result.error ?? '', /different races/);
    });
  });

  it('rejects a file with an empty current segment', () => {
    const empty = finishRow({ device: { name: 'Empty Phone', lines: [] } });
    return validateAndCompute([empty]).then(result => {
      assert.match(result.error, /empty/);
    });
  });

  it('splits a single relocated device file into one segment per location, bucketing each independently', () => {
    // One CP-mode phone that recorded at CP1, relocated (a real HistoryAction.LOCATION marker on
    // the phone — the web-app doesn't need to see the marker itself, just each row's own already-
    // resolved .location, per SyncRecordMapping.kt:withResolvedLocations), then recorded at CP2.
    const roaming = finishRow({ device: { name: 'Roaming Phone', lines: [
      { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'CP', location: 'CP1' },
      { lineNumber: 2, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:05:00.00', location: 'CP1' },
      { lineNumber: 3, action: 'Location', bibNumber: null, splitTime: null, note: 'CP2', location: 'CP2' },
      { lineNumber: 4, action: 'Finish', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 09:15:00.00', location: 'CP2' },
    ] } });
    return validateAndCompute([finishRow(), roaming]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.cpBuckets.size, 2); // CP1 and CP2 bucketed independently, from the same device file
      assert.equal(result.cpTimesByCp.get(1).get(1), '00:05:00');
      assert.equal(result.cpTimesByCp.get(2).get(2), '00:15:00');
    });
  });

  // Not just one relocation — a marshal can move any number of times, each its own real
  // HistoryAction.LOCATION marker (racemaster-mobile's RaceRepository.relocateActiveModes has no
  // limit on how many times it can be called in one race). Three CPs from one roaming device here
  // to confirm locationSegmentsOf()/the bucketing loop stay correct beyond just two.
  it('splits a device relocated three times over into three independent segments/buckets', () => {
    const roaming = finishRow({ device: { name: 'Roaming Phone', lines: [
      { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'CP', location: 'CP1' },
      { lineNumber: 2, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:05:00.00', location: 'CP1' },
      { lineNumber: 3, action: 'Location', bibNumber: null, splitTime: null, note: 'CP2', location: 'CP2' },
      { lineNumber: 4, action: 'Finish', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 09:15:00.00', location: 'CP2' },
      { lineNumber: 5, action: 'Location', bibNumber: null, splitTime: null, note: 'CP3', location: 'CP3' },
      { lineNumber: 6, action: 'Finish', splitNumber: 1, bibNumber: '3', timestamp: '2026/08/30 09:25:00.00', location: 'CP3' },
    ] } });
    return validateAndCompute([finishRow(), roaming]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.cpBuckets.size, 3);
      assert.equal(result.cpTimesByCp.get(1).get(1), '00:05:00');
      assert.equal(result.cpTimesByCp.get(2).get(2), '00:15:00');
      assert.equal(result.cpTimesByCp.get(3).get(3), '00:25:00');
    });
  });

  it('rejects when one of a relocated device\'s own segments collides with another selected file\'s checkpoint', () => {
    const roaming = finishRow({ device: { name: 'Roaming Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:05:00.00', location: 'CP1' },
      { lineNumber: 2, action: 'Location', bibNumber: null, splitTime: null, note: 'CP2', location: 'CP2' },
      { lineNumber: 3, action: 'Finish', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 09:15:00.00', location: 'CP2' },
    ] } });
    const cp1Again = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '999', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    return validateAndCompute([finishRow(), roaming, cp1Again]).then(result => {
      assert.match(result.error, /more than one file selected for CP1/);
    });
  });

  it('rejects a file with no location recorded on any visible line', () => {
    const bad = finishRow();
    for (const l of bad.device.lines) delete l.location;
    return validateAndCompute([bad]).then(result => {
      assert.match(result.error, /no location recorded/);
    });
  });

  // ToDo.MD's "modestart setup record" — a device adopted (Setup Race run, mode chosen) before
  // anything real has been recorded must not crash or misbehave when selected for Update
  // Progress. There's no longer a separate mode-agnostic "Setup" record to worry about (ToDo.MD:
  // "drop the 'Setup' record from the device file, its no longer created, there will always be a
  // modestart record") — the file's own ModeStart marker (already in BIBS_ACTION_TO_FINISHER,
  // same as the 'Clock' action it replaced) transfers harmlessly as a single inert Clock-mapped
  // entry (number 0, no bib), not an error — matches long-standing behavior for the old 'Clock'
  // marker, unchanged in substance by the wire-format rename.
  it('succeeds harmlessly (one inert entry, not an error) for a Finish-location device with only its own ModeStart marker', () => {
    const modeStartOnly = finishRow({ device: { name: 'Just Adopted', lines: [
      { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'Bibs', location: 'Finish' },
    ] } });
    return validateAndCompute([modeStartOnly]).then(result => {
      assert.equal(result.error, undefined);
      assert.deepEqual(result.expected, [{ action: 'Clock', number: 0, time: '' }]);
    });
  });

  it('rejects a Finish-location device whose only visible line is a genuinely non-transferable action', () => {
    const stopOnly = finishRow({ device: { name: 'Odd Phone', lines: [
      { lineNumber: 1, action: 'Stop', bibNumber: '1', location: 'Finish' },
    ] } });
    return validateAndCompute([stopOnly]).then(result => {
      assert.match(result.error, /no transferable entries/);
    });
  });

  it('succeeds with a checkpoint-only selection — no Finish file required (one may not have relocated there yet)', () => {
    const cpOnly = finishRow();
    for (const l of cpOnly.device.lines) l.location = 'CP1';
    return validateAndCompute([cpOnly]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.finishRows.length, 0);
      assert.equal(result.cpBuckets.size, 1);
      // No Finish file to anchor elapsed time against — the bib still shows up as seen (empty
      // elapsed, not omitted; see computeCpTimes' own doc for why that matters), with its real
      // device time-of-day intact.
      assert.equal(result.cpTimesByCp.get(1).get(1), '');
      assert.equal(result.cpTimeOfDayByCp.get(1).get(1), '09:20:00');
      assert.deepEqual(result.expected, []); // nothing Finish-derived yet, and this bib didn't retire
    });
  });

  it('includes (rather than rejects) a bib number not present in entries — flagged elsewhere, not here', () => {
    const r = finishRow();
    r.device.lines[2].bibNumber = '999';
    return validateAndCompute([r]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.expected.length, 1);
      assert.equal(result.expected[0].number, 999);
    });
  });

  it('includes (rather than rejects) a checkpoint crossing for a bib not present in entries', () => {
    const cp = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '999', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    return validateAndCompute([finishRow(), cp]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.cpTimesByCp.get(1).get(999), '00:10:00');
    });
  });

  it('rejects duplicate split numbers within the Bibs family at Finish (two bibs-recording phones)', () => {
    const r1 = finishRow({ device: { name: 'Bibs A', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
    ] } });
    const r2 = finishRow({ device: { name: 'Bibs B', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 09:21:00.00', location: 'Finish' },
    ] } });
    return validateAndCompute([r1, r2]).then(result => {
      assert.match(result.error, /more than one bibs-recording phone/);
    });
  });

  it('computes a real finish time for a valid single-Finish-file selection', async () => {
    const result = await validateAndCompute([finishRow()]);
    assert.equal(result.error, undefined);
    assert.equal(result.expected.length, 1);
    assert.deepEqual(result.expected[0], { action: 'Finish', number: 1, time: '00:20:00', timeOfDay: '09:20:00' });
  });

  it('computes an approximate checkpoint time relative to the Finish file\'s own Start row', async () => {
    const cp = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    const result = await validateAndCompute([finishRow(), cp]);
    assert.equal(result.error, undefined);
    assert.equal(result.cpBuckets.size, 1);
    const cpTimes = result.cpTimesByCp.get(1);
    assert.equal(cpTimes.get(1), '00:10:00'); // 09:10 - 09:00 start
    // cpTimeOfDayByCp carries the crossing row's own device timestamp alongside, unconditionally
    // (not dependent on the elapsed calc succeeding) — Safety Check's Last CP column prefers it.
    assert.equal(result.cpTimeOfDayByCp.get(1).get(1), '09:10:00');
  });

  it('gives a late-start bib its own device timeOfDay too, alongside its paired elapsed time', async () => {
    const withLateStart = finishRow();
    withLateStart.device.lines.push(
      { lineNumber: 4, action: 'Start', splitNumber: 2, bibNumber: '2', timestamp: '2026/08/30 09:05:00.00', location: 'Finish' },
      { lineNumber: 5, action: 'Split', splitNumber: 2, splitTime: 300, timestamp: '2026/08/30 09:05:00.00', location: 'Finish' },
    );
    const result = await validateAndCompute([withLateStart]);
    assert.equal(result.error, undefined);
    const startEntry = result.expected.find(e => e.action === 'Start' && e.number === 2);
    assert.equal(startEntry.time, '00:05:00');
    assert.equal(startEntry.timeOfDay, '09:05:00');
  });

  it('degrades a checkpoint file to time-of-day-only (no error) when the Finish file\'s time-mode ModeStart row is missing', async () => {
    const noStart = finishRow();
    noStart.device.lines = noStart.device.lines.filter(l => l.action !== 'ModeStart');
    noStart.device.resolvedLines = noStart.device.lines; // keep the two in sync — see finishRow()'s own doc
    const cp = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    const result = await validateAndCompute([noStart, cp]);
    assert.equal(result.error, undefined);
    // FinishTime itself is untouched — splitNumber pairing needs no start reference at all.
    assert.deepEqual(result.expected, [{ action: 'Finish', number: 1, time: '00:20:00', timeOfDay: '09:20:00' }]);
    // The checkpoint crossing has no elapsed time to anchor against (empty, not omitted — see
    // computeCpTimes' own doc), but its real device time-of-day is still there.
    assert.equal(result.cpTimesByCp.get(1).get(1), '');
    assert.equal(result.cpTimeOfDayByCp.get(1).get(1), '09:10:00');
  });

  it('marks a checkpoint retire with CP_RETIRE (not a computed time) in cpTimesByCp, and adds a synthetic DNF carrying its real elapsed retire time for a bib with no Finish record', async () => {
    // Bib 2 (Bob) retires at CP1 — never reaches Finish, so has no Finish-location entry at all.
    const cp = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'DNF', bibNumber: '2', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    const result = await validateAndCompute([finishRow(), cp]);
    assert.equal(result.error, undefined);
    assert.equal(result.cpTimesByCp.get(1).get(2), CP_RETIRE);
    // Bib 1's own real Finish record is untouched. Bib 2 gets a synthetic DNF added, its time
    // the actual elapsed-since-start moment of the CP1 retire (09:10 - the Finish file's own
    // 09:00 Start), not blank, plus its own device timeOfDay straight off the CP1 row's own
    // timestamp — Safety Check's Retirees tab "when" column prefers that over the elapsed value.
    assert.deepEqual(result.expected, [
      { action: 'Finish', number: 1, time: '00:20:00', timeOfDay: '09:20:00' },
      { action: 'DNF', number: 2, time: '00:10:00', timeOfDay: '09:10:00' },
    ]);
  });

  it('gives a Finish-location retire its own real elapsed time and device timeOfDay too, from its own row timestamp against the Finish file\'s Start', async () => {
    const withRetiree = finishRow();
    withRetiree.device.lines.push(
      { lineNumber: 4, action: 'DNF', bibNumber: '2', timestamp: '2026/08/30 09:15:00.00', location: 'Finish' },
    );
    const result = await validateAndCompute([withRetiree]);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.expected, [
      { action: 'Finish', number: 1, time: '00:20:00', timeOfDay: '09:20:00' },
      { action: 'DNF', number: 2, time: '00:15:00', timeOfDay: '09:15:00' },
    ]);
  });

  it('does not add a duplicate DNF when the CP-retired bib already has its own Finish-location record', async () => {
    // Bib 1 both finishes at Finish *and* has a (presumably stray/inconsistent) DNF row at CP1 —
    // Finish is authoritative, so no second entry should be added for it.
    const cp = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'DNF', bibNumber: '1', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    const result = await validateAndCompute([finishRow(), cp]);
    assert.equal(result.error, undefined);
    assert.equal(result.expected.length, 1);
    assert.deepEqual(result.expected[0], { action: 'Finish', number: 1, time: '00:20:00', timeOfDay: '09:20:00' });
  });
});

describe('mobile-files-progress.js:clearProgressData / applyComputedResults', () => {
  it('clearProgressData wipes both mobileProgress and mobileCheckpoints', async () => {
    state.mobileProgress = [{ action: 'Finish', number: 1, time: '00:20:00' }];
    state.mobileCheckpoints = [{ bibNumber: 1, cpTimes: { 1: '00:10:00' } }];
    await clearProgressData();
    assert.deepEqual(state.mobileProgress, []);
    assert.deepEqual(state.mobileCheckpoints, []);
  });

  it('applyComputedResults rebuilds mobileProgress from `expected` and marks selected files as synced', async () => {
    const expected = [{ action: 'Finish', number: 1, time: '00:20:00' }];
    const r = finishRow();
    const { added } = await applyComputedResults(expected, new Map(), [r]);
    assert.equal(added, 1);
    assert.deepEqual(state.mobileProgress, expected);
  });

  it('applyComputedResults rebuilds mobileCheckpoints from the cpTimesByCp map, one row per bib seen', async () => {
    const cpTimesByCp = new Map([[1, new Map([[1, '00:10:00']])], [2, new Map([[1, '00:15:00']])]]);
    await applyComputedResults([], cpTimesByCp, [finishRow()]);
    assert.equal(state.mobileCheckpoints.length, 1);
    assert.deepEqual(state.mobileCheckpoints[0], { bibNumber: 1, cpTimes: { 1: '00:10:00', 2: '00:15:00' } });
  });

  // The no-Finish-file case: computeCpTimes() now stores '' (not nothing) for a bib seen at a
  // checkpoint with no elapsed time to compute — this proves that's what actually makes the bib
  // appear in state.mobileCheckpoints at all (bibsSeen is derived from cpTimesByCp's own keys),
  // not just an entry in cpTimeOfDayByCp that would otherwise never get attached to anything.
  it('still creates a mobileCheckpoints row for a bib whose only cpTimes value is an empty string (seen, no elapsed time yet)', async () => {
    const cpTimesByCp = new Map([[1, new Map([[1, '']])]]);
    const cpTimeOfDayByCp = new Map([[1, new Map([[1, '09:12:34']])]]);
    await applyComputedResults([], cpTimesByCp, [finishRow()], cpTimeOfDayByCp);
    assert.equal(state.mobileCheckpoints.length, 1);
    assert.deepEqual(state.mobileCheckpoints[0], { bibNumber: 1, cpTimes: { 1: '' }, cpTimesOfDay: { 1: '09:12:34' } });
  });

  it('applyComputedResults persists timeOfDay on a mobileProgress entry that has one', async () => {
    const expected = [
      { action: 'Finish', number: 1, time: '00:20:00' },
      { action: 'DNF', number: 2, time: '00:10:00', timeOfDay: '09:10:00' },
    ];
    await applyComputedResults(expected, new Map(), [finishRow()]);
    assert.deepEqual(state.mobileProgress, expected);
  });

  it('applyComputedResults adds cpTimesOfDay to a mobileCheckpoints row when cpTimeOfDayByCp has an entry for it', async () => {
    const cpTimesByCp = new Map([[1, new Map([[1, '00:10:00']])]]);
    const cpTimeOfDayByCp = new Map([[1, new Map([[1, '19:40:00']])]]);
    await applyComputedResults([], cpTimesByCp, [finishRow()], cpTimeOfDayByCp);
    assert.deepEqual(state.mobileCheckpoints[0], { bibNumber: 1, cpTimes: { 1: '00:10:00' }, cpTimesOfDay: { 1: '19:40:00' } });
  });

  it('applyComputedResults omits cpTimesOfDay entirely when cpTimeOfDayByCp is not given', async () => {
    const cpTimesByCp = new Map([[1, new Map([[1, '00:10:00']])]]);
    await applyComputedResults([], cpTimesByCp, [finishRow()]);
    assert.deepEqual(state.mobileCheckpoints[0], { bibNumber: 1, cpTimes: { 1: '00:10:00' } });
  });
});

describe('mobile-files-progress.js:buildProgressColumns', () => {
  it('splices one column per checkpoint number in place of the single "cp" proforma column', () => {
    const base = [{ id: 'bibNumber', label: 'Bib' }, { id: 'cp', label: 'CP', title: 'Checkpoint' }, { id: 'finishTime', label: 'Finish' }];
    const cols = buildProgressColumns(base, [1, 2]);
    assert.deepEqual(cols.map(c => c.id), ['bibNumber', 'cp_1', 'cp_2', 'finishTime']);
    assert.equal(cols[1].title, 'Checkpoint 1');
  });

  it('produces no extra columns when there are no checkpoints', () => {
    const base = [{ id: 'bibNumber', label: 'Bib' }, { id: 'cp', label: 'CP', title: 'Checkpoint' }];
    const cols = buildProgressColumns(base, []);
    assert.deepEqual(cols.map(c => c.id), ['bibNumber']);
  });
});

describe('mobile-files-progress.js:buildProgressRows', () => {
  // beforeEach above seeds state.entries with bibs 1 (Alice) and 2 (Bob) — every test here
  // therefore always gets at least those two rows now, pre-populated from Entries, even before
  // any mobile data exists (the former Bib Allocations tab's own role, folded in here).
  it('pre-populates one row per entry — bib, name, course, category — with no mobile activity at all', () => {
    const rows = buildProgressRows();
    assert.deepEqual(rows.map(r => r.bibNumber), [1, 2]);
    assert.equal(rows[0].name, 'Alice');
    assert.equal(rows[0].course, 'Seniors');
    assert.equal(rows[0].category, 'MSEN');
    assert.equal(rows[0].startTime, '');
    assert.equal(rows[0].finishTime, '');
    assert.deepEqual(rows[0].cpTimes, {});
  });

  it('overlays Start/Finish/DNF records from state.mobileProgress onto an entry\'s own row', () => {
    state.mobileProgress = [
      { action: 'Start', number: 1, time: '09:00:00' },
      { action: 'Finish', number: 1, time: '09:20:00' },
      { action: 'DNF', number: 2, time: '' },
    ];
    const rows = buildProgressRows();
    assert.deepEqual(rows.map(r => r.bibNumber), [1, 2]);
    assert.equal(rows[0].startTime, '09:00:00');
    assert.equal(rows[0].finishTime, '09:20:00');
    assert.equal(rows[1].finishTime, 'DNF');
  });

  // ToDo.MD's "Random tweaks": the Progress tab shows time-of-day, not elapsed, for Start/Finish
  // (mirroring the CP columns' own cpTimesOfDay/cpTimes split) — startTime/finishTime (elapsed)
  // stay populated too, since other consumers (finishers.js/results.js/safety.js) still need a
  // 'Finish' entry's own elapsed `.time` as a genuine finish time for results computation.
  it('populates startTimeOfDay/finishTimeOfDay from timeOfDay, alongside the unchanged elapsed startTime/finishTime', () => {
    state.mobileProgress = [
      { action: 'Start', number: 1, time: '00:00:00', timeOfDay: '09:00:00' },
      { action: 'Finish', number: 1, time: '00:20:00', timeOfDay: '09:20:00' },
    ];
    const rows = buildProgressRows();
    assert.equal(rows[0].startTime, '00:00:00');
    assert.equal(rows[0].startTimeOfDay, '09:00:00');
    assert.equal(rows[0].finishTime, '00:20:00');
    assert.equal(rows[0].finishTimeOfDay, '09:20:00');
  });

  it('a DNF keeps the literal finishTime text, but still carries finishTimeOfDay separately (same as cpTimeOfDay under CP_RETIRE)', () => {
    state.mobileProgress = [{ action: 'DNF', number: 2, time: '', timeOfDay: '09:15:00' }];
    const rows = buildProgressRows();
    const row2 = rows.find(r => r.bibNumber === 2);
    assert.equal(row2.finishTime, 'DNF');
    assert.equal(row2.finishTimeOfDay, '09:15:00');
  });

  it('also includes a bib seen only at a checkpoint, never finished — the safety-relevant case', () => {
    state.mobileCheckpoints = [{ bibNumber: 2, cpTimes: { 1: '00:10:00' } }];
    const rows = buildProgressRows();
    const row2 = rows.find(r => r.bibNumber === 2);
    assert.equal(row2.finishTime, '');
    assert.deepEqual(row2.cpTimes, { 1: '00:10:00' });
  });

  it('includes a bib with mobile activity but no matching entry (not yet in Entries)', () => {
    state.mobileProgress = [{ action: 'Finish', number: 99, time: '00:30:00' }];
    const rows = buildProgressRows();
    assert.ok(rows.some(r => r.bibNumber === 99));
  });

  it('flags a row as invalid when its bib has no matching entry', () => {
    state.mobileProgress = [{ action: 'Finish', number: 99, time: '00:30:00' }];
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 99).invalid, true);
  });

  it('does not flag a row as invalid when its bib matches a real entry', () => {
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 1).invalid, false);
  });

  // Mirrors safety.js's own getConflictedBibs() — the same SI/stopwatch/mobile priority clash
  // Results & Prize List and Safety Check both resolve and warn about (resolveFinishSources() in
  // results.js) is surfaced here too, so it's never mistaken for settled, undisputed data.
  it('flags a row as conflicted when more than one source disagrees on its bib (Finish vs DNF)', () => {
    state.finishers      = [{ action: 'DNF', number: '1', time: '-' }];
    state.mobileProgress = [{ action: 'Finish', number: '1', time: '00:30:00' }];
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 1).conflict, true);
  });

  it('does not flag a row as conflicted when only one source has recorded its bib', () => {
    state.mobileProgress = [{ action: 'Finish', number: '1', time: '00:30:00' }];
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 1).conflict, false);
  });

  it('sorts by bib number', () => {
    state.mobileProgress = [{ action: 'Finish', number: 2, time: '' }, { action: 'Finish', number: 1, time: '' }];
    const rows = buildProgressRows();
    assert.deepEqual(rows.map(r => r.bibNumber), [1, 2]);
  });

  it('passes a CP_RETIRE cpTimes value straight through to the row, alongside the DNF finishTime', () => {
    state.mobileProgress = [{ action: 'DNF', number: 2, time: '' }];
    state.mobileCheckpoints = [{ bibNumber: 2, cpTimes: { 1: CP_RETIRE } }];
    const rows = buildProgressRows();
    const row2 = rows.find(r => r.bibNumber === 2);
    assert.equal(row2.finishTime, 'DNF');
    assert.deepEqual(row2.cpTimes, { 1: CP_RETIRE });
  });
});
