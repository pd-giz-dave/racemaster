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
  getKnownDevices, connectToPhone, reconnectToKnownDevice, pullFromConnectedPhone, abandonConnection,
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
// every reconnect after that fails". failConnectsCount (default: 0), if given, makes exactly the
// first N gatt.connect() calls reject with a transient-looking error before every call after
// that succeeds normally — simulates the real, field-confirmed `NetworkError: Connection Error:
// Connection attempt failed.` connectAndVerify's own GATT_CONNECT_ATTEMPTS retry loop exists to
// recover from, as distinct from failConnectsFrom's permanent failure. failWrite (default:
// false), if true, makes the CONTROL write itself reject every time — simulates the connection
// dropping between a pull starting and its write landing. dropAfterConnect (default: never), if
// given, fires a real 'gattserverdisconnected' event synchronously right after the Nth
// gatt.connect() call succeeds — simulates a flaky link dropping again immediately mid-attempt.
// failDeviceInfoReadsCount (default: 0), if given, makes exactly the first N DeviceInfo
// characteristic reads reject, with device.gatt.connected deliberately left reading true
// throughout (unlike dropAfterConnect) — simulates connectAndVerify's own DEVICE_INFO_READ_TIMEOUT_MS
// giving up on a read that's still genuinely in flight underneath, the scenario its retry loop
// must reconnect before retrying rather than reusing the same still-busy connection.
// neverRespondToWrites (default: false), if true, makes the CONTROL write itself resolve
// normally (unlike failWrite) but never queue the matching data-stream response — simulates a
// pull that's genuinely in flight, purely waiting on incoming notifications, when the
// connection then drops for real (see _simulateUnexpectedDisconnect). hangDeviceInfoReadsFrom
// (default: never), if given, makes the Nth-and-every-later DeviceInfo characteristic read
// return a promise that never settles at all, rather than rejecting — simulates a real GATT
// call against a phone that's just gone out of range, which has no spec-guaranteed timeout of
// its own and was observed hanging indefinitely before callers raced it against one.
function makeFakePhone({ deviceInfo, recordsByRequest, failConnectsFrom = Infinity, failConnectsCount = 0, failWrite = false, dropAfterConnect = null, failDeviceInfoReadsCount = 0, neverRespondToWrites = false, hangDeviceInfoReadsFrom = Infinity }) {
  const dataChar = makeFakeDataChar();
  const controlChar = {
    writeValueWithResponse: async (bytes) => {
      if (failWrite) throw new Error('GATT Server is disconnected. Cannot perform GATT operations.');
      if (neverRespondToWrites) return;
      const req = JSON.parse(new TextDecoder().decode(bytes));
      queueMicrotask(() => dataChar.emitRecords(recordsByRequest(req)));
    },
  };
  let infoReadCallCount = 0;
  const infoChar = {
    readValue: async () => {
      infoReadCallCount++;
      if (infoReadCallCount >= hangDeviceInfoReadsFrom) return new Promise(() => {}); // never settles
      if (infoReadCallCount <= failDeviceInfoReadsCount) throw new Error(`Timed out reading DeviceInfo from "that device".`);
      return jsonDataView(deviceInfo);
    },
  };
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
        if (connectCallCount <= failConnectsCount) throw new Error('Connection Error: Connection attempt failed.');
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
    // Test-only accessor (not part of the real BluetoothDevice API) — lets a test assert how
    // many times gatt.connect() was actually called, e.g. to confirm a retry loop reconnected
    // rather than reusing the same connection.
    get _connectCallCount() { return connectCallCount; },
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

// Advances the fake clock past whichever of connectAndVerify's own connect-related delays is
// next pending — GATT_CONNECT_RETRY_DELAY_MS or DEVICE_INFO_RETRY_DELAY_MS between retried
// gatt.connect() attempts (see makeFakePhone's failConnectsCount/failDeviceInfoReadsCount), or
// GATT_CONNECT_SETTLE_MS before every DeviceInfo verification attempt — and lets the resulting
// promise chain drain. All three are ≤500ms; 600ms comfortably clears any of them without
// needing this test file to import (and hardcode a duplicate of) the real, unexported constants.
async function settleConnectRetry(t) {
  await flushMicrotasks();
  t.mock.timers.tick(600);
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

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    const info = await connectPromise;
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

  it('retries a transient initial gatt.connect() failure and still connects', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    // Fails the first 2 of GATT_CONNECT_ATTEMPTS (3) initial connect attempts with the real,
    // field-confirmed transient error, then succeeds on the 3rd.
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], failConnectsCount: 2 });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // attempt 1 fails, delay before attempt 2
    await settleConnectRetry(t); // attempt 2 fails, delay before attempt 3
    await settleConnectRetry(t); // attempt 3 succeeds; GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    const info = await connectPromise;

    assert.equal(info.deviceName, 'Phone One');
    assert.equal(isConnected(), true);
    disconnectPhone();
  });

  it('gives up after GATT_CONNECT_ATTEMPTS consecutive initial connect failures and forgets the device', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], failConnectsCount: Infinity });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    const assertion = assert.rejects(() => connectPromise, /Couldn't connect|Connection Error/);
    await settleConnectRetry(t); // attempt 1 fails
    await settleConnectRetry(t); // attempt 2 fails
    await settleConnectRetry(t); // attempt 3 fails — gives up
    await assertion;

    assert.equal(isConnected(), false);
  });

  it('reconnects before retrying a DeviceInfo read even when device.gatt.connected never drops (avoids "GATT operation already in progress")', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    // The first DeviceInfo read fails (simulating connectAndVerify's own read timeout) while
    // device.gatt.connected is deliberately left true throughout — the exact condition that,
    // before this loop reconnected unconditionally on every retry, meant attempt 2 retried
    // readDeviceInfo() straight against the same still-open connection instead.
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], failDeviceInfoReadsCount: 1 });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before attempt 1's DeviceInfo read, which then fails
    await settleConnectRetry(t); // DEVICE_INFO_RETRY_DELAY_MS before attempt 2's reconnect
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before attempt 2's DeviceInfo read, which succeeds
    const info = await connectPromise;

    assert.equal(info.deviceName, 'Phone One');
    assert.equal(isConnected(), true);
    // 2 calls: the initial connect, plus one forced reconnect before the successful retry —
    // proves the loop reconnected even though device.gatt.connected never read false.
    assert.equal(device._connectCallCount, 2);
    disconnectPhone();
  });

  it('does not leave an unhandled rejection when the CONTROL write fails after the stream listener is already armed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], failWrite: true });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

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

  it('rejects a pull immediately when the connection drops while it is purely waiting on data, instead of waiting out the full pull timeout', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], neverRespondToWrites: true });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pullPromise = pullFromConnectedPhone();
    const rejectionAssertion = assert.rejects(() => pullPromise, /GATT Server is disconnected/);
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the CONTROL write, which "succeeds" but never streams anything back

    // The real disconnect landing here — mid-pull, purely waiting on incoming notifications with
    // no outbound GATT call left to reject on its own — is exactly the gap collectDataStream's
    // own 'gattserverdisconnected' listener now closes.
    device._simulateUnexpectedDisconnect();
    await rejectionAssertion; // no 15s timer tick needed — proves this didn't wait on PULL_TIMEOUT_MS
  });

  it('gives up on a stuck mid-pull DeviceInfo refresh after a bounded timeout, instead of hanging indefinitely', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    // The very first DeviceInfo read (during connectToPhone()) succeeds normally; every read
    // after that — i.e. pullFromConnectedPhone's own fresh-every-call refresh — hangs forever,
    // simulating a phone that's just gone out of range.
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], hangDeviceInfoReadsFrom: 2 });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pullPromise = pullFromConnectedPhone();
    const rejectionAssertion = assert.rejects(() => pullPromise, /Timed out refreshing DeviceInfo/);
    await flushMicrotasks();
    t.mock.timers.tick(5000); // DEVICE_INFO_READ_TIMEOUT_MS — the stuck refresh read must give up here, not hang forever
    // Aborts the whole pull rather than falling back to stale DeviceInfo and carrying on — a
    // refresh failing via this exact timeout means the connection is genuinely dead, not a
    // one-off glitch on an otherwise-healthy link (see this function's own doc for the field
    // evidence), so there's nothing worth attempting further legs for.
    await rejectionAssertion;

    // Tagged .isTimeout (see withTimeout's own doc) so mobile-files.js's own auto-pull loop can
    // abandon the connection immediately on exactly this failure, rather than needing several
    // more guaranteed `GATT operation already in progress` collisions with the still-stuck real
    // operation first — confirmed in the field as exactly that pattern before this tag existed.
    let caught = null;
    const pullPromise2 = pullFromConnectedPhone().catch(e => { caught = e; });
    await flushMicrotasks();
    t.mock.timers.tick(5000); // same stuck refresh, same timeout
    await pullPromise2;
    assert.equal(caught?.isTimeout, true);

    disconnectPhone();
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

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pullPromise = pullFromConnectedPhone();
    await settleOnePull(t); // relay-manifest fetch's own settle delay
    await settleOnePull(t); // the one relayed race's own settle delay (sequential, not concurrent)
    const results = await pullPromise;

    assert.equal(requestCount, 2); // manifest fetch + the one relayed race — no "own race" leg at all
    assert.equal(results.length, 1);
    assert.equal(results[0].raceLabel, 'relayed-race');
    assert.equal(results[0].deviceId, 'origin1');
    disconnectPhone();
  });

  it('reuses the cached relay manifest across pulls when relayCount is unchanged', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Mule', raceLabel: '', relayCount: 1 };
    const relayManifest = [{ originDeviceId: 'origin1', originRaceLabel: 'relayed-race', originDeviceName: 'Origin Phone' }];
    let manifestFetchCount = 0;
    let relayedPullCount = 0;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => {
        if (req.requestRelayManifest) { manifestFetchCount++; return relayManifest; }
        relayedPullCount++;
        return [];
      },
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pull1 = pullFromConnectedPhone();
    await settleOnePull(t); // manifest fetch
    await settleOnePull(t); // origin1's relayed pull
    await pull1;

    const pull2 = pullFromConnectedPhone();
    await settleOnePull(t); // origin1's relayed pull only — manifest reused from cache, no fetch
    await pull2;

    assert.equal(manifestFetchCount, 1); // NOT re-fetched on the second pull
    assert.equal(relayedPullCount, 2);   // but the per-origin delta pull still runs every time
    disconnectPhone();
  });

  it('re-fetches the relay manifest when relayCount changes between pulls', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Mule', raceLabel: '', relayCount: 1 };
    let manifest = [{ originDeviceId: 'origin1', originRaceLabel: 'relayed-race', originDeviceName: 'Origin Phone' }];
    let manifestFetchCount = 0;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => (req.requestRelayManifest ? (manifestFetchCount++, manifest) : []),
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pull1 = pullFromConnectedPhone();
    await settleOnePull(t); // manifest fetch
    await settleOnePull(t); // origin1's relayed pull
    await pull1;
    assert.equal(manifestFetchCount, 1);

    // Simulate a second device starting to relay through this phone between auto-pull ticks.
    deviceInfo.relayCount = 2;
    manifest = [
      { originDeviceId: 'origin1', originRaceLabel: 'relayed-race', originDeviceName: 'Origin Phone' },
      { originDeviceId: 'origin2', originRaceLabel: 'another-race', originDeviceName: 'Second Phone' },
    ];

    const pull2 = pullFromConnectedPhone();
    await settleOnePull(t); // manifest re-fetch — relayCount changed
    await settleOnePull(t); // origin1's relayed pull
    await settleOnePull(t); // origin2's relayed pull
    await pull2;

    assert.equal(manifestFetchCount, 2); // re-fetched because relayCount changed
    disconnectPhone();
  });

  it('re-fetches the relay manifest on a same-count membership swap when relayManifestVersion is reported', async (t) => {
    // The gap relayCount alone can't cover: one origin fully synced away at the same moment a
    // different one started relaying, leaving relayCount unchanged even though the actual
    // membership did. A phone build that reports relayManifestVersion (see
    // MuleGattProfile.DeviceInfo's own doc) bumps it on exactly this kind of change, letting the
    // cache correctly invalidate here where a relayCount-only comparison would have missed it.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Mule', raceLabel: '', relayCount: 1, relayManifestVersion: 1 };
    let manifest = [{ originDeviceId: 'origin1', originRaceLabel: 'relayed-race', originDeviceName: 'Origin Phone' }];
    let manifestFetchCount = 0;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => (req.requestRelayManifest ? (manifestFetchCount++, manifest) : []),
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pull1 = pullFromConnectedPhone();
    await settleOnePull(t); // manifest fetch
    await settleOnePull(t); // origin1's relayed pull
    const results1 = await pull1;
    assert.equal(manifestFetchCount, 1);
    assert.equal(results1[0].deviceId, 'origin1');

    // Same count (still 1), but origin1 has fully synced away and origin2 has taken its place —
    // exactly the swap a relayCount-only comparison can't see. The phone reports this via a
    // bumped relayManifestVersion.
    deviceInfo.relayManifestVersion = 2;
    manifest = [{ originDeviceId: 'origin2', originRaceLabel: 'another-race', originDeviceName: 'Second Phone' }];

    const pull2 = pullFromConnectedPhone();
    await settleOnePull(t); // manifest re-fetch — relayManifestVersion changed despite same count
    await settleOnePull(t); // origin2's relayed pull
    const results2 = await pull2;

    assert.equal(manifestFetchCount, 2); // re-fetched despite relayCount staying at 1
    assert.equal(results2[0].deviceId, 'origin2');
    disconnectPhone();
  });
});

describe('mule-ble.js:connectToPhone picker filter (Mule Mode only)', () => {
  const MULE_MODE_MARKER_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';

  it('filters requestDevice() to both the GATT service UUID and the Mule Mode marker UUID', async (t) => {
    // Fake timers needed for real reasons now, same as every other test in this file that
    // reaches connectToPhone(): GATT_CONNECT_SETTLE_MS is a genuine required delay before the
    // first DeviceInfo verification attempt (see settleConnectRetry's own call sites below), not
    // just cleanup for a dangling Promise.race timeout.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    let requestDeviceOptions = null;
    installNavigatorMock({
      bluetooth: { requestDevice: async (options) => { requestDeviceOptions = options; return device; } },
    });

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;
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
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const seen = [];
    onDisconnect(wasDeliberate => seen.push(wasDeliberate));

    disconnectPhone();
    assert.deepEqual(seen, [true]);

    // Reconnect, then simulate a genuinely unexpected drop — the earlier deliberate disconnect
    // must not still be "remembered" as making this one expected too.
    const _reconnect = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await _reconnect;
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
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const seen = [];
    onDisconnect(wasDeliberate => seen.push(wasDeliberate));
    device._simulateUnexpectedDisconnect();

    assert.deepEqual(seen, [false]);
  });
});

describe('mule-ble.js:forgetConnection no longer forgets on a mere unexpected drop — only a failed reconnect attempt does', () => {
  it('an unexpected drop (e.g. briefly out of range) leaves the device remembered', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']);

    // The overwhelmingly common "unexpected drop" in the field is a mule going briefly out of
    // Bluetooth range — routine, not evidence the remembered identity has gone stale. Forgetting
    // it here would force a full re-pick through the browser's slow native picker for something
    // that would very likely reconnect instantly via the known-device shortcut instead.
    device._simulateUnexpectedDisconnect();
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']);
  });

  it('a deliberate disconnectPhone() call also leaves the device remembered', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    disconnectPhone();
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']);
  });

  it('a reconnect attempt against a device that has actually gone stale still forgets it, once that attempt itself fails', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    // Connects fine the first time (so it becomes known), but every gatt.connect() call from the
    // 2nd onward fails outright — simulates the identity having genuinely gone stale (e.g. its
    // BLE address rotated) by the time a later reconnect is attempted.
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], failConnectsFrom: 2 });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    device._simulateUnexpectedDisconnect();
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']); // still remembered, per the test above

    const reconnectPromise = reconnectToKnownDevice(device);
    const rejectionAssertion = assert.rejects(() => reconnectPromise);
    await settleConnectRetry(t); // attempt 1 fails, delay before attempt 2
    await settleConnectRetry(t); // attempt 2 fails, delay before attempt 3
    await settleConnectRetry(t); // attempt 3 fails — gives up
    await rejectionAssertion;

    assert.deepEqual(await getKnownDevices(), []); // the connect-failure safety net forgot it
  });
});

describe('mule-ble.js:abandonConnection', () => {
  it('disconnects but leaves the device remembered — deliberately no automatic reconnect attempt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [] });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;
    assert.equal(isConnected(), true);

    abandonConnection();

    assert.equal(isConnected(), false);
    // No longer forgotten (see forgetConnection's own doc) — a persistently failing connection
    // is most often the same "mule briefly out of range" case as a plain unexpected drop, not
    // confirmation the remembered identity has gone stale.
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']);
  });

  it('is a safe no-op when nothing is connected', () => {
    assert.doesNotThrow(() => abandonConnection());
    assert.equal(isConnected(), false);
  });
});
