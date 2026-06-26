'use strict';

import { state, saveDibbers } from '../state.js';
import { createDibber } from '../schema.js';
import { CSV } from '../csv-schema.js';
import { normaliseDibberRows } from '../data.js';
import { on, escHtml, setHTML, showStatus, showConfirmDialog, pickFile, downloadText, sanitise, renderTable } from '../ui.js';
import { TABLES } from '../locale.js';
import { parseCSV } from '../csv.js';

const DIBBER_COLS = (() => {
  const m = TABLES.dibbers;
  return [
    { ...m[0], render: ({ d }) => d.shortCode || '' },
    { ...m[1], render: ({ d }) => d.longCode  || '' },
    { ...m[2], render: ({ d }) => d.owner || '' },
    { ...m[3], render: ({ d }) => d.lost ? `<span style="color:var(--danger)">${escHtml(d.lost)}</span>` : '' },
    { ...m[4], render: ({ d }) => escHtml(d.notes || '') },
    { ...m[5], render: () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-delete-entry" data-action="del">Del from here</button>` },
  ];
})();

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

  document.getElementById('dibbers-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = +btn.closest('[data-idx]')?.dataset.idx;
    if (btn.dataset.action === 'edit') editDibberRow(idx);
    else if (btn.dataset.action === 'del') deleteDibbersFrom(idx);
  });
}