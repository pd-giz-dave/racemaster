'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  importSIResults, clearSIResults, verifySIResults, getSIBib, getSIRaceTime, getSICourse,
  getSIStatus, getSINumSplits, getSISplitTime, getSIAccountedBibs,
} from '../js/si-results.js';

const REQUIRED_HEADER = 'RaceNumber,Name (Free Format),Category,Club,CourseClass,RaceTime,Position,Status';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.siResults = [];
  state.entries     = [{ bibNumber: '1', name: 'Dave Smith', course: 'Seniors' }];
});

describe('si-results.js:field accessors', () => {
  it('getSIBib/getSIRaceTime/getSICourse/getSIStatus read the aliased columns, tolerant of surrounding whitespace in header names', () => {
    const row = { ' RaceNumber ': '5', RaceTime: '1.05.30', CourseClass: 'Seniors', Status: 'DNF' };
    assert.equal(getSIBib(row), 5);
    assert.equal(getSIRaceTime(row), '01:05:30');
    assert.equal(getSICourse(row), 'Seniors');
    assert.equal(getSIStatus(row), 'DNF');
  });

  it('getSIBib is 0 and getSIRaceTime is empty string when absent/unparseable', () => {
    assert.equal(getSIBib({}), 0);
    assert.equal(getSIRaceTime({ RaceTime: 'garbage' }), '');
  });

  it('getSINumSplits and getSISplitTime read split-numbered columns (split 1 is unsuffixed)', () => {
    const row = { NumSplits: '2', Split: '00:10:00', Split_2: '00:20:00' };
    assert.equal(getSINumSplits(row), 2);
    assert.equal(getSISplitTime(row, 1), '00:10:00');
    assert.equal(getSISplitTime(row, 2), '00:20:00');
    assert.equal(getSISplitTime(row, 3), '');
  });
});

describe('si-results.js:getSIAccountedBibs', () => {
  it('includes a bib with a race time or a non-blank status, not a bib with neither', () => {
    state.siResults = [
      { RaceNumber: '1', RaceTime: '01:00:00' },
      { RaceNumber: '2', Status: 'DNF' },
      { RaceNumber: '3' }, // neither -> not accounted for
    ];
    assert.deepEqual([...getSIAccountedBibs()].sort(), [1, 2]);
  });
});

describe('si-results.js:verifySIResults', () => {
  it('flags a bib not present in entries', () => {
    const issues = verifySIResults([{ RaceNumber: '99', 'Name (Free Format)': 'X' }]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].issue, /not in entries/);
  });

  it('flags a name mismatch against the matched entry', () => {
    const issues = verifySIResults([{ RaceNumber: '1', 'Name (Free Format)': 'Someone Else' }]);
    assert.match(issues[0].issue, /Name mismatch/);
  });

  it('flags a course mismatch against the matched entry', () => {
    const issues = verifySIResults([{ RaceNumber: '1', 'Name (Free Format)': 'Dave Smith', CourseClass: 'Juniors' }]);
    assert.match(issues[0].issue, /Course mismatch/);
  });

  it('is clean for a row that matches its entry', () => {
    const issues = verifySIResults([{ RaceNumber: '1', 'Name (Free Format)': 'Dave Smith', CourseClass: 'Seniors' }]);
    assert.deepEqual(issues, []);
  });

  it('skips a row with no bib at all', () => {
    assert.deepEqual(verifySIResults([{ 'Name (Free Format)': 'No bib' }]), []);
  });
});

describe('si-results.js:importSIResults', () => {
  it('rejects empty input', async () => {
    const r = await importSIResults('');
    assert.equal(r.imported, 0);
    assert.match(r.errors[0], /Empty file/);
  });

  it('rejects a CSV missing required columns', async () => {
    const r = await importSIResults('RaceNumber,Name (Free Format)\n1,Dave Smith');
    assert.equal(r.imported, 0);
    assert.match(r.errors[0], /Missing required columns/);
  });

  it('rejects a CSV whose rows fail verification (e.g. wrong file selected)', async () => {
    const csv = `${REQUIRED_HEADER}\n99,Someone Else,MSEN,Club,Seniors,01:00:00,1,`;
    const r = await importSIResults(csv);
    assert.equal(r.imported, 0);
    assert.match(r.errors[0], /Verification failed/);
    assert.equal(r.issues.length, 1);
  });

  it('imports and saves rows that verify cleanly', async () => {
    const csv = `${REQUIRED_HEADER}\n1,Dave Smith,MSEN,Club,Seniors,01:00:00,1,`;
    const r = await importSIResults(csv);
    assert.equal(r.imported, 1);
    assert.equal(r.errors.length, 0);
    assert.equal(state.siResults.length, 1);
  });
});

describe('si-results.js:clearSIResults', () => {
  it('empties state.siResults', async () => {
    state.siResults = [{ RaceNumber: '1' }];
    await clearSIResults();
    assert.deepEqual(state.siResults, []);
  });
});
