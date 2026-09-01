'use strict';

import {
  getSession, getIsAdmin, getUsername, apiListMobileFiles, apiDeleteMobileFile,
  apiPushMobileSync, getPendingMobileFiles, savePendingMobileFile, removePendingMobileFile,
} from '../storage.js';
import { on, escHtml, showConfirmDialog, showChoiceDialog, showStatus, renderTable, tableColumns, wireTabBar } from '../ui.js';
import { TABLES } from '../strings.js';
import {
  isBluetoothAvailable, connectToPhone as bleConnect, pullFromConnectedPhone,
  disconnectPhone, isConnected, getConnectedDeviceName, onDisconnect,
  resetLastPulledLineNumber, resetAllLastPulledLineNumbers, getRecommendedPollIntervalMs,
  isBleLoggingEnabled, setBleLoggingEnabled, getKnownDevices, reconnectToKnownDevice,
  abandonConnection, forgetKnownDevice, getConnectedDeviceInfo,
  getRaceStaleAfterDays, setRaceStaleAfterDays,
} from '../mule-ble.js';
import { getEntry } from '../entries.js';
import { entryInfo } from '../safety.js';
import { getMobileCheckpointNumbers, getMobileCheckpointTimes } from '../mobile-checkpoints.js';
import { secondsToTime } from '../utils.js';
import { state, saveMobileCheckpoints, saveMobileProgress } from '../state.js';

function getEl(id) { return document.getElementById(id); }

let currentRows = []; // flattened, one entry per device — see flattenDevices()

// The last successfully-fetched server race list — kept so a transient failed refresh (the
// server going offline, e.g. via the Datasets page's "Hide Server" toggle) falls back to it
// instead of wiping the list down to only locally-pulled pending files.
let lastKnownRaces = [];

// Ticked checkboxes, keyed by identity rather than row index — row indices are reassigned on
// every render (races/devices can appear in a different order once sorted), so persisting
// selection across a re-render (or navigating away from Mobile Files and back) needs a stable
// key instead.
const selectedKeys = new Set();
function rowKey(r) { return `${r.owner} ${r.raceLabel} ${r.device.name}`; }

// Persisted (unlike selectedKeys' own in-memory Set, which this only ever seeds/mirrors) so
// the Results & Prize List page's autoUpdateProgress() (see below) can find "what was last
// ticked here" even after a page reload, with the event name+date stored alongside so a later
// dataset switch doesn't get an old event's selection silently replayed against a new one.
const SELECTED_KEYS_STORAGE_KEY = 'racemaster-mobile-selected-keys';

function loadSelectedKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTED_KEYS_STORAGE_KEY) || 'null');
    return parsed && Array.isArray(parsed.keys) ? parsed : null;
  } catch { return null; }
}
function saveSelectedKeys() {
  try {
    localStorage.setItem(SELECTED_KEYS_STORAGE_KEY, JSON.stringify({
      eventName: state.event.name, eventDate: state.event.date, keys: [...selectedKeys],
    }));
  } catch { /* storage unavailable/full — best effort only, same as other persisted state here */ }
}

// ---- "New since last Compute Results" tracking ----
//
// Every line in a device's file — a new bib/split, an edit-echo, an Undo marker, a Reset marker —
// gets a brand new, permanent, never-reused lineNumber (see racemaster-mobile's own
// RaceEntity.nextLineNumber). So "has anything changed since the last Compute Results run for
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

// ---- "Last actually polled over Bluetooth" tracking ----
//
// device.lastSeen (see flattenDevices() below) is either the server's own file mtime for a
// synced device, or a pending file's own pulledAt — neither of which updates on a poll that
// found nothing new: pullAndSyncConnectedPhone() skips its push loop entirely whenever
// totalLines is 0 (see its own doc), so a phone polled repeatedly with nothing new to report
// would otherwise show the same stale Last Seen from whenever it was first synced, even though
// this browser just successfully talked to it again a moment ago. This tracks that contact
// independently of whether it found anything new, persisted (not just in memory, same as
// LAST_SYNCED_KEY above) so it survives a page reload — keyed the same way rowKey() is, since a
// pull's own results carry owner/raceLabel/deviceName but no ready-made row object to key off.
const BLE_LAST_SEEN_KEY = 'racemaster-mobile-ble-last-seen';

function loadBleLastSeen() {
  try { return JSON.parse(localStorage.getItem(BLE_LAST_SEEN_KEY) || '{}'); } catch { return {}; }
}
function recordBleLastSeen(owner, raceLabel, deviceName) {
  const map = loadBleLastSeen();
  map[`${owner} ${raceLabel} ${deviceName}`] = new Date().toISOString();
  try { localStorage.setItem(BLE_LAST_SEEN_KEY, JSON.stringify(map)); } catch { /* storage unavailable/full — best effort only */ }
}
function getBleLastSeen(owner, raceLabel, deviceName) {
  return loadBleLastSeen()[`${owner} ${raceLabel} ${deviceName}`] || null;
}

// Later of two ISO timestamps (either may be null/undefined) — device.lastSeen and a
// getBleLastSeen() lookup are both real UTC toISOString() output, so a plain Date comparison is
// all that's needed; no need for the string-surgery formatStoredTimestamp() below deals with,
// which is only for the phone's own non-ISO "yyyy/mm/dd HH:MM:SS" wire format.
function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

function formatRaceDate(raceDate) {
  if (!raceDate) return '<span style="color:var(--muted)">Unknown</span>';
  return `${raceDate.dd}/${raceDate.mm}/${raceDate.yy}`;
}

// ISO string (device.lastSeen — either a server file mtime or a pending file's local pulledAt,
// see flattenDevices()) → "dd/mm/yy HH:MM" local time, matching formatRaceDate()'s own dd/mm/yy
// convention elsewhere on this page.
function formatDateTime(iso) {
  if (!iso) return '<span style="color:var(--muted)">—</span>';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '<span style="color:var(--muted)">—</span>';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// device.lastUpdate (see latestLineTimestamp() below) is the phone's own "yyyy/mm/dd HH:MM:SS"
// stamp (formatTimestamp() in mule-ble.js) — reformatted to the same "dd/mm/yy HH:MM" shape as
// formatDateTime() above via plain string surgery, not Date parsing, since that separator ("/"
// for both date and, on some engines' toString, ambiguously for time too) isn't reliably
// cross-browser-parseable back into a Date.
function formatStoredTimestamp(ts) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/.exec(ts || '');
  if (!m) return '<span style="color:var(--muted)">—</span>';
  const [, yyyy, mm, dd, HH, MM] = m;
  return `${dd}/${mm}/${yyyy.slice(-2)} ${HH}:${MM}`;
}

// Latest of a device's own record timestamps ("yyyy/mm/dd HH:MM:SS", zero-padded so it sorts
// correctly as a plain string) — across *all* lines, not just the currently-visible segment, so
// this still reflects real recency after a Reset. Distinct from device.lastSeen (see above):
// this is when the newest split/entry actually happened on the phone, not when the server (or
// this browser, for a pending file) last heard from it.
function latestLineTimestamp(lines) {
  let max = null;
  for (const l of lines) {
    const ts = l.timestamp ?? l.timestampMillis;
    if (ts && (!max || ts > max)) max = ts;
  }
  return max;
}

// Mirrors server.js's parseRaceLabelDate/sort exactly — needed client-side because a
// Bluetooth-pulled, not-yet-pushed file has no server entry to derive/sort a race date from.
// raceLabel ends "…-YY-MM-DD" (2-digit year first, e.g. "-26-08-04" = 4 August 2026 — confirmed
// against real racemaster-mobile-generated labels), not "dd-mm-yy" as an earlier version of this
// comment claimed — that mislabeling had the date-sort comparator below effectively sorting by
// day-of-month first, which only looked right by accident whenever every race fell in one month.
function parseRaceLabelDate(raceLabel) {
  const m = /-(\d{2})-(\d{2})-(\d{2})$/.exec(raceLabel || '');
  return m ? { yy: m[1], mm: m[2], dd: m[3] } : null;
}

// The trailing "-DD-MM-YY" is just the date suffix baked into every raceLabel (see
// parseRaceLabelDate above) — stripped off so two races sharing the same date sort by their
// actual name, not by a string that already differs in the very date component being grouped on.
function raceNameOf(raceLabel) {
  return (raceLabel || '').replace(/-\d{2}-\d{2}-\d{2}$/, '');
}

// Newest date first, then race name, matching how an organiser actually thinks about a list
// spanning several events — "today's race" first, and same-day races (e.g. a multi-course
// event) grouped together in a stable, readable order rather than whatever order the server
// happened to return them in.
function sortRaces(races) {
  return [...races].sort((a, b) => {
    if (a.raceDate && b.raceDate) {
      const dateCmp = b.raceDate.yy !== a.raceDate.yy ? b.raceDate.yy.localeCompare(a.raceDate.yy)
        : b.raceDate.mm !== a.raceDate.mm ? b.raceDate.mm.localeCompare(a.raceDate.mm)
        : b.raceDate.dd.localeCompare(a.raceDate.dd);
      if (dateCmp !== 0) return dateCmp;
    } else if (a.raceDate) {
      return -1;
    } else if (b.raceDate) {
      return 1;
    }
    return raceNameOf(a.raceLabel).localeCompare(raceNameOf(b.raceLabel));
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
    race.devices.push({ name: p.deviceName, deviceId: p.deviceId, lines, pending: true, lastSeen: p.pulledAt });
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

// Sorts by the file's own lineNumber — the one field every row has and that's never ambiguous.
// splitNumber can't be used for this: it's null for rows with no real split (Clock, DNF — see
// NO_SPLIT_ACTIONS in finishers.js), and `?? 0` would collide those with each other and with any
// genuine split 0, scrambling their order. That matters beyond just DNF: multiple Clock lines are
// legitimate (a later one is a clock reset — not yet implemented mobile-side, but the ordering
// must already be right for when it is), and only lineNumber order preserves which came first.
function byLineNumber(a, b) { return (a.lineNumber ?? 0) - (b.lineNumber ?? 0); }

function formatCount(visible) {
  return visible === 0 ? '' : String(visible);
}

// A Reset or an Undo on the phone is already fully reflected here — currentSegment() drops
// everything at/before the family's last Reset, and foldLatestVisible() drops anything whose
// latest state is an Undo marker. Compute Results (see below) exploits this: since the segment
// is always the true, current picture, syncing to Finishers never needs to diff against or patch
// around what's already there — it just wipes Finishers and rebuilds from the segment.
function buildSegmentView(lines) {
  const timeRows = lines.filter(r => r.splitTime != null);
  const bibsRows = lines.filter(r => r.splitTime == null);
  return {
    timeSegment: foldLatestVisible(currentSegment(timeRows)).sort(byLineNumber),
    bibsSegment: foldLatestVisible(currentSegment(bibsRows)).sort(byLineNumber),
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

// Same "every visible line should share one location" rule as locationSummary(), but returns
// the raw string (or null if the file disagrees with itself, which is already invalid) rather
// than a display-ready HTML snippet — used by updateProgress() to bucket selected files by
// resolved location rather than show them.
function rawLocationOf(visibleRows) {
  const locations = [...new Set(visibleRows.map(r => r.location))];
  return locations.length === 1 ? locations[0] : null;
}

// Every location is free text set by the phone operator (RaceMaster Mobile's own
// RaceEntity.location — e.g. "Finish", "1 - Polebank", "Hadden 2", "CP3", "cp 3"). The phone
// app itself enforces that a non-Finish location contains exactly one number, so any location
// with a digit in it is a checkpoint identified by that number — there's no other convention
// to key off since location is otherwise arbitrary free text.
function resolveLocationKey(location) {
  const loc = (location || '').trim();
  if (/^finish$/i.test(loc)) return { kind: 'finish' };
  const m = loc.match(/(\d+)/);
  return m ? { kind: 'cp', number: +m[1] } : null; // null = unrecognised
}

function showDeviceModal(owner, raceLabel, deviceName, lines) {
  const { timeSegment, bibsSegment } = buildSegmentView(lines);
  const visibleRows = [...timeSegment, ...bibsSegment];

  // Rows with a real splitNumber pair a bibs-recording phone's entry with a time-recording
  // phone's entry at the same position in the sequence. Rows with no real splitNumber (DNF —
  // see NO_SPLIT_ACTIONS in finishers.js) never pair with anything and must get a row of their
  // own — falling back to a shared "0" for all of them (as this used to, via `splitNumber ?? 0`)
  // collapsed them onto one slot, real splitNumber-0 row included, so only the first one found
  // there was ever shown, silently hiding the rest (e.g. a DNF hidden behind Clock's own real 0).
  const bySplit = new Map(); // real splitNumber -> { bib, time, order }
  const solo = [];           // one entry per row with no real splitNumber: { bib|time, order }
  const place = (r, side) => {
    if (r.splitNumber == null) { solo.push({ [side]: r, order: r.lineNumber ?? 0 }); return; }
    const p = bySplit.get(r.splitNumber) || { order: r.lineNumber ?? 0 };
    p[side] = r;
    p.order = Math.min(p.order, r.lineNumber ?? 0);
    bySplit.set(r.splitNumber, p);
  };
  for (const r of bibsSegment) place(r, 'bib');
  for (const r of timeSegment) place(r, 'time');

  const displayRows = [...bySplit.entries()].map(([n, p]) => ({ n, ...p }))
    .concat(solo.map(p => ({ n: null, ...p })))
    .sort((a, b) => a.order - b.order);

  const rows = displayRows.map(({ n, bib, time }) => `<tr>
      <td>${n ?? ''}</td>
      <td>${bib ? escHtml(bib.action) : ''}</td>
      <td>${bib ? escHtml(bib.bibNumber ?? '') : ''}</td>
      <td>${bib ? whenOf(bib) : ''}</td>
      <td>${bib ? escHtml(bib.note ?? '') : ''}</td>
      <td>${time ? escHtml(time.action) : ''}</td>
      <td>${time ? escHtml(time.splitTime ?? '') : ''}</td>
      <td>${time ? whenOf(time) : ''}</td>
      <td>${time ? escHtml(time.note ?? '') : ''}</td>
    </tr>`).join('');

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

// bib-allocations.json's contents (see js/bib-allocations.js) — the web app's own bib/name/
// course export for this race, not anything pulled from a phone.
function showBibAllocationsModal(owner, raceLabel, ba) {
  const sorted = [...ba.entries].sort((a, b) => a.bibNumber - b.bibNumber);
  const rows = sorted.map(e => `<tr><td>${e.bibNumber}</td><td>${escHtml(e.name)}</td><td>${escHtml(e.course)}</td></tr>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:520px">
      <h2>Bib Allocations — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
      <p style="margin:0 0 12px;font-size:0.875rem">Generated ${escHtml(ba.generatedAt || '')}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Bib</th><th>Name</th><th>Course</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" style="color:var(--muted)">No bib allocations.</td></tr>'}</tbody>
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

// Finish first, then CP1, CP2, ... ascending, then anything unrecognised/inconsistent last
// (alphabetically among themselves) — mirrors resolveLocationKey's own Finish/CP convention
// (see the Results tab), so devices within one race list in course order rather than whatever
// order the server happened to return them in.
function locationSortKey(rawLocation) {
  const key = resolveLocationKey(rawLocation);
  if (key?.kind === 'finish') return [0, 0, ''];
  if (key?.kind === 'cp')     return [1, key.number, ''];
  return [2, 0, rawLocation || ''];
}

// Flattens races → one row per device, precomputing everything the columns need so the
// column render functions below stay trivial reads, same as every other list view's *_COLS.
function flattenDevices(races) {
  const rows = [];
  for (const race of races) {
    const withLocation = race.devices.map(device => {
      const { timeSegment, bibsSegment } = buildSegmentView(device.lines);
      return { device, timeSegment, bibsSegment, rawLocation: rawLocationOf([...timeSegment, ...bibsSegment]) };
    });
    withLocation.sort((a, b) => {
      const ka = locationSortKey(a.rawLocation), kb = locationSortKey(b.rawLocation);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    });
    for (const { device, timeSegment, bibsSegment } of withLocation) {
      const r = { owner: race.owner, raceLabel: race.raceLabel, device };
      rows.push({
        idx: rows.length,
        ...r,
        raceDate: race.raceDate,
        pending: !!device.pending,
        location: locationSummary([...timeSegment, ...bibsSegment]),
        bibsVisible: bibsSegment.length,
        timeVisible: timeSegment.length,
        lastSeen: laterIso(device.lastSeen, getBleLastSeen(race.owner, race.raceLabel, device.name)),
        lastUpdate: latestLineTimestamp(device.lines),
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
    lastSeen:   r => formatDateTime(r.lastSeen),
    lastUpdate: r => formatStoredTimestamp(r.lastUpdate),
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

// One row per race that has a bib-allocations.json (see js/bib-allocations.js) — races with
// none yet (nothing pushed, or none of this user's races have an event/entries set up) are
// simply omitted, same convention flattenDevices() uses for a race with no devices.
let currentBibAllocRows = [];

// Race last actioned via "Send to Phone" — kept keyed (not just an index) so it survives a
// full re-render (Refresh, tab revisit) in the same slot, same idea as rowKey() for the
// Devices tab's own selection tracking. In-memory only; resets on page reload.
let lastSentKey = null;
function bibAllocKey(r) { return `${r.owner} ${r.raceLabel}`; }

function renderBibAllocationsList(races, isAdminUser) {
  currentBibAllocRows = races
    .filter(r => r.bibAllocations)
    .map((r, idx) => ({ idx, owner: r.owner, raceLabel: r.raceLabel, raceDate: r.raceDate, ba: r.bibAllocations }));
  renderTable('bib-allocations-tbody', tableColumns(TABLES['bib-allocations'], {
    owner:       isAdminUser ? r => escHtml(r.owner) : undefined,
    raceLabel:   r => escHtml(r.raceLabel),
    raceDate:    r => formatRaceDate(r.raceDate),
    bibCount:    r => String(r.ba.entries.length),
    generatedAt: r => escHtml(r.ba.generatedAt || ''),
    actions:     () => `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="send">Send to Phone</button>`,
  }), currentBibAllocRows, {
    rowAttrs: r => ({ 'data-idx': r.idx, class: bibAllocKey(r) === lastSentKey ? 'row-editing' : '' }),
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

// ---- Compute Results (formerly "Add to Finishers") ----
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

// "yyyy/MM/dd HH:mm:ss" (the phone's own local time) → epoch millis, for the timestamp
// arithmetic checkpoint times need (see computeCpTimes below). Returns null on anything
// unparseable rather than NaN, so callers can cleanly skip a bad/missing timestamp.
function parseTimestamp(ts) {
  const t = new Date(ts || '');
  return Number.isFinite(t.getTime()) ? t.getTime() : null;
}

// "The time mode start line" — the one Start row in a Time-mode device's file, whose own
// timestamp is wall-clock zero for every elapsed time computed against it (both FinishTime's
// existing splitNumber pairing and the new CP timestamp arithmetic use this same instant).
function findStartTimestamp(finishTimeRows) {
  const start = finishTimeRows.find(r => r.action === 'Start');
  return start ? parseTimestamp(start.timestamp) : null;
}

// Checkpoint times are approximate by nature (a CP-mode phone has no stopwatch of its own,
// only an absolute timestamp per bib) — unlike FinishTime's authoritative splitNumber pairing,
// this is genuinely just (crossing timestamp − start timestamp). A bib appearing twice in one
// CP file (e.g. an operator's accidental double-tap) keeps its earliest crossing, sorted by
// lineNumber — the file's own unambiguous record order.
function computeCpTimes(bibsRows, startMs) {
  const byBib = new Map();
  for (const r of [...bibsRows].sort(byLineNumber)) {
    const bib = +r.bibNumber;
    if (!Number.isFinite(bib) || bib <= 0 || byBib.has(bib) || startMs == null) continue;
    const ts = parseTimestamp(r.timestamp);
    if (ts == null) continue;
    const elapsed = Math.round((ts - startMs) / 1000);
    if (elapsed < 0) continue; // bad data/clock skew — leave blank rather than show nonsense
    byBib.set(bib, secondsToTime(elapsed));
  }
  return byBib; // bib -> 'HH:MM:SS'
}

function getSelectedRows() {
  return [...document.querySelectorAll('#mobile-files-tbody input.mobile-file-select:checked')]
    .map(cb => currentRows[+cb.dataset.idx])
    .filter(Boolean);
}

// Derives what state.mobileProgress *should* contain for one file's current segment — bib-driven
// (a split with no matching bib is just excess, never looked up; a bib with no matching split is
// still included, just untimed), pairing each bib with the Time entry at the same split number if
// one exists. Retirees never carry a split time (finishers.js's own NO_SPLIT_ACTIONS convention);
// Clock's own "time" is its offset/time-of-day value from its note field, not a paired split.
// This relies on racemaster-mobile not allocating a splitNumber to DNF rows at all (so they
// never consume a slot the Time-mode side didn't also produce) — without that, a retiree
// partway through a race would permanently offset every later bib's splitNumber against its
// true corresponding Time split.
//
// The result is sorted by lineNumber, not splitNumber — applyComputedResults() assigns it to
// state.mobileProgress in this same order, and adjustedFinishTime()'s own mobile fallback (see
// time-utils.js) relies on that order to find the *last* matching Clock/Start/etc record, so
// getting this order right matters beyond just display. splitNumber is null for Clock/DNF rows,
// which would otherwise all collapse to the front ahead of every real split. lineNumber order
// matters in its own right too: several Clock lines in one file is legitimate (a later one marks
// a clock reset — not yet implemented mobile-side, but must already land in the right relative
// order for when it is), and only lineNumber order preserves which came first.
//
// This is the single source of truth both the red/green status check and the actual rebuild
// below are computed from, so they can never disagree with each other.
function expectedFinisherEntries(bibs, times) {
  const timeBySplit = new Map(times.map(t => [t.splitNumber, t]));
  return [...bibs].sort(byLineNumber).map(b => {
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
// left uncoloured, since it's not what a click of Compute Results would even touch right now.
function computeIncorporationStatus(r) {
  if (!selectedKeys.has(rowKey(r))) return 'none';
  return maxLineNumber(r.device.lines) > getLastSyncedLineNumber(r) ? 'outstanding' : 'incorporated';
}

// Duplicate split numbers within one bucket mean two independent recording streams got
// selected together (e.g. two separate bibs-recording phones) — their split numbers aren't
// comparable, so nothing here can be safely paired or transferred. Rows with no real
// splitNumber (DNF/Clock — see NO_SPLIT_ACTIONS in finishers.js) all carry the same null
// sentinel and must be skipped here, or two-or-more of them (e.g. multiple retirees in one
// pull) would falsely collide and abort the whole rebuild.
function findDuplicateSplitNumbers(rows) {
  const seen = new Set(), dupes = new Set();
  for (const r of rows) {
    if (r.splitNumber == null) continue;
    if (seen.has(r.splitNumber)) dupes.add(r.splitNumber);
    seen.add(r.splitNumber);
  }
  return [...dupes].sort((a, b) => a - b);
}

// Wipes both data sources an Update Progress run produces — state.mobileProgress (Start/Finish/
// DNF/etc, genuinely separate from the manually-entered Finishers list, see js/mobile-progress.js)
// and state.mobileCheckpoints — as one explicit step. Used both by the standalone Clear Progress
// button below and by applyComputedResults(), which always clears before rebuilding rather than
// leaving the old arrays in place until the very end and relying on the final assignment to
// replace them; this way there's no ambiguity about the old set being gone before anything new
// is written. Everything downstream — the Progress tab itself, Safety Check's finished/
// outstanding counts and "Last CP" hint, the Results & Prize List page — reads live from
// state.mobileProgress/state.mobileCheckpoints, so clearing these two arrays is itself what
// "undoes the effects" of a previous run everywhere else in the app; no other state needs
// touching, and the manually-entered Finishers list is never affected either way.
async function clearProgressData() {
  state.mobileProgress = [];
  state.mobileCheckpoints = [];
  await saveMobileProgress();
  await saveMobileCheckpoints();
}

async function clearProgress() {
  if (!state.mobileProgress.length && !state.mobileCheckpoints.length) {
    showStatus('No computed progress to clear.');
    return;
  }
  const existingCount = state.mobileProgress.length;
  if (!await showConfirmDialog(
    `This deletes all ${existingCount} progress record(s) and all checkpoint data. Continue?`,
    'Clear Progress', true
  )) return;
  await clearProgressData();
  renderMobileProgressTable();
  showStatus('Progress cleared.');
}

// Combines the selected files' current-segment Bibs/Time entries (each device's own segment
// resolved independently first, exactly like showDeviceModal, since Reset boundaries and line
// numbers are per-device) and validates them — no dialogs, no state mutation, so this same
// logic can be shared between the button handler (updateProgress, below) and the silent
// auto-update path (autoUpdateProgress, further below). Returns either { error } or the
// computed { finishRows, cpBuckets, expected, cpTimesByCp }.
//
// Selected files are bucketed by their own resolved location (see resolveLocationKey) rather
// than requiring every selected file to be "Finish" — Finish drives the (unchanged, accurate)
// FinishTime computation below; any additional checkpoint-location files each contribute an
// approximate CP time, computed independently via timestamp arithmetic against the Finish
// bucket's own Time-mode Start row (see computeCpTimes). FinishTime is authoritative (the same
// splitNumber pairing this used to do as "Add to Finishers"); CP times are not — a CP-mode
// phone has no stopwatch of its own, only an absolute per-bib timestamp, so they're
// necessarily an approximation, primarily useful for safety awareness (roughly where on the
// course an outstanding runner was last seen) rather than as a results input.
async function validateAndCompute(selected) {
  const raceLabels = [...new Set(selected.map(r => r.raceLabel))];
  if (raceLabels.length > 1) {
    return { error: `Cannot compute results — selected files are from different races: ${raceLabels.join(', ')}.` };
  }

  const finishRows = [];
  const cpBuckets = new Map(); // cp number -> row
  for (const r of selected) {
    const { timeSegment, bibsSegment } = buildSegmentView(r.device.lines);
    const visibleRows = [...timeSegment, ...bibsSegment];
    if (!visibleRows.length) {
      return { error: `Cannot compute results — "${r.device.name}" is empty (no entries in its current segment).` };
    }
    const raw = rawLocationOf(visibleRows);
    if (raw == null) {
      return { error: `Cannot compute results — "${r.device.name}" has inconsistent locations within its own file.` };
    }
    const key = resolveLocationKey(raw);
    if (!key) {
      return { error: `Cannot compute results — location "${raw}" isn't recognised as Finish or a checkpoint.` };
    }
    if (key.kind === 'finish') {
      finishRows.push(r);
    } else if (cpBuckets.has(key.number)) {
      return { error: `Cannot compute results — more than one file selected for CP${key.number}.` };
    } else {
      cpBuckets.set(key.number, r);
    }
  }

  if (!finishRows.length) return { error: 'Select at least the Finish location file(s) too.' };

  const bibs = [], times = [];
  for (const r of finishRows) {
    const { timeSegment, bibsSegment } = buildSegmentView(r.device.lines);
    bibs.push(...bibsSegment.filter(b => TRANSFERABLE_BIBS_ACTIONS.has(b.action)));
    times.push(...timeSegment.filter(t => TRANSFERABLE_TIME_ACTIONS.has(t.action)));
  }

  if (!bibs.length && !times.length) return { error: 'Selected Finish file(s) have no transferable entries.' };

  const dupBibSplits = findDuplicateSplitNumbers(bibs);
  if (dupBibSplits.length) {
    return { error: `Cannot compute results — more than one bibs-recording phone selected at Finish (duplicate split number(s) ${dupBibSplits.join(', ')}).` };
  }
  const dupTimeSplits = findDuplicateSplitNumbers(times);
  if (dupTimeSplits.length) {
    return { error: `Cannot compute results — more than one time-recording phone selected at Finish (duplicate split number(s) ${dupTimeSplits.join(', ')}).` };
  }

  const invalidBibs = [...new Set(
    bibs.filter(b => BIB_REQUIRED_FINISHER_ACTIONS.has(b.action))
      .map(b => +b.bibNumber)
      .filter(n => !Number.isFinite(n) || n <= 0 || !getEntry(n))
  )];
  if (invalidBibs.length) {
    return { error: `Cannot compute results — bib number(s) not in entries: ${invalidBibs.join(', ')}.` };
  }

  // Checkpoint buckets need the Finish bucket's own Time-mode Start row as the universal t=0
  // reference — without it, no elapsed time (CP or otherwise) can be computed at all.
  const cpTimesByCp = new Map(); // cp number -> Map<bib, 'HH:MM:SS'>
  if (cpBuckets.size) {
    const startMs = findStartTimestamp(times);
    if (startMs == null) {
      return { error: 'Cannot compute checkpoint times — no Start record found in the Finish location\'s time file; select it too.' };
    }
    const invalidCpBibs = [];
    for (const [cpNumber, r] of cpBuckets) {
      const { bibsSegment } = buildSegmentView(r.device.lines);
      const cpRows = bibsSegment.filter(b => BIB_REQUIRED_FINISHER_ACTIONS.has(b.action));
      const bad = [...new Set(cpRows.map(b => +b.bibNumber).filter(n => !Number.isFinite(n) || n <= 0 || !getEntry(n)))];
      if (bad.length) { invalidCpBibs.push(`CP${cpNumber}: ${bad.join(', ')}`); continue; }
      cpTimesByCp.set(cpNumber, computeCpTimes(cpRows, startMs));
    }
    if (invalidCpBibs.length) {
      return { error: `Cannot compute results — bib number(s) not in entries: ${invalidCpBibs.join('; ')}.` };
    }
  }

  const expected = expectedFinisherEntries(bibs, times);
  return { finishRows, cpBuckets, expected, cpTimesByCp };
}

// The actual mutation, shared by both the button handler and the silent auto-update path —
// wipes state.mobileProgress and rebuilds it wholesale from `expected` (line-by-line diffing
// against whatever Progress already held turned out to be a losing battle with every new edge
// case the phone's own history could produce — see validateAndCompute()'s own doc for why a
// full rebuild sidesteps that; every bib in `expected` was already validated against entries by
// validateAndCompute(), so no further per-entry validation is needed here), then rebuilds
// state.mobileCheckpoints wholesale too, stored raw (crossing timestamp minus start timestamp,
// no offset correction) — early/late-start and clock-offset adjustment is the domain of
// adjustedFinishTime() in results.js/formatResults(), not this page; this page's job is only to
// provide the raw information that needs. Never touches the manually-entered Finishers list.
// Returns { added } for the caller's own status message.
async function applyComputedResults(expected, cpTimesByCp, selected) {
  await clearProgressData();

  state.mobileProgress = expected.map(({ action, number, time }) => ({ action, number, time }));
  await saveMobileProgress();

  const bibsSeen = new Set();
  for (const cpMap of cpTimesByCp.values()) for (const bib of cpMap.keys()) bibsSeen.add(bib);
  state.mobileCheckpoints = [...bibsSeen].map(bib => {
    const cpTimes = {};
    for (const [cpNumber, cpMap] of cpTimesByCp) if (cpMap.has(bib)) cpTimes[cpNumber] = cpMap.get(bib);
    return { bibNumber: bib, cpTimes };
  });
  await saveMobileCheckpoints();

  // Mark every selected file as "seen as of now" — this run covered whatever these files held at
  // this moment. See the tracking block near rowKey for why a lineNumber is enough.
  for (const r of selected) setLastSyncedLineNumber(r);

  return { added: expected.length };
}

async function updateProgress() {
  // Refresh first so validation runs against the latest data — renderMobileFiles() already
  // shows its own status message if the fetch fails, falling back to whatever's currently
  // loaded (server unreachable is the expected case out in the field) rather than blocking.
  await renderMobileFiles();

  const selected = getSelectedRows();
  if (!selected.length) { showStatus('Select one or more mobile files first.', true); return; }

  const result = await validateAndCompute(selected);
  if (result.error) { showStatus(result.error, true); return; }
  const { finishRows, cpBuckets, expected, cpTimesByCp } = result;

  const existingCount = state.mobileProgress.length;
  const cpSummary = cpBuckets.size ? ` and checkpoint times from ${cpBuckets.size} CP file(s)` : '';
  const confirmMsg = existingCount
    ? `This replaces ${existingCount} existing progress record(s) with ${expected.length} from ${finishRows.length} Finish file(s)${cpSummary}. Continue?`
    : `Add ${expected.length} progress record(s) from ${finishRows.length} Finish file(s)${cpSummary}?`;
  if (!await showConfirmDialog(confirmMsg, 'Update Progress')) return;

  const { added } = await applyComputedResults(expected, cpTimesByCp, selected);

  // Re-render so each transferred file's row immediately reflects its new incorporation status
  // (red/green) rather than waiting for the next Refresh/pull — see the ordering note above
  // deleteRow() for why this comes before the specific outcome message, not after.
  await renderMobileFiles();
  renderMobileProgressTable();
  document.querySelector('#mobile-files-tab-bar [data-mf-tab="progress"]')?.click();
  showStatus(
    `Progress updated: ${added} record${added === 1 ? '' : 's'}`
      + `${cpBuckets.size ? `, checkpoint times computed for ${state.mobileCheckpoints.length} bib(s)` : ''}.`
  );
}

// Silent counterpart to updateProgress(), called from the Results & Prize List page's own
// renderResults() (see js/views/results.js) whenever it's opened — no confirm dialog, no
// forced tab-switch, and any validation failure is logged rather than shown as an error, since
// this is a background convenience refresh, not a user action. Only ever runs the rebuild
// (applyComputedResults) when there's proof something genuinely changed since the last real run
// (computeIncorporationStatus() === 'outstanding', the same "new lines since last sync"
// mechanism the Devices tab's own red/green marker already uses) — an unconditional silent
// rebuild on every page visit would otherwise turn every Results page visit into a background
// stall for no reason. Since this only ever touches state.mobileProgress/state.mobileCheckpoints
// (never the manually-entered Finishers list), there's nothing here it could silently discard.
export async function autoUpdateProgress() {
  const persisted = loadSelectedKeys();
  if (!persisted || !persisted.keys.length) return;
  // Event name+date is a heuristic, not a guaranteed-unique dataset identity (two different
  // datasets could coincidentally share both) — good enough to guard against the realistic
  // case (switching datasets in place, via Datasets' Connect, without a page reload) without
  // needing a true cross-dataset identifier, which nothing in this codebase currently tracks.
  if (persisted.eventName !== state.event.name || persisted.eventDate !== state.event.date) return;

  selectedKeys.clear();
  for (const k of persisted.keys) selectedKeys.add(k);

  await renderMobileFiles(); // rebuilds currentRows + reflects selectedKeys in the checkboxes
  const selected = getSelectedRows();
  if (!selected.length) return; // persisted files no longer exist
  if (!selected.some(r => computeIncorporationStatus(r) === 'outstanding')) return; // nothing new since the last run

  const result = await validateAndCompute(selected);
  if (result.error) { console.warn('[mobile-files] Progress auto-update skipped:', result.error); return; }

  await applyComputedResults(result.expected, result.cpTimesByCp, selected);
  renderMobileProgressTable();
}

// ---- Progress tab (raw BibNumber/Name/Category/Course/Start/FinishTime/CP*n* view) ----
//
// Deliberately pre-adjustment and position-agnostic — this tab's job is to provide the raw
// information Results & Prize List's own adjustedFinishTime()-based pipeline needs (see
// js/results.js's formatResults()/getSplitsRows()), plus safety feedback on where runners are
// on the course, not to mirror final results. That's why this reads state.mobileProgress/
// state.mobileCheckpoints directly rather than safety.js's getFinishedRows()/getDnfRows() (both
// of which call formatResults() and return already-adjusted times + computed race positions) —
// sorted by bib number, since this tab has no position to sort by at all.

function buildProgressColumns(cpNumbers) {
  const base = TABLES['mobile-progress'];
  const idx = base.findIndex(c => c.id === 'cp');
  const proforma = base[idx];
  const cpCols = cpNumbers.map(n => ({ id: `cp_${n}`, label: `CP${n}`, title: `${proforma.title} ${n}` }));
  return [...base.slice(0, idx), ...cpCols, ...base.slice(idx + 1)];
}

// Rows = every bib with a Start/Finish/DNF record in state.mobileProgress (mobile-recorded only
// — the manually-entered Finishers list is never read here, see js/mobile-progress.js) UNION
// every bib with at least one checkpoint sighting, even if never finished — that union is
// deliberate: a bib seen only at a CP, with no finish, is exactly the safety-relevant case
// (still out on the course, last seen at CP*n*). FinishTime here is the raw, unadjusted
// stopwatch/paired-split value — the adjusted race time lives on the Results & Prize List page,
// not here.
function buildProgressRows() {
  const rowsByBib = new Map();
  const ensure = bib => {
    if (!rowsByBib.has(bib)) {
      const info = entryInfo(bib);
      rowsByBib.set(bib, { bibNumber: bib, name: info.name, category: info.category, course: info.course, startTime: '', finishTime: '', cpTimes: {} });
    }
    return rowsByBib.get(bib);
  };
  for (const f of state.mobileProgress) {
    const bib = +f.number;
    if (bib <= 0) continue;
    if (f.action === 'Start')       ensure(bib).startTime  = f.time || '';
    else if (f.action === 'Finish') ensure(bib).finishTime = f.time || '';
    else if (f.action === 'DNF')    ensure(bib).finishTime = 'DNF';
  }
  for (const r of state.mobileCheckpoints) {
    ensure(+r.bibNumber).cpTimes = getMobileCheckpointTimes(r);
  }
  return [...rowsByBib.values()].sort((a, b) => a.bibNumber - b.bibNumber);
}

function renderMobileProgressTable() {
  const cpNumbers = getMobileCheckpointNumbers();
  const rows = buildProgressRows();
  const renderers = {
    bibNumber:  r => String(r.bibNumber),
    name:       r => escHtml(r.name),
    category:   r => escHtml(r.category),
    course:     r => escHtml(r.course),
    start:      r => escHtml(r.startTime || ''),
    finishTime: r => escHtml(r.finishTime || ''),
  };
  for (const n of cpNumbers) renderers[`cp_${n}`] = r => escHtml(r.cpTimes?.[n] || '');
  renderTable('mobile-progress-tbody', tableColumns(buildProgressColumns(cpNumbers), renderers), rows);
}

// HH:MM:SS.mmm — see mule-ble.js's own identical ts() for why (duplicated rather than shared,
// matching this codebase's established convention for small helpers like this one).
function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// Gated the same way mule-ble.js's own bleLog is — routine tracing only, off by default.
function debugLog(...args) { if (isBleLoggingEnabled()) console.log(`[${ts()}]`, ...args); }

// HH:MM:SS only — the poll-status line below is meant for a glance at "when did this last
// change", not the millisecond precision ts() (above) exists for in debug logging.
function nowClock() {
  return new Date().toTimeString().slice(0, 8);
}

// The most recent real poll outcome ("Last poll …" / "Poll failed …") — kept separately from
// the DOM so markPollingInProgress() below can append to it rather than replacing it outright.
// Reset (with the element itself) on disconnect — see updateConnectButtonLabel().
let lastPollStatusText = '';

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

// Appends a "— polling…" suffix to whatever the status line already shows, instead of replacing
// it outright — a plain updatePollStatus('Polling…') here used to blank the previous tick's own
// result the instant the next one started, so the record/relay counts it just reported were only
// ever visible for a fraction of a second before vanishing again. Suffixing keeps that last real
// result legible for the whole gap between ticks, with only "— polling…" changing at the end to
// show a fresh one is actually in flight.
function markPollingInProgress() {
  updatePollStatus(lastPollStatusText ? `${lastPollStatusText} — polling…` : `Polling ${getConnectedDeviceName()}…`);
}

function updateConnectButtonLabel() {
  const btn = getEl('btn-connect-phone');
  if (!btn) return;
  btn.textContent = isConnected()
    ? (connectionIssue ? `⚠ ${getConnectedDeviceName()} not responding — Disconnect?` : `Disconnect from ${getConnectedDeviceName()}`)
    : connectAttemptInProgress ? 'Connecting…'
    : 'Connect to Phone…';
  btn.disabled = connectAttemptInProgress;
  // Echoes getRecommendedPollIntervalMs() so it's visible whether auto-sync is even running and
  // at what cadence, rather than something only inferable from timestamps in the console.
  const pollEl = getEl('mobile-files-poll-interval');
  if (pollEl) {
    if (isConnected()) {
      pollEl.textContent = `Auto-polling every ${Math.round(getRecommendedPollIntervalMs() / 1000)}s`;
      pollEl.hidden = false;
    } else {
      pollEl.hidden = true;
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
  el.append(` ⚠ Lost Bluetooth connection to "${name || 'phone'}" `); // text node — safe even though name is phone-reported, untrusted text
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
// files) — no server fetch, unlike renderMobileFiles() itself. Used by a silent auto-pull tick
// that found nothing new to sync (see pullAndSyncConnectedPhone below): the table still needs
// refreshing so its Last Seen column picks up recordBleLastSeen()'s update for this poll (BLE
// last-seen tracking above), but a full renderMobileFiles() call every ~10s purely for that would
// mean an extra server round trip, and its own "Loading…" status flicker, on every single tick.
function refreshDevicesTableFromCache() {
  const pending = getPendingMobileFiles().filter(f => f.owner === getUsername());
  renderRaceList(mergePendingIntoRaces(lastKnownRaces, pending), getIsAdmin());
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
async function pullAndSyncConnectedPhone({ silent = false } = {}) {
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
  markPollingInProgress();
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
    // BLE_LAST_SEEN_KEY's own doc above for why device.lastSeen alone (server mtime / a pending
    // file's own pulledAt, neither of which changes when there's nothing new to write) isn't
    // enough on its own to reflect "we just successfully talked to this phone".
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
    renderMobileFiles();
  }
}

export function wireMobileFiles() {
  on('btn-refresh-mobile-files', 'click', onRefreshButtonClick);
  on('btn-connect-phone', 'click', onConnectButtonClick);
  on('btn-update-progress', 'click', updateProgress);
  on('btn-clear-progress', 'click', clearProgress);
  onDisconnect(onBleDisconnected);
  wireTabBar('mobile-files-tab-bar', 'mobile-files-tab-', 'data-mf-tab');
  document.getElementById('bib-allocations-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const r = currentBibAllocRows[+btn.closest('[data-idx]')?.dataset.idx];
    if (!r) return;
    if (btn.dataset.action === 'view') showBibAllocationsModal(r.owner, r.raceLabel, r.ba);
    else if (btn.dataset.action === 'send') {
      lastSentKey = bibAllocKey(r);
      showStatus(`Send to phone: "bib-allocations.json" (${r.raceLabel}) — not yet implemented.`);
      // Immediate feedback rather than waiting for the next full re-render — same pattern the
      // Devices tab's own selection checkbox uses (see the 'change' listener below).
      document.querySelectorAll('#bib-allocations-tbody tr.row-editing').forEach(tr => tr.classList.remove('row-editing'));
      btn.closest('tr')?.classList.add('row-editing');
    }
  });
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

// Genuinely awaitable (not fire-and-forget) so a caller — e.g. updateProgress()
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
    if (count) count.textContent = `${merged.length} race${merged.length === 1 ? '' : 's'}`;
    renderRaceList(merged, isAdminUser);
    renderBibAllocationsList(merged, isAdminUser);
    renderMobileProgressTable();
    showStatus(merged.length ? '' : 'No mobile files uploaded yet.');
    return true;
  } catch {
    // Server unreachable — keep showing whatever was last successfully loaded rather than
    // wiping the list down to only locally-pulled pending files.
    const merged = mergePendingIntoRaces(lastKnownRaces, pending);
    if (count) count.textContent = `${merged.length} race${merged.length === 1 ? '' : 's'}`;
    renderRaceList(merged, isAdminUser);
    renderBibAllocationsList(merged, isAdminUser);
    renderMobileProgressTable();
    showStatus(merged.length
      ? 'Server unreachable — showing the last known list plus anything pulled locally.'
      : 'Server unreachable, and no locally-pulled files yet.', !merged.length);
    return false;
  }
}