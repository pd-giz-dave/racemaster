'use strict';

import {
  getSession, getIsAdmin, getUsername, apiListMobileFiles, apiDeleteMobileFile,
  apiPushMobileSync, getPendingMobileFiles, savePendingMobileFile, removePendingMobileFile,
} from '../storage.js';
import { on, escHtml, showConfirmDialog, showStatus, renderTable, tableColumns } from '../ui.js';
import { TABLES } from '../strings.js';
import {
  isBluetoothAvailable, connectToPhone as bleConnect, pullFromConnectedPhone,
  disconnectPhone, isConnected, getConnectedDeviceName, onDisconnect,
} from '../mule-ble.js';

function getEl(id) { return document.getElementById(id); }

let currentRows = []; // flattened, one entry per device — see flattenDevices()

function formatRaceDate(raceDate) {
  if (!raceDate) return '<span style="color:var(--muted)">Unknown</span>';
  return `${raceDate.dd}/${raceDate.mm}/${raceDate.yy}`;
}

// Mirrors server.js's parseRaceLabelDate/sort exactly — needed client-side because a
// Bluetooth-pulled, not-yet-pushed file has no server entry to derive/sort a race date from.
function parseRaceLabelDate(raceLabel) {
  const m = /-(\d{2})-(\d{2})-(\d{2})$/.exec(raceLabel || '');
  return m ? { dd: m[1], mm: m[2], yy: m[3] } : null;
}

function sortRaces(races) {
  return [...races].sort((a, b) => {
    if (a.raceDate && b.raceDate) {
      return b.raceDate.yy !== a.raceDate.yy ? b.raceDate.yy.localeCompare(a.raceDate.yy)
        : b.raceDate.mm !== a.raceDate.mm ? b.raceDate.mm.localeCompare(a.raceDate.mm)
        : b.raceDate.dd.localeCompare(a.raceDate.dd);
    }
    if (a.raceDate) return -1;
    if (b.raceDate) return 1;
    return a.raceLabel.localeCompare(b.raceLabel);
  });
}

// Folds this browser's not-yet-pushed Bluetooth pulls into the server's own race list, so a
// pending file shows up in exactly the same place it will once it's actually pushed — same
// race grouping, same date-sort position. A pending device replaces any server device of the
// same name in that race (we just re-pulled it fresh, so it's the more current copy).
function mergePendingIntoRaces(races, pending) {
  const merged = races.map(race => ({ ...race, devices: [...race.devices] }));
  for (const p of pending) {
    let race = merged.find(r => r.owner === p.owner && r.raceLabel === p.raceLabel);
    if (!race) {
      race = { owner: p.owner, raceLabel: p.raceLabel, raceDate: parseRaceLabelDate(p.raceLabel), devices: [] };
      merged.push(race);
    }
    race.devices = race.devices.filter(d => d.name !== p.deviceName);
    race.devices.push({ name: p.deviceName, lines: p.lines, pending: true });
  }
  return sortRaces(merged);
}

// ---- Segment view (mirrors racemaster-mobile's observeCurrentSegment + foldLatestVisible) ----
//
// A device's file interleaves two independent, separately-numbered families of rows — Time
// splits (splitTime non-null) and Bibs/CP entries (splitTime null, bibNumber instead) — each
// with its own Reset boundary and its own edit-echo/undo-marker history. "Current segment" means
// only the rows since that family's own most recent Reset, folded down to one row per logical
// entry (the latest edit, with anything since-undone dropped) — exactly what the phone's own
// live screen would be showing. See HistoryLineDao.observeCurrentSegment / HistoryFold.
// foldLatestVisible in racemaster-mobile for the reference implementation this mirrors.

function currentSegment(rows) {
  const resetLine = rows.reduce((max, r) => r.action === 'Reset' ? Math.max(max, r.lineNumber ?? 0) : max, 0);
  return rows.filter(r => (r.lineNumber ?? 0) > resetLine);
}

function foldLatestVisible(rows) {
  const latestByRoot = new Map();
  for (const r of rows) {
    const key = r.refLineNumber ?? r.lineNumber;
    const cur = latestByRoot.get(key);
    if (!cur || (r.lineNumber ?? 0) > (cur.lineNumber ?? 0)) latestByRoot.set(key, r);
  }
  return [...latestByRoot.values()].filter(r => r.action !== 'Undo');
}

function bySplitNumber(a, b) { return (a.splitNumber ?? 0) - (b.splitNumber ?? 0); }

function formatCount(visible) {
  return visible === 0 ? '' : String(visible);
}

function buildSegmentView(lines) {
  const timeRows = lines.filter(r => r.splitTime != null);
  const bibsRows = lines.filter(r => r.splitTime == null);
  return {
    timeSegment: foldLatestVisible(currentSegment(timeRows)).sort(bySplitNumber),
    bibsSegment: foldLatestVisible(currentSegment(bibsRows)).sort(bySplitNumber),
  };
}

// "yyyy/MM/dd HH:mm:ss" (the phone's own local time) → just the "HH:mm:ss" part. Field was
// renamed server-side from timestampMillis to timestamp (see server.js's coerce()) — files
// written before that rename are still on disk under the old name, so read whichever is present.
function whenOf(r) {
  return ((r.timestamp ?? r.timestampMillis) || '').split(' ')[1] || '';
}

// Every visible line should share one location (it's stamped from the race's own
// RaceEntity.location, the same for every record a device sends for that race) — anything
// else means the file is invalid.
function locationSummary(visibleRows) {
  const locations = [...new Set(visibleRows.map(r => r.location))];
  if (locations.length <= 1) return escHtml(locations[0] || '—');
  return `<span style="color:var(--danger)">Inconsistent (${locations.map(escHtml).join(', ')}) — file is invalid</span>`;
}

function showDeviceModal(owner, raceLabel, deviceName, lines) {
  const { timeSegment, bibsSegment } = buildSegmentView(lines);
  const visibleRows = [...timeSegment, ...bibsSegment];
  const splitNumbers = [...new Set(visibleRows.map(r => r.splitNumber ?? 0))].sort((a, b) => a - b);

  const rows = splitNumbers.map(n => {
    const bib  = bibsSegment.find(r => (r.splitNumber ?? 0) === n);
    const time = timeSegment.find(r => (r.splitNumber ?? 0) === n);
    return `<tr>
      <td>${n}</td>
      <td>${bib ? escHtml(bib.action) : ''}</td>
      <td>${bib ? escHtml(bib.bibNumber ?? '') : ''}</td>
      <td>${bib ? whenOf(bib) : ''}</td>
      <td>${time ? escHtml(time.action) : ''}</td>
      <td>${time ? escHtml(time.splitTime ?? '') : ''}</td>
      <td>${time ? whenOf(time) : ''}</td>
    </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:640px">
      <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
      <p style="margin:0 0 12px;font-size:0.875rem">Location: ${locationSummary(visibleRows)}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th rowspan="2">Split #</th>
            <th colspan="3">Bibs</th>
            <th colspan="3">Time</th>
          </tr><tr>
            <th>Action</th><th>Bib</th><th>When</th><th>Action</th><th>Split Time</th><th>When</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="color:var(--muted)">No entries in the current segment.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="mobile-file-modal-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#mobile-file-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// Raw listing — every field of every line, unfiltered and unfolded, straight from the file.
function showRawModal(owner, raceLabel, deviceName, lines) {
  const fields = [...new Set(lines.flatMap(r => Object.keys(r)))];
  const sorted = [...lines].sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
  const headerRow = fields.map(f => `<th>${escHtml(f)}</th>`).join('');
  const rows = sorted.map(r => `<tr>${fields.map(f => `<td>${escHtml(r[f] ?? '')}</td>`).join('')}</tr>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:90vw;max-width:1100px">
      <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''} — raw</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${fields.length}" style="color:var(--muted)">No lines in this file.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="mobile-file-modal-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#mobile-file-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// ---- List (one row per device) ----

// Flattens races → one row per device, precomputing everything the columns need so the
// column render functions below stay trivial reads, same as every other list view's *_COLS.
function flattenDevices(races) {
  const rows = [];
  for (const race of races) {
    for (const device of race.devices) {
      const { timeSegment, bibsSegment } = buildSegmentView(device.lines);
      rows.push({
        idx: rows.length,
        owner: race.owner,
        raceLabel: race.raceLabel,
        raceDate: race.raceDate,
        device,
        pending: !!device.pending,
        location: locationSummary([...timeSegment, ...bibsSegment]),
        bibsVisible: bibsSegment.length,
        timeVisible: timeSegment.length,
      });
    }
  }
  return rows;
}

function buildColumns(isAdminUser) {
  return tableColumns(TABLES['mobile-files'], {
    select:    r => `<input type="checkbox" class="mobile-file-select" aria-label="Select ${escHtml(r.device.name)}">`,
    owner:     isAdminUser ? r => escHtml(r.owner) : undefined,
    raceLabel: r => escHtml(r.raceLabel),
    raceDate:  r => formatRaceDate(r.raceDate),
    device:    r => escHtml(r.device.name) + (r.pending
      ? ' <span style="font-size:0.7rem;background:var(--accent);color:#fff;border-radius:4px;padding:0 4px">pending upload</span>'
      : ''),
    location:  r => r.location,
    bibs:      r => formatCount(r.bibsVisible),
    time:      r => formatCount(r.timeVisible),
    actions:   r => r.pending ? `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="raw">Raw</button>
      <button class="btn-sm btn-save" data-action="push">Push</button>
      <button class="btn-sm btn-delete" data-action="discard">Discard</button>` : `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="raw">Raw</button>
      <button class="btn-sm btn-delete" data-action="delete">Delete</button>`,
  });
}

function renderRaceList(races, isAdminUser) {
  currentRows = flattenDevices(races);
  renderTable('mobile-files-tbody', buildColumns(isAdminUser), currentRows, {
    rowAttrs: r => ({ 'data-idx': r.idx }),
  });
}

async function deleteRow(r) {
  if (!await showConfirmDialog(`Delete "${r.device.name}" from "${r.raceLabel}"? This cannot be undone.`, 'Delete', true)) return;
  const session = getSession();
  const result = await apiDeleteMobileFile(session.token, r.owner, r.raceLabel, r.device.name);
  if (result.error) { showStatus(result.error, true); return; }
  showStatus(`"${r.device.name}" deleted.`);
  renderMobileFiles();
}

async function pushPendingRow(r) {
  const session = getSession();
  if (!session) { showStatus('Sign in first.', true); return; }
  const result = await apiPushMobileSync(session.token, r.raceLabel, r.device.name, r.device.lines);
  if (result.error) { showStatus(result.error, true); return; }
  removePendingMobileFile(r.owner, r.raceLabel, r.device.name);
  showStatus(`"${r.device.name}" pushed to the server.`);
  renderMobileFiles();
}

async function discardPendingRow(r) {
  if (!await showConfirmDialog(
    `Discard the locally-pulled "${r.device.name}" from "${r.raceLabel}"? This only removes it from this browser — you can pull it from the phone again later.`,
    'Discard', true
  )) return;
  removePendingMobileFile(r.owner, r.raceLabel, r.device.name);
  showStatus(`"${r.device.name}" discarded.`);
  renderMobileFiles();
}

function updateConnectButtonLabel() {
  const btn = getEl('btn-connect-phone');
  if (!btn) return;
  btn.textContent = isConnected() ? `Disconnect from ${getConnectedDeviceName()}` : 'Connect to Phone…';
}

// Connects to a nearby phone over Bluetooth (racemaster-mobile's Mule Mode — see mule-ble.js)
// and pulls whatever history it's holding, pushing each device straight to the server exactly
// like a WiFi sync would. If the server can't be reached (the expected case out in the field,
// with no internet), each pull is kept locally as "pending" instead — see
// storage.js's savePendingMobileFile — until a Push action later succeeds. The connection is
// left open afterward (button becomes "Disconnect from <device>") so a second click just ends
// the session rather than re-picking a device.
async function onConnectButtonClick() {
  if (isConnected()) {
    disconnectPhone();
    updateConnectButtonLabel();
    showStatus('Disconnected from phone.');
    return;
  }

  const session  = getSession();
  const username = getUsername();
  if (!session || !username) { showStatus('Sign in on the Datasets page first.', true); return; }
  if (!isBluetoothAvailable()) {
    showStatus('Bluetooth is not available in this browser — use Chrome or Edge over HTTPS (or localhost).', true);
    return;
  }
  showStatus('Connecting…');
  try {
    await bleConnect();
  } catch (e) {
    showStatus(e.message || 'Bluetooth connection failed.', true);
    return;
  }
  updateConnectButtonLabel();
  showStatus(`Connected to ${getConnectedDeviceName()} — pulling history…`);

  let pulled;
  try {
    pulled = await pullFromConnectedPhone();
  } catch (e) {
    showStatus(e.message || 'Failed to pull history from the phone.', true);
    return;
  }
  let synced = 0, pending = 0;
  for (const { raceLabel, deviceName, lines } of pulled) {
    try {
      const result = await apiPushMobileSync(session.token, raceLabel, deviceName, lines);
      if (result.error) throw new Error(result.error);
      synced++;
    } catch {
      savePendingMobileFile(username, raceLabel, deviceName, lines);
      pending++;
    }
  }
  showStatus(`Pulled ${pulled.length} device file${pulled.length === 1 ? '' : 's'}: ${synced} synced to the server, ${pending} saved locally.`);
  renderMobileFiles();
}

export function wireMobileFiles() {
  on('btn-refresh-mobile-files', 'click', renderMobileFiles);
  on('btn-connect-phone', 'click', onConnectButtonClick);
  onDisconnect(updateConnectButtonLabel);
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
}

export function renderMobileFiles() {
  const session  = getSession();
  const status   = getEl('mobile-files-status');
  const count    = getEl('mobile-files-count');
  const connectBtn = getEl('btn-connect-phone');
  if (connectBtn) connectBtn.hidden = !isBluetoothAvailable();
  updateConnectButtonLabel();
  if (!session) {
    if (status) status.textContent = 'Sign in on the Datasets page to view mobile files.';
    renderRaceList([], false);
    if (count) count.textContent = '0';
    return;
  }
  const isAdminUser = getIsAdmin();
  const pending = getPendingMobileFiles().filter(f => f.owner === getUsername());
  if (status) status.textContent = 'Loading…';
  apiListMobileFiles(session.token).then(races => {
    const merged = mergePendingIntoRaces(Array.isArray(races) ? races : [], pending);
    if (count) count.textContent = `${merged.length} race${merged.length === 1 ? '' : 's'}`;
    renderRaceList(merged, isAdminUser);
    if (status) status.textContent = merged.length ? '' : 'No mobile files uploaded yet.';
  }).catch(() => {
    const merged = mergePendingIntoRaces([], pending);
    if (count) count.textContent = `${merged.length} race${merged.length === 1 ? '' : 's'}`;
    renderRaceList(merged, isAdminUser);
    if (status) status.textContent = merged.length
      ? 'Server unreachable — showing locally-pulled files only.'
      : 'Server unreachable, and no locally-pulled files yet.';
  });
}