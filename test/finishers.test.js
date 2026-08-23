'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  buildFinishNumbersMap, buildSplitNumbers, getFinisherIndices, getFinisher, recordFinisher,
  updateFinisher, clearAllFinishers, deleteFinishersFrom, getOutstandingCount, getSortedFinishers,
  deleteFinisher, insertFinisherAbove, insertTimeAbove, getCategorySpecials, getAllSpecials,
  lineLabel, getPrevTime, parseFinishTime,
} from '../js/finishers.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.finishers        = [];
  state.finishNumbersMap = {};
  state.entries           = [
    { bibNumber: '1', course: 'Seniors', category: 'MSEN' },
    { bibNumber: '2', course: 'Juniors', category: 'U12B' },
  ];
  state.mobileProgress = [];
  state.siResults       = [];
});

describe('finishers.js:buildSplitNumbers', () => {
  it('numbers sequentially, skipping DNF and Clock actions', () => {
    state.finishers = [
      { action: 'Finish', number: '1' },
      { action: 'DNF',    number: '2' },
      { action: 'Clock',  number: '' },
      { action: 'Finish', number: '3' },
    ];
    buildSplitNumbers();
    assert.deepEqual(state.finishers.map(f => f.splitNumber), [1, null, null, 2]);
  });
});

describe('finishers.js:buildFinishNumbersMap / getFinisherIndices / getFinisher', () => {
  it('keys by course-prefix + bib, defaulting to Seniors ("S") when unresolvable', () => {
    state.finishers = [
      { action: 'Finish', number: '1' }, // Seniors -> S1
      { action: 'Finish', number: '2' }, // Juniors -> J2
    ];
    buildFinishNumbersMap();
    assert.deepEqual(getFinisherIndices(1, 'Seniors'), [0]);
    assert.deepEqual(getFinisherIndices(2, 'Juniors'), [1]);
    assert.equal(getFinisher(1, 'Seniors'), state.finishers[0]);
    assert.equal(getFinisher(999, 'Seniors'), null);
  });

  it('ignores finisher records for a bib not in entries', () => {
    state.finishers = [{ action: 'Finish', number: '999' }];
    buildFinishNumbersMap();
    assert.deepEqual(state.finishNumbersMap, {});
  });
});

describe('finishers.js:recordFinisher', () => {
  it('rejects a bib that is not in entries', async () => {
    const r = await recordFinisher(999, '01:00:00', 'Finish');
    assert.match(r.error, /not in entries/);
    assert.equal(state.finishers.length, 0);
  });

  it('records a valid finisher and assigns a split number', async () => {
    const r = await recordFinisher(1, '01:00:00', 'Finish');
    assert.equal(r.error, '');
    assert.equal(state.finishers[0].splitNumber, 1);
    assert.deepEqual(getFinisherIndices(1, 'Seniors'), [0]);
  });

  it('rejects a second Finish/DNF for the same bib, citing the split it clashes with', async () => {
    await recordFinisher(1, '01:00:00', 'Finish');
    const r = await recordFinisher(1, '01:05:00', 'Finish');
    assert.match(r.error, /already recorded at split 1/);
  });

  it('rejects a second Start for the same bib, independent of Finish/DNF', async () => {
    await recordFinisher(1, '00:00:00', 'Start');
    const r = await recordFinisher(1, '00:01:00', 'Start');
    assert.match(r.error, /already recorded/);
  });

  it('allows a bib of 0 (unknown runner) with no entry lookup', async () => {
    const r = await recordFinisher(0, '01:00:00', 'Finish');
    assert.equal(r.error, '');
  });

  it('defaults the action to Finish when none is given', async () => {
    await recordFinisher(1, '01:00:00');
    assert.equal(state.finishers[0].action, 'Finish');
  });
});

describe('finishers.js:updateFinisher', () => {
  it('updates the given fields and rebuilds the finish-numbers map', async () => {
    await recordFinisher(1, '01:00:00', 'Finish');
    const r = await updateFinisher(0, { number: '2', time: '02:00:00' });
    assert.equal(r.error, '');
    assert.equal(state.finishers[0].number, '2');
    assert.deepEqual(getFinisherIndices(2, 'Juniors'), [0]);
  });

  it('rejects an out-of-range index', async () => {
    const r = await updateFinisher(5, { number: '1' });
    assert.match(r.error, /Invalid index/);
  });
});

describe('finishers.js:clearAllFinishers / deleteFinishersFrom / deleteFinisher', () => {
  it('clearAllFinishers empties the list and the map', async () => {
    await recordFinisher(1, '01:00:00', 'Finish');
    await clearAllFinishers();
    assert.deepEqual(state.finishers, []);
    assert.deepEqual(state.finishNumbersMap, {});
  });

  it('deleteFinishersFrom removes stateIdx and everything after it', async () => {
    await recordFinisher(1, '01:00:00', 'Finish');
    await recordFinisher(2, '01:05:00', 'Finish');
    const r = await deleteFinishersFrom(0);
    assert.equal(r.deleted, 2);
    assert.equal(state.finishers.length, 0);
  });

  it('deleteFinisher removes just the one record', async () => {
    await recordFinisher(1, '01:00:00', 'Finish');
    await recordFinisher(2, '01:05:00', 'Finish');
    await deleteFinisher(0);
    assert.equal(state.finishers.length, 1);
    assert.equal(state.finishers[0].number, 2);
  });

  it('deleteFinisher/deleteFinishersFrom reject an out-of-range index', async () => {
    assert.match((await deleteFinisher(5)).error, /Invalid index/);
    assert.match((await deleteFinishersFrom(5)).error, /Finisher not found/);
  });
});

describe('finishers.js:insertFinisherAbove', () => {
  it('inserts a blank Finish row at the given index', async () => {
    await recordFinisher(1, '01:00:00', 'Finish');
    const r = await insertFinisherAbove(0);
    assert.equal(r.error, '');
    assert.equal(r.newIdx, 0);
    assert.equal(state.finishers.length, 2);
    assert.equal(state.finishers[0].number, '');
    assert.equal(state.finishers[1].number, 1);
  });
});

describe('finishers.js:insertTimeAbove', () => {
  it('cascades every time from stateIdx onward down one line, without moving bibs/actions', async () => {
    state.finishers = [
      { action: 'Finish', number: '1', time: '01:00:00' },
      { action: 'Finish', number: '2', time: '01:05:00' },
      { action: 'Finish', number: '3', time: '01:10:00' },
    ];
    const r = await insertTimeAbove(1, '01:02:00');
    assert.equal(r.error, '');
    assert.deepEqual(state.finishers.map(f => `${f.number}:${f.time}`), [
      '1:01:00:00', '2:01:02:00', '3:01:05:00',
    ]);
  });
});

describe('finishers.js:getOutstandingCount', () => {
  it('counts entries on a course not yet finished/DNF\'d, including SI results', () => {
    state.finishers = [{ action: 'Finish', number: '1' }];
    assert.equal(getOutstandingCount('Seniors'), 0); // only senior entry, already finished
    state.entries.push({ bibNumber: '3', course: 'Seniors' });
    assert.equal(getOutstandingCount('Seniors'), 1); // bib 3 still out
  });

  it('treats an SI result with a RaceTime as accounted for', () => {
    state.siResults = [{ RaceNumber: '2', RaceTime: '00:30:00' }];
    assert.equal(getOutstandingCount('Juniors'), 0);
  });
});

describe('finishers.js:getSortedFinishers', () => {
  it('filters by the entry\'s course when given, else returns everything', async () => {
    await recordFinisher(1, '01:00:00', 'Finish'); // Seniors
    await recordFinisher(2, '01:05:00', 'Finish'); // Juniors
    assert.equal(getSortedFinishers('Seniors').length, 1);
    assert.equal(getSortedFinishers().length, 2);
  });
});

describe('finishers.js:getCategorySpecials / getAllSpecials', () => {
  it('lists the distinct categories in use, sorted, as [cat, label] pairs', () => {
    state.entries.push({ bibNumber: '3', category: 'MSEN' }); // duplicate category
    const specials = getCategorySpecials();
    assert.deepEqual(specials.map(s => s[0]), ['MSEN', 'U12B']);
  });

  it('getAllSpecials prepends the fixed special bib labels', () => {
    const all = getAllSpecials();
    assert.equal(all[0][0], 'Clock');
    assert.ok(all.some(([name]) => name === 'MSEN'));
  });
});

describe('finishers.js:lineLabel', () => {
  it('shows the split number, or [index] when there is none', () => {
    state.finishers = [{ action: 'Finish', splitNumber: 1 }, { action: 'DNF', splitNumber: null }];
    assert.equal(lineLabel(0), '1');
    assert.equal(lineLabel(1), '[1]');
    assert.equal(lineLabel(99), '[99]'); // no such record
  });
});

describe('finishers.js:getPrevTime', () => {
  it('returns the nearest preceding recorded time', () => {
    state.finishers = [{ time: '01:00:00' }, { time: '' }, { time: '01:05:00' }];
    assert.equal(getPrevTime(2), '01:00:00'); // skips the blank at index 1
  });

  it('treats a time-of-day Clock record specially, an offset Clock record as 00:00:00', () => {
    state.finishers = [{ action: 'Clock', time: '09:00:00' }, { time: '01:00:00' }];
    assert.equal(getPrevTime(1), '09:00:00');
    state.finishers = [{ action: 'Clock', time: '00:05:00' }, { time: '01:00:00' }];
    assert.equal(getPrevTime(1), '00:00:00');
  });

  it('returns empty string when nothing precedes', () => {
    assert.equal(getPrevTime(0), '');
  });
});

describe('finishers.js:parseFinishTime', () => {
  it('parses a bare seconds count relative to the previous time\'s h:m', () => {
    assert.equal(parseFinishTime('30', '01:05:00'), '01:05:30');
  });

  it('parses mm:ss relative to the previous hour', () => {
    assert.equal(parseFinishTime('6.30', '01:05:00'), '01:06:30');
  });

  it('parses a full hh:mm:ss, ignoring prevTimeStr', () => {
    assert.equal(parseFinishTime('2.30.15', '01:05:00'), '02:30:15');
  });

  it('defaults to 00:00 hours/minutes with no previous time', () => {
    assert.equal(parseFinishTime('45', ''), '00:00:45');
  });

  it('returns null for out-of-range or non-numeric input', () => {
    assert.equal(parseFinishTime('99', ''), null); // >59 seconds
    assert.equal(parseFinishTime('abc', ''), null);
    assert.equal(parseFinishTime('1.2.3.4', ''), null); // too many parts
  });
});
