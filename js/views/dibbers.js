'use strict';

import { state, saveDibbers } from '../state.js';
import { on, escHtml, setHTML, showStatus, showConfirmDialog, pickFile } from '../ui.js';

export function renderDibbers() {
  const tbody = document.getElementById('dibbers-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.dibbers.map((d, i) => `
    <tr id="dibber-row-${i}">
      <td>${d.shortCode || ''}</td>
      <td>${d.longCode  || ''}</td>
      <td>${d.availability || ''}</td>
      <td>${escHtml(d.notes || '')}</td>
      <td>
        <button class="btn-sm btn-edit"         data-idx="${i}">Edit</button>
        <button class="btn-sm btn-delete-entry" data-idx="${i}">Del from here</button>
      </td>
    </tr>`).join('');
  setHTML('dibbers-count', `${state.dibbers.length} dibbers`);
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editDibberRow(+b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => deleteDibbersFrom(+b.dataset.idx)));
}

export function editDibberRow(idx) {
  const d = state.dibbers[idx];
  if (!d) return;
  const row = document.getElementById(`dibber-row-${idx}`);
  if (!row) return;
  row.innerHTML = `
    <td>${d.shortCode || ''}</td>
    <td><input id="dib-long-${idx}"  type="text" value="${escHtml(String(d.longCode || ''))}"    style="width:90px"></td>
    <td><input id="dib-avail-${idx}" type="text" value="${escHtml(d.availability || '')}"        style="width:80px"></td>
    <td><input id="dib-notes-${idx}" type="text" value="${escHtml(d.notes || '')}"               style="width:160px"></td>
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
  d.availability = document.getElementById(`dib-avail-${idx}`)?.value.trim() || '';
  d.notes        = document.getElementById(`dib-notes-${idx}`)?.value.trim() || '';
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
  state.dibbers.push({ shortCode: +short, longCode: +long, availability: avail, notes });
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
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) { showStatus('Empty file.', true); return; }
  const dataLines = lines[0].toLowerCase().includes('number') ? lines.slice(1) : lines;
  let added = 0, updated = 0;
  for (const line of dataLines) {
    const [short, long] = line.split(',').map(s => s.trim());
    if (!short || !long || isNaN(+short) || isNaN(+long)) continue;
    const existing = state.dibbers.findIndex(d => +d.shortCode === +short);
    if (existing >= 0) {
      state.dibbers[existing].longCode = +long;
      updated++;
    } else {
      state.dibbers.push({ shortCode: +short, longCode: +long, availability: '', notes: '' });
      added++;
    }
  }
  if (!added && !updated) { showStatus('No valid dibber rows found.', true); return; }
  state.dibbers.sort((a, b) => +a.shortCode - +b.shortCode);
  await saveDibbers();
  showStatus(`Dibbers: ${added} added, ${updated} updated.`);
  renderDibbers();
}

export function wireDibbers() {
  on('btn-import-dibbers', 'click', importDibbersFromFile);
  on('btn-add-dibber',     'click', showAddDibberRow);
}