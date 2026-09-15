'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock } from './helpers/mock-browser.js';
import { selectedKeys, rowKey } from '../js/mobile-files-shared.js';
import {
  formatCount, buildSegmentView, whenOf, locationSummary, rawLocationOf, resolveLocationKey,
  flattenDevices, flattenAllFiles, latestStartedAt,
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

  // In practice flattenDevices() (see its own describe block below) already splits a device's
  // rows by location BEFORE these are ever called on them, so this genuinely-mixed input only
  // happens via a direct call like this one — the latest-wins fallback these two apply is just
  // graceful degradation for that case, not the real mechanism ToDo.MD's own "allow for the
  // location changing in a device file" is handled by any more.
  it('falls back to the latest (highest lineNumber) row\'s location when given genuinely mixed-location rows directly', () => {
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

describe('mobile-files-devices.js:flattenDevices', () => {
  it('produces one row per device, sorted Finish first then CP number ascending', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [
        { name: 'CP2 Phone', lines: [{ bibNumber: 1, lineNumber: 1, action: 'Finish', location: 'CP2' }] },
        { name: 'Finish Phone', lines: [{ bibNumber: 1, lineNumber: 1, action: 'Finish', location: 'Finish' }] },
        { name: 'CP1 Phone', lines: [{ bibNumber: 1, lineNumber: 1, action: 'Finish', location: 'CP1' }] },
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
      devices: [{ name: 'A', lines: [{ lineNumber: 1, action: 'Finish', bibNumber: 1, location: 'Finish' }] }],
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
      devices: [{ name: 'A', lines: [{ lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' }] }],
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
        { lineNumber: 1, action: 'ModeStart', splitTime: '00:00:00', location: 'Finish' },
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
        { lineNumber: 1, action: 'ModeStart', splitNumber: 0, splitTime: '00:00:00.00', location: 'Finish' },
        { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: '00:20:00.00', location: 'Finish' },
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
        { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' },
        { lineNumber: 2, action: 'Finish', bibNumber: '5', location: 'CP1' },
      ] }],
    }];
    const rows = flattenDevices(races);
    assert.equal(rows[0].bibsVisible, 1);
    assert.equal(rows[0].bibsExpected, true);
  });

  // ToDo.MD: "allow for the location changing in a device file (it means the marshall has
  // moved), when that happens a new devices line should be created to show the new 'Where'
  // column, and the 'View' for that should only show the new location and the 'View' for the
  // old should only show the old location" — see js/mobile-files-devices.js's own
  // splitByLocation()/flattenDevices() doc for the full design.
  describe('location changes (the marshal moved)', () => {
    it('splits a device that has recorded at more than one location into one row per location', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'Phone', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5', location: 'CP1' },
          { lineNumber: 3, action: 'Finish', bibNumber: '6', location: 'CP2' },
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map(r => r.device.name), ['Phone', 'Phone']);
      assert.deepEqual(rows.map(r => r.rawLocation).sort(), ['CP1', 'CP2']);
      assert.ok(rows.every(r => r.locationSplit === true));
    });

    it('scopes each location-row\'s own counts to just its own location\'s entries', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'Phone', lines: [
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5', location: 'CP1' },
          { lineNumber: 3, action: 'ModeStart', bibNumber: 'n/a', location: 'CP2' },
          { lineNumber: 4, action: 'Finish', bibNumber: '6', location: 'CP2' },
          { lineNumber: 5, action: 'Finish', bibNumber: '7', location: 'CP2' },
        ] }],
      }];
      const rows = flattenDevices(races);
      const cp1 = rows.find(r => r.rawLocation === 'CP1');
      const cp2 = rows.find(r => r.rawLocation === 'CP2');
      assert.equal(cp1.bibsVisible, 1);
      assert.equal(cp2.bibsVisible, 2);
    });

    it('gives each location-row its own rowKey and independently-tracked incorporation status', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'Phone', lines: [
          { lineNumber: 1, action: 'Finish', bibNumber: '5', location: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '6', location: 'CP2' },
        ] }],
      }];
      selectedKeys.add(rowKey({ owner: 'alice', raceLabel: 'race-a', device: { name: 'Phone' }, rawLocation: 'CP1', locationSplit: true }));
      const rows = flattenDevices(races);
      const cp1 = rows.find(r => r.rawLocation === 'CP1');
      const cp2 = rows.find(r => r.rawLocation === 'CP2');
      assert.notEqual(rowKey(cp1), rowKey(cp2));
      assert.equal(cp1.incorporationStatus, 'outstanding'); // selected, and has an unsynced line
      assert.equal(cp2.incorporationStatus, 'none');         // never selected
    });

    it('each location-row\'s View/Raw only sees that location\'s own lines (device.lines is scoped)', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'Phone', lines: [
          { lineNumber: 1, action: 'Finish', bibNumber: '5', location: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '6', location: 'CP2' },
        ] }],
      }];
      const rows = flattenDevices(races);
      const cp1 = rows.find(r => r.rawLocation === 'CP1');
      const cp2 = rows.find(r => r.rawLocation === 'CP2');
      assert.deepEqual(cp1.device.lines.map(l => l.bibNumber), ['5']);
      assert.deepEqual(cp2.device.lines.map(l => l.bibNumber), ['6']);
    });

    it('does not split a device that has only ever recorded at one location', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'Phone', lines: [
          { lineNumber: 1, action: 'Finish', bibNumber: '5', location: 'Finish' },
          { lineNumber: 2, action: 'Finish', bibNumber: '6', location: 'Finish' },
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].locationSplit, false);
      assert.equal(rows[0].rawLocation, 'Finish');
    });

    it('does not split a still-pending (not-yet-pushed) device even if its local lines already span two locations', () => {
      const races = [{
        owner: 'alice', raceLabel: 'race-a', raceDate: null,
        devices: [{ name: 'Phone', pending: true, lines: [
          { lineNumber: 1, action: 'Finish', bibNumber: '5', location: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '6', location: 'CP2' },
        ] }],
      }];
      const rows = flattenDevices(races);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].device.lines.length, 2); // Push still uploads everything as one payload
    });
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
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5', location: 'CP1' },
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
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' },
          { lineNumber: 2, action: 'Finish', bibNumber: '5', location: 'CP1' },
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
          { lineNumber: 1, action: 'ModeStart', splitTime: 'n/a', location: 'Finish' },
          { lineNumber: 2, action: 'Split', splitNumber: 1, splitTime: '00:10:00', location: 'Finish' },
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
          { lineNumber: 1, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' },
          { lineNumber: 2, action: 'Reset', location: 'CP1' },
          { lineNumber: 3, action: 'ModeStart', bibNumber: 'n/a', location: 'CP1' },
          { lineNumber: 4, action: 'Finish', bibNumber: '9', location: 'CP1' },
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
