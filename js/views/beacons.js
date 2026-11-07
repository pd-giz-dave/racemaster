'use strict';

import { state, saveBeacons } from '../state.js';
import { createBeacon } from '../schema.js';
import { CSV } from '../csv-schema.js';
import { normaliseBeaconRows } from '../data.js';
import { on, val, fillForm, clearForm, clearRowEditing, setHTML, showStatus, showConfirmDialog, pickFile, downloadText, sanitise, renderTable, tableColumns, wireFormFocusTrap } from '../ui.js';
import { escHtml, normaliseDate } from '../utils.js';
import { TABLES } from '../strings.js';
import { parseCSV } from '../csv.js';
import { getSession, apiListDatasets, apiReadDataset } from '../storage.js';

const BEACON_COLS = tableColumns(TABLES.beacons, {
  number:       ({ b }) => b.number || '',
  owner:        ({ b }) => escHtml(b.owner || ''),
  dateAcquired: ({ b }) => escHtml(b.dateAcquired || ''),
  usageCount:   ({ b }) => +b.usageCount || 0,
  totalHours:   ({ b }) => (+b.totalHours || 0).toFixed(1),
  batteryLevel: ({ b }) => {
    const threshold = +state.event.beaconLowBatteryThreshold || 20;
    const val = b.batteryLevel === '' || b.batteryLevel === undefined ? '' : `${+b.batteryLevel}%`;
    return val !== '' && +b.batteryLevel < threshold ? `<span style="color:var(--danger)">${val}</span>` : val;
  },
  lastUsed:     ({ b }) => escHtml(b.lastUsed || ''),
  // normaliseDate() here (not just on save) covers a beacon whose "lost" date is still stored
  // from before this field took free-typed DD/MM/YY entry, when it was a native type="date"
  // input and so stored as a raw ISO date — this reformats it for display without needing an
  // edit+save first; || b.lost falls back to the raw value for anything normaliseDate can't parse.
  lost:         ({ b }) => b.lost ? `<span style="color:var(--danger)">${escHtml(normaliseDate(b.lost) || b.lost)}</span>` : '',
  notes:        ({ b }) => escHtml(b.notes || ''),
  actions:      () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-delete-entry" data-action="del">Del from here</button>`,
});

// Set while the Add Beacon form is editing an existing beacon rather than adding a new one —
// holds that beacon's own number (its stable identity; array index can shift under sort/import).
let editingNumber = 0;

export function renderBeacons() {
  const rows = state.beacons.map((b, i) => ({ b, i }));
  renderTable('beacons-tbody', BEACON_COLS, rows, {
    rowAttrs: ({ i }) => ({ id: `beacon-row-${i}`, 'data-idx': i }),
  });
  setHTML('beacons-count', `${state.beacons.length} beacons`);
  if (editingNumber) {
    // Re-apply the highlight the fresh table markup just wiped out, without disturbing
    // whatever the user has mid-typed in the form.
    const idx = state.beacons.findIndex(b => +b.number === editingNumber);
    document.getElementById(`beacon-row-${idx}`)?.classList.add('row-editing');
  } else {
    // Keeps the Add Beacon form's suggested number/defaults current with the catalogue —
    // without this, wireBeacons()'s own one-off call (at app bootstrap, before state.beacons
    // has loaded from the dataset) would be the only time it's ever set, leaving it stuck on
    // "Number: 1, blank" the first time this view is actually shown.
    fillBeaconFormDefaults();
  }
}

// Populates the Add Beacon form with an existing beacon's values and switches it into Update
// mode — same pattern as editing an entry on the Entries page (see fillFormForEdit() there),
// but without a confirm prompt first, since editing a beacon record is low-stakes and reversible.
function fillBeaconFormForEdit(number) {
  const b = state.beacons.find(x => +x.number === +number);
  if (!b) return;
  editingNumber = +number;
  fillForm('', {
    'beacon-form-number':   b.number,
    'beacon-form-owner':    b.owner || '',
    'beacon-form-acquired': b.dateAcquired || '',
    'beacon-form-uses':     b.usageCount || 0,
    'beacon-form-hours':    b.totalHours || 0,
    'beacon-form-battery':  b.batteryLevel ?? '',
    'beacon-form-lastused': normaliseDate(b.lastUsed) || b.lastUsed || '',
    'beacon-form-lost':     normaliseDate(b.lost) || b.lost || '',
    'beacon-form-notes':    b.notes || '',
  });
  const numberEl = document.getElementById('beacon-form-number');
  if (numberEl) numberEl.readOnly = true; // renumbering risks orphaning entries already allocated this beacon
  const editFields = document.getElementById('beacon-form-edit-fields');
  if (editFields) editFields.hidden = false;
  const addBtn = document.getElementById('btn-add-beacon');
  if (addBtn) addBtn.textContent = 'Update';
  const cancelBtn = document.getElementById('btn-cancel-edit-beacon');
  if (cancelBtn) cancelBtn.style.display = '';
  clearRowEditing('beacons-tbody');
  const idx = state.beacons.indexOf(b);
  const row = document.getElementById(`beacon-row-${idx}`);
  row?.classList.add('row-editing');
  row?.scrollIntoView({ block: 'nearest' });
  document.getElementById('beacon-form-owner')?.focus();
}

// Suggests the next free number and carries Owner/Date Acquired/Notes forward from the last
// beacon added — most beacons are bought and registered in batches by the same owner on the
// same date, so repeating those values saves re-typing them for every beacon in the batch.
function fillBeaconFormDefaults() {
  const nextNumber = state.beacons.length
    ? Math.max(...state.beacons.map(b => +b.number)) + 1
    : 1;
  const prev = state.beacons[state.beacons.length - 1] || null;
  fillForm('', {
    'beacon-form-number':   nextNumber,
    'beacon-form-owner':    prev?.owner || '',
    'beacon-form-acquired': prev?.dateAcquired || '',
    'beacon-form-notes':    prev?.notes || '',
  });
}

// Used by both the always-visible Reset button and the edit-only Cancel Edit button — exiting
// an edit in progress and resetting to a blank Add Beacon form are the same operation (mirrors
// resetEntryForm() on the Entries page, which both its own Reset and Cancel Edit buttons share).
export function resetBeaconForm() {
  editingNumber = 0;
  clearRowEditing('beacons-tbody');
  const numberEl = document.getElementById('beacon-form-number');
  if (numberEl) numberEl.readOnly = false;
  const editFields = document.getElementById('beacon-form-edit-fields');
  if (editFields) editFields.hidden = true;
  const addBtn = document.getElementById('btn-add-beacon');
  if (addBtn) addBtn.textContent = 'Add Beacon';
  const cancelBtn = document.getElementById('btn-cancel-edit-beacon');
  if (cancelBtn) cancelBtn.style.display = 'none';
  clearForm('beacon-form-fields');
  fillBeaconFormDefaults();
  document.getElementById('beacon-form-acquired')?.focus();
}

export async function submitBeaconForm() {
  if (editingNumber) {
    const b = state.beacons.find(x => +x.number === editingNumber);
    if (!b) { resetBeaconForm(); return; }
    const owner = val('beacon-form-owner').trim();
    if (!owner) { showStatus('Owner is required.', true); return; }
    const dateAcquired = normaliseDate(val('beacon-form-acquired').trim());
    if (!dateAcquired) { showStatus('A valid date acquired is required.', true); return; }
    b.owner        = owner;
    b.dateAcquired = dateAcquired;
    b.usageCount   = +val('beacon-form-uses') || 0;
    b.totalHours   = +val('beacon-form-hours') || 0;
    const batteryVal = val('beacon-form-battery').trim();
    b.batteryLevel = batteryVal === '' ? '' : +batteryVal;
    b.lastUsed     = normaliseDate(val('beacon-form-lastused').trim());
    b.lost         = normaliseDate(val('beacon-form-lost').trim());
    b.notes        = val('beacon-form-notes').trim();
    await saveBeacons();
    showStatus(`Beacon ${b.number} updated.`);
    resetBeaconForm();
    renderBeacons();
    return;
  }

  const number = val('beacon-form-number').trim();
  if (!number || isNaN(+number)) { showStatus('Number is required.', true); return; }
  if (state.beacons.find(b => +b.number === +number)) {
    showStatus(`Beacon ${number} already exists.`, true); return;
  }
  const owner = val('beacon-form-owner').trim();
  if (!owner) { showStatus('Owner is required.', true); return; }
  const dateAcquired = normaliseDate(val('beacon-form-acquired').trim());
  if (!dateAcquired) { showStatus('A valid date acquired is required.', true); return; }
  const notes = val('beacon-form-notes').trim();
  state.beacons.push(createBeacon({ number: +number, owner, dateAcquired, notes }));
  state.beacons.sort((a, b) => +a.number - +b.number);
  await saveBeacons();
  showStatus(`Beacon ${number} added.`);
  renderBeacons(); // also refreshes the form's defaults, ready for the next one
  document.getElementById('beacon-form-acquired')?.focus();
}

export async function deleteBeaconsFrom(idx) {
  const from = state.beacons[idx];
  if (!from) return;
  const count = state.beacons.length - idx;
  if (!await showConfirmDialog(`Delete ${count} beacon${count === 1 ? '' : 's'} from number ${from.number} onwards?`, 'Delete', true)) return;
  state.beacons.splice(idx);
  if (editingNumber && !state.beacons.find(b => +b.number === editingNumber)) resetBeaconForm();
  await saveBeacons();
  showStatus(`${count} beacon${count === 1 ? '' : 's'} deleted.`);
  renderBeacons();
}

export async function importBeaconsFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  const raw = parseCSV(text);
  const rows = normaliseBeaconRows(raw);
  if (!rows) {
    showStatus(`Beacon CSV must have a number column (${(CSV.beacons.aliases.number ?? ['number']).join(' / ')})`, true);
    return;
  }
  let added = 0, updated = 0;
  for (const row of rows) {
    const number = +row.number;
    if (!number || isNaN(number)) continue;
    const existing = state.beacons.findIndex(b => +b.number === number);
    if (existing >= 0) {
      const b = state.beacons[existing];
      b.owner        = row.owner        || b.owner;
      b.dateAcquired = row.dateAcquired || b.dateAcquired;
      b.usageCount   = row.usageCount   || b.usageCount;
      b.totalHours   = row.totalHours   || b.totalHours;
      b.batteryLevel = row.batteryLevel !== '' && row.batteryLevel !== undefined ? row.batteryLevel : b.batteryLevel;
      b.lastUsed     = row.lastUsed     || b.lastUsed;
      b.lost         = row.lost         || b.lost;
      b.notes        = row.notes        || b.notes;
      updated++;
    } else {
      state.beacons.push(createBeacon(row));
      added++;
    }
  }
  if (!added && !updated) { showStatus('No valid beacon rows found.', true); return; }
  state.beacons.sort((a, b) => +a.number - +b.number);
  await saveBeacons();
  showStatus(`Beacons: ${added} added, ${updated} updated.`);
  renderBeacons();
}

// ---- Merge from another dataset or JSON file ----

async function applyBeaconsMerge(rows) {
  let added = 0, updated = 0;
  for (const row of rows) {
    const number = +row.number;
    if (!number || isNaN(number)) continue;
    const existing = state.beacons.find(b => +b.number === number);
    if (existing) {
      const merged = {
        owner:        row.owner        || existing.owner,
        dateAcquired: normaliseDate(row.dateAcquired) || existing.dateAcquired,
        usageCount:   row.usageCount   || existing.usageCount,
        totalHours:   row.totalHours   || existing.totalHours,
        batteryLevel: row.batteryLevel !== '' && row.batteryLevel !== undefined ? row.batteryLevel : existing.batteryLevel,
        lastUsed:     normaliseDate(row.lastUsed) || existing.lastUsed,
        lost:         normaliseDate(row.lost) || existing.lost,
        notes:        row.notes        || existing.notes,
      };
      const changed = Object.keys(merged).some(k => {
        const a = existing[k], b = merged[k];
        return typeof b === 'number' ? a !== b : (a || '').toString().toLowerCase() !== (b || '').toString().toLowerCase();
      });
      Object.assign(existing, merged);
      if (changed) updated++;
    } else {
      state.beacons.push(createBeacon({ number, owner: row.owner || '', dateAcquired: normaliseDate(row.dateAcquired), lost: normaliseDate(row.lost), notes: row.notes || '' }));
      added++;
    }
  }
  state.beacons.sort((a, b) => +a.number - +b.number);
  await saveBeacons();
  renderBeacons();
  return { added, updated };
}

function setMergeStatus(msg, isError = false) {
  const el = document.getElementById('beacons-merge-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success,#1a6e3c)';
}

async function mergeFromFile() {
  const text = await pickFile('.json');
  if (!text) return;
  let data;
  try { data = JSON.parse(text); } catch { setMergeStatus('Not valid JSON.', true); return; }
  if (!Array.isArray(data?.beacons)) { setMergeStatus('JSON file has no beacons array.', true); return; }
  setMergeStatus('Merging…');
  const { added, updated } = await applyBeaconsMerge(data.beacons);
  setMergeStatus(`Done: ${added} added, ${updated} updated.`);
}

async function mergeFromDataset(path) {
  const session = getSession();
  if (!session) { setMergeStatus('Not signed in.', true); return; }
  setMergeStatus('Fetching…');
  try {
    const [owner, fullName] = path.split('/');
    const data = await apiReadDataset(session.token, owner, fullName);
    if (!Array.isArray(data?.beacons)) { setMergeStatus('No beacons in that dataset.', true); return; }
    const { added, updated } = await applyBeaconsMerge(data.beacons);
    setMergeStatus(`Done: ${added} added, ${updated} updated.`);
  } catch (e) {
    setMergeStatus('Error: ' + e.message, true);
  }
}

function openMergePanel() {
  const panel = document.getElementById('beacons-merge-panel');
  if (!panel) return;
  panel.hidden = false;
  setMergeStatus('');

  const session = getSession();
  const dsRow = document.getElementById('beacons-merge-ds-row');
  if (!dsRow) return;

  if (!session) {
    dsRow.hidden = true;
    return;
  }

  dsRow.hidden = false;
  const sel = document.getElementById('beacons-merge-ds-select');
  sel.innerHTML = '<option value="">Loading…</option>';
  sel.disabled = true;

  apiListDatasets(session.token).then(datasets => {
    const current = session.dataset;
    const opts = datasets
      .filter(d => `${d.owner}/${d.fullName}` !== current)
      .map(d => `<option value="${escHtml(d.owner)}/${escHtml(d.fullName)}">${escHtml(d.name)} (${escHtml(d.owner)})</option>`);
    sel.innerHTML = '<option value="">— select dataset —</option>' + opts.join('');
    sel.disabled = false;
  }).catch(() => {
    sel.innerHTML = '<option value="">Could not load datasets</option>';
    sel.disabled = true;
  });
}

function exportBeacons() {
  const lines = [CSV.beacons.fields.join(','),
    ...state.beacons.map(b => `${b.number},${b.owner || ''},${b.dateAcquired || ''},${b.usageCount || 0},${b.totalHours || 0},${b.batteryLevel ?? ''},${b.lastUsed || ''},${b.lost || ''},${b.notes || ''}`)];
  downloadText(lines.join('\n'), `${sanitise(state.event?.name || 'beacons')}_beacons.csv`);
}

async function clearBeacons() {
  if (!await showConfirmDialog(`Clear all ${state.beacons.length} beacons?`, 'Clear All', true)) return;
  state.beacons.length = 0;
  resetBeaconForm();
  await saveBeacons();
  showStatus('Beacons list cleared.');
  renderBeacons();
}

export function wireBeacons() {
  on('btn-import-beacons', 'click', importBeaconsFromFile);
  on('btn-export-beacons', 'click', exportBeacons);
  on('btn-add-beacon',     'click', submitBeaconForm);
  on('btn-reset-beacon-form', 'click', resetBeaconForm);
  on('btn-cancel-edit-beacon', 'click', resetBeaconForm);
  on('btn-clear-beacons',  'click', clearBeacons);
  wireFormFocusTrap('beacon-form-fields', submitBeaconForm); // Tab cycles the form, Enter adds
  fillBeaconFormDefaults();

  on('btn-merge-beacons',       'click', openMergePanel);
  on('btn-cancel-merge-beacons', 'click', () => { document.getElementById('beacons-merge-panel').hidden = true; });
  on('btn-merge-from-file-beacons', 'click', mergeFromFile);
  on('btn-do-merge-ds-beacons', 'click', () => {
    const path = document.getElementById('beacons-merge-ds-select')?.value;
    if (!path) { setMergeStatus('Select a dataset first.', true); return; }
    mergeFromDataset(path);
  });

  document.getElementById('beacons-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = +btn.closest('[data-idx]')?.dataset.idx;
    if (btn.dataset.action === 'edit') fillBeaconFormForEdit(state.beacons[idx]?.number);
    else if (btn.dataset.action === 'del') deleteBeaconsFrom(idx);
  });
}
