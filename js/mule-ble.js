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

// Advertised (never a real GATT service — see MuleGattProfile.MULE_MODE_MARKER_SERVICE_UUID's
// own doc on the phone side) only while a racemaster-mobile phone is currently in Mule Mode.
// connectToPhone() below requires both this and SERVICE_UUID in one requestDevice() filter so
// its picker only offers phones currently in Mule Mode, not every nearby Time/Bibs/CP phone too.
//
// This is the second attempt at that goal — the first encoded mode as a byte in the scan-response
// manufacturer data and filtered on it via requestDevice()'s manufacturerData/dataPrefix option.
// Confirmed in the field (2026-08-27, against a Chromium-based browser on a remote Windows
// laptop) that the manufacturerData filter matched nothing even though
// chrome://bluetooth-internals' raw advertisement view proved the phone's bytes were exactly
// correct; removing just that one filter field made the same phone appear immediately, isolating
// the browser's own filter-matching for that option (not this wire format) as the broken part on
// that specific deployment. The exact underlying reason wasn't chased further — manufacturerData
// filtering is generally a less mature/less exercised part of most Web Bluetooth implementations
// than plain service-UUID filtering, across platforms, but nothing here should be read as a claim
// about *why* it failed on that machine specifically, only that it did. Service-UUID filtering is
// the one path confirmed reliable there, hence this approach instead.
//
// Why this string, despite looking exactly like every other full 128-bit UUID here, is secretly
// a "16-bit UUID" (explained for anyone who hasn't worked with BLE UUIDs before): the Bluetooth
// SIG (Special Interest Group) defined one official 128-bit UUID, the "Bluetooth Base UUID" —
// 00000000-0000-1000-8000-00805F9B34FB. A "16-bit UUID" is, by definition, that exact value with
// only its first 4 hex digits swapped out, so 16-bit UUID 0xFFF0 and
// 0000FFF0-0000-1000-8000-00805F9B34FB are, byte for byte, the identical value. There's no
// separate "16-bit UUID" type in the Web Bluetooth API (or Android's, on the phone side) — you
// always write/read the full 128-bit string; its "16-bit-ness" is a fact about *which value it
// happens to be*, not about how it's spelled here. SERVICE_UUID above, by contrast, does NOT end
// in that fixed -0000-1000-8000-00805F9B34FB suffix — it's a genuinely random, one-off custom
// value — so it can never be treated as a short form the way this one can.
//
// That distinction is *why* this exists as its own separate UUID instead of just reusing
// SERVICE_UUID's pattern: BLE's own advertisement format has two ways to encode a service UUID —
// the full 16 raw bytes (+2 bytes of framing = 18 bytes total), or, only for a value matching the
// Base UUID pattern, just its 2 changed bytes (+2 bytes of framing = 4 bytes total), since a
// receiver can always reconstruct the full 128 bits by re-inserting that same fixed suffix. The
// legacy advertisement packet this rides in is capped at 31 bytes total, and SERVICE_UUID alone
// already costs the full 18 of those (it can't be shortened, per above) — a second *custom*
// 128-bit UUID would cost another 18 bytes and blow the budget outright, whereas this short-form
// value costs only 4. The phone's own BLE stack performs this compaction on the wire
// automatically (see MuleGattProfile.MULE_MODE_MARKER_SERVICE_UUID's own doc); by the time it
// reaches this browser, the OS's own Bluetooth stack has already expanded it back to the full
// 128-bit string below — this file never sees or handles a "short" UUID directly either.
const MULE_MODE_MARKER_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';

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

// When the link last actually ended (deliberate or not — see forgetConnection() below, which
// sets this) — connectAndVerify() waits out the rest of RECONNECT_COOLDOWN_MS from this before
// its own first gatt.connect() attempt. 0 (i.e. "long ago") until the first disconnect ever
// happens, so a device's very first connect is never delayed by this.
let lastDisconnectAt = 0;

// Cached relay manifest — see pullFromConnectedPhone's own doc for why this exists. Reset
// alongside connectedDevice/connectedInfo in forgetConnection() below, same lifecycle: a fresh
// connection should never reuse a manifest fetched from a previous one.
let cachedRelayEntries = null;    // RelayManifestEntry[] | null
let cachedRelayManifestKey = null; // the value relayManifestCacheKey() returned when the cache above was fetched

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

// Read-only snapshot of the connected phone's own last-read DeviceInfo — refreshed at connect
// time (connectAndVerify) and again on every pullFromConnectedPhone() call, same source
// getConnectedDeviceName()/getRecommendedPollIntervalMs() above already read from. Exposed as a
// whole object (rather than one getter per field, the way those two do) so a caller like
// mobile-files.js's poll-status display can surface relayCount — how many other devices this
// phone is currently relaying data for — without this file needing its own dedicated getter for
// every individual DeviceInfo field callers might eventually want to echo.
export function getConnectedDeviceInfo() {
  return connectedInfo;
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
// was removed). Just clears connection state and reports what happened. Does NOT forget the
// device on an unexpected drop any more than a deliberate one does (see rememberDevice's own doc
// on KNOWN_DEVICES_KEY for the full reasoning) — the single most common "unexpected drop" this
// app actually sees in the field is a mule going briefly out of Bluetooth range, which is
// routine, not evidence of anything wrong with the remembered identity. Forgetting on every such
// drop forced a full re-pick through the browser's slow native picker (tens of seconds) for
// something that would very likely have reconnected instantly via the known-device shortcut.
// Connect-time failures (GATT_CONNECT_ATTEMPTS exhausted, or DEVICE_INFO_ATTEMPTS exhausted
// against a device that stayed connected the whole time) still forget it themselves — that
// safety net is what actually catches a genuinely stale identity (e.g. Android's BLE address
// rotation), one extra failed attempt away, not an eager guess made the instant any drop occurs.
function forgetConnection() {
  const wasDeliberate = deliberateDisconnect;
  deliberateDisconnect = false;
  bleLog(`[mule-ble] gattserverdisconnected fired (wasDeliberate=${wasDeliberate})`);
  connectedDevice = null;
  connectedInfo = null;
  cachedRelayEntries = null;
  cachedRelayManifestKey = null;
  lastDisconnectAt = Date.now(); // see RECONNECT_COOLDOWN_MS's own doc
  disconnectListener?.(wasDeliberate);
}

// [reason] is purely for this function's own log line — it's called both from the operator's
// own "Disconnect from X" click (the default, genuinely manual wording) and internally by
// callers like abandonConnection() that end the connection programmatically for their own
// reasons; logging every call as "manual disconnect requested" regardless made an automatic
// abandon read as if the operator had clicked something they hadn't.
export function disconnectPhone(reason = 'manual disconnect requested') {
  bleLog(`[mule-ble] ===== ${reason} =====`);
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
// So: don't try. Just end the connection cleanly — a deliberate reconnect through the known-device
// shortcut or the picker is what's proven to actually work. Does NOT forget the device any more
// (see forgetConnection's own doc for the full reasoning) — a persistently failing connection
// while nominally still connected is, in the field, most often the same "mule briefly out of
// range" case that doc already covers, not confirmation the remembered identity has gone stale.
export function abandonConnection() {
  bleWarn('[mule-ble] abandoning a persistently failing connection — leaving reconnection to a fresh, manual Connect to Phone…');
  disconnectPhone('abandoning a persistently failing connection');
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
// [device], if given, is the BluetoothDevice this pull is running against — captured by the
// caller before it can go null (see pullChunkedArray's own doc), so a real disconnect landing
// while this is waiting purely on incoming notifications (already past writeValueWithResponse,
// with no further outbound GATT call left to reject on its own) is caught immediately here too,
// rather than only being discovered PULL_TIMEOUT_MS later. Confirmed in the field as exactly
// this: a manual disconnect mid-pull, with several other in-flight legs failing within
// milliseconds (their own next GATT call threw immediately) while one leg that happened to have
// already reached this wait sat blocking for the full 15s regardless — this same leg would fail
// just as fast as the others once wired up to react to the same event they're reacting to.
function collectDataStream(dataChar, device) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let chunkCount = 0;
    const timer = setTimeout(() => {
      cleanup();
      const gotBytes = chunks.reduce((n, c) => n + c.length, 0);
      bleError(`[mule-ble] pull timed out after ${PULL_TIMEOUT_MS}ms — received ${chunkCount} chunk(s), ${gotBytes} byte(s) before giving up`);
      reject(new Error('No data arrived from the phone — it may not have a race currently open (Bluetooth sync only serves an active race), or may have gone out of range.'));
    }, PULL_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      dataChar.removeEventListener('characteristicvaluechanged', onValue);
      device?.removeEventListener('gattserverdisconnected', onDisconnected);
    }

    function onDisconnected() {
      cleanup();
      bleWarn('[mule-ble] connection dropped while waiting on this leg\'s data stream — giving up immediately rather than waiting out the full pull timeout');
      reject(new Error('GATT Server is disconnected. Cannot perform GATT operations.'));
    }

    function onValue(event) {
      const value = event.target.value; // DataView
      if (value.byteLength === 1 && value.getUint8(0) === 0) {
        cleanup();
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
    device?.addEventListener('gattserverdisconnected', onDisconnected);
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
  // Captured now, before anything else in here awaits — connectedDevice is what
  // collectDataStream listens on for an early 'gattserverdisconnected' (see its own doc); by the
  // time a disconnect actually happens, forgetConnection() has already nulled the module-level
  // variable out, so it has to be grabbed once, up front, while it's still this leg's device.
  const device = connectedDevice;
  const dataChar    = await service.getCharacteristic(DATA_CHAR_UUID);
  const controlChar = await service.getCharacteristic(CONTROL_CHAR_UUID);
  const streamPromise = collectDataStream(dataChar, device);
  try {
    await dataChar.startNotifications();
    await new Promise(r => setTimeout(r, NOTIFY_SETTLE_MS));
    // isSink mirrors the ack's own isSink (see sendSinkAck) but goes out on *every* request,
    // not just when there's something to ack — this is what identifies this connection's own
    // BluetoothDevice address as the web app's, on the very first poll tick, regardless of
    // whether anything ends up being pulled that time. Without it, the phone side
    // (BluetoothStateRepository.recordWebAppSeen — see its own doc) had no way to attribute a
    // CONTROL write to this client specifically until the next time an ack actually fired,
    // which sendSinkAck skips entirely whenever there's nothing new — confirmed in the field as
    // the phone's own "web app last seen" feedback staying stuck on "never" the whole time a
    // phone simply had no fresh data to push, even while this file's own log showed it polling
    // fine every few seconds.
    const requestWithIdentity = { ...pullRequest, isSink: true };
    bleLog('[mule-ble] sending pull request', requestWithIdentity);
    await controlChar.writeValueWithResponse(encodeJson(requestWithIdentity));
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

// What cachedRelayEntries (see its own doc) is keyed on — prefers relayManifestVersion (see
// MuleGattProfile.DeviceInfo's own doc on the phone side), a counter the phone bumps only when
// the manifest's actual content changes (an origin added/removed, or an existing origin's own
// lastLineNumber/deviceName advancing), so a same-size membership swap between two ticks is
// correctly detected as a change even though relayCount alone wouldn't show it. Falls back to
// relayCount when relayManifestVersion is absent (an older phone build that predates this field
// — DeviceInfo is JSON, so a missing field just comes through as undefined) — the same coarser,
// count-only comparison this cache used before that field existed, with the same narrow known
// gap (a same-count swap can go briefly unnoticed) for exactly the phones that can't report
// anything better. `??`, not `||` — 0 is a legitimate version/count and must not be treated as
// "missing".
function relayManifestCacheKey(deviceInfo) {
  return deviceInfo.relayManifestVersion ?? deviceInfo.relayCount;
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
// entry rather than leaving a confusing duplicate; (2) connectAndVerify's own connect-time
// failure paths (see forgetConnection's own doc) forget a device once a reconnect attempt
// against it actually fails, which is what a rotated address eventually looks like from here —
// forgetConnection() itself no longer forgets on the drop alone, since the overwhelmingly common
// "unexpected end" in the field is a mule going briefly out of range, not an address rotation,
// and forcing a full picker re-pick for that routine case was worse than the rare extra failed
// reconnect attempt this now costs against a genuinely rotated/gone device instead.
//
// A bonding-based fix for this was attempted and reverted (2026-08-28): a dedicated encrypted
// characteristic (PAIRING_ANCHOR_CHAR_UUID) forced Android to bond with a phone on first
// connection, which should have let the OS resolve its rotated address transparently afterward —
// but confirmed in the field, on two independent Windows laptops, once bonded, *every* GATT
// operation to that phone started failing (not just the encrypted one), with no way found to
// recover it short of fully unbonding the devices again. Whatever the exact mechanism (BLE
// encryption applies to a whole connection, not per-characteristic, so a broken
// encryption-resumption step for the bonded link would explain reads failing across the board),
// the practical result was a phone that could no longer be connected to at all — categorically
// worse than the rotating-identity annoyance this was meant to fix. Not attempted again without
// a way to first confirm bonding actually works reliably against this deployment's real
// hardware/browser combinations.
//
// Once connected, though, a genuine phone's real name IS known (via DeviceInfo) — remembered
// here (browser-assigned device.id → that name) so a later connect can offer a direct
// "Reconnect to <name>" that skips the anonymous picker entirely for a phone that's been through
// it before. Persisted (not just in-memory) so this survives a page reload.
const KNOWN_DEVICES_KEY = 'racemaster-ble-known-devices';

function loadKnownDevices() {
  try { return JSON.parse(localStorage.getItem(KNOWN_DEVICES_KEY) || '{}'); } catch { return {}; }
}
// Returns true if this connection replaced a stale, differently-id'd entry for the same phone
// name — see connectAndVerify's own doc for why that's the signal a rotated BLE address just
// happened, and how that gets surfaced to the operator (deviceInfo.addressRotated below).
function rememberDevice(id, name) {
  let rotated = false;
  try {
    const map = loadKnownDevices();
    // Any other id already remembered under this same name is a stale entry for this same
    // phone under a previous browser-assigned device.id (e.g. its underlying BLE address
    // rotated, or it was re-picked after a permission reset) — drop it so getKnownDevices()
    // doesn't offer two "Reconnect to <name>" entries for what is really one phone.
    for (const otherId of Object.keys(map)) {
      if (otherId !== id && map[otherId] === name) { delete map[otherId]; rotated = true; }
    }
    map[id] = name;
    localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(map));
  } catch { /* storage unavailable — best effort only */ }
  return rotated;
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

// A fresh gatt.connect() attempted too soon after the *same* device's link just ended — our own
// deliberate disconnectPhone(), or an unexpected drop — has been observed, in the field, to
// connect but then fail to actually serve GATT traffic for many seconds afterward (DeviceInfo
// reads timing out on attempt after attempt) rather than failing outright the way an
// insufficient wait might suggest: a real BLE disconnect is an over-the-air handshake the
// platform's own Bluetooth stack (BlueZ, WinRT, CoreBluetooth) needs a real amount of time to
// actually finish, and a link re-established before it has stays unstable, not merely refused.
// Confirmed at 6.45s already elapsed since the previous disconnect and *still* failing (three
// DeviceInfo read timeouts in a row, ending in a genuine mid-verification drop), but succeeding
// promptly once ~9.5s had passed — this constant is set with real headroom above that single
// field data point, not tuned to the exact minimum, since BLE stack recovery time isn't something
// this code can measure and is surely hardware/OS-dependent.
//
// This is exactly what "Reconnect to <name>" (the known-device shortcut, see getKnownDevices()
// above) looks like failing even seconds after a manual Disconnect click, immediately followed by
// a fresh Connect to Phone… → Reconnect — going straight from the click to gatt.connect() with no
// delay at all. reconnectToKnownDevice() below waits out the remainder of this from
// lastDisconnectAt (see its own doc) before its first connectAndVerify() attempt. Deliberately NOT
// applied there to connectToPhone()'s own picker path too: that one's requestDevice() call already
// burns real time on its own scan, so gating its first attempt the same way would only cost time
// on a path that's rarely short enough to need it.
//
// The picker's own natural delay, though, only ever covers connectAndVerify's *first* connect
// attempt — its inner DEVICE_INFO_ATTEMPTS retry loop (a few lines down) forces its own
// disconnect+reconnect between attempts with no such cushion at all, regardless of which path got
// it there, and empirically hits this exact same instability (that's what the 6.45s/9.5s field
// data above actually came from — attempt 1, then two further forced reconnects, all failing
// identically). So waitOutReconnectCooldown() below is called there too, unconditionally.
const RECONNECT_COOLDOWN_MS = 10_000;

// Shared by reconnectToKnownDevice() and connectAndVerify()'s own inner retry loop — see
// RECONNECT_COOLDOWN_MS's own doc for why both need it. A no-op (returns immediately) whenever
// enough real time has already passed since lastDisconnectAt on its own, which is the common case
// for a genuinely fresh connect (lastDisconnectAt is 0 — "long ago" — until the very first
// disconnect ever happens) and for a picker-driven first attempt.
async function waitOutReconnectCooldown(label, onProgress) {
  const sinceDisconnect = Date.now() - lastDisconnectAt;
  if (sinceDisconnect >= RECONNECT_COOLDOWN_MS) return;
  const wait = RECONNECT_COOLDOWN_MS - sinceDisconnect;
  bleLog(`[mule-ble] waiting ${wait}ms for the previous Bluetooth link to finish closing before reconnecting to "${label}"`);
  onProgress?.('Waiting for the previous Bluetooth session to close…');
  await new Promise(r => setTimeout(r, wait));
}

// Connects to an already-selected BluetoothDevice (either fresh from requestDevice()'s picker,
// or a remembered one from getKnownDevices() bypassing it) and reads its DeviceInfo — leaving
// the connection open (see disconnectPhone()/onDisconnect() above) rather than pulling and
// disconnecting in one shot. No pairing/bonding is required by this protocol (see
// getKnownDevices()'s own doc for why a bonding-based fix for the rotating-address problem was
// tried and reverted). Returns the DeviceInfo read at connect time, so a fresh-picker caller can
// echo the phone's own name back for confirmation before doing anything else with it (a
// known-device caller already knows the name — that's the whole point of remembering it — so has
// no need to).
//
// The requestDevice() filter already restricts the picker to devices advertising our service
// UUID and currently in Mule Mode (see connectToPhone's own doc), but that's an
// advertisement-layer claim, not a guarantee — reading DeviceInfo here is
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

// The very first gatt.connect() (before verification even starts) had no retry at all until
// this was added — confirmed in the field as a single `NetworkError: Connection Error:
// Connection attempt failed.` failing the whole attempt outright, even for a phone that then
// connected fine on the operator's very next click. That's the same category of transient
// failure DEVICE_INFO_ATTEMPTS below already retries past for the *verification* step; the
// initial connect deserved the same treatment rather than forcing a manual retry via a whole
// second button click (and, for a known device, having forgotten it in the meantime — see the
// forgetKnownDevice call below, now only reached once every attempt here has failed). Retries
// reuse GATT_RECONNECT_TIMEOUT_MS's own reasoning: only the first attempt gets the full
// GATT_CONNECT_TIMEOUT_MS budget, since a device that was reachable moments ago either connects
// quickly on a retry or is genuinely gone.
//
// Originally spaced these retries by a flat 500ms (GATT_CONNECT_RETRY_DELAY_MS, since removed) —
// confirmed in the field as nowhere near enough on at least one real deployment: all 3 attempts
// failed identically, only 500ms apart, with the exact error this loop exists to retry past. A
// failed attempt now waits out the same RECONNECT_COOLDOWN_MS as an actual disconnect before
// trying again (see connectAndVerify's own call to waitOutReconnectCooldown, further down) —
// unlike a flat per-loop delay, that scales with whatever this environment's own Bluetooth stack
// actually needs, the same real-world grace period a slow *manual* retry click used to provide
// by accident before this loop's own automation replaced it.
const GATT_CONNECT_ATTEMPTS = 3;

// getPrimaryService()/getCharacteristic()/readValue() below have no spec-guaranteed timeout of
// their own either — against a connection device.gatt.connected still calls "connected" but that
// is, in practice, otherwise stuck, these have been observed to simply hang, same as
// gatt.connect() itself (see GATT_CONNECT_TIMEOUT_MS above). Without this, that hang happens
// *inside* the try block, so it never reaches the catch below at all — no retry, no log, no
// status update, nothing — which looked exactly like the whole attempt had silently vanished.
const DEVICE_INFO_READ_TIMEOUT_MS = 5000;

// Gives the newly-established link a moment to settle before the first real GATT traffic on it
// — full service/characteristic discovery, which reading DeviceInfo triggers implicitly — same
// idea as NOTIFY_SETTLE_MS elsewhere in this file, just for the connect step instead of the
// notify step. Confirmed in the field against a phone sitting a stable ~8ft from the laptop
// (rock solid once actually connected and streaming data, even much further away) that every
// DEVICE_INFO_ATTEMPTS retry was still failing the exact same way: gatt.connect() itself
// resolving quickly every time, but the link dying again within 1-3s, before discovery could
// finish — physical range wasn't the variable. That points at connection-parameter negotiation
// (the peripheral's BLE stack settling from its initial, often conservative connection interval
// to a stable one) rather than a discovery-not-settled-yet timing race retries alone can outlast
// — this doesn't replace the retry loop below (a genuinely unreachable phone still needs that),
// it just gives each attempt a better chance of landing inside the settled window instead of the
// unstable one right after connect(), rather than only ever retrying through it.
//
// 500ms turned out not to be generous enough on at least one real deployment: confirmed via
// timestamped logs (2026-08-31) — a genuinely fresh connect (no prior session with this device at
// all that session, the phone's own screen/app confirmed staying foregrounded throughout, so not
// Android backgrounding it) still failed on all 3 DEVICE_INFO_ATTEMPTS, each one dying with "GATT
// Server is disconnected" landing almost exactly 500ms after gatt.connect() resolved — i.e. right
// when this wait ends and the first real GATT call fires, not evidence the link had already died
// earlier. Raised well past that single data point's minimum, same reasoning as
// RECONNECT_COOLDOWN_MS's own doc: the cost of settling for longer than strictly necessary is a
// barely-noticeable pause, versus a verification attempt landing in the unstable window and
// failing outright.
const GATT_CONNECT_SETTLE_MS = 2000;

async function readDeviceInfoFromService(service) {
  const infoChar = await service.getCharacteristic(DEVICE_INFO_CHAR_UUID);
  return decodeJson(await infoChar.readValue());
}

async function readDeviceInfo(server) {
  const service = await server.getPrimaryService(SERVICE_UUID);
  return readDeviceInfoFromService(service);
}

// The rejection this manufactures when [ms] wins the race is tagged .isTimeout so a caller can
// tell "our own budget ran out" apart from a real GATT exception the underlying promise itself
// rejected with — that distinction matters because losing this race never cancels the real
// operation still running underneath (Web Bluetooth has no such mechanism): the browser can
// still be mid-way through it long after this has already moved on, ready to collide with
// whatever GATT call comes next and fail it with `GATT operation already in progress` —
// confirmed in the field as exactly that, repeatedly, after a mid-pull DeviceInfo refresh timed
// out. A caller that knows *why* a failure happened can react appropriately (e.g.
// pullAndSyncConnectedPhone treating this specific case as unrecoverable immediately, rather
// than waiting out several more guaranteed collisions with the same still-stuck operation).
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => {
      const err = new Error(message);
      err.isTimeout = true;
      reject(err);
    }, ms)),
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
  let server;
  let lastConnectError = null;
  for (let attempt = 1; attempt <= GATT_CONNECT_ATTEMPTS; attempt++) {
    onProgress(attempt === 1
      ? `Connecting to "${label}"…`
      : `Connecting to "${label}"… (attempt ${attempt}/${GATT_CONNECT_ATTEMPTS})`);
    try {
      server = await withTimeout(
        device.gatt.connect(),
        attempt === 1 ? GATT_CONNECT_TIMEOUT_MS : GATT_RECONNECT_TIMEOUT_MS,
        `Timed out connecting to "${label}" — it may be out of range or turned off.`,
      );
      lastConnectError = null;
      break;
    } catch (e) {
      lastConnectError = e;
      bleWarn(`[mule-ble] GATT connect attempt ${attempt}/${GATT_CONNECT_ATTEMPTS} failed for "${label}"`, e);
      if (attempt < GATT_CONNECT_ATTEMPTS) {
        // GATT_CONNECT_RETRY_DELAY_MS (500ms) alone, confirmed in the field (2026-08-31, three
        // days after this retry loop was added), is not enough real recovery time on at least
        // one real deployment: all 3 attempts failed identically with the exact
        // "Connection attempt failed." error this loop exists to retry past, even after a full
        // RECONNECT_COOLDOWN_MS wait had already been sat out before attempt 1 itself. Before
        // this retry loop existed at all, a failed connect needed a fresh *manual* click to
        // succeed — which, just by requiring a human to notice and react, imposed far more real
        // spacing between attempts than 500ms ever did; this loop's own automation removed that
        // incidental grace period without replacing it, which is the regression this restores by
        // treating a failed attempt exactly like a disconnect (see waitOutReconnectCooldown's own
        // doc) — a real connection attempt just ended, whether it ever fully connected or not.
        lastDisconnectAt = Date.now();
        await waitOutReconnectCooldown(label, onProgress);
      }
    }
  }
  if (lastConnectError) {
    // Any failure here — including a remembered device that's no longer reachable under the
    // identity it was recognised by, e.g. its BLE address rotated after an app update/restart —
    // means this entry is stale. Forgetting it now (rather than only ever on a DeviceInfo
    // failure further down) is what stops it lingering forever as a dead "Reconnect to X"
    // choice once a fresh pick of the same phone gets remembered under a new id alongside it.
    forgetKnownDevice(device.id);
    bleError(`[mule-ble] GATT connect failed for "${label}" after ${GATT_CONNECT_ATTEMPTS} attempts`, lastConnectError);
    throw new Error(lastConnectError.message || `Couldn't connect to "${label}" — it may be out of range, turned off, or no longer available. Try "Pick a different phone…" to select it fresh.`);
  }

  // The connection can drop again right after connect() resolves — a genuine disconnect, not
  // just the discovery-not-settled-yet timing race this loop was originally written for (that
  // one's still real too, hence still retrying rather than failing outright on attempt 1). The
  // two need telling apart: retrying getPrimaryService() against a server that's actually gone
  // can never succeed and just repeats the identical failure every time (confirmed against a
  // real "GATT Server is disconnected" log where all 3 attempts failed identically) — so each
  // attempt re-establishes the connection first whenever it's found dropped.
  //
  // GATT_CONNECT_SETTLE_MS (see its own doc) before the very first verification attempt too —
  // this is the freshest the link ever is, so the settle window matters here at least as much as
  // before any retry below.
  await new Promise(r => setTimeout(r, GATT_CONNECT_SETTLE_MS));
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
      // Reconnects before every retry now, not just when device.gatt.connected already reads
      // false — Web Bluetooth allows only one GATT operation in flight per device at a time and
      // gives no way to cancel one still pending, including one DEVICE_INFO_READ_TIMEOUT_MS
      // below just gave up *waiting* on: that timeout losing the withTimeout() race does not
      // mean the browser actually abandoned the real getPrimaryService/readValue call
      // underneath, and device.gatt.connected keeps reading true throughout since the link
      // itself never dropped. Retrying readDeviceInfo() straight against that same still-open
      // connection collided with the still-in-flight prior attempt every time — confirmed in the
      // field as `NetworkError: GATT operation already in progress` on every retry after the
      // very first read ever timed out, guaranteed, not occasional, making the whole attempt
      // fail outright once that first hang happened. A full disconnect+reconnect between every
      // retry is what actually resets that stuck per-device operation queue — tearing the link
      // down and rebuilding it is the closest thing Web Bluetooth has to cancelling a stuck
      // operation.
      if (attempt > 1) {
        onProgress(`Reconnecting to "${label}"… (attempt ${attempt}/${DEVICE_INFO_ATTEMPTS})`);
        bleWarn(`[mule-ble] reconnecting before DeviceInfo attempt ${attempt}/${DEVICE_INFO_ATTEMPTS}`);
        if (device.gatt.connected) {
          // Marked deliberate first, same as disconnectPhone() itself (see its own doc on why
          // this order matters) — this is our own cleanup disconnect, not a real drop, and a
          // stale 'gattserverdisconnected' listener a past successful connection to this same
          // remembered device left attached (see this function's own addEventListener call
          // below, never removed) would otherwise report it as an unexpected one.
          deliberateDisconnect = true;
          device.gatt.disconnect();
        } else {
          // Confirmed in the field: device.gatt.connected can already read false here — the
          // previous attempt's own GATT call (e.g. getPrimaryService) already failed with "GATT
          // Server is disconnected" — without the 'gattserverdisconnected' event ever having
          // fired (at least not yet — forgetConnection(), which is the only other place
          // lastDisconnectAt updates, never ran, confirmed by its own bleLog line being absent
          // from the console around this failure). Left alone, waitOutReconnectCooldown() below
          // then measures against a stale-or-zero lastDisconnectAt and finds "plenty of time has
          // passed" when in fact the link only just died — skipping the wait it most needs to do
          // here. Treating arriving in this branch at all as proof enough that the link just
          // ended, regardless of whether the browser's own event has (or ever will) confirm it.
          lastDisconnectAt = Date.now();
        }
        // See RECONNECT_COOLDOWN_MS's own doc — this forced reconnect is exactly the case that
        // data came from: it used to go straight to gatt.connect() with no cushion at all,
        // regardless of which outer path (picker or known-device) got here, and reproduced the
        // same DeviceInfo-read instability every time.
        await waitOutReconnectCooldown(label, onProgress);
        server = await withTimeout(
          device.gatt.connect(), GATT_RECONNECT_TIMEOUT_MS,
          `Timed out reconnecting to "${label}".`,
        );
        // Same GATT_CONNECT_SETTLE_MS reasoning as before the first attempt above — this
        // reconnect is just as fresh a link as that one was.
        await new Promise(r => setTimeout(r, GATT_CONNECT_SETTLE_MS));
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
    // Marked deliberate first (see the retry loop's own matching comment above) — this cleanup
    // disconnect is ours, not a real drop, and a stale listener from a past successful
    // connection to this same remembered device would otherwise report it as an unexpected one.
    if (!keptDisconnecting) deliberateDisconnect = true;
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
  // See rememberDevice's own doc — true here means this same phone (by name) was already known
  // under a different device.id, the signature of a rotated Android BLE address (this protocol
  // doesn't bond, so there's no other way to notice — see the rotating-identity doc further up
  // this file). Attached directly onto the returned DeviceInfo (a fresh object from decodeJson
  // each call, so this can't leak into anything else) rather than changing this function's own
  // return shape, since connectToPhone/reconnectToKnownDevice both hand this straight back to
  // their own caller as-is and existing callers/tests read specific fields off it already.
  deviceInfo.addressRotated = rememberDevice(device.id, deviceInfo.deviceName || deviceInfo.deviceId);
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
  // Both UUIDs live in one filter object's services array, so a device must advertise BOTH to
  // match (Web Bluetooth's own "advertised UUIDs must be a superset of filter.services"
  // semantics) — not just our GATT service, but specifically MULE_MODE_MARKER_SERVICE_UUID too,
  // which racemaster-mobile only advertises while actually in Mule Mode (see its own doc). Every
  // other nearby racemaster-mobile phone (Time/Bibs/CP) still runs the exact same GATT
  // peripheral this file could otherwise connect to — this filter is purely so the operator
  // doesn't have to trial-and-error through the picker to find the one phone that's actually
  // meant to be pulled from directly. A phone on an older build that predates this marker simply
  // won't advertise it and so won't appear, same as it wouldn't have shown a meaningful name
  // before this either.
  bleLog(`[mule-ble] requestDevice() filter: services=[${SERVICE_UUID}, ${MULE_MODE_MARKER_SERVICE_UUID}]`);
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID, MULE_MODE_MARKER_SERVICE_UUID] }],
  });
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
  // See RECONNECT_COOLDOWN_MS's own doc — this is the path that skips requestDevice()'s own
  // real-world scan delay, so it's the one that actually needs an explicit wait here, unlike
  // connectToPhone() below.
  await waitOutReconnectCooldown(device.name || device.id, onProgress);
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
    // Raced against a timeout like every other bare GATT call in this file (see
    // DEVICE_INFO_READ_TIMEOUT_MS's own doc) — without it, a phone that's just gone out of range
    // left this hanging indefinitely rather than failing, confirmed in the field at ~10.6s for
    // one real drop and with no guaranteed upper bound at all. That mattered more once
    // mobile-files.js's own auto-pull loop started awaiting each pull before scheduling the next
    // (see scheduleNextAutoPull's own doc) — an unbounded hang here now stalls the *entire* loop,
    // not just this one tick.
    service = await withTimeout(
      connectedDevice.gatt.getPrimaryService(SERVICE_UUID), DEVICE_INFO_READ_TIMEOUT_MS,
      'Timed out getting the primary service — the connection may be dead despite isConnected() still reading true.',
    );
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
  // Re-read DeviceInfo fresh on every call rather than trusting connectedInfo (the connect-time
  // snapshot) — relayCount, unlike raceLabel, is a genuinely dynamic quantity: it drops as
  // relayed data finishes syncing away and rises as another device relays something new through
  // this one. Trusting the stale snapshot meant this function could never notice either
  // direction happening mid-connection: once relayCount was ever >0 at connect time, it kept
  // re-fetching the (potentially large, chunked) relay manifest on every single auto-pull tick
  // forever, even long after relayCount had genuinely dropped back to 0 — confirmed in the field
  // as continuous, pointless BLE traffic against an otherwise fully idle phone.
  //
  // Aborts the whole pull on failure here, same as the getPrimaryService call just above — no
  // "use the last-known copy and carry on" fallback. That fallback used to exist on the theory
  // that a single transient hiccup on this one read shouldn't cost the legs below a chance to
  // still succeed, but a failure here specifically via DEVICE_INFO_READ_TIMEOUT_MS below means
  // this waited the *entire* timeout budget with zero response — every bit as strong a "this
  // connection is dead" signal as getPrimaryService failing, not a one-off glitch on an
  // otherwise-healthy link. Confirmed in the field: continuing past a real timeout here every
  // time just cascaded into the exact same "GATT Server is disconnected" failure on every relay
  // leg below, one after another, for nothing but log noise — the fallback never once actually
  // salvaged a leg the abort-early path would have missed.
  let deviceInfo;
  try {
    deviceInfo = await withTimeout(
      readDeviceInfoFromService(service), DEVICE_INFO_READ_TIMEOUT_MS,
      'Timed out refreshing DeviceInfo before pulling.',
    );
  } catch (e) {
    // Logged explicitly here for the same reason as the getPrimaryService catch above — this
    // has no try/catch of its own further out to fall into and log via, so without this the
    // failure would propagate silently as far as this file's own diagnostic trail is concerned.
    bleError('[mule-ble] pull failed: could not refresh DeviceInfo (connection may be dead despite isConnected() still reading true)', e);
    throw e;
  }
  connectedInfo = deviceInfo;

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

  // Only bothered with at all when relayCount says there's something to fetch, so a leaf
  // Time/Bibs/CP phone (always relayCount 0) never pays this extra round trip. Beyond that,
  // cachedRelayEntries (see its own doc above) is reused as-is whenever relayManifestCacheKey()
  // (below) reports no change since it was last fetched — an *existing* origin's own new data is
  // picked up by its own per-origin delta pull below via its cursor regardless, with no need to
  // re-fetch the manifest just to learn that. This is what turns "refetch the whole manifest
  // every single auto-pull tick, forever" into "refetch only when the manifest's actual content
  // last changed." A failure here is treated the same as any other leg failing (see the
  // try/catch pattern above/below) — logged and pushed onto errors, never discarding whatever
  // the own-race leg above already retrieved, and never left cached under a key it wasn't
  // actually fetched for.
  let relayEntries = [];
  if (deviceInfo.relayCount > 0) {
    const cacheKey = relayManifestCacheKey(deviceInfo);
    if (cachedRelayEntries && cachedRelayManifestKey === cacheKey) {
      relayEntries = cachedRelayEntries;
    } else {
      try {
        relayEntries = await pullRelayManifestEntries(service);
        cachedRelayEntries = relayEntries;
        cachedRelayManifestKey = cacheKey;
      } catch (e) {
        bleError('[mule-ble] failed to fetch relay manifest', e);
        errors.push(e);
      }
    }
  } else {
    cachedRelayEntries = null;
    cachedRelayManifestKey = null;
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