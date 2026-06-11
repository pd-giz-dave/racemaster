'use strict';

import { state, saveClubs } from '../state.js';
import { on, escHtml, setHTML, showStatus, showConfirmDialog, updateDatalistClubs, downloadText, pickFile, sanitise } from '../ui.js';
import { formatCSV, parseCSV } from '../csv.js';

export function renderClubs() {
  const tbody = document.getElementById('clubs-tbody');
  if (!tbody) return;
  const sorted = [...state.clubs]
    .map((c, i) => ({ ...c, _si: i }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  tbody.innerHTML = sorted.map(c => `
    <tr id="club-row-${c._si}">
      <td>${escHtml(c.name || '')}</td>
      <td>${c.lastSeen || ''}</td>
      <td>${c.seenTotal || 0}</td>
      <td>
        <button class="btn-sm btn-edit"   data-idx="${c._si}">Edit</button>
        <button class="btn-sm btn-delete" data-idx="${c._si}">Del</button>
      </td>
    </tr>`).join('');
  setHTML('clubs-count', `${sorted.length} clubs`);
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editClubRow(+b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete').forEach(b =>
    b.addEventListener('click', () => deleteClubRow(+b.dataset.idx)));
}

export function clubEditCells(prefix, c) {
  return `
    <td><input id="${prefix}-name"     type="text"   value="${escHtml(c.name || '')}"     style="width:180px"></td>
    <td><input id="${prefix}-lastseen" type="text"   value="${escHtml(c.lastSeen || '')}" style="width:75px"></td>
    <td><input id="${prefix}-count"    type="number" value="${c.seenTotal || 0}"           style="width:50px" min="0"></td>`;
}

export function readClubCells(prefix, c) {
  c.name      = document.getElementById(`${prefix}-name`)?.value.trim()     || c.name;
  c.lastSeen  = document.getElementById(`${prefix}-lastseen`)?.value.trim() || '';
  c.seenTotal = parseInt(document.getElementById(`${prefix}-count`)?.value, 10) || 0;
}

export function editClubRow(idx) {
  const c = state.clubs[idx];
  if (!c) return;
  const row = document.getElementById(`club-row-${idx}`);
  if (!row) return;
  const prefix = `club-${idx}`;
  row.innerHTML = `${clubEditCells(prefix, c)}
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => saveClubRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderClubs());
  document.getElementById(`${prefix}-name`)?.focus();
}

export async function saveClubRow(idx) {
  const c = state.clubs[idx];
  if (!c) return;
  readClubCells(`club-${idx}`, c);
  await saveClubs();
  showStatus(`${c.name} updated.`);
  renderClubs();
  updateDatalistClubs();
}

export function showAddClubRow() {
  const tbody = document.getElementById('clubs-tbody');
  if (!tbody || document.getElementById('club-row-new')) return;
  const tr = document.createElement('tr');
  tr.id = 'club-row-new';
  const prefix = 'club-new';
  tr.innerHTML = `${clubEditCells(prefix, {})}
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-save').addEventListener('click', saveNewClubRow);
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  setTimeout(() => {
    const first = tr.querySelector('input');
    first?.scrollIntoView({ block: 'center' });
    first?.focus();
  }, 50);
}

export async function saveNewClubRow() {
  const prefix = 'club-new';
  const name = document.getElementById(`${prefix}-name`)?.value.trim();
  if (!name) { showStatus('Club name is required.', true); return; }
  const dup = state.clubs.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (dup) { showStatus(`Club "${dup.name}" already exists.`, true); return; }
  const c = { seenTotal: 0 };
  readClubCells(prefix, c);
  state.clubs.push(c);
  await saveClubs();
  showStatus(`${c.name} added.`);
  renderClubs();
  updateDatalistClubs();
}

export async function deleteClubRow(idx) {
  const c = state.clubs[idx];
  if (!c || !await showConfirmDialog(`Delete club "${c.name}"?`, 'Delete', true)) return;
  state.clubs.splice(idx, 1);
  await saveClubs();
  showStatus(`${c.name} deleted.`);
  renderClubs();
  updateDatalistClubs();
}

const CLUBS_FIELDS = ['name', 'lastSeen', 'seenTotal'];

function exportClubs() {
  const csv = formatCSV(state.clubs, CLUBS_FIELDS);
  downloadText(csv, `${sanitise(state.event?.name || 'clubs')}_clubs.csv`);
}

function normaliseClubRows(rows) {
  if (!rows.length) return rows;
  const keys = Object.keys(rows[0]);
  const nameKey     = ['name', 'Club'].find(k => keys.includes(k));
  const lastSeenKey = ['lastSeen', 'Last Seen'].find(k => keys.includes(k));
  const seenTotalKey = ['seenTotal', 'Seen Total'].find(k => keys.includes(k));
  if (!nameKey) return null;
  return rows.map(r => ({
    name:      r[nameKey]      || '',
    lastSeen:  lastSeenKey  ? r[lastSeenKey]  : '',
    seenTotal: seenTotalKey ? r[seenTotalKey] : 0,
  }));
}

async function importClubs() {
  const text = await pickFile('.csv');
  if (!text) return;
  const raw = parseCSV(text);
  const rows = normaliseClubRows(raw);
  if (!rows) { showStatus('Clubs CSV missing required column: name (or Club)', true); return; }
  let added = 0, updated = 0;
  for (const row of rows) {
    const name = (row.name || '').trim();
    if (!name) continue;
    const existing = state.clubs.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.lastSeen  = row.lastSeen  || existing.lastSeen;
      existing.seenTotal = +row.seenTotal || existing.seenTotal;
      updated++;
    } else {
      state.clubs.push({ name, lastSeen: row.lastSeen || '', seenTotal: +row.seenTotal || 0 });
      added++;
    }
  }
  await saveClubs();
  updateDatalistClubs();
  showStatus(`Clubs import: ${added} added, ${updated} updated.`);
  renderClubs();
}

async function clearClubs() {
  if (!await showConfirmDialog(`Clear all ${state.clubs.length} clubs?`, 'Clear All', true)) return;
  state.clubs.length = 0;
  await saveClubs();
  updateDatalistClubs();
  showStatus('Clubs list cleared.');
  renderClubs();
}

export function wireClubs() {
  on('btn-add-club',    'click', showAddClubRow);
  on('btn-export-clubs','click', exportClubs);
  on('btn-import-clubs','click', importClubs);
  on('btn-clear-clubs', 'click', clearClubs);
}