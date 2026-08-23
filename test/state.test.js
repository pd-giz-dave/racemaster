'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state, loadAll, applyFRACategories, applyWFRACategories, applyCustomCategories } from '../js/state.js';
import { FRA_CATEGORIES, WFRA_CATEGORIES } from '../js/categories.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';

function seedCache(tables) {
  localStorage.setItem('racemaster-data', JSON.stringify(tables));
}

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
});

describe('state.js:state', () => {
  it('starts with every persisted table as an empty array and a default event', () => {
    // Fresh import-time shape — sanity check the defaults documented in the field comments.
    assert.ok(Array.isArray(state.people));
    assert.ok(Array.isArray(state.entries));
    assert.equal(state.event.startTime, '19:30:00');
    assert.ok(state.dirty instanceof Set);
  });
});

describe('state.js:applyFRACategories / applyWFRACategories / applyCustomCategories', () => {
  it('applyFRACategories/applyWFRACategories populate state.categories from the built-in presets', () => {
    state.categories = [];
    applyFRACategories();
    assert.equal(state.categories.length, FRA_CATEGORIES.length);
    assert.equal(state.categories[0].maleCat, 'U10B');

    applyWFRACategories();
    assert.equal(state.categories.length, WFRA_CATEGORIES.length);
  });

  it('applyCustomCategories copies from state.customCategories (as independent objects)', () => {
    state.customCategories = [{ minAge: 0, maleCat: 'X', femaleCat: 'Y', ref: 'EOY', maxDist: 1 }];
    applyCustomCategories();
    assert.equal(state.categories.length, 1);
    assert.equal(state.categories[0].maleCat, 'X');
    state.categories[0].maleCat = 'CHANGED';
    assert.equal(state.customCategories[0].maleCat, 'X'); // not the same object
  });
});

describe('state.js:loadAll', () => {
  it('loads each table from the cache and coerces numeric event fields', async () => {
    seedCache({
      event: [{ name: 'Test Race', firstBibNumber: '5', entryLimit: '', hasPairs: '' }],
      people: [{ name: 'Dave' }],
      entries: [{ bibNumber: '1' }],
      categories: [{ minAge: 0, maleCat: 'X', femaleCat: 'Y', ref: 'EOY', maxDist: 1 }],
    });
    await loadAll();
    assert.equal(state.event.name, 'Test Race');
    assert.equal(state.event.firstBibNumber, 5);   // coerced to number
    assert.equal(state.event.entryLimit, 200);      // blank -> default
    assert.equal(state.event.hasPairs, false);      // '' -> falsy -> coerced boolean
    assert.equal(state.people.length, 1);
    assert.equal(state.entries.length, 1);
    assert.equal(state.categories.length, 1); // loaded from cache, so the FRA-default fallback is skipped
  });

  it('applies the FRA preset when no categories were saved and the event setting is FRA (or unset)', async () => {
    seedCache({ event: [{ categories: 'FRA' }] });
    await loadAll();
    assert.equal(state.categories.length, FRA_CATEGORIES.length);
  });

  it('applies the WFRA preset when the event setting is WFRA', async () => {
    seedCache({ event: [{ categories: 'WFRA' }] });
    await loadAll();
    assert.equal(state.categories.length, WFRA_CATEGORIES.length);
  });

  it('applies custom categories when the event setting is CUSTOM', async () => {
    seedCache({
      event: [{ categories: 'CUSTOM' }],
      customCategories: [{ minAge: 0, maleCat: 'X', femaleCat: 'Y', ref: 'EOY', maxDist: 1 }],
    });
    await loadAll();
    assert.equal(state.categories.length, 1);
    assert.equal(state.categories[0].maleCat, 'X');
  });

  it('seeds roles from BUILTIN_ROLES when none were saved', async () => {
    seedCache({});
    await loadAll();
    assert.ok(state.roles.length > 0);
    assert.ok(state.roles.some(r => r.role === 'MARSHAL'));
  });
});
