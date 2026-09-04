'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  validateAndCompute, clearProgressData, applyComputedResults,
  buildProgressColumns, buildProgressRows,
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
});

// A minimal Finish-location device row: one Time-mode phone with a Start + one Split, one
// Bibs-mode phone with one Finish — enough for validateAndCompute() to pair a real finish time.
function finishRow(overrides = {}) {
  return {
    owner: 'alice', raceLabel: 'race-a',
    device: {
      name: 'Finish Phone',
      lines: [
        // splitTime set (even though it's the fixed t=0 marker) so buildSegmentView classifies
        // this as the Time-mode family, not the Bibs-mode one — a Bibs-mode "Start" action also
        // exists (see BIBS_ACTION_TO_FINISHER), and only splitTime null/non-null tells them apart.
        { lineNumber: 1, action: 'Start', splitNumber: 0, splitTime: '00:00:00.00', timestamp: '2026/08/30 09:00:00.00', location: 'Finish' },
        { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: '00:20:00.00', timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
        { lineNumber: 3, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
      ],
    },
    ...overrides,
  };
}

describe('mobile-files-progress.js:validateAndCompute', () => {
  it('rejects a selection spanning more than one race', () => {
    const r1 = finishRow({ raceLabel: 'race-a' });
    const r2 = finishRow({ raceLabel: 'race-b' });
    return validateAndCompute([r1, r2]).then(result => {
      assert.match(result.error, /different races/);
    });
  });

  it('rejects a file with an empty current segment', () => {
    const empty = finishRow({ device: { name: 'Empty Phone', lines: [] } });
    return validateAndCompute([empty]).then(result => {
      assert.match(result.error, /empty/);
    });
  });

  it('rejects a file with inconsistent locations across its own lines', () => {
    const bad = finishRow();
    bad.device.lines[0].location = 'CP1'; // disagrees with the other two lines' "Finish"
    return validateAndCompute([bad]).then(result => {
      assert.match(result.error, /inconsistent locations/);
    });
  });

  it('rejects when no Finish-location file is selected at all', () => {
    const cpOnly = finishRow();
    for (const l of cpOnly.device.lines) l.location = 'CP1';
    return validateAndCompute([cpOnly]).then(result => {
      assert.match(result.error, /Select at least the Finish/);
    });
  });

  it('rejects a bib number not present in entries', () => {
    const r = finishRow();
    r.device.lines[2].bibNumber = '999';
    return validateAndCompute([r]).then(result => {
      assert.match(result.error, /not in entries/);
      assert.match(result.error, /999/);
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
    assert.deepEqual(result.expected[0], { action: 'Finish', number: 1, time: '00:20:00' });
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
  });

  it('rejects a checkpoint file when the Finish file\'s time-mode Start row is missing', async () => {
    const noStart = finishRow();
    noStart.device.lines = noStart.device.lines.filter(l => l.action !== 'Start');
    const cp = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    const result = await validateAndCompute([noStart, cp]);
    assert.match(result.error, /no Start record/);
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
  it('builds one row per bib with a Start/Finish/DNF record', () => {
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

  it('also includes a bib seen only at a checkpoint, never finished — the safety-relevant case', () => {
    state.mobileCheckpoints = [{ bibNumber: 2, cpTimes: { 1: '00:10:00' } }];
    const rows = buildProgressRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bibNumber, 2);
    assert.equal(rows[0].finishTime, '');
    assert.deepEqual(rows[0].cpTimes, { 1: '00:10:00' });
  });

  it('sorts by bib number', () => {
    state.mobileProgress = [{ action: 'Finish', number: 2, time: '' }, { action: 'Finish', number: 1, time: '' }];
    const rows = buildProgressRows();
    assert.deepEqual(rows.map(r => r.bibNumber), [1, 2]);
  });
});
