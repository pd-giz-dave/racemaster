'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPerson, createDibber, createEntry, createHelper, createFinisher,
  createRole, createCategory, createEvent,
} from '../js/schema.js';

// Every persisted record's shape is defined here once — a wrong default silently corrupts
// data across the whole app, so each factory gets a defaults check and an overrides check.

describe('schema.js:createPerson', () => {
  it('defaults to an empty/zeroed person', () => {
    assert.deepEqual(createPerson(), {
      name: '', gender: '', dob: '', club: '', fraNumber: '',
      lastSeen: '', seenTotal: 0, lastHelped: '', helpedTotal: 0, banned: '',
    });
  });

  it('applies given overrides', () => {
    const p = createPerson({ name: 'Dave', seenTotal: 3 });
    assert.equal(p.name, 'Dave');
    assert.equal(p.seenTotal, 3);
    assert.equal(p.club, ''); // unspecified fields still default
  });
});

describe('schema.js:createDibber', () => {
  it('defaults codes to 0', () => {
    assert.deepEqual(createDibber(), { shortCode: 0, longCode: 0, owner: '', lost: '', notes: '' });
  });
});

describe('schema.js:createEntry', () => {
  it('defaults partner to null (solo entry)', () => {
    const e = createEntry();
    assert.equal(e.partner, null);
    assert.equal(e.bibNumber, 0);
  });

  it('carries a partner object through unchanged', () => {
    const partner = { name: 'B', gender: 'Female', dob: '', club: '', fraNumber: '' };
    assert.equal(createEntry({ partner }).partner, partner);
  });
});

describe('schema.js:createHelper', () => {
  it('defaults to an empty helper record', () => {
    assert.deepEqual(createHelper(), { number: 0, name: '', club: '', gender: '', dob: '', category: '', role: '' });
  });
});

describe('schema.js:createFinisher', () => {
  it('defaults action/number/time to empty strings', () => {
    assert.deepEqual(createFinisher(), { action: '', number: '', time: '' });
  });
});

describe('schema.js:createRole', () => {
  it('defaults role/description to empty strings', () => {
    assert.deepEqual(createRole(), { role: '', description: '' });
  });
});

describe('schema.js:createCategory', () => {
  it('defaults all fields to empty strings', () => {
    assert.deepEqual(createCategory(), { minAge: '', maleCat: '', femaleCat: '', ref: '', maxDist: '' });
  });
});

describe('schema.js:createEvent', () => {
  it('applies the documented event defaults', () => {
    const e = createEvent();
    assert.equal(e.name, '');
    assert.equal(e.startTime, '19:30:00');
    assert.equal(e.firstBibNumber, 1);
    assert.equal(e.categories, 'FRA');
    assert.equal(e.timingMethod, 'Stopwatch');
    assert.equal(e.juniorLimit, 'None');
    assert.equal(e.juniorTimingMethod, 'Stopwatch');
    assert.equal(e.hasPairs, false);
  });

  it('applies given overrides without disturbing other defaults', () => {
    const e = createEvent({ name: 'Test Fell Race', hasPairs: true });
    assert.equal(e.name, 'Test Fell Race');
    assert.equal(e.hasPairs, true);
    assert.equal(e.timingMethod, 'Stopwatch'); // still default
  });
});
