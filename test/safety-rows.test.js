'use strict';

// getCategoryProgress is covered in test/safety-progress.test.js — this file covers the rest of
// js/safety.js's exports.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { builtinFRARows } from '../js/categories.js';
import {
  getFinishedBibs, getFinishedOnlyBibs, entryInfo, getOutstandingRows, getDnfRows,
  getFinishedRows, getEarlyStarterRows, getExplicitStart, buildNoShows, getSafetyCounts,
} from '../js/safety.js';

beforeEach(() => {
  state.entries         = [];
  state.finishers        = [];
  state.mobileProgress   = [];
  state.siResults        = [];
  state.preEntries       = [];
  state.people           = [];
  state.finishNumbersMap = {};
  state.categories       = builtinFRARows();
  state.event = {
    date: '15/06/2026', timingMethod: 'Stopwatch', juniorTimingMethod: 'Stopwatch',
    prizeDepthOverall: 3, prizeDepthPerCategory: 1, juniorPrizeDepthPerCategory: 6,
  };
});

describe('safety.js:getFinishedBibs', () => {
  it('includes Finish and DNF actions, from both stopwatch and mobile sources', () => {
    state.finishers      = [{ action: 'Finish', number: '1' }];
    state.mobileProgress = [{ action: 'DNF', number: '2' }];
    assert.deepEqual([...getFinishedBibs()].sort(), [1, 2]);
  });

  it('also includes anyone accounted for in SI results (time or status)', () => {
    state.siResults = [{ RaceNumber: '3', Status: 'DNF' }];
    assert.deepEqual([...getFinishedBibs()], [3]);
  });
});

describe('safety.js:getFinishedOnlyBibs', () => {
  it('excludes DNF, includes only a true Finish (stopwatch/mobile) or an SI row with a race time', () => {
    state.finishers      = [{ action: 'Finish', number: '1' }, { action: 'DNF', number: '2' }];
    state.siResults       = [{ RaceNumber: '3', RaceTime: '01:00:00' }, { RaceNumber: '4', Status: 'DNF' }];
    assert.deepEqual([...getFinishedOnlyBibs()].sort(), [1, 3]);
  });
});

describe('safety.js:entryInfo', () => {
  it('reports name/course/category for a solo entry', () => {
    state.entries = [{ bibNumber: '1', name: 'Dave', course: 'Seniors', category: 'MSEN' }];
    assert.deepEqual(entryInfo(1), { name: 'Dave', course: 'Seniors', category: 'MSEN' });
  });

  it('appends " (banned)" for a banned entrant', () => {
    state.entries = [{ bibNumber: '1', name: 'Dave', dob: '01/01/1990', course: 'Seniors', category: 'MSEN' }];
    state.people  = [{ name: 'Dave', dob: '01/01/1990', banned: '01/01/2099' }];
    assert.equal(entryInfo(1).name, 'Dave (banned)');
  });

  it('appends the pair gender to the category for a partnered entry', () => {
    state.entries = [{ bibNumber: '1', name: 'Dave', gender: 'Male', category: 'MSEN', course: 'Seniors',
      partner: { name: 'Ally', gender: 'Female' } }];
    const info = entryInfo(1);
    assert.equal(info.name, 'Dave / Ally');
    assert.equal(info.category, 'MSEN Mixed');
  });

  it('handles an unknown bib gracefully', () => {
    assert.deepEqual(entryInfo(999), { name: '', course: '', category: '' });
  });
});

describe('safety.js:getOutstandingRows', () => {
  it('lists entries not yet accounted for, sorted by bib, optionally filtered by course', () => {
    state.entries = [
      { bibNumber: '2', course: 'Seniors' },
      { bibNumber: '1', course: 'Seniors' },
      { bibNumber: '3', course: 'Juniors' },
    ];
    state.finishers = [{ action: 'Finish', number: '1' }];
    assert.deepEqual(getOutstandingRows().map(e => e.bibNumber), ['2', '3']);
    assert.deepEqual(getOutstandingRows('Seniors').map(e => e.bibNumber), ['2']);
  });
});

describe('safety.js:getDnfRows', () => {
  it('combines stopwatch, mobile, and SI-only DNFs, deduped by bib and sorted', () => {
    state.entries = [
      { bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' },
      { bibNumber: '2', name: 'B', course: 'Seniors', category: 'MSEN' },
      { bibNumber: '3', name: 'C', course: 'Juniors', category: 'U12B' },
    ];
    state.finishers      = [{ action: 'DNF', number: '2' }];
    state.mobileProgress = [{ action: 'DNF', number: '1' }];
    state.siResults       = [{ RaceNumber: '3', Status: 'DNF' }, { RaceNumber: '2', Status: 'DNF' }]; // bib 2 already known
    const rows = getDnfRows();
    assert.deepEqual(rows.map(r => r.bib), [1, 2, 3]);
    assert.equal(rows[0].name, 'A');
  });

  it('a stopwatch retiree is Finish, with whatever time (if any) the operator gave it', () => {
    state.entries   = [{ bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' }];
    state.finishers = [{ action: 'DNF', number: '1', time: '00:15:00' }];
    const rows = getDnfRows();
    assert.deepEqual(rows[0], { bib: 1, idx: 0, name: 'A', course: 'Seniors', category: 'MSEN', where: 'Finish', when: '00:15:00', whenTimeOfDay: '' });
  });

  it('a stopwatch retiree with no time given comes back with when blank', () => {
    state.entries   = [{ bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' }];
    state.finishers = [{ action: 'DNF', number: '1', time: '-' }];
    const rows = getDnfRows();
    assert.equal(rows[0].where, 'Finish');
    assert.equal(rows[0].when, '');
  });

  it('a mobile retiree with no checkpoint record is Finish, with its own computed elapsed time', () => {
    state.entries        = [{ bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' }];
    state.mobileProgress  = [{ action: 'DNF', number: '1', time: '00:20:00' }];
    const rows = getDnfRows();
    assert.deepEqual(rows[0].where, 'Finish');
    assert.equal(rows[0].when, '00:20:00');
  });

  it('a mobile retiree with a CP_RETIRE checkpoint record shows that checkpoint as where', () => {
    state.entries         = [{ bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' }];
    state.mobileProgress   = [{ action: 'DNF', number: '1', time: '00:10:00' }];
    state.mobileCheckpoints = [{ bibNumber: 1, cpTimes: { 1: 'Retire' } }];
    const rows = getDnfRows();
    assert.equal(rows[0].where, 'CP1');
    assert.equal(rows[0].when, '00:10:00');
  });

  it('a mobile retiree carries its device timeOfDay through when one is stored', () => {
    state.entries        = [{ bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' }];
    state.mobileProgress  = [{ action: 'DNF', number: '1', time: '00:20:00', timeOfDay: '19:50:00' }];
    const rows = getDnfRows();
    assert.equal(rows[0].whenTimeOfDay, '19:50:00');
  });

  it('an SI-only retiree has no location or time concept — both come back blank', () => {
    state.entries   = [{ bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' }];
    state.siResults = [{ RaceNumber: '1', Status: 'DNF' }];
    const rows = getDnfRows();
    assert.equal(rows[0].where, '');
    assert.equal(rows[0].when, '');
  });
});

describe('safety.js:getFinishedRows', () => {
  it('lists finishers with their position/time from the computed results', () => {
    state.entries   = [{ bibNumber: '1', course: 'Seniors', category: 'MSEN', name: 'Dave' }];
    state.finishers = [{ action: 'Finish', number: '1', time: '01:00:00' }];
    const rows = getFinishedRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Dave');
    assert.equal(rows[0].pos, 1);
    assert.equal(rows[0].time, '01:00:00');
  });
});

describe('safety.js:getEarlyStarterRows', () => {
  it('lists Start records from stopwatch and mobile, sorted by bib', () => {
    state.entries = [
      { bibNumber: '1', name: 'A', course: 'Seniors', category: 'MSEN' },
      { bibNumber: '2', name: 'B', course: 'Seniors', category: 'MSEN' },
    ];
    state.finishers      = [{ action: 'Start', number: '2', time: '00:05:00' }];
    state.mobileProgress = [{ action: 'Start', number: '1', time: '00:01:00' }];
    const rows = getEarlyStarterRows();
    assert.deepEqual(rows.map(r => r.number), ['1', '2']); // f.number passed through verbatim, not coerced
    assert.equal(rows[0].startTime, '00:01:00');
  });
});

describe('safety.js:getExplicitStart', () => {
  it('finds a stopwatch Start record, with no timeOfDay (no such concept for a stopwatch record)', () => {
    state.finishers = [{ action: 'Start', number: '1', time: '00:05:00' }];
    assert.deepEqual(getExplicitStart(1), { time: '00:05:00', timeOfDay: '' });
  });

  it('finds a mobile Start record when there is no stopwatch one, including its device timeOfDay', () => {
    state.mobileProgress = [{ action: 'Start', number: '2', time: '00:01:00', timeOfDay: '19:31:00' }];
    assert.deepEqual(getExplicitStart(2), { time: '00:01:00', timeOfDay: '19:31:00' });
  });

  it('prefers the stopwatch record when both exist', () => {
    state.finishers      = [{ action: 'Start', number: '3', time: '00:05:00' }];
    state.mobileProgress = [{ action: 'Start', number: '3', time: '00:01:00', timeOfDay: '19:31:00' }];
    assert.deepEqual(getExplicitStart(3), { time: '00:05:00', timeOfDay: '' });
  });

  it('returns null when there is no explicit Start record for this bib', () => {
    assert.equal(getExplicitStart(4), null);
  });
});

describe('safety.js:buildNoShows', () => {
  it('flags a pre-entry that never turned into an entry', () => {
    state.preEntries = [{ participantNumber: 'P1', firstName: 'Dave', lastName: 'Smith', dob: '01/01/1990' }];
    const rows = buildNoShows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Dave Smith');
  });

  it('excludes a pre-entry already linked to an entry via preEntry', () => {
    state.preEntries = [{ participantNumber: 'P1', firstName: 'Dave', lastName: 'Smith' }];
    state.entries     = [{ bibNumber: '1', preEntry: 'P1' }];
    assert.deepEqual(buildNoShows(), []);
  });

  it('flags a possible duplicate on-day entry by name (dupBib)', () => {
    state.preEntries = [{ participantNumber: 'P1', firstName: 'Dave', lastName: 'Smith', dob: '01/01/1990' }];
    state.entries     = [{ bibNumber: '7', name: 'Dave Smith', dob: '01/01/1990' }]; // entered on the day, not linked
    const rows = buildNoShows();
    assert.equal(rows[0].dupBib, '7');
  });
});

describe('safety.js:getSafetyCounts', () => {
  it('splits outstanding/DNF/entries counts by course', () => {
    state.entries = [
      { bibNumber: '1', course: 'Seniors' },
      { bibNumber: '2', course: 'Juniors' },
    ];
    const dnfRows = [{ bib: 1 }]; // getEntry(1).course === Seniors
    const counts = getSafetyCounts(dnfRows);
    assert.equal(counts.senEntries, 1);
    assert.equal(counts.jnrEntries, 1);
    assert.equal(counts.senDnf, 1);
    assert.equal(counts.jnrDnf, 0);
    assert.equal(counts.senOut, 1); // bib 1 not accounted for anywhere
    assert.equal(counts.jnrOut, 1);
  });
});
