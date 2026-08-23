'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock, installWindowMock } from './helpers/mock-browser.js';
import { getSortedMobileProgress, removeMobileProgressRecord } from '../js/mobile-progress.js';

beforeEach(() => {
  installLocalStorageMock();
  installWindowMock();
  state.mobileProgress = [];
  state.entries = [{ bibNumber: '1', course: 'Seniors' }, { bibNumber: '2', course: 'Juniors' }];
});

describe('mobile-progress.js:getSortedMobileProgress', () => {
  it('returns everything, in recording order, when no course is given', () => {
    state.mobileProgress = [{ action: 'Finish', number: '2' }, { action: 'Finish', number: '1' }];
    assert.deepEqual(getSortedMobileProgress().map(f => f.number), ['2', '1']);
  });

  it('filters to the given course via each record\'s entry', () => {
    state.mobileProgress = [{ action: 'Finish', number: '1' }, { action: 'Finish', number: '2' }];
    assert.deepEqual(getSortedMobileProgress('Seniors').map(f => f.number), ['1']);
  });
});

describe('mobile-progress.js:removeMobileProgressRecord', () => {
  it('removes the matching action+bib record and returns true', async () => {
    state.mobileProgress = [{ action: 'DNF', number: '1' }, { action: 'Finish', number: '2' }];
    const removed = await removeMobileProgressRecord(1, 'DNF');
    assert.equal(removed, true);
    assert.equal(state.mobileProgress.length, 1);
    assert.equal(state.mobileProgress[0].number, '2');
  });

  it('returns false and leaves the array untouched when nothing matches', async () => {
    state.mobileProgress = [{ action: 'DNF', number: '1' }];
    const removed = await removeMobileProgressRecord(1, 'Finish'); // wrong action
    assert.equal(removed, false);
    assert.equal(state.mobileProgress.length, 1);
  });
});
