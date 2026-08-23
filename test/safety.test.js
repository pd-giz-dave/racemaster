'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { getCategoryProgress } from '../js/safety.js';

// getCategoryProgress touches no browser globals — see js/safety.js — so this only ever needs
// to shape `state` and call the function directly, no mocking at all.
describe('safety.js:getCategoryProgress', () => {
  beforeEach(() => {
    state.entries        = [];
    state.finishers       = [];
    state.mobileProgress  = [];
    state.siResults       = [];
    state.categories      = [
      { maleCat: 'MSEN', femaleCat: 'FSEN' },
      { maleCat: 'M40',  femaleCat: 'F40'  },
    ];
  });

  it('entries with a bib are counted even with no finishers recorded yet', () => {
    state.entries = [
      { bibNumber: '1', category: 'MSEN' },
      { bibNumber: '2', category: 'MSEN' },
    ];
    const [row] = getCategoryProgress();
    assert.equal(row.category, 'MSEN');
    assert.equal(row.entries, 2);
    assert.equal(row.finished, 0);
    assert.equal(row.outstanding, 2); // no finishers recorded yet — both still out on course
    assert.equal(row.dnf, 0);
  });

  it('entries without a bib number are ignored', () => {
    state.entries = [{ bibNumber: '', category: 'MSEN' }, { category: 'MSEN' }];
    assert.deepEqual(getCategoryProgress(), []);
  });

  it('entries always equals finished + outstanding + dnf', () => {
    state.entries = [
      { bibNumber: '1', category: 'MSEN' }, // finishes
      { bibNumber: '2', category: 'MSEN' }, // DNFs
      { bibNumber: '3', category: 'MSEN' }, // still out on course
    ];
    state.finishers = [
      { action: 'Finish', number: '1', time: '01:00:00' },
      { action: 'DNF',     number: '2', time: '' },
    ];
    const [row] = getCategoryProgress();
    assert.equal(row.entries, 3);
    assert.equal(row.finished, 1);
    assert.equal(row.dnf, 1);
    assert.equal(row.outstanding, 1);
    assert.equal(row.finished + row.outstanding + row.dnf, row.entries);
  });

  it('entries with no resolvable category fold into a synthetic Uncategorised row, sorted last', () => {
    state.entries = [
      { bibNumber: '1', category: 'M40' },
      { bibNumber: '2', category: '' },
    ];
    const rows = getCategoryProgress();
    assert.deepEqual(rows.map(r => r.category), ['M40', 'Uncategorised']);
  });

  it('rows are sorted by category priority (state.categories order), not by name or entry order', () => {
    state.entries = [
      { bibNumber: '1', category: 'M40' },  // declared second in state.categories
      { bibNumber: '2', category: 'MSEN' }, // declared first — but entered second here
    ];
    const rows = getCategoryProgress();
    assert.deepEqual(rows.map(r => r.category), ['MSEN', 'M40']);
  });
});