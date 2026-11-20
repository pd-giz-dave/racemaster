'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock } from './helpers/mock-browser.js';
import { selectedKeys, rowKey } from '../js/mobile-files-shared.js';
import {
  formatCount, buildSegmentView, whenOf, locationSummary, rawLocationOf, resolveLocationKey,
  distinctLocationsOf, flattenDevices, flattenAllFiles, latestStartedAt, withResolvedLocations,
  deviceViewOptions, collapsePingRuns, isDeviceOffline,
} from '../js/mobile-files-devices.js';

beforeEach(() => {
  installLocalStorageMock();
  selectedKeys.clear();
  state.event.name = '';
  state.event.date = '';
});

describe('mobile-files-devices.js:formatCount', () => {
  it('with no `expected` argument, shows nothing for zero, otherwise the count as a string', () => {
    assert.equal(formatCount(0), '');
    assert.equal(formatCount(3), '3');
  });

  it('expected:true always shows a literal count, including "0" — a real expectation with nothing recorded yet', () => {
    assert.equal(formatCount(0, true), '0');
    assert.equal(formatCount(3, true), '3');
  });

  it('expected:false shows blank for a genuine zero, but a real non-zero count always wins — never hide actually-recorded data', () => {
    assert.equal(formatCount(0, false), '');
    assert.equal(formatCount(3, false), '3');
  });
});

describe('mobile-files-devices.js:buildSegmentView', () => {
  it('splits Time (splitTime non-null) rows from Bibs/CP (splitTime null) rows', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { splitTime: '00:10:00', lineNumber: 2, action: 'Split' },
      { bibNumber: 5, lineNumber: 2, action: 'Finish' },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.equal(timeSegment.filter(r => r.action === 'Split').length, 1);
    assert.equal(bibsSegment.filter(r => r.action === 'Finish').length, 1);
  });

  // racemaster-mobile's SyncRecordMapping.toSyncRecord sends a null splitTime for EVERY
  // Location row now, Time-mode included (it's a boundary marker, never a real timed split —
  // same treatment as ModeStart/Ping) — so unlike every other row, a Location row can no longer
  // be told apart from a Bibs/CP one by splitTime alone. It's classified instead by the
  // ModeStart row immediately following it (see locationRowIsTimeFamily's own doc).
  it('classifies a Time-mode Location row (null splitTime) as Time via its own following ModeStart, not Bibs', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { lineNumber: 2, action: 'ModeStart', note: 'Time', splitTime: null },
      { splitTime: '00:10:00', lineNumber: 3, action: 'Split' },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.equal(timeSegment.filter(r => r.action === 'Location').length, 1);
    assert.equal(bibsSegment.filter(r => r.action === 'Location').length, 0);
  });

  it('classifies a Bibs/CP Location row as Bibs via its own following ModeStart', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'CP1' },
      { lineNumber: 2, action: 'ModeStart', note: 'CP', bibNumber: null },
      { lineNumber: 3, action: 'Pass', bibNumber: 101 },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.equal(bibsSegment.filter(r => r.action === 'Location').length, 1);
    assert.equal(timeSegment.filter(r => r.action === 'Location').length, 0);
  });

  // A 'Reset' row's own splitTime is null now regardless of family too, and unlike every other
  // row it must land in the SAME bucket as the Location row its own refLineNumber targets — not
  // just for display, but because currentSegment() computes its resetTargets set purely from
  // whichever bucket a Reset actually ended up in; a misclassified Reset would silently fail to
  // close the visit it was supposed to, leaving stale rows in the wrong segment forever.
  it('classifies a Time-mode Reset row as Time via its own refLineNumber target, so it can close that visit', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { lineNumber: 2, action: 'ModeStart', note: 'Time', splitTime: null },
      { splitTime: '00:10:00', lineNumber: 3, action: 'Split' },
      { lineNumber: 4, action: 'Reset', refLineNumber: 1, splitTime: null },
      { lineNumber: 5, action: 'Location', note: 'Finish' },
      { lineNumber: 6, action: 'ModeStart', note: 'Time', splitTime: null },
      { splitTime: '00:20:00', lineNumber: 7, action: 'Split' },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.deepEqual(timeSegment.filter(r => r.action === 'Split').map(r => r.splitTime), ['00:20:00']);
    assert.equal(bibsSegment.length, 0);
  });

  it('classifies a Bibs/CP Reset row as Bibs via its own refLineNumber target, so it can close that visit', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { lineNumber: 2, action: 'ModeStart', note: 'Bibs', bibNumber: null },
      { bibNumber: 1, lineNumber: 3, action: 'Finish' },
      { lineNumber: 4, action: 'Reset', refLineNumber: 1 },
      { lineNumber: 5, action: 'Location', note: 'Finish' },
      { lineNumber: 6, action: 'ModeStart', note: 'Bibs', bibNumber: null },
      { bibNumber: 2, lineNumber: 7, action: 'Finish' },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.deepEqual(bibsSegment.filter(r => r.action === 'Finish').map(r => r.bibNumber), [2]);
    assert.equal(timeSegment.length, 0);
  });

  // A 'NewRace' row's own splitTime is null now regardless of family too (see SyncRecordMapping's
  // own doc) — unlike Reset it isn't filtered out of the visible segment, so a misclassified one
  // would show up in the wrong bucket outright. It's always immediately followed by its own race's
  // first Location row (same write transaction), which is what resolves its family here.
  it('classifies a Time-mode NewRace row as Time via its own following Location', () => {
    const lines = [
      { lineNumber: 1, action: 'NewRace', splitTime: null },
      { lineNumber: 2, action: 'Location', note: 'Finish' },
      { lineNumber: 3, action: 'ModeStart', note: 'Time', splitTime: null },
      { splitTime: '00:10:00', lineNumber: 4, action: 'Split' },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.equal(timeSegment.filter(r => r.action === 'NewRace').length, 1);
    assert.equal(bibsSegment.filter(r => r.action === 'NewRace').length, 0);
  });

  it('classifies a Bibs/CP NewRace row as Bibs via its own following Location', () => {
    const lines = [
      { lineNumber: 1, action: 'NewRace' },
      { lineNumber: 2, action: 'Location', note: 'Finish' },
      { lineNumber: 3, action: 'ModeStart', note: 'Bibs', bibNumber: null },
      { bibNumber: 1, lineNumber: 4, action: 'Finish' },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.equal(bibsSegment.filter(r => r.action === 'NewRace').length, 1);
    assert.equal(timeSegment.filter(r => r.action === 'NewRace').length, 0);
  });

  it('drops every visit a Reset has individually closed', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { bibNumber: 1, lineNumber: 2, action: 'Finish' },
      { lineNumber: 3, action: 'Reset', refLineNumber: 1 },
      { lineNumber: 4, action: 'Location', note: 'Finish' },
      { bibNumber: 2, lineNumber: 5, action: 'Finish' },
    ];
    const { bibsSegment } = buildSegmentView(lines);
    assert.deepEqual(bibsSegment.map(r => r.bibNumber).filter(b => b != null), [2]);
  });

  it('folds to the latest edit of each logical entry and drops anything whose latest state is Undo', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { bibNumber: 1, lineNumber: 2, refLineNumber: 2, action: 'Finish' },
      { bibNumber: 1, lineNumber: 3, refLineNumber: 2, action: 'Undo' }, // undoes line 2
      { bibNumber: 2, lineNumber: 4, refLineNumber: 4, action: 'Finish' },
      { bibNumber: 2, lineNumber: 5, refLineNumber: 4, action: 'Finish' }, // a correction, not an undo
    ];
    const { bibsSegment } = buildSegmentView(lines);
    // bib 1's only entry was undone entirely; bib 2's latest edit (line 5) survives.
    const bibRows = bibsSegment.filter(r => r.bibNumber != null);
    assert.equal(bibRows.length, 1);
    assert.equal(bibRows[0].lineNumber, 5);
  });

  it('sorts the resulting segment by lineNumber', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { bibNumber: 2, lineNumber: 5, action: 'Finish' },
      { bibNumber: 1, lineNumber: 2, action: 'Finish' },
    ];
    const { bibsSegment } = buildSegmentView(lines);
    assert.deepEqual(bibsSegment.map(r => r.lineNumber), [1, 2, 5]);
  });

  it('a roaming device (relocated with no Reset in between) keeps every visit open at once, not just the most recent', () => {
    // Unlike racemaster-mobile's own live mode-screen view (which narrows to only the most
    // recently visited location's own visits — see HistoryFold.currentSegmentRows), this web-app
    // view deliberately keeps every not-yet-Reset visit regardless of location, since
    // locationSegmentsOf() (mobile-files-progress.js) needs all of them to bucket per station.
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { bibNumber: 1, lineNumber: 2, action: 'Finish' },
      { lineNumber: 3, action: 'Location', note: 'CP1' },
      { bibNumber: 2, lineNumber: 4, action: 'Finish' },
      { lineNumber: 5, action: 'Location', note: 'Finish' }, // relocate back to Finish
      { bibNumber: 3, lineNumber: 6, action: 'Finish' },
    ];
    const { bibsSegment } = buildSegmentView(lines);
    assert.deepEqual(bibsSegment.map(r => r.bibNumber).filter(b => b != null).sort(), [1, 2, 3]);
  });

  // racemaster-mobile's two newer recording modes — Close (beacon battery read + power-off) and
  // Count (beacon sighted only) — each write their own action ('Close'/'CountSeen') with a
  // splitTime of null, same as a Bibs/CP row. Before this fix, both silently fell into the Bibs
  // family's own default (splitTime == null => Bibs) and then got dropped outright downstream
  // (mobile-files-progress.js's TRANSFERABLE_BIBS_ACTIONS doesn't include either action) —
  // confirmed in the field as beacon close/count data recorded on a phone never showing up
  // anywhere once pulled. Each must land in its own segment, not bibsSegment.
  it('classifies a Close row into its own closeSegment, not bibsSegment', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Close' },
      { lineNumber: 2, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null },
      { lineNumber: 3, action: 'Close', note: 'beacon=5 battery=80', bibNumber: null, splitTime: null },
    ];
    const { closeSegment, bibsSegment, timeSegment } = buildSegmentView(lines);
    assert.equal(closeSegment.filter(r => r.action === 'Close').length, 1);
    assert.equal(bibsSegment.length, 0);
    assert.equal(timeSegment.length, 0);
  });

  // Same fix, same bug shape, for racemaster-mobile's own auto-reinstatement marker
  // (HistoryAction.CLOSE_REOPENED) — a CloseReopened row has a null splitTime too, same as a
  // real Close row, so without its own rowFamily case it falls into the Bibs default exactly like
  // the ones above did before their own fix.
  it('classifies a CloseReopened row into its own closeSegment, not bibsSegment', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Close' },
      { lineNumber: 2, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null },
      { lineNumber: 3, action: 'Close', note: 'beacon=5 battery=80', bibNumber: null, splitTime: null },
      { lineNumber: 4, action: 'CloseReopened', note: 'beacon=5', bibNumber: null, splitTime: null },
    ];
    const { closeSegment, bibsSegment, timeSegment } = buildSegmentView(lines);
    assert.equal(closeSegment.filter(r => r.action === 'CloseReopened').length, 1);
    assert.equal(bibsSegment.length, 0);
    assert.equal(timeSegment.length, 0);
  });

  it('classifies a CountSeen row into its own countSegment, not bibsSegment', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Start' },
      { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null },
      { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null },
    ];
    const { countSegment, bibsSegment, timeSegment } = buildSegmentView(lines);
    assert.equal(countSegment.filter(r => r.action === 'CountSeen').length, 1);
    assert.equal(bibsSegment.length, 0);
    assert.equal(timeSegment.length, 0);
  });

  // Same fix, same bug shape, for racemaster-mobile's own CountComplete/CountStopped markers —
  // both carry a null splitTime/bibNumber too, same as CloseReopened above, so without their own
  // rowFamily case they fell into the Bibs default. Confirmed in the field: a device repurposed
  // from Count mode to Bibs/CP mode (same physical phone/file) left a stray CountComplete row
  // stranding its own phantom "Pen" location segment alongside the real CP segment —
  // resolveLocationKey('Pen') returns null (unrecognised), which made validateAndCompute() reject
  // the entire selected batch, silently blocking the device's genuine CP passes from ever
  // reaching the Progress tab too (ToDo.MD: "progress tab is not being updated by checkpoint
  // passes").
  it('classifies CountComplete/CountStopped rows into countSegment, not bibsSegment', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Pen' },
      { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null },
      { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null },
      { lineNumber: 4, action: 'CountComplete', note: 'of=1', bibNumber: null, splitTime: null },
      { lineNumber: 5, action: 'CountStopped', note: 'outstanding=0', bibNumber: null, splitTime: null },
    ];
    const { countSegment, bibsSegment, timeSegment } = buildSegmentView(lines);
    assert.equal(countSegment.filter(r => r.action === 'CountComplete').length, 1);
    assert.equal(countSegment.filter(r => r.action === 'CountStopped').length, 1);
    assert.equal(bibsSegment.length, 0);
    assert.equal(timeSegment.length, 0);
  });

  it('classifies a Close-mode Location/ModeStart boundary pair into closeSegment via the ModeStart note, same as Time/Bibs', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Close' },
      { lineNumber: 2, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null },
    ];
    const { closeSegment } = buildSegmentView(lines);
    assert.equal(closeSegment.filter(r => r.action === 'Location').length, 1);
    assert.equal(closeSegment.filter(r => r.action === 'ModeStart').length, 1);
  });

  it('a Reset closes only the one visit its own refLineNumber targets, leaving every other open visit untouched', () => {
    const lines = [
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { bibNumber: 1, lineNumber: 2, action: 'Finish' },
      { lineNumber: 3, action: 'Location', note: 'CP1' },
      { bibNumber: 2, lineNumber: 4, action: 'Finish' },
      // Reset closes only Finish's own visit (line 1) — CP1's own visit (line 3) stays open.
      { lineNumber: 5, action: 'Reset', refLineNumber: 1 },
    ];
    const { bibsSegment } = buildSegmentView(lines);
    assert.deepEqual(bibsSegment.map(r => r.bibNumber).filter(b => b != null), [2]);
  });
});

describe('mobile-files-devices.js:whenOf', () => {
  it('extracts just the time-of-day portion of the phone\'s own timestamp', () => {
    assert.equal(whenOf({ timestamp: '2026/08/30 12:34:56' }), '12:34:56');
  });

  it('falls back to timestampMillis for a pre-rename line, and empty string for neither', () => {
    assert.equal(whenOf({ timestampMillis: '2026/08/30 09:00:00' }), '09:00:00');
    assert.equal(whenOf({}), '');
  });
});

describe('mobile-files-devices.js:latestStartedAt', () => {
  it('reads a Time-mode device\'s own ModeStart marker', () => {
    const lines = [
      { lineNumber: 1, action: 'ModeStart', splitNumber: 0, splitTime: '00:00:00.00', timestamp: '2026/08/30 09:00:00.00' },
      { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: '00:20:00.00', timestamp: '2026/08/30 09:20:00.00' },
    ];
    assert.equal(latestStartedAt(lines), '2026/08/30 09:00:00.00');
  });

  it('reads a Bibs/CP-mode device\'s own ModeStart marker, not a per-bib Start entry', () => {
    const lines = [
      { lineNumber: 1, action: 'ModeStart', bibNumber: null, timestamp: '2026/08/30 08:55:00' },
      // A runner's own explicit early/late start — action:'Start', a completely different (and
      // now unambiguous) action string from this device's own action:'ModeStart' marker, ever
      // since ModeStart replaced the former per-family Start/Clock markers (ToDo.MD: "use the
      // ModeStart records and not start or clock records").
      { lineNumber: 2, action: 'Start', bibNumber: '42', timestamp: '2026/08/30 09:05:12' },
    ];
    assert.equal(latestStartedAt(lines), '2026/08/30 08:55:00');
  });

  it('picks the highest-lineNumber marker when the device was reset and started again', () => {
    const lines = [
      { lineNumber: 1, action: 'ModeStart', splitNumber: 0, splitTime: '00:00:00.00', timestamp: '2026/08/30 09:00:00.00' },
      { lineNumber: 2, action: 'Reset' },
      { lineNumber: 3, action: 'ModeStart', splitNumber: 0, splitTime: '00:00:00.00', timestamp: '2026/08/30 14:30:00.00' },
    ];
    assert.equal(latestStartedAt(lines), '2026/08/30 14:30:00.00');
  });

  it('returns the full raw timestamp, seconds included — formatted at render time, same as Last Update', () => {
    const lines = [{ lineNumber: 1, action: 'ModeStart', timestamp: '2026/08/30 07:03:45' }];
    assert.equal(latestStartedAt(lines), '2026/08/30 07:03:45');
  });

  it('returns "" when the device has no ModeStart record at all', () => {
    assert.equal(latestStartedAt([]), '');
    assert.equal(latestStartedAt([{ lineNumber: 1, action: 'Finish', bibNumber: '1', timestamp: '2026/08/30 09:20:00' }]), '');
  });
});

describe('mobile-files-devices.js:locationSummary / rawLocationOf', () => {
  it('returns the shared location when every row agrees', () => {
    const rows = [{ location: 'Finish' }, { location: 'Finish' }];
    assert.equal(rawLocationOf(rows), 'Finish');
    assert.equal(locationSummary(rows), 'Finish');
  });

  // A relocated device's rows can genuinely span more than one location again (a real
  // HistoryAction.LOCATION marker mid-race, not a new file) — rawLocationOf()/locationSummary()
  // deliberately still collapse that down to just the latest (current) one, for the single-value
  // uses that want it (course-ordering the Devices list, the modal's own "Location:" summary).
  // See distinctLocationsOf() (own describe block below) for the full per-location list the
  // "Where" column and validateAndCompute()'s own per-location bucketing use instead.
  it('resolves to the latest (highest lineNumber) row\'s location when given rows spanning more than one location', () => {
    const rows = [{ location: 'Finish', lineNumber: 1 }, { location: 'CP1', lineNumber: 2 }];
    assert.equal(rawLocationOf(rows), 'CP1');
    assert.equal(locationSummary(rows), 'CP1');
  });

  it('locationSummary escapes an untrusted location string', () => {
    const rows = [{ location: '<script>' }, { location: 'CP1' }];
    assert.doesNotMatch(locationSummary(rows), /<script>/);
  });

  it('handles an empty visible-rows list without throwing', () => {
    assert.equal(rawLocationOf([]), null);
    assert.match(locationSummary([]), /—/);
  });
});

describe('mobile-files-devices.js:distinctLocationsOf', () => {
  it('returns every distinct location, course-ordered (Finish, then CP ascending)', () => {
    const rows = [
      { location: 'CP2', lineNumber: 3 },
      { location: 'Finish', lineNumber: 1 },
      { location: 'CP1', lineNumber: 2 },
    ];
    assert.deepEqual(distinctLocationsOf(rows), ['Finish', 'CP1', 'CP2']);
  });

  it('deduplicates a location a device returned to after relocating away and back', () => {
    const rows = [{ location: 'CP1' }, { location: 'CP2' }, { location: 'CP1' }];
    assert.deepEqual(distinctLocationsOf(rows), ['CP1', 'CP2']);
  });

  it('ignores rows with no location at all, and returns an empty list when none carry one', () => {
    assert.deepEqual(distinctLocationsOf([{ location: null }, { location: 'Finish' }]), ['Finish']);
    assert.deepEqual(distinctLocationsOf([{ location: null }, {}]), []);
  });

  it('handles an empty visible-rows list without throwing', () => {
    assert.deepEqual(distinctLocationsOf([]), []);
  });
});

describe('mobile-files-devices.js:resolveLocationKey', () => {
  it('recognises "Finish" case-insensitively', () => {
    assert.deepEqual(resolveLocationKey('Finish'), { kind: 'finish' });
    assert.deepEqual(resolveLocationKey('finish'), { kind: 'finish' });
  });

  it('recognises "Start" case-insensitively', () => {
    assert.deepEqual(resolveLocationKey('Start'), { kind: 'start' });
    assert.deepEqual(resolveLocationKey('start'), { kind: 'start' });
  });

  it('extracts the checkpoint number from any location containing a digit', () => {
    assert.deepEqual(resolveLocationKey('CP3'), { kind: 'cp', number: 3 });
    assert.deepEqual(resolveLocationKey('1 - Polebank'), { kind: 'cp', number: 1 });
    assert.deepEqual(resolveLocationKey('cp 12'), { kind: 'cp', number: 12 });
  });

  it('returns null for free text with no recognisable Finish/CP convention', () => {
    assert.equal(resolveLocationKey('Somewhere'), null);
    assert.equal(resolveLocationKey(''), null);
  });

  // racemaster-mobile's Close recording mode forces a dedicated phone's location to the literal
  // string "Close" (Count's own forced "Start" already matches the existing 'start' case just
  // above) — recognised defensively here even though nothing actually buckets by it (a Close/
  // Count device is diverted to its own handling before location-based bucketing ever runs, see
  // mobile-files-progress.js's own validateAndCompute()), so it's never reported as unrecognised.
  it('recognises "Close" case-insensitively', () => {
    assert.deepEqual(resolveLocationKey('Close'), { kind: 'close' });
    assert.deepEqual(resolveLocationKey('close'), { kind: 'close' });
  });
});

describe('mobile-files-devices.js:withResolvedLocations', () => {
  it('with no location markers at all, every row gets the initial location', () => {
    const rows = [
      { action: 'Finish', bibNumber: 101, lineNumber: 1 },
      { action: 'Finish', bibNumber: 102, lineNumber: 2 },
    ];
    assert.deepEqual(withResolvedLocations(rows, 'Finish').map(r => r.location), ['Finish', 'Finish']);
  });

  it('rows before a Location marker keep the old location, rows after get the new one', () => {
    const rows = [
      { action: 'Finish', bibNumber: 101, lineNumber: 1 },
      { action: 'Location', note: 'CP2', lineNumber: 2 },
      { action: 'Finish', bibNumber: 102, lineNumber: 3 },
    ];
    const resolved = withResolvedLocations(rows, 'CP1');
    assert.deepEqual(resolved.map(r => [r.location, r.bibNumber]), [['CP1', 101], ['CP2', undefined], ['CP2', 102]]);
  });

  it('multiple relocations each take effect from their own point onward', () => {
    const rows = [
      { action: 'Finish', lineNumber: 1 },
      { action: 'Location', note: 'CP2', lineNumber: 2 },
      { action: 'Finish', lineNumber: 3 },
      { action: 'Location', note: 'CP3', lineNumber: 4 },
      { action: 'Finish', lineNumber: 5 },
    ];
    assert.deepEqual(withResolvedLocations(rows, 'CP1').map(r => r.location), ['CP1', 'CP2', 'CP2', 'CP3', 'CP3']);
  });

  // Unlike the Location marker, a ModeStart row's own `note` now states its explicit mode (e.g.
  // "Time"/"Bibs"/"CP" — see racemaster-mobile's SyncRecord doc/AppMode.wireName()), not a
  // location — it must NOT be treated as a location marker, even though it always immediately
  // follows a real Location marker in practice (racemaster-mobile's RaceRepository.recordModeStart
  // always writes the pair together).
  it('a ModeStart marker\'s own note (the mode name) is never mistaken for a location', () => {
    const rows = [
      { action: 'Location', note: 'CP2', lineNumber: 1 },
      { action: 'ModeStart', bibNumber: null, note: 'Bibs', lineNumber: 2 },
      { action: 'Finish', lineNumber: 3 },
    ];
    assert.deepEqual(withResolvedLocations(rows, 'Finish').map(r => r.location), ['CP2', 'CP2', 'CP2']);
  });

  it('defaults the initial location to "Finish" when not given', () => {
    const rows = [{ action: 'Finish', lineNumber: 1 }];
    assert.equal(withResolvedLocations(rows)[0].location, 'Finish');
  });

  it('sorts by lineNumber before walking, regardless of input order', () => {
    const rows = [
      { action: 'Finish', bibNumber: 102, lineNumber: 3 },
      { action: 'Location', note: 'CP2', lineNumber: 2 },
      { action: 'Finish', bibNumber: 101, lineNumber: 1 },
    ];
    const resolved = withResolvedLocations(rows, 'CP1');
    assert.deepEqual(resolved.map(r => r.bibNumber), [101, undefined, 102]);
    assert.deepEqual(resolved.map(r => r.location), ['CP1', 'CP2', 'CP2']);
  });

  it('a marker with no note (e.g. a corrupt or pre-convention row) does not change the running location', () => {
    const rows = [
      { action: 'Location', note: null, lineNumber: 1 },
      { action: 'Finish', lineNumber: 2 },
    ];
    assert.deepEqual(withResolvedLocations(rows, 'Finish').map(r => r.location), ['Finish', 'Finish']);
  });

  // A NewRace marker (racemaster-mobile's HistoryAction.NEW_RACE) is always a race's own very
  // first line, written before even its own initial LOCATION marker — deliberately
  // location-agnostic, since its real location arrives moments later via that LOCATION row.
  // Without this, it would inherit the `initialLocation` default ("Finish") and get misreported
  // as if it happened there, even when the device's real (and only) location is something else
  // entirely — confirmed in the field via a spurious "Finish" entry in the Devices list's Where
  // column for a device that had only ever recorded at CP1.
  it('a NewRace marker is location-agnostic — never inherits the initial-location default', () => {
    const rows = [
      { action: 'NewRace', lineNumber: 1 },
      { action: 'Location', note: 'CP1', lineNumber: 2 },
      { action: 'ModeStart', note: 'CP', lineNumber: 3 },
    ];
    const resolved = withResolvedLocations(rows, 'Finish');
    assert.equal(resolved[0].location, null);
    assert.deepEqual(resolved.slice(1).map(r => r.location), ['CP1', 'CP1']);
  });

  it('a NewRace marker never pollutes distinctLocationsOf with the initial-location default', () => {
    const rows = withResolvedLocations([
      { action: 'NewRace', lineNumber: 1 },
      { action: 'Location', note: 'CP1', lineNumber: 2 },
      { action: 'Pass', bibNumber: 101, lineNumber: 3 },
    ], 'Finish');
    assert.deepEqual(distinctLocationsOf(rows), ['CP1']);
  });
});

describe('mobile-files-devices.js:flattenDevices — Last Seen / Last Update', () => {
  // Field report: a phone that no longer existed showed Last Seen "now", because a mule relaying
  // it kept rewriting its server file. Last Seen comes only from the phone's own lines.
  it('Last Seen is the newest line in the file, never the file\'s own write time', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{
        name: 'gone-phone', lastSeen: new Date().toISOString(),
        lines: [
          { action: 'NewRace', lineNumber: 1, timestamp: '2026/09/20 09:00:00' },
          { action: 'Ping', lineNumber: 2, timestamp: '2026/09/20 10:00:00' },
        ],
      }],
    }];
    const [row] = flattenDevices(races);
    assert.equal(row.lastSeen, new Date(2026, 8, 20, 10, 0, 0).toISOString());
    assert.equal(row.lastUpdate, '2026/09/20 09:00:00');
  });
});

// ToDo.MD: "devices tab on mobile files page should indicate a device has gone off-line if it
// does not see regular pings"
describe('mobile-files-devices.js:isDeviceOffline', () => {
  it('is not offline when lastSeen is blank/unparseable — nothing to judge staleness from yet', () => {
    assert.equal(isDeviceOffline(''), false);
    assert.equal(isDeviceOffline(null), false);
    assert.equal(isDeviceOffline('not a date'), false);
  });

  it('is not offline within the threshold', () => {
    const now = Date.parse('2026/09/20 10:00:00');
    const lastSeen = new Date(now - 60 * 1000).toISOString(); // 1 minute ago
    assert.equal(isDeviceOffline(lastSeen, now), false);
  });

  it('is offline once the silence reaches the threshold', () => {
    const now = Date.parse('2026/09/20 10:00:00');
    const lastSeen = new Date(now - 3 * 60 * 1000).toISOString(); // exactly 3 minutes ago
    assert.equal(isDeviceOffline(lastSeen, now), true);
  });
});

// flattenDevices() has no injectable `now` of its own (isDeviceOffline()'s wiring inside it
// always judges against the real Date.now()) — so unlike the describe block above, these lines
// are timestamped relative to whenever the suite actually runs, not a fixed fictional date, or
// row.offline would be judged against the wrong "now" entirely.
describe('mobile-files-devices.js:flattenDevices — offline flag', () => {
  function phoneTimestamp(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  it('flags a device whose newest line (a Ping included) is old as offline', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{
        name: 'quiet-phone',
        lines: [
          { action: 'NewRace', lineNumber: 1, timestamp: phoneTimestamp(new Date(Date.now() - 20 * 60 * 1000)) },
          { action: 'Ping', lineNumber: 2, timestamp: phoneTimestamp(new Date(Date.now() - 10 * 60 * 1000)) },
        ],
      }],
    }];
    const [row] = flattenDevices(races);
    assert.equal(row.offline, true);
  });

  it('does not flag a device that has pinged recently', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{
        name: 'live-phone',
        lines: [
          { action: 'NewRace', lineNumber: 1, timestamp: phoneTimestamp(new Date(Date.now() - 20 * 60 * 1000)) },
          { action: 'Ping', lineNumber: 2, timestamp: phoneTimestamp(new Date(Date.now() - 30 * 1000)) },
        ],
      }],
    }];
    const [row] = flattenDevices(races);
    assert.equal(row.offline, false);
  });
});

describe('mobile-files-devices.js:flattenDevices', () => {
  it('produces one row per device, sorted Finish first then CP number ascending', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [
        { name: 'CP2 Phone', lines: [
          { lineNumber: 1, action: 'Location', note: 'CP2' },
          { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { bibNumber: 1, lineNumber: 3, action: 'Finish' },
        ] },
        { name: 'Finish Phone', lines: [
          { lineNumber: 1, action: 'Location', note: 'Finish' },
          { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { bibNumber: 1, lineNumber: 3, action: 'Finish' },
        ] },
        { name: 'CP1 Phone', lines: [
          { lineNumber: 1, action: 'Location', note: 'CP1' },
          { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { bibNumber: 1, lineNumber: 3, action: 'Finish' },
        ] },
      ],
    }];
    const rows = flattenDevices(races);
    assert.deepEqual(rows.map(r => r.device.name), ['Finish Phone', 'CP1 Phone', 'CP2 Phone']);
  });

  // The conflation this guards against: flattenDevices() used to overwrite device.lines with the
  // withResolvedLocations() output, so every consumer — including "View Raw", which is supposed
  // to show exactly and only what arrived over the wire — silently got the client-processed array
  // instead. device.lines must stay byte-for-byte the raw input; device.resolvedLines is the only
  // place the resolved (location-stamped) view lives.
  it('keeps device.lines exactly as the raw input (no synthetic fields added), with device.resolvedLines carrying the resolved view separately', () => {
    const rawLines = [
      { lineNumber: 1, action: 'Location', note: 'CP1' },
      { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
      { lineNumber: 3, action: 'Finish', bibNumber: '5' },
    ];
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'Phone', lines: rawLines }],
    }];
    const rows = flattenDevices(races);
    assert.deepEqual(rows[0].device.lines, rawLines); // exactly the raw input, nothing added
    assert.ok(rows[0].device.lines.every(l => !('location' in l))); // no synthetic field at all
    assert.equal(rows[0].device.resolvedLines.length, rawLines.length);
    assert.ok(rows[0].device.resolvedLines.every(l => l.location === 'CP1')); // the resolved view
  });

  it('assigns a sequential idx per row, spanning every race', () => {
    const races = [
      { owner: 'alice', raceLabel: 'race-a', raceDate: null, devices: [{ name: 'A', lines: [] }] },
      { owner: 'alice', raceLabel: 'race-b', raceDate: null, devices: [{ name: 'B', lines: [] }] },
    ];
    const rows = flattenDevices(races);
    assert.deepEqual(rows.map(r => r.idx), [0, 1]);
  });

  it('marks a pending device\'s row as pending, and a synced one as not', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [], pending: true }, { name: 'B', lines: [] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows.find(r => r.device.name === 'A').pending, true);
    assert.equal(rows.find(r => r.device.name === 'B').pending, false);
  });

  it('reflects computeIncorporationStatus for a currently-selected row', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [{ lineNumber: 1, action: 'Finish', bibNumber: 1 }] }],
    }];
    selectedKeys.add(rowKey({ owner: 'alice', raceLabel: 'race-a', device: { name: 'A' } }));
    const rows = flattenDevices(races);
    assert.equal(rows[0].incorporationStatus, 'outstanding');
  });

  // ToDo.MD's "Mobile-app changes to reflect through to Mobile Files processing" section: a
  // device that's only ever written its own ModeStart marker has recorded nothing real yet — the
  // count shown must still distinguish "0 so far, but genuinely expected" (this family's own mode
  // was chosen) from "not expected at all" (this device has nothing to do with that family — see
  // formatCount's own `expected` argument, and js/views/mobile-files-devices.js /
  // mobile-files-all.js, which render bibs/time using bibsVisible/bibsExpected and
  // timeVisible/timeExpected together).
  it('shows a bib count of 0 for a device with only its own bibs ModeStart marker', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [{ lineNumber: 1, action: 'ModeStart', bibNumber: null, note: 'Bibs' }] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].bibsVisible, 0);
    assert.equal(rows[0].bibsExpected, true);
    assert.equal(rows[0].timeExpected, false); // this device has nothing to do with splits at all
    assert.equal(formatCount(rows[0].bibsVisible, rows[0].bibsExpected), '0');
    assert.equal(formatCount(rows[0].timeVisible, rows[0].timeExpected), '');
  });

  // ToDo.MD: "drop the 'Setup' record from the device file, its no longer created, there will
  // always be a modestart record" — a brand new, not-yet-synced device is now represented by
  // having literally zero lines at all, not a placeholder record of its own; this must still show
  // blank/blank (not "0/0" — no mode has been chosen at all yet, so neither family is expected).
  it('shows both counts as blank for a brand new device with zero lines at all — no mode chosen yet', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].bibsVisible, 0);
    assert.equal(rows[0].timeVisible, 0);
    assert.equal(rows[0].bibsExpected, false);
    assert.equal(rows[0].timeExpected, false);
    assert.equal(formatCount(rows[0].bibsVisible, rows[0].bibsExpected), '');
    assert.equal(formatCount(rows[0].timeVisible, rows[0].timeExpected), '');
  });

  it('shows a split count of 0 for a Time-mode device with only its own ModeStart marker', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [
        { lineNumber: 1, action: 'ModeStart', splitTime: null, note: 'Time' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].timeVisible, 0);
    assert.equal(rows[0].timeExpected, true);
    assert.equal(rows[0].bibsExpected, false); // this device has nothing to do with bibs at all
    assert.equal(formatCount(rows[0].timeVisible, rows[0].timeExpected), '0');
    assert.equal(formatCount(rows[0].bibsVisible, rows[0].bibsExpected), '');
  });

  it('still counts a real split after the ModeStart marker (marker itself excluded, the real split is not)', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [
        { lineNumber: 1, action: 'ModeStart', splitNumber: 0, splitTime: null, note: 'Time' },
        { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: 1200 },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].timeVisible, 1);
    assert.equal(rows[0].timeExpected, true);
  });

  // See racemaster-mobile's HistoryAction.PING doc: "shows in history files but is ignored, but
  // does not show in the mode screen lists" — a Ping row must never inflate either visible count,
  // matching the treatment every other boundary marker already gets here.
  it('a Ping heartbeat row never inflates either visible count', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [
        { lineNumber: 1, action: 'Location', note: 'Finish' },
        { lineNumber: 2, action: 'ModeStart', splitNumber: 0, splitTime: null, note: 'Time' },
        { lineNumber: 3, action: 'Split', splitNumber: 1, splitTime: 1200 },
        { lineNumber: 4, action: 'Ping' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].timeVisible, 1);
  });

  it('still counts a real bib after the ModeStart marker (marker itself excluded, the real bib is not)', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [
        { lineNumber: 1, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
        { lineNumber: 2, action: 'Finish', bibNumber: '5' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].bibsVisible, 1);
    assert.equal(rows[0].bibsExpected, true);
  });

  // Two genuinely different physical phones at two different stations are — and stay — two
  // separate rows, keyed by their own distinct device.name (unrelated to relocation: see
  // distinctLocationsOf()'s own describe block below for the "one phone, two locations" case).
  it('two different devices at different stations arrive — and stay — as two separate rows', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [
        { name: 'Phone_cp1', lines: [
          { lineNumber: 1, action: 'Location', note: 'CP1' },
          { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { lineNumber: 3, action: 'Finish', bibNumber: '5' },
        ] },
        { name: 'Phone_cp2', lines: [
          { lineNumber: 1, action: 'Location', note: 'CP2' },
          { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { lineNumber: 3, action: 'Finish', bibNumber: '6' },
          { lineNumber: 4, action: 'Finish', bibNumber: '7' },
        ] },
      ],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows.length, 2);
    const cp1 = rows.find(r => r.rawLocation === 'CP1');
    const cp2 = rows.find(r => r.rawLocation === 'CP2');
    assert.equal(cp1.bibsVisible, 1);
    assert.equal(cp2.bibsVisible, 2);
    assert.notEqual(rowKey(cp1), rowKey(cp2)); // distinct device.name is already enough
  });

  it('a single device that relocated mid-race stays one row, listing every location it recorded at', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'Roaming Phone', lines: [
        { lineNumber: 1, action: 'Location', bibNumber: null, note: 'CP1' },
        { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
        { lineNumber: 3, action: 'Finish', bibNumber: '5' },
        { lineNumber: 4, action: 'Location', bibNumber: null, note: 'CP2' },
        { lineNumber: 5, action: 'Finish', bibNumber: '6' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows.length, 1); // still one row — same device file, not a new one
    assert.deepEqual(rows[0].locations, ['CP1', 'CP2']);
    assert.equal(rows[0].location, 'CP2'); // the single current/latest value is unchanged in meaning
  });

  // Not just a single relocation — a marshal can move any number of times across a race, each
  // move its own real HistoryAction.LOCATION marker on the phone (racemaster-mobile's own
  // RaceRepository.relocateActiveModes has no limit on how many times it can be called). Three
  // moves here (CP1 -> CP2 -> CP3 -> back to CP1) to confirm the web-app side stays generic too:
  // still one row, every distinct location listed, a revisited one deduplicated rather than
  // appearing twice.
  it('a device relocated three times over stays one row, listing every distinct location it visited', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'Roaming Phone', lines: [
        { lineNumber: 1, action: 'Location', bibNumber: null, note: 'CP1' },
        { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
        { lineNumber: 3, action: 'Finish', bibNumber: '1' },
        { lineNumber: 4, action: 'Location', bibNumber: null, note: 'CP2' },
        { lineNumber: 5, action: 'Finish', bibNumber: '2' },
        { lineNumber: 6, action: 'Location', bibNumber: null, note: 'CP3' },
        { lineNumber: 7, action: 'Finish', bibNumber: '3' },
        { lineNumber: 8, action: 'Location', bibNumber: null, note: 'CP1' },
        { lineNumber: 9, action: 'Finish', bibNumber: '4' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].locations, ['CP1', 'CP2', 'CP3']); // revisited CP1 not duplicated
    assert.equal(rows[0].location, 'CP1'); // latest/current
  });

  // ToDo.MD: "when a mobile file is completely reset (all the way back to the beginning) device
  // view shows a blank location but has retained the mode, that should be blank too, also the
  // device list should show unknown in the where column and both bibs and time columns should be
  // blank as its mode is also now unknown" — a markerless Reset (no refLineNumber — the "hard
  // wall" degradation, see legacyResetWallLine's own doc) closes out EVERYTHING at/before it,
  // including whatever ModeStart used to apply — location, mode, and bibs/time expectation must
  // all go blank/unknown together, not just location while mode/expectation silently keep the old
  // value (the bug this whole block guards against: latestModeStart() used to search the WHOLE
  // file regardless of Reset boundaries, so it kept reporting a "still valid" mode/location even
  // once the segment itself had gone empty).
  describe('a markerless Reset closing out everything (a completely reset device)', () => {
    it('reports no current location at all, not the pre-reset one', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'Location', bibNumber: null, note: 'CP1' },
          { lineNumber: 2, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { lineNumber: 3, action: 'Finish', bibNumber: '5' },
          { lineNumber: 4, action: 'Reset' }, // markerless — no refLineNumber, no fresh ModeStart follows
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows[0].rawLocation, null);
      assert.equal(rows[0].location, '—'); // showDeviceModal's own locationSummary() fallback
      assert.deepEqual(rows[0].locations, []);
    });

    it('reports no bibs/time expectation at all — both counts go blank, not "0"', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5' },
          { lineNumber: 3, action: 'Reset' },
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows[0].bibsVisible, 0);
      assert.equal(rows[0].bibsExpected, false); // the mode itself is unknown now, not just empty
      assert.equal(rows[0].timeExpected, false);
      assert.equal(formatCount(rows[0].bibsVisible, rows[0].bibsExpected), ''); // blank, not '0'
    });

    it('leaves rawLocation/timeExpected unknown too — a Time-mode device closed the same way', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'Location', bibNumber: null, note: 'Finish' },
          { lineNumber: 2, action: 'ModeStart', splitTime: null, note: 'Time' },
          { lineNumber: 3, action: 'Split', splitNumber: 1, splitTime: 600 },
          // A Time-family Reset needs its own non-null splitTime to land in the Time bucket at
          // all (buildSegmentView classifies a real row purely on splitTime null-ness) —
          // otherwise it'd fall into the Bibs bucket instead and never cut this family's
          // segment off.
          { lineNumber: 4, action: 'Reset', splitTime: 0 },
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows[0].rawLocation, null);
      assert.equal(rows[0].timeExpected, false);
      assert.equal(rows[0].timeVisible, 0);
    });

    it('a fresh ModeStart written right after the Reset (the normal case) is used instead, once it exists', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { lineNumber: 2, action: 'Reset' },
          { lineNumber: 3, action: 'ModeStart', bibNumber: null, note: 'Bibs' },
          { lineNumber: 4, action: 'Finish', bibNumber: '9' },
        ] }],
      }];
      const rows = flattenDevices(races);
      // The fresh (post-Reset) ModeStart is what's actually visible now — bib 9, recorded after
      // it, is correctly counted; nothing from before the Reset leaks through.
      assert.equal(rows.length, 1);
      assert.equal(rows[0].bibsVisible, 1);
    });
  });
});

describe('mobile-files-devices.js:flattenDevices — Close/Count-mode devices', () => {
  // Before this fix, a pure Close-mode device (never writes a Bib/Time entry — see
  // buildSegmentView's own closeSegment/countSegment doc) had `visible` built only from
  // timeSegment/bibsSegment, which are always empty for such a device — so its own real,
  // resolved Location/ModeStart rows never showed up anywhere: location fell back to "Unknown"
  // and mode to "—", despite the data being perfectly real.
  it('reports a Close-mode device\'s own forced "Close" location, not Unknown', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'Close Phone', lines: [
        { lineNumber: 1, action: 'Location', note: 'Close' },
        { lineNumber: 2, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null, timestamp: '2026/08/30 09:00:00' },
        { lineNumber: 3, action: 'Close', note: 'beacon=5 battery=80', bibNumber: null, splitTime: null },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].rawLocation, 'Close');
    assert.deepEqual(rows[0].locations, ['Close']);
    // startedAt is read from the current segment's own latest ModeStart (latestModeStart()) —
    // only populated at all if the Close-mode ModeStart row was actually folded into `visible`.
    assert.equal(rows[0].startedAt, '2026/08/30 09:00:00');
  });

  it('reports a Count-mode device\'s own forced "Start" location', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'Count Phone', lines: [
        { lineNumber: 1, action: 'Location', note: 'Start' },
        { lineNumber: 2, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null, timestamp: '2026/08/30 09:00:00' },
        { lineNumber: 3, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].rawLocation, 'Start');
    assert.equal(rows[0].startedAt, '2026/08/30 09:00:00');
  });
});

describe('mobile-files-devices.js:deviceViewOptions', () => {
  // ToDo.MD: "I want the devices view to be split by location + mode ... these should be
  // options on the view selector not sub-sections within the view" — js/views/mobile-files.js's
  // own viewDeviceRow() calls this to build its own choice-dialog options.
  it('returns exactly one option for an ordinary single-location, single-mode device', () => {
    const lines = withResolvedLocations([
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { lineNumber: 2, action: 'ModeStart', note: 'Bibs', splitTime: null, bibNumber: null },
      { lineNumber: 3, action: 'Finish', bibNumber: '5' },
    ]);
    const options = deviceViewOptions(lines);
    assert.equal(options.length, 1);
    assert.equal(options[0].mode, 'Bibs');
    assert.equal(options[0].location, 'Finish');
    assert.equal(options[0].label, 'Bibs'); // single location, so no "Finish — " prefix
    assert.equal(options[0].empty, false);
  });

  it('splits one location into separate Bibs(empty)/Close/Count options when the device switched mode with no Reset between', () => {
    const lines = withResolvedLocations([
      { lineNumber: 1, action: 'Location', note: 'Start' },
      { lineNumber: 2, action: 'ModeStart', note: 'Bibs', splitTime: null, bibNumber: null },
      { lineNumber: 3, action: 'Location', note: 'Start' },
      { lineNumber: 4, action: 'ModeStart', note: 'Close', splitTime: null, bibNumber: null },
      { lineNumber: 5, action: 'Close', note: 'beacon=5 battery=80', bibNumber: null, splitTime: null },
      { lineNumber: 6, action: 'Location', note: 'Start' },
      { lineNumber: 7, action: 'ModeStart', note: 'Count', splitTime: null, bibNumber: null },
      { lineNumber: 8, action: 'CountSeen', note: 'beacon=9', bibNumber: null, splitTime: null },
    ]);
    const options = deviceViewOptions(lines);
    assert.deepEqual(options.map(o => o.label).sort(), ['Bibs (empty)', 'Close', 'Count']);
    // All three share the one location ("Start"), so no location prefix on any of them.
    assert.ok(options.every(o => o.location === 'Start'));
    const bibsOption = options.find(o => o.mode === 'Bibs');
    assert.equal(bibsOption.empty, true); // the ModeStart/Location pair, no real bib ever recorded
  });

  it('prefixes the label with location only once the options actually span more than one', () => {
    const lines = withResolvedLocations([
      { lineNumber: 1, action: 'Location', note: 'Finish' },
      { lineNumber: 2, action: 'ModeStart', note: 'Bibs', splitTime: null, bibNumber: null },
      { lineNumber: 3, action: 'Finish', bibNumber: '5' },
      { lineNumber: 4, action: 'Location', note: 'CP1' },
      { lineNumber: 5, action: 'ModeStart', note: 'CP', splitTime: null, bibNumber: null },
      { lineNumber: 6, action: 'Pass', bibNumber: '5' },
    ]);
    const options = deviceViewOptions(lines);
    assert.deepEqual(options.map(o => o.label).sort(), ['CP1 — Bibs', 'Finish — Bibs']);
  });

  it('returns no options at all for a brand-new device with nothing pulled yet', () => {
    assert.deepEqual(deviceViewOptions([]), []);
  });
});

describe('mobile-files-devices.js:collapsePingRuns', () => {
  // ToDo.MD: "collapse multiple consecutive pings into a line of the form 'N - M' in the line
  // number column, similarly 'N - M' in the timestamp column" — js/views/mobile-files-devices.js's
  // own showRawModal() uses this.
  it('collapses 2+ consecutive Ping rows into one summary row', () => {
    const rows = [
      { lineNumber: 1, action: 'Finish', bibNumber: '5' },
      { lineNumber: 2, action: 'Ping', timestamp: '2026/08/30 09:10:00' },
      { lineNumber: 3, action: 'Ping', timestamp: '2026/08/30 09:10:15' },
      { lineNumber: 4, action: 'Ping', timestamp: '2026/08/30 09:10:30' },
      { lineNumber: 5, action: 'Finish', bibNumber: '6' },
    ];
    const grouped = collapsePingRuns(rows, 'timestamp');
    assert.equal(grouped.length, 3); // Finish, collapsed-Ping, Finish
    assert.deepEqual(grouped[0], rows[0]);
    assert.deepEqual(grouped[2], rows[4]);
    assert.equal(grouped[1].lineNumber, '2 - 4');
    assert.equal(grouped[1].action, 'Ping');
    assert.equal(grouped[1].timestamp, '2026/08/30 09:10:00 - 2026/08/30 09:10:30');
  });

  it('leaves an isolated Ping (no adjacent one) exactly as-is', () => {
    const rows = [
      { lineNumber: 1, action: 'Finish', bibNumber: '5' },
      { lineNumber: 2, action: 'Ping', timestamp: '2026/08/30 09:10:00' },
      { lineNumber: 3, action: 'Finish', bibNumber: '6' },
    ];
    const grouped = collapsePingRuns(rows, 'timestamp');
    assert.equal(grouped.length, 3);
    assert.deepEqual(grouped[1], rows[1]);
  });

  it('handles a run that starts at the very first row and/or ends at the very last row', () => {
    const rows = [
      { lineNumber: 1, action: 'Ping', timestamp: '2026/08/30 09:00:00' },
      { lineNumber: 2, action: 'Ping', timestamp: '2026/08/30 09:00:15' },
      { lineNumber: 3, action: 'Finish', bibNumber: '5' },
      { lineNumber: 4, action: 'Ping', timestamp: '2026/08/30 09:01:00' },
      { lineNumber: 5, action: 'Ping', timestamp: '2026/08/30 09:01:15' },
    ];
    const grouped = collapsePingRuns(rows, 'timestamp');
    assert.equal(grouped.length, 3);
    assert.equal(grouped[0].lineNumber, '1 - 2');
    assert.deepEqual(grouped[1], rows[2]);
    assert.equal(grouped[2].lineNumber, '4 - 5');
  });

  it('omits the synthetic timestamp field entirely when tsField is null', () => {
    const rows = [
      { lineNumber: 1, action: 'Ping' },
      { lineNumber: 2, action: 'Ping' },
    ];
    const grouped = collapsePingRuns(rows, null);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].lineNumber, '1 - 2');
    assert.equal('timestamp' in grouped[0], false);
    assert.equal('timestampMillis' in grouped[0], false);
  });

  it('leaves rows untouched when there are no Pings at all', () => {
    const rows = [
      { lineNumber: 1, action: 'Finish', bibNumber: '5' },
      { lineNumber: 2, action: 'Finish', bibNumber: '6' },
    ];
    assert.deepEqual(collapsePingRuns(rows, 'timestamp'), rows);
  });
});

describe('mobile-files-devices.js:flattenAllFiles', () => {
  it('produces both device rows and a progress row for a race that has both, tagged with kind', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [] }],
      progress: { generatedAt: '2026-01-01T00:00:00.000Z', entries: [{ bibNumber: 1 }, { bibNumber: 2 }] },
    }];
    const rows = flattenAllFiles(races);
    assert.equal(rows.length, 2);
    assert.deepEqual([...rows.map(r => r.kind)].sort(), ['device', 'progress']);
    const progressRow = rows.find(r => r.kind === 'progress');
    assert.equal(progressRow.device.name, 'progress');
    assert.equal(progressRow.bibsVisible, 2);
    assert.equal(progressRow.lastUpdate, '2026-01-01T00:00:00.000Z');
  });

  it('sorts rows newest-first by each row\'s own last-activity date, mixing device and progress rows together', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [
        { name: 'Old', lines: [{ timestamp: '2020/01/01 10:00:00' }] },
        { name: 'New', lines: [{ timestamp: '2026/06/01 10:00:00' }] },
      ],
      progress: { generatedAt: '2023-01-01T00:00:00.000Z', entries: [] },
    }];
    const rows = flattenAllFiles(races);
    assert.deepEqual(rows.map(r => r.kind === 'progress' ? 'progress' : r.device.name), ['New', 'progress', 'Old']);
  });

  it('sorts a row with no parseable date last, not first', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [
        { name: 'NoDate', lines: [] },
        { name: 'Dated', lines: [{ timestamp: '2026/01/01 10:00:00' }] },
      ],
    }];
    const rows = flattenAllFiles(races);
    assert.deepEqual(rows.map(r => r.device.name), ['Dated', 'NoDate']);
  });

  it('produces device rows only for a race with no progress', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [] }],
    }];
    const rows = flattenAllFiles(races);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'device');
  });

  it('assigns a sequential idx spanning device and progress rows together', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [] }, { name: 'B', lines: [] }],
      progress: { generatedAt: '2026-01-01T00:00:00.000Z', entries: [] },
    }];
    const rows = flattenAllFiles(races);
    assert.deepEqual(rows.map(r => r.idx), [0, 1, 2]);
  });
});
