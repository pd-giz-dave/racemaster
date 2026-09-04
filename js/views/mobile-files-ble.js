'use strict';

// The Bluetooth connect/poll/sync engine — connects to a Mule phone, pulls its history on a
// timer, pushes each pull to the server (or keeps it pending if unreachable), and reports
// connection state to the header/status UI. This is where every field-driven BLE reliability
// fix in this app's history has lived; see mule-ble.js's own extensive doc comments for the
// underlying GATT-layer reasoning this file builds on.
//
// Needs to trigger mobile-files.js's own renderMobileFiles() in several places, and needs read
// access to its lastKnownRaces cache — rather than importing mobile-files.js directly (which
// would create a circular import: mobile-files.js needs to import onConnectButtonClick/
// onRefreshButtonClick/wireBleControls from here to wire buttons, and this file would need
// renderMobileFiles back), both are injected once via initBle() instead. See mobile-files.js's
// own doc on this for the full reasoning.

import {
  getSession, getIsAdmin, getUsername, apiPushMobileSync,
  getPendingMobileFiles, savePendingMobileFile,
} from '../storage.js';
import { on, getEl, showConfirmDialog, showChoiceDialog, showStatus } from '../ui.js';
import { ts } from '../utils.js';
import {
  isBluetoothAvailable, connectToPhone as bleConnect, pullFromConnectedPhone,
  disconnectPhone, isConnected, getConnectedDeviceName, onDisconnect,
  getRecommendedPollIntervalMs, isBleLoggingEnabled, setBleLoggingEnabled,
  getKnownDevices, reconnectToKnownDevice, abandonConnection, forgetKnownDevice,
  getConnectedDeviceInfo, getRaceStaleAfterDays, setRaceStaleAfterDays, isRecoveringGattOperation,
} from '../mule-ble.js';
import { recordBleLastSeen, mergePendingIntoRaces } from '../mobile-files-shared.js';
import { renderRaceList } from './mobile-files-devices.js';

// Injected by mobile-files.js's own wireMobileFiles() — see this file's own top-of-file doc for
// why these are dependency-injected rather than imported directly.
let renderAll = null;
let getLastKnownRaces = null;
export function initBle({ renderAll: r, getLastKnownRaces: g }) {
  renderAll = r;
  getLastKnownRaces = g;
}

// Gated the same way mule-ble.js's own bleLog is — routine tracing only, off by default.
function debugLog(...args) { if (isBleLoggingEnabled()) console.log(`[${ts()}]`, ...args); }

// HH:MM:SS only — the poll-status line below is meant for a glance at "when did this last
// change", not the millisecond precision ts() (above) exists for in debug logging.
function nowClock() {
  return new Date().toTimeString().slice(0, 8);
}

// The most recent real poll outcome ("Last poll …" / "Poll failed …") — always shown verbatim,
// in full, on its own line (see updatePollStatus below); never grown with a "— polling…" suffix
// or anything else, so this line's own length (and so its wrap point) stays fixed for the whole
// gap between ticks rather than jumping every time one starts or ends. Reset (with the element
// itself) on disconnect — see updateConnectButtonLabel().
let lastPollStatusText = '';

// How many poll attempts (auto-tick or manual Connect/Refresh, successful or not — see
// pullAndSyncConnectedPhone's own increment) have been made since the *current* connection was
// established. Deliberately NOT reset the instant that connection ends — see
// updateConnectButtonLabel()'s own doc — only once a fresh one actually succeeds (see
// onConnectButtonClick), so a disconnect doesn't itself zero out what's still on screen.
let pollCount = 0;

// Persistent (until the next poll updates it, or the connection ends) feedback that a
// background auto-pull is actually happening — separate from showStatus()'s own toast, which
// auto-clears after ~10s and, for a silent auto-pull tick that found nothing new, was never
// shown at all (see pullAndSyncConnectedPhone's own silent-and-empty early return, now moved
// past this update rather than before it). Hidden outright whenever not connected — see
// updateConnectButtonLabel() below, which already runs on every connect/disconnect transition.
function updatePollStatus(text) {
  const el = getEl('mobile-files-poll-status');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

export function updateConnectButtonLabel() {
  const btn = getEl('btn-connect-phone');
  if (!btn) return;
  btn.textContent = isConnected()
    ? (connectionIssue ? `⚠ ${getConnectedDeviceName()} not responding — Disconnect?` : `Disconnect from ${getConnectedDeviceName()}`)
    : connectAttemptInProgress ? 'Connecting…'
    : 'Connect to Phone…';
  btn.disabled = connectAttemptInProgress;
  // Echoes getRecommendedPollIntervalMs() so it's visible whether auto-sync is even running and
  // at what cadence, rather than something only inferable from timestamps in the console. The
  // "— polling…" suffix (in-flight feedback — see pullInProgress) lives here rather than on the
  // "Last poll …" line above: that line's own text is what actually varies in length (a record
  // count, a relay count, an error message), so appending anything to *it* while a poll is
  // running made the whole status area jump/rewrap every single tick. This line's own text barely
  // varies (just the interval, and now the suffix), so it doesn't have that problem.
  const pollEl = getEl('mobile-files-poll-interval');
  if (pollEl) {
    if (isConnected()) {
      // Poll count sits between the interval and the in-flight suffix — see pollCount's own doc;
      // includes whichever poll is currently running, so "3 polls — polling…" reads as "this is
      // the 3rd", not "3 have finished and a 4th, uncounted, is also happening".
      const suffix = pullInProgress ? ' — polling…' : '';
      pollEl.textContent = `Auto-polling every ${Math.round(getRecommendedPollIntervalMs() / 1000)}s`
        + ` — ${pollCount} poll${pollCount === 1 ? '' : 's'}${suffix}`;
      pollEl.hidden = false;
    } else {
      // pollCount is deliberately NOT reset here — see its own doc: it stays exactly as it was
      // for the connection that just ended, right up until a fresh one actually succeeds (see
      // onConnectButtonClick), so it still shows once the link drops rather than vanishing (or
      // silently zeroing) the instant it does. "Auto-polling every Ns" itself is dropped from
      // the wording here, though — that part genuinely isn't true any more.
      if (pollCount > 0) {
        pollEl.textContent = `${pollCount} poll${pollCount === 1 ? '' : 's'}`;
        pollEl.hidden = false;
      } else {
        pollEl.hidden = true;
      }
      lastPollStatusText = ''; // stale — a fresh connection's first poll shouldn't inherit it
      updatePollStatus(null); // no connection left to report poll activity for
    }
  }
}

// Re-pulls periodically while connected — without this, a connected phone only ever got pulled
// once, at the moment "Connect to Phone…" was clicked, so any splits/bibs recorded afterward just
// sat on the phone unsynced until the operator manually disconnected and reconnected (re-opening
// the browser's native device picker each time). The cadence itself isn't ours to pick: the phone
// reports it via getRecommendedPollIntervalMs() (DeviceInfo.pollIntervalMs), so this stays in
// step with whatever racemaster-mobile's own MuleGattProfile.RECOMMENDED_POLL_INTERVAL_MS is,
// rather than a second hardcoded copy here drifting out of sync with it.
//
// A self-rescheduling setTimeout, not setInterval — a plain setInterval fires at a truly fixed
// period, and that period is the exact same MuleGattProfile.RECOMMENDED_POLL_INTERVAL_MS the
// connected phone's own MuleSyncEngine uses for its own steady-state auto-sync loop (see that
// class's AUTO_SYNC_INTERVAL — unlike its one-off FIRST_SIGHTING_JITTER, which only staggers
// newly-discovered devices apart from each other, that steady-state loop has no jitter of its
// own once running). Two independent, unjittered, same-period timers settle into whatever
// relative phase they happened to start at — purely an accident of when the phone booted versus
// when the operator clicked Connect — and then never drift apart again, confirmed as a real risk
// in the field: this browser's own pull traffic could land on top of that same phone's own
// native mesh radio activity on every single tick, not just occasionally. Re-randomizing the
// delay before every tick (JITTER_FRACTION below) keeps this side's timing continuously
// wandering relative to the phone's fixed cadence instead of freezing into one unlucky phase
// forever — it doesn't stop an occasional overlap (nothing can, and the existing retry/timeout
// handling already tolerates that fine), it stops a persistent, repeating one.
const JITTER_FRACTION = 0.2; // ±20% of the base interval
let autoPullTimer = null;

// Guards against overlapping pulls — a slow BLE transfer (large history, weak signal) could
// still be in flight when the next timer tick or a manual Refresh click fires.
let pullInProgress = false;

function scheduleNextAutoPull(baseIntervalMs) {
  const jitteredMs = baseIntervalMs * (1 + (Math.random() * 2 - 1) * JITTER_FRACTION);
  autoPullTimer = setTimeout(async () => {
    debugLog(`[mobile-files] auto-pull tick for "${getConnectedDeviceName() || 'unknown device'}"`);
    // Awaited, not fire-and-forget — a pull can run long (several relay legs pulled
    // sequentially, each its own GATT round trip, occasionally hitting the 15s pull timeout),
    // easily longer than this loop's own ~10s base interval. Scheduling the next tick on a fixed
    // cadence regardless (the original approach) meant ticks kept arriving mid-pull, tripping
    // pullInProgress's guard and getting discarded — confirmed in the field as a steady stream of
    // "already in progress" skips instead of the intended one-in-flight-at-a-time cadence.
    // Waiting here means each tick's own gap is measured from the previous pull's actual finish,
    // not from when it merely started.
    await pullAndSyncConnectedPhone({ silent: true });
    // stopAutoPull() (e.g. onBleDisconnected firing because the phone dropped mid-pull) may have
    // nulled autoPullTimer while the await above was in flight — reschedule only if this loop is
    // still meant to be running, or a stopped auto-pull would silently start itself back up one
    // tick later.
    if (autoPullTimer !== null) scheduleNextAutoPull(baseIntervalMs);
  }, jitteredMs);
}

function startAutoPull() {
  stopAutoPull();
  const intervalMs = getRecommendedPollIntervalMs();
  debugLog(`[mobile-files] starting auto-pull for "${getConnectedDeviceName() || 'unknown device'}" every ~${intervalMs}ms (±${JITTER_FRACTION * 100}% jitter)`);
  scheduleNextAutoPull(intervalMs);
}

function stopAutoPull() {
  if (autoPullTimer !== null) {
    clearTimeout(autoPullTimer);
    autoPullTimer = null;
  }
}

// Guards against a second click starting a whole new overlapping connect attempt while one is
// still in flight. This matters more than the usual double-click debounce: Web Bluetooth gives
// no way to cancel device.gatt.connect() once started — mule-ble.js's own GATT_CONNECT_TIMEOUT_MS
// only stops *our* code from waiting on a hung attempt, it can't stop the real one still alive
// inside the browser/BlueZ. A second click piling a fresh connect attempt on top of that risks
// wedging Chromium's Bluetooth backend further rather than just wasting a retry.
let connectAttemptInProgress = false;

// Set when a pull genuinely fails while still nominally connected (see pullAndSyncConnectedPhone
// below) — the case a status toast alone doesn't cover well, since it auto-clears after ~10s and
// then there's nothing left showing anything was ever wrong. BLE's own supervision timeout can
// leave a dead-in-practice link reporting isConnected() true for a surprisingly long time before
// the formal disconnect event ever fires, so this is what persistently reflects "the connection
// is there, but it isn't actually working" on the button itself for that whole window, rather
// than only in a toast that fades.
let connectionIssue = false;

// Counts consecutive pull failures while still nominally connected — once this crosses
// PERSISTENT_FAILURE_THRESHOLD, the connection is treated as unrecoverable (see
// abandonConnection's own doc for why this deliberately does NOT attempt to reconnect
// automatically) rather than just reporting the same failure again forever. Reset to 0 on any
// successful pull.
let consecutivePullFailures = 0;
const PERSISTENT_FAILURE_THRESHOLD = 3;

// getConnectedDeviceName() is already null by the time an unexpected disconnect is reported
// (mule-ble.js's forgetConnection clears its own state before notifying this file) — kept here,
// updated on every successful connect, so the header banner below can still name the phone that
// was just lost.
let lastConnectedDeviceName = null;

// A showStatus() toast alone isn't enough for an unexpected drop — it auto-clears after ~10s,
// and the whole point here is that the operator may not even be looking at the page right when
// it happens (this app is expected to eventually drive auto-generated results with the operator
// elsewhere — see ToDo.MD). This is a persistent header badge instead, visible from any view,
// that only clears on deliberate operator action: the "I know" dismiss button, or starting a
// fresh manual connect attempt (see onConnectButtonClick, which hides it unconditionally as
// soon as the button is clicked either way) — never on a timer.
function showBleLostBanner(name) {
  const el = getEl('header-ble-warning');
  if (!el) return;
  el.hidden = false;
  el.style.color = '#333';
  el.style.background = 'var(--header-warn)';
  el.style.padding = '2px 6px';
  el.style.borderRadius = '3px';
  el.textContent = '';
  el.append(` ⚠ Lost connection to "${name || 'phone'}" `); // text node — safe even though name is phone-reported, untrusted text
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'I know';
  dismissBtn.style.cssText = 'margin-left:6px;font-size:0.8em;padding:1px 6px;border:none;border-radius:3px;cursor:pointer';
  dismissBtn.addEventListener('click', hideBleLostBanner);
  el.append(dismissBtn);
}

function hideBleLostBanner() {
  const el = getEl('header-ble-warning');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

// wasDeliberate comes straight from mule-ble.js's onDisconnect (see its own doc) — computed
// fresh there from disconnectPhone()'s own tracking every time this fires, rather than this
// file keeping its own parallel "did we expect this" flag that a manual pre-emptive call below
// (see onConnectButtonClick's disconnect branch) could leave stuck true past the one disconnect
// it was meant for, misreporting a later, genuinely unexpected drop as expected too.
function onBleDisconnected(wasDeliberate) {
  // mule-ble.js's own pullFromConnectedPhone() is already reconnecting to clear a stuck GATT
  // operation (see withGattRecovery's own doc) — this event is just that recovery's own
  // disconnect, not the session actually ending, so there's nothing here to react to: no
  // stopAutoPull(), no button/UI change, nothing. Checked first, before any of that runs.
  if (isRecoveringGattOperation()) {
    debugLog(`[mobile-files] disconnected mid-recovery (expected — mule-ble.js is reconnecting to clear a stuck GATT operation) for "${lastConnectedDeviceName || 'unknown device'}"`);
    return;
  }
  stopAutoPull();
  connectionIssue = false; // moot once the link has formally ended — don't let it linger into a later, genuinely fresh connection
  consecutivePullFailures = 0;
  updateConnectButtonLabel();
  if (wasDeliberate) {
    debugLog(`[mobile-files] disconnected (expected) for "${lastConnectedDeviceName || 'unknown device'}"`);
  } else if (connectAttemptInProgress) {
    // A drop right after gatt.connect() resolves but before DeviceInfo verification settles is
    // an expected part of connectAndVerify's own retry loop (see its own doc on the
    // discovery-not-settled-yet timing race) — its onProgress callback (wired straight to
    // showStatus by the caller below) already reports each retry attempt on its own, so this
    // isn't a genuine "was connected, now lost" event needing this generic banner too. That
    // mattered in practice: unlike showStatus, showBleLostBanner() is a persistent element that
    // only ever clears via the operator's own dismiss click or the *next* button click's
    // hideBleLostBanner() call (see onConnectButtonClick's own doc on that) — neither of which
    // happens automatically when this same reconnect attempt then goes on to succeed a few
    // seconds later. Showing it here left a fully successful reconnect looking stuck on "Lost
    // Bluetooth connection" — confirmed in the field as exactly this: a reconnect that plainly
    // worked (pulls succeeding right after) with a stale failure banner still sitting over it.
    // No device name available here worth trusting: this fires mid-reconnect, before
    // mule-ble.js's own connectAndVerify has ever assigned connectedInfo for *this* attempt, so
    // lastConnectedDeviceName (see above) would only echo the *previous* session's name, which
    // could be flat wrong for a fresh picker pick of a different phone. mule-ble.js's own
    // "reconnecting before DeviceInfo attempt…" line already names the right device for this
    // exact moment — this one deliberately doesn't guess.
    debugLog('[mobile-files] disconnected mid-connect-attempt (expected — connectAndVerify is retrying)');
  } else {
    // Never gated behind the logging toggle — same reasoning as mule-ble.js's own bleError: a
    // real problem needs to be visible even if that toggle was left off. Deliberately no
    // automatic reconnect attempt (see abandonConnection's own doc) — a fresh, manual Connect to
    // Phone… is what's actually proven to work after a drop, so that's what this asks for.
    console.error('[mobile-files] Bluetooth connection lost unexpectedly');
    showStatus('Lost the Bluetooth connection — click Connect to Phone… to reconnect.', true);
    showBleLostBanner(lastConnectedDeviceName);
  }
}

// Re-renders the Devices table from already-cached data (lastKnownRaces + current pending
// files) — no server fetch, unlike renderAll() itself. Used by a silent auto-pull tick that
// found nothing new to sync (see pullAndSyncConnectedPhone below): the table still needs
// refreshing so its Last Seen column picks up recordBleLastSeen()'s update for this poll (BLE
// last-seen tracking, see mobile-files-shared.js), but a full renderAll() call every ~10s purely
// for that would mean an extra server round trip, and its own "Loading…" status flicker, on
// every single tick.
function refreshDevicesTableFromCache() {
  const pending = getPendingMobileFiles().filter(f => f.owner === getUsername());
  renderRaceList(mergePendingIntoRaces(getLastKnownRaces(), pending), getIsAdmin());
}

// Pulls whatever history the currently-connected phone is holding, pushing each device
// straight to the server exactly like a WiFi sync would. If the server can't be reached (the
// expected case out in the field, with no internet), each pull is kept locally as "pending"
// instead — see storage.js's savePendingMobileFile — until a Push action later succeeds.
// [silent] suppresses the status toast/full server-fetching re-render when there's nothing new
// (see refreshDevicesTableFromCache() just above for the lighter-weight refresh that still runs)
// — used by the background auto-pull tick above so it doesn't spam a toast every 10s when the
// phone simply hasn't recorded anything new since the last pull; an explicit Connect/Refresh
// click always reports, even when the result is empty, so the operator gets confirmation the
// action ran.
export async function pullAndSyncConnectedPhone({ silent = false } = {}) {
  debugLog(`[mobile-files] pull requested (silent=${silent}) for "${getConnectedDeviceName() || 'unknown device'}"`);
  if (pullInProgress) { debugLog(`[mobile-files] pull skipped — a pull is already in progress for "${getConnectedDeviceName() || 'unknown device'}"`); return; }
  if (!isConnected()) {
    // Real, reproducible case: the phone can drop the GATT link while sitting idle (e.g.
    // Android backgrounding it while the operator is still looking at the "Connect to X?"
    // confirm dialog below) — onDisconnect's own listener already reverted the button, but
    // without this the caller was left showing "Connected… pulling history…" forever with no
    // further feedback, since this returned with nothing at all.
    // getConnectedDeviceName() is already null now the link's gone — lastConnectedDeviceName
    // (see its own doc) is what still names the phone that was just lost.
    debugLog(`[mobile-files] pull skipped — not connected to "${lastConnectedDeviceName || 'unknown device'}"`);
    if (!silent) showStatus('Lost the Bluetooth connection — click Connect to Phone… again.', true);
    return;
  }
  const session  = getSession();
  const username = getUsername();
  if (!session || !username) {
    debugLog('[mobile-files] pull skipped — not signed in');
    if (!silent) showStatus('Sign in on the Datasets page first.', true);
    return;
  }

  pullInProgress = true;
  pollCount++; // see its own doc — counts this attempt, whatever its outcome turns out to be
  updateConnectButtonLabel(); // shows the updated count, and "— polling…", on the interval line
  try {
    let pulled;
    try {
      pulled = await pullFromConnectedPhone();
    } catch (e) {
      // silent only ever means "nothing new" (see this function's own doc) — a genuine failure
      // must still surface even on a background auto-pull tick, or a connection that's dying but
      // hasn't yet fired the formal 'gattserverdisconnected' event (BLE's own supervision
      // timeout can leave a dead-in-practice link reporting isConnected() true for a
      // surprisingly long time) fails silently, tick after tick, with nothing shown until that
      // event eventually arrives — exactly the "no feedback" this was meant to prevent.
      //
      // Only shown while still nominally connected, though: if the link has already formally
      // ended by the time this catch runs (isConnected() false), onBleDisconnected already
      // reports whatever's appropriate for that (deliberate or not) — piling this pull's own
      // generic failure on top is redundant at best, and actively confusing when it races a
      // deliberate disconnect (a tick already in flight the instant "Disconnect from X" is
      // clicked fails this way purely because the user just ended the connection on purpose, not
      // because anything went wrong).
      if (isConnected()) {
        connectionIssue = true;
        consecutivePullFailures++;
        updateConnectButtonLabel();
        // e.isTimeout (see withTimeout's own doc in mule-ble.js) means this specific failure was
        // *our own* budget running out on a GATT call, not a real exception the connection threw
        // — and losing that race never cancels the real operation still running underneath. Left
        // alone, the very next auto-pull tick just collides with that still-in-flight ghost and
        // fails with `GATT operation already in progress`, and the one after that, and so on —
        // confirmed in the field as exactly this, PERSISTENT_FAILURE_THRESHOLD (3) times in a
        // row before this branch was ever reached the old way, all of it pure noise once the
        // first timeout had already made the outcome inevitable. Abandoning immediately on this
        // specific signal skips straight to the same conclusion the threshold below eventually
        // reaches anyway, without needing several more guaranteed collisions first.
        if (consecutivePullFailures >= PERSISTENT_FAILURE_THRESHOLD || e.isTimeout) {
          // Enough consecutive failures while still "connected" that waiting on
          // 'gattserverdisconnected' to eventually explain why isn't worth it any more — but
          // deliberately not attempting an automatic reconnect either (see abandonConnection's
          // own doc for why that turned out not to be worth the complexity). Just end the
          // connection cleanly and tell the operator plainly.
          consecutivePullFailures = 0;
          const name = getConnectedDeviceName();
          abandonConnection();
          connectionIssue = false;
          updateConnectButtonLabel();
          showStatus(`Lost the connection to "${name}" — it stopped responding. Click Connect to Phone… to reconnect.`, true);
          showBleLostBanner(name);
        } else {
          showStatus(e.message || 'Failed to pull history from the phone.', true);
          lastPollStatusText = `Poll failed at ${nowClock()} — ${e.message || 'unknown error'} (retrying)`;
          updatePollStatus(lastPollStatusText);
        }
      }
      return;
    }
    // A pull that actually succeeded (even an empty one — see the silent/totalLines check
    // below) is proof the link is genuinely working again, not just still nominally connected.
    consecutivePullFailures = 0;
    if (connectionIssue) { connectionIssue = false; updateConnectButtonLabel(); }
    // Recorded for every leg this pull touched, even one with zero new lines — see
    // mobile-files-shared.js's own BLE_LAST_SEEN_KEY doc for why device.lastSeen alone (server
    // mtime / a pending file's own pulledAt, neither of which changes when there's nothing new
    // to write) isn't enough on its own to reflect "we just successfully talked to this phone".
    for (const { raceLabel, deviceName } of pulled) recordBleLastSeen(username, raceLabel, deviceName);
    const totalLines = pulled.reduce((n, r) => n + r.lines.length, 0);
    // Echoes what the phone's own DeviceInfo reported alongside this pull (relayCount — how many
    // other devices it's currently relaying data for on this Mule's behalf) — refreshed by
    // pullFromConnectedPhone() itself on every call, so this is always this same poll's own
    // figure, never a stale connect-time one. Updated on *every* poll, even a silent tick that
    // found nothing new (the case the early return below used to leave with no visible change at
    // all) — that's the whole point: proof the background loop is actually still ticking.
    const info = getConnectedDeviceInfo();
    const relayPart = info && typeof info.relayCount === 'number'
      ? `, relaying ${info.relayCount} device${info.relayCount === 1 ? '' : 's'}`
      : '';
    lastPollStatusText =
      `Last poll ${nowClock()} — ${totalLines} new record${totalLines === 1 ? '' : 's'} `
      + `across ${pulled.length} device file${pulled.length === 1 ? '' : 's'}${relayPart}`;
    updatePollStatus(lastPollStatusText);
    if (silent && totalLines === 0) { refreshDevicesTableFromCache(); return; }

    let synced = 0, pending = 0;
    for (const { raceLabel, deviceName, deviceId, lines } of pulled) {
      let pushed;
      try {
        const result = await apiPushMobileSync(session.token, raceLabel, deviceName, lines);
        pushed = !result.error;
      } catch {
        pushed = false; // e.g. server unreachable — the expected case out in the field
      }
      if (pushed) {
        synced++;
      } else {
        savePendingMobileFile(username, raceLabel, deviceName, deviceId, lines);
        pending++;
      }
    }
    // renderAll() does its own server fetch and announces its own outcome ("Loading…", then
    // "Server unreachable…" if that fetch fails, which is the expected case out in the field
    // with no network) — awaited and ordered before our own summary below so that one doesn't
    // get shown only to be immediately overwritten by this, but the other way round.
    await renderAll();
    showStatus(silent
      // The background auto-pull tick found something new on its own, with no action from the
      // operator — worth calling out distinctly from a manual Connect/Refresh result so it
      // doesn't read as something they just did themselves.
      ? `Auto-sync: pulled ${totalLines} new record${totalLines === 1 ? '' : 's'} from ${getConnectedDeviceName()} (${synced} synced to the server, ${pending} saved locally).`
      : `Pulled ${pulled.length} device file${pulled.length === 1 ? '' : 's'}: ${synced} synced to the server, ${pending} saved locally.`);
  } finally {
    pullInProgress = false;
    updateConnectButtonLabel(); // clears the "— polling…" suffix now this tick is actually done
  }
}

// Connects to a nearby phone over Bluetooth (racemaster-mobile's Mule Mode — see mule-ble.js),
// pulls its history via pullAndSyncConnectedPhone above, then leaves the connection open with
// startAutoPull() running (button becomes "Disconnect from <device>") so a second click just
// ends the session rather than re-picking a device.
async function onConnectButtonClick() {
  debugLog(`[mobile-files] ===== Connect/Disconnect button clicked (currently ${isConnected() ? `connected to ${getConnectedDeviceName()}` : 'not connected'}) =====`);
  // Any interaction with this button — disconnecting or (re)connecting — counts as the operator
  // having seen and responded to a stale "connection lost" banner, per its own doc above.
  hideBleLostBanner();
  if (isConnected()) {
    disconnectPhone();
    // Immediate UI feedback rather than waiting on the real 'gattserverdisconnected' event —
    // that event still fires shortly after too (harmless second call; mule-ble.js's own
    // deliberateDisconnect correctly still reports true for it, since disconnectPhone() just set it).
    onBleDisconnected(true);
    showStatus('Disconnected from phone.');
    return;
  }

  if (connectAttemptInProgress) {
    showStatus('Still working on the previous connection attempt — wait for it to finish or time out first.', true);
    return;
  }

  const session  = getSession();
  const username = getUsername();
  if (!session || !username) { showStatus('Sign in on the Datasets page first.', true); return; }
  if (!isBluetoothAvailable()) {
    showStatus('Bluetooth is not available in this browser — use Chrome or Edge over HTTPS (or localhost).', true);
    return;
  }
  // A remembered phone (one already connected to and verified before) can be reconnected
  // directly, skipping the browser's own anonymous picker entirely — see getKnownDevices()'s
  // own doc for why that picker can never show a real name on its own. Always shown, even with
  // zero known devices, rather than skipping straight to the picker in that case — getKnownDevices()
  // itself is just a local read of already-granted permissions (see its own doc), not a scan, so
  // this dialog lets the operator see that first ("No known devices") and only trigger the
  // browser's real scan by deliberately clicking through to it.
  // Loops rather than returning after a Forget click — forgetting a stale/wrong entry is
  // typically the operator clearing clutter on the way to picking a *different* phone, not the
  // end of the interaction, so re-showing the (now-shorter) list lets them carry straight on
  // instead of having to click Connect to Phone… a second time.
  let known = await getKnownDevices();
  let chosenDevice = null;
  while (true) {
    const choices = known.map(k => ({
      label: k.name,
      buttons: [
        { label: 'Reconnect', value: { device: k.device } },
        { label: 'Forget', value: { forgetId: k.device.id }, danger: true },
      ],
    }));
    choices.push({ label: known.length ? 'Pick a different phone…' : 'Scan for a phone…', value: { other: true }, inline: true });
    const message = known.length ? 'Connect to which phone?' : 'No known devices.';
    const picked = await showChoiceDialog(message, choices, { vertical: true });
    if (picked === null) { showStatus('Cancelled.'); return; }
    if (picked.forgetId) {
      forgetKnownDevice(picked.forgetId);
      known = known.filter(k => k.device.id !== picked.forgetId);
      continue;
    }
    if (!picked.other) chosenDevice = picked.device;
    break;
  }

  connectAttemptInProgress = true;
  updateConnectButtonLabel();
  showStatus('Connecting…');
  let deviceInfo;
  try {
    // Passing showStatus straight through as the progress callback keeps the status bar
    // refreshed at each real step — its own 10s auto-clear otherwise fires regardless of
    // whether the connect attempt is actually done, making a still-in-progress retry look like
    // it silently gave up.
    deviceInfo = chosenDevice ? await reconnectToKnownDevice(chosenDevice, showStatus) : await bleConnect(showStatus);
  } catch (e) {
    // A timeout here means our own code gave up waiting, not that the browser did — Web
    // Bluetooth has no way to cancel the real device.gatt.connect() attempt underneath, so it
    // can still be alive inside Chromium/BlueZ after this. If that's left it wedged, no amount
    // of clicking this button again will help; only a page reload actually clears it.
    const hint = /timed out/i.test(e.message || '') ? ' If "Connect to Phone…" stops responding after this, reload the page and try again.' : '';
    showStatus(`${e.message || 'Bluetooth connection failed.'}${hint}`, true);
    return;
  } finally {
    connectAttemptInProgress = false;
    updateConnectButtonLabel();
  }

  // A device fresh from the browser's own anonymous picker still needs its real name confirmed
  // — this is the first point one is available at all. A remembered device was already chosen
  // by that same real name a moment ago, so there's nothing left here to confirm for it.
  if (!chosenDevice) {
    const name = deviceInfo.deviceName || deviceInfo.deviceId;
    // See mule-ble.js's rememberDevice()/connectAndVerify() doc — true here means this same
    // phone (by name) was already a known device under a different id, the signature of Android
    // having rotated its BLE address since last time (this protocol doesn't bond, so there's no
    // other way to notice). Surfaced here rather than silently: this is exactly the moment a
    // "Reconnect to <name>" attempt against the old id would otherwise fail with no explanation,
    // and a fresh scan succeeding instead — the confusing symptom this whole flow works around.
    const rotatedNote = deviceInfo.addressRotated
      ? ` Its Bluetooth address has changed since you last connected (Android does this periodically) — the old "Reconnect to ${name}" entry was stale and is being replaced with this one.`
      : '';
    if (!await showConfirmDialog(`Connect to "${name}"?${rotatedNote}`, 'Connect')) {
      disconnectPhone();
      showStatus('Cancelled — disconnected.');
      return;
    }
    // This is a real wait on a human, during which the phone's own OS can drop an idle BLE
    // link (Android backgrounding it, screen timeout, etc.) — checked for explicitly rather
    // than just ploughing on and reporting "Connected" to something that's already gone.
    if (!isConnected()) {
      showStatus(`Lost the Bluetooth connection to "${name}" while waiting for confirmation — click Connect to Phone… again.`, true);
      return;
    }
  }

  lastConnectedDeviceName = getConnectedDeviceName();
  pollCount = 0; // a genuinely fresh connection — see pollCount's own doc for why this, not the disconnect just gone, is what resets it
  updateConnectButtonLabel();
  showStatus(`Connected to ${getConnectedDeviceName()} — pulling history…`);
  await pullAndSyncConnectedPhone();
  // The link can die mid-pull (see onBleDisconnected) — that already reverts the button and
  // calls stopAutoPull(), but a stale timer wasn't running yet to stop at that point. Without
  // this check, this line ran anyway right after and started one fresh against a connection
  // that's already gone, ticking "not connected" forever until the operator noticed and clicked
  // Connect to Phone… themselves to get a fresh stopAutoPull() call.
  if (isConnected()) startAutoPull();
}

async function onRefreshButtonClick() {
  if (isConnected()) {
    await pullAndSyncConnectedPhone();
  } else {
    renderAll();
  }
}

export function wireBleControls() {
  on('btn-refresh-mobile-files', 'click', onRefreshButtonClick);
  on('btn-connect-phone', 'click', onConnectButtonClick);
  onDisconnect(onBleDisconnected);
  // A page reload/close while still connected — applying an app update via connect.js's own
  // location.reload(), or just closing the tab — otherwise leaves the phone's own BLE stack with
  // no clean disconnect signal at all: the JS-side connection object is simply destroyed along
  // with everything else, with no chance for a real gatt.disconnect() to run first. Confirmed in
  // the field (2026-09-02): the very next connect attempt after exactly this got stuck on
  // "Unknown or Unsupported Device" from the picker (a name-less advertisement is what a
  // still-GATT-connected peripheral often shows on a re-scan) and failed every one of its 3
  // retry attempts identically with "GATT Server is disconnected" — consistent with the phone
  // still believing it has a live central connection from the now-destroyed session, refusing
  // the new one until its own link supervision timeout eventually expires on its own.
  // disconnectPhone() is synchronous and fire-and-forget (gatt.disconnect() returns void, not a
  // promise — see its own doc), so it's safe to call here with nothing to await.
  window.addEventListener('beforeunload', () => { if (isConnected()) disconnectPhone(); });
  const loggingCb = document.getElementById('btn-ble-logging');
  if (loggingCb) {
    loggingCb.checked = isBleLoggingEnabled();
    loggingCb.addEventListener('change', () => setBleLoggingEnabled(loggingCb.checked));
  }
  const staleDaysInput = document.getElementById('mobile-files-stale-days');
  if (staleDaysInput) {
    staleDaysInput.value = String(getRaceStaleAfterDays());
    // Applied on every real pull from here on (see mule-ble.js's own isRaceLabelStale) — no
    // separate Save step needed, unlike racemaster-mobile's own version of this control, since
    // there's no risk here of a half-typed number being read mid-keystroke: 'change' only fires
    // once the field is committed (blur, Enter, or the spinner arrows), not on every keypress.
    staleDaysInput.addEventListener('change', () => {
      const days = parseInt(staleDaysInput.value, 10);
      if (Number.isFinite(days) && days >= 1) setRaceStaleAfterDays(days);
      staleDaysInput.value = String(getRaceStaleAfterDays()); // reflect back whatever actually got saved (rejects e.g. 0, blank, negative)
    });
  }
}
