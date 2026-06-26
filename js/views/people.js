'use strict';

import { state, savePeople } from '../state.js';
import { createPerson } from '../schema.js';
import { CSV } from '../csv-schema.js';
import { on, escHtml, showStatus, showConfirmDialog, setHTML, downloadText, pickFile, sanitise, updateDatalistClubs, renderTable } from '../ui.js';
import { TABLES } from '../locale.js';
import { formatCSV, parseCSV } from '../csv.js';
import { toISODate, fromISODate, normaliseClub, findSimilarPairs } from '../utils.js';
import { isBanned } from '../entries.js';
import { laterDate, normalisePeopleRows } from '../data.js';
import { getSession, apiListDatasets, apiReadDataset } from '../storage.js';

const PEOPLE_COLS = (() => {
  const m = TABLES.people;
  return [
    { ...m[0],  render: ({ p }) => escHtml(p.name || '') + (isBanned(p) ? ' (banned)' : '') },
    { ...m[1],  render: ({ p }) => p.gender || '' },
    { ...m[2],  render: ({ p }) => p.dob || '' },
    { ...m[3],  render: ({ p }) => escHtml(p.club || '') },
    { ...m[4],  render: ({ p }) => p.fraNumber || '' },
    { ...m[5],  render: ({ p }) => p.lastSeen || '' },
    { ...m[6],  render: ({ p }) => p.seenTotal || 0 },
    { ...m[7],  render: ({ p }) => p.lastHelped || '' },
    { ...m[8],  render: ({ p }) => p.helpedTotal || 0 },
    { ...m[9],  render: ({ p }) => p.banned || '' },
    { ...m[10], render: () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-delete" data-action="del">Del</button>` },
  ];
})();

let peopleFilter    = '';
let showBannedOnly  = false;
let showAll         = false;

export function renderPeople() {
  const tbody = document.getElementById('people-tbody');
  if (!tbody) return;
  const filterEl = document.getElementById('people-filter');
  if (filterEl) filterEl.value = peopleFilter;
  const bannedEl = document.getElementById('people-show-banned');
  if (bannedEl) bannedEl.checked = showBannedOnly;
  const showAllBtn = document.getElementById('btn-show-all-people');
  if (showAllBtn) showAllBtn.classList.toggle('btn-active', showAll);
  const total = state.people.length;
  const low = peopleFilter.trim().toLowerCase();
  if (!low && !showBannedOnly && !showAll) {
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
  renderTable('people-tbody', PEOPLE_COLS, visible, {
    rowAttrs: ({ p, i }) => ({
      id: `person-row-${i}`,
      'data-idx': i,
      class: isBanned(p) ? 'row-banned' : '',
    }),
  });
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
  p.club        = normaliseClub(document.getElementById(`${prefix}-club`)?.value);
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

// ---- Duplicate finder ----

function findDuplicatePairs() {
  return findSimilarPairs(state.people, p => p.name);
}

function renderDupes(pairs) {
  const panel = document.getElementById('people-dupes-panel');
  if (!panel) return;
  setHTML('people-dupes-count', `${pairs.length} pair${pairs.length !== 1 ? 's' : ''} found`);
  const tbody = document.getElementById('people-dupes-tbody');
  if (!pairs.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted)">No potential duplicates found.</td></tr>';
    return;
  }
  tbody.innerHTML = pairs.map(({ a, b, exact }) => {
    const pa = state.people[a], pb = state.people[b];
    if (!pa || !pb) return '';
    return `<tr>
      <td class="dupe-a">${escHtml(pa.name)}</td><td class="dupe-a">${pa.dob || ''}</td><td class="dupe-a">${escHtml(pa.club || '')}</td><td class="dupe-a">${pa.lastSeen || ''}</td>
      <td style="text-align:center;color:var(--muted);font-size:1.1em">${exact ? '=' : '≈'}</td>
      <td class="dupe-b">${escHtml(pb.name)}</td><td class="dupe-b">${pb.dob || ''}</td><td class="dupe-b">${escHtml(pb.club || '')}</td><td class="dupe-b">${pb.lastSeen || ''}</td>
      <td style="white-space:nowrap">
        <button class="btn-dupe-a" data-keep="${a}" data-drop="${b}">Keep A</button>
        <button class="btn-dupe-b" data-keep="${b}" data-drop="${a}">Keep B</button>
      </td>
    </tr>`;
  }).join('');
}

async function mergePersonPair(keepIdx, dropIdx) {
  const keep = state.people[keepIdx];
  const drop = state.people[dropIdx];
  if (!keep || !drop) return;
  if (!await showConfirmDialog(
    `Merge "${drop.name}" (${drop.dob || 'no dob'}) into "${keep.name}" (${keep.dob || 'no dob'})?`,
    'Merge', true
  )) return;

  keep.gender      = keep.gender      || drop.gender;
  keep.club        = keep.club        || drop.club;
  keep.fraNumber   = keep.fraNumber   || drop.fraNumber;
  keep.lastSeen    = laterDate(keep.lastSeen,   drop.lastSeen);
  keep.seenTotal   = (keep.seenTotal  || 0) + (drop.seenTotal  || 0);
  keep.lastHelped  = laterDate(keep.lastHelped, drop.lastHelped);
  keep.helpedTotal = (keep.helpedTotal || 0) + (drop.helpedTotal || 0);
  keep.banned      = keep.banned || drop.banned;

  state.people.splice(dropIdx, 1);
  await savePeople();
  showStatus(`Merged "${drop.name}" into "${keep.name}".`);

  const pairs = findDuplicatePairs();
  if (pairs.length) {
    renderDupes(pairs);
  } else {
    document.getElementById('people-dupes-panel').hidden = true;
    document.getElementById('people-main-table').hidden = false;
  }
  renderPeople();
}

// ---- Import / Export / Merge ----

function exportPeople() {
  const csv = formatCSV(state.people, CSV.people.fields);
  downloadText(csv, `${sanitise(state.event?.name || 'people')}_people.csv`);
}

async function applyPeopleMerge(rows) {
  let added = 0, updated = 0;
  const originalPeople = state.people.slice();
  for (const row of rows) {
    const name = (row.name || '').trim();
    if (!name) continue;
    const existing = originalPeople.find(p =>
      p.name.toLowerCase() === name.toLowerCase() && (p.dob || '') === (row.dob || ''));
    if (existing) {
      const merged = {
        gender:      row.gender      || existing.gender,
        dob:         row.dob         || existing.dob,
        club:        row.club        || existing.club,
        fraNumber:   row.fraNumber   || existing.fraNumber,
        lastSeen:    row.lastSeen    || existing.lastSeen,
        seenTotal:   Math.max(+row.seenTotal  || 0, existing.seenTotal  || 0),
        lastHelped:  row.lastHelped  || existing.lastHelped,
        helpedTotal: Math.max(+row.helpedTotal || 0, existing.helpedTotal || 0),
        banned:      row.banned      || existing.banned,
      };
      const changed = Object.keys(merged).some(k => {
        const a = existing[k], b = merged[k];
        return typeof b === 'number' ? a !== b : (a || '').toLowerCase() !== (b || '').toLowerCase();
      });
      Object.assign(existing, merged);
      if (changed) updated++;
    } else {
      state.people.push(createPerson({
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
      }));
      added++;
    }
  }
  await savePeople();
  renderPeople();
  return { added, updated };
}

async function importPeople() {
  const text = await pickFile('.csv');
  if (!text) return;
  const rows = normalisePeopleRows(parseCSV(text));
  if (!rows) { showStatus('People CSV missing required columns: name, gender, dob (or Date of Birth)', true); return; }
  const { added, updated } = await applyPeopleMerge(rows);
  showStatus(`People import: ${added} added, ${updated} updated.`);
}

function setMergeStatus(msg, isError = false) {
  const el = document.getElementById('people-merge-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success,#1a6e3c)';
}

async function mergeFromFile() {
  const text = await pickFile('.json');
  if (!text) return;
  let data;
  try { data = JSON.parse(text); } catch { setMergeStatus('Not valid JSON.', true); return; }
  if (!Array.isArray(data?.people)) { setMergeStatus('JSON file has no people array.', true); return; }
  setMergeStatus('Merging…');
  const { added, updated } = await applyPeopleMerge(data.people);
  setMergeStatus(`Done: ${added} added, ${updated} updated.`);
}

async function mergeFromDataset(path) {
  const session = getSession();
  if (!session) { setMergeStatus('Not signed in.', true); return; }
  setMergeStatus('Fetching…');
  try {
    const [owner, fullName] = path.split('/');
    const data = await apiReadDataset(session.token, owner, fullName);
    if (!Array.isArray(data?.people)) { setMergeStatus('No people in that dataset.', true); return; }
    const { added, updated } = await applyPeopleMerge(data.people);
    setMergeStatus(`Done: ${added} added, ${updated} updated.`);
  } catch (e) {
    setMergeStatus('Error: ' + e.message, true);
  }
}

function openMergePanel() {
  const panel = document.getElementById('people-merge-panel');
  if (!panel) return;
  panel.hidden = false;
  setMergeStatus('');

  const session = getSession();
  const dsRow = document.getElementById('people-merge-ds-row');
  if (!dsRow) return;

  if (!session) {
    dsRow.hidden = true;
    return;
  }

  dsRow.hidden = false;
  const sel = document.getElementById('people-merge-ds-select');
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

  on('btn-show-all-people', 'click', () => {
    showAll = !showAll;
    if (showAll) { peopleFilter = ''; showBannedOnly = false; }
    renderPeople();
  });

  on('btn-find-dupes', 'click', () => {
    const panel = document.getElementById('people-dupes-panel');
    if (!panel) return;
    panel.hidden = false;
    document.getElementById('people-main-table').hidden = true;
    renderDupes(findDuplicatePairs());
  });
  on('btn-close-dupes', 'click', () => {
    document.getElementById('people-dupes-panel').hidden = true;
    document.getElementById('people-main-table').hidden = false;
  });
  document.getElementById('people-dupes-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-keep]');
    if (!btn) return;
    mergePersonPair(+btn.dataset.keep, +btn.dataset.drop);
  });

  on('btn-merge-people',    'click', openMergePanel);
  on('btn-cancel-merge',    'click', () => { document.getElementById('people-merge-panel').hidden = true; });
  on('btn-merge-from-file', 'click', mergeFromFile);
  on('btn-do-merge-ds', 'click', () => {
    const path = document.getElementById('people-merge-ds-select')?.value;
    if (!path) { setMergeStatus('Select a dataset first.', true); return; }
    mergeFromDataset(path);
  });

  document.getElementById('people-filter')?.addEventListener('input', e => {
    peopleFilter = e.target.value;
    showAll = false;
    renderPeople();
  });

  document.getElementById('people-show-banned')?.addEventListener('change', e => {
    showBannedOnly = e.target.checked;
    renderPeople();
  });

  document.getElementById('people-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = +btn.closest('[data-idx]')?.dataset.idx;
    if (btn.dataset.action === 'edit') editPersonRow(idx);
    else if (btn.dataset.action === 'del') deletePersonRow(idx);
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