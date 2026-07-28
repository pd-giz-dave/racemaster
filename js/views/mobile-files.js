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
import { getEntry } from '../entries.js';
import { recordFinisher, updateFinisher } from '../finishers.js';
import { state } from '../state.js';

function getEl(id) { return document.getElementById(id); }

let currentRows = []; // flattened, one entry per device — see flattenDevices()

// The last successfully-fetched server race list — kept so a transient failed refresh (the
// server going offline, e.g. via the Datasets page's "Hide Server" toggle) falls back to it
// instead of wiping the list down to only locally-pulled pending files.
let lastKnownRaces = [];

// Ticked checkboxes, keyed by identity rather than row index — row indices are reassigned on
// every render (races/devices can appear in a different order once sorted), so persisting
// selection across a re-render (or navigating away from Mobile Files and back) needs a stable
// key instead. Lives only in memory — resets on a full page reload, same as any other in-app
// navigation state.
const selectedKeys = new Set();
function rowKey(r) { return `${r.owner} ${r.raceLabel} ${r.device.name}`; }

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
    select:    r => `<input type="checkbox" class="mobile-file-select" data-idx="${r.idx}" aria-label="Select ${escHtml(r.device.name)}"${selectedKeys.has(rowKey(r)) ? ' checked' : ''}>`,
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

// ---- Add to Finishers ----
//
// Maps a mobile Bibs-mode action onto the equivalent finishers.js action — "Pass" (Checkpoint
// mode) is treated as a Finish, since it only makes sense here at all when the CP happened to
// be the finish line. "Stop"/"Reset" are session-boundary markers with no finisher meaning —
// left out of this map entirely so they're dropped rather than transferred.
const BIBS_ACTION_TO_FINISHER = {
  Start: 'Start', Finish: 'Finish', DNF: 'DNF', Pass: 'Finish',
  Clock: 'Clock', Ignore: 'Ignore', Seniors: 'Seniors', Juniors: 'Juniors', Male: 'Male', Female: 'Female',
};
const TRANSFERABLE_BIBS_ACTIONS = new Set(Object.keys(BIBS_ACTION_TO_FINISHER));
const BIB_REQUIRED_FINISHER_ACTIONS = new Set(['Start', 'Finish', 'DNF', 'Pass']);
// finishers.js's own buildSplitNumbers() never assigns a real line/split number to these two
// actions (matching the mobile app's own "Clock is a fixed marker outside the normal
// sequence" convention) — needed below to predict what split number a new entry would land
// at, so a repeat "Add to Finishers" on the same file recognizes splits it already added.
const NO_SPLIT_FINISHER_ACTIONS = new Set(['DNF', 'Clock']);
// Time mode's own "Stop"/"Reset"/"Undo" markers carry no split of their own — only Start (the
// fixed t=0 marker) and ordinary Split rows pair with a bib.
const TRANSFERABLE_TIME_ACTIONS = new Set(['Start', 'Split']);

// "HH:MM:SS.CC" (elapsed, as stored in splitTime) → "HH:MM:SS" — finishers.js's own
// parseFinishTime() splits on any non-digit run and rejects more than 3 numeric parts, so a
// trailing ".CC" must be stripped before it's usable as a finisher time.
function stripCentiseconds(splitTime) {
  return (splitTime || '').split('.')[0];
}

function getSelectedRows() {
  return [...document.querySelectorAll('#mobile-files-tbody input.mobile-file-select:checked')]
    .map(cb => currentRows[+cb.dataset.idx])
    .filter(Boolean);
}

// Same identity rule recordFinisher() itself uses for its duplicate check (Start vs Start,
// Finish/DNF vs Finish/DNF) — mirrored here so a match can be found and updated in place
// instead of just being rejected as a duplicate.
function findExistingFinisherIndex(bib, action) {
  const isStart = action === 'Start';
  return state.finishers.findIndex(f => +f.number === bib
    && (isStart ? f.action === 'Start' : (f.action === 'Finish' || f.action === 'DNF')));
}

// Duplicate split numbers within one bucket mean two independent recording streams got
// selected together (e.g. two separate bibs-recording phones) — their split numbers aren't
// comparable, so nothing here can be safely paired or transferred.
function findDuplicateSplitNumbers(rows) {
  const seen = new Set(), dupes = new Set();
  for (const r of rows) {
    if (seen.has(r.splitNumber)) dupes.add(r.splitNumber);
    seen.add(r.splitNumber);
  }
  return [...dupes].sort((a, b) => a - b);
}

// Combines the selected files' current-segment Bibs/Time entries (each device's own segment
// resolved independently first, exactly like showDeviceModal, since Reset boundaries and line
// numbers are per-device), validates them, and — if valid — records one finisher per bib entry
// via recordFinisher(), pairing it with the Time entry at the same split number if one exists.
// Driven entirely by bibs: a split with no matching bib is just excess (never looked up, so
// silently left behind — the bibs will catch up on a later sync) and a bib with no matching
// split is still added, just untimed — and if that bib was already added untimed by an earlier
// run (e.g. the bibs file arrived before the time file), a later run supplying the missing time
// updates that existing record instead of being rejected as a duplicate. This is the exact same
// entry point manual Finishers-page entry uses, so duplicate-bib and entries-list checks stay
// in one place rather than being reimplemented here.
async function addSelectedToFinishers() {
  // Refresh first so validation runs against the latest data — renderMobileFiles() already
  // shows its own status message if the fetch fails, falling back to whatever's currently
  // loaded (server unreachable is the expected case out in the field) rather than blocking.
  await renderMobileFiles();

  const selected = getSelectedRows();
  if (!selected.length) { showStatus('Select one or more mobile files first.', true); return; }

  const raceLabels = [...new Set(selected.map(r => r.raceLabel))];
  if (raceLabels.length > 1) {
    showStatus(`Cannot add to finishers — selected files are from different races: ${raceLabels.join(', ')}.`, true);
    return;
  }

  const bibs = [], times = [];
  for (const r of selected) {
    const { timeSegment, bibsSegment } = buildSegmentView(r.device.lines);
    bibs.push(...bibsSegment.filter(b => TRANSFERABLE_BIBS_ACTIONS.has(b.action)));
    times.push(...timeSegment.filter(t => TRANSFERABLE_TIME_ACTIONS.has(t.action)));
  }

  if (!bibs.length && !times.length) { showStatus('Selected file(s) have no transferable entries.', true); return; }

  const dupBibSplits = findDuplicateSplitNumbers(bibs);
  if (dupBibSplits.length) {
    showStatus(`Cannot add to finishers — more than one bibs-recording phone selected (duplicate split number(s) ${dupBibSplits.join(', ')}).`, true);
    return;
  }
  const dupTimeSplits = findDuplicateSplitNumbers(times);
  if (dupTimeSplits.length) {
    showStatus(`Cannot add to finishers — more than one time-recording phone selected (duplicate split number(s) ${dupTimeSplits.join(', ')}).`, true);
    return;
  }

  const locations = [...new Set([...bibs, ...times].map(l => l.location))];
  if (locations.length !== 1 || locations[0] !== 'Finish') {
    showStatus(`Cannot add to finishers — location must be "Finish" (found: ${locations.join(', ') || 'none'}).`, true);
    return;
  }

  const invalidBibs = [...new Set(
    bibs.filter(b => BIB_REQUIRED_FINISHER_ACTIONS.has(b.action))
      .map(b => +b.bibNumber)
      .filter(n => !Number.isFinite(n) || n <= 0 || !getEntry(n))
  )];
  if (invalidBibs.length) {
    showStatus(`Cannot add to finishers — bib number(s) not in entries: ${invalidBibs.join(', ')}.`, true);
    return;
  }

  if (!await showConfirmDialog(`Add ${bibs.length} finisher record(s) from ${selected.length} file(s)?`, 'Add to Finishers')) return;

  const timeBySplit = new Map(times.map(t => [t.splitNumber, t]));
  bibs.sort(bySplitNumber);

  let added = 0, timed = 0;
  const errors = [];
  let skipped = 0;
  for (const b of bibs) {
    const action = BIBS_ACTION_TO_FINISHER[b.action];
    const bib = BIB_REQUIRED_FINISHER_ACTIONS.has(b.action) ? +b.bibNumber : 0;
    const time = timeBySplit.get(b.splitNumber);
    const timeStr = time ? stripCentiseconds(time.splitTime) : '';

    if (BIB_REQUIRED_FINISHER_ACTIONS.has(b.action)) {
      // Already recorded (e.g. by an earlier run of just the bibs file)? Add the now-available
      // time to that same record rather than being rejected as a duplicate by recordFinisher()
      // — but only if it's genuinely still untimed; already-timed is a real duplicate, skip it.
      const existingIdx = findExistingFinisherIndex(bib, action);
      if (existingIdx >= 0) {
        const existing = state.finishers[existingIdx];
        if (!existing.time && timeStr) {
          const result = await updateFinisher(existingIdx, { time: timeStr });
          if (result.error) errors.push(result.error); else timed++;
        } else {
          skipped++;
        }
        continue;
      }
    } else if (action === 'Clock') {
      // Bib-less specials have no bib to key a duplicate check off — Clock is a one-off
      // marker (skip if one's already there), and the rest get a real split/line number, so
      // it's added only if that number is still ahead of where the finishers list has
      // already reached (behind it means this split was already transferred).
      if (state.finishers.some(f => f.action === 'Clock')) { skipped++; continue; }
    } else if (!NO_SPLIT_FINISHER_ACTIONS.has(action)) {
      const nextSplit = state.finishers.filter(f => !NO_SPLIT_FINISHER_ACTIONS.has(f.action)).length + 1;
      if (b.splitNumber < nextSplit) { skipped++; continue; }
    }

    const result = await recordFinisher(bib, timeStr, action);
    if (result.error) errors.push(result.error);
    else added++;
  }

  showStatus(
    `Added ${added} finisher${added === 1 ? '' : 's'}`
      + `${timed ? `, added a time to ${timed} already-recorded bib${timed === 1 ? '' : 's'}` : ''}`
      + `${skipped ? `, skipped ${skipped} already added` : ''}`
      + `${errors.length ? `, ${errors.length} error(s): ${errors.join('; ')}` : ''}.`,
    errors.length > 0 && added === 0 && timed === 0
  );
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
  let deviceInfo;
  try {
    deviceInfo = await bleConnect();
  } catch (e) {
    showStatus(e.message || 'Bluetooth connection failed.', true);
    return;
  }

  // The browser's own device picker can't show a meaningful name (racemaster-mobile
  // deliberately omits it from the advertisement), so this is the first point a real name is
  // available at all — confirm here before doing anything else with the connection.
  const name = deviceInfo.deviceName || deviceInfo.deviceId;
  if (!await showConfirmDialog(`Connect to "${name}"?`, 'Connect')) {
    disconnectPhone();
    showStatus('Cancelled — disconnected.');
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
  on('btn-add-to-finishers', 'click', addSelectedToFinishers);
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
  document.getElementById('mobile-files-tbody')?.addEventListener('change', e => {
    const cb = e.target.closest('input.mobile-file-select');
    if (!cb) return;
    const r = currentRows[+cb.dataset.idx];
    if (!r) return;
    if (cb.checked) selectedKeys.add(rowKey(r)); else selectedKeys.delete(rowKey(r));
  });
}

// Genuinely awaitable (not fire-and-forget) so a caller — e.g. addSelectedToFinishers()
// wanting the latest data before validating a transfer — can wait for it to finish. Resolves
// true if the server fetch succeeded, false if it fell back to a local/offline view (with its
// own status message already shown either way, so callers don't need to notify separately on
// top of it).
export async function renderMobileFiles() {
  const session  = getSession();
  const count    = getEl('mobile-files-count');
  const connectBtn = getEl('btn-connect-phone');
  if (connectBtn) connectBtn.hidden = !isBluetoothAvailable();
  updateConnectButtonLabel();
  if (!session) {
    showStatus('Sign in on the Datasets page to view mobile files.');
    renderRaceList([], false);
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
    if (count) count.textContent = `${merged.length} race${merged.length === 1 ? '' : 's'}`;
    renderRaceList(merged, isAdminUser);
    showStatus(merged.length ? '' : 'No mobile files uploaded yet.');
    return true;
  } catch {
    // Server unreachable — keep showing whatever was last successfully loaded rather than
    // wiping the list down to only locally-pulled pending files.
    const merged = mergePendingIntoRaces(lastKnownRaces, pending);
    if (count) count.textContent = `${merged.length} race${merged.length === 1 ? '' : 's'}`;
    renderRaceList(merged, isAdminUser);
    showStatus(merged.length
      ? 'Server unreachable — showing the last known list plus anything pulled locally.'
      : 'Server unreachable, and no locally-pulled files yet.', !merged.length);
    return false;
  }
}