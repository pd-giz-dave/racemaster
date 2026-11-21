'use strict';

import { state } from '../state.js';
import { getIsAdmin } from '../storage.js';
import { renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import {
  formatRaceDate, formatDateTime, formatStoredTimestamp, raceNameOf, isDeviceStale, isProgressStale,
} from '../mobile-files-shared.js';
import { formatCount, flattenAllFiles } from '../mobile-files-devices.js';

// Renders the Mobile Files "All Files" tab — a flat list of every server-stored device/progress
// file. Deliberately skips the Devices tab's filterStaleRaces()/mergePendingIntoRaces() logic:
// every file here stays browsable/deletable regardless of age, with stale ones highlighted (see
// isDeviceStale()/isProgressStale() in mobile-files-shared.js) rather than hidden. A safe leaf
// module — never calls back into mobile-files.js's renderMobileFiles().

// Mirrors the Progress tab's own fobNumber cell (js/views/mobile-files-progress.js) — same
// "N — returned"/"N — not returned" suffix and color:var(--danger) highlight for a beacon still
// outstanding — but reads straight off this *file's* own beaconNumber (a point-in-time snapshot,
// unlike the Progress tab's live entry.dibberNumber) against the current state.beaconReports for
// this file's own raceLabel, which is passed in rather than re-derived per entry since every
// entry in one progress.json file shares the one race.
function fobCellHtml(beaconNumber, raceLabel) {
  if (!beaconNumber) return '';
  const report = raceLabel ? state.beaconReports.find(r => r.raceLabel === raceLabel) : null;
  const status = report?.missing.includes(beaconNumber) ? 'missing'
               : report?.returned.includes(beaconNumber) ? 'returned' : '';
  const suffix = status === 'missing' ? ' — not returned' : status === 'returned' ? ' — returned' : '';
  const text = escHtml(`${beaconNumber}${suffix}`);
  return status === 'missing' ? `<span style="color:var(--danger)">${text}</span>` : text;
}

// Live-bound (reassigned here, not just mutated) — mobile-files.js's own click-delegation listener
// reads this directly by index, same convention as mobile-files-devices.js's own currentRows. Each
// row also carries its own precomputed `stale` boolean (see below) — mobile-files.js's own
// deleteFromHere() reads it directly rather than recomputing per row.
export let currentAllFilesRows = [];

// progress.json's own contents (see js/progress-sync.js) — the web app's own race-wide bib/name/
// course/category/start/finish/CP export, not anything pulled from a phone. CP columns are built
// from whichever cp numbers actually appear across this file's own entries (a static snapshot of
// what was pushed, not live state), mirroring buildProgressColumns()'s own dynamic-column idea in
// js/mobile-files-progress.js without importing it (that one reads live getMobileCheckpointNumbers(),
// which has nothing to do with a specific pushed file's own content).
export function showProgressFileModal(owner, raceLabel, progress) {
  const cpNumbers = [...new Set(progress.entries.flatMap(e => Object.keys(e.cpTimes || {}).map(Number)))].sort((a, b) => a - b);
  const sorted = [...progress.entries].sort((a, b) => a.bibNumber - b.bibNumber);
  const cpHeadCells = cpNumbers.map(n => `<th>CP${n}</th>`).join('');
  const rows = sorted.map(e => {
    const cpCells = cpNumbers.map(n => `<td>${escHtml(e.cpTimes?.[n] || '')}</td>`).join('');
    return `<tr><td>${e.bibNumber}</td><td>${escHtml(e.name)}</td><td>${escHtml(e.course)}</td>`
      + `<td>${escHtml(e.category || '')}</td><td>${fobCellHtml(+e.beaconNumber || 0, raceLabel)}</td>`
      + `<td>${escHtml(e.startTime || '')}</td><td>${escHtml(e.finishTime || '')}</td>${cpCells}</tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:640px">
      <div class="modal-header">
        <h2>Progress — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
        <button class="modal-close-x" id="mobile-file-modal-close" aria-label="Close" title="Close">&times;</button>
      </div>
      <p style="margin:0 0 12px;font-size:0.875rem">Generated ${formatDateTime(progress.generatedAt, { seconds: true })}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Bib</th><th>Name</th><th>Course</th><th>Cat</th><th>Fob</th><th>Start</th><th>Finish</th>${cpHeadCells}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${7 + cpNumbers.length}" style="color:var(--muted)">No entries.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#mobile-file-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

export function renderAllFilesList(races, isAdminUser) {
  currentAllFilesRows = flattenAllFiles(races).map(r => ({
    ...r,
    stale: r.kind === 'progress' ? isProgressStale(r.raceLabel, r.progress) : isDeviceStale(r.raceLabel, r.device),
  }));
  // Reuses TABLES['mobile-files'] (the Devices tab's own column set) rather than a separate,
  // near-duplicate entry — every column here means the same thing it does there, so there's
  // nothing this tab needs worded differently. `select` renders but is otherwise inert for now
  // (no selection state, no handler) — harmless to show, and there for a future bulk-delete
  // feature to pick up rather than adding its own column later. `startedAt` is blank for a
  // progress row (formatStoredTimestamp(undefined) already renders that as a plain dash) since a
  // progress.json export has no "device went active" moment of its own.
  renderTable('mobile-files-all-tbody', tableColumns(TABLES['mobile-files'], {
    select:     r => `<input type="checkbox" class="mobile-file-all-select" data-idx="${r.idx}" aria-label="Select ${escHtml(r.kind === 'progress' ? 'Progress' : r.device.name)}">`,
    owner:      isAdminUser ? r => escHtml(r.owner) : undefined,
    // Date suffix dropped from the visible text, same as the Devices tab — redundant with the
    // Race Date column right next to it; full raceLabel stays in the tooltip.
    raceLabel:  r => `<span title="${escHtml(r.raceLabel)}">${escHtml(raceNameOf(r.raceLabel))}</span>`,
    raceDate:   r => formatRaceDate(r.raceDate),
    device:     r => r.kind === 'progress' ? 'Progress' : escHtml(r.device.name),
    // ToDo.MD-reported bug: this used to render r.location (locationSummary() — collapsed down to
    // just the device's current location), not every location it's actually recorded at within
    // its current segment, unlike the Devices tab's own column (js/views/mobile-files-devices.js)
    // which has always used r.locations (distinctLocationsOf()) for exactly that reason. Matching
    // it here too, 'Unknown' fallback included.
    location:   r => r.kind === 'progress' ? '' : `<span title="${escHtml(r.locations.join(', '))}">${escHtml(r.locations.join(', ') || 'Unknown')}</span>`,
    bibs:       r => r.kind === 'progress' ? formatCount(r.bibsVisible) : formatCount(r.bibsVisible, r.bibsExpected),
    time:       r => r.kind === 'progress' ? '' : formatCount(r.timeVisible, r.timeExpected),
    // Same Offline badge as the Devices tab's own column (js/views/mobile-files-devices.js) —
    // r.offline is already computed by flattenDevices()/isDeviceOffline() for every device row
    // here too (flattenAllFiles() just wraps flattenDevices()'s own rows), this column simply
    // wasn't rendering it. Bug report: hearty-ridge's "last seen" read many hours stale here with
    // no Offline tag, while the Devices tab correctly flagged the same device.
    lastSeen:   r => r.kind === 'progress' ? '' : formatDateTime(r.lastSeen) + (r.offline ? ' <span style="color:var(--danger)">Offline</span>' : ''),
    lastUpdate: r => r.kind === 'progress' ? formatDateTime(r.lastUpdate) : formatStoredTimestamp(r.lastUpdate),
    startedAt:  r => formatStoredTimestamp(r.startedAt),
    // "Delete from here" only offered on an already-stale row — see this file's own top doc for
    // what "below it" means, and mobile-files.js's deleteFromHere() for the actual bulk delete.
    actions:    r => (r.kind === 'progress' ? `
      <button class="btn-sm" data-action="view">View</button>` : `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="raw">Raw</button>`)
      + `<button class="btn-sm btn-delete" data-action="delete">Delete</button>`
      + (r.stale ? `<button class="btn-sm btn-delete" data-action="delete-from-here">Delete from here</button>` : ''),
  }), currentAllFilesRows, {
    rowAttrs: r => ({ 'data-idx': r.idx, class: r.stale ? 'row-timing-target' : '' }),
  });
}
