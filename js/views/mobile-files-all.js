'use strict';

// All Files tab — small, self-contained, pure rendering (never calls back into mobile-files.js's
// renderMobileFiles(), so this stays a safe leaf module with no circular-import risk). Unlike the
// Devices tab, this one deliberately does NOT go through filterStaleRaces()/mergePendingIntoRaces()
// — it's the one place every server-stored file (device or progress) is browsable and deletable
// regardless of age, with a stale one highlighted rather than hidden (see isDeviceStale()/
// isProgressStale() in mobile-files-shared.js for why that's per-file, not per-race, and
// deliberately allowed to disagree with the Devices tab's own staleness filtering).
// Rows are sorted newest-first by their own last-activity date (see flattenAllFiles()'s own doc
// in mobile-files-devices.js) — that order is what a stale row's own "Delete from here" button
// (js/views/mobile-files.js's deleteFromHere()) means by "below it".

import { getIsAdmin } from '../storage.js';
import { renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import {
  formatRaceDate, formatDateTime, formatStoredTimestamp, raceNameOf, isDeviceStale, isProgressStale,
} from '../mobile-files-shared.js';
import { formatCount, flattenAllFiles } from '../mobile-files-devices.js';

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
      + `<td>${escHtml(e.category || '')}</td><td>${escHtml(e.startTime || '')}</td><td>${escHtml(e.finishTime || '')}</td>${cpCells}</tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:640px">
      <h2>Progress — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
      <p style="margin:0 0 12px;font-size:0.875rem">Generated ${formatDateTime(progress.generatedAt, { seconds: true })}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Bib</th><th>Name</th><th>Course</th><th>Cat</th><th>Start</th><th>Finish</th>${cpHeadCells}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${6 + cpNumbers.length}" style="color:var(--muted)">No entries.</td></tr>`}</tbody>
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

export function renderAllFilesList(races, isAdminUser) {
  currentAllFilesRows = flattenAllFiles(races).map(r => ({
    ...r,
    stale: r.kind === 'progress' ? isProgressStale(r.raceLabel, r.progress) : isDeviceStale(r.raceLabel, r.device),
  }));
  renderTable('mobile-files-all-tbody', tableColumns(TABLES['mobile-files-all'], {
    owner:      isAdminUser ? r => escHtml(r.owner) : undefined,
    // Date suffix dropped from the visible text, same as the Devices tab — redundant with the
    // Race Date column right next to it; full raceLabel stays in the tooltip.
    raceLabel:  r => `<span title="${escHtml(r.raceLabel)}">${escHtml(raceNameOf(r.raceLabel))}</span>`,
    raceDate:   r => formatRaceDate(r.raceDate),
    device:     r => r.kind === 'progress' ? 'Progress' : escHtml(r.device.name),
    location:   r => r.kind === 'progress' ? '' : `<span title="${escHtml(r.location)}">${escHtml(r.location)}</span>`,
    bibs:       r => formatCount(r.bibsVisible),
    time:       r => r.kind === 'progress' ? '' : formatCount(r.timeVisible),
    lastSeen:   r => r.kind === 'progress' ? '' : formatDateTime(r.lastSeen),
    lastUpdate: r => r.kind === 'progress' ? formatDateTime(r.lastUpdate, { seconds: true }) : formatStoredTimestamp(r.lastUpdate),
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
