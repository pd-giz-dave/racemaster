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

// This web client's own stable identity on the wire — used both as the ack's deviceId (see
// sendSinkAck below) and as the "puller" half of computeRequestKey (see its own doc).
const WEB_DEVICE_ID = 'racemaster-web';

export function isBluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

// ---- Logging (default off, persisted) ----
//
// Routine tracing (bleLog/bleWarn — chunk counts, retry attempts, request details) is gated
// behind this so a normal field session's console stays quiet by default, but persisted (not
// just an in-memory flag) so switching it on survives navigating away from Mobile Files or
// reloading the page mid-investigation. A genuine failure (bleError) is never gated behind it,
// though — a connect attempt that actually failed needs to be visible in the console regardless
// of whether this happened to be ticked beforehand, or every failure looks like a silent one.
const BLE_LOGGING_KEY = 'racemaster-ble-logging';

export function isBleLoggingEnabled() {
  return localStorage.getItem(BLE_LOGGING_KEY) === '1';
}
export function setBleLoggingEnabled(enabled) {
  try { localStorage.setItem(BLE_LOGGING_KEY, enabled ? '1' : '0'); } catch { /* storage unavailable — best effort only */ }
}
// HH:MM:SS.mmm — every log line below is timestamped with this so a real console dump (often
// spanning many minutes of a field session, and easy to lose the sequence of when things
// actually happened in relative to each other once pasted somewhere flat) can be read in order
// rather than relying on the browser's own per-line timestamp, which most pasted/exported logs
// don't carry.
function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function bleLog(...args)   { if (isBleLoggingEnabled()) console.log(`[${ts()}]`, ...args); }
function bleWarn(...args)  { if (isBleLoggingEnabled()) console.warn(`[${ts()}]`, ...args); }
function bleError(...args) { console.error(`[${ts()}]`, ...args); }

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
let deliberateDisconnect = false; // set just before disconnectPhone()'s own .gatt.disconnect() call

export function isConnected() {
  return !!connectedDevice?.gatt?.connected;
}

export function getConnectedDeviceName() {
  return connectedInfo ? (connectedInfo.deviceName || connectedInfo.deviceId) : null;
}

// The phone reports how often it wants to be re-polled (DeviceInfo.pollIntervalMs — see
// MuleGattProfile.RECOMMENDED_POLL_INTERVAL_MS on the racemaster-mobile side), so that cadence
// lives in exactly one place instead of being separately hardcoded/guessed here too. Falls back
// to the same 10s default an old, already-installed phone build predates this field with —
// DeviceInfo is JSON, so a missing field just comes through as undefined, never a parse error.
const DEFAULT_POLL_INTERVAL_MS = 10_000;

export function getRecommendedPollIntervalMs() {
  return connectedInfo?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
}

// Registers a callback fired whenever the connection ends, whether from disconnectPhone()
// below or the phone dropping out of range/turning off — the one true place the UI needs to
// revert its "Disconnect from X" button back to "Connect to Phone…". Called with
// wasDeliberate: true for a disconnectPhone()-triggered end, false for an unexpected drop —
// computed fresh here from deliberateDisconnect every time this fires, so the caller doesn't
// need its own parallel "was this expected" bookkeeping that could drift out of sync with it.
export function onDisconnect(callback) {
  disconnectListener = callback;
}

// A deliberately dumb function — no auto-reconnect (see abandonConnection() below for why that
// was removed). Just clears connection state and reports what happened. An unexpected drop also
// forgets the device (see rememberDevice's own doc on KNOWN_DEVICES_KEY): with no automatic
// recovery attempted, offering it right back as a "Reconnect to X" shortcut next time would be
// recommending something that isn't proven to still work — a fresh pick through the browser's
// own picker is a more honest next step. A deliberate disconnect (the operator's own "Disconnect
// from X" click) does NOT forget it — they may well want to reconnect to the same phone shortly.
function forgetConnection() {
  const wasDeliberate = deliberateDisconnect;
  deliberateDisconnect = false;
  const id = connectedDevice?.id;
  bleLog(`[mule-ble] gattserverdisconnected fired (wasDeliberate=${wasDeliberate})`);
  connectedDevice = null;
  connectedInfo = null;
  if (!wasDeliberate && id) forgetKnownDevice(id);
  disconnectListener?.(wasDeliberate);
}

export function disconnectPhone() {
  bleLog('[mule-ble] ===== manual disconnect requested =====');
  if (!connectedDevice?.gatt?.connected) return; // nothing live to disconnect
  // Only set once we know .gatt.disconnect() below will actually fire — forgetConnection() is
  // what resets this back to false, so setting it with no real event ever coming (e.g. called
  // after the link had already silently dropped, or from the "declined the confirm dialog"
  // path while the phone dropped out during that wait) would leave it stuck true forever,
  // misclassifying the *next* genuinely unexpected disconnect as deliberate too.
  deliberateDisconnect = true;
  connectedDevice.gatt.disconnect(); // triggers 'gattserverdisconnected' → forgetConnection()
}

// Called by a caller (mobile-files.js's own repeated-pull-failure watchdog) that's independently
// decided a persistently failing connection is unrecoverable, and given up trying — an earlier
// version of this tried to force a disconnect+reconnect automatically instead, but that turned
// out to only reliably work via a genuine, fresh, human-initiated disconnect+reconnect; fighting
// to reproduce that automatically (GATT service-discovery caching, races between this app's own
// recovery attempt and the browser's own event firing again mid-attempt) added a lot of
// complexity for something that, confirmed in the field, doesn't actually recover on its own.
// So: don't try. Just end the connection cleanly and forget the device (see forgetConnection's
// own doc on why an unexpected end already does this too) — a deliberate reconnect through the
// picker is what's proven to actually work.
export function abandonConnection() {
  bleWarn('[mule-ble] abandoning a persistently failing connection — leaving reconnection to a fresh, manual Connect to Phone…');
  const id = connectedDevice?.id;
  disconnectPhone();
  if (id) forgetKnownDevice(id);
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

// ATT's maximum attribute value length (Bluetooth Core Spec, Vol 3, Part F, §3.2.9) — a single
// GATT characteristic read can never return more than this many bytes, for any client, on any
// platform; there is no larger single read to ask for instead. DeviceInfo used to grow
// unboundedly with relayEntries (one per device a phone was relaying for), which could push it
// past this cap; it now only ever reports relayCount (a plain number) there, with the actual
// manifest fetched via its own separate chunked pull (see pullRelayManifestEntries below,
// mirroring MuleGattProfile.kt's RelayManifestEntry doc on the phone side) precisely so it's
// never bounded by this single-read cap regardless of how many devices are being relayed. Kept
// as a defensive check regardless — if DeviceInfo's JSON payload ever did grow past this (e.g.
// an unexpectedly long deviceName/raceLabel), the value would arrive silently truncated
// mid-string, and JSON.parse would fail with a generic "Unterminated string" error that gives no
// hint this is a hard protocol ceiling rather than corrupt data — detected explicitly below so
// the real cause is obvious the first time.
const ATT_MAX_ATTRIBUTE_VALUE_LENGTH = 512;

function decodeJson(dataView) {
  const text = new TextDecoder('utf-8').decode(dataView);
  try {
    return JSON.parse(text);
  } catch (e) {
    if (dataView.byteLength >= ATT_MAX_ATTRIBUTE_VALUE_LENGTH) {
      const err = new Error(
        `DeviceInfo is ${dataView.byteLength} bytes — at or beyond Bluetooth's hard ${ATT_MAX_ATTRIBUTE_VALUE_LENGTH}-byte limit for a single characteristic read, so it arrived truncated. `
        + `This phone's device/race name is unusually long for DeviceInfo to fit in one read — the app needs to split DeviceInfo across multiple reads.`
      );
      // The payload size is a property of the phone's current state, not a transient BLE
      // hiccup — retrying reads the exact same oversized value and fails identically every
      // time (unlike a dropped connection, which reconnecting can genuinely fix). Marked so
      // connectAndVerify's retry loop can stop immediately instead of burning through all
      // DEVICE_INFO_ATTEMPTS for a guaranteed-identical failure.
      err.nonRetryable = true;
      throw err;
    }
    throw e;
  }
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
      bleError(`[mule-ble] pull timed out after ${PULL_TIMEOUT_MS}ms — received ${chunkCount} chunk(s), ${gotBytes} byte(s) before giving up`);
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
          bleLog(`[mule-ble] pull complete — ${chunkCount} chunk(s), ${total.length} byte(s), ${records.length} record(s)`);
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
        deviceId: WEB_DEVICE_ID,
        recordUuids: batch,
        deviceName: 'RaceMaster (web)',
        isSink: true,
      }));
      bleLog(`[mule-ble] sent sink ack for ${batch.length} record(s)`);
    } catch (e) {
      // Previously swallowed with zero logging — non-fatal to the pull itself (the caller
      // already has the data either way), but a silently-failing ack write here is exactly
      // what "records reach the web app fine but never turn green on the phone" looks like,
      // so this needs to be visible rather than invisible-by-design.
      bleError(`[mule-ble] sink ack write failed for batch of ${batch.length} record(s) — phone will still show them as unsynced`, e);
    }
  }
}

// Deterministically identifies one "give me your data since X" ask, mirroring
// MulePullClient.kt's own computeRequestKey exactly (same scheme, same field order) so the two
// clients stay wire-compatible — see that function's own doc for the full reasoning (why
// deterministic rather than a fresh random value per call: a random key could never collide
// with itself, so could never actually get deduped by the phone's response cache). Scoped to
// WEB_DEVICE_ID so this web client's own request never collides with a different phone
// puller's request for the same underlying data. This web client's connection model is
// single, point-to-point (one BluetoothDevice at a time, never multiple simultaneous routes to
// the same phone the way a multi-mule mesh can have), so in practice this mostly only helps its
// own retry-after-disconnect path (see connectAndVerify's retry loop) rather than the
// multi-route case the phone-to-phone mesh cares about — carried on every request regardless,
// for wire-protocol consistency with the phone side.
function computeRequestKey(originDeviceId, originRaceLabel, sinceLineNumber) {
  return `${WEB_DEVICE_ID}:${originDeviceId ?? 'self'}:${originRaceLabel ?? ''}:${sinceLineNumber}`;
}

// Writes [pullRequest] to CONTROL and returns whatever JSON array streams back over DATA once
// reassembled — shared by pullOne (SyncRecord[] shape) and pullRelayManifestEntries
// (RelayManifestEntry[] shape) below, which differ only in what shape the resulting array
// decodes as and what (if anything) each maps it into afterward.
async function pullChunkedArray(service, pullRequest) {
  const dataChar    = await service.getCharacteristic(DATA_CHAR_UUID);
  const controlChar = await service.getCharacteristic(CONTROL_CHAR_UUID);
  const streamPromise = collectDataStream(dataChar);
  try {
    await dataChar.startNotifications();
    await new Promise(r => setTimeout(r, NOTIFY_SETTLE_MS));
    bleLog('[mule-ble] sending pull request', pullRequest);
    await controlChar.writeValueWithResponse(encodeJson(pullRequest));
  } catch (e) {
    // startNotifications()/writeValueWithResponse() failing (e.g. the connection just dropped)
    // leaves streamPromise's own internal PULL_TIMEOUT_MS timer running with nothing left to
    // await it — left alone, that fires up to 15s later as a genuinely unhandled rejection
    // (Chrome logs it as "Uncaught (in promise)"), well after this failure already reported
    // itself. Swallowed here rather than left to surface on its own delay: this is already the
    // real, more immediate explanation for the pull failing, so a second, later error report
    // for the same underlying drop adds nothing but confusion.
    streamPromise.catch(() => {});
    throw e;
  }
  try {
    return await streamPromise;
  } finally {
    try { await dataChar.stopNotifications(); } catch { /* connection may already be gone */ }
  }
}

async function pullOne(service, pullRequest) {
  const records = await pullChunkedArray(service, pullRequest);
  return records.map(toStoredLine);
}

// Fetches the connected phone's own current relay manifest — everything else it's holding
// relayable data for on behalf of other, genuinely different origin devices (see
// RelayManifestEntry's own doc on the phone side for why this is its own separate, chunked pull
// rather than a DeviceInfo field: the manifest can grow arbitrarily large with however many
// devices are being relayed, and DeviceInfo is a single read bounded by
// ATT_MAX_ATTRIBUTE_VALUE_LENGTH). Only worth calling when DeviceInfo.relayCount was > 0 — see
// pullFromConnectedPhone below. sinceLineNumber is required by PullRequest's own wire shape but
// ignored by the phone for this request type; 0 is sent purely to satisfy that.
async function pullRelayManifestEntries(service) {
  return pullChunkedArray(service, { sinceLineNumber: 0, requestRelayManifest: true });
}

// ---- Known-device memory ----
//
// The browser's own picker can't show a meaningful name for any of these phones — even though
// racemaster-mobile's phones now advertise a name (see PeripheralSyncService.startAdvertising's
// scan-response payload, MuleGattProfile.encodeAdvertisedIdentity), that's not something this
// web client can read pre-connection: the only two Web Bluetooth APIs that could
// (`navigator.bluetooth.requestLEScan()`, `BluetoothDevice.watchAdvertisements()`) are both
// still gated behind `chrome://flags/#enable-experimental-web-platform-features` (not shipped to
// stable), and `requestDevice()`'s own native picker doesn't surface advertisement/scan-response
// fields to the page at all — it's the browser's own OS-level chooser UI, not something this
// script draws or has access to the contents of. So this gap is a genuine, currently-permanent
// platform limitation on the web side, not a leftover TODO — don't attempt to "fix" it here
// without first confirming one of those two APIs has actually shipped.
//
// This same rotating-identity issue is also the answer to "how to mitigate Android phones
// cycling their BLE id" (ToDo.MD): Android's default BLE advertising uses a rotating resolvable
// private address, and this protocol doesn't bond/pair (see connectAndVerify's own doc), so
// there's no IRK exchange letting the OS/browser resolve a rotated address back to "the same
// device" — each rotation looks like a genuinely new, unrelated device to Web Bluetooth's own
// permission system. That's a platform-level limitation with no code-level fix on this side
// either. What IS fixable, and is: (1) rememberDevice() below dedupes by name, so a phone
// reconnecting under a new id after its address rotates replaces its stale "Reconnect to <name>"
// entry rather than leaving a confusing duplicate; (2) forgetConnection() (deliberately no
// auto-reconnect any more — see its own doc) forgets the device outright on any unexpected end,
// rather than leaving a "Reconnect to <name>" shortcut sitting there that isn't proven to still
// work — a fresh pick through the picker is what's confirmed to actually work after any kind of
// drop, address rotation or not.
//
// Once connected, though, a genuine phone's real name IS known (via DeviceInfo) — remembered
// here (browser-assigned device.id → that name) so a later connect can offer a direct
// "Reconnect to <name>" that skips the anonymous picker entirely for a phone that's been through
// it before. Persisted (not just in-memory) so this survives a page reload.
const KNOWN_DEVICES_KEY = 'racemaster-ble-known-devices';

function loadKnownDevices() {
  try { return JSON.parse(localStorage.getItem(KNOWN_DEVICES_KEY) || '{}'); } catch { return {}; }
}
function rememberDevice(id, name) {
  try {
    const map = loadKnownDevices();
    // Any other id already remembered under this same name is a stale entry for this same
    // phone under a previous browser-assigned device.id (e.g. its underlying BLE address
    // rotated, or it was re-picked after a permission reset) — drop it so getKnownDevices()
    // doesn't offer two "Reconnect to <name>" entries for what is really one phone.
    for (const otherId of Object.keys(map)) {
      if (otherId !== id && map[otherId] === name) delete map[otherId];
    }
    map[id] = name;
    localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(map));
  } catch { /* storage unavailable — best effort only */ }
}
export function forgetKnownDevice(id) {
  try {
    const map = loadKnownDevices();
    if (!(id in map)) return;
    delete map[id];
    localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(map));
  } catch { /* storage unavailable — best effort only */ }
}

// navigator.bluetooth.getDevices() is a Chromium extension to the Web Bluetooth spec (not
// supported in every Web-Bluetooth-capable browser) returning every device this origin still
// holds a persistent permission grant for — cross-referenced against rememberDevice() above so
// only ones already verified as genuine RaceMaster Mobile phones are offered, never a stale or
// unrelated grant. Returns [] (never throws) wherever getDevices() isn't available, so callers
// can treat "no known devices" and "can't check" identically and just fall back to the picker.
export async function getKnownDevices() {
  if (!isBluetoothAvailable() || typeof navigator.bluetooth.getDevices !== 'function') return [];
  let granted;
  try {
    granted = await navigator.bluetooth.getDevices();
  } catch (e) {
    bleWarn('[mule-ble] getDevices() failed', e);
    return [];
  }
  const known = loadKnownDevices();
  return granted.filter(d => known[d.id]).map(d => ({ device: d, name: known[d.id] }));
}

// Connects to an already-selected BluetoothDevice (either fresh from requestDevice()'s picker,
// or a remembered one from getKnownDevices() bypassing it) and reads its DeviceInfo — leaving
// the connection open (see disconnectPhone()/onDisconnect() above) rather than pulling and
// disconnecting in one shot. No pairing/bonding is required by this protocol. Returns the
// DeviceInfo read at connect time, so a fresh-picker caller can echo the phone's own name back
// for confirmation before doing anything else with it (a known-device caller already knows the
// name — that's the whole point of remembering it — so has no need to).
//
// The requestDevice() filter already restricts the picker to devices advertising our service
// UUID, but that's an advertisement-layer claim, not a guarantee — reading DeviceInfo here is
// what actually confirms this is a genuine RaceMaster Mobile peripheral; anything that fails
// that gets disconnected immediately, forgotten if it was a remembered device, and rejected
// with a clear reason rather than a raw browser exception.
//
// Retried a few times rather than rejected on the first failure: service/characteristic
// discovery right after gatt.connect() resolves is a known source of spurious failures on some
// Android/Chrome combinations — the connection reports as established before discovery has
// actually settled, so the very next GATT call can fail transiently even against a phone that
// genuinely is running RaceMaster Mobile. Without a retry this showed up as an intermittent,
// misleading "doesn't appear to be running RaceMaster Mobile" for a phone that plainly is.
const DEVICE_INFO_ATTEMPTS = 3;
const DEVICE_INFO_RETRY_DELAY_MS = 400;

// gatt.connect() has no spec-guaranteed timeout of its own — against a device that's no longer
// reachable under the identity Chrome remembers it by (out of range, turned off, or its
// underlying BLE address rotated, e.g. after an app update/restart on the phone), it's been
// observed to simply hang rather than reject, leaving the caller with no error and nothing to
// show for it. Racing it against this gives every caller a definite answer either way — it
// doesn't cancel the underlying browser-level attempt (Web Bluetooth has no such mechanism), it
// just stops waiting on it.
const GATT_CONNECT_TIMEOUT_MS = 12000;

// A mid-verification reconnect (inside the DEVICE_INFO_ATTEMPTS loop below) uses a much shorter
// timeout than the initial connect above — reusing the same 12s there meant a genuinely dead
// connection could take up to 3 × 12s to actually give up, which just looks like "stopped
// retrying" long before anyone's waited that long. By this point the device was reachable only
// moments ago, so if a reconnect is going to succeed at all it does so quickly; if it doesn't,
// better to fail this attempt fast and let the loop move on (or give up) within a sane budget.
const GATT_RECONNECT_TIMEOUT_MS = 4000;

// getPrimaryService()/getCharacteristic()/readValue() below have no spec-guaranteed timeout of
// their own either — against a connection device.gatt.connected still calls "connected" but that
// is, in practice, otherwise stuck, these have been observed to simply hang, same as
// gatt.connect() itself (see GATT_CONNECT_TIMEOUT_MS above). Without this, that hang happens
// *inside* the try block, so it never reaches the catch below at all — no retry, no log, no
// status update, nothing — which looked exactly like the whole attempt had silently vanished.
const DEVICE_INFO_READ_TIMEOUT_MS = 5000;

async function readDeviceInfo(server) {
  const service  = await server.getPrimaryService(SERVICE_UUID);
  const infoChar = await service.getCharacteristic(DEVICE_INFO_CHAR_UUID);
  return decodeJson(await infoChar.readValue());
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// onProgress(message) is called at each real step so a caller showing it via ui.js's
// showStatus() gets its 10s auto-clear timer refreshed along the way — that auto-clear fires
// regardless of whether the work it was describing is actually done, so a single static
// "Connecting…" left unrefreshed for longer than that reads as "gave up" even while this is
// still genuinely retrying underneath it. Defaults to a no-op so callers that don't care about
// progress (there are none currently, but this keeps the signature uniform) aren't forced to.
async function connectAndVerify(device, onProgress = () => {}) {
  const label = device.name || 'that device';
  onProgress(`Connecting to "${label}"…`);
  let server;
  try {
    server = await withTimeout(
      device.gatt.connect(), GATT_CONNECT_TIMEOUT_MS,
      `Timed out connecting to "${label}" — it may be out of range or turned off.`,
    );
  } catch (e) {
    // Any failure here — including a remembered device that's no longer reachable under the
    // identity it was recognised by, e.g. its BLE address rotated after an app update/restart —
    // means this entry is stale. Forgetting it now (rather than only ever on a DeviceInfo
    // failure further down) is what stops it lingering forever as a dead "Reconnect to X"
    // choice once a fresh pick of the same phone gets remembered under a new id alongside it.
    forgetKnownDevice(device.id);
    bleError(`[mule-ble] GATT connect failed for "${label}"`, e);
    throw new Error(e.message || `Couldn't connect to "${label}" — it may be out of range, turned off, or no longer available. Try "Pick a different phone…" to select it fresh.`);
  }

  // The connection can drop again right after connect() resolves — a genuine disconnect, not
  // just the discovery-not-settled-yet timing race this loop was originally written for (that
  // one's still real too, hence still retrying rather than failing outright on attempt 1). The
  // two need telling apart: retrying getPrimaryService() against a server that's actually gone
  // can never succeed and just repeats the identical failure every time (confirmed against a
  // real "GATT Server is disconnected" log where all 3 attempts failed identically) — so each
  // attempt re-establishes the connection first whenever it's found dropped.
  onProgress(`Verifying "${label}" is running RaceMaster Mobile…`);
  let deviceInfo = null;
  let lastError = null;
  // How many attempts actually ran — DEVICE_INFO_ATTEMPTS is only the *ceiling* on the loop
  // below, not what genuinely happened: a nonRetryable failure (see decodeJson's own doc)
  // breaks out on the very first attempt it occurs on, same as a genuine success can. Logging
  // the ceiling instead of this after the loop (see the "gave up" bleError further down) is
  // what made a truncated-DeviceInfo failure claim "after 3 attempts" when only 1 ever ran.
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= DEVICE_INFO_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    try {
      if (!device.gatt.connected) {
        onProgress(`Reconnecting to "${label}"… (attempt ${attempt}/${DEVICE_INFO_ATTEMPTS})`);
        bleWarn(`[mule-ble] reconnecting before DeviceInfo attempt ${attempt}/${DEVICE_INFO_ATTEMPTS} (connection dropped)`);
        server = await withTimeout(
          device.gatt.connect(), GATT_RECONNECT_TIMEOUT_MS,
          `Timed out reconnecting to "${label}".`,
        );
      } else if (attempt > 1) {
        onProgress(`Still verifying "${label}"… (attempt ${attempt}/${DEVICE_INFO_ATTEMPTS})`);
      }
      deviceInfo = await withTimeout(
        readDeviceInfo(server), DEVICE_INFO_READ_TIMEOUT_MS,
        `Timed out reading DeviceInfo from "${label}".`,
      );
      if (deviceInfo && typeof deviceInfo.raceLabel === 'string') break; // genuine success
      deviceInfo = null; // decoded but the wrong shape — still worth a retry, not immediately fatal
    } catch (e) {
      lastError = e;
      if (e.nonRetryable) {
        // Deterministic — retrying would just read the exact same oversized value and fail
        // identically (see decodeJson's own doc), so this is logged once, here, as the real
        // failure it is, rather than as a routine bleWarn retry note *and* duplicated again by
        // the generic "gave up" bleError after the loop (see the `attemptsMade`-gated skip
        // there) — the same underlying error doesn't need to appear in the console twice.
        bleError(`[mule-ble] DeviceInfo read failed permanently on attempt ${attempt} (non-retryable)`, e);
        break;
      }
      bleWarn(`[mule-ble] DeviceInfo read attempt ${attempt}/${DEVICE_INFO_ATTEMPTS} failed`, e);
    }
    if (attempt < DEVICE_INFO_ATTEMPTS) await new Promise(r => setTimeout(r, DEVICE_INFO_RETRY_DELAY_MS));
  }

  if (!deviceInfo) {
    // A link that kept dropping is a flaky-connection problem, not evidence this isn't a
    // genuine RaceMaster Mobile phone (it connected fine at least once) — worth keeping
    // remembered for next time, unlike a device that connected solidly throughout but never
    // spoke this protocol at all, which forgetKnownDevice below treats as the real thing. A
    // too-large DeviceInfo (lastError.nonRetryable) is the same case as a link that kept
    // dropping in that sense — a too-big payload is itself proof this is a genuine RaceMaster
    // Mobile phone (it's the app's own characteristic, correctly shaped, just oversized this
    // time), so forgetting it here would be wrong and would just make an otherwise-good phone
    // re-prompt for confirmation next time for no reason.
    const keptDisconnecting = !device.gatt.connected;
    device.gatt.disconnect();
    if (!keptDisconnecting && !lastError?.nonRetryable) forgetKnownDevice(device.id);
    // Already logged (as the specific failure it is, via bleError) at the point it happened,
    // inside the loop above — skipped here so it isn't reported a second time under this
    // generic "gave up" wording too.
    if (!lastError?.nonRetryable) {
      bleError(`[mule-ble] gave up on DeviceInfo after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'}`, lastError);
    }
    throw new Error(lastError && lastError.nonRetryable
      ? lastError.message
      : keptDisconnecting
        ? `Lost the Bluetooth connection to "${label}" while verifying it — try Connect to Phone… again.`
        : `"${label}" doesn't appear to be running RaceMaster Mobile — pick a different device.`);
  }

  connectedDevice = device;
  connectedInfo = deviceInfo;
  device.addEventListener('gattserverdisconnected', forgetConnection);
  rememberDevice(device.id, deviceInfo.deviceName || deviceInfo.deviceId);
  bleLog(`[mule-ble] ===== connected to "${label}" =====`, deviceInfo);

  return deviceInfo;
}

// onProgress(message), if given, is called at each real step of the connect/verify process —
// see connectAndVerify's own doc for why: a caller displaying it via showStatus() needs that
// refreshed periodically, or its 10s auto-clear makes a still-in-progress attempt look dead.
export async function connectToPhone(onProgress) {
  bleLog('[mule-ble] ===== manual connect requested: opening picker =====');
  if (!isBluetoothAvailable()) {
    throw new Error('Web Bluetooth is not available — use Chrome or Edge over HTTPS (or localhost).');
  }
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
  bleLog(`[mule-ble] picker resolved to "${device.name || device.id}"`);
  return connectAndVerify(device, onProgress);
}

// Reconnects directly to a device from getKnownDevices() above, skipping the browser's own
// anonymous picker entirely — the whole point of remembering it in the first place. Still goes
// through the exact same DeviceInfo verification/retry as a fresh pick, so a remembered device
// that's since stopped running RaceMaster Mobile is caught and forgotten rather than blindly
// trusted just because it was chosen by name.
export async function reconnectToKnownDevice(device, onProgress) {
  bleLog(`[mule-ble] ===== manual connect requested: reconnecting to known device "${device.name || device.id}" =====`);
  return connectAndVerify(device, onProgress);
}

// Pulls the currently-connected phone's own race history plus anything it's relaying on
// behalf of other devices (see DeviceInfo.relayCount/pullRelayManifestEntries above — a
// mule-to-mule chain), and returns one entry per origin device: { raceLabel, deviceName,
// deviceId, lines }[] — each containing
// only the delta since this same origin was last successfully pulled (see
// getLastPulledLineNumber above), not its full history every time. deviceId is the true origin
// device's own stable id (never the connected Mule's, for a relayed entry) — callers that
// persist a pull locally need it so they can later call resetLastPulledLineNumber if that copy
// ever gets discarded before being pushed. Does not disconnect afterward — call
// disconnectPhone() explicitly once done.
export async function pullFromConnectedPhone() {
  if (!isConnected()) throw new Error('Not connected to a phone.');
  let service;
  try {
    service = await connectedDevice.gatt.getPrimaryService(SERVICE_UUID);
  } catch (e) {
    // Unlike every leg below, this one has no try/catch of its own to fall into and log via —
    // confirmed in the field as a real, silent gap: isConnected() can still read true (a link
    // that's dead in practice but hasn't fired 'gattserverdisconnected' — see abandonConnection's
    // own doc above) while this very first GATT call already fails, and without this it
    // propagated straight to the caller with nothing logged here at all, making a run of failed
    // auto-pull ticks look like they'd done nothing rather than shown WHY.
    bleError('[mule-ble] pull failed: could not get the primary service (connection may be dead despite isConnected() still reading true)', e);
    throw e;
  }
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
      const ownLines = await pullOne(service, {
        sinceLineNumber: since,
        requestKey: computeRequestKey(null, null, since),
      });
      advanceLastPulledLineNumber(deviceInfo.deviceId, raceLabel, ownLines);
      results.push({ raceLabel, deviceName, deviceId: deviceInfo.deviceId, lines: ownLines });
    } catch (e) {
      bleError('[mule-ble] pull failed for own race', raceLabel, e);
      errors.push(e);
    }
  } else {
    bleLog('[mule-ble] device has no race of its own (pure Mule) — skipping straight to relay entries');
  }

  // The manifest itself (unlike the count) is fetched fresh here rather than off the
  // connect-time deviceInfo — see pullRelayManifestEntries' own doc. Only bothered with when
  // relayCount says there's something to fetch, so a leaf Time/Bibs/CP phone (always
  // relayCount 0) never pays this extra round trip. A failure here is treated the same as any
  // other leg failing (see the try/catch pattern above/below) — logged and pushed onto errors,
  // never discarding whatever the own-race leg above already retrieved.
  let relayEntries = [];
  if (deviceInfo.relayCount > 0) {
    try {
      relayEntries = await pullRelayManifestEntries(service);
    } catch (e) {
      bleError('[mule-ble] failed to fetch relay manifest', e);
      errors.push(e);
    }
  }

  for (const relay of relayEntries) {
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
        requestKey: computeRequestKey(relay.originDeviceId, relay.originRaceLabel, since),
      });
      advanceLastPulledLineNumber(relay.originDeviceId, raceLabel, lines);
      results.push({ raceLabel, deviceName, deviceId: relay.originDeviceId, lines });
    } catch (e) {
      bleError('[mule-ble] pull failed for relayed race', raceLabel, e);
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