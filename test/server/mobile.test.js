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
  getMobileRacesForUser,
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
