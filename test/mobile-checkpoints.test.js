'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import {
  getMobileCheckpointBib, getMobileCheckpointTimes, getMobileCheckpointNumbers, getLatestCheckpoint,
} from '../js/mobile-checkpoints.js';

beforeEach(() => {
  state.mobileCheckpoints = [];
});

describe('mobile-checkpoints.js:getMobileCheckpointBib / getMobileCheckpointTimes', () => {
  it('coerces bibNumber to a number and cpTimes defaults to {}', () => {
    assert.equal(getMobileCheckpointBib({ bibNumber: '5' }), 5);
    assert.equal(getMobileCheckpointBib({}), 0);
    assert.deepEqual(getMobileCheckpointTimes({}), {});
    assert.deepEqual(getMobileCheckpointTimes({ cpTimes: { 1: '00:10:00' } }), { 1: '00:10:00' });
  });
});

describe('mobile-checkpoints.js:getMobileCheckpointNumbers', () => {
  it('collects every distinct CP number across all rows, sorted ascending', () => {
    state.mobileCheckpoints = [
      { bibNumber: '1', cpTimes: { 2: '00:10:00', 1: '00:05:00' } },
      { bibNumber: '2', cpTimes: { 3: '00:15:00' } },
    ];
    assert.deepEqual(getMobileCheckpointNumbers(), [1, 2, 3]);
  });

  it('is empty with no checkpoint rows', () => {
    assert.deepEqual(getMobileCheckpointNumbers(), []);
  });
});

describe('mobile-checkpoints.js:getLatestCheckpoint', () => {
  it('returns the highest CP number reached and its time, with an empty timeOfDay when none is stored', () => {
    state.mobileCheckpoints = [{ bibNumber: '1', cpTimes: { 1: '00:05:00', 3: '00:15:00', 2: '00:10:00' } }];
    assert.deepEqual(getLatestCheckpoint(1), { cp: 3, time: '00:15:00', timeOfDay: '' });
  });

  it('includes the device time-of-day for the highest CP when one is stored', () => {
    state.mobileCheckpoints = [{
      bibNumber: '1',
      cpTimes: { 1: '00:05:00', 2: '00:10:00' },
      cpTimesOfDay: { 1: '19:35:00', 2: '19:40:00' },
    }];
    assert.deepEqual(getLatestCheckpoint(1), { cp: 2, time: '00:10:00', timeOfDay: '19:40:00' });
  });

  it('returns null for a bib with no sighting at all', () => {
    assert.equal(getLatestCheckpoint(999), null);
  });
});
