'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { getTimingMethod, usingDibbers, adjustedFinishTime } from '../js/time-utils.js';

beforeEach(() => {
  state.event           = { timingMethod: 'Stopwatch', juniorTimingMethod: 'Stopwatch' };
  state.finishers        = [];
  state.mobileProgress   = [];
  state.categories       = [
    { maleCat: 'MSEN', femaleCat: 'FSEN' },
    { maleCat: 'M40',  femaleCat: 'F40'  },
  ];
});

describe('time-utils.js:getTimingMethod', () => {
  it('defaults to Stopwatch when unset', () => {
    state.event = {};
    assert.equal(getTimingMethod('Seniors'), 'Stopwatch');
  });

  it('uses the senior timing method for a non-junior course', () => {
    state.event.timingMethod = 'Dibbers';
    assert.equal(getTimingMethod('Seniors'), 'Dibbers');
  });

  it('uses the junior timing method for the Juniors course', () => {
    state.event.timingMethod = 'Dibbers';
    state.event.juniorTimingMethod = 'Stopwatch';
    assert.equal(getTimingMethod('Juniors'), 'Stopwatch');
  });
});

describe('time-utils.js:usingDibbers', () => {
  it('is true only when the resolved timing method is Dibbers', () => {
    state.event.timingMethod = 'Dibbers';
    assert.equal(usingDibbers('Seniors'), true);
    state.event.timingMethod = 'Stopwatch';
    assert.equal(usingDibbers('Seniors'), false);
  });
});

describe('time-utils.js:adjustedFinishTime', () => {
  it('passes the finish time straight through under Dibbers timing', () => {
    state.event.timingMethod = 'Dibbers';
    const entry = { bibNumber: '1', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, '01:30:00'), '01:30:00');
  });

  it('passes an unparseable finish time straight through', () => {
    const entry = { bibNumber: '1', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, 'garbage'), 'garbage');
  });

  it('with no Clock/Start records at all, race time equals the finish time (relative mode, ref 0)', () => {
    const entry = { bibNumber: '1', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, '01:30:00'), '01:30:00');
  });

  it('subtracts a bib-specific relative Start record (source 1)', () => {
    state.finishers = [
      { action: 'Start',  number: '1', time: '00:05:00' },
      { action: 'Finish', number: '1', time: '01:30:00' },
    ];
    const entry = { bibNumber: '1', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, '01:30:00'), '01:25:00');
  });

  it('a time-of-day Clock record (h>0) makes startRef default to the clock time, not 0', () => {
    state.finishers = [
      { action: 'Clock',  number: '',  time: '09:00:00' }, // time-of-day
      { action: 'Finish', number: '1', time: '10:30:00' },
    ];
    const entry = { bibNumber: '1', course: 'Seniors' };
    // No Start/category/gender/course record found -> startRef defaults to clockOffset (09:00:00)
    assert.equal(adjustedFinishTime(entry, '10:30:00'), '01:30:00');
  });

  it('falls back to a category start record (source 2) when no bib-specific Start exists', () => {
    state.finishers = [
      { action: 'MSEN',   number: '',  time: '00:10:00' },
      { action: 'Finish', number: '1', time: '01:00:00' },
    ];
    const entry = { bibNumber: '1', category: 'MSEN', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, '01:00:00'), '00:50:00');
  });

  it('falls back to a gender start record (source 3, seniors only) when no category record exists', () => {
    state.finishers = [
      { action: 'Male',   number: '',  time: '00:10:00' },
      { action: 'Finish', number: '1', time: '01:00:00' },
    ];
    const entry = { bibNumber: '1', category: 'MSEN', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, '01:00:00'), '00:50:00');
  });

  it('skips the gender source entirely for juniors, going straight to the course record (source 4)', () => {
    state.finishers = [
      { action: 'Male',    number: '',  time: '00:01:00' }, // must be ignored for juniors
      { action: 'Juniors', number: '',  time: '00:10:00' },
      { action: 'Finish',  number: '1', time: '01:00:00' },
    ];
    const entry = { bibNumber: '1', category: 'MSEN', course: 'Juniors' };
    assert.equal(adjustedFinishTime(entry, '01:00:00'), '00:50:00');
  });

  it('falls back to a mobile-recorded Start when state.finishers has no manual entries at all', () => {
    state.mobileProgress = [{ action: 'Start', number: '1', time: '00:05:00' }];
    const entry = { bibNumber: '1', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, '01:30:00'), '01:25:00');
  });

  it('clamps a negative result up to 1 second', () => {
    state.finishers = [
      { action: 'Start',  number: '1', time: '00:10:00' },
      { action: 'Finish', number: '1', time: '00:05:00' }, // "finishes" before their start
    ];
    const entry = { bibNumber: '1', course: 'Seniors' };
    assert.equal(adjustedFinishTime(entry, '00:05:00'), '00:00:01');
  });

  it('uses the passed finisherRecord to anchor the backward search rather than the first Finish match', () => {
    // Two Start/Finish pairs for the same bib (re-entry) — the earlier Start must not leak
    // into the later Finish's lookup.
    state.finishers = [
      { action: 'Start',  number: '1', time: '00:01:00' },
      { action: 'Finish', number: '1', time: '00:30:00' },
      { action: 'Start',  number: '1', time: '00:40:00' },
      { action: 'Finish', number: '1', time: '01:30:00' },
    ];
    const entry = { bibNumber: '1', course: 'Seniors' };
    const secondFinish = state.finishers[3];
    assert.equal(adjustedFinishTime(entry, '01:30:00', secondFinish), '00:50:00');
  });
});
