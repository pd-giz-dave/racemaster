'use strict';

// Orchestration root for the Mobile Files view — the server fetch that feeds every tab, the
// wiring that ties the split-out modules together, and the handful of Devices-tab row actions
// (delete/push/discard) that need to trigger a fresh renderMobileFiles() themselves. The pure,
// DOM-free logic behind this whole feature lives up in js/mobile-files-shared.js,
// js/mobile-files-devices.js and js/mobile-files-progress.js (see their own doc comments) —
// this file and its DOM-layer siblings (mobile-files-devices.js, mobile-files-bib-allocations.js,
// mobile-files-progress.js, mobile-files-ble.js, all here in js/views/) are the thin rendering/
// wiring layer on top of that.
//
// mobile-files-progress.js and mobile-files-ble.js both need to call back into this file's own
// renderMobileFiles() — including real await-ordering dependencies (e.g. Compute Results
// explicitly refreshes before validating a transfer) — while this file needs to import their
// own handler/wire functions to hook up buttons. A plain `import { renderMobileFiles } from
// './mobile-files.js'` in either of those two would make that a real circular import. Native ES
// modules handle circular imports correctly for this exact shape (nothing touched at
// module-evaluation time, only inside function bodies called later), but this instead injects
// renderMobileFiles into each of them once, via initProgressActions()/initBle() below — the
// injected function is the literal same renderMobileFiles, called at the exact same points, so
// there's no behavior difference, and it keeps the import graph a clean DAG with the added
// benefit that both modules become independently importable/testable without needing this whole
// file's own module graph to load.

import {
  getSession, getIsAdmin, getUsername, apiListMobileFiles, apiGetMobileStatus, apiDeleteMobileFile,
  apiPushMobileSync, getPendingMobileFiles, removePendingMobileFile,
} from '../storage.js';
import { showConfirmDialog, showStatus, wireTabBar, getEl } from '../ui.js';
import { isBluetoothAvailable, resetLastPulledLineNumber, resetAllLastPulledLineNumbers } from '../mule-ble.js';
import {
  rowKey, selectedKeys, saveSelectedKeys, computeIncorporationStatus, mergePendingIntoRaces, restoreSelectedKeysOnce,
  getServerPollIntervalSeconds, setServerPollIntervalSeconds, hasNewMobileData, filterStaleRaces,
} from '../mobile-files-shared.js';
import { renderRaceList, currentRows, showDeviceModal, showRawModal } from './mobile-files-devices.js';
import { renderBibAllocationsList, wireBibAllocationsTab, showBibAllocationsModal } from './mobile-files-bib-allocations.js';
import { renderAllFilesList, currentAllFilesRows } from './mobile-files-all.js';
import {
  renderMobileProgressTable, wireProgressTab, initProgressActions, autoUpdateProgress, maybeAutoUpdateProgress,
  isProgressAutoEnabled,
} from './mobile-files-progress.js';
import { initBle, wireBleControls, updateConnectButtonLabel } from './mobile-files-ble.js';

export { autoUpdateProgress };

// The last successfully-fetched server race list — kept so a transient failed refresh (the
// server going offline, e.g. via the Datasets page's "Hide Server" toggle) falls back to it
// instead of wiping the list down to only locally-pulled pending files. mobile-files-ble.js
// reads this via the getLastKnownRaces getter passed to initBle() below, for its own
// refreshDevicesTableFromCache() fast path.
let lastKnownRaces = [];

// A race can still be listed by the server with zero devices — e.g. bib allocations were
// pushed for it (server/mobile.js's writeBibAllocations()) but every device file has since
// been deleted, which leaves the race's own directory non-empty (bib-allocations.json) so it's
// never cleaned up. That's a legitimate state (see mobile-files-bib-allocations.js's own doc
// comment), but it shouldn't inflate the header count sitting above the Devices tab — so this
// only counts races that actually have a device row to show there.
function formatRaceCount(races) {
  const n = races.filter(r => r.devices.length > 0).length;
  return `${n} race${n === 1 ? '' : 's'}`;
}

// r.device.name is 'bib-allocations' (literal) for a bib-allocations row (see flattenAllFiles()
// in js/mobile-files-devices.js) — that's what makes apiDeleteMobileFile below resolve to the
// right file with no server change needed; this is only for what's shown to the user.
function fileLabel(r) {
  return r.kind === 'bib-allocations' ? 'Bib Allocations' : r.device.name;
}

// The actual server delete, with no confirm dialog and no user-facing status message of its own
// — both deleteRow() (one file, one confirm) and deleteFromHere() (a batch, one combined confirm)
// own those themselves. Returns null on success, or a short error string on failure.
async function deleteFileOnServer(r) {
  const session = getSession();
  let result;
  try {
    result = await apiDeleteMobileFile(session.token, r.owner, r.raceLabel, r.device.name);
  } catch {
    // Server unreachable (e.g. offline in the field, or the Datasets "Hide Server" test toggle)
    // — fetch() itself rejects rather than resolving with an {error} shape, and this row has no
    // local-only fallback the way a pending row's Discard does, so there's genuinely nothing
    // more to do here than tell the caller to try again once the server's back.
    return 'server unreachable';
  }
  if (result.error) return result.error;
  // Without this, mule-ble.js's own delta cursor stays advanced past the data just deleted from
  // the server, so a later Bluetooth pull from this same device would only fetch what's new
  // since then — silently skipping everything that used to be there, even though the server no
  // longer has it either. A server-known device row never carries its own protocol deviceId
  // (that's only ever tracked for a BLE-pulled pending file — see savePendingMobileFile), so
  // there's no way to target just this one device's cursor; clearing every cursor is the same
  // fallback discardPendingRow() uses for the equivalent no-deviceId case. None of this applies
  // to a bib-allocations delete — it has nothing to do with what a phone has already pulled.
  if (r.kind !== 'bib-allocations') {
    if (r.device.deviceId) resetLastPulledLineNumber(r.device.deviceId, r.raceLabel);
    else resetAllLastPulledLineNumbers();
  }
  return null;
}

// Each of these re-renders the list *before* announcing its own outcome, not after —
// renderMobileFiles() does its own server fetch and shows its own status ("Loading…", then
// "Server unreachable…" if that fails, the expected case out in the field with no network),
// which would otherwise immediately overwrite the specific confirmation below it.
async function deleteRow(r) {
  const label = fileLabel(r);
  // Naming the owner too when admin: this is the one page an admin can see two different users'
  // similarly-named races side by side, so the plain race/file name alone isn't always enough to
  // be sure which one's about to be deleted.
  if (!await showConfirmDialog(
    `Delete "${label}" from "${r.raceLabel}"${getIsAdmin() ? ` (owner: ${r.owner})` : ''}? This cannot be undone.`,
    'Delete', true
  )) return;
  const error = await deleteFileOnServer(r);
  if (error) {
    showStatus(error === 'server unreachable'
      ? 'Server unreachable — cannot delete right now, try again once back online.'
      : error, true);
    return;
  }
  await renderMobileFiles();
  showStatus(`"${label}" deleted.`);
}

// "Delete from here" — an All Files tab row that's already stale (see mobile-files-all.js's own
// `stale` field on each row) offers this alongside its ordinary Delete. Bulk-deletes the clicked
// row and every OTHER stale row *after* it in the tab's current order (newest-first by each row's
// own last-activity date — see flattenAllFiles()'s own doc in js/mobile-files-devices.js), quietly
// skipping any fresh row in between rather than stopping at it. One combined confirm dialog names
// every file up front — a batch like this can easily run to double digits, so a per-file confirm
// would be both tedious and easy to click through without really reading.
async function deleteFromHere(startRow) {
  const idx = currentAllFilesRows.indexOf(startRow);
  if (idx < 0) return;
  const toDelete = currentAllFilesRows.slice(idx).filter(r => r.stale);
  if (!toDelete.length) return; // the button only ever appears on an already-stale row

  const list = toDelete.map(r => `${r.raceLabel} — ${fileLabel(r)}`).join('\n');
  const message = `Delete this file and every other stale file below it in the current `
    + `(newest-first) list — any fresh file in between is left alone. ${toDelete.length} `
    + `file${toDelete.length === 1 ? '' : 's'} will be permanently removed:\n\n${list}\n\n`
    + `This cannot be undone.`;
  if (!await showConfirmDialog(message, `Delete ${toDelete.length}`, true)) return;

  const failed = [];
  for (const r of toDelete) {
    const error = await deleteFileOnServer(r);
    if (error) failed.push(`${fileLabel(r)} (${error})`);
  }
  await renderMobileFiles();
  showStatus(
    failed.length
      ? `Deleted ${toDelete.length - failed.length} of ${toDelete.length} — failed: ${failed.join('; ')}`
      : `Deleted ${toDelete.length} stale file${toDelete.length === 1 ? '' : 's'}.`,
    !!failed.length
  );
}

async function pushPendingRow(r) {
  const session = getSession();
  if (!session) { showStatus('Sign in first.', true); return; }
  let result;
  try {
    result = await apiPushMobileSync(session.token, r.raceLabel, r.device.name, r.device.lines);
  } catch {
    // Server unreachable — fetch() itself rejects. The file stays right where it is, still
    // pending, so this is just "not yet", not a failure — Push again once back online.
    showStatus('Server unreachable — still saved locally, try Push again once back online.', true);
    return;
  }
  if (result.error) { showStatus(result.error, true); return; }
  removePendingMobileFile(r.owner, r.raceLabel, r.device.name);
  await renderMobileFiles();
  showStatus(`"${r.device.name}" pushed to the server.`);
}

async function discardPendingRow(r) {
  if (!await showConfirmDialog(
    `Discard the locally-pulled "${r.device.name}" from "${r.raceLabel}"? This only removes it from this browser — you can pull it from the phone again later.`,
    'Discard', true
  )) return;
  removePendingMobileFile(r.owner, r.raceLabel, r.device.name);
  // Without this, mule-ble.js's own delta cursor stays advanced past the very data just
  // thrown away, so the next Bluetooth pull from this device would only fetch what's new
  // since then instead of the whole file again — "pull it from the phone again later" above
  // would otherwise be a lie for anything already synced past the discarded copy. A pending
  // entry saved before deviceId was tracked at all has no precise cursor to target, so falls
  // back to clearing every cursor rather than silently doing nothing.
  if (r.device.deviceId) resetLastPulledLineNumber(r.device.deviceId, r.raceLabel);
  else resetAllLastPulledLineNumbers();
  await renderMobileFiles();
  showStatus(`"${r.device.name}" discarded.`);
}

export function wireMobileFiles() {
  initBle({ renderAll: renderMobileFiles, getLastKnownRaces: () => lastKnownRaces });
  initProgressActions({ renderAll: renderMobileFiles });
  wireBleControls();
  wireProgressTab();
  wireBibAllocationsTab();
  wireTabBar('mobile-files-tab-bar', 'mobile-files-tab-', 'data-mf-tab');
  document.getElementById('mobile-files-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const r = currentRows[+btn.closest('[data-idx]')?.dataset.idx];
    if (!r) return;
    if (btn.dataset.action === 'view')          showDeviceModal(r.owner, r.raceLabel, r.device.name, r.device.lines);
    else if (btn.dataset.action === 'raw')      showRawModal(r.owner, r.raceLabel, r.device.name, r.device.lines);
    else if (btn.dataset.action === 'push')     pushPendingRow(r);
    else if (btn.dataset.action === 'discard')  discardPendingRow(r);
  });
  // All Files tab — the one place View/Raw/Delete are all still offered, for either a device
  // file or a race's bib-allocations file (see currentAllFilesRows' own `kind` field, set by
  // flattenAllFiles() in js/mobile-files-devices.js).
  document.getElementById('mobile-files-all-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const r = currentAllFilesRows[+btn.closest('[data-idx]')?.dataset.idx];
    if (!r) return;
    if (btn.dataset.action === 'view') {
      if (r.kind === 'bib-allocations') showBibAllocationsModal(r.owner, r.raceLabel, r.ba);
      else showDeviceModal(r.owner, r.raceLabel, r.device.name, r.device.lines);
    } else if (btn.dataset.action === 'raw') {
      showRawModal(r.owner, r.raceLabel, r.device.name, r.device.lines);
    } else if (btn.dataset.action === 'delete') {
      deleteRow(r);
    } else if (btn.dataset.action === 'delete-from-here') {
      deleteFromHere(r);
    }
  });
  document.getElementById('mobile-files-tbody')?.addEventListener('change', e => {
    const cb = e.target.closest('input.mobile-file-select');
    if (!cb) return;
    const r = currentRows[+cb.dataset.idx];
    if (!r) return;
    if (cb.checked) selectedKeys.add(rowKey(r)); else selectedKeys.delete(rowKey(r));
    saveSelectedKeys();
    // Colour is selection-driven now — reflect the change immediately rather than waiting for
    // the next full re-render (a fresh fetch or a Refresh/Update Progress click).
    r.incorporationStatus = computeIncorporationStatus(r);
    const tr = cb.closest('tr');
    if (tr) {
      tr.classList.remove('row-outstanding', 'row-incorporated');
      if (r.incorporationStatus === 'outstanding') tr.classList.add('row-outstanding');
      else if (r.incorporationStatus === 'incorporated') tr.classList.add('row-incorporated');
    }
  });
  const pollSecondsInput = document.getElementById('mobile-files-poll-seconds');
  if (pollSecondsInput) {
    pollSecondsInput.value = String(getServerPollIntervalSeconds());
    // Same 'change'-not-'input' / reflect-back-whatever-actually-saved pattern as
    // #mobile-files-stale-days (see mobile-files-ble.js) — restartServerPoll() re-schedules
    // immediately so an edited interval takes effect on the spot, not on the next page load.
    pollSecondsInput.addEventListener('change', () => {
      const seconds = parseInt(pollSecondsInput.value, 10);
      if (Number.isFinite(seconds) && seconds >= 5) setServerPollIntervalSeconds(seconds);
      pollSecondsInput.value = String(getServerPollIntervalSeconds());
      restartServerPoll();
    });
  }
  restartServerPoll();
}

// Genuinely awaitable (not fire-and-forget) so a caller — e.g. mobile-files-progress.js's own
// updateProgress() wanting the latest data before validating a transfer — can wait for it to
// finish. Resolves true if the server fetch succeeded, false if it fell back to a local/offline
// view (with its own status message already shown either way, so callers don't need to notify
// separately on top of it).
//
// silent (used only by pollServerForChanges() below): suppresses every showStatus() call in
// this function. A background poll tick can fire while the operator is looking at a completely
// different page — showStatus() writes to the app's one global status bar (see ui.js), so
// "Loading…" flashing there, or a "Server unreachable…" toast every N seconds purely because
// this tick happened to catch a transient blip, would stomp on whatever that page's own last
// message was for no reason the operator asked for. The header's own online/offline indicator
// (js/connect.js's pingServerNow()) already covers connectivity; this function's job on a
// silent tick is just to quietly update the data.
export async function renderMobileFiles({ silent = false } = {}) {
  // A real page reload (F5) starts selectedKeys empty with no route back to what was ticked
  // before — see restoreSelectedKeysOnce()'s own doc in mobile-files-shared.js for why this is
  // needed here specifically (previously only autoUpdateProgress() ever restored it, and only
  // when the Results page happened to be opened).
  restoreSelectedKeysOnce();
  const session  = getSession();
  const count    = getEl('mobile-files-count');
  const connectBtn = getEl('btn-connect-phone');
  if (connectBtn) connectBtn.hidden = !isBluetoothAvailable();
  updateConnectButtonLabel();
  if (!session) {
    if (!silent) showStatus('Sign in on the Datasets page to view mobile files.');
    renderRaceList([], false);
    renderBibAllocationsList([], false);
    renderAllFilesList([], false);
    renderMobileProgressTable();
    if (count) count.textContent = '0';
    return false;
  }
  const isAdminUser = getIsAdmin();
  const pending = getPendingMobileFiles().filter(f => f.owner === getUsername());
  if (!silent) showStatus('Loading…');
  try {
    const races = await apiListMobileFiles(session.token);
    lastKnownRaces = Array.isArray(races) ? races : [];
    const merged = filterStaleRaces(mergePendingIntoRaces(lastKnownRaces, pending));
    if (count) count.textContent = formatRaceCount(merged);
    renderRaceList(merged, isAdminUser);
    renderBibAllocationsList(merged, isAdminUser);
    // Deliberately NOT `merged` — the All Files tab is the one place that skips both
    // filterStaleRaces() and mergePendingIntoRaces() on purpose, see its own module doc.
    renderAllFilesList(lastKnownRaces, isAdminUser);
    renderMobileProgressTable();
    if (!silent) showStatus(merged.length ? '' : 'No mobile files uploaded yet.');
    await maybeAutoUpdateProgress();
    return true;
  } catch {
    // Server unreachable — keep showing whatever was last successfully loaded rather than
    // wiping the list down to only locally-pulled pending files.
    const merged = filterStaleRaces(mergePendingIntoRaces(lastKnownRaces, pending));
    if (count) count.textContent = formatRaceCount(merged);
    renderRaceList(merged, isAdminUser);
    renderBibAllocationsList(merged, isAdminUser);
    renderAllFilesList(lastKnownRaces, isAdminUser);
    renderMobileProgressTable();
    if (!silent) {
      showStatus(merged.length
        ? 'Server unreachable — showing the last known list plus anything pulled locally.'
        : 'Server unreachable, and no locally-pulled files yet.', !merged.length);
    }
    // Auto-update reads whatever's already local (state + any pending Bluetooth pulls) — it
    // doesn't need the server, so a failed fetch here shouldn't skip it: new data can still have
    // arrived locally even while offline.
    await maybeAutoUpdateProgress();
    return false;
  }
}

// ---- Background server poll (ToDo.MD line 42's server-side half) ----
//
// While ticked, #mf-auto-progress (mobile-files-progress.js) only ever reacted to *this
// browser's own* actions (Refresh, Push, Discard, Delete, a Bluetooth pull) — nothing here
// noticed a WiFi sync, or another admin's upload, until some unrelated action happened to call
// renderMobileFiles() again. This polls the server every getServerPollIntervalSeconds() while
// online, but cheaply: GET /api/mobile/status (server/routes/mobile.js) costs one fs.statSync
// per device file, no content read — hasNewMobileData() compares that against lastKnownRaces,
// and only then is the full renderMobileFiles({silent:true}) (itself already ending in
// maybeAutoUpdateProgress()) actually worth calling.
async function pollServerForChanges() {
  if (!isProgressAutoEnabled()) return; // nothing to do — not even the lightweight fetch is worth making
  const session = getSession();
  if (!session) return;
  let status;
  try { status = await apiGetMobileStatus(session.token); }
  catch { return; } // offline — try again next tick, same as any other silent background failure
  if (!Array.isArray(status) || !hasNewMobileData(status, lastKnownRaces)) return;
  await renderMobileFiles({ silent: true });
}

// Not page-scoped — started once at wire time (see wireMobileFiles() below) and keeps ticking
// for the app's whole life, same one-time-at-init, app-wide convention startServerPing() uses
// (js/connect.js, wired from js/app.js's init()), not tied to which view happens to be showing.
// Cleared and rescheduled (rather than left running at a stale period) whenever the interval
// setting itself changes, via the #mobile-files-poll-seconds 'change' handler below.
let pollTimer = null;
function restartServerPoll() {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = setInterval(pollServerForChanges, getServerPollIntervalSeconds() * 1000);
}
