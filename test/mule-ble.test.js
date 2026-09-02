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
  getRaceStaleAfterDays, setRaceStaleAfterDays,
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

describe('mule-ble.js:getRaceStaleAfterDays / setRaceStaleAfterDays', () => {
  it('defaults to 2 days (matching racemaster-mobile) and round-trips through localStorage', () => {
    assert.equal(getRaceStaleAfterDays(), 2);
    setRaceStaleAfterDays(5);
    assert.equal(getRaceStaleAfterDays(), 5);
    setRaceStaleAfterDays(1);
    assert.equal(getRaceStaleAfterDays(), 1);
  });

  it('falls back to the default for a corrupt/invalid stored value rather than throwing', () => {
    localStorage.setItem('racemaster-race-stale-after-days', 'not-a-number');
    assert.equal(getRaceStaleAfterDays(), 2);
    localStorage.setItem('racemaster-race-stale-after-days', '0');
    assert.equal(getRaceStaleAfterDays(), 2);
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
// stream back for that specific request. Every other failure/latency knob lives under the single
// [faults] object below, all optional — a test passes only the ones it needs:
//
//   connectsFrom (default: never) — makes the Nth-and-every-later gatt.connect() call reject
//     instead of succeeding. The 1-indexed call count includes the very first connect, so
//     connectsFrom: 2 means "connects fine once, then every reconnect after that fails".
//   connectsCount (default: 0) — makes exactly the first N gatt.connect() calls reject with a
//     transient-looking error before every call after that succeeds normally — simulates the
//     real, field-confirmed `NetworkError: Connection Error: Connection attempt failed.`
//     connectAndVerify's own GATT_CONNECT_ATTEMPTS retry loop exists to recover from, as distinct
//     from connectsFrom's permanent failure.
//   write (default: false) — makes the CONTROL write itself reject every time — simulates the
//     connection dropping between a pull starting and its write landing.
//   writeCount (default: 0) — makes exactly the first N CONTROL writes reject with the real,
//     field-confirmed `NotSupportedError: GATT operation failed for unknown reason` before every
//     write after that succeeds normally — simulates a leg's own pull colliding with a still
//     in-flight prior GATT operation (e.g. one that just genuinely timed out), the scenario
//     pullFromConnectedPhone's own withGattRecovery exists to recover from, as distinct from
//     write's permanent failure.
//   dropAfterConnect (default: never) — fires a real 'gattserverdisconnected' event synchronously
//     right after the Nth gatt.connect() call succeeds — simulates a flaky link dropping again
//     immediately mid-attempt.
//   deviceInfoReadsCount (default: 0) — makes exactly the first N DeviceInfo characteristic reads
//     reject, with device.gatt.connected deliberately left reading true throughout (unlike
//     dropAfterConnect) — simulates connectAndVerify's own DEVICE_INFO_READ_TIMEOUT_MS giving up
//     on a read that's still genuinely in flight underneath, the scenario its retry loop must
//     reconnect before retrying rather than reusing the same still-busy connection.
//   neverRespondToWrites (default: false) — makes the CONTROL write itself resolve normally
//     (unlike write) but never queue the matching data-stream response — simulates a pull that's
//     genuinely in flight, purely waiting on incoming notifications, when the connection then
//     drops for real (see _simulateUnexpectedDisconnect).
//   hangDeviceInfoReadsFrom (default: never) — makes the Nth-and-every-later DeviceInfo
//     characteristic read return a promise that never settles at all, rather than rejecting —
//     simulates a real GATT call against a phone that's just gone out of range, which has no
//     spec-guaranteed timeout of its own and was observed hanging indefinitely before callers
//     raced it against one.
//   deviceInfoReadAt (default: none) — makes exactly the Nth DeviceInfo characteristic read
//     (1-indexed, counting connectToPhone()'s own initial read too) reject instantly with that
//     same real, field-confirmed collision error — every other read, including the very next
//     retry, succeeds normally. Distinct from deviceInfoReadsCount (which fails a run of leading
//     reads with a *timeout*-flavoured message and is only ever exercised during
//     connectAndVerify) and from hangDeviceInfoReadsFrom (which never settles at all) — this
//     simulates the same instant collision writeCount does, but on pullFromConnectedPhone's own
//     top-of-tick getPrimaryService/DeviceInfo-refresh calls specifically (2026-09-02 field
//     evidence), the scenario those calls' own withGattRecovery wrapping exists to recover from.
function makeFakePhone({ deviceInfo, recordsByRequest, faults = {} }) {
  const {
    connectsFrom = Infinity, connectsCount = 0, write = false, writeCount = 0,
    dropAfterConnect = null, deviceInfoReadsCount = 0, neverRespondToWrites = false,
    hangDeviceInfoReadsFrom = Infinity, deviceInfoReadAt = null,
  } = faults;
  const dataChar = makeFakeDataChar();
  let writeCallCount = 0;
  const controlChar = {
    writeValueWithResponse: async (bytes) => {
      writeCallCount++;
      if (write) throw new Error('GATT Server is disconnected. Cannot perform GATT operations.');
      if (writeCallCount <= writeCount) throw new Error('GATT operation failed for unknown reason.');
      if (neverRespondToWrites) return;
      const req = JSON.parse(new TextDecoder().decode(bytes));
      queueMicrotask(() => dataChar.emitRecords(recordsByRequest(req)));
    },
  };
  let infoReadCallCount = 0;
  const infoChar = {
    readValue: async () => {
      infoReadCallCount++;
      if (infoReadCallCount === deviceInfoReadAt) throw new Error('GATT operation failed for unknown reason.');
      if (infoReadCallCount >= hangDeviceInfoReadsFrom) return new Promise(() => {}); // never settles
      if (infoReadCallCount <= deviceInfoReadsCount) throw new Error(`Timed out reading DeviceInfo from "that device".`);
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
        if (connectCallCount <= connectsCount) throw new Error('Connection Error: Connection attempt failed.');
        if (connectCallCount >= connectsFrom) throw new Error('out of range');
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
// next pending — DEVICE_INFO_RETRY_DELAY_MS between retried DeviceInfo reads (see makeFakePhone's
// failDeviceInfoReadsCount), or GATT_CONNECT_SETTLE_MS before every DeviceInfo verification
// attempt — and lets the resulting promise chain drain. GATT_CONNECT_SETTLE_MS is the larger of
// the two (2000ms); 2200ms comfortably clears either without needing this test file to import
// (and hardcode a duplicate of) the real, unexported constants. NOT sized for
// RECONNECT_COOLDOWN_MS — see settleReconnectCooldown() below for that, now used between every
// retried gatt.connect() attempt too (connectAndVerify no longer uses a flat, short delay there).
async function settleConnectRetry(t) {
  await flushMicrotasks();
  t.mock.timers.tick(2200);
  await flushMicrotasks();
}

// Advances the fake clock past a RECONNECT_COOLDOWN_MS wait — waitOutReconnectCooldown() checks
// real elapsed time since the device's own last disconnect (or failed connect attempt — see
// connectAndVerify's own doc), so this is needed wherever a test's device disconnected or failed
// to connect too recently for the gate to already be satisfied: reconnectToKnownDevice()'s own
// first attempt, connectAndVerify's outer GATT_CONNECT_ATTEMPTS retry loop between connect
// attempts, or its inner DEVICE_INFO_ATTEMPTS retry loop forcing its own reconnect between
// attempts (see all their own docs). 10_200ms comfortably clears the real 10_000ms constant
// without this test file hardcoding a duplicate of it.
async function settleReconnectCooldown(t) {
  await flushMicrotasks();
  t.mock.timers.tick(10_200);
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
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], faults: { connectsCount: 2 } });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    await settleReconnectCooldown(t); // attempt 1 fails, RECONNECT_COOLDOWN_MS before attempt 2
    await settleReconnectCooldown(t); // attempt 2 fails, RECONNECT_COOLDOWN_MS before attempt 3
    await settleConnectRetry(t); // attempt 3 succeeds; GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    const info = await connectPromise;

    assert.equal(info.deviceName, 'Phone One');
    assert.equal(isConnected(), true);
    disconnectPhone();
  });

  it('gives up after GATT_CONNECT_ATTEMPTS consecutive initial connect failures and forgets the device', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], faults: { connectsCount: Infinity } });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    const assertion = assert.rejects(() => connectPromise, /Couldn't connect|Connection Error/);
    await settleReconnectCooldown(t); // attempt 1 fails, RECONNECT_COOLDOWN_MS before attempt 2
    await settleReconnectCooldown(t); // attempt 2 fails, RECONNECT_COOLDOWN_MS before attempt 3
    await settleConnectRetry(t); // attempt 3 fails — gives up, no further wait scheduled
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
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], faults: { deviceInfoReadsCount: 1 } });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before attempt 1's DeviceInfo read, which then fails
    await settleConnectRetry(t); // DEVICE_INFO_RETRY_DELAY_MS before attempt 2's forced reconnect
    await settleReconnectCooldown(t); // RECONNECT_COOLDOWN_MS before that reconnect's own gatt.connect()
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
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], faults: { write: true } });
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
      // The write's failure now triggers withGattRecovery's own one-shot reconnect-and-retry (see
      // its own doc) before this ultimately rejects the same way it always did — failWrite makes
      // every write fail identically, so the retry's own write fails too, but only after a full
      // reconnect cycle's worth of waits.
      await settleReconnectCooldown(t); // RECONNECT_COOLDOWN_MS before withGattRecovery's own reconnect attempt
      await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS after that reconnect succeeds
      await settleOnePull(t); // NOTIFY_SETTLE_MS before the retry's own (also failing) CONTROL write
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
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], faults: { neverRespondToWrites: true } });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pullPromise = pullFromConnectedPhone();
    const rejectionAssertion = assert.rejects(() => pullPromise, /GATT Server is disconnected/);
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the CONTROL write, which "succeeds" but never streams anything back

    // The real disconnect landing here — mid-pull, purely waiting on incoming notifications with
    // no outbound GATT call left to reject on its own — is exactly the gap collectDataStream's
    // own 'gattserverdisconnected' listener now closes. No 15s PULL_TIMEOUT_MS tick needed to
    // notice it either way (rejects synchronously off the disconnect event itself).
    device._simulateUnexpectedDisconnect();
    // That rejection now feeds withGattRecovery's own one-shot reconnect-and-retry (see its own
    // doc) rather than failing the whole pull outright — neverRespondToWrites means the retry's
    // own write also never streams anything back, so a second disconnect here proves the fast,
    // no-15s-wait detection still holds even through a recovery retry, not just the first attempt.
    await settleReconnectCooldown(t); // RECONNECT_COOLDOWN_MS before withGattRecovery's own reconnect attempt
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS after that reconnect succeeds
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the retry's own CONTROL write
    device._simulateUnexpectedDisconnect();
    await rejectionAssertion;
  });

  it('gives up on a stuck mid-pull DeviceInfo refresh after a bounded timeout, instead of hanging indefinitely', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    // The very first DeviceInfo read (during connectToPhone()) succeeds normally; every read
    // after that — i.e. pullFromConnectedPhone's own fresh-every-call refresh — hangs forever,
    // simulating a phone that's just gone out of range.
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], faults: { hangDeviceInfoReadsFrom: 2 } });
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

  // "…-YY-MM-DD" today's date — guaranteed never stale regardless of when this test itself runs,
  // same trailing-date convention every raceLabel in this protocol uses (see raceLabelAgeDays's
  // own doc in mule-ble.js).
  function todayRaceLabelSuffix() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  it("never skips its own race for staleness, no matter how old its label is (multi-day events keep syncing)", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    setRaceStaleAfterDays(2);
    // 2020-01-01 — many years stale under any sane threshold, exactly what a multi-day event's
    // own label looks like on day 3+: created once, never changes, while still actively
    // recording. deviceInfo.raceLabel being reported at all must be enough on its own — see
    // isRaceLabelStale's own doc — regardless of age or lastLineNumber.
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race-20-01-01', relayCount: 0, lastLineNumber: 3 };
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: () => [{ recordUuid: 'r1', action: 'Finish', bibNumber: 2, lineNumber: 1, timestampMillis: 1_700_000_000_000 }],
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pullPromise = pullFromConnectedPhone();
    await settleOnePull(t);
    const results = await pullPromise;

    assert.equal(results.length, 1);
    assert.equal(results[0].raceLabel, 'test-race-20-01-01');
    disconnectPhone();
  });

  it('skips a stale relayed race but still pulls a fresh one from the same manifest', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    setRaceStaleAfterDays(2);
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Mule', raceLabel: '', relayCount: 2 };
    const relayManifest = [
      { originDeviceId: 'stale-origin', originRaceLabel: 'old-race-20-01-01', originDeviceName: 'Stale Phone' },
      { originDeviceId: 'fresh-origin', originRaceLabel: `fresh-race-${todayRaceLabelSuffix()}`, originDeviceName: 'Fresh Phone' },
    ];
    let pullRequestCount = 0;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => {
        if (req.requestRelayManifest) return relayManifest;
        pullRequestCount++;
        return [{ recordUuid: 'r1', action: 'Finish', bibNumber: 2, lineNumber: 1, timestampMillis: 1_700_000_000_000 }];
      },
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pullPromise = pullFromConnectedPhone();
    await settleOnePull(t); // relay-manifest fetch's own settle delay
    await settleOnePull(t); // the one non-stale relayed race's own settle delay
    const results = await pullPromise;

    assert.equal(pullRequestCount, 1); // only the fresh race was ever actually requested
    assert.equal(results.length, 1);
    assert.equal(results[0].raceLabel, `fresh-race-${todayRaceLabelSuffix()}`);
    assert.equal(results[0].deviceId, 'fresh-origin');
    disconnectPhone();
  });

  it('does not skip an old-labelled relayed race that is still actively being recorded (multi-day event)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    setRaceStaleAfterDays(2);
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Mule', raceLabel: '', relayCount: 1 };
    // Old label (day 1 of a multi-day event), but lastLineNumber ahead of anything we've pulled
    // so far — real, wire-reported proof it's still being recorded, which date alone can't tell
    // apart from a genuinely abandoned old race (see isRaceLabelStale's own doc).
    const relayManifest = [
      { originDeviceId: 'multiday-origin', originRaceLabel: 'stage-race-20-01-01', originDeviceName: 'Multi-day Phone', lastLineNumber: 5 },
    ];
    let pullRequestCount = 0;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => {
        if (req.requestRelayManifest) return relayManifest;
        pullRequestCount++;
        return [{ recordUuid: 'r1', action: 'Finish', bibNumber: 3, lineNumber: 5, timestampMillis: 1_700_000_000_000 }];
      },
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });

    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    const pullPromise = pullFromConnectedPhone();
    await settleOnePull(t); // relay-manifest fetch's own settle delay
    await settleOnePull(t); // the relayed race's own settle delay
    const results = await pullPromise;

    assert.equal(pullRequestCount, 1); // pulled despite the old label — lastLineNumber proved it's still active
    assert.equal(results.length, 1);
    assert.equal(results[0].raceLabel, 'stage-race-20-01-01');
    disconnectPhone();
  });

  it("recovers a leg's pull that collides with a still-stuck prior GATT operation by reconnecting once, rather than failing the whole pull", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    // First CONTROL write fails instantly with the real, field-confirmed generic GATT error a
    // still-in-flight prior operation leaves behind (2026-09-02) — the second (the retry, after
    // withGattRecovery's own reconnect) succeeds normally.
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [{ recordUuid: 'r1', action: 'Finish', bibNumber: 4, lineNumber: 1, timestampMillis: 1_700_000_000_000 }], faults: { writeCount: 1 } });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;
    const connectCallCountBeforePull = device._connectCallCount;

    const pullPromise = pullFromConnectedPhone();
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the first (failing) CONTROL write
    await settleReconnectCooldown(t); // RECONNECT_COOLDOWN_MS before withGattRecovery's own reconnect attempt
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS after that reconnect succeeds
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the retry's own (successful) CONTROL write
    const results = await pullPromise; // resolves, not rejects — the recovery salvaged this leg

    assert.equal(results.length, 1);
    assert.equal(results[0].lines.length, 1);
    // Proves a real reconnect actually happened, not just a lucky second attempt on the same link.
    assert.equal(device._connectCallCount, connectCallCountBeforePull + 1);
    disconnectPhone();
  });

  it('recovers a pull whose own top-of-tick DeviceInfo refresh collides with a still-stuck prior GATT operation, rather than failing the whole tick', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 0 };
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: () => [{ recordUuid: 'r1', action: 'Finish', bibNumber: 4, lineNumber: 1, timestampMillis: 1_700_000_000_000 }],
      // Read #1 is connectToPhone()'s own initial verification and must succeed; read #2 is
      // pullFromConnectedPhone()'s own top-of-tick refresh — the exact call the 2026-09-02 field
      // log's "pull failed ... could not refresh DeviceInfo ... GATT operation failed for unknown
      // reason" was drawn from — and fails instantly, once.
      faults: { deviceInfoReadAt: 2 },
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;
    const connectCallCountBeforePull = device._connectCallCount;

    const pullPromise = pullFromConnectedPhone();
    await settleReconnectCooldown(t); // RECONNECT_COOLDOWN_MS before withGattRecovery's own reconnect attempt
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS after that reconnect succeeds
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the retry's own (successful) CONTROL write
    const results = await pullPromise; // resolves, not rejects — the recovery salvaged the whole tick

    assert.equal(results.length, 1);
    assert.equal(results[0].lines.length, 1);
    // Proves a real reconnect actually happened, not just a lucky second attempt on the same link.
    assert.equal(device._connectCallCount, connectCallCountBeforePull + 1);
    disconnectPhone();
  });

  it("tells the disconnect listener and abandons the rest of the tick once a leg's own recovery reconnect itself fails, instead of leaving the session silently orphaned", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const deviceInfo = { deviceId: 'dev1', deviceName: 'Phone One', raceLabel: 'test-race', relayCount: 1 };
    let recordsRequested = 0;
    const device = makeFakePhone({
      deviceInfo,
      recordsByRequest: (req) => { recordsRequested++; return []; },
      // The own-race leg's first CONTROL write collides and fails instantly, same as every
      // other withGattRecovery test above — but this time the recovery's own reconnect attempt
      // (gatt.connect() call #2, right after the one during connectToPhone() itself) fails too,
      // simulating the connection actually being gone rather than one operation merely stuck.
      faults: { writeCount: 1, connectsFrom: 2 },
    });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    // 2026-09-02 field evidence: forgetConnection()'s own disconnectListener call for the
    // recovery's own disconnect is suppressed (isRecoveringGattOperation — see its own doc) on
    // the expectation the reconnect below would shortly succeed. Without withGattRecovery's own
    // failure path notifying this listener a second time once that reconnect itself fails,
    // mobile-files.js's onBleDisconnected never runs — no stopAutoPull(), no UI reset, nothing —
    // and connectedDevice stays null forever with every later auto-pull tick silently no-oping.
    const seen = [];
    onDisconnect(wasDeliberate => seen.push(wasDeliberate));

    const pullPromise = pullFromConnectedPhone();
    const rejectionAssertion = assert.rejects(() => pullPromise);
    await settleOnePull(t); // NOTIFY_SETTLE_MS before the (failing) CONTROL write
    // The recovery's own reconnect attempt rejects near-instantly here (a real error, not a
    // timeout), so RECONNECT_COOLDOWN_MS is the only wait needed — no further
    // GATT_RECONNECT_TIMEOUT_MS tick on top.
    await settleReconnectCooldown(t);
    await rejectionAssertion;

    assert.equal(isConnected(), false);
    // The mid-recovery disconnect (suppressed at the time) followed by this new "the recovery
    // itself failed" notification — in that order, wasDeliberate: false for the second since
    // nothing about the connection actually ending here was anything the operator did.
    assert.deepEqual(seen, [true, false]);
    // The relay manifest fetch — let alone the relay leg itself — must never even be attempted
    // once the connection's confirmed dead; every remaining GATT call this tick would be doomed
    // too (see connectionLost's own doc).
    assert.equal(recordsRequested, 0);
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
    const device = makeFakePhone({ deviceInfo, recordsByRequest: () => [], faults: { connectsFrom: 2 } });
    installNavigatorMock({ bluetooth: { requestDevice: async () => device, getDevices: async () => [device] } });
    const connectPromise = connectToPhone();
    await settleConnectRetry(t); // GATT_CONNECT_SETTLE_MS before the first DeviceInfo verification attempt
    await connectPromise;

    device._simulateUnexpectedDisconnect();
    assert.deepEqual((await getKnownDevices()).map(k => k.name), ['Phone One']); // still remembered, per the test above

    const reconnectPromise = reconnectToKnownDevice(device);
    const rejectionAssertion = assert.rejects(() => reconnectPromise);
    await settleReconnectCooldown(t); // RECONNECT_COOLDOWN_MS before the first connect attempt even starts
    await settleReconnectCooldown(t); // attempt 1 fails, RECONNECT_COOLDOWN_MS before attempt 2
    await settleReconnectCooldown(t); // attempt 2 fails, RECONNECT_COOLDOWN_MS before attempt 3
    await settleConnectRetry(t); // attempt 3 fails — gives up, no further wait scheduled
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
