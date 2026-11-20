'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorageMock } from './helpers/mock-browser.js';
import {
  adoptionKey, loadPendingAdoptions, setPendingAdoption, clearPendingAdoption, eventCourseLabels,
  effectiveAdoptions, adoptionFor, buildAdoptedTargets, completedAdoptions,
  loadAutoDeselectNotices, addAutoDeselectNotice, dismissAutoDeselectNotice,
} from '../js/mobile-files-adoption.js';

beforeEach(() => installLocalStorageMock());

const progress = { raceName: 'LMV', raceDate: '', generatedAt: '2026-09-23T10:00:00.000Z', entries: [] };

function races() {
  return [
    {
      owner: 'alice', raceLabel: 'unknown-26-09-23',
      devices: [{ name: 'brave-reef', lines: [] }, { name: 'quiet-fox', lines: [] }],
      adoptions: { 'brave-reef': { raceLabel: 'lmv-seniors', adoptedAt: 'x' } },
    },
    { owner: 'alice', raceLabel: 'lmv-seniors', devices: [], progress },
  ];
}

describe('mobile-files-adoption.js:eventCourseLabels', () => {
  it('derives one date-suffixed label per course in use, skipping an event with no name or date', () => {
    assert.deepEqual(
      eventCourseLabels({ name: 'LMV', date: '23/09/2026' }, ['Seniors', 'Juniors']),
      ['lmv-seniors-26-09-23', 'lmv-juniors-26-09-23'],
    );
    assert.deepEqual(eventCourseLabels({ name: '', date: '23/09/2026' }, ['Seniors']), []);
    assert.deepEqual(eventCourseLabels({ name: 'LMV', date: '' }, ['Seniors']), []);
  });
});

describe('mobile-files-adoption.js:effectiveAdoptions / adoptionFor', () => {
  it('reads server markers keyed per device, not per folder', () => {
    assert.equal(adoptionFor(races(), 'alice', 'unknown-26-09-23', 'brave-reef', {}), 'lmv-seniors');
    assert.equal(adoptionFor(races(), 'alice', 'unknown-26-09-23', 'quiet-fox', {}), null);
  });

  it('a pending local change overrides the server: set adds, null clears', () => {
    setPendingAdoption('alice', 'unknown-26-09-23', 'quiet-fox', 'lmv-juniors');
    setPendingAdoption('alice', 'unknown-26-09-23', 'brave-reef', null);
    const all = effectiveAdoptions(races());
    assert.deepEqual(all.map(a => [a.deviceName, a.raceLabel]), [['quiet-fox', 'lmv-juniors']]);
  });

  it('clearPendingAdoption drops only that entry', () => {
    setPendingAdoption('alice', 'r', 'a', 'x');
    setPendingAdoption('alice', 'r', 'b', 'y');
    clearPendingAdoption('alice', 'r', 'a');
    assert.deepEqual(Object.keys(loadPendingAdoptions()), [adoptionKey('alice', 'r', 'b')]);
  });
});

describe('mobile-files-adoption.js:buildAdoptedTargets', () => {
  it('attaches the target race\'s cached progress, or null for an adoption-only delivery', () => {
    assert.deepEqual(buildAdoptedTargets(races(), 'alice', {}), [
      { deviceName: 'brave-reef', fromRaceLabel: 'unknown-26-09-23', raceLabel: 'lmv-seniors', progress },
    ]);
    assert.equal(buildAdoptedTargets(races(), 'bob', {})[0].progress, null);
  });
});

describe('mobile-files-adoption.js:completedAdoptions', () => {
  it('is empty until the device has a server file in the target race', () => {
    assert.deepEqual(completedAdoptions(races(), {}), []);
  });

  it('reports the adoption once the same device name lands in the target race (not a pending copy)', () => {
    const rs = races();
    rs[1].devices.push({ name: 'brave-reef', lines: [], pending: true });
    assert.deepEqual(completedAdoptions(rs, {}), []);
    rs[1].devices = [{ name: 'brave-reef', lines: [] }];
    assert.deepEqual(completedAdoptions(rs, {}).map(a => a.deviceName), ['brave-reef']);
  });
});

// Field report: repeatedly starting a fresh test race on the same physical phone kept
// re-adopting it (the previous round's marker was still sitting there), and
// js/views/mobile-files.js's own finishCompletedAdoptions() used to carry the Update-Progress
// tick straight across to the new row every time — silently re-selecting a file the operator
// never looked at. These notices are what that file now records instead, for a persistent
// banner (js/views/mobile-files.js's renderAutoDeselectNotices()) rather than carrying the tick.
describe('mobile-files-adoption.js:auto-deselect notices', () => {
  it('starts empty', () => {
    assert.deepEqual(loadAutoDeselectNotices(), []);
  });

  it('records a notice, readable back by loadAutoDeselectNotices', () => {
    addAutoDeselectNotice({ owner: 'alice', raceLabel: 'lmv-seniors', deviceName: 'brave-reef', fromRaceLabel: 'unknown-26-09-23', at: '2026-09-23T10:00:00.000Z' });
    assert.deepEqual(loadAutoDeselectNotices(), [
      { owner: 'alice', raceLabel: 'lmv-seniors', deviceName: 'brave-reef', fromRaceLabel: 'unknown-26-09-23', at: '2026-09-23T10:00:00.000Z' },
    ]);
  });

  it('re-adding the same owner/raceLabel/deviceName replaces the earlier entry rather than duplicating it', () => {
    addAutoDeselectNotice({ owner: 'alice', raceLabel: 'lmv-seniors', deviceName: 'brave-reef', fromRaceLabel: 'unknown-26-09-23', at: '2026-09-23T10:00:00.000Z' });
    addAutoDeselectNotice({ owner: 'alice', raceLabel: 'lmv-seniors', deviceName: 'brave-reef', fromRaceLabel: 'unknown-26-09-24', at: '2026-09-24T10:00:00.000Z' });
    const notices = loadAutoDeselectNotices();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].fromRaceLabel, 'unknown-26-09-24');
  });

  it('dismissAutoDeselectNotice drops only the matching entry', () => {
    addAutoDeselectNotice({ owner: 'alice', raceLabel: 'lmv-seniors', deviceName: 'brave-reef', fromRaceLabel: 'unknown-26-09-23', at: 'x' });
    addAutoDeselectNotice({ owner: 'alice', raceLabel: 'lmv-juniors', deviceName: 'quiet-fox', fromRaceLabel: 'unknown-26-09-23', at: 'y' });
    dismissAutoDeselectNotice('alice', 'lmv-seniors', 'brave-reef');
    assert.deepEqual(loadAutoDeselectNotices().map(n => n.deviceName), ['quiet-fox']);
  });
});
