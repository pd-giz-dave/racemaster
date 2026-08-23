'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  addPerson, sortPeople, getLastDibberNumber, getLastBibNumber, getNextBibNumber,
  getNextDibberNumber, mergeSIEntries, laterDate, normalisePeopleRows, normaliseDibberRows,
} from '../js/data.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.people     = [];
  state.entries    = [];
  state.dibbers    = [];
  state.preEntries = [];
  state.event      = { date: '15/06/2026', firstBibNumber: 1, firstDibberNumber: 1 };
});

describe('data.js:addPerson', () => {
  it('adds a new person and returns their index', () => {
    const idx = addPerson('Dave Nicholson', null, 'Male', '01/01/1990', 'Dark Peak', '123', '', false);
    assert.equal(idx, 0);
    assert.equal(state.people[0].name, 'Dave Nicholson');
    assert.equal(state.people[0].seenTotal, 1);
    assert.equal(state.people[0].lastSeen, '15/06/2026');
  });

  it('rejects a non-helper with no parseable dob', () => {
    assert.equal(addPerson('Dave', null, 'Male', '', '', '', '', false), null);
  });

  it('allows a helper with no dob at all', () => {
    const idx = addPerson('Dave', null, 'Male', '', '', '', '', true);
    assert.equal(idx, 0);
    assert.equal(state.people[0].helpedTotal, 1);
  });

  it('updates (not duplicates) an existing person matched by name+gender+dob, returning null', () => {
    addPerson('Dave Nicholson', null, 'Male', '01/01/1990', 'Dark Peak', '', '', false);
    const idx = addPerson('Dave Nicholson', null, 'Male', '01/01/1990', 'Dark Peak', '', '', false);
    assert.equal(idx, null);
    assert.equal(state.people.length, 1);
    assert.equal(state.people[0].seenTotal, 2);
  });

  it('defaults gender to Male unless explicitly Female', () => {
    addPerson('X', null, 'nonsense', '01/01/1990', '', '', '', false);
    assert.equal(state.people[0].gender, 'Male');
  });

  it('only takes the first "|"-separated segment of a combined club string', () => {
    addPerson('Dave', null, 'Male', '01/01/1990', 'Dark Peak | some note', '', '', false);
    assert.equal(state.people[0].club, 'Dark Peak');
  });
});

describe('data.js:sortPeople', () => {
  it('sorts by name then dob', () => {
    state.people = [{ name: 'B', dob: '' }, { name: 'A', dob: '' }];
    sortPeople();
    assert.deepEqual(state.people.map(p => p.name), ['A', 'B']);
  });
});

describe('data.js:getLastBibNumber / getLastDibberNumber / getNextBibNumber / getNextDibberNumber', () => {
  it('getLastBibNumber finds the highest bib number used', () => {
    state.entries = [{ bibNumber: '3', dibberNumber: '10' }, { bibNumber: '5', dibberNumber: '2' }];
    assert.equal(getLastBibNumber(), 5);
  });

  it('getLastDibberNumber scans backward and returns the last entry\'s dibber, not the max across all entries', () => {
    state.entries = [{ bibNumber: '3', dibberNumber: '10' }, { bibNumber: '5', dibberNumber: '2' }];
    assert.equal(getLastDibberNumber(), 2); // entries[1] (the last one) has dibber 2, even though entries[0] has the higher 10
  });

  it('getNextBibNumber continues from the last used bib, or firstBibNumber if none used', () => {
    assert.equal(getNextBibNumber(), 1);
    state.entries = [{ bibNumber: '5' }];
    assert.equal(getNextBibNumber(), 6);
  });

  it('getNextDibberNumber continues past the last used dibber, skipping lost ones', () => {
    state.dibbers = [{ shortCode: 1, lost: '' }, { shortCode: 2, lost: '01/01/2026' }, { shortCode: 3, lost: '' }];
    assert.deepEqual(getNextDibberNumber(), { number: 1, skipped: [] });
    state.entries = [{ dibberNumber: '1' }];
    assert.deepEqual(getNextDibberNumber(), { number: 3, skipped: [2] });
  });

  it('getNextDibberNumber returns null when none loaded or the list is exhausted', () => {
    assert.equal(getNextDibberNumber(), null);
    state.dibbers = [{ shortCode: 1, lost: '' }];
    state.entries = [{ dibberNumber: '1' }];
    assert.equal(getNextDibberNumber(), null);
  });
});

describe('data.js:mergeSIEntries', () => {
  it('adds a new person per pre-entry not already known', async () => {
    state.preEntries = [{ firstName: 'Dave', lastName: 'Smith', gender: 'Male', dob: '01/01/1990', club: 'Dark Peak' }];
    const r = await mergeSIEntries();
    assert.equal(r.peopleAdded, 1);
    assert.equal(state.people.length, 1);
  });

  it('updates club/fraNumber on an already-known person instead of duplicating', async () => {
    state.people = [{ name: 'Dave Smith', gender: 'Male', dob: '01/01/1990', club: '', fraNumber: '' }];
    state.preEntries = [{ firstName: 'Dave', lastName: 'Smith', gender: 'Male', dob: '01/01/1990', club: 'Dark Peak', fraNumber: '99' }];
    const r = await mergeSIEntries();
    assert.equal(r.peopleAdded, 0);
    assert.equal(state.people.length, 1);
    assert.equal(state.people[0].club, 'Dark Peak');
    assert.equal(state.people[0].fraNumber, '99');
  });

  it('is a no-op with no pre-entries', async () => {
    const r = await mergeSIEntries();
    assert.equal(r.peopleAdded, 0);
  });
});

describe('data.js:laterDate', () => {
  it('returns whichever DD/MM/YYYY date is later', () => {
    assert.equal(laterDate('01/01/2026', '15/06/2026'), '15/06/2026');
    assert.equal(laterDate('15/06/2026', '01/01/2026'), '15/06/2026');
  });

  it('falls back to whichever side is non-empty', () => {
    assert.equal(laterDate('', '15/06/2026'), '15/06/2026');
    assert.equal(laterDate('15/06/2026', ''), '15/06/2026');
    assert.equal(laterDate('', ''), '');
  });
});

describe('data.js:normalisePeopleRows', () => {
  it('maps aliased CSV columns to canonical field names', () => {
    const rows = normalisePeopleRows([{ Name: 'Dave', Gender: 'Male', DOB: '01/01/1990' }]);
    assert.deepEqual(rows, [{ name: 'Dave', gender: 'Male', dob: '01/01/1990' }]);
  });

  it('returns null when name/gender/dob cannot all be resolved', () => {
    assert.equal(normalisePeopleRows([{ Name: 'Dave' }]), null);
  });

  it('returns the input unchanged for an empty array', () => {
    assert.deepEqual(normalisePeopleRows([]), []);
  });
});

describe('data.js:normaliseDibberRows', () => {
  it('maps aliased columns and runs them through createDibber', () => {
    const rows = normaliseDibberRows([{ 'Short Code': '1', 'Long Code': '1001', Owner: 'Club' }]);
    assert.deepEqual(rows, [{ shortCode: '1', longCode: '1001', owner: 'Club', lost: '', notes: '' }]);
  });

  it('returns null when shortCode/longCode columns cannot be found', () => {
    assert.equal(normaliseDibberRows([{ Owner: 'Club' }]), null);
  });
});
