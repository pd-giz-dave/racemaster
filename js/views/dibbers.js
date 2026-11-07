'use strict';

import { state, saveDibbers } from '../state.js';
import { createDibber } from '../schema.js';
import { CSV } from '../csv-schema.js';
import { normaliseDibberRows } from '../data.js';
import { on, val, fillForm, clearForm, clearRowEditing, setHTML, showStatus, showConfirmDialog, pickFile, downloadText, sanitise, renderTable, tableColumns, wireFormFocusTrap } from '../ui.js';
import { escHtml, normaliseDate } from '../utils.js';
import { TABLES } from '../strings.js';
import { parseCSV } from '../csv.js';
import { getSession, apiListDatasets, apiReadDataset } from '../storage.js';

const DIBBER_COLS = tableColumns(TABLES.dibbers, {
  short_code: ({ d }) => d.shortCode || '',
  long_code:  ({ d }) => d.longCode  || '',
  owner:      ({ d }) => d.owner || '',
  // normaliseDate() here (not just on save) covers a dibber whose "lost" date is still stored
  // from before this field took free-typed DD/MM/YY entry, when it was a native type="date"
  // input and so stored as a raw ISO date — || d.lost falls back to the raw value for anything
  // normaliseDate can't parse.
  lost:       ({ d }) => d.lost ? `<span style="color:var(--danger)">${escHtml(normaliseDate(d.lost) || d.lost)}</span>` : '',
  notes:      ({ d }) => escHtml(d.notes || ''),
  actions:    () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-delete-entry" data-action="del">Del from here</button>`,
});

// Set while the Add Dibber form is editing an existing dibber rather than adding a new one —
// holds that dibber's own short code (its stable identity; array index can shift under sort/import).
let editingShortCode = 0;

export function renderDibbers() {
  const rows = state.dibbers.map((d, i) => ({ d, i }));
  renderTable('dibbers-tbody', DIBBER_COLS, rows, {
    rowAttrs: ({ i }) => ({ id: `dibber-row-${i}`, 'data-idx': i }),
  });
  setHTML('dibbers-count', `${state.dibbers.length} dibbers`);
  if (editingShortCode) {
    // Re-apply the highlight the fresh table markup just wiped out, without disturbing
    // whatever the user has mid-typed in the form.
    const idx = state.dibbers.findIndex(d => +d.shortCode === editingShortCode);
    document.getElementById(`dibber-row-${idx}`)?.classList.add('row-editing');
  } else {
    // Keeps the Add Dibber form's suggested number current with the catalogue — without this,
    // wireDibbers()'s own one-off call (at app bootstrap, before state.dibbers has loaded from
    // the dataset) would be the only time it's ever set, leaving it stuck on "Number: 1" the
    // first time this view is actually shown.
    fillDibberFormDefaults();
  }
}

// Populates the Add Dibber form with an existing dibber's values and switches it into Update
// mode — same pattern as editing an entry on the Entries page (see fillFormForEdit() there) and
// the Beacons page's own Edit, but without a confirm prompt first.
function fillDibberFormForEdit(shortCode) {
  const d = state.dibbers.find(x => +x.shortCode === +shortCode);
  if (!d) return;
  editingShortCode = +shortCode;
  fillForm('', {
    'dibber-form-short': d.shortCode,
    'dibber-form-long':  d.longCode || '',
    'dibber-form-owner': d.owner || '',
    'dibber-form-lost':  normaliseDate(d.lost) || d.lost || '',
    'dibber-form-notes': d.notes || '',
  });
  const shortEl = document.getElementById('dibber-form-short');
  if (shortEl) shortEl.readOnly = true; // renumbering risks orphaning entries already allocated this dibber
  const editFields = document.getElementById('dibber-form-edit-fields');
  if (editFields) editFields.hidden = false;
  const addBtn = document.getElementById('btn-add-dibber');
  if (addBtn) addBtn.textContent = 'Update';
  const cancelBtn = document.getElementById('btn-cancel-edit-dibber');
  if (cancelBtn) cancelBtn.style.display = '';
  clearRowEditing('dibbers-tbody');
  const idx = state.dibbers.indexOf(d);
  const row = document.getElementById(`dibber-row-${idx}`);
  row?.classList.add('row-editing');
  row?.scrollIntoView({ block: 'nearest' });
  document.getElementById('dibber-form-long')?.focus();
}

// Suggests the next free short code and long code, and carries Owner/Notes forward from the
// last dibber added — most dibbers are bought and registered in batches with consecutive long
// codes by the same owner, so repeating those values saves re-typing them for every dibber in
// the batch.
function fillDibberFormDefaults() {
  const nextShort = state.dibbers.length
    ? Math.max(...state.dibbers.map(d => +d.shortCode)) + 1
    : 1;
  const prev = state.dibbers[state.dibbers.length - 1] || null;
  fillForm('', {
    'dibber-form-short': nextShort,
    'dibber-form-long':  prev ? +prev.longCode + 1 : '',
    'dibber-form-owner': prev?.owner || '',
    'dibber-form-notes': prev?.notes || '',
  });
}

// Used by both the always-visible Reset button and the edit-only Cancel Edit button — exiting
// an edit in progress and resetting to a blank Add Dibber form are the same operation (mirrors
// resetEntryForm() on the Entries page, and resetBeaconForm() on the Beacons page).
export function resetDibberForm() {
  editingShortCode = 0;
  clearRowEditing('dibbers-tbody');
  const shortEl = document.getElementById('dibber-form-short');
  if (shortEl) shortEl.readOnly = false;
  const editFields = document.getElementById('dibber-form-edit-fields');
  if (editFields) editFields.hidden = true;
  const addBtn = document.getElementById('btn-add-dibber');
  if (addBtn) addBtn.textContent = 'Add Dibber';
  const cancelBtn = document.getElementById('btn-cancel-edit-dibber');
  if (cancelBtn) cancelBtn.style.display = 'none';
  clearForm('dibber-form-fields');
  fillDibberFormDefaults();
  document.getElementById('dibber-form-long')?.focus();
}

export async function submitDibberForm() {
  if (editingShortCode) {
    const d = state.dibbers.find(x => +x.shortCode === editingShortCode);
    if (!d) { resetDibberForm(); return; }
    const longVal = val('dibber-form-long').trim();
    if (longVal !== '' && !isNaN(+longVal)) {
      const clash = state.dibbers.find(x => +x.longCode === +longVal && x !== d);
      if (clash) {
        showStatus(`Long code ${longVal} already used by dibber ${clash.shortCode}.`, true);
        return;
      }
      d.longCode = +longVal;
    }
    d.owner = val('dibber-form-owner').trim();
    d.lost  = normaliseDate(val('dibber-form-lost').trim());
    d.notes = val('dibber-form-notes').trim();
    await saveDibbers();
    showStatus(`Dibber ${d.shortCode} updated.`);
    resetDibberForm();
    renderDibbers();
    return;
  }

  const short = val('dibber-form-short').trim();
  const long  = val('dibber-form-long').trim();
  if (!short || isNaN(+short)) { showStatus('Number is required.', true); return; }
  if (!long  || isNaN(+long))  { showStatus('Long code is required.', true); return; }
  if (state.dibbers.find(d => +d.shortCode === +short)) {
    showStatus(`Short code ${short} already exists.`, true); return;
  }
  if (state.dibbers.find(d => +d.longCode === +long)) {
    showStatus(`Long code ${long} already exists.`, true); return;
  }
  const owner = val('dibber-form-owner').trim();
  const notes = val('dibber-form-notes').trim();
  state.dibbers.push(createDibber({ shortCode: +short, longCode: +long, owner, notes }));
  state.dibbers.sort((a, b) => +a.shortCode - +b.shortCode);
  await saveDibbers();
  showStatus(`Dibber ${short} added.`);
  renderDibbers(); // also refreshes the form's suggested next number
  document.getElementById('dibber-form-long')?.focus();
}

export async function deleteDibbersFrom(idx) {
  const from = state.dibbers[idx];
  if (!from) return;
  const count = state.dibbers.length - idx;
  if (!await showConfirmDialog(`Delete ${count} dibber${count === 1 ? '' : 's'} from short code ${from.shortCode} onwards?`, 'Delete', true)) return;
  state.dibbers.splice(idx);
  if (editingShortCode && !state.dibbers.find(d => +d.shortCode === editingShortCode)) resetDibberForm();
  await saveDibbers();
  showStatus(`${count} dibber${count === 1 ? '' : 's'} deleted.`);
  renderDibbers();
}

export async function importDibbersFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  const raw = parseCSV(text);
  const rows = normaliseDibberRows(raw);
  if (!rows) {
    showStatus(`Dibber CSV must have a short code column (${(CSV.dibbers.aliases.shortCode ?? ['shortCode']).join(' / ')}) and a long code column (${(CSV.dibbers.aliases.longCode ?? ['longCode']).join(' / ')})`, true);
    return;
  }
  let added = 0, updated = 0;
  for (const row of rows) {
    const short = +row.shortCode, long = +row.longCode;
    if (!short || !long || isNaN(short) || isNaN(long)) continue;
    const existing = state.dibbers.findIndex(d => +d.shortCode === short);
    if (existing >= 0) {
      state.dibbers[existing].longCode     = long;
      state.dibbers[existing].owner = row.owner || state.dibbers[existing].owner;
      state.dibbers[existing].lost  = row.lost  || state.dibbers[existing].lost;
      state.dibbers[existing].notes = row.notes || state.dibbers[existing].notes;
      updated++;
    } else {
      state.dibbers.push(createDibber({ shortCode: short, longCode: long, owner: row.owner || '', lost: row.lost || '', notes: row.notes || '' }));
      added++;
    }
  }
  if (!added && !updated) { showStatus('No valid dibber rows found.', true); return; }
  state.dibbers.sort((a, b) => +a.shortCode - +b.shortCode);
  await saveDibbers();
  showStatus(`Dibbers: ${added} added, ${updated} updated.`);
  renderDibbers();
}

// ---- Merge from another dataset or JSON file ----

async function applyDibbersMerge(rows) {
  let added = 0, updated = 0;
  for (const row of rows) {
    const short = +row.shortCode;
    if (!short || isNaN(short)) continue;
    const existing = state.dibbers.find(d => +d.shortCode === short);
    if (existing) {
      const merged = {
        longCode: row.longCode ? +row.longCode : existing.longCode,
        owner:    row.owner || existing.owner,
        lost:     normaliseDate(row.lost) || existing.lost,
        notes:    row.notes || existing.notes,
      };
      const changed = Object.keys(merged).some(k => {
        const a = existing[k], b = merged[k];
        return typeof b === 'number' ? a !== b : (a || '').toString().toLowerCase() !== (b || '').toString().toLowerCase();
      });
      Object.assign(existing, merged);
      if (changed) updated++;
    } else {
      const long = +row.longCode;
      if (!long || isNaN(long)) continue; // long code required for a new dibber
      if (state.dibbers.find(d => +d.longCode === long)) continue; // long code already in use elsewhere
      state.dibbers.push(createDibber({ shortCode: short, longCode: long, owner: row.owner || '', lost: normaliseDate(row.lost), notes: row.notes || '' }));
      added++;
    }
  }
  state.dibbers.sort((a, b) => +a.shortCode - +b.shortCode);
  await saveDibbers();
  renderDibbers();
  return { added, updated };
}

function setMergeStatus(msg, isError = false) {
  const el = document.getElementById('dibbers-merge-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success,#1a6e3c)';
}

async function mergeFromFile() {
  const text = await pickFile('.json');
  if (!text) return;
  let data;
  try { data = JSON.parse(text); } catch { setMergeStatus('Not valid JSON.', true); return; }
  if (!Array.isArray(data?.dibbers)) { setMergeStatus('JSON file has no dibbers array.', true); return; }
  setMergeStatus('Merging…');
  const { added, updated } = await applyDibbersMerge(data.dibbers);
  setMergeStatus(`Done: ${added} added, ${updated} updated.`);
}

async function mergeFromDataset(path) {
  const session = getSession();
  if (!session) { setMergeStatus('Not signed in.', true); return; }
  setMergeStatus('Fetching…');
  try {
    const [owner, fullName] = path.split('/');
    const data = await apiReadDataset(session.token, owner, fullName);
    if (!Array.isArray(data?.dibbers)) { setMergeStatus('No dibbers in that dataset.', true); return; }
    const { added, updated } = await applyDibbersMerge(data.dibbers);
    setMergeStatus(`Done: ${added} added, ${updated} updated.`);
  } catch (e) {
    setMergeStatus('Error: ' + e.message, true);
  }
}

function openMergePanel() {
  const panel = document.getElementById('dibbers-merge-panel');
  if (!panel) return;
  panel.hidden = false;
  setMergeStatus('');

  const session = getSession();
  const dsRow = document.getElementById('dibbers-merge-ds-row');
  if (!dsRow) return;

  if (!session) {
    dsRow.hidden = true;
    return;
  }

  dsRow.hidden = false;
  const sel = document.getElementById('dibbers-merge-ds-select');
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

function exportDibbers() {
  const lines = [CSV.dibbers.fields.join(','),
    ...state.dibbers.map(d => `${d.shortCode},${d.longCode},${d.owner || ''},${d.lost || ''},${d.notes || ''}`)];
  downloadText(lines.join('\n'), `${sanitise(state.event?.name || 'dibbers')}_dibbers.csv`);
}

async function clearDibbers() {
  if (!await showConfirmDialog(`Clear all ${state.dibbers.length} dibbers?`, 'Clear All', true)) return;
  state.dibbers.length = 0;
  resetDibberForm();
  await saveDibbers();
  showStatus('Dibbers list cleared.');
  renderDibbers();
}

export function wireDibbers() {
  on('btn-import-dibbers', 'click', importDibbersFromFile);
  on('btn-export-dibbers', 'click', exportDibbers);
  on('btn-add-dibber',     'click', submitDibberForm);
  on('btn-reset-dibber-form', 'click', resetDibberForm);
  on('btn-cancel-edit-dibber', 'click', resetDibberForm);
  on('btn-clear-dibbers',  'click', clearDibbers);
  wireFormFocusTrap('dibber-form-fields', submitDibberForm); // Tab cycles the form, Enter adds
  fillDibberFormDefaults();

  on('btn-merge-dibbers',       'click', openMergePanel);
  on('btn-cancel-merge-dibbers', 'click', () => { document.getElementById('dibbers-merge-panel').hidden = true; });
  on('btn-merge-from-file-dibbers', 'click', mergeFromFile);
  on('btn-do-merge-ds-dibbers', 'click', () => {
    const path = document.getElementById('dibbers-merge-ds-select')?.value;
    if (!path) { setMergeStatus('Select a dataset first.', true); return; }
    mergeFromDataset(path);
  });

  document.getElementById('dibbers-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = +btn.closest('[data-idx]')?.dataset.idx;
    if (btn.dataset.action === 'edit') fillDibberFormForEdit(state.dibbers[idx]?.shortCode);
    else if (btn.dataset.action === 'del') deleteDibbersFrom(idx);
  });
}