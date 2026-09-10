'use strict';

import './helpers/setup-root.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { ensureDirs, MOBILE_DIR } from '../../server/config.js';
import {
  mobileRaceDir, mobileDeviceFilePath, readMobileDeviceFile, writeMobileDeviceFile,
  bibAllocationsFilePath, readBibAllocations, writeBibAllocations, parseRaceLabelDate,
  getMobileRacesForUser, getMobileRacesStatusForUser,
} from '../../server/mobile.js';

beforeEach(() => {
  fs.rmSync(MOBILE_DIR, { recursive: true, force: true });
  ensureDirs();
});

describe('server/mobile.js:path builders', () => {
  it('mobileRaceDir/mobileDeviceFilePath/bibAllocationsFilePath nest under MOBILE_DIR/<user>/<race>/', () => {
    assert.equal(mobileRaceDir('alice', 'race-26-08-23'), path.join(MOBILE_DIR, 'alice', 'race-26-08-23'));
    assert.equal(mobileDeviceFilePath('alice', 'race-26-08-23', 'PhoneA'),
      path.join(MOBILE_DIR, 'alice', 'race-26-08-23', 'PhoneA.json'));
    assert.equal(bibAllocationsFilePath('alice', 'race-26-08-23'),
      path.join(MOBILE_DIR, 'alice', 'race-26-08-23', 'bib-allocations.json'));
  });
});

describe('server/mobile.js:readMobileDeviceFile / writeMobileDeviceFile', () => {
  it('round-trips a device\'s line array, creating directories as needed', () => {
    const lines = [{ recordUuid: 'u1', action: 'Finish', bibNumber: 1 }];
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

describe('server/mobile.js:readBibAllocations / writeBibAllocations', () => {
  it('round-trips a bib-allocations payload', () => {
    const payload = { raceName: 'Test Race', raceDate: '23/08/2026', entries: [{ bibNumber: 1, name: 'Dave', course: 'Seniors' }] };
    writeBibAllocations('alice', 'race1', payload);
    assert.deepEqual(readBibAllocations('alice', 'race1'), payload);
  });

  it('returns null when there is no bib-allocations file yet', () => {
    assert.equal(readBibAllocations('alice', 'no-such-race'), null);
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
    writeMobileDeviceFile('alice', 'race-26-08-23', 'PhoneB', [{ recordUuid: 'u1' }]);
    writeMobileDeviceFile('alice', 'race-26-08-20', 'PhoneA', [{ recordUuid: 'u2' }, { recordUuid: 'u3' }]);
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

  it('excludes bib-allocations.json from device enumeration, but surfaces it via the bibAllocations field', () => {
    writeBibAllocations('alice', 'race-26-08-23', { raceName: 'X', raceDate: '', entries: [] });
    const race = getMobileRacesForUser('alice').find(r => r.raceLabel === 'race-26-08-23');
    assert.equal(race.devices.some(d => d.name === 'bib-allocations'), false);
    assert.ok(race.bibAllocations);
  });

  it('a race label with no trailing date sorts after every dated race', () => {
    writeMobileDeviceFile('alice', 'undated-race', 'PhoneZ', []);
    const races = getMobileRacesForUser('alice');
    assert.equal(races[races.length - 1].raceLabel, 'undated-race');
  });
});

describe('server/mobile.js:getMobileRacesStatusForUser', () => {
  beforeEach(() => {
    writeMobileDeviceFile('alice', 'race-26-08-23', 'PhoneB', [{ recordUuid: 'u1' }]);
    writeMobileDeviceFile('alice', 'race-26-08-20', 'PhoneA', [{ recordUuid: 'u2' }, { recordUuid: 'u3' }]);
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

  it('excludes bib-allocations.json from device enumeration', () => {
    writeBibAllocations('alice', 'race-26-08-23', { raceName: 'X', raceDate: '', entries: [] });
    const race = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-23');
    assert.equal(race.devices.some(d => d.name === 'bib-allocations'), false);
  });

  it('reports the exact same mtime as getMobileRacesForUser\'s own lastSeen, and a changed file changes it', async () => {
    const full = getMobileRacesForUser('alice').find(r => r.raceLabel === 'race-26-08-20');
    const status = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-20');
    assert.equal(status.devices[0].mtime, full.devices[0].lastSeen);

    const before = status.devices[0];
    await new Promise(r => setTimeout(r, 5));
    writeMobileDeviceFile('alice', 'race-26-08-20', 'PhoneA', [{ recordUuid: 'u2' }, { recordUuid: 'u3' }, { recordUuid: 'u4' }]);
    const after = getMobileRacesStatusForUser('alice').find(r => r.raceLabel === 'race-26-08-20').devices[0];
    assert.notEqual(after.mtime, before.mtime);
    assert.notEqual(after.size, before.size);
  });
});
