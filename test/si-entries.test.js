'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  parseSIEntriesCSV, importSIEntries, verifySIEntries, clearSIEntries, getSortedPreEntries,
} from '../js/si-entries.js';

const HEADER = 'Participant - Participant No,Participant - First Name,Participant - Last Name,Participant - Gender,Participant - Date of Birth';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.preEntries = [];
});

describe('si-entries.js:parseSIEntriesCSV', () => {
  it('maps aliased columns into the canonical preEntry field names', () => {
    const rows = parseSIEntriesCSV(`${HEADER}\nP1,Dave,Smith,Male,01/01/1990`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].participantNumber, 'P1');
    assert.equal(rows[0].firstName, 'Dave');
    assert.equal(rows[0].lastName, 'Smith');
    assert.equal(rows[0].gender, 'Male');
    assert.equal(rows[0].dob, '01/01/1990');
  });

  it('normalises gender to Male/Female from just the first letter, blank if unrecognised', () => {
    const rows = parseSIEntriesCSV(`${HEADER}\nP1,A,B,F,\nP2,C,D,x,`);
    assert.equal(rows[0].gender, 'Female');
    assert.equal(rows[1].gender, '');
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(parseSIEntriesCSV(''), []);
  });
});

describe('si-entries.js:importSIEntries', () => {
  it('adds new pre-entries and saves them', async () => {
    const r = await importSIEntries(`${HEADER}\nP1,Dave,Smith,Male,01/01/1990`);
    assert.equal(r.added, 1);
    assert.equal(r.updated, 0);
    assert.equal(state.preEntries.length, 1);
  });

  it('updates an existing pre-entry matched by participant number', async () => {
    await importSIEntries(`${HEADER}\nP1,Dave,Smith,Male,01/01/1990`);
    const r = await importSIEntries(`${HEADER}\nP1,Dave,Smithson,Male,01/01/1990`);
    assert.equal(r.added, 0);
    assert.equal(r.updated, 1);
    assert.equal(state.preEntries.length, 1);
    assert.equal(state.preEntries[0].lastName, 'Smithson');
  });

  it('falls back to matching by name+dob when there is no participant number', async () => {
    const noNumHeader = 'Participant - First Name,Participant - Last Name,Participant - Gender,Participant - Date of Birth';
    await importSIEntries(`${noNumHeader}\nDave,Smith,Male,01/01/1990`);
    const r = await importSIEntries(`${noNumHeader}\nDave,Smith,Male,01/01/1990`);
    assert.equal(r.updated, 1);
    assert.equal(state.preEntries.length, 1);
  });

  it('skips a row with no name at all', async () => {
    const r = await importSIEntries(`${HEADER}\nP1,,,Male,01/01/1990`);
    assert.equal(r.added, 0);
    assert.equal(r.updated, 0);
  });

  it('reports an error for a file with no data', async () => {
    const r = await importSIEntries('');
    assert.equal(r.added, 0);
    assert.match(r.errors[0], /No data found/);
  });
});

describe('si-entries.js:verifySIEntries', () => {
  it('is clean when there is nothing to verify', () => {
    assert.deepEqual(verifySIEntries(), []);
  });

  it('flags an unrecognised CSV format when required columns are entirely absent', () => {
    state.preEntries = [{ participantNumber: '', firstName: '', lastName: '', dob: '', gender: '' }];
    const issues = verifySIEntries();
    assert.equal(issues.length, 1);
    assert.match(issues[0].issue, /CSV format not recognised/);
  });

  it('flags a missing name on one row, alongside an otherwise-complete row (so the CSV-format-level check does not short-circuit first)', () => {
    state.preEntries = [
      { participantNumber: 'P1', firstName: 'Dave', lastName: 'Smith', dob: '01/01/1990', gender: 'Male' },
      { participantNumber: 'P2', firstName: '', lastName: '', dob: '01/01/1990', gender: 'Male' },
    ];
    const issues = verifySIEntries();
    assert.ok(issues.some(i => i.issue === 'Missing name'));
  });

  it('flags a missing dob/gender on an otherwise-named row (again alongside a complete row)', () => {
    state.preEntries = [
      { participantNumber: 'P1', firstName: 'Dave', lastName: 'Smith', dob: '01/01/1990', gender: 'Male' },
      { participantNumber: 'P2', firstName: 'Alice', lastName: 'Jones', dob: '', gender: '' },
    ];
    const issues = verifySIEntries();
    assert.ok(issues.some(i => /Missing or invalid date of birth/.test(i.issue)));
    assert.ok(issues.some(i => /Missing or unrecognised gender/.test(i.issue)));
  });

  it('flags a duplicate name+dob, referencing the first occurrence\'s row', () => {
    state.preEntries = [
      { participantNumber: 'P1', firstName: 'Dave', lastName: 'Smith', dob: '01/01/1990', gender: 'Male' },
      { participantNumber: 'P2', firstName: 'Dave', lastName: 'Smith', dob: '01/01/1990', gender: 'Male' },
    ];
    const issues = verifySIEntries();
    assert.ok(issues.some(i => i.issue === 'Duplicate of row 1'));
  });
});

describe('si-entries.js:clearSIEntries', () => {
  it('empties state.preEntries', async () => {
    state.preEntries = [{ participantNumber: 'P1' }];
    await clearSIEntries();
    assert.deepEqual(state.preEntries, []);
  });
});

describe('si-entries.js:getSortedPreEntries', () => {
  it('sorts by last name then first name, without mutating state', () => {
    state.preEntries = [
      { firstName: 'B', lastName: 'Smith' },
      { firstName: 'A', lastName: 'Smith' },
      { firstName: 'Z', lastName: 'Adams' },
    ];
    const sorted = getSortedPreEntries();
    assert.deepEqual(sorted.map(p => `${p.firstName} ${p.lastName}`), ['Z Adams', 'A Smith', 'B Smith']);
    assert.equal(state.preEntries[0].firstName, 'B'); // original order untouched
  });
});
