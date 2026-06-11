'use strict';

import { state, savePeople } from '../state.js';
import { on, escHtml, showStatus, showConfirmDialog, setHTML, downloadText, pickFile, sanitise } from '../ui.js';
import { formatCSV, parseCSV } from '../csv.js';

export function renderPeople() {
  const tbody = document.getElementById('people-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.people.map((p, i) => `
    <tr id="person-row-${i}">
      <td>${escHtml(p.name || '')}</td>
      <td>${p.gender || ''}</td>
      <td>${p.dob || ''}</td>
      <td>${escHtml(p.club || '')}</td>
      <td>${p.fraNumber || ''}</td>
      <td>${p.lastSeen || ''}</td>
      <td>${p.seenTotal || 0}</td>
      <td>${p.lastHelped || ''}</td>
      <td>${p.helpedTotal || 0}</td>
      <td>
        <button class="btn-sm btn-edit"   data-idx="${i}">Edit</button>
        <button class="btn-sm btn-delete" data-idx="${i}">Del</button>
      </td>
    </tr>`).join('');
  setHTML('people-count', `${state.people.length} people`);
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editPersonRow(+b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete').forEach(b =>
    b.addEventListener('click', () => deletePersonRow(+b.dataset.idx)));
}

export function personEditCells(prefix, p) {
  return `
    <td><input id="${prefix}-name"     type="text" value="${escHtml(p.name || '')}"      style="width:130px"></td>
    <td><select id="${prefix}-gender">
      <option value="M"${p.gender==='M'?' selected':''}>M</option>
      <option value="F"${p.gender==='F'?' selected':''}>F</option>
      <option value="P"${p.gender==='P'?' selected':''}>P</option>
    </select></td>
    <td><input id="${prefix}-dob"      type="text" value="${escHtml(p.dob || '')}"        style="width:95px" data-normalise="date"></td>
    <td><input id="${prefix}-club"     type="text" value="${escHtml(p.club || '')}"       style="width:110px"></td>
    <td><input id="${prefix}-fra"      type="text" value="${escHtml(p.fraNumber || '')}"  style="width:70px"></td>
    <td><input id="${prefix}-lastseen"    type="text"   value="${escHtml(p.lastSeen || '')}"    style="width:75px" data-normalise="date"></td>
    <td><input id="${prefix}-count"       type="number" value="${p.seenTotal || 0}"            style="width:50px" min="0"></td>
    <td><input id="${prefix}-lasthelped"  type="text"   value="${escHtml(p.lastHelped || '')}" style="width:75px" data-normalise="date"></td>
    <td><input id="${prefix}-helpedcount" type="number" value="${p.helpedTotal || 0}"           style="width:50px" min="0"></td>`;
}

export function readPersonCells(prefix, p) {
  p.name      = document.getElementById(`${prefix}-name`)?.value.trim()     || p.name;
  p.gender    = document.getElementById(`${prefix}-gender`)?.value           || p.gender;
  p.dob       = document.getElementById(`${prefix}-dob`)?.value.trim()      || p.dob;
  p.club      = document.getElementById(`${prefix}-club`)?.value.trim()     || '';
  p.fraNumber = document.getElementById(`${prefix}-fra`)?.value.trim()      || '';
  p.lastSeen    = document.getElementById(`${prefix}-lastseen`)?.value.trim()    || '';
  p.seenTotal   = parseInt(document.getElementById(`${prefix}-count`)?.value, 10)        || 0;
  p.lastHelped  = document.getElementById(`${prefix}-lasthelped`)?.value.trim()  || '';
  p.helpedTotal = parseInt(document.getElementById(`${prefix}-helpedcount`)?.value, 10)  || 0;
}

export function editPersonRow(idx) {
  const p = state.people[idx];
  if (!p) return;
  const row = document.getElementById(`person-row-${idx}`);
  if (!row) return;
  const prefix = `per-${idx}`;
  row.innerHTML = `${personEditCells(prefix, p)}
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => savePersonRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderPeople());
  document.getElementById(`${prefix}-name`)?.focus();
}

export async function savePersonRow(idx) {
  const p = state.people[idx];
  if (!p) return;
  readPersonCells(`per-${idx}`, p);
  await savePeople();
  showStatus(`${p.name} updated.`);
  renderPeople();
}

export function showAddPersonRow() {
  const tbody = document.getElementById('people-tbody');
  if (!tbody || document.getElementById('person-row-new')) return;
  const tr = document.createElement('tr');
  tr.id = 'person-row-new';
  const prefix = 'per-new';
  tr.innerHTML = `${personEditCells(prefix, {})}
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-save').addEventListener('click', saveNewPersonRow);
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  setTimeout(() => {
    const first = tr.querySelector('input');
    first?.scrollIntoView({ block: 'center' });
    first?.focus();
  }, 50);
}

export async function saveNewPersonRow() {
  const prefix = 'per-new';
  const name = document.getElementById(`${prefix}-name`)?.value.trim();
  if (!name) { showStatus('Name is required.', true); return; }
  const dob = document.getElementById(`${prefix}-dob`)?.value.trim();
  const dup = state.people.find(p =>
    p.name.toLowerCase() === name.toLowerCase() && (p.dob || '') === (dob || ''));
  if (dup) { showStatus(`${name}${dob ? ' ('+dob+')' : ''} already exists.`, true); return; }
  const p = { seenTotal: 0, helpedTotal: 0 };
  readPersonCells(prefix, p);
  state.people.push(p);
  await savePeople();
  showStatus(`${p.name} added.`);
  renderPeople();
}

export async function deletePersonRow(idx) {
  const p = state.people[idx];
  if (!p || !await showConfirmDialog(`Delete ${p.name}?`, 'Delete', true)) return;
  state.people.splice(idx, 1);
  await savePeople();
  showStatus(`${p.name} deleted.`);
  renderPeople();
}

const PEOPLE_FIELDS = ['name','gender','dob','club','fraNumber','lastSeen','seenTotal','lastHelped','helpedTotal'];

function exportPeople() {
  const csv = formatCSV(state.people, PEOPLE_FIELDS);
  downloadText(csv, `${sanitise(state.event?.name || 'people')}_people.csv`);
}

const PEOPLE_COL_ALIASES = {
  name:        ['name', 'Name'],
  gender:      ['gender', 'Gender'],
  dob:         ['dob', 'Date of Birth', 'DOB'],
  club:        ['club', 'Club'],
  fraNumber:   ['fraNumber', 'FRA Number', 'FRANumber'],
  lastSeen:    ['lastSeen', 'Last Seen'],
  seenTotal:   ['seenTotal', 'Seen Total'],
  lastHelped:  ['lastHelped', 'Last Helped'],
  helpedTotal: ['helpedTotal', 'Helped Total'],
};

function normalisePeopleRows(rows) {
  if (!rows.length) return rows;
  const keys = Object.keys(rows[0]);
  const map = {};
  for (const [field, aliases] of Object.entries(PEOPLE_COL_ALIASES)) {
    const found = aliases.find(a => keys.includes(a));
    if (found) map[field] = found;
  }
  if (!map.name || !map.gender || !map.dob) return null;
  return rows.map(r => Object.fromEntries(
    Object.entries(map).map(([field, src]) => [field, r[src] ?? ''])
  ));
}

async function importPeople() {
  const text = await pickFile('.csv');
  if (!text) return;
  const rows = normalisePeopleRows(parseCSV(text));
  if (!rows) { showStatus('People CSV missing required columns: name, gender, dob (or Date of Birth)', true); return; }
  let added = 0, updated = 0;
  for (const row of rows) {
    const name = (row.name || '').trim();
    if (!name) continue;
    const existing = state.people.find(p =>
      p.name.toLowerCase() === name.toLowerCase() && (p.dob || '') === (row.dob || ''));
    if (existing) {
      Object.assign(existing, {
        gender:      row.gender      || existing.gender,
        dob:         row.dob         || existing.dob,
        club:        row.club        || existing.club,
        fraNumber:   row.fraNumber   || existing.fraNumber,
        lastSeen:    row.lastSeen    || existing.lastSeen,
        seenTotal:   +row.seenTotal  || existing.seenTotal,
        lastHelped:  row.lastHelped  || existing.lastHelped,
        helpedTotal: +row.helpedTotal || existing.helpedTotal,
      });
      updated++;
    } else {
      state.people.push({
        name,
        gender:      row.gender     || '',
        dob:         row.dob        || '',
        club:        row.club       || '',
        fraNumber:   row.fraNumber  || '',
        lastSeen:    row.lastSeen   || '',
        seenTotal:   +row.seenTotal  || 0,
        lastHelped:  row.lastHelped  || '',
        helpedTotal: +row.helpedTotal || 0,
      });
      added++;
    }
  }
  await savePeople();
  showStatus(`People import: ${added} added, ${updated} updated.`);
  renderPeople();
}

async function clearPeople() {
  if (!await showConfirmDialog(`Clear all ${state.people.length} people?`, 'Clear All', true)) return;
  state.people.length = 0;
  await savePeople();
  showStatus('People list cleared.');
  renderPeople();
}

export function wirePeople() {
  on('btn-add-person',    'click', showAddPersonRow);
  on('btn-export-people', 'click', exportPeople);
  on('btn-import-people', 'click', importPeople);
  on('btn-clear-people',  'click', clearPeople);
}