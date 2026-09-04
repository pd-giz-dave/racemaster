'use strict';

// Devices tab — DOM rendering only. The actual segment-view/list-building logic lives in
// js/mobile-files-devices.js (no DOM at all); this file is the thin layer that turns those rows
// into table columns and the two view/raw modals. Pure rendering: nothing here ever calls back
// into mobile-files.js's renderMobileFiles(), so this stays a leaf mobile-files-progress.js and
// mobile-files-ble.js can safely import from too, without risking a circular import back to the
// main file (see mobile-files.js's own doc on dependency injection for why that matters).

import { getIsAdmin } from '../storage.js';
import { renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import { rowKey, selectedKeys, formatRaceDate, formatDateTime, formatStoredTimestamp } from '../mobile-files-shared.js';
import { buildSegmentView, whenOf, locationSummary, formatCount, flattenDevices } from '../mobile-files-devices.js';

export function showDeviceModal(owner, raceLabel, deviceName, lines) {
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
export function showRawModal(owner, raceLabel, deviceName, lines) {
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

// Live-bound (reassigned here, not just mutated) — mobile-files.js's own wiring reads this
// directly by index for its Devices-tab click/change listeners, and mobile-files-progress.js's
// getSelectedRows() reads it too, both via a plain `import { currentRows } from
// './mobile-files-devices.js'`, which ES modules keep live across the reassignment below.
export let currentRows = [];

export function renderRaceList(races, isAdminUser) {
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
