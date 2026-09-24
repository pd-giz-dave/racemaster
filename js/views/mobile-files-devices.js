'use strict';

// Devices tab — DOM rendering only. The actual segment-view/list-building logic lives in
// js/mobile-files-devices.js (no DOM at all); this file is the thin layer that turns those rows
// into table columns and the two view/raw modals. Pure rendering: nothing here ever calls back
// into mobile-files.js's renderMobileFiles(), so this stays a leaf mobile-files-progress.js and
// mobile-files-ble.js can safely import from too, without risking a circular import back to the
// main file (see mobile-files.js's own doc on dependency injection for why that matters).

import { getIsAdmin } from '../storage.js';
import { renderTable, tableColumns } from '../ui.js';
import { escHtml, formatElapsedSeconds } from '../utils.js';
import { TABLES } from '../strings.js';
import { rowKey, selectedKeys, formatRaceDate, formatDateTime, formatStoredTimestamp, raceNameOf, byLineNumber } from '../mobile-files-shared.js';
import { buildSegmentView, whenOf, locationSummary, formatCount, flattenDevices, latestModeStart } from '../mobile-files-devices.js';
import { adoptionKey, effectiveAdoptions } from '../mobile-files-adoption.js';

// ToDo.MD's "Random tweaks": the segment view used to pair a Bibs-family row and a Time-family
// row side by side by splitNumber, because a device's current segment could genuinely hold both
// at once. It can't any more — a device's mode (Time vs Bibs/CP) is now declared once, explicitly,
// by its own ModeStart record (see mobile-files-devices.js's own isTimeFamilyRow doc), so only one
// of buildSegmentView()'s two segments is ever really populated for a given view. One flat list,
// one shared "Bib/Split" column (showing whichever of bibNumber/splitTime this particular row
// actually carries), rather than two column groups mostly left blank.
export function showDeviceModal(owner, raceLabel, deviceName, lines) {
  const { timeSegment, bibsSegment } = buildSegmentView(lines);
  const visibleRows = [...timeSegment, ...bibsSegment].sort(byLineNumber);
  // Scoped to the same current segment Location/counts already are (see latestModeStart()'s own
  // doc) — a completely-reset device (every visit properly closed) correctly shows '—' here too,
  // not whatever mode used to apply before the reset (ToDo.MD: "device view shows a blank
  // location but has retained the mode, that should be blank too").
  const mode = latestModeStart(timeSegment, bibsSegment)?.note || '—';

  const rows = visibleRows.map(r => `<tr>
      <td>${r.splitNumber ?? ''}</td>
      <td>${escHtml(r.action)}</td>
      <td>${r.splitTime != null ? formatElapsedSeconds(r.splitTime) : escHtml(r.bibNumber ?? '')}</td>
      <td>${whenOf(r)}</td>
      <td>${escHtml(r.note ?? '')}</td>
    </tr>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:820px">
      <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
      <p style="margin:0 0 12px;font-size:0.875rem">Location: ${locationSummary(visibleRows)} &nbsp; Mode: ${escHtml(mode)}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Split #</th><th>Action</th><th>Bib/Split</th><th>When</th><th>Note</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="color:var(--muted)">No entries in the current segment.</td></tr>'}</tbody>
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
// Always called with a device's own `device.lines` (never `device.resolvedLines` — see
// flattenDevices()'s own doc in mobile-files-devices.js), so there's no client-computed field to
// strip here: whatever keys these lines actually carry are shown, exactly as stored.
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

// "→ <real race>" once the row has been adopted (js/mobile-files-adoption.js), until the phone
// renames and its old row goes away.
function adoptedSuffix(target) {
  return target ? ` <span style="font-size:0.75rem;color:var(--muted)">→ ${escHtml(target)}</span>` : '';
}

function buildColumns(isAdminUser, adoptions = new Map()) {
  return tableColumns(TABLES['mobile-files'], {
    select:    r => `<input type="checkbox" class="mobile-file-select" data-idx="${r.idx}" aria-label="Select ${escHtml(r.device.name)}"${selectedKeys.has(rowKey(r)) ? ' checked' : ''}>`,
    owner:     isAdminUser ? r => escHtml(r.owner) : undefined,
    // Date suffix dropped from the visible text — it's redundant with the Race Date column
    // right next to it — but kept in the title tooltip, the full raceLabel is still the exact
    // identifier this row's own file paths/API calls use under the hood.
    raceLabel: r => `<span title="${escHtml(r.raceLabel)}">${escHtml(raceNameOf(r.raceLabel))}</span>`,
    raceDate:  r => formatRaceDate(r.raceDate),
    device:    r => escHtml(r.device.name) + adoptedSuffix(adoptions.get(adoptionKey(r.owner, r.raceLabel, r.device.name))) + (r.pending
      ? ' <span style="font-size:0.7rem;background:var(--accent);color:#fff;border-radius:4px;padding:0 4px">pending upload</span>'
      : ''),
    // 'Unknown' (not the View modal's own '—') once every visit's been properly closed — a
    // completely reset device (ToDo.MD: "the device list should show unknown in the where
    // column"), distinct from the View modal's own blank-dash convention for the same state.
    location:  r => `<span title="${escHtml(r.locations.join(', '))}">${escHtml(r.locations.join(', ') || 'Unknown')}</span>`,
    bibs:      r => formatCount(r.bibsVisible, r.bibsExpected),
    time:      r => formatCount(r.timeVisible, r.timeExpected),
    lastSeen:   r => formatDateTime(r.lastSeen),
    lastUpdate: r => formatStoredTimestamp(r.lastUpdate),
    startedAt: r => formatStoredTimestamp(r.startedAt),
    actions:   r => r.pending ? `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="raw">Raw</button>
      <button class="btn-sm btn-save" data-action="push">Push</button>
      <button class="btn-sm btn-delete" data-action="discard">Discard</button>` : `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="raw">Raw</button>`,
  });
}

// Live-bound (reassigned here, not just mutated) — mobile-files.js's own wiring reads this
// directly by index for its Devices-tab click/change listeners, and mobile-files-progress.js's
// getSelectedRows() reads it too, both via a plain `import { currentRows } from
// './mobile-files-devices.js'`, which ES modules keep live across the reassignment below.
export let currentRows = [];

export function renderRaceList(races, isAdminUser) {
  currentRows = flattenDevices(races);
  const adoptions = new Map(effectiveAdoptions(races).map(a => [adoptionKey(a.owner, a.fromRaceLabel, a.deviceName), a.raceLabel]));
  renderTable('mobile-files-tbody', buildColumns(isAdminUser, adoptions), currentRows, {
    rowAttrs: r => ({
      'data-idx': r.idx,
      class: r.incorporationStatus === 'outstanding' ? 'row-outstanding'
        : r.incorporationStatus === 'incorporated' ? 'row-incorporated'
        : '',
    }),
  });
}
