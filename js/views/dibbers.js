'use strict';

import { state, saveDibbers } from '../state.js';
import { createDibber } from '../schema.js';
import { CSV } from '../csv-schema.js';
import { normaliseDibberRows } from '../data.js';
import { on, setHTML, showStatus, showConfirmDialog, pickFile, downloadText, sanitise, renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import { parseCSV } from '../csv.js';
import { getSession, apiListDatasets, apiReadDataset } from '../storage.js';

const DIBBER_COLS = tableColumns(TABLES.dibbers, {
  short_code: ({ d }) => d.shortCode || '',
  long_code:  ({ d }) => d.longCode  || '',
  owner:      ({ d }) => d.owner || '',
  lost:       ({ d }) => d.lost ? `<span style="color:var(--danger)">${escHtml(d.lost)}</span>` : '',
  notes:      ({ d }) => escHtml(d.notes || ''),
  actions:    () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-delete-entry" data-action="del">Del from here</button>`,
});

export function renderDibbers() {
  const rows = state.dibbers.map((d, i) => ({ d, i }));
  renderTable('dibbers-tbody', DIBBER_COLS, rows, {
    rowAttrs: ({ i }) => ({ id: `dibber-row-${i}`, 'data-idx': i }),
  });
  setHTML('dibbers-count', `${state.dibbers.length} dibbers`);
}

export function editDibberRow(idx) {
  const d = state.dibbers[idx];
  if (!d) return;
  const row = document.getElementById(`dibber-row-${idx}`);
  if (!row) return;
  row.innerHTML = `
    <td>${d.shortCode || ''}</td>
    <td><input id="dib-long-${idx}"  type="text" value="${escHtml(String(d.longCode || ''))}" style="width:90px"></td>
    <td><input id="dib-avail-${idx}" type="text" value="${escHtml(d.owner || '')}"            style="width:80px"></td>
    <td><input id="dib-lost-${idx}"  type="date" value="${escHtml(d.lost  || '')}"            style="width:130px"></td>
    <td><input id="dib-notes-${idx}" type="text" value="${escHtml(d.notes || '')}"            style="width:100%;min-width:120px"></td>
    <td>
      <button class="btn-sm btn-save"      data-idx="${idx}">Save</button>
      <button class="btn-sm btn-secondary" data-idx="${idx}">Cancel</button>
    </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => saveDibberRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderDibbers());
  document.getElementById(`dib-long-${idx}`)?.focus();
}

export async function saveDibberRow(idx) {
  const d = state.dibbers[idx];
  if (!d) return;
  const longVal = document.getElementById(`dib-long-${idx}`)?.value.trim();
  if (longVal !== '' && !isNaN(+longVal)) {
    const clash = state.dibbers.findIndex(x => +x.longCode === +longVal);
    if (clash >= 0 && clash !== idx) {
      showStatus(`Long code ${longVal} already used by dibber ${state.dibbers[clash].shortCode}.`, true);
      return;
    }
    d.longCode = +longVal;
  }
  d.owner = document.getElementById(`dib-avail-${idx}`)?.value.trim() || '';
  d.lost  = document.getElementById(`dib-lost-${idx}`)?.value.trim()  || '';
  d.notes = document.getElementById(`dib-notes-${idx}`)?.value.trim() || '';
  await saveDibbers();
  showStatus(`Dibber ${d.shortCode} updated.`);
  renderDibbers();
}

export function showAddDibberRow() {
  const tbody = document.getElementById('dibbers-tbody');
  if (!tbody) return;
  if (document.getElementById('dibber-row-new')) return; // already open
  const nextShort = state.dibbers.length
    ? Math.max(...state.dibbers.map(d => +d.shortCode)) + 1
    : 1;
  const tr = document.createElement('tr');
  tr.id = 'dibber-row-new';
  tr.innerHTML = `
    <td><input id="dib-new-short" type="text" value="${nextShort}" style="width:60px"></td>
    <td><input id="dib-new-long"  type="text" value=""             style="width:90px"></td>
    <td><input id="dib-new-avail" type="text" value=""             style="width:80px"></td>
    <td><input id="dib-new-notes" type="text" value=""             style="width:160px"></td>
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-save').addEventListener('click', saveNewDibberRow);
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  setTimeout(() => {
    const shortInput = tr.querySelector('input');
    if (shortInput) {
      shortInput.scrollIntoView({ block: 'center' });
      shortInput.focus();
      shortInput.select();
    }
  }, 50);
}

export async function saveNewDibberRow() {
  const short = document.getElementById('dib-new-short')?.value.trim();
  const long  = document.getElementById('dib-new-long')?.value.trim();
  if (!short || isNaN(+short)) { showStatus('Short code is required.', true); return; }
  if (!long  || isNaN(+long))  { showStatus('Long code is required.',  true); return; }
  if (state.dibbers.find(d => +d.shortCode === +short)) {
    showStatus(`Short code ${short} already exists.`, true); return;
  }
  if (state.dibbers.find(d => +d.longCode === +long)) {
    showStatus(`Long code ${long} already exists.`, true); return;
  }
  const avail = document.getElementById('dib-new-avail')?.value.trim() || '';
  const notes = document.getElementById('dib-new-notes')?.value.trim() || '';
  state.dibbers.push(createDibber({ shortCode: +short, longCode: +long, owner: avail, notes }));
  state.dibbers.sort((a, b) => +a.shortCode - +b.shortCode);
  await saveDibbers();
  showStatus(`Dibber ${short} added.`);
  renderDibbers();
}

export async function deleteDibbersFrom(idx) {
  const from = state.dibbers[idx];
  if (!from) return;
  const count = state.dibbers.length - idx;
  if (!await showConfirmDialog(`Delete ${count} dibber${count === 1 ? '' : 's'} from short code ${from.shortCode} onwards?`, 'Delete', true)) return;
  state.dibbers.splice(idx);
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
        lost:     row.lost  || existing.lost,
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
      state.dibbers.push(createDibber({ shortCode: short, longCode: long, owner: row.owner || '', lost: row.lost || '', notes: row.notes || '' }));
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
  await saveDibbers();
  showStatus('Dibbers list cleared.');
  renderDibbers();
}

export function wireDibbers() {
  on('btn-import-dibbers', 'click', importDibbersFromFile);
  on('btn-export-dibbers', 'click', exportDibbers);
  on('btn-add-dibber',     'click', showAddDibberRow);
  on('btn-clear-dibbers',  'click', clearDibbers);

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
    if (btn.dataset.action === 'edit') editDibberRow(idx);
    else if (btn.dataset.action === 'del') deleteDibbersFrom(idx);
  });
}