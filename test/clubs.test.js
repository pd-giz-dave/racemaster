'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { getClubs, findDuplicateClubPairs } from '../js/clubs.js';

beforeEach(() => {
  state.people = [];
});

describe('clubs.js:getClubs', () => {
  it('aggregates count and the latest lastSeen per club', () => {
    state.people = [
      { club: 'Dark Peak', lastSeen: '01/01/2025' },
      { club: 'Dark Peak', lastSeen: '01/06/2026' },
      { club: 'Pennine',   lastSeen: '' },
    ];
    const clubs = getClubs();
    const darkPeak = clubs.find(([name]) => name === 'Dark Peak');
    assert.equal(darkPeak[1].count, 2);
    assert.equal(darkPeak[1].lastSeen, '01/06/2026');
  });

  it('sorts named clubs alphabetically, with the blank club always first', () => {
    state.people = [
      { club: 'Pennine',   lastSeen: '' },
      { club: '',          lastSeen: '' },
      { club: 'Dark Peak', lastSeen: '' },
    ];
    assert.deepEqual(getClubs().map(([name]) => name), ['', 'Dark Peak', 'Pennine']);
  });

  it('omits the blank entry entirely when nobody has an empty club', () => {
    state.people = [{ club: 'Dark Peak', lastSeen: '' }];
    assert.deepEqual(getClubs().map(([name]) => name), ['Dark Peak']);
  });
});

describe('clubs.js:findDuplicateClubPairs', () => {
  it('flags near-duplicate club names, excluding the blank club', () => {
    state.people = [
      { club: 'Dark Peak Fell Runners', lastSeen: '' },
      { club: 'Dark Peak Fell Runner',  lastSeen: '' }, // one char short
      { club: '', lastSeen: '' },
    ];
    const pairs = findDuplicateClubPairs();
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].exact, false);
  });

  it('finds nothing when club names are unrelated', () => {
    state.people = [{ club: 'Dark Peak', lastSeen: '' }, { club: 'Pennine', lastSeen: '' }];
    assert.deepEqual(findDuplicateClubPairs(), []);
  });
});
