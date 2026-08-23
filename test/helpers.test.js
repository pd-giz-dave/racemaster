'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { builtinFRARows } from '../js/categories.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import {
  getNumberOfHelpers, findHelperByNumber, getHelper, getNextHelperNumber, addHelper,
  submitHelper, updateHelper, deleteHelper, clearAllHelpers, getSortedHelpers,
} from '../js/helpers.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.helpers    = [];
  state.people     = [];
  state.categories = builtinFRARows();
  state.event      = { date: '15/06/2026' };
});

describe('helpers.js:getNumberOfHelpers / findHelperByNumber / getHelper / getNextHelperNumber', () => {
  it('finds by number and computes the next free number', () => {
    state.helpers = [{ number: 5, name: 'A' }, { number: 2, name: 'B' }];
    assert.equal(getNumberOfHelpers(), 2);
    assert.equal(findHelperByNumber(5), 0);
    assert.equal(findHelperByNumber(99), -1);
    assert.equal(getHelper(2).name, 'B');
    assert.equal(getHelper(99), null);
    assert.equal(getNextHelperNumber(), 6); // one past the current max
  });

  it('getNextHelperNumber is 1 with no helpers yet', () => {
    assert.equal(getNextHelperNumber(), 1);
  });
});

describe('helpers.js:addHelper', () => {
  it('creates a new helper, auto-numbering when none given', () => {
    const idx = addHelper({ name: 'Dave', role: 'MARSHAL' });
    assert.equal(idx, 0);
    assert.equal(state.helpers[0].number, 1);
    assert.equal(state.helpers[0].role, 'MARSHAL');
  });

  it('updates an existing helper by number, preserving unspecified fields', () => {
    addHelper({ number: 1, name: 'Dave', club: 'Dark Peak', role: 'MARSHAL' });
    addHelper({ number: 1, name: 'Dave', role: 'TIMING' });
    assert.equal(state.helpers.length, 1);
    assert.equal(state.helpers[0].role, 'TIMING');
    assert.equal(state.helpers[0].club, 'Dark Peak'); // untouched
  });

  it('unlike addEntry, requires name on every call — an update call without it is silently rejected', () => {
    addHelper({ number: 1, name: 'Dave', role: 'MARSHAL' });
    const idx = addHelper({ number: 1, role: 'TIMING' }); // no name
    assert.equal(idx, -1);
    assert.equal(state.helpers[0].role, 'MARSHAL'); // unchanged
  });

  it('rejects a missing name', () => {
    assert.equal(addHelper({ name: '' }), -1);
  });
});

describe('helpers.js:submitHelper', () => {
  it('adds a helper, derives category from dob/gender, and saves a person record', async () => {
    const r = await submitHelper({ name: 'Dave', gender: 'Male', dob: '01/01/1990', role: 'MARSHAL' });
    assert.equal(r.error, '');
    assert.equal(r.number, 1);
    assert.equal(state.helpers[0].category, 'MSEN');
    assert.ok(state.people.some(p => p.name === 'Dave'));
  });

  it('rejects a missing name', async () => {
    const r = await submitHelper({ name: '' });
    assert.match(r.error, /Name is required/);
  });
});

describe('helpers.js:updateHelper', () => {
  it('errors for an unknown helper number', async () => {
    const r = await updateHelper(999, { name: 'X' });
    assert.match(r.error, /not found/);
  });

  it('updates fields and recomputes category when dob changes', async () => {
    await submitHelper({ name: 'Dave', gender: 'Male', dob: '01/01/1990' });
    const r = await updateHelper(1, { dob: '01/01/1946' }); // now an M80
    assert.equal(r.error, '');
    assert.equal(state.helpers[0].category, 'M80');
  });
});

describe('helpers.js:deleteHelper / clearAllHelpers', () => {
  it('deletes a single helper by number', async () => {
    await submitHelper({ name: 'Dave' });
    await submitHelper({ name: 'Alice' });
    const r = await deleteHelper(1);
    assert.equal(r.error, '');
    assert.equal(state.helpers.length, 1);
    assert.equal(state.helpers[0].name, 'Alice');
  });

  it('errors deleting an unknown helper', async () => {
    const r = await deleteHelper(999);
    assert.match(r.error, /not found/);
  });

  it('clears every helper', async () => {
    await submitHelper({ name: 'Dave' });
    await clearAllHelpers();
    assert.deepEqual(state.helpers, []);
  });
});

describe('helpers.js:getSortedHelpers', () => {
  it('sorts by number ascending, without mutating state', () => {
    state.helpers = [{ number: 3 }, { number: 1 }, { number: 2 }];
    assert.deepEqual(getSortedHelpers().map(h => h.number), [1, 2, 3]);
    assert.deepEqual(state.helpers.map(h => h.number), [3, 1, 2]);
  });
});
