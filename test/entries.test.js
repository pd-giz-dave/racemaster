'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { builtinFRARows } from '../js/categories.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  isBanned, isEntryBanned, getEntriesOnCourse, getEntryLimit, courseFull,
  findEntryByBib, findEntryByDibber, getEntry, addEntry, submitEntry, updateEntry,
  insertEntryAndRenumber, deleteEntryAndRenumber, clearAllEntries, reapplyEntryCategories,
  getSortedEntries, getEntryName, exportSITimingCSV,
} from '../js/entries.js';

function dibbers(codes) {
  return codes.map(shortCode => ({ shortCode, longCode: shortCode + 1000, owner: '', lost: '', notes: '' }));
}

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.entries    = [];
  state.people     = [];
  state.dibbers    = [];
  state.preEntries = [];
  state.categories = builtinFRARows();
  state.event = {
    date: '15/06/2026', entryLimit: 180, juniorEntryLimit: 100,
    timingMethod: 'Stopwatch', juniorTimingMethod: 'Stopwatch',
    firstBibNumber: 1, firstDibberNumber: 1,
  };
});

describe('entries.js:isBanned', () => {
  it('is false with no ban date', () => {
    assert.equal(isBanned({ banned: '' }), false);
    assert.equal(isBanned(null), false);
  });

  it('is true while today is on/before the ban-until date', () => {
    const future = new Date(); future.setFullYear(future.getFullYear() + 1);
    const dd = String(future.getDate()).padStart(2, '0');
    const mm = String(future.getMonth() + 1).padStart(2, '0');
    assert.equal(isBanned({ banned: `${dd}/${mm}/${future.getFullYear()}` }), true);
  });

  it('is false once the ban-until date has passed', () => {
    assert.equal(isBanned({ banned: '01/01/2000' }), false);
  });
});

describe('entries.js:isEntryBanned', () => {
  it('looks the entry up in state.people by name+dob and checks their ban', () => {
    state.people = [{ name: 'Dave Nicholson', dob: '01/01/1990', banned: '01/01/2099' }];
    assert.equal(isEntryBanned({ name: 'Dave Nicholson', dob: '01/01/1990' }), true);
    assert.equal(isEntryBanned({ name: 'Someone Else', dob: '01/01/1990' }), false);
  });
});

describe('entries.js:getEntriesOnCourse / getEntryLimit / courseFull', () => {
  it('counts entries per course and checks the right limit', () => {
    state.entries = [{ course: 'Seniors' }, { course: 'Seniors' }, { course: 'Juniors' }];
    assert.equal(getEntriesOnCourse('Seniors'), 2);
    assert.equal(getEntryLimit('Seniors'), 180);
    assert.equal(getEntryLimit('Juniors'), 100);
  });

  it('a course is full once entries reach the limit; a zero limit means never full', () => {
    state.event.entryLimit = 2;
    state.entries = [{ course: 'Seniors' }, { course: 'Seniors' }];
    assert.equal(courseFull('Seniors'), true);
    state.event.entryLimit = 0;
    assert.equal(courseFull('Seniors'), false);
  });
});

describe('entries.js:findEntryByBib / findEntryByDibber / getEntry', () => {
  it('finds by bib or dibber number, returns -1/null when absent', () => {
    state.entries = [{ bibNumber: '5', dibberNumber: '20' }];
    assert.equal(findEntryByBib(5), 0);
    assert.equal(findEntryByBib(999), -1);
    assert.equal(findEntryByDibber(20), 0);
    assert.equal(getEntry(5).bibNumber, '5');
    assert.equal(getEntry(999), null);
  });
});

describe('entries.js:addEntry', () => {
  it('creates a new entry, defaulting course to Seniors', () => {
    const idx = addEntry({ bibNumber: 1, name: 'Dave', gender: 'Male', dob: '01/01/1990' });
    assert.equal(idx, 0);
    assert.equal(state.entries[0].course, 'Seniors');
    assert.equal(state.entries[0].name, 'Dave');
  });

  it('updates an existing entry by bib, preserving unspecified fields', () => {
    addEntry({ bibNumber: 1, name: 'Dave', club: 'Dark Peak', gender: 'Male', dob: '01/01/1990' });
    const idx = addEntry({ bibNumber: 1, name: 'Dave Nicholson' });
    assert.equal(idx, 0);
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0].name, 'Dave Nicholson');
    assert.equal(state.entries[0].club, 'Dark Peak'); // untouched
  });

  it('rejects a missing or non-positive bib number', () => {
    assert.equal(addEntry({ bibNumber: 0, name: 'Dave' }), -1);
    assert.equal(addEntry({ bibNumber: '', name: 'Dave' }), -1);
  });
});

describe('entries.js:submitEntry', () => {
  it('allocates the next bib number and saves a person record', async () => {
    const r = await submitEntry({ name: 'Dave Nicholson', gender: 'Male', dob: '01/01/1990' });
    assert.equal(r.error, '');
    assert.equal(r.bibNumber, 1); // state.event.firstBibNumber
    assert.equal(state.entries.length, 1);
    assert.ok(state.people.some(p => p.name === 'Dave Nicholson'));
  });

  it('rejects a duplicate name+dob', async () => {
    await submitEntry({ name: 'Dave Nicholson', gender: 'Male', dob: '01/01/1990' });
    const r = await submitEntry({ name: 'Dave Nicholson', gender: 'Male', dob: '01/01/1990' });
    assert.match(r.error, /already entered as bib 1/);
  });

  it('returns a bannedWarning instead of an error for a banned entrant, unless overridden', async () => {
    state.people = [{ name: 'Dave Nicholson', dob: '01/01/1990', banned: '01/01/2099' }];
    const r = await submitEntry({ name: 'Dave Nicholson', gender: 'Male', dob: '01/01/1990' });
    assert.equal(r.bannedWarning, '01/01/2099');
    assert.equal(state.entries.length, 0);

    const r2 = await submitEntry({ name: 'Dave Nicholson', gender: 'Male', dob: '01/01/1990', overrideBan: true });
    assert.equal(r2.error, '');
  });

  it('rejects entry once the course is full', async () => {
    state.event.entryLimit = 1;
    await submitEntry({ name: 'A', gender: 'Male', dob: '01/01/1990' });
    const r = await submitEntry({ name: 'B', gender: 'Male', dob: '01/01/1990' });
    assert.match(r.error, /is full/);
  });

  it('allocates the next dibber number under Dibbers timing, skipping any marked lost', async () => {
    state.event.timingMethod = 'Dibbers';
    state.dibbers = dibbers([1, 2, 3]);
    state.dibbers[1].lost = '01/01/2026'; // dibber 2 lost
    const r1 = await submitEntry({ name: 'Dave',  gender: 'Male', dob: '01/01/1990' });
    assert.equal(r1.dibberNumber, 1);
    const r2 = await submitEntry({ name: 'Alice', gender: 'Female', dob: '01/01/1990' });
    assert.equal(r2.dibberNumber, 3); // dibber 2 skipped
    assert.match(r2.lostWarning, /Dibber 2 skipped/);
  });

  it('errors when no dibbers are loaded at all under Dibbers timing', async () => {
    state.event.timingMethod = 'Dibbers';
    const r = await submitEntry({ name: 'Dave', gender: 'Male', dob: '01/01/1990' });
    assert.match(r.error, /No dibbers loaded/);
  });

  it('computes a pair category/course from the younger competitor when a partner is given', async () => {
    const r = await submitEntry({
      name: 'Dave', gender: 'Male', dob: '01/01/1984',
      partner: { name: 'Junior Partner', gender: 'Male', dob: '01/01/2016' },
    });
    assert.equal(r.error, '');
    assert.equal(state.entries[0].category, 'U12B');
    assert.ok(state.people.some(p => p.name === 'Junior Partner'));
  });
});

describe('entries.js:updateEntry', () => {
  it('errors for an unknown bib', async () => {
    const r = await updateEntry(999, { name: 'X' });
    assert.match(r.error, /not found/);
  });

  it('rejects moving to a bib already in use', async () => {
    await submitEntry({ name: 'A', gender: 'Male', dob: '01/01/1990' });
    await submitEntry({ name: 'B', gender: 'Male', dob: '01/01/1990' });
    const r = await updateEntry(1, { bibOverride: 2 });
    assert.match(r.error, /already in use/);
  });

  it('drops the dibber and shifts later dibber holders backward when switching off a dibber course', async () => {
    state.event.timingMethod = 'Dibbers';
    state.dibbers = dibbers([1, 2, 3]);
    await submitEntry({ name: 'A', gender: 'Male', dob: '01/01/1990' }); // dibber 1
    await submitEntry({ name: 'B', gender: 'Male', dob: '01/01/1990' }); // dibber 2
    const r = await updateEntry(1, { course: 'Juniors' }); // A switches off dibbers (still adult though — just testing the mechanism)
    assert.equal(r.error, '');
    assert.equal(+state.entries[0].dibberNumber, 0);
    assert.equal(+state.entries[1].dibberNumber, 1); // B shifted back into A's freed slot
  });

  it('allocates a new dibber and shifts later holders forward when switching a course onto dibbers', async () => {
    // wasUsingDibbers/nowUsingDibbers compare the OLD vs NEW course's own timing method, evaluated
    // at update time — so the trigger is a course change where the two courses' timing methods
    // differ, not a global timing-method change applied to the same course.
    state.event.timingMethod       = 'Stopwatch'; // Seniors
    state.event.juniorTimingMethod = 'Dibbers';   // Juniors
    state.dibbers = dibbers([1, 2]);
    await submitEntry({ name: 'A', gender: 'Male', dob: '01/01/1990', course: 'Seniors' });
    const r = await updateEntry(1, { course: 'Juniors' });
    assert.equal(r.error, '');
    assert.equal(+state.entries[0].dibberNumber, 1);
  });
});

describe('entries.js:insertEntryAndRenumber', () => {
  it('inserts at the given bib, shifting existing bibs (and their dibbers) up by one', async () => {
    state.event.timingMethod = 'Dibbers';
    state.dibbers = dibbers([1, 2, 3]);
    await submitEntry({ name: 'A', gender: 'Male', dob: '01/01/1990' }); // bib 1, dibber 1
    await submitEntry({ name: 'B', gender: 'Male', dob: '01/01/1990' }); // bib 2, dibber 2

    const r = await insertEntryAndRenumber(1, { name: 'New', gender: 'Male', dob: '01/01/1990' });
    assert.equal(r.error, '');
    assert.equal(r.bibNumber, 1);
    assert.equal(state.entries.length, 3);
    assert.equal(state.entries[0].name, 'New');
    assert.equal(state.entries[1].bibNumber, 2); // A pushed to bib 2
    assert.equal(state.entries[2].bibNumber, 3); // B pushed to bib 3
  });

  it('errors for an unknown bib to insert at', async () => {
    const r = await insertEntryAndRenumber(5, { name: 'X', gender: 'Male', dob: '01/01/1990' });
    assert.match(r.error, /not found/);
  });
});

describe('entries.js:deleteEntryAndRenumber', () => {
  it('removes the entry and decrements all later bibs, filling the freed dibber slot', async () => {
    state.event.timingMethod = 'Dibbers';
    state.dibbers = dibbers([1, 2, 3]);
    await submitEntry({ name: 'A', gender: 'Male', dob: '01/01/1990' }); // bib 1, dibber 1
    await submitEntry({ name: 'B', gender: 'Male', dob: '01/01/1990' }); // bib 2, dibber 2
    await submitEntry({ name: 'C', gender: 'Male', dob: '01/01/1990' }); // bib 3, dibber 3

    const r = await deleteEntryAndRenumber(1);
    assert.equal(r.error, '');
    assert.equal(state.entries.length, 2);
    assert.equal(state.entries[0].name, 'B');
    assert.equal(state.entries[0].bibNumber, 1);
    assert.equal(+state.entries[0].dibberNumber, 1); // shifted into freed slot
    assert.equal(state.entries[1].bibNumber, 2);
    assert.equal(+state.entries[1].dibberNumber, 2);
  });

  it('errors for an unknown bib', async () => {
    const r = await deleteEntryAndRenumber(999);
    assert.match(r.error, /not found/);
  });
});

describe('entries.js:clearAllEntries', () => {
  it('empties state.entries', async () => {
    state.entries = [{ bibNumber: '1' }];
    await clearAllEntries();
    assert.deepEqual(state.entries, []);
  });
});

describe('entries.js:reapplyEntryCategories', () => {
  it('recomputes category and course for every entry with a DOB', async () => {
    state.entries = [
      { bibNumber: '1', dob: '01/01/1990', gender: 'Male', category: 'STALE', course: 'Juniors' },
      { bibNumber: '2', dob: '', gender: 'Male', category: 'UNCHANGED' },
    ];
    await reapplyEntryCategories();
    assert.equal(state.entries[0].category, 'MSEN');
    assert.equal(state.entries[0].course, 'Seniors');
    assert.equal(state.entries[1].category, 'UNCHANGED'); // no DOB -> skipped
  });
});

describe('entries.js:getSortedEntries', () => {
  it('sorts by bib number ascending without mutating state.entries', () => {
    state.entries = [{ bibNumber: '3' }, { bibNumber: '1' }, { bibNumber: '2' }];
    assert.deepEqual(getSortedEntries().map(e => e.bibNumber), ['1', '2', '3']);
    assert.deepEqual(state.entries.map(e => e.bibNumber), ['3', '1', '2']);
  });
});

describe('entries.js:getEntryName', () => {
  it('joins partner names with a slash for a pair entry', () => {
    assert.equal(getEntryName({ name: 'Dave', partner: { name: 'Partner' } }), 'Dave / Partner');
    assert.equal(getEntryName({ name: 'Dave', partner: null }), 'Dave');
    assert.equal(getEntryName(null), '');
  });
});

describe('entries.js:exportSITimingCSV', () => {
  it('exports dibber-bearing entries using the dibber\'s long code', () => {
    state.dibbers = [{ shortCode: 1, longCode: 12345, lost: '' }];
    const rows = exportSITimingCSV([{ bibNumber: '1', dibberNumber: '1', name: 'Dave', gender: 'Male', category: 'MSEN', course: 'Seniors' }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['CardNumbers'], 12345);
    assert.equal(rows[0]['Name (Free Format)'], 'Dave');
  });

  it('skips entries without a bib or dibber number', () => {
    const rows = exportSITimingCSV([{ bibNumber: '', dibberNumber: '1' }, { bibNumber: '1', dibberNumber: '' }]);
    assert.deepEqual(rows, []);
  });

  it('throws a clear error when the dibber is not found in the dibbers list', () => {
    state.dibbers = [];
    assert.throws(
      () => exportSITimingCSV([{ bibNumber: '1', dibberNumber: '99', name: 'Dave' }]),
      /dibber 99 not found/,
    );
  });
});
