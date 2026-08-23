'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { builtinFRARows } from '../js/categories.js';
import { formatResults, getSplitsRows, getResultsForCourse, computeAvgTop10 } from '../js/results.js';

beforeEach(() => {
  state.entries           = [];
  state.finishers          = [];
  state.mobileProgress     = [];
  state.mobileCheckpoints  = [];
  state.siResults          = [];
  state.helpers            = [];
  state.people             = [];
  state.finishNumbersMap   = {};
  state.categories         = builtinFRARows();
  state.event = {
    date: '15/06/2026', maleRecord: '', femaleRecord: '',
    prizeDepthOverall: 3, prizeDepthPerCategory: 1, juniorPrizeDepthPerCategory: 6,
  };
});

function entry(bib, { name = `Runner ${bib}`, category = 'MSEN', course = 'Seniors', ...rest } = {}) {
  return { bibNumber: String(bib), name, category, course, gender: 'Male', ...rest };
}

describe('results.js:formatResults', () => {
  it('orders finishers by adjusted time and assigns sequential positions', () => {
    state.entries = [entry(1), entry(2), entry(3)];
    state.finishers = [
      { action: 'Finish', number: '2', time: '01:10:00' },
      { action: 'Finish', number: '1', time: '01:00:00' },
      { action: 'Finish', number: '3', time: '01:20:00' },
    ];
    const { seniors } = formatResults();
    assert.deepEqual(seniors.map(r => r.bibNumber), [1, 2, 3]); // bibNumber comes out numeric (+f.number)
    assert.deepEqual(seniors.map(r => r.position), [1, 2, 3]);
  });

  it('appends DNF entries at the end with position 9999 and no time-based fields', () => {
    state.entries = [entry(1), entry(2)];
    state.finishers = [
      { action: 'Finish', number: '1', time: '01:00:00' },
      { action: 'DNF',    number: '2' },
    ];
    const { seniors } = formatResults();
    const dnfRow = seniors.find(r => r.bibNumber === '2');
    assert.equal(dnfRow.position, 9999);
    assert.equal(dnfRow.time, 'DNF');
  });

  it('excludes a banned entrant entirely from results', () => {
    state.entries = [entry(1)];
    state.people  = [{ name: 'Runner 1', dob: '', banned: '01/01/2099' }];
    state.finishers = [{ action: 'Finish', number: '1', time: '01:00:00' }];
    const { seniors } = formatResults();
    assert.deepEqual(seniors, []);
  });

  it('computes in-category position separately per category', () => {
    state.entries = [
      entry(1, { category: 'MSEN' }), entry(2, { category: 'M40' }), entry(3, { category: 'MSEN' }),
    ];
    state.finishers = [
      { action: 'Finish', number: '1', time: '01:00:00' }, // MSEN #1
      { action: 'Finish', number: '2', time: '01:05:00' }, // M40 #1
      { action: 'Finish', number: '3', time: '01:10:00' }, // MSEN #2
    ];
    const { seniors } = formatResults();
    const byBib = Object.fromEntries(seniors.map(r => [r.bibNumber, r.inCatPos]));
    assert.deepEqual(byBib, { '1': 1, '2': 1, '3': 2 });
  });

  it('separates seniors and juniors by course', () => {
    state.entries = [entry(1, { course: 'Seniors' }), entry(10, { course: 'Juniors', category: 'U12B' })];
    state.finishers = [
      { action: 'Finish', number: '1',  time: '01:00:00' },
      { action: 'Finish', number: '10', time: '00:20:00' },
    ];
    const { seniors, juniors } = formatResults();
    assert.equal(seniors.length, 1);
    assert.equal(juniors.length, 1);
    assert.equal(juniors[0].bibNumber, 10);
  });

  it('warns and drops the mobile result when a bib has both stopwatch and mobile results', () => {
    state.entries = [entry(1)];
    state.finishers      = [{ action: 'Finish', number: '1', time: '01:00:00' }];
    state.mobileProgress = [{ action: 'Finish', number: '1', time: '01:00:05' }];
    const { warnings, seniors } = formatResults();
    assert.equal(seniors.length, 1);
    assert.ok(warnings.some(w => /stopwatch and mobile/.test(w)));
  });

  it('builds a top-N overall prize list, split by gender', () => {
    state.entries = [
      entry(1, { category: 'MSEN' }), entry(2, { category: 'WSEN', gender: 'Female' }),
      entry(3, { category: 'MSEN' }), entry(4, { category: 'MSEN' }),
    ];
    state.finishers = [
      { action: 'Finish', number: '1', time: '01:00:00' },
      { action: 'Finish', number: '2', time: '01:02:00' },
      { action: 'Finish', number: '3', time: '01:05:00' },
      { action: 'Finish', number: '4', time: '01:10:00' },
    ];
    const { prizes } = formatResults();
    const overall = prizes.filter(p => p.section === 'Senior Overall');
    assert.equal(overall.length, 3); // prizeDepthOverall
    assert.equal(overall[0].name, 'Runner 1');
    assert.ok(prizes.some(p => p.section === 'Senior Female Overall' && p.name === 'Runner 2'));
  });

  it('produces a helpersReport row per helper, with category derived from dob/gender when available', () => {
    state.helpers = [{ name: 'Helper One', role: 'MARSHAL', dob: '01/01/1990', gender: 'Male', club: 'Dark Peak' }];
    const { helpersReport } = formatResults();
    assert.equal(helpersReport.length, 1);
    assert.equal(helpersReport[0].role, 'MARSHAL');
    assert.equal(helpersReport[0].cat, 'MSEN');
  });
});

describe('results.js:getResultsForCourse', () => {
  it('filters by course and sorts by position', () => {
    const results = [
      { course: 'Seniors', position: 2 }, { course: 'Juniors', position: 1 }, { course: 'Seniors', position: 1 },
    ];
    assert.deepEqual(getResultsForCourse('Seniors', results).map(r => r.position), [1, 2]);
  });
});

describe('results.js:computeAvgTop10', () => {
  it('averages the top-10 finishers\' times, rounded to a whole second', () => {
    const results = [
      { position: 1, time: '01:00:00' },
      { position: 2, time: '01:02:00' },
      { position: 9999, time: 'DNF' }, // excluded
    ];
    assert.equal(computeAvgTop10(results), '01:01:00');
  });

  it('returns empty string when there are no timed finishers', () => {
    assert.equal(computeAvgTop10([]), '');
  });
});

describe('results.js:getSplitsRows', () => {
  it('returns an empty result when there are no SI splits and no mobile checkpoints', () => {
    assert.deepEqual(getSplitsRows([], []), { maxSplits: 0, maxCp: 0, cpNumbers: [], rows: [] });
  });

  it('builds one row per SI result that carries splits, joined against the computed result', () => {
    state.entries = [entry(1)];
    const seniorsResults = [{ bibNumber: '1', position: 1, name: 'Runner 1', category: 'MSEN', time: '01:00:00' }];
    state.siResults = [{ RaceNumber: '1', RaceTime: '01:00:00', NumSplits: '1', Split: '00:30:00' }];
    const { maxSplits, rows } = getSplitsRows(seniorsResults, []);
    assert.equal(maxSplits, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bibNumber, 1);
    assert.equal(rows[0].splits[0].cumulative, '00:30:00');
    assert.equal(rows[0].finishTime.cumulative, '01:00:00');
  });
});
