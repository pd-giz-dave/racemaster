'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock } from './helpers/mock-browser.js';
import { selectedKeys, rowKey } from '../js/mobile-files-shared.js';
import {
  formatCount, buildSegmentView, whenOf, locationSummary, rawLocationOf, resolveLocationKey,
  flattenDevices,
} from '../js/mobile-files-devices.js';

beforeEach(() => {
  installLocalStorageMock();
  selectedKeys.clear();
  state.event.name = '';
  state.event.date = '';
});

describe('mobile-files-devices.js:formatCount', () => {
  it('shows nothing for zero, otherwise the count as a string', () => {
    assert.equal(formatCount(0), '');
    assert.equal(formatCount(3), '3');
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

describe('mobile-files-devices.js:locationSummary / rawLocationOf', () => {
  it('returns the shared location when every row agrees', () => {
    const rows = [{ location: 'Finish' }, { location: 'Finish' }];
    assert.equal(rawLocationOf(rows), 'Finish');
    assert.equal(locationSummary(rows), 'Finish');
  });

  it('flags an inconsistent file (more than one distinct location) as invalid', () => {
    const rows = [{ location: 'Finish' }, { location: 'CP1' }];
    assert.equal(rawLocationOf(rows), null);
    assert.match(locationSummary(rows), /Inconsistent/);
    assert.match(locationSummary(rows), /invalid/);
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
});
