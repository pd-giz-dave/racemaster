'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import { isDirty } from '../js/storage.js';
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
  state.mobileBeaconOps = [];
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

  // Field request: "multiple devices at every location should be allowed and conflicts resolved
  // by timestamp like pen location" — a second device genuinely stationed at an already-bucketed
  // CP (or relocated there, as here) is no longer rejected outright; its own crossings merge in
  // bib-by-bib instead.
  it('merges a relocated device\'s own CP segment with another selected file\'s own crossings at the same checkpoint', () => {
    const roaming = finishRow({ device: { name: 'Roaming Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:05:00.00', location: 'CP1' },
      { lineNumber: 2, action: 'Location', bibNumber: null, splitTime: null, note: 'CP2', location: 'CP2' },
      { lineNumber: 3, action: 'Finish', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 09:15:00.00', location: 'CP2' },
    ] } });
    const cp1Again = finishRow({ device: { name: 'CP1 Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '999', timestamp: '2026/08/30 09:10:00.00', location: 'CP1' },
    ] } });
    return validateAndCompute([finishRow(), roaming, cp1Again]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.cpBuckets.get(1).length, 2); // both CP1 segments kept, not collapsed to one
      assert.equal(result.cpTimesByCp.get(1).get(1), '00:05:00'); // roaming's own bib 1
      assert.equal(result.cpTimesByCp.get(1).get(999), '00:10:00'); // cp1Again's own bib 999
    });
  });

  // The genuine-conflict case the merge above doesn't exercise: the SAME bib crossed the SAME
  // checkpoint according to two different selected devices — resolved by keeping whichever
  // device's own crossing has the later wall-clock time-of-day, same "latest wins" principle
  // mergeLatestByBeacon() already applies to Close/Count data.
  it('resolves two devices disagreeing about the same bib at the same checkpoint by keeping the later timestamp', () => {
    const cpEarly = finishRow({ device: { name: 'CP1 Early', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:05:00.00', location: 'CP1' },
    ] } });
    const cpLate = finishRow({ device: { name: 'CP1 Late', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:08:00.00', location: 'CP1' },
    ] } });
    return validateAndCompute([finishRow(), cpEarly, cpLate]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.cpTimesByCp.get(1).get(1), '00:08:00');
      assert.equal(result.cpTimeOfDayByCp.get(1).get(1), '09:08:00');
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

  // Field request: "multiple devices at every location should be allowed" — two independent
  // bibs-recording phones both at Finish, each legitimately starting its own splitNumber count at
  // 1, must not collide purely over that coincidence (paired per-segment now, never pooled first
  // — see finishSegs' own doc).
  it('does not reject two independent bibs-recording phones at Finish reusing the same small splitNumbers', () => {
    const r1 = finishRow({ device: { name: 'Bibs A', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
    ] } });
    const r2 = finishRow({ device: { name: 'Bibs B', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 09:21:00.00', location: 'Finish' },
    ] } });
    return validateAndCompute([r1, r2]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.expected.find(e => e.number === 1).action, 'Finish');
      assert.equal(result.expected.find(e => e.number === 2).action, 'Finish');
    });
  });

  // A genuine duplicate splitNumber WITHIN one device's own file is still real data corruption —
  // still rejected, just no longer confused with the legitimate multi-device case above.
  it('still rejects a genuine duplicate splitNumber within one Finish-location device\'s own file', () => {
    const corrupt = finishRow({ device: { name: 'Corrupt Phone', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
      { lineNumber: 2, action: 'Finish', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 09:21:00.00', location: 'Finish' },
    ] } });
    return validateAndCompute([corrupt]).then(result => {
      assert.match(result.error, /duplicate bib split number/);
    });
  });

  // The genuine-conflict case: the SAME bib's Finish recorded by two different selected devices —
  // resolved by keeping whichever has the later wall-clock time-of-day, same "latest wins"
  // principle mergeLatestByBeacon() already applies to Close/Count data (ToDo.MD: "multiple
  // devices at every location should be allowed and conflicts resolved by timestamp").
  it('resolves two devices disagreeing about the same bib\'s Finish by keeping the later timestamp', () => {
    const early = finishRow({ device: { name: 'Finish Early', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:20:00.00', location: 'Finish' },
    ] } });
    const late = finishRow({ device: { name: 'Finish Late', lines: [
      { lineNumber: 1, action: 'Finish', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 09:22:00.00', location: 'Finish' },
    ] } });
    return validateAndCompute([early, late]).then(result => {
      assert.equal(result.error, undefined);
      assert.equal(result.expected.length, 1);
      assert.equal(result.expected[0].timeOfDay, '09:22:00');
    });
  });

  it('computes a real finish time for a valid single-Finish-file selection', async () => {
    const result = await validateAndCompute([finishRow()]);
    assert.equal(result.error, undefined);
    assert.equal(result.expected.length, 1);
    assert.deepEqual(result.expected[0], { action: 'Finish', number: 1, time: '00:20:00', timeOfDay: '09:20:00' });
  });

  it('still rejects a genuinely unrecognised, non-numbered location', () => {
    const bad = finishRow();
    for (const l of bad.device.lines) l.location = 'Somewhere';
    return validateAndCompute([bad]).then(result => {
      assert.match(result.error, /isn't recognised as Start, Finish or a checkpoint/);
    });
  });

  // Field report: a marshal's Bibs-mode phone parked at the start line to catch early/late
  // starters (checking "This is a start event" on the phone — strings.js's own 'view-mobile-bibs'
  // help) before relocating to Finish for the main event. "Start" used to fall through
  // resolveLocationKey() as unrecognised, aborting the whole computation outright.
  describe('a "Start"-location bucket', () => {
    it('recognises a Start-location device and carries its early-starter bib into `expected` with only a timeOfDay', () => {
      const startPhone = finishRow({ device: { name: 'Start Phone', lines: [
        { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'Bibs', location: 'Start' },
        { lineNumber: 2, action: 'Start', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 08:55:00.00', location: 'Start' },
      ] } });
      return validateAndCompute([finishRow(), startPhone]).then(result => {
        assert.equal(result.error, undefined);
        assert.equal(result.startRows.length, 1);
        const startEntry = result.expected.find(e => e.action === 'Start' && e.number === 2);
        assert.deepEqual(startEntry, { action: 'Start', number: 2, time: '', timeOfDay: '08:55:00' });
      });
    });

    it('is not rejected as "empty" just because nobody actually started early/late that day', () => {
      const startPhone = finishRow({ device: { name: 'Start Phone', lines: [
        { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'Bibs', location: 'Start' },
      ] } });
      return validateAndCompute([finishRow(), startPhone]).then(result => {
        assert.equal(result.error, undefined);
        assert.equal(result.startRows.length, 1);
      });
    });

    it('does not let an unrelated Start-bucket splitNumber get paired with a Finish-bucket split', () => {
      // Both buckets happen to use splitNumber 1 for their own first real entry — independent
      // devices/locations, each restarting its own counter — this must never pair across buckets.
      const startPhone = finishRow({ device: { name: 'Start Phone', lines: [
        { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'Bibs', location: 'Start' },
        { lineNumber: 2, action: 'Start', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 08:55:00.00', location: 'Start' },
      ] } });
      return validateAndCompute([finishRow(), startPhone]).then(result => {
        assert.equal(result.error, undefined);
        const startEntry = result.expected.find(e => e.action === 'Start' && e.number === 2);
        assert.equal(startEntry.time, ''); // not the Finish bucket's own 00:20:00 split
      });
    });

    it('does not reject two independent Start-location devices reusing the same small splitNumbers', () => {
      const startA = finishRow({ device: { name: 'Start A', lines: [
        { lineNumber: 1, action: 'Start', splitNumber: 1, bibNumber: '1', timestamp: '2026/08/30 08:55:00.00', location: 'Start' },
      ] } });
      const startB = finishRow({ device: { name: 'Start B', lines: [
        { lineNumber: 1, action: 'Start', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 08:56:00.00', location: 'Start' },
      ] } });
      return validateAndCompute([startA, startB]).then(result => {
        assert.equal(result.error, undefined);
        assert.equal(result.expected.filter(e => e.action === 'Start').length, 2);
      });
    });
  });

  // Reported live: 3 genuine Bibs-mode devices ("humble-ibis", "mighty-bunting", "zingy-brook")
  // all stationed at the holding-pen location "Pen" doing a pre-race headcount, selected together
  // for Update Progress — resolveLocationKey('Pen') correctly returns { kind: 'pen' } (not null,
  // per ToDo.MD's own earlier "allow for a location of 'Pen'" fix), but the bucketing loop above
  // had no case of its own for it, so it fell into the cp-number `else` branch with key.number
  // undefined for every one of them — the first file claimed cpBuckets' one `undefined` key, and
  // every subsequent Pen-location file then collided with it: "Cannot compute results — more than
  // one file selected for CPundefined", rejecting the whole batch the moment a second Pen phone
  // was selected. 'pen' now joins the exact same bucket as 'start' (see that describe block just
  // above) — a pre-race presence confirmation, not a numbered course checkpoint — so any number of
  // them can be selected together.
  describe('a "Pen"-location bucket', () => {
    it('does not reject two simultaneously-selected Pen-location devices', async () => {
      const penA = finishRow({ device: { name: 'Pen A', lines: [
        { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'Bibs', location: 'Pen' },
        { lineNumber: 2, action: 'Start', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 08:50:00.00', location: 'Pen' },
      ] } });
      const penB = finishRow({ device: { name: 'Pen B', lines: [
        { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'Bibs', location: 'Pen' },
        { lineNumber: 2, action: 'Start', splitNumber: 1, bibNumber: '3', timestamp: '2026/08/30 08:51:00.00', location: 'Pen' },
      ] } });
      const result = await validateAndCompute([finishRow(), penA, penB]);
      assert.equal(result.error, undefined);
      assert.equal(result.startRows.length, 2);
    });

    // The actual bug report: 3 Pen phones, not 2 — locking in that this isn't just a two-file
    // coincidence (the old code's `cpBuckets.has(undefined)` check only ever fires from the
    // SECOND file onward, so a single Pen file selected alone never surfaced this at all).
    it('does not reject three simultaneously-selected Pen-location devices', async () => {
      const pens = ['humble-ibis', 'mighty-bunting', 'zingy-brook'].map((name, i) => finishRow({
        device: { name, lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: null, splitTime: null, note: 'Bibs', location: 'Pen' },
          { lineNumber: 2, action: 'Start', splitNumber: 1, bibNumber: String(10 + i), timestamp: '2026/08/30 08:5' + i + ':00.00', location: 'Pen' },
        ] },
      }));
      const result = await validateAndCompute([finishRow(), ...pens]);
      assert.equal(result.error, undefined);
      assert.equal(result.startRows.length, 3);
      assert.equal(result.expected.filter(e => e.action === 'Start').length, 3);
    });

    // Same genuine-conflict case as Finish/CP above, here for Pen/Start: the SAME bib recorded by
    // two different Pen devices resolves to whichever has the later timestamp, rather than two
    // separate 'Start' entries for the one bib.
    it('resolves two Pen devices disagreeing about the same bib by keeping the later timestamp', async () => {
      const penA = finishRow({ device: { name: 'Pen A', lines: [
        { lineNumber: 1, action: 'Start', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 08:50:00.00', location: 'Pen' },
      ] } });
      const penB = finishRow({ device: { name: 'Pen B', lines: [
        { lineNumber: 1, action: 'Start', splitNumber: 1, bibNumber: '2', timestamp: '2026/08/30 08:52:00.00', location: 'Pen' },
      ] } });
      const result = await validateAndCompute([finishRow(), penA, penB]);
      assert.equal(result.error, undefined);
      assert.equal(result.expected.filter(e => e.action === 'Start' && e.number === 2).length, 1);
      assert.equal(result.expected.find(e => e.action === 'Start' && e.number === 2).timeOfDay, '08:52:00');
    });
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

  // racemaster-mobile's newer Close recording mode — a dedicated phone presents each beacon,
  // logging a 'Close' row (battery read, then powered off) rather than any Bib/Time entry.
  // Before the classification fix (mobile-files-devices.js's own rowFamily), this fell into the
  // Bibs family's default and then got silently dropped (not in TRANSFERABLE_BIBS_ACTIONS) —
  // confirmed in the field as beacon close data never showing up anywhere once pulled.
  describe('Close/Count-mode devices', () => {
    function closeRow(overrides = {}) {
      const merged = {
        owner: 'alice', raceLabel: 'race-a',
        device: {
          name: 'Close Phone',
          lines: [
            { lineNumber: 1, action: 'Location', note: 'Close', location: 'Close' },
            { lineNumber: 2, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null, location: 'Close' },
            { lineNumber: 3, action: 'Close', note: 'beacon=5 battery=80', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:10:00', location: 'Close' },
          ],
        },
        ...overrides,
      };
      if (!merged.device.resolvedLines) merged.device.resolvedLines = merged.device.lines;
      return merged;
    }

    function countRow(overrides = {}) {
      const merged = {
        owner: 'alice', raceLabel: 'race-a',
        device: {
          name: 'Count Phone',
          lines: [
            { lineNumber: 1, action: 'Location', note: 'Start', location: 'Start' },
            { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null, location: 'Start' },
            { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:15:00', location: 'Start' },
          ],
        },
        ...overrides,
      };
      if (!merged.device.resolvedLines) merged.device.resolvedLines = merged.device.lines;
      return merged;
    }

    it('extracts a Close row\'s beacon number, closedAt and battery into closeByBeacon, without erroring', async () => {
      const result = await validateAndCompute([closeRow()]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.closeByBeacon.get(5), {
        at: '2026/08/30 09:10:00', closedAt: '2026/08/30 09:10:00', batteryPercent: 80, closeCount: 1,
      });
      assert.equal(result.countByBeacon.size, 0);
      // Diverted entirely before location bucketing — never counted as a Finish/Start/CP file.
      assert.equal(result.finishRows.length, 0);
      assert.equal(result.startRows.length, 0);
      assert.equal(result.cpBuckets.size, 0);
      assert.deepEqual(result.expected, []);
    });

    it('extracts a CountSeen row\'s beacon number and countedAt into countByBeacon, without erroring', async () => {
      const result = await validateAndCompute([countRow()]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.countByBeacon.get(9), { at: '2026/08/30 09:15:00', countedAt: '2026/08/30 09:15:00' });
      assert.equal(result.closeByBeacon.size, 0);
    });

    // The actual bug the peer session flagged: Count's forced "Start" location is identical to a
    // genuine Bibs-mode early/late-starters phone's own "Start" location, but the two must never
    // be conflated — a Count-mode device's beacon sightings must not feed expectedFinisherEntries
    // as if they were early/late-starter bibs.
    it('does not sweep a Count-mode device into the Start-location early-starters bucket', async () => {
      const result = await validateAndCompute([countRow()]);
      assert.equal(result.error, undefined);
      assert.equal(result.startRows.length, 0);
      assert.deepEqual(result.expected, []);
    });

    // ToDo.MD: "allow for CountEjected in the device file and remove counted from progress when
    // seen" — the beacon still carries a countByBeacon entry (needed so a cross-device merge can
    // compare it, see computeCountByBeacon's own doc), but with countedAt null, which is what
    // buildProgressRows()'s own overlay (via applyComputedResults()'s beaconOps) reads as
    // "not counted" — same as there being no entry at all.
    it('a CountEjected row removes that beacon\'s countedAt from countByBeacon', async () => {
      const ejected = countRow();
      ejected.device.lines.push(
        { lineNumber: 4, action: 'CountEjected', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:20:00', location: 'Start', refLineNumber: 3 },
      );
      const result = await validateAndCompute([ejected]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.countByBeacon.get(9), { at: '2026/08/30 09:20:00', countedAt: null });
    });

    // The actual bug this fixes (reported live on race "callow-seniors", device "witty-warbler",
    // beacon 1/bib 801): a second Count-mode device ("swift-puffin") had also recorded an earlier,
    // un-ejected CountSeen for the same beacon — ejecting it on witty-warbler alone had no way to
    // retract swift-puffin's own, older, still-"counted" entry once the two were merged, since an
    // eject used to leave no trace at all once applied locally (no countByBeacon entry to compare
    // against). Carrying the eject's own timestamp through to the merge is what lets a genuinely
    // later eject on one device beat an earlier, un-ejected sighting on another.
    it('a later CountEjected on one device beats an earlier un-ejected CountSeen on another selected device', async () => {
      const laterEject = countRow();
      laterEject.device.lines.push(
        { lineNumber: 4, action: 'CountEjected', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:20:00', location: 'Start', refLineNumber: 3 },
      );
      const otherDeviceStillCounted = countRow({
        device: {
          name: 'Other Count Phone',
          lines: [
            { lineNumber: 1, action: 'Location', note: 'Start', location: 'Start' },
            { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null, location: 'Start' },
            { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:16:00', location: 'Start' },
          ],
        },
      });
      const result = await validateAndCompute([laterEject, otherDeviceStillCounted]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.countByBeacon.get(9), { at: '2026/08/30 09:20:00', countedAt: null });
    });

    // Reported live (race "callow-seniors", device "swift-puffin", beacon 1): a CountEjected
    // followed later by a CountUnejected (racemaster-mobile's own HistoryAction.COUNT_UNEJECTED,
    // reversing the eject) left Update Progress still treating the beacon as ejected forever,
    // because computeCountByBeacon used to skip CountUnejected rows entirely rather than
    // re-setting countedAt the way CountSeen does. The mobile app's own CountUnejected row has no
    // bibNumber/refLineNumber yet (a separate, already-known gap there), but its note still
    // carries "beacon=N", which is all computeCountByBeacon ever reads.
    it('a CountUnejected row restores that beacon\'s countedAt after a prior CountEjected', async () => {
      const unejected = countRow();
      unejected.device.lines.push(
        { lineNumber: 4, action: 'CountEjected', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:20:00', location: 'Start', refLineNumber: 3 },
        { lineNumber: 5, action: 'CountUnejected', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:25:00', location: 'Start', refLineNumber: null },
      );
      const result = await validateAndCompute([unejected]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.countByBeacon.get(9), { at: '2026/08/30 09:25:00', countedAt: '2026/08/30 09:25:00' });
    });

    // ToDo.MD: "allow for reset within a count segment and remove counted from progress when
    // seen" — racemaster-mobile's own CountModeViewModel.resetCountMode() writes a plain Reset
    // row targeting the Count visit's own Location row (RaceRepository.closeCurrentSegment,
    // "zero server-side changes needed" per that function's own doc), then Count mode is started
    // again later with a fresh Location/ModeStart pair of its own (same recordModeStart
    // transaction every mode uses) — the same generic, mode-agnostic Reset-closing
    // mobile-files-devices.js's own currentSegment() already applies to every family closes the
    // earlier visit out, so a beacon counted before the Reset simply isn't part of the current
    // segment any more, and applyComputedResults()'s wholesale rebuild (see its own doc) then
    // never re-adds it to state.mobileBeaconOps on the next Update Progress run.
    it('a Reset that closes a Count visit removes a previously-counted beacon from countByBeacon', async () => {
      const reset = countRow();
      reset.device.lines.push(
        { lineNumber: 4, action: 'Reset', refLineNumber: 1 },
        { lineNumber: 5, action: 'Location', note: 'Start', location: 'Start' },
        { lineNumber: 6, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null, location: 'Start' },
      );
      const result = await validateAndCompute([reset]);
      assert.equal(result.error, undefined);
      assert.equal(result.countByBeacon.has(9), false);
    });

    it('keeps a Close-mode selection alongside an ordinary Finish-location selection, both computed independently', async () => {
      const result = await validateAndCompute([finishRow(), closeRow()]);
      assert.equal(result.error, undefined);
      assert.equal(result.expected.length, 1);
      assert.equal(result.expected[0].action, 'Finish');
      assert.deepEqual(result.closeByBeacon.get(5), {
        at: '2026/08/30 09:10:00', closedAt: '2026/08/30 09:10:00', batteryPercent: 80, closeCount: 1,
      });
    });

    it('takes the latest close by lineNumber when a beacon is re-presented to the same device', async () => {
      const reclosed = closeRow();
      reclosed.device.lines.push(
        { lineNumber: 4, action: 'Close', note: 'beacon=5 battery=60', bibNumber: null, splitTime: null, timestamp: '2026/08/30 10:00:00', location: 'Close' },
      );
      const result = await validateAndCompute([reclosed]);
      assert.equal(result.error, undefined);
      // closeCount is a running count of every Close row for this beacon this segment (never
      // deduplicated client-side — see computeCloseByBeacon's own doc), so a re-presentation
      // bumps it to 2 even though only the latest closedAt/batteryPercent wins.
      assert.deepEqual(result.closeByBeacon.get(5), {
        at: '2026/08/30 10:00:00', closedAt: '2026/08/30 10:00:00', batteryPercent: 60, closeCount: 2,
      });
    });

    it('sums closeCount across two selected devices that both closed the same beacon, keeping the later one\'s closedAt/batteryPercent', async () => {
      const secondClosePhone = closeRow({
        device: {
          name: 'Second Close Phone',
          lines: [
            { lineNumber: 1, action: 'Location', note: 'Close', location: 'Close' },
            { lineNumber: 2, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null, location: 'Close' },
            { lineNumber: 3, action: 'Close', note: 'beacon=5 battery=50', bibNumber: null, splitTime: null, timestamp: '2026/08/30 11:00:00', location: 'Close' },
          ],
        },
      });
      const result = await validateAndCompute([closeRow(), secondClosePhone]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.closeByBeacon.get(5), {
        at: '2026/08/30 11:00:00', closedAt: '2026/08/30 11:00:00', batteryPercent: 50, closeCount: 2,
      });
    });

    // ToDo.MD: "allow for multiple devices reporting the same thing, e.g. 2 count phones recording
    // CountSeen" — already handled by the same generic mergeLatestByBeacon() used above for Close;
    // this just locks in that Count gets the identical cross-device treatment.
    it('takes the latest countedAt across two selected Count-mode devices that both saw the same beacon', async () => {
      const secondCountPhone = countRow({
        device: {
          name: 'Second Count Phone',
          lines: [
            { lineNumber: 1, action: 'Location', note: 'Start', location: 'Start' },
            { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null, location: 'Start' },
            { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:20:00', location: 'Start' },
          ],
        },
      });
      const result = await validateAndCompute([countRow(), secondCountPhone]);
      assert.equal(result.error, undefined);
      // Unlike Close's closeCount, a Count entry carries nothing to accumulate across devices
      // (see computeCountByBeacon's own doc) — mergeLatestByBeacon just keeps whichever device's
      // sighting is later.
      assert.deepEqual(result.countByBeacon.get(9), { at: '2026/08/30 09:20:00', countedAt: '2026/08/30 09:20:00' });
    });

    // The feature this session added: a closed beacon heard advertising again (racemaster-mobile's
    // own HistoryAction.CLOSE_REOPENED) must be reinstated as outstanding here, not still "closed"
    // — see computeCloseByBeacon's own doc.
    it('a CloseReopened row after a Close reinstates the beacon as outstanding (no closedAt/batteryPercent), keeping its closeCount', async () => {
      const reopened = closeRow();
      reopened.device.lines.push(
        { lineNumber: 4, action: 'CloseReopened', note: 'beacon=5', bibNumber: null, splitTime: null, timestamp: '2026/08/30 10:30:00', location: 'Close' },
      );
      const result = await validateAndCompute([reopened]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.closeByBeacon.get(5), { at: '2026/08/30 10:30:00', closeCount: 1 });
    });

    it('a Close after a CloseReopened re-closes the beacon normally, bumping closeCount again', async () => {
      const reclosedAfterReopen = closeRow();
      reclosedAfterReopen.device.lines.push(
        { lineNumber: 4, action: 'CloseReopened', note: 'beacon=5', bibNumber: null, splitTime: null, timestamp: '2026/08/30 10:30:00', location: 'Close' },
        { lineNumber: 5, action: 'Close', note: 'beacon=5 battery=55', bibNumber: null, splitTime: null, timestamp: '2026/08/30 11:00:00', location: 'Close' },
      );
      const result = await validateAndCompute([reclosedAfterReopen]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.closeByBeacon.get(5), {
        at: '2026/08/30 11:00:00', closedAt: '2026/08/30 11:00:00', batteryPercent: 55, closeCount: 2,
      });
    });

    // The bug this test guards: closeSegment/countSegment used to be checked with an if/continue
    // each, so a device with BOTH non-empty (repurposed mid-race — Count mode for the pre-start
    // headcount, then relocated into Close mode afterwards, same physical phone/file) only ever
    // had its close data counted, since that check ran first and `continue`d before the count
    // check ever ran — confirmed in the field: Count data never reaching the Progress tab's own
    // Counted column whenever a device had also been used for Close.
    it('processes both segments of a device repurposed from Count to Close mode, not just whichever is checked first', async () => {
      const repurposed = countRow({
        device: {
          name: 'Repurposed Phone',
          lines: [
            { lineNumber: 1, action: 'Location', note: 'Start', location: 'Start' },
            { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null, location: 'Start' },
            { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:15:00', location: 'Start' },
            { lineNumber: 4, action: 'Location', note: 'Close', location: 'Close' },
            { lineNumber: 5, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null, location: 'Close' },
            { lineNumber: 6, action: 'Close', note: 'beacon=5 battery=80', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:20:00', location: 'Close' },
          ],
        },
      });
      const result = await validateAndCompute([repurposed]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.countByBeacon.get(9), { at: '2026/08/30 09:15:00', countedAt: '2026/08/30 09:15:00' });
      assert.deepEqual(result.closeByBeacon.get(5), {
        at: '2026/08/30 09:20:00', closedAt: '2026/08/30 09:20:00', batteryPercent: 80, closeCount: 1,
      });
    });

    // The bug this test guards: a once-Close/Count-only device that's since been fully
    // repurposed to Bibs/CP (same physical phone/file, a new NewRace/Location/ModeStart cycle)
    // keeps its EARLIER, never-explicitly-Reset Count visit "current" forever in its own family
    // bucket (buildSegmentView()'s own per-family Reset scoping) — `continue`ing out of the
    // per-device loop just because that old segment was still non-empty used to silently drop
    // its genuinely current CP passes too, never even reaching cpBuckets (confirmed in the
    // field, ToDo.MD: "progress tab is not being updated by checkpoint passes").
    it('still buckets a device\'s genuine CP location data after it was repurposed from a never-reset Count session', async () => {
      const repurposed = countRow({
        device: {
          name: 'Repurposed CP Phone',
          lines: [
            // The earlier Count session — deliberately never Reset, same as the real-world case.
            { lineNumber: 1, action: 'Location', note: 'Pen', location: 'Pen' },
            { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null, location: 'Pen' },
            { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:15:00', location: 'Pen' },
            { lineNumber: 4, action: 'CountComplete', note: 'of=1', bibNumber: null, splitTime: null, timestamp: '2026/08/30 09:15:00', location: 'Pen' },
            // Repurposed to CP1 — a genuinely new NewRace/Location/ModeStart cycle.
            { lineNumber: 5, action: 'NewRace', bibNumber: null, splitTime: null, location: null },
            { lineNumber: 6, action: 'Location', note: 'CP1', location: 'CP1' },
            { lineNumber: 7, action: 'ModeStart', note: 'CP', bibNumber: null, splitTime: null, location: 'CP1' },
            { lineNumber: 8, action: 'Pass', bibNumber: 101, splitNumber: 1, timestamp: '2026/08/30 09:20:00', location: 'CP1' },
          ],
        },
      });
      const result = await validateAndCompute([repurposed]);
      assert.equal(result.error, undefined);
      assert.deepEqual(result.countByBeacon.get(9), { at: '2026/08/30 09:15:00', countedAt: '2026/08/30 09:15:00' });
      assert.equal(result.cpBuckets.size, 1);
      assert.ok(result.cpBuckets.has(1));
    });
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

  // Field report: every Ping re-ran auto-update, which cleared and rewrote identical arrays and
  // bumped the dataset's server version every few seconds with nothing actually changed.
  it('applyComputedResults leaves an identical rebuild unsaved', async () => {
    const expected = [{ action: 'Finish', number: 1, time: '00:20:00' }];
    const cpTimesByCp = new Map([[1, new Map([[1, '00:10:00']])]]);
    await applyComputedResults(expected, cpTimesByCp, [finishRow()]);
    localStorage.removeItem('racemaster-dirty');

    await applyComputedResults(expected, cpTimesByCp, [finishRow()]);

    assert.equal(isDirty(), false);
    assert.deepEqual(state.mobileProgress, expected);
  });

  it('applyComputedResults still saves a rebuild that changed', async () => {
    await applyComputedResults([{ action: 'Finish', number: 1, time: '00:20:00' }], new Map(), [finishRow()]);
    localStorage.removeItem('racemaster-dirty');

    await applyComputedResults([{ action: 'Finish', number: 1, time: '00:21:00' }], new Map(), [finishRow()]);

    assert.equal(isDirty(), true);
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

  describe('mobileBeaconOps (Close/Count-mode persistence)', () => {
    it('rebuilds mobileBeaconOps from closeByBeacon/countByBeacon, one row per distinct beacon', async () => {
      const closeByBeacon = new Map([[5, { closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }]]);
      const countByBeacon = new Map([[9, { at: '2026/08/30 09:15:00', countedAt: '2026/08/30 09:15:00' }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon, countByBeacon);
      assert.deepEqual(state.mobileBeaconOps, [
        { beaconNumber: 5, closedAt: '2026/08/30 09:10:00', batteryPercent: 80 },
        { beaconNumber: 9, countedAt: '2026/08/30 09:15:00' },
      ]);
    });

    it('a beacon both closed and counted (by two different selected devices) carries both sets of fields in one row', async () => {
      const closeByBeacon = new Map([[5, { closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }]]);
      const countByBeacon = new Map([[5, { at: '2026/08/30 08:00:00', countedAt: '2026/08/30 08:00:00' }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon, countByBeacon);
      assert.deepEqual(state.mobileBeaconOps, [
        { beaconNumber: 5, closedAt: '2026/08/30 09:10:00', batteryPercent: 80, countedAt: '2026/08/30 08:00:00' },
      ]);
    });

    // An ejected beacon's countByBeacon entry carries countedAt:null (see computeCountByBeacon's
    // own doc) — must come out of beaconOps with no countedAt field at all, not a literal null.
    it('omits countedAt entirely from beaconOps for a beacon with no countedAt (ejected)', async () => {
      const countByBeacon = new Map([[9, { at: '2026/08/30 09:20:00', countedAt: null }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), new Map(), countByBeacon);
      assert.deepEqual(state.mobileBeaconOps, [{ beaconNumber: 9 }]);
    });

    it('clearProgressData wipes mobileBeaconOps too', async () => {
      state.mobileBeaconOps = [{ beaconNumber: 5, closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }];
      await clearProgressData();
      assert.deepEqual(state.mobileBeaconOps, []);
    });

    it('leaves an identical beaconOps rebuild unsaved, same as mobileProgress/mobileCheckpoints', async () => {
      const closeByBeacon = new Map([[5, { closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon);
      localStorage.removeItem('racemaster-dirty');

      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon);

      assert.equal(isDirty(), false);
    });

    it('saves when only the beaconOps rebuild changed, even with mobileProgress/mobileCheckpoints identical', async () => {
      await applyComputedResults([], new Map(), [finishRow()]);
      localStorage.removeItem('racemaster-dirty');

      const closeByBeacon = new Map([[5, { closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon);

      assert.equal(isDirty(), true);
      assert.deepEqual(state.mobileBeaconOps, [{ beaconNumber: 5, closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }]);
    });

    // A beacon whose closeByBeacon entry has no closedAt (computeCloseByBeacon's own shape for a
    // reopened beacon — see its own doc) must come out of beaconOps with neither closedAt nor
    // batteryPercent, but still carrying whatever closeCount it has, so buildProgressRows()' own
    // overlay shows it as outstanding again instead of still-closed.
    it('omits closedAt/batteryPercent from beaconOps for a beacon with no closedAt (reopened), but keeps its closeCount', async () => {
      const closeByBeacon = new Map([[5, { closeCount: 2 }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon);
      assert.deepEqual(state.mobileBeaconOps, [{ beaconNumber: 5, closeCount: 2 }]);
    });
  });

  // ToDo.MD: "Beacons tab still has read beacons report, now redundant as update progress should
  // do it from entries in the selected device files" + "beacons page not updating with progress
  // results - total hours" — applyComputedResults() now calls js/mobile-beacons.js directly with
  // this run's own closeByBeacon, rather than that being a separate, manually-triggered action.
  describe('Beacons catalogue housekeeping (Close-mode data applied directly, no separate report-read step)', () => {
    beforeEach(() => {
      state.beacons = [{ number: 5, owner: '', dateAcquired: '', totalHours: 2, batteryLevel: 100, lastUsed: '', lost: '', notes: '' }];
      state.beaconReports = [];
      state.event = {
        date: '30/08/2026', startTime: '09:00:00', juniorStartTime: '', juniorLimit: 'None',
        timingMethod: 'Beacons', juniorTimingMethod: 'Stopwatch',
      };
    });

    it('updates the catalogue\'s battery/lastUsed/totalHours straight from this run\'s closeByBeacon', async () => {
      const closeByBeacon = new Map([[5, { closedAt: '2026/08/30 09:10:00', batteryPercent: 45, closeCount: 1 }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon);
      assert.equal(state.beacons[0].batteryLevel, 45);
      assert.equal(state.beacons[0].lastUsed, '30/08/2026');
      assert.ok(state.beacons[0].totalHours > 2); // accumulated on top of the existing 2, not just overwritten
    });

    it('populates state.beaconReports for this race, so the Beacons tab reflects it with no manual read', async () => {
      const closeByBeacon = new Map([[5, { closedAt: '2026/08/30 09:10:00', batteryPercent: 45, closeCount: 1 }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon);
      const report = state.beaconReports.find(r => r.raceLabel === 'race-a'); // finishRow()'s own raceLabel
      assert.ok(report);
      assert.deepEqual(report.returned, [5]);
    });

    it('leaves the catalogue and state.beaconReports untouched when this run has no Close-mode data', async () => {
      await applyComputedResults([{ action: 'Finish', number: 1, time: '00:20:00' }], new Map(), [finishRow()]);
      assert.equal(state.beacons[0].totalHours, 2);
      assert.equal(state.beaconReports.length, 0);
    });
  });

  // ToDo.MD: "beacons page should have status and as at columns ... those states can cross race
  // boundaries" — applyComputedResults() also keeps the catalogue's own status/asAt current from
  // this run's closeByBeacon/countByBeacon, independently of the beaconReports housekeeping above.
  describe('Beacon status/asAt (crosses race boundaries)', () => {
    beforeEach(() => {
      state.beacons = [{ number: 5, owner: '', dateAcquired: '', totalHours: 2, batteryLevel: 100, lastUsed: '', lost: '', notes: '', status: '', asAt: '' }];
      state.beaconReports = [];
      state.entries = [{ bibNumber: 1, dibberNumber: 5 }];
      state.event = {
        date: '30/08/2026', startTime: '09:00:00', juniorStartTime: '', juniorLimit: 'None',
        timingMethod: 'Beacons', juniorTimingMethod: 'Stopwatch',
      };
    });

    it('marks an allocated beacon with no close/count data this run as issued', async () => {
      await applyComputedResults([{ action: 'Finish', number: 1, time: '00:20:00' }], new Map(), [finishRow()]);
      assert.equal(state.beacons[0].status, 'issued');
    });

    it('marks a counted beacon on-course, stamping asAt from countByBeacon', async () => {
      const countByBeacon = new Map([[5, { at: '2026/08/30 08:15:00', countedAt: '2026/08/30 08:15:00' }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), new Map(), countByBeacon);
      assert.equal(state.beacons[0].status, 'on-course');
      assert.equal(state.beacons[0].asAt, '2026/08/30 08:15:00');
    });

    it('marks a closed beacon returned, taking priority over counted', async () => {
      const closeByBeacon = new Map([[5, { closedAt: '2026/08/30 09:10:00', batteryPercent: 45, closeCount: 1 }]]);
      const countByBeacon = new Map([[5, { at: '2026/08/30 08:15:00', countedAt: '2026/08/30 08:15:00' }]]);
      await applyComputedResults([], new Map(), [finishRow()], new Map(), closeByBeacon, countByBeacon);
      assert.equal(state.beacons[0].status, 'returned');
      assert.equal(state.beacons[0].asAt, '2026/08/30 09:10:00');
    });

    it('leaves a previous race\'s status alone when this race\'s selection never touches the beacon', async () => {
      state.beacons[0].status = 'returned';
      state.beacons[0].asAt = '2026/07/01 12:00:00';
      state.entries = []; // not allocated this race either
      await applyComputedResults([{ action: 'Finish', number: 1, time: '00:20:00' }], new Map(), [finishRow()]);
      assert.equal(state.beacons[0].status, 'returned');
      assert.equal(state.beacons[0].asAt, '2026/07/01 12:00:00');
    });
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

  it('carries an entry\'s dibberNumber onto its row as both fobNumber and (only when Beacons-timed) beaconNumber', () => {
    state.event.timingMethod = 'Beacons';
    state.entries[0].dibberNumber = 7; // a beacon number, since this course is Beacons-timed
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 1).fobNumber, 7);
    assert.equal(rows.find(r => r.bibNumber === 1).beaconNumber, 7);
    assert.equal(rows.find(r => r.bibNumber === 2).fobNumber, 0);
    assert.equal(rows.find(r => r.bibNumber === 2).beaconNumber, 0);
  });

  it('exposes fobNumber from entry.dibberNumber regardless of timing method, but only surfaces it as beaconNumber when Beacons-timed', () => {
    state.event.timingMethod = 'Dibbers'; // Seniors — both test entries are on this course
    state.entries[0].dibberNumber = 42;
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 1).fobNumber, 42);
    assert.equal(rows.find(r => r.bibNumber === 1).beaconNumber, 0); // Dibbers-timed — not a beacon
  });

  it('leaves fobReturned empty when no fob is allocated, or this entry\'s course has had no beacons report read yet', () => {
    state.event.timingMethod = 'Beacons';
    state.entries[0].dibberNumber = 42;
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 1).fobReturned, '');
    assert.equal(rows.find(r => r.bibNumber === 2).fobReturned, '');
  });

  it('flags fobReturned from the beacons report matching this entry\'s own course', () => {
    state.event = { name: 'Test Race', date: '23/08/2026', timingMethod: 'Beacons' };
    state.entries[0].dibberNumber = 7;
    state.entries[1].dibberNumber = 9;
    state.beaconReports = [{
      raceLabel: 'testrace-seniors-26-08-23', generatedAt: '', processedAt: '',
      returned: [7], missing: [9],
    }];
    const rows = buildProgressRows();
    assert.equal(rows.find(r => r.bibNumber === 1).fobReturned, 'returned');
    assert.equal(rows.find(r => r.bibNumber === 2).fobReturned, 'missing');
  });

  // ToDo.MD line 320: "the CP and finish records received from the mobile app, or read from the
  // server, is unaffected" by the timing method — matching is bib-number-only regardless of
  // whether a course uses Stopwatch, Dibbers or Beacons.
  it('matches a mobile CP/finish record to an entry by bib number alone, regardless of its course\'s timing method', () => {
    for (const timingMethod of ['Stopwatch', 'Dibbers', 'Beacons']) {
      state.event = { timingMethod, juniorTimingMethod: timingMethod };
      state.mobileProgress = [{ action: 'Finish', number: 1, time: '00:30:00' }];
      const rows = buildProgressRows();
      const row1 = rows.find(r => r.bibNumber === 1);
      assert.equal(row1.finishTime, '00:30:00');
      assert.equal(row1.name, 'Alice');
    }
  });

  it('passes a CP_RETIRE cpTimes value straight through to the row, alongside the DNF finishTime', () => {
    state.mobileProgress = [{ action: 'DNF', number: 2, time: '' }];
    state.mobileCheckpoints = [{ bibNumber: 2, cpTimes: { 1: CP_RETIRE } }];
    const rows = buildProgressRows();
    const row2 = rows.find(r => r.bibNumber === 2);
    assert.equal(row2.finishTime, 'DNF');
    assert.deepEqual(row2.cpTimes, { 1: CP_RETIRE });
  });

  describe('beaconClosedAt/beaconBatteryPercent/beaconCountedAt (Close/Count-mode overlay)', () => {
    it('defaults all three to blank/null when state.mobileBeaconOps has nothing for this entry\'s beacon', () => {
      state.event.timingMethod = 'Beacons';
      state.entries[0].dibberNumber = 5;
      const rows = buildProgressRows();
      const row1 = rows.find(r => r.bibNumber === 1);
      assert.equal(row1.beaconClosedAt, '');
      assert.equal(row1.beaconBatteryPercent, null);
      assert.equal(row1.beaconCountedAt, '');
    });

    it('stamps beaconClosedAt/beaconBatteryPercent from mobileBeaconOps, matched by beacon number', () => {
      state.event.timingMethod = 'Beacons';
      state.entries[0].dibberNumber = 5;
      state.mobileBeaconOps = [{ beaconNumber: 5, closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }];
      const rows = buildProgressRows();
      const row1 = rows.find(r => r.bibNumber === 1);
      assert.equal(row1.beaconClosedAt, '2026/08/30 09:10:00');
      assert.equal(row1.beaconBatteryPercent, 80);
    });

    it('stamps beaconCountedAt from mobileBeaconOps independently of beaconClosedAt', () => {
      state.event.timingMethod = 'Beacons';
      state.entries[1].dibberNumber = 9;
      state.mobileBeaconOps = [{ beaconNumber: 9, countedAt: '2026/08/30 09:15:00' }];
      const rows = buildProgressRows();
      const row2 = rows.find(r => r.bibNumber === 2);
      assert.equal(row2.beaconCountedAt, '2026/08/30 09:15:00');
      assert.equal(row2.beaconClosedAt, '');
    });

    // beaconNumber is only ever non-zero for a Beacons-timed entry (buildProgressRows()'s own
    // doc) — a dibber-timed entry must never pick up a stray match even if a mobileBeaconOps row
    // happens to share the same number by coincidence (dibber short codes and beacon numbers are
    // drawn from unrelated pools).
    it('never stamps a dibber-timed entry, even if its own fobNumber happens to match a beaconNumber in mobileBeaconOps', () => {
      state.event.timingMethod = 'Dibbers';
      state.entries[0].dibberNumber = 5;
      state.mobileBeaconOps = [{ beaconNumber: 5, closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }];
      const rows = buildProgressRows();
      const row1 = rows.find(r => r.bibNumber === 1);
      assert.equal(row1.fobNumber, 5);
      assert.equal(row1.beaconClosedAt, '');
    });

    // ToDo.MD: "when there is no count record for a [row] the counted column should highlight
    // 'not seen'".
    describe('beaconCountNotSeen', () => {
      it('flags a beacon-timed entry with no countedAt once Count mode has genuinely run this race (some other beacon has a countedAt)', () => {
        state.event.timingMethod = 'Beacons';
        state.entries[0].dibberNumber = 5; // never counted
        state.entries[1].dibberNumber = 9;
        state.mobileBeaconOps = [{ beaconNumber: 9, countedAt: '2026/08/30 09:15:00' }];
        const rows = buildProgressRows();
        assert.equal(rows.find(r => r.bibNumber === 1).beaconCountNotSeen, true);
        assert.equal(rows.find(r => r.bibNumber === 2).beaconCountNotSeen, false);
      });

      it('leaves beaconCountNotSeen false for every entry when Count mode never ran this race at all (mobileBeaconOps has no countedAt anywhere)', () => {
        state.event.timingMethod = 'Beacons';
        state.entries[0].dibberNumber = 5; // never counted
        state.entries[1].dibberNumber = 9;
        state.mobileBeaconOps = [{ beaconNumber: 9, closedAt: '2026/08/30 09:10:00', batteryPercent: 80 }];
        const rows = buildProgressRows();
        assert.equal(rows.find(r => r.bibNumber === 1).beaconCountNotSeen, false);
        assert.equal(rows.find(r => r.bibNumber === 2).beaconCountNotSeen, false);
      });

      it('never flags a dibber-timed entry, even once Count mode has run this race', () => {
        state.event.timingMethod = 'Dibbers';
        state.entries[0].dibberNumber = 5;
        state.mobileBeaconOps = [{ beaconNumber: 9, countedAt: '2026/08/30 09:15:00' }];
        const rows = buildProgressRows();
        assert.equal(rows.find(r => r.bibNumber === 1).beaconCountNotSeen, false);
      });
    });
  });
});
