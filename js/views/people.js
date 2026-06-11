'use strict';

import { state, savePeople } from '../state.js';
import { on, escHtml, showStatus, showConfirmDialog, setHTML, downloadText, pickFile, sanitise, updateDatalistClubs } from '../ui.js';
import { formatCSV, parseCSV } from '../csv.js';
import { toISODate, fromISODate } from '../utils.js';
import { isBanned } from '../entries.js';

let peopleFilter    = '';
let showBannedOnly  = false;

export function renderPeople() {
  const tbody = document.getElementById('people-tbody');
  if (!tbody) return;
  const filterEl = document.getElementById('people-filter');
  if (filterEl) filterEl.value = peopleFilter;
  const bannedEl = document.getElementById('people-show-banned');
  if (bannedEl) bannedEl.checked = showBannedOnly;
  const total = state.people.length;
  const low = peopleFilter.trim().toLowerCase();
  if (!low && !showBannedOnly) {
    tbody.innerHTML = '';
    setHTML('people-count', `${total} people`);
    return;
  }
  const visible = state.people.map((p, i) => ({ p, i })).filter(({ p }) => {
    if (showBannedOnly && !isBanned(p)) return false;
    if (!low) return true;
    return (p.name || '').toLowerCase().includes(low) ||
           (p.club || '').toLowerCase().includes(low);
  });
  tbody.innerHTML = visible.map(({ p, i }) => `
    <tr id="person-row-${i}"${isBanned(p) ? ' class="row-banned"' : ''}>
      <td>${escHtml(p.name || '') + (isBanned(p) ? ' (banned)' : '')}</td>
      <td>${p.gender || ''}</td>
      <td>${p.dob || ''}</td>
      <td>${escHtml(p.club || '')}</td>
      <td>${p.fraNumber || ''}</td>
      <td>${p.lastSeen || ''}</td>
      <td>${p.seenTotal || 0}</td>
      <td>${p.lastHelped || ''}</td>
      <td>${p.helpedTotal || 0}</td>
      <td>${p.banned || ''}</td>
      <td>
        <button class="btn-sm btn-edit"   data-idx="${i}">Edit</button>
        <button class="btn-sm btn-delete" data-idx="${i}">Del</button>
      </td>
    </tr>`).join('');
  setHTML('people-count', `${visible.length} of ${total} people`);
}

export function personEditCells(prefix, p) {
  return `
    <td><input id="${prefix}-name"        type="text"   value="${escHtml(p.name || '')}"           style="width:130px"></td>
    <td><select id="${prefix}-gender">
      <option value="M"${p.gender==='M'?' selected':''}>M</option>
      <option value="F"${p.gender==='F'?' selected':''}>F</option>
      <option value="P"${p.gender==='P'?' selected':''}>P</option>
    </select></td>
    <td><input id="${prefix}-dob"         type="date"   value="${toISODate(p.dob || '')}"></td>
    <td><input id="${prefix}-club"        type="text"   value="${escHtml(p.club || '')}"           style="width:110px" list="datalist-clubs" autocomplete="off"></td>
    <td><input id="${prefix}-fra"         type="text"   value="${escHtml(p.fraNumber || '')}"      style="width:70px"></td>
    <td><input id="${prefix}-lastseen"    type="date"   value="${toISODate(p.lastSeen || '')}"></td>
    <td><input id="${prefix}-count"       type="number" value="${p.seenTotal || 0}"                style="width:50px" min="0"></td>
    <td><input id="${prefix}-lasthelped"  type="date"   value="${toISODate(p.lastHelped || '')}"></td>
    <td><input id="${prefix}-helpedcount" type="number" value="${p.helpedTotal || 0}"              style="width:50px" min="0"></td>
    <td><input id="${prefix}-banned"      type="date"   value="${toISODate(p.banned || '')}"></td>`;
}

export function readPersonCells(prefix, p) {
  p.name        = document.getElementById(`${prefix}-name`)?.value.trim()                     || p.name;
  p.gender      = document.getElementById(`${prefix}-gender`)?.value                          || p.gender;
  p.dob         = fromISODate(document.getElementById(`${prefix}-dob`)?.value)                || p.dob;
  p.club        = document.getElementById(`${prefix}-club`)?.value.trim()                     || '';
  p.fraNumber   = document.getElementById(`${prefix}-fra`)?.value.trim()                      || '';
  p.lastSeen    = fromISODate(document.getElementById(`${prefix}-lastseen`)?.value)           || '';
  p.seenTotal   = parseInt(document.getElementById(`${prefix}-count`)?.value, 10)             || 0;
  p.lastHelped  = fromISODate(document.getElementById(`${prefix}-lasthelped`)?.value)         || '';
  p.helpedTotal = parseInt(document.getElementById(`${prefix}-helpedcount`)?.value, 10)       || 0;
  p.banned      = fromISODate(document.getElementById(`${prefix}-banned`)?.value)             || '';
}

export function editPersonRow(idx) {
  const p = state.people[idx];
  if (!p) return;
  const row = document.getElementById(`person-row-${idx}`);
  if (!row) return;
  updateDatalistClubs();
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


export async function deletePersonRow(idx) {
  const p = state.people[idx];
  if (!p || !await showConfirmDialog(`Delete ${p.name}?`, 'Delete', true)) return;
  state.people.splice(idx, 1);
  await savePeople();
  showStatus(`${p.name} deleted.`);
  renderPeople();
}

const PEOPLE_FIELDS = ['name','gender','dob','club','fraNumber','lastSeen','seenTotal','lastHelped','helpedTotal','banned'];

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
  banned:      ['banned',      'Banned Until', 'Banned'],
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
        banned:      row.banned      || existing.banned,
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
        banned:      row.banned      || '',
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
  on('btn-export-people', 'click', exportPeople);
  on('btn-import-people', 'click', importPeople);
  on('btn-clear-people',  'click', clearPeople);

  document.getElementById('people-filter')?.addEventListener('input', e => {
    peopleFilter = e.target.value;
    renderPeople();
  });

  document.getElementById('people-show-banned')?.addEventListener('change', e => {
    showBannedOnly = e.target.checked;
    renderPeople();
  });

  document.getElementById('people-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-idx]');
    if (!btn) return;
    const idx = +btn.dataset.idx;
    if (btn.classList.contains('btn-edit'))        editPersonRow(idx);
    else if (btn.classList.contains('btn-delete')) deletePersonRow(idx);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'f' && e.ctrlKey && !document.getElementById('view-people')?.hidden) {
      e.preventDefault();
      document.getElementById('people-filter')?.focus();
    }
  });

  document.getElementById('view-people')?.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const view = document.getElementById('view-people');
    const focusable = [...view.querySelectorAll(
      'input:not([disabled]), button:not([disabled])'
    )].filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
}