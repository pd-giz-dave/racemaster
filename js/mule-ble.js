'use strict';

// Web Bluetooth client for racemaster-mobile's "Mule Mode" BLE sync (see
// ~/racemaster-mobile's MuleGattProfile.kt) — every racemaster-mobile phone runs a GATT
// peripheral advertising this same service so another phone (a "Mule") can pull its history
// with no network involved. This lets the RaceMaster web app act as that Mule directly, for
// use in the field with no internet access at all.
//
// Requires a secure context (HTTPS, or http://localhost) and a browser that supports Web
// Bluetooth (desktop Chrome/Edge, Android Chrome — not Firefox or Safari/iOS).

const SERVICE_UUID          = '6d6f6269-6c65-2e72-6163-656d61737465';
const DEVICE_INFO_CHAR_UUID = '6d6f6269-6c65-2e72-6163-000000000001';
const CONTROL_CHAR_UUID     = '6d6f6269-6c65-2e72-6163-000000000002';
const DATA_CHAR_UUID        = '6d6f6269-6c65-2e72-6163-000000000003';
const ACK_CHAR_UUID         = '6d6f6269-6c65-2e72-6163-000000000004';

const PULL_TIMEOUT_MS = 15000;
// Gives the peripheral's CCCD subscription time to land before it starts streaming —
// racemaster-mobile's own MulePullClient waits the same way before writing its PullRequest.
const NOTIFY_SETTLE_MS = 300;

export function isBluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

// ---- Connection state ----
//
// Kept alive across a connect click and one or more pulls, rather than connect-pull-
// disconnect in one shot, so the UI can show "Disconnect from <device>" while connected and
// let the user explicitly end the session.

let connectedDevice = null; // BluetoothDevice
let connectedInfo   = null; // last-read DeviceInfo
let disconnectListener = null;

export function isConnected() {
  return !!connectedDevice?.gatt?.connected;
}

export function getConnectedDeviceName() {
  return connectedInfo ? (connectedInfo.deviceName || connectedInfo.deviceId) : null;
}

// Registers a callback fired whenever the connection ends, whether from disconnectPhone()
// below or the phone dropping out of range/turning off — the one true place the UI needs to
// revert its "Disconnect from X" button back to "Connect to Phone…".
export function onDisconnect(callback) {
  disconnectListener = callback;
}

function forgetConnection() {
  connectedDevice = null;
  connectedInfo = null;
  disconnectListener?.();
}

export function disconnectPhone() {
  connectedDevice?.gatt?.disconnect(); // triggers 'gattserverdisconnected' → forgetConnection()
}

function encodeJson(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function decodeJson(dataView) {
  return JSON.parse(new TextDecoder('utf-8').decode(dataView));
}

// "yyyy/MM/dd HH:mm:ss" — the same format racemaster-mobile's own HTTP sync path formats
// timestamps as (MuleSyncClient.kt) before sending, so a BLE pull is stored identically to a
// WiFi one. Uses the browser's local timezone, since a raw epoch value carries none of its
// own — fine in practice since the puller and the phone are at the same event.
function formatTimestamp(epochMillis) {
  const d = new Date(epochMillis);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// SyncRecord (BLE wire shape, raw epoch timestampMillis) → the same shape server.js stores
// (timestamp, a pre-formatted string) — see server.js's coerce() for the server-side twin.
function toStoredLine(r) {
  return {
    recordUuid: r.recordUuid,
    action: r.action,
    bibNumber: r.bibNumber ?? null,
    splitTime: r.splitTime ?? null,
    location: r.location,
    splitNumber: r.splitNumber ?? null,
    lineNumber: r.lineNumber,
    refLineNumber: r.refLineNumber ?? null,
    note: r.note ?? null,
    timestamp: formatTimestamp(r.timestampMillis),
  };
}

// Reassembles a chunked SyncRecord[] stream: notifications arrive in order and are
// concatenated until a single 0x00 byte marks the end (see MuleGattProfile.kt's class doc).
function collectDataStream(dataChar) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      dataChar.removeEventListener('characteristicvaluechanged', onValue);
      reject(new Error('Timed out waiting for data from the phone.'));
    }, PULL_TIMEOUT_MS);

    function onValue(event) {
      const value = event.target.value; // DataView
      if (value.byteLength === 1 && value.getUint8(0) === 0) {
        clearTimeout(timer);
        dataChar.removeEventListener('characteristicvaluechanged', onValue);
        const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let offset = 0;
        for (const c of chunks) { total.set(c, offset); offset += c.length; }
        try {
          const text = new TextDecoder('utf-8').decode(total);
          resolve(text ? JSON.parse(text) : []);
        } catch (e) { reject(e); }
        return;
      }
      chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    dataChar.addEventListener('characteristicvaluechanged', onValue);
  });
}

async function pullOne(service, pullRequest) {
  const dataChar    = await service.getCharacteristic(DATA_CHAR_UUID);
  const controlChar = await service.getCharacteristic(CONTROL_CHAR_UUID);
  const streamPromise = collectDataStream(dataChar);
  await dataChar.startNotifications();
  await new Promise(r => setTimeout(r, NOTIFY_SETTLE_MS));
  await controlChar.writeValueWithResponse(encodeJson(pullRequest));
  try {
    const records = await streamPromise;
    return records.map(toStoredLine);
  } finally {
    try { await dataChar.stopNotifications(); } catch { /* connection may already be gone */ }
  }
}

// Opens the browser's device picker for a nearby phone advertising racemaster-mobile's Mule
// Mode service, connects, and reads its DeviceInfo — leaving the connection open (see
// disconnectPhone()/onDisconnect() above) rather than pulling and disconnecting in one shot.
// No pairing/bonding is required by this protocol. Returns the DeviceInfo read at connect
// time, so the caller can echo the phone's own name back for confirmation before doing
// anything else with it — the browser's own picker can't show one (see PeripheralSyncService:
// the advertisement deliberately omits the device name, only the service UUID is in it), so
// with several Bluetooth devices nearby it's otherwise a guess which one to pick.
//
// The requestDevice() filter already restricts the picker to devices advertising our service
// UUID, but that's an advertisement-layer claim, not a guarantee — reading DeviceInfo here is
// what actually confirms this is a genuine RaceMaster Mobile peripheral; anything that fails
// that gets disconnected immediately and rejected with a clear reason rather than a raw
// browser exception.
export async function connectToPhone() {
  if (!isBluetoothAvailable()) {
    throw new Error('Web Bluetooth is not available — use Chrome or Edge over HTTPS (or localhost).');
  }

  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
  const server = await device.gatt.connect();

  let deviceInfo = null;
  try {
    const service  = await server.getPrimaryService(SERVICE_UUID);
    const infoChar = await service.getCharacteristic(DEVICE_INFO_CHAR_UUID);
    deviceInfo = decodeJson(await infoChar.readValue());
  } catch {
    deviceInfo = null; // GATT lookup/read failed — treated the same as a malformed payload below
  }

  if (!deviceInfo || typeof deviceInfo.raceLabel !== 'string') {
    device.gatt.disconnect();
    throw new Error(`"${device.name || 'That device'}" doesn't appear to be running RaceMaster Mobile — pick a different device.`);
  }

  connectedDevice = device;
  connectedInfo = deviceInfo;
  device.addEventListener('gattserverdisconnected', forgetConnection);

  return deviceInfo;
}

// Pulls the currently-connected phone's own race history plus anything it's relaying on
// behalf of other devices (see DeviceInfo.relayEntries — a mule-to-mule chain), and returns
// one entry per origin device: { raceLabel, deviceName, lines }[]. Does not disconnect
// afterward — call disconnectPhone() explicitly once done.
export async function pullFromConnectedPhone() {
  if (!isConnected()) throw new Error('Not connected to a phone.');
  const service = await connectedDevice.gatt.getPrimaryService(SERVICE_UUID);
  const deviceInfo = connectedInfo;

  const results = [];
  const ownLines = await pullOne(service, { sinceLineNumber: 0 });
  results.push({ raceLabel: deviceInfo.raceLabel, deviceName: deviceInfo.deviceName || deviceInfo.deviceId, lines: ownLines });

  for (const relay of deviceInfo.relayEntries || []) {
    const lines = await pullOne(service, {
      sinceLineNumber: 0,
      originDeviceId: relay.originDeviceId,
      originRaceLabel: relay.originRaceLabel,
    });
    results.push({ raceLabel: relay.originRaceLabel, deviceName: relay.originDeviceName || relay.originDeviceId, lines });
  }

  // Best-effort ack, so the phone's own UI can show these lines as synced — not required
  // for the pull itself to have succeeded, so a failure here is never fatal. isSink: true is
  // what turns that into a genuine green "reached a sink" confirmation rather than just an
  // intermediate orange "relayed to somebody" one (see AckPayload's own doc in
  // ~/racemaster-mobile's MuleGattProfile.kt) — this connection's whole purpose is bringing
  // data home to the racemaster server, so it always identifies as a sink.
  try {
    const ackChar = await service.getCharacteristic(ACK_CHAR_UUID);
    await ackChar.writeValueWithResponse(encodeJson({
      deviceId: 'racemaster-web',
      recordUuids: results.flatMap(r => r.lines.map(l => l.recordUuid)),
      deviceName: 'RaceMaster (web)',
      isSink: true,
    }));
  } catch { /* non-fatal */ }

  return results;
}