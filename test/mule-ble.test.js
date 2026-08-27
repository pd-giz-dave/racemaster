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
  resetLastPulledLineNumber, resetAllLastPulledLineNumbers,
  getKnownDevices, connectToPhone, pullFromConnectedPhone, abandonConnection,
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
// stream back for that specific request. failConnectsFrom (default: never), if given, makes the
// Nth-and-every-later gatt.connect() call reject instead of succeeding — the 1-indexed call
// count includes the very first connect, so failConnectsFrom: 2 means "connects fine once, then
// every reconnect after that fails". failWrite (default: false), if true, makes the CONTROL
// write itself reject every time — simulates the connection dropping between a pull starting
// and its write landing. dropAfterConnect (default: never), if given, fires a real
// 'gattserverdisconnected' event synchronously right after the Nth gatt.connect() call
// succeeds — simulates a flaky link dropping again immediately mid-attempt.
function makeFakePhone({ deviceInfo, recordsByRequest, failConnectsFrom = Infinity, failWrite = false, dropAfterConnect = null }) {
  const dataChar = makeFakeDataChar();
  const controlChar = {
    writeValueWithResponse: async (bytes) => {
      if (failWrite) throw new Error('GATT Server is disconnected. Cannot perform GATT operations.');
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
  const disconnectListeners = new Set();
  let connectCallCount = 0;
  const device = {
    id: 'dev1', name: 'Phone One',
    addEventListener: (type, fn) => { if (type === 'gattserverdisconnected') disconnectListeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'gattserverdisconnected') disconnectListeners.delete(fn); },
    gatt: {
      connected: false,
      connect: async () => {
        connectCallCount++;
        if (connectCallCount >= failConnectsFrom) throw new Error('out of range');
        device.gatt.connected = true;
        if (connectCallCount === dropAfterConnect) {
          device.gatt.connected = false;
          for (const fn of disconnectListeners) fn();
        }
        return gattServer;
      },
      // Real BluetoothRemoteGATTServer.disconnect() fires 'gattserverdisconnected' on the
      // device too (mule-ble.js's own disconnectPhone() doc already documents this) — not just
      // an out-of-range drop (_simulateUnexpectedDisconnect below). A no-op if already
      // disconnected, matching the real API.
      disconnect: () => {
        if (!device.gatt.connected) return;
        device.gatt.connected = false;
        for (const fn of disconnectListeners) fn();
      },
      // pullFromConnectedPhone() calls this directly on .gatt, not on connect()'s returned server.
      getPrimaryService: async () => service,
    },
    // Test-only helper (not part of the real BluetoothDevice API) — simulates the phone
    // dropping out of range/turning off, firing the same 'gattserverdisconnected' listener a
    // real disconnect would.
    _simulateUnexpectedDisconnect() {
      device.gatt.connected = false;
      for (const fn of disconnectListeners) fn();
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

  it('does not leave an unhandled rejection when the CONTROL write fails after the stream listener is already armed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], failWrite: true });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    await connectToPhone();

    let unhandled = null;
    const onUnhandledRejection = (reason) => { unhandled = reason; };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const pullPromise = pullFromConnectedPhone();
      // Attached before settling/ticking, not after — otherwise pullPromise can reject during
      // settleOnePull()'s own tick with nothing yet observing it, which Node briefly (correctly)
      // flags as an unhandled rejection of its own before this test ever gets to check anything.
      const rejectionAssertion = assert.rejects(() => pullPromise, /GATT Server is disconnected/);
      await settleOnePull(t); // NOTIFY_SETTLE_MS before the (failing) CONTROL write
      await rejectionAssertion;
      // collectDataStream's own internal PULL_TIMEOUT_MS (15s) timer would otherwise still be
      // pending at this point and fire much later as a genuinely unhandled rejection — advance
      // well past it and confirm that no longer happens (pullChunkedArray must have already
      // attached its own .catch() once the write itself failed).
      t.mock.timers.tick(20_000);
      await flushMicrotasks();
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
    assert.equal(unhandled, null);
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

describe('mule-ble.js:connectToPhone picker filter (Mule Mode only)', () => {
  const MULE_MODE_MARKER_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';

  it('filters requestDevice() to both the GATT service UUID and the Mule Mode marker UUID', async (t) => {
    // Same reasoning as every other test in this file that reaches connectToPhone(): without
    // fake timers, the losing side of connectAndVerify's internal Promise.race (a real, unref'd
    // 12s setTimeout) is left dangling for the rest of this process's life, which doesn't fail
    // anything but needlessly stalls the whole suite's wall-clock runtime.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    let requestDeviceOptions = null;
    installNavigatorMock({
      bluetooth: { requestDevice: async (options) => { requestDeviceOptions = options; return device; } },
    });

    await connectToPhone();
    disconnectPhone();

    // Both UUIDs required in one filter object — Web Bluetooth's "advertised UUIDs must be a
    // superset of filter.services" semantics — not the manufacturerData/dataPrefix approach
    // tried first (see MULE_MODE_MARKER_SERVICE_UUID's own doc for why that was abandoned:
    // confirmed unreliable in the field on at least one real platform, whereas service-UUID
    // filtering is pushed down into the OS's own native discovery filter and proven reliable).
    assert.equal(requestDeviceOptions.filters.length, 1);
    assert.deepEqual(requestDeviceOptions.filters[0].services, [SERVICE_UUID, MULE_MODE_MARKER_SERVICE_UUID]);
  });
});

describe('mule-ble.js:onDisconnect wasDeliberate', () => {
  it('receives wasDeliberate: true for disconnectPhone(), false for an unexpected drop', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    await connectToPhone();

    const seen = [];
    onDisconnect(wasDeliberate => seen.push(wasDeliberate));

    disconnectPhone();
    assert.deepEqual(seen, [true]);

    // Reconnect, then simulate a genuinely unexpected drop — the earlier deliberate disconnect
    // must not still be "remembered" as making this one expected too.
    await connectToPhone();
    device._simulateUnexpectedDisconnect();
    assert.deepEqual(seen, [true, false]);
  });

  it('calling disconnectPhone() with nothing live to disconnect does not misclassify a later unexpected drop as deliberate', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    // Calling disconnectPhone() while already idle is a real path — e.g. the "declined the
    // connect confirmation" UI branch calls it unconditionally, and the phone can have already
    // dropped out during that wait. Since there's no live device.gatt.connected, the real
    // .gatt.disconnect() call (and the forgetConnection() that would normally reset the
    // deliberate flag) never happens — this must not leave anything stuck for next time.
    assert.equal(isConnected(), false);
    disconnectPhone();

    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    await connectToPhone();

    const seen = [];
    onDisconnect(wasDeliberate => seen.push(wasDeliberate));
    device._simulateUnexpectedDisconnect();

    assert.deepEqual(seen, [false]);
  });
});

describe('mule-ble.js:forgetConnection forgets the known device on an unexpected drop, not a deliberate one', () => {
  it('an unexpected drop removes the device from getKnownDevices()', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    await connectToPhone();
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']);

    device._simulateUnexpectedDisconnect();
    assert.deepEqual(await getKnownDevices(), []);
  });

  it('a deliberate disconnectPhone() call leaves the device remembered', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    await connectToPhone();

    disconnectPhone();
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']);
  });
});

describe('mule-ble.js:abandonConnection', () => {
  it('disconnects and forgets the device — deliberately no automatic reconnect attempt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    await connectToPhone();
    assert.equal(isConnected(), true);

    abandonConnection();

    assert.equal(isConnected(), false);
    assert.deepEqual(await getKnownDevices(), []);
  });

  it('is a safe no-op when nothing is connected', () => {
    assert.doesNotThrow(() => abandonConnection());
    assert.equal(isConnected(), false);
  });
});
