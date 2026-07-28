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

// Mirrors server.js's own sanitiseName() exactly. A phone reports its raceLabel/deviceName
// as free text (whatever the operator typed) — server.js re-sanitises whatever it receives on
// every push regardless, so the race/device this pull is about must be identified the same way
// here too, or a race already known from the server (already sanitised) and the same race just
// pulled fresh over Bluetooth (still raw) look like two different races in Mobile Files.
function sanitiseName(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64).toLowerCase();
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

// ---- Delta-sync bookkeeping ----
//
// racemaster-mobile's own phone-to-phone Mule pulls only ever request the delta since
// whatever lineNumber they last successfully retrieved (MuleRepository.lastPulledLineNumber)
// — this web client used to always request sinceLineNumber: 0 (full history) on every single
// pull, including every ~10s auto-pull tick, re-transferring everything all over again forever
// instead of just what's new. Persisted (not just in-memory) so reconnecting to the same phone
// later, even after a page reload, still resumes from where it left off rather than starting
// over — keyed by deviceId (stable across a rename) + raceLabel, since a relayed race's own
// deviceId/raceLabel is what's actually being pulled, not whichever Mule happens to be relaying
// it right now.

const LAST_PULLED_KEY = 'racemaster-ble-last-pulled';

function loadLastPulled() {
  try { return JSON.parse(localStorage.getItem(LAST_PULLED_KEY) || '{}'); } catch { return {}; }
}

function lastPulledMapKey(deviceId, raceLabel) { return `${deviceId} ${raceLabel}`; }

function getLastPulledLineNumber(deviceId, raceLabel) {
  return loadLastPulled()[lastPulledMapKey(deviceId, raceLabel)] || 0;
}

// Only ever moves forward — a partially-retried or out-of-order ack callback must never rewind
// the cursor and cause already-seen lines to be re-requested (and re-pushed/re-queued) again.
function advanceLastPulledLineNumber(deviceId, raceLabel, lines) {
  const highest = lines.reduce((max, l) => Math.max(max, l.lineNumber ?? 0), 0);
  if (highest <= 0) return;
  const map = loadLastPulled();
  const key = lastPulledMapKey(deviceId, raceLabel);
  if (highest > (map[key] || 0)) {
    map[key] = highest;
    localStorage.setItem(LAST_PULLED_KEY, JSON.stringify(map));
  }
}

// Forgets this source's delta cursor, so its *next* pull starts from sinceLineNumber: 0 again
// instead of only the delta since whatever was last retrieved — needed when a locally-pulled
// (not yet pushed) copy is discarded, since without this the cursor stays advanced from the
// pull that produced the very copy just thrown away, and a subsequent pull would only fetch
// what's new since then rather than the whole file again.
export function resetLastPulledLineNumber(deviceId, raceLabel) {
  const map = loadLastPulled();
  const key = lastPulledMapKey(deviceId, raceLabel);
  if (!(key in map)) return;
  delete map[key];
  localStorage.setItem(LAST_PULLED_KEY, JSON.stringify(map));
}

// Backward-compat fallback for a pending file saved before deviceId was tracked alongside it
// at all (any entry from before this cursor-reset feature existed) — there's no way to target
// just its own cursor without a true deviceId to key on, so this conservatively clears every
// cursor instead of leaving a pre-existing entry's stale advance silently un-resettable
// forever. Self-limiting: every entry saved from here on carries its own deviceId, so this
// only ever fires for genuinely stale, already-pre-existing data.
export function resetAllLastPulledLineNumbers() {
  localStorage.removeItem(LAST_PULLED_KEY);
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
// A timeout here — nothing ever arrives, not even the end marker — is what a phone with no
// currently-active race looks like from this side: PeripheralSyncService.streamRecords()
// bails out with a bare `return` (no response sent at all, not even an empty stream) whenever
// its own servingState.raceId is null, which happens whenever the operator has backed out to
// the mode picker/home screen, even if that race's history is still sitting in its database.
// Logged plainly (not hidden behind a debug flag) since this is exactly the trail needed to
// tell "phone sent nothing at all" apart from "sent some chunks then stalled" apart from "sent
// everything fine" the next time a pull silently comes back empty — each of those points at a
// different layer (phone has no active race / a mid-transfer BLE drop / a client-side parsing
// bug) and this is the only place that distinction is visible from.
function collectDataStream(dataChar) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let chunkCount = 0;
    const timer = setTimeout(() => {
      dataChar.removeEventListener('characteristicvaluechanged', onValue);
      const gotBytes = chunks.reduce((n, c) => n + c.length, 0);
      console.error(`[mule-ble] pull timed out after ${PULL_TIMEOUT_MS}ms — received ${chunkCount} chunk(s), ${gotBytes} byte(s) before giving up`);
      reject(new Error('No data arrived from the phone — it may not have a race currently open (Bluetooth sync only serves an active race), or may have gone out of range.'));
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
          const records = text ? JSON.parse(text) : [];
          console.log(`[mule-ble] pull complete — ${chunkCount} chunk(s), ${total.length} byte(s), ${records.length} record(s)`);
          resolve(records);
        } catch (e) { reject(e); }
        return;
      }
      chunkCount++;
      chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    dataChar.addEventListener('characteristicvaluechanged', onValue);
  });
}

// Kept deliberately small per write — unlike the DATA characteristic's notifications (which
// *have* to be chunked, since a GATT notification is hard-capped at the negotiated MTU with no
// protocol-level fallback), a write can in principle carry more via the stack's own queued/
// long-write support, but that's exactly the kind of stack-dependent behavior this shouldn't
// gamble on: Android's GATT server calls sendResponse(GATT_SUCCESS) unconditionally in
// onCharacteristicWriteRequest, whether or not the JSON actually decoded on its end (see
// PeripheralSyncService.kt) — a write that's silently too large for the link to carry reliably
// would report success here and simply never mark anything synced, with no error anywhere to
// see. The phone treats every separate ack write as its own complete, independent AckPayload,
// so sending several small ones is fully protocol-compatible, not a hack.
const ACK_BATCH_SIZE = 10;

async function sendSinkAck(service, recordUuids) {
  const ackChar = await service.getCharacteristic(ACK_CHAR_UUID);
  for (let i = 0; i < recordUuids.length; i += ACK_BATCH_SIZE) {
    const batch = recordUuids.slice(i, i + ACK_BATCH_SIZE);
    try {
      await ackChar.writeValueWithResponse(encodeJson({
        deviceId: 'racemaster-web',
        recordUuids: batch,
        deviceName: 'RaceMaster (web)',
        isSink: true,
      }));
      console.log(`[mule-ble] sent sink ack for ${batch.length} record(s)`);
    } catch (e) {
      // Previously swallowed with zero logging — non-fatal to the pull itself (the caller
      // already has the data either way), but a silently-failing ack write here is exactly
      // what "records reach the web app fine but never turn green on the phone" looks like,
      // so this needs to be visible rather than invisible-by-design.
      console.error(`[mule-ble] sink ack write failed for batch of ${batch.length} record(s) — phone will still show them as unsynced`, e);
    }
  }
}

async function pullOne(service, pullRequest) {
  const dataChar    = await service.getCharacteristic(DATA_CHAR_UUID);
  const controlChar = await service.getCharacteristic(CONTROL_CHAR_UUID);
  const streamPromise = collectDataStream(dataChar);
  await dataChar.startNotifications();
  await new Promise(r => setTimeout(r, NOTIFY_SETTLE_MS));
  console.log('[mule-ble] sending pull request', pullRequest);
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
//
// Retried a few times rather than rejected on the first failure: service/characteristic
// discovery right after gatt.connect() resolves is a known source of spurious failures on some
// Android/Chrome combinations — the connection reports as established before discovery has
// actually settled, so the very next GATT call can fail transiently even against a phone that
// genuinely is running RaceMaster Mobile. Without a retry this showed up as an intermittent,
// misleading "doesn't appear to be running RaceMaster Mobile" for a phone that plainly is.
const DEVICE_INFO_ATTEMPTS = 3;
const DEVICE_INFO_RETRY_DELAY_MS = 400;

export async function connectToPhone() {
  if (!isBluetoothAvailable()) {
    throw new Error('Web Bluetooth is not available — use Chrome or Edge over HTTPS (or localhost).');
  }

  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
  const server = await device.gatt.connect();

  let deviceInfo = null;
  let lastError = null;
  for (let attempt = 1; attempt <= DEVICE_INFO_ATTEMPTS; attempt++) {
    try {
      const service  = await server.getPrimaryService(SERVICE_UUID);
      const infoChar = await service.getCharacteristic(DEVICE_INFO_CHAR_UUID);
      deviceInfo = decodeJson(await infoChar.readValue());
      if (deviceInfo && typeof deviceInfo.raceLabel === 'string') break; // genuine success
      deviceInfo = null; // decoded but the wrong shape — still worth a retry, not immediately fatal
    } catch (e) {
      lastError = e;
      console.warn(`[mule-ble] DeviceInfo read attempt ${attempt}/${DEVICE_INFO_ATTEMPTS} failed`, e);
    }
    if (attempt < DEVICE_INFO_ATTEMPTS) await new Promise(r => setTimeout(r, DEVICE_INFO_RETRY_DELAY_MS));
  }

  if (!deviceInfo) {
    device.gatt.disconnect();
    console.error(`[mule-ble] gave up on DeviceInfo after ${DEVICE_INFO_ATTEMPTS} attempts`, lastError);
    throw new Error(`"${device.name || 'That device'}" doesn't appear to be running RaceMaster Mobile — pick a different device.`);
  }

  connectedDevice = device;
  connectedInfo = deviceInfo;
  device.addEventListener('gattserverdisconnected', forgetConnection);

  return deviceInfo;
}

// Pulls the currently-connected phone's own race history plus anything it's relaying on
// behalf of other devices (see DeviceInfo.relayEntries — a mule-to-mule chain), and returns
// one entry per origin device: { raceLabel, deviceName, deviceId, lines }[] — each containing
// only the delta since this same origin was last successfully pulled (see
// getLastPulledLineNumber above), not its full history every time. deviceId is the true origin
// device's own stable id (never the connected Mule's, for a relayed entry) — callers that
// persist a pull locally need it so they can later call resetLastPulledLineNumber if that copy
// ever gets discarded before being pushed. Does not disconnect afterward — call
// disconnectPhone() explicitly once done.
export async function pullFromConnectedPhone() {
  if (!isConnected()) throw new Error('Not connected to a phone.');
  const service = await connectedDevice.gatt.getPrimaryService(SERVICE_UUID);
  const deviceInfo = connectedInfo;

  // Each leg (this device's own race, plus one per relay entry) is pulled independently —
  // one failing (a relay entry the phone can no longer actually serve, a mid-transfer BLE
  // hiccup) must never discard data another leg already successfully retrieved, which the
  // previous single-try/no-catch version did: any one exception rejected the whole call,
  // throwing away e.g. this device's own already-pulled history along with it.
  const results = [];
  const errors = [];

  // A pure Mule phone (no race of its own — e.g. its operator is only there to bridge
  // Time/Bibs phones to the server, never recording anything itself) has an empty raceLabel
  // and a null servingState.raceId on the Kotlin side, which makes streamRecords() bail out
  // with a bare `return` — no response at all, guaranteeing this leg burns the full 15s
  // PULL_TIMEOUT_MS for nothing before the relay entries below (where such a phone's actual
  // data lives) ever get a turn. Skipping it here isn't just an optimization: without it, a
  // slow/impatient operator could give up during that pointless wait and never see the
  // relayed data at all.
  if (deviceInfo.raceLabel) {
    // Sanitised for the cursor key and the result we hand back — never for the wire request
    // itself, but this leg's own PullRequest carries no raceLabel at all (see pullOne below), so
    // there's nothing here that needs to stay raw.
    const raceLabel = sanitiseName(deviceInfo.raceLabel);
    const deviceName = sanitiseName(deviceInfo.deviceName || deviceInfo.deviceId) || 'unknown-device';
    const since = getLastPulledLineNumber(deviceInfo.deviceId, raceLabel);
    try {
      const ownLines = await pullOne(service, { sinceLineNumber: since });
      advanceLastPulledLineNumber(deviceInfo.deviceId, raceLabel, ownLines);
      results.push({ raceLabel, deviceName, deviceId: deviceInfo.deviceId, lines: ownLines });
    } catch (e) {
      console.error('[mule-ble] pull failed for own race', raceLabel, e);
      errors.push(e);
    }
  } else {
    console.log('[mule-ble] device has no race of its own (pure Mule) — skipping straight to relay entries');
  }

  for (const relay of deviceInfo.relayEntries || []) {
    // originDeviceId/originRaceLabel go out on the wire below exactly as the phone itself
    // reported them — that's how it identifies which relayed race to stream back, and must
    // match its own internal records byte for byte. Only the sanitised copies (raceLabel/
    // deviceName below) are used for our own cursor key and the returned result.
    const raceLabel = sanitiseName(relay.originRaceLabel);
    const deviceName = sanitiseName(relay.originDeviceName || relay.originDeviceId) || 'unknown-device';
    const since = getLastPulledLineNumber(relay.originDeviceId, raceLabel);
    try {
      const lines = await pullOne(service, {
        sinceLineNumber: since,
        originDeviceId: relay.originDeviceId,
        originRaceLabel: relay.originRaceLabel,
      });
      advanceLastPulledLineNumber(relay.originDeviceId, raceLabel, lines);
      results.push({ raceLabel, deviceName, deviceId: relay.originDeviceId, lines });
    } catch (e) {
      console.error('[mule-ble] pull failed for relayed race', raceLabel, e);
      errors.push(e);
    }
  }

  // Best-effort ack, so the phone's own UI can show these lines as synced — not required
  // for the pull itself to have succeeded, so a failure here is never fatal. isSink: true is
  // what turns that into a genuine green "reached a sink" confirmation rather than just an
  // intermediate orange "relayed to somebody" one (see AckPayload's own doc in
  // ~/racemaster-mobile's MuleGattProfile.kt) — this connection's whole purpose is bringing
  // data home to the racemaster server, so it always identifies as a sink.
  if (results.length) {
    await sendSinkAck(service, results.flatMap(r => r.lines.map(l => l.recordUuid)));
  }

  // Only throw if every leg failed — a fully-failed pull should still surface as an error
  // (existing behaviour, e.g. the "no active race" timeout), not silently resolve to nothing.
  if (!results.length && errors.length) throw errors[0];

  return results;
}