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
import { rowKey, selectedKeys, formatRaceDate, formatDateTime, formatStoredTimestamp, raceNameOf, byLineNumber, computeIncorporationStatus } from '../mobile-files-shared.js';
import { buildSegmentView, whenOf, locationSummary, formatCount, displayNote, flattenDevices, latestModeStart, collapsePingRuns } from '../mobile-files-devices.js';

// ToDo.MD's "Random tweaks": the segment view used to pair a Bibs-family row and a Time-family
// row side by side by splitNumber, because a device's current segment could genuinely hold both
// at once. It can't any more — a device's mode (Time vs Bibs/CP/Close/Count) is now declared
// once, explicitly, by its own ModeStart record (see mobile-files-devices.js's own rowFamily
// doc) — one shared "Bib/Split" column (showing whichever of bibNumber/splitTime this particular
// row actually carries), rather than two column groups mostly left blank.
//
// ToDo.MD ("viewing device file is getting muddled wrt close and count entries ... these should
// be options on the view selector not sub-sections within the view"): a device that's switched
// mode without an intervening Reset can genuinely have more than one of buildSegmentView()'s four
// segments open at once (see that function's own doc) — rather than ever merging more than one of
// them into this one modal, js/views/mobile-files.js's own viewDeviceRow() calls
// deviceViewOptions() (mobile-files-devices.js) first and always hands this modal lines already
// narrowed to exactly one (location, mode) combination, so this always renders a single plain
// table, same as before any of this Close/Count-mode work existed.
export function showDeviceModal(owner, raceLabel, deviceName, lines) {
  const { timeSegment, bibsSegment, closeSegment, countSegment } = buildSegmentView(lines);
  const visibleRows = [...timeSegment, ...bibsSegment, ...closeSegment, ...countSegment].sort(byLineNumber);
  // Scoped to the same current segment Location/counts already are (see latestModeStart()'s own
  // doc) — a completely-reset device (every visit properly closed) correctly shows '—' here too,
  // not whatever mode used to apply before the reset (ToDo.MD: "device view shows a blank
  // location but has retained the mode, that should be blank too").
  const mode = latestModeStart(timeSegment, bibsSegment, closeSegment, countSegment)?.note || '—';

  // Line # leads every row (ToDo.MD: "in the per mode views include the line number as a leadin
  // column so they can be manually matched to the raw view for diagnostic purposes") — this
  // segment view folds/reorders/omits rows relative to the raw file (currentSegment()'s own
  // Reset-closing, Undo-folding, Location-boundary splitting — see mobile-files-devices.js's own
  // doc), so a row's lineNumber is the only thing that still ties it back to its own line in the
  // Raw modal once it's shown here. When (ToDo.MD: "show the timestamp on device lines when they
  // are viewed, next to the line# column") sits right beside it for the same reason — matching a
  // row to the Raw modal by line number alone still leaves the two side by side on screen to
  // sanity-check against that row's own raw timestamp column there, rather than having to scan
  // past Split #/Action/Bib first.
  const rows = visibleRows.map(r => `<tr>
      <td>${r.lineNumber ?? ''}</td>
      <td>${whenOf(r)}</td>
      <td>${r.splitNumber ?? ''}</td>
      <td>${escHtml(r.action)}</td>
      <td>${r.splitTime != null ? formatElapsedSeconds(r.splitTime) : escHtml(r.bibNumber ?? '')}</td>
      <td>${escHtml(displayNote(r.action, r.note) ?? '')}</td>
    </tr>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:820px">
      <div class="modal-header">
        <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
        <button class="modal-close-x" id="mobile-file-modal-close" aria-label="Close" title="Close">&times;</button>
      </div>
      <p style="margin:0 0 12px;font-size:0.875rem">Location: ${locationSummary(visibleRows)} &nbsp; Mode: ${escHtml(mode)}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Line #</th><th>When</th><th>Split #</th><th>Action</th><th>Bib/Split</th><th>Note</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="color:var(--muted)">No entries in the current segment.</td></tr>'}</tbody>
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

// Raw listing — every field of every line, unfiltered and unfolded, straight from the file (bar
// the Ping-collapsing — see collapsePingRuns()'s own doc in mobile-files-devices.js). Always
// called with a device's own `device.lines` (never `device.resolvedLines` — see
// flattenDevices()'s own doc in mobile-files-devices.js), so there's no other client-computed
// field here: whatever keys these lines actually carry are shown, exactly as stored.
export function showRawModal(owner, raceLabel, deviceName, lines) {
  const fields = [...new Set(lines.flatMap(r => Object.keys(r)))];
  // Field was renamed server-side from timestampMillis to timestamp (see server.js's coerce()) —
  // a file written before that rename still has the old key, so the collapsed summary row's own
  // synthetic timestamp field must match whichever one these particular lines actually carry.
  const tsField = fields.includes('timestamp') ? 'timestamp' : (fields.includes('timestampMillis') ? 'timestampMillis' : null);
  const sorted = [...lines].sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
  const grouped = collapsePingRuns(sorted, tsField);
  const headerRow = fields.map(f => `<th>${escHtml(f)}</th>`).join('');
  const rows = grouped.map(r => `<tr>${fields.map(f => `<td>${escHtml(r[f] ?? '')}</td>`).join('')}</tr>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:90vw;max-width:1100px">
      <div class="modal-header">
        <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''} — raw</h2>
        <button class="modal-close-x" id="mobile-file-modal-close" aria-label="Close" title="Close">&times;</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${fields.length}" style="color:var(--muted)">No lines in this file.</td></tr>`}</tbody>
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

// "→ <real race>" once the row has been adopted (js/mobile-files-adoption.js), until the phone
// renames and its old row goes away.
function adoptedSuffix(target) {
  return target ? ` <span style="font-size:0.75rem;color:var(--muted)">→ ${escHtml(target)}</span>` : '';
}

function buildColumns(isAdminUser) {
  return tableColumns(TABLES['mobile-files'], {
    select:    r => `<input type="checkbox" class="mobile-file-select" data-idx="${r.idx}" aria-label="Select ${escHtml(r.device.name)}"${selectedKeys.has(rowKey(r)) ? ' checked' : ''}>`,
    owner:     isAdminUser ? r => escHtml(r.owner) : undefined,
    // Date suffix dropped from the visible text — it's redundant with the Race Date column
    // right next to it — but kept in the title tooltip, the full raceLabel is still the exact
    // identifier this row's own file paths/API calls use under the hood.
    raceLabel: r => `<span title="${escHtml(r.raceLabel)}">${escHtml(raceNameOf(r.raceLabel))}</span>`,
    raceDate:  r => formatRaceDate(r.raceDate),
    device:    r => escHtml(r.device.name) + adoptedSuffix(r.adoptedInto) + (r.pending
      ? ' <span style="font-size:0.7rem;background:var(--accent);color:#fff;border-radius:4px;padding:0 4px">pending upload</span>'
      : ''),
    // 'Unknown' (not the View modal's own '—') once every visit's been properly closed — a
    // completely reset device (ToDo.MD: "the device list should show unknown in the where
    // column"), distinct from the View modal's own blank-dash convention for the same state.
    location:  r => `<span title="${escHtml(r.locations.join(', '))}">${escHtml(r.locations.join(', ') || 'Unknown')}</span>`,
    bibs:      r => formatCount(r.bibsVisible, r.bibsExpected),
    time:      r => formatCount(r.timeVisible, r.timeExpected),
    // ToDo.MD: "devices tab ... should indicate a device has gone off-line if it does not see
    // regular pings" — r.offline (js/mobile-files-devices.js's isDeviceOffline(), via
    // flattenDevices()) flags it; shown as a danger-colored badge right next to the timestamp
    // that's actually stale, not a separate column, and not a row-wide highlight — that red
    // background is already spoken for by incorporationStatus (renderRaceList()'s own rowAttrs
    // below), a different, more important signal this shouldn't compete with.
    lastSeen:   r => formatDateTime(r.lastSeen) + (r.offline ? ' <span style="color:var(--danger)">Offline</span>' : ''),
    bleContact: r => r.bleContact
      ? `${formatDateTime(r.bleContact.at)} ${r.bleContact.via === 'direct' ? 'direct' : `via ${escHtml(r.bleContact.via)}`}`
      : '<span style="color:var(--muted)">—</span>',
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

// Remembered purely so repaintIncorporationStatus() below can rebuild the same columns without
// a caller having to pass isAdminUser back in — it never changes between a renderRaceList() call
// and the repaint that follows it.
let lastIsAdminUser = false;

function paintRaceList() {
  renderTable('mobile-files-tbody', buildColumns(lastIsAdminUser), currentRows, {
    rowAttrs: r => ({
      'data-idx': r.idx,
      class: r.incorporationStatus === 'outstanding' ? 'row-outstanding'
        : r.incorporationStatus === 'incorporated' ? 'row-incorporated'
        : '',
    }),
  });
}

export function renderRaceList(races, isAdminUser) {
  lastIsAdminUser = isAdminUser;
  currentRows = flattenDevices(races);
  paintRaceList();
}

// ToDo.MD: "when there are 2 phones recording CountSeen their colours in the devices list
// alternate between red and green, this is confusing". Cause: a device's row only ever turns
// green via setLastSyncedLineNumber(), called from applyComputedResults() — but
// autoUpdateProgress()/maybeAutoUpdateProgress() (js/views/mobile-files-progress.js) only
// re-render the Progress table afterwards, not this one, so a row stays whatever colour the last
// *unrelated* poll render happened to catch it at until the next full renderMobileFiles() comes
// along. Two Count-mode phones both logging CountSeen at their own unsynchronized moments means
// there's essentially always exactly one of them "outstanding since last incorporation" at any
// given poll tick, so which one looks red keeps changing from tick to tick even though neither
// device is actually behind in any way that matters. Recomputing + repainting right here, called
// immediately after applyComputedResults() actually advances the bookkeeping, closes that gap
// without a server round-trip (nothing server-side changed, only the local last-synced map).
export function repaintIncorporationStatus() {
  if (!currentRows.length) return;
  for (const r of currentRows) r.incorporationStatus = computeIncorporationStatus(r);
  paintRaceList();
}
