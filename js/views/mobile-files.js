'use strict';

import {
  getSession, getIsAdmin, getUsername, apiListMobileFiles, apiDeleteMobileFile,
  apiPushMobileSync, getPendingMobileFiles, savePendingMobileFile, removePendingMobileFile,
} from '../storage.js';
import { on, escHtml, showConfirmDialog, showChoiceDialog, showStatus, renderTable, tableColumns } from '../ui.js';
import { TABLES } from '../strings.js';
import {
  isBluetoothAvailable, connectToPhone as bleConnect, pullFromConnectedPhone,
  disconnectPhone, isConnected, getConnectedDeviceName, onDisconnect,
  resetLastPulledLineNumber, resetAllLastPulledLineNumbers, getRecommendedPollIntervalMs,
  isBleLoggingEnabled, setBleLoggingEnabled, getKnownDevices, reconnectToKnownDevice,
} from '../mule-ble.js';
import { getEntry } from '../entries.js';
import { recordFinisher, clearAllFinishers } from '../finishers.js';
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

// ---- "New since last Add to Finishers" tracking ----
//
// Every line in a device's file — a new bib/split, an edit-echo, an Undo marker, a Reset marker —
// gets a brand new, permanent, never-reused lineNumber (see racemaster-mobile's own
// RaceEntity.nextLineNumber). So "has anything changed since the last Add to Finishers run for
// this device" reduces to one number: the highest lineNumber present now, compared against
// whatever it was the last time this device was included in a run. Persisted (not just in
// memory) so the red/green marker survives a page reload the same way selection itself doesn't
// need to — this genuinely needs to.
const LAST_SYNCED_KEY = 'racemaster-mobile-last-synced';

function loadLastSynced() {
  try { return JSON.parse(localStorage.getItem(LAST_SYNCED_KEY) || '{}'); } catch { return {}; }
}
function saveLastSynced(map) {
  try { localStorage.setItem(LAST_SYNCED_KEY, JSON.stringify(map)); } catch { /* storage unavailable/full — best effort only */ }
}
function getLastSyncedLineNumber(r) {
  return loadLastSynced()[rowKey(r)] || 0;
}
function setLastSyncedLineNumber(r) {
  const map = loadLastSynced();
  map[rowKey(r)] = maxLineNumber(r.device.lines);
  saveLastSynced(map);
}
function maxLineNumber(lines) {
  return lines.reduce((max, l) => Math.max(max, l.lineNumber ?? 0), 0);
}

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
// race grouping, same date-sort position. p.lines is only ever the *delta* since this device's
// own last successful BLE pull (see mule-ble.js's delta-sync), never the whole file — so a
// pending device's lines are merged into whatever the server already knows about that same
// device (deduping by recordUuid, same convention as storage.js's own savePendingMobileFile),
// not used to replace it outright. Replacing outright used to be correct back when a pull always
// returned everything, but doing that now would make the server's already-known lines vanish
// the moment a single new delta line arrives while offline.
function mergePendingIntoRaces(races, pending) {
  const merged = races.map(race => ({ ...race, devices: [...race.devices] }));
  for (const p of pending) {
    let race = merged.find(r => r.owner === p.owner && r.raceLabel === p.raceLabel);
    if (!race) {
      race = { owner: p.owner, raceLabel: p.raceLabel, raceDate: parseRaceLabelDate(p.raceLabel), devices: [] };
      merged.push(race);
    }
    const known = race.devices.find(d => d.name === p.deviceName);
    const knownLines = known ? known.lines : [];
    const seenUuids = new Set(knownLines.map(l => l.recordUuid).filter(Boolean));
    const lines = [...knownLines, ...p.lines.filter(l => l.recordUuid && !seenUuids.has(l.recordUuid))];
    race.devices = race.devices.filter(d => d.name !== p.deviceName);
    race.devices.push({ name: p.deviceName, deviceId: p.deviceId, lines, pending: true });
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

// A Reset or an Undo on the phone is already fully reflected here — currentSegment() drops
// everything at/before the family's last Reset, and foldLatestVisible() drops anything whose
// latest state is an Undo marker. Add to Finishers (see below) exploits this: since the segment
// is always the true, current picture, syncing to Finishers never needs to diff against or patch
// around what's already there — it just wipes Finishers and rebuilds from the segment.
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
      <td>${bib ? escHtml(bib.note ?? '') : ''}</td>
      <td>${time ? escHtml(time.action) : ''}</td>
      <td>${time ? escHtml(time.splitTime ?? '') : ''}</td>
      <td>${time ? whenOf(time) : ''}</td>
      <td>${time ? escHtml(time.note ?? '') : ''}</td>
    </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:820px">
      <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
      <p style="margin:0 0 12px;font-size:0.875rem">Location: ${locationSummary(visibleRows)}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th rowspan="2">Split #</th>
            <th colspan="4">Bibs</th>
            <th colspan="4">Time</th>
          </tr><tr>
            <th>Action</th><th>Bib</th><th>When</th><th>Note</th><th>Action</th><th>Split Time</th><th>When</th><th>Note</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="color:var(--muted)">No entries in the current segment.</td></tr>'}</tbody>
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
      const r = { owner: race.owner, raceLabel: race.raceLabel, device };
      rows.push({
        idx: rows.length,
        ...r,
        raceDate: race.raceDate,
        pending: !!device.pending,
        location: locationSummary([...timeSegment, ...bibsSegment]),
        bibsVisible: bibsSegment.length,
        timeVisible: timeSegment.length,
        incorporationStatus: computeIncorporationStatus(r),
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
    rowAttrs: r => ({
      'data-idx': r.idx,
      class: r.incorporationStatus === 'outstanding' ? 'row-outstanding'
        : r.incorporationStatus === 'incorporated' ? 'row-incorporated'
        : '',
    }),
  });
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

// Derives what Finishers *should* contain for one file's current segment — bib-driven (a split
// with no matching bib is just excess, never looked up; a bib with no matching split is still
// included, just untimed), pairing each bib with the Time entry at the same split number if one
// exists. Retirees never carry a split time (finishers.js's own NO_SPLIT_ACTIONS convention);
// Clock's own "time" is its offset/time-of-day value from its note field, not a paired split.
// This relies on racemaster-mobile not allocating a splitNumber to DNF rows at all (so they
// never consume a slot the Time-mode side didn't also produce) — without that, a retiree
// partway through a race would permanently offset every later bib's splitNumber against its
// true corresponding Time split.
//
// This is the single source of truth both the red/green status check and the actual rebuild
// below are computed from, so they can never disagree with each other.
function expectedFinisherEntries(bibs, times) {
  const timeBySplit = new Map(times.map(t => [t.splitNumber, t]));
  return [...bibs].sort(bySplitNumber).map(b => {
    const action = BIBS_ACTION_TO_FINISHER[b.action];
    const number = BIB_REQUIRED_FINISHER_ACTIONS.has(b.action) ? +b.bibNumber : 0;
    const paired = timeBySplit.get(b.splitNumber);
    const time = action === 'DNF' ? ''
      : action === 'Clock' ? (b.note || '')
      : (paired ? stripCentiseconds(paired.splitTime) : '');
    return { action, number, time };
  });
}

// Deliberately has nothing to do with Finishers' own content — comparing against it line by line
// kept breaking on one edge case after another (corrections, retirees, Clock notes, Undo, Reset…).
// All that actually matters to the operator is "has this file changed since I last ran Add to
// Finishers on it" — answered purely from the file's own lineNumbers (see the tracking block
// near rowKey above). Only meaningful for a currently-selected file; an unselected one is always
// left uncoloured, since it's not what a click of Add to Finishers would even touch right now.
function computeIncorporationStatus(r) {
  if (!selectedKeys.has(rowKey(r))) return 'none';
  return maxLineNumber(r.device.lines) > getLastSyncedLineNumber(r) ? 'outstanding' : 'incorporated';
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
// numbers are per-device), validates them, and — if valid — deletes every existing finisher and
// rebuilds the list from scratch via expectedFinisherEntries()/recordFinisher(). Line-by-line
// diffing against whatever Finishers already held (patching in corrections, retracting entries
// the phone had since undone or reset away, etc.) turned out to be a losing battle with every new
// edge case the phone's own history could produce — a full rebuild sidesteps all of that: the
// current segment (see buildSegmentView) is already the true, final picture, Reset/Undo included,
// so there's nothing left to diff. This is the exact same entry point manual Finishers-page entry
// uses, so duplicate-bib and entries-list checks stay in one place rather than being reimplemented
// here.
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

  const expected = expectedFinisherEntries(bibs, times);
  const existingCount = state.finishers.length;
  const confirmMsg = existingCount
    ? `This deletes all ${existingCount} existing finisher record(s) and rebuilds ${expected.length} from ${selected.length} selected file(s). Continue?`
    : `Add ${expected.length} finisher record(s) from ${selected.length} file(s)?`;
  if (!await showConfirmDialog(confirmMsg, 'Add to Finishers')) return;

  await clearAllFinishers();

  let added = 0;
  const errors = [];
  for (const exp of expected) {
    const result = await recordFinisher(exp.number, exp.time, exp.action);
    if (result.error) errors.push(result.error); else added++;
  }

  // Mark every selected file as "seen as of now" — this run covered whatever these files held at
  // this moment, regardless of any per-entry errors above, so the red/green marker should reset
  // right along with it. See the tracking block near rowKey for why a lineNumber is enough.
  for (const r of selected) setLastSyncedLineNumber(r);

  // Re-render so each transferred file's row immediately reflects its new incorporation status
  // (red/green) rather than waiting for the next Refresh/pull — see the ordering note above
  // deleteRow() for why this comes before the specific outcome message, not after.
  await renderMobileFiles();
  showStatus(
    `Rebuilt the finishers list: ${added} record${added === 1 ? '' : 's'} added`
      + `${errors.length ? `, ${errors.length} error(s): ${errors.join('; ')}` : ''}.`,
    errors.length > 0 && added === 0
  );
}

// Gated the same way mule-ble.js's own bleLog is — routine tracing only, off by default.
function debugLog(...args) { if (isBleLoggingEnabled()) console.log(...args); }

function updateConnectButtonLabel() {
  const btn = getEl('btn-connect-phone');
  if (!btn) return;
  btn.textContent = isConnected() ? `Disconnect from ${getConnectedDeviceName()}` : 'Connect to Phone…';
  // Echoes getRecommendedPollIntervalMs() so it's visible whether auto-sync is even running and
  // at what cadence, rather than something only inferable from timestamps in the console.
  const pollEl = getEl('mobile-files-poll-interval');
  if (pollEl) {
    if (isConnected()) {
      pollEl.textContent = `Auto-polling every ${Math.round(getRecommendedPollIntervalMs() / 1000)}s`;
      pollEl.hidden = false;
    } else {
      pollEl.hidden = true;
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
let autoPullTimer = null;

// Guards against overlapping pulls — a slow BLE transfer (large history, weak signal) could
// still be in flight when the next timer tick or a manual Refresh click fires.
let pullInProgress = false;

function startAutoPull() {
  stopAutoPull();
  const intervalMs = getRecommendedPollIntervalMs();
  debugLog(`[mobile-files] starting auto-pull every ${intervalMs}ms`);
  autoPullTimer = setInterval(() => {
    debugLog('[mobile-files] auto-pull tick');
    pullAndSyncConnectedPhone({ silent: true });
  }, intervalMs);
}

function stopAutoPull() {
  if (autoPullTimer !== null) {
    clearInterval(autoPullTimer);
    autoPullTimer = null;
  }
}

// Set immediately before every deliberate disconnectPhone() call in this file, so the listener
// below can tell "we know why this just happened" apart from a genuinely unexpected drop (phone
// out of range, GATT hiccup) — the latter otherwise stopped auto-sync with zero visible sign of
// it beyond the button quietly reverting, which is exactly what looked like "polling silently
// not working" with nothing to explain why.
let expectingDisconnect = false;

function onBleDisconnected() {
  stopAutoPull();
  updateConnectButtonLabel();
  if (expectingDisconnect) {
    debugLog('[mobile-files] disconnected (expected)');
  } else {
    // Never gated behind the logging toggle — same reasoning as mule-ble.js's own bleError: a
    // real problem needs to be visible even if that toggle was left off.
    console.error('[mobile-files] Bluetooth connection lost unexpectedly — auto-sync has stopped');
    showStatus('Lost the Bluetooth connection — auto-sync has stopped. Click Connect to Phone… to reconnect.', true);
  }
}

// Pulls whatever history the currently-connected phone is holding, pushing each device
// straight to the server exactly like a WiFi sync would. If the server can't be reached (the
// expected case out in the field, with no internet), each pull is kept locally as "pending"
// instead — see storage.js's savePendingMobileFile — until a Push action later succeeds.
// [silent] suppresses the status toast/re-render when there's nothing new — used by the
// background auto-pull tick above so it doesn't spam a toast every 10s when the phone simply
// hasn't recorded anything new since the last pull; an explicit Connect/Refresh click always
// reports, even when the result is empty, so the operator gets confirmation the action ran.
async function pullAndSyncConnectedPhone({ silent = false } = {}) {
  debugLog(`[mobile-files] pull requested (silent=${silent})`);
  if (pullInProgress) { debugLog('[mobile-files] pull skipped — a pull is already in progress'); return; }
  if (!isConnected()) {
    // Real, reproducible case: the phone can drop the GATT link while sitting idle (e.g.
    // Android backgrounding it while the operator is still looking at the "Connect to X?"
    // confirm dialog below) — onDisconnect's own listener already reverted the button, but
    // without this the caller was left showing "Connected… pulling history…" forever with no
    // further feedback, since this returned with nothing at all.
    debugLog('[mobile-files] pull skipped — not connected');
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
  try {
    let pulled;
    try {
      pulled = await pullFromConnectedPhone();
    } catch (e) {
      if (!silent) showStatus(e.message || 'Failed to pull history from the phone.', true);
      return;
    }
    const totalLines = pulled.reduce((n, r) => n + r.lines.length, 0);
    if (silent && totalLines === 0) return;

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
    // renderMobileFiles() does its own server fetch and announces its own outcome ("Loading…",
    // then "Server unreachable…" if that fetch fails, which is the expected case out in the
    // field with no network) — awaited and ordered before our own summary below so that one
    // doesn't get shown only to be immediately overwritten by this, but the other way round.
    await renderMobileFiles();
    showStatus(silent
      // The background auto-pull tick found something new on its own, with no action from the
      // operator — worth calling out distinctly from a manual Connect/Refresh result so it
      // doesn't read as something they just did themselves.
      ? `Auto-sync: pulled ${totalLines} new record${totalLines === 1 ? '' : 's'} from ${getConnectedDeviceName()} (${synced} synced to the server, ${pending} saved locally).`
      : `Pulled ${pulled.length} device file${pulled.length === 1 ? '' : 's'}: ${synced} synced to the server, ${pending} saved locally.`);
  } finally {
    pullInProgress = false;
  }
}

// Connects to a nearby phone over Bluetooth (racemaster-mobile's Mule Mode — see mule-ble.js),
// pulls its history via pullAndSyncConnectedPhone above, then leaves the connection open with
// startAutoPull() running (button becomes "Disconnect from <device>") so a second click just
// ends the session rather than re-picking a device.
async function onConnectButtonClick() {
  if (isConnected()) {
    expectingDisconnect = true;
    disconnectPhone();
    onBleDisconnected();
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
  // A remembered phone (one already connected to and verified before) can be reconnected
  // directly, skipping the browser's own anonymous picker entirely — see getKnownDevices()'s
  // own doc for why that picker can never show a real name on its own.
  const known = await getKnownDevices();
  let chosenDevice = null;
  if (known.length) {
    const choices = known.map(k => ({ label: `Reconnect to ${k.name}`, value: k.device }));
    choices.push({ label: 'Pick a different phone…', value: 'other' });
    const picked = await showChoiceDialog('Connect to which phone?', choices, { vertical: true });
    if (picked === null) { showStatus('Cancelled.'); return; }
    if (picked !== 'other') chosenDevice = picked;
  }

  showStatus('Connecting…');
  let deviceInfo;
  try {
    // Passing showStatus straight through as the progress callback keeps the status bar
    // refreshed at each real step — its own 10s auto-clear otherwise fires regardless of
    // whether the connect attempt is actually done, making a still-in-progress retry look like
    // it silently gave up.
    deviceInfo = chosenDevice ? await reconnectToKnownDevice(chosenDevice, showStatus) : await bleConnect(showStatus);
  } catch (e) {
    showStatus(e.message || 'Bluetooth connection failed.', true);
    return;
  }

  // A device fresh from the browser's own anonymous picker still needs its real name confirmed
  // — this is the first point one is available at all. A remembered device was already chosen
  // by that same real name a moment ago, so there's nothing left here to confirm for it.
  if (!chosenDevice) {
    const name = deviceInfo.deviceName || deviceInfo.deviceId;
    if (!await showConfirmDialog(`Connect to "${name}"?`, 'Connect')) {
      expectingDisconnect = true;
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

  expectingDisconnect = false;
  updateConnectButtonLabel();
  showStatus(`Connected to ${getConnectedDeviceName()} — pulling history…`);
  await pullAndSyncConnectedPhone();
  startAutoPull();
}

async function onRefreshButtonClick() {
  if (isConnected()) {
    await pullAndSyncConnectedPhone();
  } else {
    renderMobileFiles();
  }
}

export function wireMobileFiles() {
  on('btn-refresh-mobile-files', 'click', onRefreshButtonClick);
  on('btn-connect-phone', 'click', onConnectButtonClick);
  on('btn-add-to-finishers', 'click', addSelectedToFinishers);
  onDisconnect(onBleDisconnected);
  const loggingCb = document.getElementById('btn-ble-logging');
  if (loggingCb) {
    loggingCb.checked = isBleLoggingEnabled();
    loggingCb.addEventListener('change', () => setBleLoggingEnabled(loggingCb.checked));
  }
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
    // Colour is selection-driven now — reflect the change immediately rather than waiting for
    // the next full re-render (a fresh fetch or a Refresh/Add to Finishers click).
    r.incorporationStatus = computeIncorporationStatus(r);
    const tr = cb.closest('tr');
    if (tr) {
      tr.classList.remove('row-outstanding', 'row-incorporated');
      if (r.incorporationStatus === 'outstanding') tr.classList.add('row-outstanding');
      else if (r.incorporationStatus === 'incorporated') tr.classList.add('row-incorporated');
    }
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