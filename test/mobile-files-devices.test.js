'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock } from './helpers/mock-browser.js';
import { selectedKeys, rowKey } from '../js/mobile-files-shared.js';
import {
  formatCount, buildSegmentView, whenOf, locationSummary, rawLocationOf, resolveLocationKey,
  distinctLocationsOf, flattenDevices, flattenAllFiles, latestStartedAt, withResolvedLocations,
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
      { splitTime: '00:10:00', lineNumber: 1, action: 'Split' },
      { bibNumber: 5, lineNumber: 2, action: 'Finish' },
    ];
    const { timeSegment, bibsSegment } = buildSegmentView(lines);
    assert.equal(timeSegment.length, 1);
    assert.equal(bibsSegment.length, 1);
  });

  it('drops everything at or before the family\'s own most recent Reset', () => {
    const lines = [
      { bibNumber: 1, lineNumber: 1, action: 'Finish' },
      { lineNumber: 2, action: 'Reset' },
      { bibNumber: 2, lineNumber: 3, action: 'Finish' },
    ];
    const { bibsSegment } = buildSegmentView(lines);
    assert.equal(bibsSegment.length, 1);
    assert.equal(bibsSegment[0].bibNumber, 2);
  });

  it('folds to the latest edit of each logical entry and drops anything whose latest state is Undo', () => {
    const lines = [
      { bibNumber: 1, lineNumber: 1, refLineNumber: 1, action: 'Finish' },
      { bibNumber: 1, lineNumber: 2, refLineNumber: 1, action: 'Undo' }, // undoes line 1
      { bibNumber: 2, lineNumber: 3, refLineNumber: 3, action: 'Finish' },
      { bibNumber: 2, lineNumber: 4, refLineNumber: 3, action: 'Finish' }, // a correction, not an undo
    ];
    const { bibsSegment } = buildSegmentView(lines);
    // bib 1's only entry was undone entirely; bib 2's latest edit (line 4) survives.
    assert.equal(bibsSegment.length, 1);
    assert.equal(bibsSegment[0].lineNumber, 4);
  });

  it('sorts the resulting segment by lineNumber', () => {
    const lines = [
      { bibNumber: 2, lineNumber: 5, action: 'Finish' },
      { bibNumber: 1, lineNumber: 2, action: 'Finish' },
    ];
    const { bibsSegment } = buildSegmentView(lines);
    assert.deepEqual(bibsSegment.map(r => r.lineNumber), [2, 5]);
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
      { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', timestamp: '2026/08/30 08:55:00' },
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

  it('extracts the checkpoint number from any location containing a digit', () => {
    assert.deepEqual(resolveLocationKey('CP3'), { kind: 'cp', number: 3 });
    assert.deepEqual(resolveLocationKey('1 - Polebank'), { kind: 'cp', number: 1 });
    assert.deepEqual(resolveLocationKey('cp 12'), { kind: 'cp', number: 12 });
  });

  it('returns null for free text with no recognisable Finish/CP convention', () => {
    assert.equal(resolveLocationKey('Somewhere'), null);
    assert.equal(resolveLocationKey(''), null);
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

  // Unlike racemaster-mobile's own now-deleted Kotlin equivalent (which only ever special-cased
  // the LOCATION action, since SETUP/MODE_START didn't carry a location in `note` before this
  // change), this also has to treat 'Setup' and 'ModeStart' as location markers — SETUP/
  // MODE_START now carry the race's own current location in `note` too (see
  // racemaster-mobile's RaceRepository.recordSetupMarker/TimeModeRepository.startStopwatch).
  it('a Setup or ModeStart marker\'s own note also takes effect, same as a Location marker', () => {
    const setupRows = [
      { action: 'Setup', note: 'CP2', lineNumber: 1 },
      { action: 'Finish', lineNumber: 2 },
    ];
    assert.deepEqual(withResolvedLocations(setupRows, 'Finish').map(r => r.location), ['CP2', 'CP2']);

    const modeStartRows = [
      { action: 'ModeStart', bibNumber: 'n/a', note: 'CP3', lineNumber: 1 },
      { action: 'Finish', lineNumber: 2 },
    ];
    assert.deepEqual(withResolvedLocations(modeStartRows, 'Finish').map(r => r.location), ['CP3', 'CP3']);
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
});

describe('mobile-files-devices.js:flattenDevices', () => {
  it('produces one row per device, sorted Finish first then CP number ascending', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [
        { name: 'CP2 Phone', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP2' },
          { bibNumber: 1, lineNumber: 2, action: 'Finish' },
        ] },
        { name: 'Finish Phone', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'Finish' },
          { bibNumber: 1, lineNumber: 2, action: 'Finish' },
        ] },
        { name: 'CP1 Phone', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
          { bibNumber: 1, lineNumber: 2, action: 'Finish' },
        ] },
      ],
    }];
    const rows = flattenDevices(races);
    assert.deepEqual(rows.map(r => r.device.name), ['Finish Phone', 'CP1 Phone', 'CP2 Phone']);
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
  it('shows a bib count of 0 for a device with only its own bibs ModeStart marker (bibNumber "n/a")', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [{ lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' }] }],
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

  it('shows a split count of 0 for a Time-mode device with only its own ModeStart marker (splitTime non-null)', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [
        { lineNumber: 1, action: 'ModeStart', splitTime: '00:00:00', note: 'Finish' },
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
        { lineNumber: 1, action: 'ModeStart', splitNumber: 0, splitTime: '00:00:00.00', note: 'Finish' },
        { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: '00:20:00.00' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].timeVisible, 1);
    assert.equal(rows[0].timeExpected, true);
  });

  it('still counts a real bib after the ModeStart marker (marker itself excluded, the real bib is not)', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'A', lines: [
        { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
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
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5' },
        ] },
        { name: 'Phone_cp2', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP2' },
          { lineNumber: 2, action: 'Finish', bibNumber: '6' },
          { lineNumber: 3, action: 'Finish', bibNumber: '7' },
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
        { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
        { lineNumber: 2, action: 'Finish', bibNumber: '5' },
        { lineNumber: 3, action: 'Location', bibNumber: null, note: 'CP2' },
        { lineNumber: 4, action: 'Finish', bibNumber: '6' },
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
        { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
        { lineNumber: 2, action: 'Finish', bibNumber: '1' },
        { lineNumber: 3, action: 'Location', bibNumber: null, note: 'CP2' },
        { lineNumber: 4, action: 'Finish', bibNumber: '2' },
        { lineNumber: 5, action: 'Location', bibNumber: null, note: 'CP3' },
        { lineNumber: 6, action: 'Finish', bibNumber: '3' },
        { lineNumber: 7, action: 'Location', bibNumber: null, note: 'CP1' },
        { lineNumber: 8, action: 'Finish', bibNumber: '4' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].locations, ['CP1', 'CP2', 'CP3']); // revisited CP1 not duplicated
    assert.equal(rows[0].location, 'CP1'); // latest/current
  });

  // ToDo.MD: "when a race has been reset in a device file, the latest modestart record is still
  // valid wrt the location and mode" — a Reset with no fresh ModeStart written immediately after
  // it (the phone's own convention is to write one right away, but this must degrade gracefully
  // rather than assume that always holds) would otherwise empty out both the post-Reset segment
  // and the visible-location rows, wrongly reporting "no mode/location" for a device that plainly
  // still has one.
  describe('a Reset with no fresh ModeStart immediately after it', () => {
    it('still shows the last ModeStart\'s own location, not blank', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5' },
          { lineNumber: 3, action: 'Reset' }, // no fresh ModeStart follows
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows[0].location, 'CP1');
    });

    it('still shows the last ModeStart\'s own bibs/time expectation ("0", not blank)', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5' },
          { lineNumber: 3, action: 'Reset' },
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows[0].bibsVisible, 0);   // the Reset genuinely cleared the visible count
      assert.equal(rows[0].bibsExpected, true); // but the mode itself is still valid
      assert.equal(formatCount(rows[0].bibsVisible, rows[0].bibsExpected), '0');
    });

    it('still resolves rawLocation for validateAndCompute-style bucketing after a markerless Reset', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'ModeStart', splitTime: 'n/a', note: 'Finish' },
          { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: '00:10:00' },
          // A Time-family Reset needs its own non-null splitTime to land in the Time bucket at
          // all (buildSegmentView classifies purely on splitTime null-ness) — otherwise it'd
          // fall into the Bibs bucket instead and never cut this family's segment off.
          { lineNumber: 3, action: 'Reset', splitTime: 'n/a' },
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows[0].rawLocation, 'Finish');
      assert.equal(rows[0].timeExpected, true);
      assert.equal(rows[0].timeVisible, 0);
    });

    it('a fresh ModeStart written right after the Reset (the normal case) is used instead, once it exists', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'A', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
          { lineNumber: 2, action: 'Reset' },
          { lineNumber: 3, action: 'ModeStart', bibNumber: 'n/a', note: 'CP1' },
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
