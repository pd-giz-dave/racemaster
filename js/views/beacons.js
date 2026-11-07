'use strict';

import { state, saveBeacons } from '../state.js';
import { createBeacon } from '../schema.js';
import { CSV } from '../csv-schema.js';
import { normaliseBeaconRows } from '../data.js';
import { on, setHTML, showStatus, showConfirmDialog, pickFile, downloadText, sanitise, renderTable, tableColumns, wireFormFocusTrap } from '../ui.js';
import { escHtml, normaliseDate } from '../utils.js';
import { TABLES } from '../strings.js';
import { parseCSV } from '../csv.js';
import { getSession, apiListDatasets, apiReadDataset } from '../storage.js';

const BEACON_COLS = tableColumns(TABLES.beacons, {
  number:       ({ b }) => b.number || '',
  owner:        ({ b }) => escHtml(b.owner || ''),
  dateAcquired: ({ b }) => escHtml(b.dateAcquired || ''),
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

export function renderBeacons() {
  const rows = state.beacons.map((b, i) => ({ b, i }));
  renderTable('beacons-tbody', BEACON_COLS, rows, {
    rowAttrs: ({ i }) => ({ id: `beacon-row-${i}`, 'data-idx': i }),
  });
  setHTML('beacons-count', `${state.beacons.length} beacons`);
}

export function editBeaconRow(idx) {
  const b = state.beacons[idx];
  if (!b) return;
  const row = document.getElementById(`beacon-row-${idx}`);
  if (!row) return;
  row.classList.add('row-edit-wrap');
  row.innerHTML = `
    <td data-label="Number">${b.number || ''}</td>
    <td data-label="Owner"><input id="bcn-owner-${idx}"    type="text"   value="${escHtml(b.owner || '')}"               style="width:80px"></td>
    <td data-label="Date Acquired"><input id="bcn-acq-${idx}"      type="text"   value="${escHtml(b.dateAcquired || '')}"        data-normalise="date" placeholder="DD/MM/YY" style="width:100px"></td>
    <td data-label="Total Hours"><input id="bcn-hours-${idx}"    type="number" value="${escHtml(String(b.totalHours || 0))}"   style="width:80px" step="0.1" min="0"></td>
    <td data-label="Battery Level"><input id="bcn-battery-${idx}"  type="number" value="${escHtml(String(b.batteryLevel ?? ''))}" style="width:70px" min="0" max="100"></td>
    <td data-label="Last Used"><input id="bcn-lastused-${idx}" type="text"   value="${escHtml(b.lastUsed || '')}"             data-normalise="date" placeholder="DD/MM/YY" style="width:100px"></td>
    <td data-label="Lost"><input id="bcn-lost-${idx}"     type="text"   value="${escHtml(normaliseDate(b.lost) || b.lost || '')}" data-normalise="date" placeholder="DD/MM/YY" style="width:100px"></td>
    <td data-label="Notes"><input id="bcn-notes-${idx}"    type="text"   value="${escHtml(b.notes || '')}"                style="width:100%;min-width:120px"></td>
    <td data-label="Actions">
      <button class="btn-sm btn-save"      data-idx="${idx}">Save</button>
      <button class="btn-sm btn-secondary" data-idx="${idx}">Cancel</button>
    </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => saveBeaconRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderBeacons());
  wireFormFocusTrap(`beacon-row-${idx}`, () => saveBeaconRow(idx)); // Tab stays within this row, Enter saves
  document.getElementById(`bcn-owner-${idx}`)?.focus();
}

export async function saveBeaconRow(idx) {
  const b = state.beacons[idx];
  if (!b) return;
  b.owner        = document.getElementById(`bcn-owner-${idx}`)?.value.trim()    || '';
  b.dateAcquired = normaliseDate(document.getElementById(`bcn-acq-${idx}`)?.value.trim());
  b.totalHours   = +document.getElementById(`bcn-hours-${idx}`)?.value          || 0;
  const batteryVal = document.getElementById(`bcn-battery-${idx}`)?.value.trim();
  b.batteryLevel = batteryVal === '' ? '' : +batteryVal;
  b.lastUsed     = normaliseDate(document.getElementById(`bcn-lastused-${idx}`)?.value.trim());
  b.lost         = normaliseDate(document.getElementById(`bcn-lost-${idx}`)?.value.trim());
  b.notes        = document.getElementById(`bcn-notes-${idx}`)?.value.trim()    || '';
  await saveBeacons();
  showStatus(`Beacon ${b.number} updated.`);
  renderBeacons();
}

export function showAddBeaconRow() {
  const tbody = document.getElementById('beacons-tbody');
  if (!tbody) return;
  if (document.getElementById('beacon-row-new')) return; // already open
  const nextNumber = state.beacons.length
    ? Math.max(...state.beacons.map(b => +b.number)) + 1
    : 1;
  // Defaults from the previous entry (the last row, by number) — most beacons are bought and
  // registered in batches by the same owner on the same date, so repeating the prior row's own
  // Owner/Date Acquired/Notes saves re-typing the same value for every beacon in a batch.
  const prev = state.beacons[state.beacons.length - 1] || null;
  const tr = document.createElement('tr');
  tr.id = 'beacon-row-new';
  tr.className = 'row-edit-wrap';
  tr.innerHTML = `
    <td data-label="Number"><input id="bcn-new-number" type="text" value="${nextNumber}" style="width:60px"></td>
    <td data-label="Owner"><input id="bcn-new-owner"  type="text" value="${escHtml(prev?.owner || '')}"              style="width:80px"></td>
    <td data-label="Date Acquired"><input id="bcn-new-acq"    type="text" value="${escHtml(prev?.dateAcquired || '')}" data-normalise="date" placeholder="DD/MM/YY" style="width:100px"></td>
    <td colspan="3"></td>
    <td colspan="2" data-label="Notes"><input id="bcn-new-notes" type="text" value="${escHtml(prev?.notes || '')}" style="width:160px"></td>
    <td data-label="Actions">
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-save').addEventListener('click', saveNewBeaconRow);
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  tr.addEventListener('keydown', e => { if (e.key === 'Escape') tr.remove(); });
  wireFormFocusTrap('beacon-row-new', saveNewBeaconRow); // Tab cycles the row's fields, Enter saves
  setTimeout(() => {
    const numberInput = tr.querySelector('input');
    if (numberInput) {
      numberInput.scrollIntoView({ block: 'center' });
      numberInput.focus();
      numberInput.select();
    }
  }, 50);
}

export async function saveNewBeaconRow() {
  const number = document.getElementById('bcn-new-number')?.value.trim();
  if (!number || isNaN(+number)) { showStatus('Number is required.', true); return; }
  if (state.beacons.find(b => +b.number === +number)) {
    showStatus(`Beacon ${number} already exists.`, true); return;
  }
  const owner = document.getElementById('bcn-new-owner')?.value.trim() || '';
  if (!owner) { showStatus('Owner is required.', true); return; }
  const dateAcquired = normaliseDate(document.getElementById('bcn-new-acq')?.value.trim());
  if (!dateAcquired) { showStatus('A valid date acquired is required.', true); return; }
  const notes = document.getElementById('bcn-new-notes')?.value.trim() || '';
  state.beacons.push(createBeacon({ number: +number, owner, dateAcquired, notes }));
  state.beacons.sort((a, b) => +a.number - +b.number);
  await saveBeacons();
  showStatus(`Beacon ${number} added.`);
  renderBeacons();
  showAddBeaconRow(); // keep adding — the user explicitly closes the row (Cancel/Escape) to stop
}

export async function deleteBeaconsFrom(idx) {
  const from = state.beacons[idx];
  if (!from) return;
  const count = state.beacons.length - idx;
  if (!await showConfirmDialog(`Delete ${count} beacon${count === 1 ? '' : 's'} from number ${from.number} onwards?`, 'Delete', true)) return;
  state.beacons.splice(idx);
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
    ...state.beacons.map(b => `${b.number},${b.owner || ''},${b.dateAcquired || ''},${b.totalHours || 0},${b.batteryLevel ?? ''},${b.lastUsed || ''},${b.lost || ''},${b.notes || ''}`)];
  downloadText(lines.join('\n'), `${sanitise(state.event?.name || 'beacons')}_beacons.csv`);
}

async function clearBeacons() {
  if (!await showConfirmDialog(`Clear all ${state.beacons.length} beacons?`, 'Clear All', true)) return;
  state.beacons.length = 0;
  await saveBeacons();
  showStatus('Beacons list cleared.');
  renderBeacons();
}

export function wireBeacons() {
  on('btn-import-beacons', 'click', importBeaconsFromFile);
  on('btn-export-beacons', 'click', exportBeacons);
  on('btn-add-beacon',     'click', showAddBeaconRow);
  on('btn-clear-beacons',  'click', clearBeacons);

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
    if (btn.dataset.action === 'edit') editBeaconRow(idx);
    else if (btn.dataset.action === 'del') deleteBeaconsFrom(idx);
  });
}
