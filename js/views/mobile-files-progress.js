'use strict';

// Compute Results (formerly "Add to Finishers") + the Progress tab — DOM/orchestration only.
// The actual validation/computation logic lives in js/mobile-files-progress.js (no DOM at all);
// this file wires the buttons, shows confirm dialogs/status toasts, and renders the table.
//
// Needs to trigger mobile-files.js's own renderMobileFiles() — including a real await-ordering
// dependency in updateProgress() ("refresh first so validation runs against the latest data") —
// so rather than importing it directly (which would create a circular import: mobile-files.js
// needs to import updateProgress/clearProgress/autoUpdateProgress from here to wire buttons and
// re-export autoUpdateProgress, and this file would need renderMobileFiles back), the render
// function is injected once via initProgressActions() instead. See mobile-files.js's own doc on
// this for the full reasoning.

import { on, showConfirmDialog, showStatus, renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import { getMobileCheckpointNumbers } from '../mobile-checkpoints.js';
import { state } from '../state.js';
import { selectedKeys, computeIncorporationStatus, loadSelectedKeys } from '../mobile-files-shared.js';
import {
  validateAndCompute, clearProgressData, applyComputedResults,
  buildProgressColumns, buildProgressRows,
} from '../mobile-files-progress.js';
import { currentRows } from './mobile-files-devices.js';

// Injected by mobile-files.js's own wireMobileFiles() — see this file's own top-of-file doc for
// why this is dependency-injected rather than imported directly.
let renderAll = null;
export function initProgressActions({ renderAll: r }) {
  renderAll = r;
}

function getSelectedRows() {
  return [...document.querySelectorAll('#mobile-files-tbody input.mobile-file-select:checked')]
    .map(cb => currentRows[+cb.dataset.idx])
    .filter(Boolean);
}

export async function clearProgress() {
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

export async function updateProgress() {
  // Refresh first so validation runs against the latest data — renderAll() already shows its
  // own status message if the fetch fails, falling back to whatever's currently loaded (server
  // unreachable is the expected case out in the field) rather than blocking.
  await renderAll();

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
  // mobile-files.js's own deleteRow() for why this comes before the specific outcome message,
  // not after.
  await renderAll();
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

  await renderAll(); // rebuilds currentRows + reflects selectedKeys in the checkboxes
  const selected = getSelectedRows();
  if (!selected.length) return; // persisted files no longer exist
  if (!selected.some(r => computeIncorporationStatus(r) === 'outstanding')) return; // nothing new since the last run

  const result = await validateAndCompute(selected);
  if (result.error) { console.warn('[mobile-files] Progress auto-update skipped:', result.error); return; }

  await applyComputedResults(result.expected, result.cpTimesByCp, selected);
  renderMobileProgressTable();
}

export function renderMobileProgressTable() {
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
  renderTable('mobile-progress-tbody', tableColumns(buildProgressColumns(TABLES['mobile-progress'], cpNumbers), renderers), rows);
}

export function wireProgressTab() {
  on('btn-update-progress', 'click', updateProgress);
  on('btn-clear-progress', 'click', clearProgress);
}
