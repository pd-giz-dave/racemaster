'use strict';

// mule-ble.js is a Web Bluetooth client — most of its logic (connectAndVerify's retry loop,
// timeout races, byzantine hardware-failure branches) is only meaningfully exercisable against
// real BLE hardware, as its own extensive comments acknowledge, and isn't attempted here. This
// file covers: (1) every exported pure function directly, and (2) one full fake-GATT
// integration test of connectToPhone -> pullFromConnectedPhone, because that path is where the
// delta-sync cursor (getLastPulledLineNumber/advanceLastPulledLineNumber) actually lives —
// exactly the mechanism the mobile-files auto-sync feature depends on reusing correctly.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorageMock, flushMicrotasks, installNavigatorMock } from './helpers/mock-browser.js';
import {
  isBluetoothAvailable, isBleLoggingEnabled, setBleLoggingEnabled, isConnected,
  getConnectedDeviceName, getRecommendedPollIntervalMs, disconnectPhone, onDisconnect,
  resetLastPulledLineNumber, resetAllLastPulledLineNumbers, getKnownDevices, connectToPhone,
  pullFromConnectedPhone,
} from '../js/mule-ble.js';

const SERVICE_UUID          = '6d6f6269-6c65-2e72-6163-656d61737465';
const DEVICE_INFO_CHAR_UUID = '6d6f6269-6c65-2e72-6163-000000000001';
const CONTROL_CHAR_UUID     = '6d6f6269-6c65-2e72-6163-000000000002';
const DATA_CHAR_UUID        = '6d6f6269-6c65-2e72-6163-000000000003';
const ACK_CHAR_UUID         = '6d6f6269-6c65-2e72-6163-000000000004';

beforeEach(() => {
  installLocalStorageMock();
  delete globalThis.navigator;
});

describe('mule-ble.js:isBluetoothAvailable', () => {
  it('is false with no navigator.bluetooth', () => {
    assert.equal(isBluetoothAvailable(), false);
    installNavigatorMock({});
    assert.equal(isBluetoothAvailable(), false);
  });

  it('is true when navigator.bluetooth exists', () => {
    installNavigatorMock({ bluetooth: {} });
    assert.equal(isBluetoothAvailable(), true);
  });
});

describe('mule-ble.js:isBleLoggingEnabled / setBleLoggingEnabled', () => {
  it('defaults to disabled and round-trips through localStorage', () => {
    assert.equal(isBleLoggingEnabled(), false);
    setBleLoggingEnabled(true);
    assert.equal(isBleLoggingEnabled(), true);
    setBleLoggingEnabled(false);
    assert.equal(isBleLoggingEnabled(), false);
  });
});

describe('mule-ble.js:isConnected / getConnectedDeviceName / getRecommendedPollIntervalMs / disconnectPhone', () => {
  it('report the not-connected defaults, and disconnecting when idle is a safe no-op', () => {
    assert.equal(isConnected(), false);
    assert.equal(getConnectedDeviceName(), null);
    assert.equal(getRecommendedPollIntervalMs(), 10_000); // DEFAULT_POLL_INTERVAL_MS
    assert.doesNotThrow(() => disconnectPhone());
  });
});

describe('mule-ble.js:onDisconnect', () => {
  it('accepts a callback registration without throwing', () => {
    assert.doesNotThrow(() => onDisconnect(() => {}));
  });
});

describe('mule-ble.js:resetLastPulledLineNumber / resetAllLastPulledLineNumbers', () => {
  it('resetLastPulledLineNumber removes just the one device+race cursor', () => {
    localStorage.setItem('racemaster-ble-last-pulled', JSON.stringify({ 'dev1 race-a': 5, 'dev2 race-b': 9 }));
    resetLastPulledLineNumber('dev1', 'race-a');
    assert.deepEqual(JSON.parse(localStorage.getItem('racemaster-ble-last-pulled')), { 'dev2 race-b': 9 });
  });

  it('resetLastPulledLineNumber is a no-op when that cursor was never set', () => {
    localStorage.setItem('racemaster-ble-last-pulled', JSON.stringify({ 'dev2 race-b': 9 }));
    resetLastPulledLineNumber('dev1', 'race-a');
    assert.deepEqual(JSON.parse(localStorage.getItem('racemaster-ble-last-pulled')), { 'dev2 race-b': 9 });
  });

  it('resetAllLastPulledLineNumbers clears the whole cursor map', () => {
    localStorage.setItem('racemaster-ble-last-pulled', JSON.stringify({ 'dev1 race-a': 5 }));
    resetAllLastPulledLineNumbers();
    assert.equal(localStorage.getItem('racemaster-ble-last-pulled'), null);
  });
});

describe('mule-ble.js:getKnownDevices', () => {
  it('returns [] when Bluetooth or getDevices() is unavailable', async () => {
    assert.deepEqual(await getKnownDevices(), []);
    installNavigatorMock({ bluetooth: {} }); // no getDevices function
    assert.deepEqual(await getKnownDevices(), []);
  });

  it('cross-references granted permissions against remembered device names', async () => {
    localStorage.setItem('racemaster-ble-known-devices', JSON.stringify({ dev1: 'Phone One' }));
    const grantedDev1 = { id: 'dev1' };
    const grantedDev2 = { id: 'dev2' }; // granted but never remembered
    installNavigatorMock({ bluetooth: { getDevices: async () => [grantedDev1, grantedDev2] } });
    const known = await getKnownDevices();
    assert.deepEqual(known, [{ device: grantedDev1, name: 'Phone One' }]);
  });

  it('returns [] (not throws) when getDevices() itself rejects', async () => {
    installNavigatorMock({ bluetooth: { getDevices: async () => { throw new Error('denied'); } } });
    assert.deepEqual(await getKnownDevices(), []);
  });
});

// ---- Fake GATT harness for the connect -> pull integration test ----

function jsonDataView(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function makeFakeDataChar() {
  const listeners = new Set();
  return {
    addEventListener:    (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    startNotifications:  async () => {},
    stopNotifications:   async () => {},
    // Simulates the phone streaming `records` back in a single chunk, followed by the 0x00
    // end-of-stream marker collectDataStream() waits for.
    emitRecords(records) {
      const bytes = new TextEncoder().encode(JSON.stringify(records));
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (const fn of listeners) fn({ target: { value: dv } });
      const terminator = new DataView(new Uint8Array([0]).buffer);
      for (const fn of listeners) fn({ target: { value: terminator } });
    },
  };
}

// deviceInfo: the DeviceInfo object this fake phone reports. recordsByRequest(pullRequest) is
// called on every CONTROL write and must return the SyncRecord[] (or RelayManifestEntry[]) to
// stream back for that specific request.
function makeFakePhone({ deviceInfo, recordsByRequest }) {
  const dataChar = makeFakeDataChar();
  const controlChar = {
    writeValueWithResponse: async (bytes) => {
      const req = JSON.parse(new TextDecoder().decode(bytes));
      queueMicrotask(() => dataChar.emitRecords(recordsByRequest(req)));
    },
  };
  const infoChar = { readValue: async () => jsonDataView(deviceInfo) };
  const ackChar  = { writeValueWithResponse: async () => {} };
  const service = {
    getCharacteristic: async (uuid) => ({
      [DEVICE_INFO_CHAR_UUID]: infoChar, [CONTROL_CHAR_UUID]: controlChar,
      [DATA_CHAR_UUID]: dataChar, [ACK_CHAR_UUID]: ackChar,
    }[uuid]),
    getPrimaryService: async () => service, // pullFromConnectedPhone calls gatt.getPrimaryService directly
  };
  const gattServer = { getPrimaryService: async () => service };
  const device = {
    id: 'dev1', name: 'Phone One',
    addEventListener: () => {}, removeEventListener: () => {},
    gatt: {
      connected: false,
      connect: async () => { device.gatt.connected = true; return gattServer; },
      disconnect: () => { device.gatt.connected = false; },
      // pullFromConnectedPhone() calls this directly on .gatt, not on connect()'s returned server.
      getPrimaryService: async () => service,
    },
  };
  return device;
}

// Advances the fake clock past one NOTIFY_SETTLE_MS delay and lets the resulting promise chain
// (settle -> CONTROL write -> queued mock response -> stream reassembly) fully drain. Flushes
// BEFORE ticking too: pullChunkedArray is several `await`s deep (getCharacteristic x2,
// startNotifications) before it ever reaches the setTimeout(NOTIFY_SETTLE_MS) call — ticking
// immediately after kicking off the pull fires on an empty timer queue, since that timer hasn't
// been created yet; a real setTimeout(300) created moments later never gets caught by it.
async function settleOnePull(t) {
  await flushMicrotasks();
  t.mock.timers.tick(300);
  await flushMicrotasks();
}

describe('mule-ble.js:connectToPhone + pullFromConnectedPhone (fake GATT)', () => {
  // Fake timers are enabled per-test, inside each it() body, not in a shared beforeEach — a
  // hook's TestContext is not the same mock tracker the test body's own `t` sees, so timers
  // enabled there never actually apply to the test's own t.mock.timers calls.

  it('connects, verifies DeviceInfo, pulls the delta, and advances the cursor for the next pull', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0, pollIntervalMs: 5000 };
    let lastRequest = null;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => {
        lastRequest = req;
        return [{ recordUuid: 'u1', action: 'Finish', bibNumber: 1, lineNumber: 3, timestampMillis: 1_700_000_000_000 }];
      },
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    // connectToPhone()'s own path (gatt.connect + DeviceInfo read) has no genuine timed delay
    // against a mock that resolves immediately — only the losing side of a Promise.race, which
    // never fires. No tick needed; plain await drains the microtask chain.
    const info = await connectToPhone();
    assert.equal(info.raceLabel, 'test-race');
    assert.equal(isConnected(), true);
    assert.equal(getConnectedDeviceName(), 'Phone One');
    assert.equal(getRecommendedPollIntervalMs(), 5000);
    const pullPromise = pullFromConnectedPhone();
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the CONTROL write
    const results = await pullPromise;

    assert.equal(results.length, 1);
    assert.equal(results[0].raceLabel, 'test-race');
    assert.equal(results[0].deviceId, 'dev1');
    assert.equal(results[0].lines.length, 1);
    assert.equal(results[0].lines[0].recordUuid, 'u1');
    assert.equal(lastRequest.sinceLineNumber, 0); // first pull ever for this device+race

    // Delta cursor must now be advanced to the highest lineNumber just pulled (3).
    const cursors = JSON.parse(localStorage.getItem('racemaster-ble-last-pulled'));
    assert.equal(cursors['dev1 test-race'], 3);

    // A second pull must request only the delta since that cursor, not the whole history again.
    const pullPromise2 = pullFromConnectedPhone();
    await settleOnePull(t);
    await pullPromise2;
    assert.equal(lastRequest.sinceLineNumber, 3);

    disconnectPhone();
    assert.equal(isConnected(), false);
  });

  it('skips the own-race pull entirely for a pure relay/Mule phone with no raceLabel of its own', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Mule', raceLabel: '', relayCount: 1 };
    const relayManifest = [{ originDeviceId: 'origin1', originRaceLabel: 'relayed-race', originDeviceName: 'Origin Phone' }];
    let requestCount = 0;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => {
        requestCount++;
        if (req.requestRelayManifest) return relayManifest;
        return [{ recordUuid: 'r1', action: 'Finish', bibNumber: 2, lineNumber: 1, timestampMillis: 1_700_000_000_000 }];
      },
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    await connectToPhone();

    const pullPromise = pullFromConnectedPhone();
    await settleOnePull(t); // relay-manifest fetch's own settle delay
    await settleOnePull(t); // the one relayed race's own settle delay (sequential, not concurrent)
    const results = await pullPromise;

    assert.equal(requestCount, 2); // manifest fetch + the one relayed race — no "own race" leg at all
    assert.equal(results.length, 1);
    assert.equal(results[0].raceLabel, 'relayed-race');
    assert.equal(results[0].deviceId, 'origin1');
  });
});
