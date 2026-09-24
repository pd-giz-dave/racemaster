'use strict';

import './helpers/setup-root.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { ensureDirs, MOBILE_DIR } from '../../server/config.js';
import {
  mobileRaceDir, mobileDeviceFilePath, readMobileDeviceFile, writeMobileDeviceFile,
  progressFilePath, readProgress, writeProgress, mergeProgress, touchProgress,
  progressIsUnchanged, parseRaceLabelDate,
  getMobileRacesForUser, getMobileRacesStatusForUser, getAvailableRacesForUser,
} from '../../server/mobile.js';

beforeEach(() => {
  fs.rmSync(MOBILE_DIR, { recursive: true, force: true });
  ensureDirs();
});

describe('server/mobile.js:path builders', () => {
  it('mobileRaceDir/mobileDeviceFilePath/progressFilePath nest under MOBILE_DIR/<user>/<race>/', () => {
    assert.equal(mobileRaceDir('alice', 'race-26-08-23'), path.join(MOBILE_DIR, 'alice', 'race-26-08-23'));
    assert.equal(mobileDeviceFilePath('alice', 'race-26-08-23', 'PhoneA'),
      path.join(MOBILE_DIR, 'alice', 'race-26-08-23', 'PhoneA.json'));
    assert.equal(progressFilePath('alice', 'race-26-08-23'),
      path.join(MOBILE_DIR, 'alice', 'race-26-08-23', 'progress.json'));
  });
});

describe('server/mobile.js:readMobileDeviceFile / writeMobileDeviceFile', () => {
  it('round-trips a device\'s line array, creating directories as needed', () => {
    const lines = [{ lineNumber: 1, action: 'Finish', bibNumber: 1 }];
    writeMobileDeviceFile('alice', 'race1', 'PhoneA', lines);
    assert.deepEqual(readMobileDeviceFile('alice', 'race1', 'PhoneA'), lines);
  });

  it('returns [] for a missing file', () => {
    assert.deepEqual(readMobileDeviceFile('alice', 'no-such-race', 'PhoneA'), []);
  });

  it('treats a non-array (old {time,bibs} shape) file as empty, not an error', () => {
    const dir = mobileRaceDir('alice', 'race1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mobileDeviceFilePath('alice', 'race1', 'PhoneA'), JSON.stringify({ time: [], bibs: [] }), 'utf8');
    assert.deepEqual(readMobileDeviceFile('alice', 'race1', 'PhoneA'), []);
  });

  it('returns [] for corrupt JSON rather than throwing', () => {
    const dir = mobileRaceDir('alice', 'race1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mobileDeviceFilePath('alice', 'race1', 'PhoneA'), 'not json', 'utf8');
    assert.deepEqual(readMobileDeviceFile('alice', 'race1', 'PhoneA'), []);
  });
});

describe('server/mobile.js:readProgress / writeProgress', () => {
  it('round-trips a progress payload', () => {
    const payload = {
      raceName: 'Test Race', raceDate: '23/08/2026',
      entries: [{ bibNumber: 1, name: 'Dave', category: 'MSEN', course: 'Seniors', startTime: '', finishTime: '00:20:00', cpTimes: { 1: '00:10:00' } }],
    };
    writeProgress('alice', 'race1', payload);
    assert.deepEqual(readProgress('alice', 'race1'), payload);
  });

  it('returns null when there is no progress file yet', () => {
    assert.equal(readProgress('alice', 'no-such-race'), null);
  });
});

describe('server/mobile.js:mergeProgress', () => {
  it('returns null when there is no progress file yet and pushing nothing', () => {
    const merged = mergeProgress('alice', 'race1', {
      raceName: 'Test Race', raceDate: '23/08/2026',
      entries: [],
      removed: [],
    });
    assert.equal(merged, null);
  });
  it('upserts entries by bibNumber into an empty progress.json, stamping updatedAt', () => {
    const merged = mergeProgress('alice', 'race1', {
      raceName: 'Test Race', raceDate: '23/08/2026',
      entries: [{ bibNumber: 1, name: 'Dave', category: 'MSEN', course: 'Seniors', startTime: '', finishTime: '', cpTimes: {} }],
      removed: [],
    });
    assert.equal(merged.entries.length, 1);
    assert.equal(merged.entries[0].bibNumber, 1);
    assert.equal(typeof merged.entries[0].updatedAt, 'string');
    assert.deepEqual(readProgress('alice', 'race1'), merged);
  });

  it('leaves an existing entry untouched when only a different bib is pushed', () => {
    mergeProgress('alice', 'race1', {
      raceName: 'X', raceDate: '',
      entries: [{ bibNumber: 1, name: 'Dave', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} }],
      removed: [],
    });
    const first = readProgress('alice', 'race1').entries[0];
    const merged = mergeProgress('alice', 'race1', {
      raceName: 'X', raceDate: '',
      entries: [{ bibNumber: 2, name: 'Sam', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} }],
      removed: [],
    });
    assert.equal(merged.entries.length, 2);
    assert.deepEqual(merged.entries.find(e => e.bibNumber === 1), first);
  });

  it('replaces an existing entry\'s fields (and updatedAt) when the same bib is pushed again', async () => {
    mergeProgress('alice', 'race1', {
      raceName: 'X', raceDate: '',
      entries: [{ bibNumber: 1, name: 'Dave', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} }],
      removed: [],
    });
    const before = readProgress('alice', 'race1').entries[0];
    await new Promise(r => setTimeout(r, 5));
    const merged = mergeProgress('alice', 'race1', {
      raceName: 'X', raceDate: '',
      entries: [{ bibNumber: 1, name: 'David', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} }],
      removed: [],
    });
    assert.equal(merged.entries.length, 1);
    assert.equal(merged.entries[0].name, 'David');
    assert.notEqual(merged.entries[0].updatedAt, before.updatedAt);
  });

  it('drops a bib named in `removed`, even if also present in `entries` on the same push', () => {
    mergeProgress('alice', 'race1', {
      raceName: 'X', raceDate: '',
      entries: [
        { bibNumber: 1, name: 'Dave', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} },
        { bibNumber: 2, name: 'Sam', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} },
      ],
      removed: [],
    });
    const merged = mergeProgress('alice', 'race1', { raceName: 'X', raceDate: '', entries: [], removed: [2] });
    assert.deepEqual(merged.entries.map(e => e.bibNumber), [1]);
  });

  it('bumps generatedAt even when entries/removed are both empty (a pure touch-like push)', async () => {
    const first = mergeProgress('alice', 'race1', {
      raceName: 'X',
      raceDate: '',
      entries: [{ bibNumber: 1, name: 'Dave', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} }],
      removed: [] });
    await new Promise(r => setTimeout(r, 5));
    const second = mergeProgress('alice', 'race1', { raceName: 'X', raceDate: '', entries: [], removed: [] });
    assert.notEqual(second.generatedAt, first.generatedAt);
  });
});

describe('server/mobile.js:touchProgress', () => {
  it('generates empty progress when there is no progress.json yet for this race', () => {
    const touched = touchProgress('alice', 'race1');
    assert.notEqual(touched.generatedAt, undefined);
    assert.deepEqual(touched.entries, []);
    assert.deepEqual(readProgress('alice', 'race1'), touched);
  });

  it('refreshes generatedAt without touching entries', async () => {
    const payload = { raceName: 'X', raceDate: '', entries: [{ bibNumber: 1, name: 'Dave', category: '', course: '', startTime: '', finishTime: '', cpTimes: {} }] };
    writeProgress('alice', 'race1', payload);
    await new Promise(r => setTimeout(r, 5));
    const touched = touchProgress('alice', 'race1');
    assert.notEqual(touched.generatedAt, undefined);
    assert.deepEqual(touched.entries, payload.entries);
    assert.deepEqual(readProgress('alice', 'race1'), touched);
  });
});

describe('server/mobile.js:progressIsUnchanged', () => {
  it('is true when knownGeneratedAt matches the progress payload\'s own generatedAt exactly', () => {
    assert.equal(progressIsUnchanged({ generatedAt: '2026-08-23T10:00:00.000Z' }, '2026-08-23T10:00:00.000Z'), true);
  });

  it('is false when generatedAt differs', () => {
    assert.equal(progressIsUnchanged({ generatedAt: '2026-08-23T10:00:00.000Z' }, '2020-01-01T00:00:00.000Z'), false);
  });

  it('is false when progress is null (nothing recorded yet)', () => {
    assert.equal(progressIsUnchanged(null, '2026-08-23T10:00:00.000Z'), false);
  });

  it('is false when knownGeneratedAt is missing (a first-ever fetch)', () => {
    assert.equal(progressIsUnchanged({ generatedAt: '2026-08-23T10:00:00.000Z' }, null), false);
    assert.equal(progressIsUnchanged({ generatedAt: '2026-08-23T10:00:00.000Z' }, undefined), false);
  });
});

describe('server/mobile.js:parseRaceLabelDate', () => {
  it('extracts yy/mm/dd from a label ending "-YY-MM-DD"', () => {
    assert.deepEqual(parseRaceLabelDate('test-race-26-08-23'), { yy: '26', mm: '08', dd: '23' });
  });

  it('returns null for a label with no trailing date', () => {
    assert.equal(parseRaceLabelDate('test-race'), null);
    assert.equal(parseRaceLabelDate(''), null);
    assert.equal(parseRaceLabelDate(null), null);
  });
});

describe('server/mobile.js:getMobileRacesForUser', () => {
  beforeEach(() => {
    writeMobileDeviceFile('alice', 'race-26-08-23', 'PhoneB', [{ lineNumber: 1 }]);
    writeMobileDeviceFile('alice', 'race-26-08-20', 'PhoneA', [{ lineNumber: 1 }, { lineNumber: 2 }]);
    writeMobileDeviceFile('bob',   'race-26-08-25', 'PhoneC', []);
  });

  it('lists only the requesting user\'s own races by default, newest race date first', () => {
    const races = getMobileRacesForUser('alice');
    assert.deepEqual(races.map(r => r.raceLabel), ['race-26-08-23', 'race-26-08-20']);
  });

  it('admin access includes every user\'s races', () => {
    const races = getMobileRacesForUser('alice', true);
    assert.ok(races.some(r => r.owner === 'bob'));
  });

  it('sorts devices within a race alphabetically and reports recordCount', () => {
    const race = getMobileRacesForUser('alice').find(r => r.raceLabel === 'race-26-08-20');
    assert.equal(race.devices[0].name, 'PhoneA');
    assert.equal(race.recordCount, 2);
  });

  it('excludes adoptions.json from device enumeration', () => {
    const dir = mobileRaceDir('alice', 'race-26-08-23');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adoptions.json'), JSON.stringify({}), 'utf8');
    const race = getMobileRacesForUser('alice').find(r => r.raceLabel === 'race-26-08-23');
    assert.equal(race.devices.some(d => d.name === 'adoptions'), false);
  });

  it('excludes progress.json from device enumeration, but surfaces it via the progress field', () => {
    writeProgress('alice', 'race-26-08-23', { raceName: 'X', raceDate: '', entries: [] });
    const race = getMobileRacesForUser('alice').find(r => r.raceLabel === 'race-26-08-23');
    assert.equal(race.devices.some(d => d.name === 'progress'), false);
    assert.ok(race.progress);
  });

  it('a race label with no trailing date sorts after every dated race', () => {
    writeMobileDeviceFile('alice', 'undated-race', 'PhoneZ', []);
    const races = getMobileRacesForUser('alice');
    assert.equal(races[races.length - 1].raceLabel, 'undated-race');
  });
});

describe('server/mobile.js:getAvailableRacesForUser', () => {
  it('only lists races that have a progress.json at all', () => {
    writeMobileDeviceFile('alice', 'race-no-progress', 'PhoneA', []);
    writeProgress('alice', 'race-with-progress', { raceName: 'X', raceDate: '', generatedAt: new Date().toISOString(), entries: [] });
    const races = getAvailableRacesForUser('alice', 30);
    assert.deepEqual(races.map(r => r.raceLabel), ['race-with-progress']);
  });

  it('excludes a race whose generatedAt is older than maxAgeDays', () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    writeProgress('alice', 'race-old', { raceName: 'Old', raceDate: '', generatedAt: old, entries: [] });
    writeProgress('alice', 'race-recent', { raceName: 'Recent', raceDate: '', generatedAt: recent, entries: [] });
    const races = getAvailableRacesForUser('alice', 2);
    assert.deepEqual(races.map(r => r.raceLabel), ['race-recent']);
  });

  it('sorts newest generatedAt first', () => {
    // Relative to now, not a fixed date — a hardcoded absolute date here previously drifted
    // outside the 30-day cutoff below as real time passed it, failing this test for a reason
    // that had nothing to do with the sort behavior it's actually meant to check.
    const older = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    writeProgress('alice', 'race-a', { raceName: 'A', raceDate: '', generatedAt: older, entries: [] });
    writeProgress('alice', 'race-b', { raceName: 'B', raceDate: '', generatedAt: newer, entries: [] });
    const races = getAvailableRacesForUser('alice', 30);
    assert.deepEqual(races.map(r => r.raceLabel), ['race-b', 'race-a']);
  });

  it('returns the lean shape only — no devices/lines/recordCount', () => {
    writeMobileDeviceFile('alice', 'race-a', 'PhoneA', [{ lineNumber: 1 }]);
    writeProgress('alice', 'race-a', { raceName: 'A', raceDate: '', generatedAt: new Date().toISOString(), entries: [] });
    const race = getAvailableRacesForUser('alice', 30)[0];
    assert.deepEqual(Object.keys(race).sort(), ['generatedAt', 'raceDate', 'raceLabel', 'raceName']);
  });

  it('scopes to the requesting user\'s own races unless adminAccess is true', () => {
    writeProgress('alice', 'race-alice', { raceName: 'A', raceDate: '', generatedAt: new Date().toISOString(), entries: [] });
    writeProgress('bob', 'race-bob', { raceName: 'B', raceDate: '', generatedAt: new Date().toISOString(), entries: [] });
    assert.deepEqual(getAvailableRacesForUser('alice', 30).map(r => r.raceLabel), ['race-alice']);
    assert.ok(getAvailableRacesForUser('alice', 30, true).some(r => r.raceLabel === 'race-bob'));
  });
});

describe('server/mobile.js:getMobileRacesStatusForUser', () => {
  beforeEach(() => {
    writeMobileDeviceFile('alice', 'race-26-08-23', 'PhoneB', [{ lineNumber: 1 }]);
    writeMobileDeviceFile('alice', 'race-26-08-20', 'PhoneA', [{ lineNumber: 1 }, { lineNumber: 2 }]);
    writeMobileDeviceFile('bob',   'race-26-08-25', 'PhoneC', []);
  });

  it('lists only the requesting user\'s own races by default, admin access includes every user\'s', () => {
    const own = getMobileRacesStatusForUser('alice');
    assert.deepEqual(own.map(r => r.raceLabel).sort(), ['race-26-08-20', 'race-26-08-23']);
    const all = getMobileRacesStatusForUser('alice', true);
    assert.ok(all.some(r => r.owner === 'bob'));
  });

  it('reports mtime+size per device, sorted alphabetically, with no `lines` field', () => {
    const race = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-20');
    assert.equal(race.devices[0].name, 'PhoneA');
    assert.equal(typeof race.devices[0].mtime, 'string');
    assert.equal(typeof race.devices[0].size, 'number');
    assert.equal('lines' in race.devices[0], false);
    assert.equal('records' in race.devices[0], false);
  });

  it('excludes adoptions.json from device enumeration', () => {
    const dir = mobileRaceDir('alice', 'race-26-08-23');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adoptions.json'), JSON.stringify({}), 'utf8');
    const race = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-23');
    assert.equal(race.devices.some(d => d.name === 'adoptions'), false);
  });

  it('excludes progress.json from device enumeration', () => {
    writeProgress('alice', 'race-26-08-23', { raceName: 'X', raceDate: '', entries: [] });
    const race = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-23');
    assert.equal(race.devices.some(d => d.name === 'progress'), false);
  });

  it('reports the exact same mtime as getMobileRacesForUser\'s own lastSeen, and a changed file changes it', async () => {
    const full = getMobileRacesForUser('alice').find(r => r.raceLabel === 'race-26-08-20');
    const status = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-20');
    assert.equal(status.devices[0].mtime, full.devices[0].lastSeen);

    const before = status.devices[0];
    await new Promise(r => setTimeout(r, 5));
    writeMobileDeviceFile('alice', 'race-26-08-20', 'PhoneA', [{ lineNumber: 1 }, { lineNumber: 2 }, { lineNumber: 3 }]);
    const after = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-20').devices[0];
    assert.notEqual(after.mtime, before.mtime);
    assert.notEqual(after.size, before.size);
  });
});
