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
import { selectedKeys, computeIncorporationStatus, loadSelectedKeys, currentDatasetContext } from '../mobile-files-shared.js';
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

// ---- Auto-update progress (ToDo.MD line 42) ----
//
// #mf-auto-progress starts disabled — there's nothing to trust it against until a manual
// Update Progress run has actually succeeded once, proving this dataset's own setup
// (categories, entries, etc.) is correct for it. There is exactly one of these — a single
// localStorage key holding the one dataset it's currently valid for (currentDatasetContext(),
// see mobile-files-shared.js — the dataset's own owner/fullName identity, NOT event name+date:
// that's only a heuristic, and two different datasets — a Copy of one, or two genuinely
// unrelated events — can easily share the same name and date). Switching to a different
// dataset just means the stored context no longer matches, so loadAutoProgressState() below
// returns null for it — nothing needs deleting or juggling per-dataset, there's only ever the
// one flag, valid for at most one dataset at a time.
const AUTO_PROGRESS_KEY = 'racemaster-mobile-auto-progress';

function loadAutoProgressState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTO_PROGRESS_KEY) || 'null');
    if (!parsed || parsed.context !== currentDatasetContext()) return null;
    return parsed;
  } catch { return null; }
}
function saveAutoProgressState(patch) {
  try {
    const current = loadAutoProgressState() || { unlocked: false, enabled: false };
    localStorage.setItem(AUTO_PROGRESS_KEY, JSON.stringify({
      context: currentDatasetContext(), ...current, ...patch,
    }));
  } catch { /* storage unavailable/full — best effort only, same as other persisted state here */ }
}
// A failed attempt — for whatever reason: a bib not in Entries, a network error mid-validation,
// anything — is reason enough to distrust the unlock, not just leave it as-is: whatever gave it
// that trust clearly isn't holding any more, and #mf-auto-progress re-running unattended against
// the same broken state would just repeat the same failure indefinitely with nobody watching.
// Removing the key outright (rather than writing unlocked:false) means a stale entry for some
// other dataset can never accidentally read back as "locked, but valid" once this dataset
// reconnects — there's nothing to leave behind describing this one at all.
function clearAutoProgressState() {
  try { localStorage.removeItem(AUTO_PROGRESS_KEY); } catch { /* best effort */ }
}

export function isProgressAutoUnlocked() { return !!loadAutoProgressState()?.unlocked; }
export function isProgressAutoEnabled()  { return isProgressAutoUnlocked() && !!loadAutoProgressState()?.enabled; }
export function setProgressAutoEnabled(enabled) { saveAutoProgressState({ enabled }); }

// Reflects current unlocked/enabled state into the checkbox — called once at wire time and
// again every render (renderMobileProgressTable(), below), since which dataset is connected
// (and therefore whether it's unlocked) can change without a page reload.
function syncAutoProgressCheckbox() {
  const cb = document.getElementById('mf-auto-progress');
  if (!cb) return;
  const unlocked = isProgressAutoUnlocked();
  cb.disabled = !unlocked;
  cb.checked = unlocked && isProgressAutoEnabled();
  cb.title = unlocked
    ? 'Automatically re-run Update Progress whenever a ticked file\'s data changes — a Bluetooth pull, Refresh, Push, or Discard. Ticking this checks immediately too, to catch up on anything missed while it was off.'
    : 'Run Update Progress successfully at least once for this dataset to unlock this option';
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
  // Deleting the computed data undermines the same trust a failed Update Progress attempt
  // would — see clearAutoProgressState()'s own doc above. renderMobileProgressTable() below
  // already calls syncAutoProgressCheckbox() itself, so the checkbox reflects this immediately.
  clearAutoProgressState();
  renderMobileProgressTable();
  showStatus('Progress cleared.');
}

export async function updateProgress() {
  // Refresh first so validation runs against the latest data — renderAll() already shows its
  // own status message if the fetch fails, falling back to whatever's currently loaded (server
  // unreachable is the expected case out in the field) rather than blocking.
  await renderAll();

  const selected = getSelectedRows();
  if (!selected.length) {
    showStatus('Select one or more mobile files first.', true);
    clearAutoProgressState();
    syncAutoProgressCheckbox();
    return;
  }

  const result = await validateAndCompute(selected);
  if (result.error) {
    showStatus(result.error, true);
    clearAutoProgressState();
    syncAutoProgressCheckbox();
    return;
  }
  const { finishRows, cpBuckets, expected, cpTimesByCp } = result;

  const existingCount = state.mobileProgress.length;
  const cpSummary = cpBuckets.size ? ` and checkpoint times from ${cpBuckets.size} CP file(s)` : '';
  const confirmMsg = existingCount
    ? `This replaces ${existingCount} existing progress record(s) with ${expected.length} from ${finishRows.length} Finish file(s)${cpSummary}. Continue?`
    : `Add ${expected.length} progress record(s) from ${finishRows.length} Finish file(s)${cpSummary}?`;
  if (!await showConfirmDialog(confirmMsg, 'Update Progress')) return;

  const { added } = await applyComputedResults(expected, cpTimesByCp, selected);

  // A successful manual run is exactly the proof #mf-auto-progress needs to unlock — see this
  // file's own AUTO_PROGRESS_KEY doc above. Set before the re-render below so
  // renderMobileProgressTable()'s own syncAutoProgressCheckbox() call reflects it immediately,
  // not on some later render.
  saveAutoProgressState({ unlocked: true });

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
  // Guards against the realistic case of switching datasets in place (via Datasets' Connect,
  // without a page reload) using a real dataset identity — see currentDatasetContext()'s own
  // doc in mobile-files-shared.js for why this isn't event name+date.
  if (persisted.context !== currentDatasetContext()) return;

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

// #mf-auto-progress's own trigger — called from mobile-files.js's own renderMobileFiles() once
// it's finished re-rendering, which happens after every action that can change a selected
// file's data (Refresh, Push, Discard, Delete, a Bluetooth pull that found something new — see
// that file's own doc) — that's what "whenever the selected files change, from any source"
// (ToDo.MD line 42) means in practice here. Deliberately not the same function as
// autoUpdateProgress() above: that one reloads the *persisted* selection and calls renderAll()
// itself, for the Results page's own case of arriving with nothing live rendered yet — calling
// it from here would recurse, since renderMobileFiles() has already just done both. This one
// instead trusts the selection already live on screen and does no rendering of its own beyond
// the progress table.
export async function maybeAutoUpdateProgress() {
  if (!isProgressAutoEnabled()) return;
  const selected = getSelectedRows();
  if (!selected.length) return;
  if (!selected.some(r => computeIncorporationStatus(r) === 'outstanding')) return; // nothing new since the last run

  const result = await validateAndCompute(selected);
  if (result.error) {
    // Same "any failed attempt clears the trust" rule as updateProgress()'s own manual failure
    // paths — an unattended run that's started failing shouldn't just keep silently failing
    // again on every future change with nobody watching; lock it back down and let a manual
    // Update Progress re-prove it once whatever's wrong is fixed.
    console.warn('[mobile-files] Progress auto-update skipped:', result.error);
    clearAutoProgressState();
    syncAutoProgressCheckbox();
    return;
  }

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
  syncAutoProgressCheckbox();
}

export function wireProgressTab() {
  on('btn-update-progress', 'click', updateProgress);
  on('btn-clear-progress', 'click', clearProgress);
  document.getElementById('mf-auto-progress')?.addEventListener('change', async e => {
    setProgressAutoEnabled(e.target.checked);
    // Ticking this on doesn't just arm it for the *next* change — it also catches up on
    // whatever happened while it was off: a fresh server fetch (renderAll(), the same one
    // Refresh itself runs) picks up anything missed by the background poll not running, and
    // its own trailing maybeAutoUpdateProgress() call recomputes progress if any already-
    // selected file turns out to have unincorporated data waiting. Nothing to catch up on
    // (unticking, or nothing was actually missed) just costs one fetch — same as Refresh.
    if (e.target.checked) await renderAll();
  });
  syncAutoProgressCheckbox();
}
