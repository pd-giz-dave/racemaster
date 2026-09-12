'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import { installLocalStorageMock } from './helpers/mock-browser.js';
import { setRaceStaleAfterDays } from '../js/mule-ble.js';
import {
  selectedKeys, rowKey, loadSelectedKeys, saveSelectedKeys, currentDatasetContext,
  loadLastSynced, saveLastSynced, getLastSyncedLineNumber, setLastSyncedLineNumber, maxLineNumber,
  loadBleLastSeen, recordBleLastSeen, getBleLastSeen,
  laterIso, formatRaceDate, formatDateTime, formatStoredTimestamp, latestLineTimestamp,
  parseRaceLabelDate, raceNameOf, sortRaces, mergePendingIntoRaces,
  byLineNumber, computeIncorporationStatus,
  getServerPollIntervalSeconds, setServerPollIntervalSeconds, hasNewMobileData, filterStaleRaces,
  isDeviceStale, isProgressStale,
} from '../js/mobile-files-shared.js';

beforeEach(() => {
  installLocalStorageMock();
  selectedKeys.clear();
  state.event.name = '';
  state.event.date = '';
});

function row(overrides = {}) {
  return {
    owner: 'alice', raceLabel: 'test-race-26-08-30',
    device: { name: 'Phone One', lines: [] },
    ...overrides,
  };
}

describe('mobile-files-shared.js:rowKey', () => {
  it('combines owner, raceLabel and device name', () => {
    assert.equal(rowKey(row()), 'alice test-race-26-08-30 Phone One');
  });
});

describe('mobile-files-shared.js:currentDatasetContext', () => {
  it('is "standalone" with no session', () => {
    assert.equal(currentDatasetContext(), 'standalone');
  });

  it('is the session\'s own owner/fullName dataset identity when signed in', () => {
    localStorage.setItem('racemaster-token', 'tok123');
    localStorage.setItem('racemaster-dataset', 'alice/race-2026');
    assert.equal(currentDatasetContext(), 'alice/race-2026');
  });
});

describe('mobile-files-shared.js:loadSelectedKeys / saveSelectedKeys', () => {
  it('round-trips the current selection plus the dataset identity it was saved under', () => {
    selectedKeys.add('alice test-race Phone One');
    saveSelectedKeys();
    assert.deepEqual(loadSelectedKeys(), {
      context: 'standalone', keys: ['alice test-race Phone One'],
    });
  });

  it('returns null when nothing has ever been saved, or the saved shape is corrupt', () => {
    assert.equal(loadSelectedKeys(), null);
    localStorage.setItem('racemaster-mobile-selected-keys', '{"not":"the right shape"}');
    assert.equal(loadSelectedKeys(), null);
    localStorage.setItem('racemaster-mobile-selected-keys', 'not even json');
    assert.equal(loadSelectedKeys(), null);
  });
});

describe('mobile-files-shared.js:last-synced tracking', () => {
  it('getLastSyncedLineNumber defaults to 0 for a row never synced before', () => {
    assert.equal(getLastSyncedLineNumber(row()), 0);
  });

  it('setLastSyncedLineNumber records the highest lineNumber currently in the file', () => {
    const r = row({ device: { name: 'Phone One', lines: [{ lineNumber: 3 }, { lineNumber: 7 }, { lineNumber: 2 }] } });
    setLastSyncedLineNumber(r);
    assert.equal(getLastSyncedLineNumber(r), 7);
  });

  it('keys by owner+raceLabel+deviceName, not shared across different rows', () => {
    const r1 = row({ owner: 'alice', device: { name: 'Phone One', lines: [{ lineNumber: 5 }] } });
    const r2 = row({ owner: 'bob',   device: { name: 'Phone One', lines: [{ lineNumber: 5 }] } });
    setLastSyncedLineNumber(r1);
    assert.equal(getLastSyncedLineNumber(r1), 5);
    assert.equal(getLastSyncedLineNumber(r2), 0);
  });

  it('maxLineNumber treats a missing lineNumber as 0 and an empty array as 0', () => {
    assert.equal(maxLineNumber([]), 0);
    assert.equal(maxLineNumber([{ lineNumber: 4 }, {}, { lineNumber: 1 }]), 4);
  });

  it('loadLastSynced/saveLastSynced fall back to an empty map on corrupt storage', () => {
    localStorage.setItem('racemaster-mobile-last-synced', 'not json');
    assert.deepEqual(loadLastSynced(), {});
    saveLastSynced({ a: 1 });
    assert.deepEqual(loadLastSynced(), { a: 1 });
  });
});

describe('mobile-files-shared.js:BLE last-seen tracking', () => {
  it('getBleLastSeen returns null until recordBleLastSeen has been called for that key', () => {
    assert.equal(getBleLastSeen('alice', 'race', 'Phone One'), null);
    recordBleLastSeen('alice', 'race', 'Phone One');
    assert.match(getBleLastSeen('alice', 'race', 'Phone One'), /^\d{4}-\d{2}-\d{2}T/);
  });

  it('is keyed independently per owner/raceLabel/deviceName', () => {
    recordBleLastSeen('alice', 'race-a', 'Phone One');
    assert.equal(getBleLastSeen('alice', 'race-b', 'Phone One'), null);
    assert.equal(getBleLastSeen('bob', 'race-a', 'Phone One'), null);
  });

  it('loadBleLastSeen falls back to an empty map on corrupt storage', () => {
    localStorage.setItem('racemaster-mobile-ble-last-seen', 'not json');
    assert.deepEqual(loadBleLastSeen(), {});
  });
});

describe('mobile-files-shared.js:laterIso', () => {
  it('returns whichever of the two timestamps is later, or the only one present', () => {
    assert.equal(laterIso(null, '2026-08-30T10:00:00.000Z'), '2026-08-30T10:00:00.000Z');
    assert.equal(laterIso('2026-08-30T10:00:00.000Z', null), '2026-08-30T10:00:00.000Z');
    assert.equal(laterIso(null, null), null);
    assert.equal(laterIso('2026-08-30T10:00:00.000Z', '2026-08-30T11:00:00.000Z'), '2026-08-30T11:00:00.000Z');
    assert.equal(laterIso('2026-08-30T11:00:00.000Z', '2026-08-30T10:00:00.000Z'), '2026-08-30T11:00:00.000Z');
  });
});

describe('mobile-files-shared.js:formatRaceDate / formatDateTime / formatStoredTimestamp', () => {
  it('formatRaceDate renders dd/mm/yy, or an "Unknown" placeholder for a null date', () => {
    assert.equal(formatRaceDate({ dd: '30', mm: '08', yy: '26' }), '30/08/26');
    assert.match(formatRaceDate(null), /Unknown/);
  });

  it('formatDateTime renders a real ISO timestamp as local dd/mm/yy HH:MM, and placeholders for anything unparseable', () => {
    assert.match(formatDateTime(null), /—/);
    assert.match(formatDateTime('not a date'), /—/);
    assert.match(formatDateTime(new Date('2026-08-30T12:34:00Z').toISOString()), /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it('formatDateTime with {seconds: true} appends :SS', () => {
    assert.match(formatDateTime(new Date('2026-08-30T12:34:56Z').toISOString(), { seconds: true }), /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('formatStoredTimestamp reformats the phone\'s own "yyyy/mm/dd HH:MM:SS" wire format', () => {
    assert.equal(formatStoredTimestamp('2026/08/30 12:34:56'), '30/08/26 12:34');
    assert.match(formatStoredTimestamp(''), /—/);
    assert.match(formatStoredTimestamp('garbage'), /—/);
  });
});

describe('mobile-files-shared.js:latestLineTimestamp', () => {
  it('returns the latest of every line\'s own timestamp, across the whole file not just what\'s visible', () => {
    const lines = [{ timestamp: '2026/08/30 10:00:00' }, { timestamp: '2026/08/30 12:00:00' }, { timestamp: '2026/08/30 11:00:00' }];
    assert.equal(latestLineTimestamp(lines), '2026/08/30 12:00:00');
  });

  it('falls back to timestampMillis for a pre-rename line, and null for an empty file', () => {
    assert.equal(latestLineTimestamp([]), null);
    assert.equal(latestLineTimestamp([{ timestampMillis: '2026/08/30 09:00:00' }]), '2026/08/30 09:00:00');
  });
});

describe('mobile-files-shared.js:parseRaceLabelDate / raceNameOf', () => {
  it('parses the trailing -yy-mm-dd date suffix', () => {
    assert.deepEqual(parseRaceLabelDate('dcn-test-Seniors-26-08-30'), { yy: '26', mm: '08', dd: '30' });
    assert.equal(parseRaceLabelDate('no-date-suffix-here'), null);
  });

  it('strips that same suffix back off to get the bare race name', () => {
    assert.equal(raceNameOf('dcn-test-Seniors-26-08-30'), 'dcn-test-Seniors');
    assert.equal(raceNameOf('no-date-suffix'), 'no-date-suffix');
  });
});

describe('mobile-files-shared.js:sortRaces', () => {
  it('sorts newest date first, then by race name for same-day races', () => {
    const races = [
      { raceLabel: 'zzz-race-26-08-01' },
      { raceLabel: 'aaa-race-26-08-30' },
      { raceLabel: 'bbb-race-26-08-30' },
    ].map(r => ({ ...r, raceDate: parseRaceLabelDate(r.raceLabel) }));
    const sorted = sortRaces(races).map(r => r.raceLabel);
    assert.deepEqual(sorted, ['aaa-race-26-08-30', 'bbb-race-26-08-30', 'zzz-race-26-08-01']);
  });

  it('puts races with a real date ahead of races with none', () => {
    const races = [
      { raceLabel: 'no-date-race', raceDate: null },
      { raceLabel: 'dated-race-26-08-30', raceDate: parseRaceLabelDate('dated-race-26-08-30') },
    ];
    assert.deepEqual(sortRaces(races).map(r => r.raceLabel), ['dated-race-26-08-30', 'no-date-race']);
  });
});

describe('mobile-files-shared.js:mergePendingIntoRaces', () => {
  it('adds a pending device to an existing race, deduping already-known lines by recordUuid', () => {
    const races = [{
      owner: 'alice', raceLabel: 'race-a', raceDate: null,
      devices: [{ name: 'Phone One', lines: [{ recordUuid: 'u1', lineNumber: 1 }] }],
    }];
    const pending = [{
      owner: 'alice', raceLabel: 'race-a', deviceName: 'Phone One', deviceId: 'dev1', pulledAt: '2026-08-30T10:00:00.000Z',
      lines: [{ recordUuid: 'u1', lineNumber: 1 }, { recordUuid: 'u2', lineNumber: 2 }],
    }];
    const merged = mergePendingIntoRaces(races, pending);
    assert.equal(merged.length, 1);
    const device = merged[0].devices.find(d => d.name === 'Phone One');
    assert.equal(device.lines.length, 2); // u1 not duplicated, u2 added
    assert.equal(device.pending, true);
  });

  it('creates a brand-new race entry for a pending file the server has never seen', () => {
    const merged = mergePendingIntoRaces([], [{
      owner: 'alice', raceLabel: 'race-a-26-08-30', deviceName: 'Phone One', deviceId: 'dev1',
      pulledAt: '2026-08-30T10:00:00.000Z', lines: [{ recordUuid: 'u1', lineNumber: 1 }],
    }]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].raceLabel, 'race-a-26-08-30');
    assert.deepEqual(merged[0].raceDate, { yy: '26', mm: '08', dd: '30' });
  });
});

describe('mobile-files-shared.js:byLineNumber', () => {
  it('sorts ascending by lineNumber, treating a missing one as 0', () => {
    const rows = [{ lineNumber: 3 }, {}, { lineNumber: 1 }];
    assert.deepEqual(rows.sort(byLineNumber).map(r => r.lineNumber), [undefined, 1, 3]);
  });
});

describe('mobile-files-shared.js:computeIncorporationStatus', () => {
  it('reports "none" for a row that is not currently selected, regardless of its lines', () => {
    const r = row({ device: { name: 'Phone One', lines: [{ lineNumber: 5 }] } });
    assert.equal(computeIncorporationStatus(r), 'none');
  });

  it('reports "outstanding" for a selected row with lines newer than its last-synced cursor', () => {
    const r = row({ device: { name: 'Phone One', lines: [{ lineNumber: 5 }] } });
    selectedKeys.add(rowKey(r));
    assert.equal(computeIncorporationStatus(r), 'outstanding');
  });

  it('reports "incorporated" for a selected row already fully synced', () => {
    const r = row({ device: { name: 'Phone One', lines: [{ lineNumber: 5 }] } });
    selectedKeys.add(rowKey(r));
    setLastSyncedLineNumber(r);
    assert.equal(computeIncorporationStatus(r), 'incorporated');
  });
});

describe('mobile-files-shared.js:getServerPollIntervalSeconds / setServerPollIntervalSeconds', () => {
  it('defaults to 30 seconds and round-trips through localStorage', () => {
    assert.equal(getServerPollIntervalSeconds(), 30);
    setServerPollIntervalSeconds(60);
    assert.equal(getServerPollIntervalSeconds(), 60);
    setServerPollIntervalSeconds(5);
    assert.equal(getServerPollIntervalSeconds(), 5);
  });

  it('falls back to the default for a corrupt, missing, or too-low stored value rather than throwing', () => {
    assert.equal(getServerPollIntervalSeconds(), 30);
    localStorage.setItem('racemaster-mobile-server-poll-seconds', 'not a number');
    assert.equal(getServerPollIntervalSeconds(), 30);
    localStorage.setItem('racemaster-mobile-server-poll-seconds', '4');
    assert.equal(getServerPollIntervalSeconds(), 30);
  });
});

describe('mobile-files-shared.js:hasNewMobileData', () => {
  function statusRace(devices) { return { owner: 'alice', raceLabel: 'race-26-08-30', devices }; }

  it('is false when the status response matches lastKnownRaces exactly', () => {
    const known  = [statusRace([{ name: 'PhoneA', lastSeen: '2026-08-30T10:00:00.000Z' }])];
    const status = [statusRace([{ name: 'PhoneA', mtime: '2026-08-30T10:00:00.000Z' }])];
    assert.equal(hasNewMobileData(status, known), false);
  });

  it('is true when a device\'s mtime differs from its known lastSeen', () => {
    const known  = [statusRace([{ name: 'PhoneA', lastSeen: '2026-08-30T10:00:00.000Z' }])];
    const status = [statusRace([{ name: 'PhoneA', mtime: '2026-08-30T11:00:00.000Z' }])];
    assert.equal(hasNewMobileData(status, known), true);
  });

  it('is true when a new device appears', () => {
    const known  = [statusRace([])];
    const status = [statusRace([{ name: 'PhoneA', mtime: '2026-08-30T10:00:00.000Z' }])];
    assert.equal(hasNewMobileData(status, known), true);
  });

  it('is true when a device disappears', () => {
    const known  = [statusRace([{ name: 'PhoneA', lastSeen: '2026-08-30T10:00:00.000Z' }])];
    const status = [statusRace([])];
    assert.equal(hasNewMobileData(status, known), true);
  });
});

describe('mobile-files-shared.js:filterStaleRaces', () => {
  // "…-YY-MM-DD" today's date — guaranteed never stale regardless of when this test runs, same
  // convention as test/mule-ble.test.js's own todayRaceLabelSuffix().
  function todayRaceLabel(name) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${name}-${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function nowTimestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  // 2020-01-01 — many years stale under any sane threshold, same fixed old date
  // test/mule-ble.test.js's own staleness tests use.
  const OLD_LABEL = 'race-20-01-01';

  beforeEach(() => setRaceStaleAfterDays(2));

  it('drops a race whose label is old and has no device with recent activity', () => {
    const races = [{ owner: 'alice', raceLabel: OLD_LABEL, devices: [{ name: 'PhoneA', lines: [{ timestamp: '2020/01/01 10:00:00' }] }] }];
    assert.deepEqual(filterStaleRaces(races), []);
  });

  it('keeps an old-labelled race if any device has a recent line timestamp (a still-running multi-day event)', () => {
    const races = [{ owner: 'alice', raceLabel: OLD_LABEL, devices: [{ name: 'PhoneA', lines: [{ timestamp: nowTimestamp() }] }] }];
    assert.equal(filterStaleRaces(races).length, 1);
  });

  it('keeps a race with an unparseable label regardless of activity', () => {
    const races = [{ owner: 'alice', raceLabel: 'no-date-here', devices: [{ name: 'PhoneA', lines: [{ timestamp: '2020/01/01 10:00:00' }] }] }];
    assert.equal(filterStaleRaces(races).length, 1);
  });

  it('keeps a race whose label is younger than the threshold', () => {
    const races = [{ owner: 'alice', raceLabel: todayRaceLabel('race'), devices: [{ name: 'PhoneA', lines: [{ timestamp: '2020/01/01 10:00:00' }] }] }];
    assert.equal(filterStaleRaces(races).length, 1);
  });
});

describe('mobile-files-shared.js:isDeviceStale', () => {
  function todayRaceLabel(name) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${name}-${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function nowTimestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  const OLD_LABEL = 'race-20-01-01';

  beforeEach(() => setRaceStaleAfterDays(2));

  it('is true for an old-labelled race whose device has no recent activity', () => {
    assert.equal(isDeviceStale(OLD_LABEL, { lines: [{ timestamp: '2020/01/01 10:00:00' }] }), true);
  });

  it('is false for an old-labelled race whose device DOES have recent activity', () => {
    assert.equal(isDeviceStale(OLD_LABEL, { lines: [{ timestamp: nowTimestamp() }] }), false);
  });

  it('is false for a young-labelled race regardless of device activity', () => {
    assert.equal(isDeviceStale(todayRaceLabel('race'), { lines: [{ timestamp: '2020/01/01 10:00:00' }] }), false);
  });

  it('is false for an unparseable label regardless of device activity', () => {
    assert.equal(isDeviceStale('no-date-here', { lines: [{ timestamp: '2020/01/01 10:00:00' }] }), false);
  });

  it('disagrees with filterStaleRaces on purpose: a race kept because ONE device is recent still flags its OTHER, individually-stale device', () => {
    const staleDevice = { name: 'Old', lines: [{ timestamp: '2020/01/01 10:00:00' }] };
    const freshDevice = { name: 'New', lines: [{ timestamp: nowTimestamp() }] };
    const races = [{ owner: 'alice', raceLabel: OLD_LABEL, devices: [staleDevice, freshDevice] }];
    // filterStaleRaces keeps the whole race (existing behaviour, covered above)...
    assert.equal(filterStaleRaces(races).length, 1);
    // ...but isDeviceStale still tells the two devices apart within it.
    assert.equal(isDeviceStale(OLD_LABEL, staleDevice), true);
    assert.equal(isDeviceStale(OLD_LABEL, freshDevice), false);
  });
});

describe('mobile-files-shared.js:isProgressStale', () => {
  function todayRaceLabel(name) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${name}-${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const OLD_LABEL = 'race-20-01-01';

  beforeEach(() => setRaceStaleAfterDays(2));

  it('is true for an old-labelled race with an old generatedAt', () => {
    assert.equal(isProgressStale(OLD_LABEL, { generatedAt: '2020-01-01T10:00:00.000Z' }), true);
  });

  it('is false for an old-labelled race with a recent generatedAt', () => {
    assert.equal(isProgressStale(OLD_LABEL, { generatedAt: new Date().toISOString() }), false);
  });

  it('is false for a young-labelled race regardless of generatedAt', () => {
    assert.equal(isProgressStale(todayRaceLabel('race'), { generatedAt: '2020-01-01T10:00:00.000Z' }), false);
  });

  it('is true for an old-labelled race with a missing/invalid generatedAt — nothing proves it\'s fresh', () => {
    assert.equal(isProgressStale(OLD_LABEL, {}), true);
    assert.equal(isProgressStale(OLD_LABEL, { generatedAt: 'not a date' }), true);
  });
});
