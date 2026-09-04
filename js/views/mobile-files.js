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
  getSession, getIsAdmin, getUsername, apiListMobileFiles, apiDeleteMobileFile,
  apiPushMobileSync, getPendingMobileFiles, removePendingMobileFile,
} from '../storage.js';
import { showConfirmDialog, showStatus, wireTabBar, getEl } from '../ui.js';
import { isBluetoothAvailable, resetLastPulledLineNumber, resetAllLastPulledLineNumbers } from '../mule-ble.js';
import { rowKey, selectedKeys, saveSelectedKeys, computeIncorporationStatus, mergePendingIntoRaces } from '../mobile-files-shared.js';
import { renderRaceList, currentRows, showDeviceModal, showRawModal } from './mobile-files-devices.js';
import { renderBibAllocationsList, wireBibAllocationsTab } from './mobile-files-bib-allocations.js';
import { renderMobileProgressTable, wireProgressTab, initProgressActions, autoUpdateProgress } from './mobile-files-progress.js';
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

// Each of these three re-renders the list *before* announcing its own outcome, not after —
// renderMobileFiles() does its own server fetch and shows its own status ("Loading…", then
// "Server unreachable…" if that fails, the expected case out in the field with no network),
// which would otherwise immediately overwrite the specific confirmation below it.
async function deleteRow(r) {
  if (!await showConfirmDialog(`Delete "${r.device.name}" from "${r.raceLabel}"? This cannot be undone.`, 'Delete', true)) return;
  const session = getSession();
  let result;
  try {
    result = await apiDeleteMobileFile(session.token, r.owner, r.raceLabel, r.device.name);
  } catch {
    // Server unreachable (e.g. offline in the field, or the Datasets "Hide Server" test toggle)
    // — fetch() itself rejects rather than resolving with an {error} shape, and this row has no
    // local-only fallback the way a pending row's Discard does, so there's genuinely nothing
    // more to do here than tell the operator to try again once the server's back.
    showStatus('Server unreachable — cannot delete right now, try again once back online.', true);
    return;
  }
  if (result.error) { showStatus(result.error, true); return; }
  // Without this, mule-ble.js's own delta cursor stays advanced past the data just deleted from
  // the server, so a later Bluetooth pull from this same device would only fetch what's new
  // since then — silently skipping everything that used to be there, even though the server no
  // longer has it either. A server-known device row never carries its own protocol deviceId
  // (that's only ever tracked for a BLE-pulled pending file — see savePendingMobileFile), so
  // there's no way to target just this one device's cursor; clearing every cursor is the same
  // fallback discardPendingRow() uses for the equivalent no-deviceId case.
  if (r.device.deviceId) resetLastPulledLineNumber(r.device.deviceId, r.raceLabel);
  else resetAllLastPulledLineNumbers();
  await renderMobileFiles();
  showStatus(`"${r.device.name}" deleted.`);
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
    else if (btn.dataset.action === 'delete')   deleteRow(r);
    else if (btn.dataset.action === 'push')     pushPendingRow(r);
    else if (btn.dataset.action === 'discard')  discardPendingRow(r);
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
}

// Genuinely awaitable (not fire-and-forget) so a caller — e.g. mobile-files-progress.js's own
// updateProgress() wanting the latest data before validating a transfer — can wait for it to
// finish. Resolves true if the server fetch succeeded, false if it fell back to a local/offline
// view (with its own status message already shown either way, so callers don't need to notify
// separately on top of it).
export async function renderMobileFiles() {
  const session  = getSession();
  const count    = getEl('mobile-files-count');
  const connectBtn = getEl('btn-connect-phone');
  if (connectBtn) connectBtn.hidden = !isBluetoothAvailable();
  updateConnectButtonLabel();
  if (!session) {
    showStatus('Sign in on the Datasets page to view mobile files.');
    renderRaceList([], false);
    renderBibAllocationsList([], false);
    renderMobileProgressTable();
    if (count) count.textContent = '0';
    return false;
  }
  const isAdminUser = getIsAdmin();
  const pending = getPendingMobileFiles().filter(f => f.owner === getUsername());
  showStatus('Loading…');
  try {
    const races = await apiListMobileFiles(session.token);
    lastKnownRaces = Array.isArray(races) ? races : [];
    const merged = mergePendingIntoRaces(lastKnownRaces, pending);
    if (count) count.textContent = formatRaceCount(merged);
    renderRaceList(merged, isAdminUser);
    renderBibAllocationsList(merged, isAdminUser);
    renderMobileProgressTable();
    showStatus(merged.length ? '' : 'No mobile files uploaded yet.');
    return true;
  } catch {
    // Server unreachable — keep showing whatever was last successfully loaded rather than
    // wiping the list down to only locally-pulled pending files.
    const merged = mergePendingIntoRaces(lastKnownRaces, pending);
    if (count) count.textContent = formatRaceCount(merged);
    renderRaceList(merged, isAdminUser);
    renderBibAllocationsList(merged, isAdminUser);
    renderMobileProgressTable();
    showStatus(merged.length
      ? 'Server unreachable — showing the last known list plus anything pulled locally.'
      : 'Server unreachable, and no locally-pulled files yet.', !merged.length);
    return false;
  }
}
