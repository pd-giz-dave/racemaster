'use strict';

import { state, savePeople } from '../state.js';
import { escHtml, setHTML, showStatus, showConfirmDialog, updateDatalistClubs } from '../ui.js';
import { isBanned } from '../entries.js';
import { personEditCells, readPersonCells } from './people.js';
import { findSimilarPairs } from '../utils.js';

const selectedClubs = new Set();

function getClubs() {
  const map = new Map();
  for (const p of state.people) {
    const club = (p.club || '').trim();
    const entry = map.get(club) || { count: 0, lastSeen: '' };
    entry.count++;
    if (p.lastSeen && p.lastSeen > entry.lastSeen) entry.lastSeen = p.lastSeen;
    map.set(club, entry);
  }
  const named = [...map.entries()].filter(([n]) => n).sort((a, b) => a[0].localeCompare(b[0]));
  const blank = map.has('') ? [['', map.get('')]] : [];
  return [...blank, ...named];
}

export function renderClubs() {
  const tbody = document.getElementById('clubs-tbody');
  if (!tbody) return;
  const clubs = getClubs();
  tbody.innerHTML = clubs.map(([name, d]) => `
    <tr>
      <td><input type="checkbox" data-club="${escHtml(name)}"${selectedClubs.has(name) ? ' checked' : ''}></td>
      <td>${name ? escHtml(name) : '<em style="color:var(--muted)">(no club)</em>'}</td>
      <td>${d.count}</td>
      <td>${d.lastSeen || ''}</td>
    </tr>`).join('');
  setHTML('clubs-count', `${clubs.length} clubs`);
}

function renderClubMembers() {
  const tbody = document.getElementById('club-members-tbody');
  if (!tbody) return;
  if (!selectedClubs.size) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--muted)">Select clubs in the Clubs tab to view their members.</td></tr>';
    setHTML('clubs-members-count', '');
    return;
  }
  const visible = state.people.map((p, i) => ({ p, i }))
    .filter(({ p }) => selectedClubs.has((p.club || '').trim()));
  tbody.innerHTML = visible.map(({ p, i }) => `
    <tr id="club-member-row-${i}"${isBanned(p) ? ' class="row-banned"' : ''}>
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
  setHTML('clubs-members-count', `${visible.length} member${visible.length !== 1 ? 's' : ''}`);
}

function editClubMemberRow(idx) {
  const p = state.people[idx];
  if (!p) return;
  const row = document.getElementById(`club-member-row-${idx}`);
  if (!row) return;
  updateDatalistClubs();
  const prefix = `per-${idx}`;
  row.innerHTML = `${personEditCells(prefix, p)}
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => saveClubMemberRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', renderClubMembers);
  document.getElementById(`${prefix}-name`)?.focus();
}

async function saveClubMemberRow(idx) {
  const p = state.people[idx];
  if (!p) return;
  readPersonCells(`per-${idx}`, p);
  await savePeople();
  showStatus(`${p.name} updated.`);
  renderClubMembers();
}

async function deleteClubMemberRow(idx) {
  const p = state.people[idx];
  if (!p || !await showConfirmDialog(`Delete ${p.name}?`, 'Delete', true)) return;
  state.people.splice(idx, 1);
  await savePeople();
  showStatus(`${p.name} deleted.`);
  renderClubMembers();
}

function findDuplicateClubPairs() {
  const clubs = getClubs().filter(([n]) => n);
  return findSimilarPairs(clubs, ([name]) => name)
    .map(({ a, b, exact }) => ({ a: clubs[a], b: clubs[b], exact }));
}

function renderClubDupes(pairs) {
  setHTML('clubs-dupes-count', `${pairs.length} pair${pairs.length !== 1 ? 's' : ''} found`);
  const tbody = document.getElementById('clubs-dupes-tbody');
  if (!pairs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No potential duplicate clubs found.</td></tr>';
    return;
  }
  tbody.innerHTML = pairs.map(({ a, b, exact }) => `
    <tr>
      <td class="dupe-a">${escHtml(a[0])}</td><td class="dupe-a">${a[1].count}</td>
      <td style="text-align:center;color:var(--muted);font-size:1.1em">${exact ? '=' : '≈'}</td>
      <td class="dupe-b">${escHtml(b[0])}</td><td class="dupe-b">${b[1].count}</td>
      <td style="white-space:nowrap">
        <button class="btn-dupe-a" data-keep="${escHtml(a[0])}" data-drop="${escHtml(b[0])}">Keep A</button>
        <button class="btn-dupe-b" data-keep="${escHtml(b[0])}" data-drop="${escHtml(a[0])}">Keep B</button>
      </td>
    </tr>`).join('');
}

async function mergeClubPair(keepName, dropName) {
  if (!await showConfirmDialog(
    `Merge "${dropName}" into "${keepName}"?`, 'Merge', true
  )) return;
  let count = 0;
  for (const p of state.people) {
    if ((p.club || '').trim() === dropName) { p.club = keepName; count++; }
  }
  await savePeople();
  updateDatalistClubs();
  showStatus(`Merged "${dropName}" into "${keepName}" (${count} people updated).`);
  const pairs = findDuplicateClubPairs();
  if (pairs.length) {
    renderClubDupes(pairs);
  } else {
    document.getElementById('clubs-dupes-panel').hidden = true;
    document.getElementById('clubs-main-table').hidden = false;
  }
  renderClubs();
}

function setClubsMergeStatus(msg, isError = false) {
  const el = document.getElementById('clubs-merge-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success,#1a6e3c)';
}

function openClubsMergePanel() {
  if (!selectedClubs.size) {
    setClubsMergeStatus('Select at least one club first.', true);
    return;
  }
  const panel = document.getElementById('clubs-merge-panel');
  if (panel) panel.hidden = false;
  setClubsMergeStatus('');

  const datalist = document.getElementById('clubs-merge-datalist');
  if (datalist) {
    datalist.innerHTML = getClubs()
      .map(([name]) => name ? `<option value="${escHtml(name)}">` : `<option value="">(no club)</option>`)
      .join('');
  }

  const input = document.getElementById('clubs-merge-name');
  if (input) { input.value = ''; input.focus(); }
}

async function doMergeClubs() {
  const newName = document.getElementById('clubs-merge-name')?.value.trim();
  if (!selectedClubs.size) { setClubsMergeStatus('No clubs selected.', true); return; }

  const mergedFrom = selectedClubs.size;
  const fromList = [...selectedClubs].map(n => n || '(no club)').join(', ');
  if (!await showConfirmDialog(`Merge ${mergedFrom} club${mergedFrom !== 1 ? 's' : ''} (${fromList}) into "${newName}"?`, 'Merge', true)) return;
  let peopleUpdated = 0;
  for (const p of state.people) {
    if (selectedClubs.has((p.club || '').trim())) {
      p.club = newName;
      peopleUpdated++;
    }
  }

  selectedClubs.clear();
  await savePeople();
  updateDatalistClubs();

  document.getElementById('clubs-merge-panel').hidden = true;
  renderClubs();
  showStatus(`Merged ${mergedFrom} club${mergedFrom !== 1 ? 's' : ''} into "${newName}" (${peopleUpdated} people updated).`);
}

export function wireClubs() {
  document.getElementById('clubs-tab-bar')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-clubs-tab]');
    if (!btn) return;
    const tab = btn.dataset.clubsTab;
    document.querySelectorAll('#clubs-tab-bar button').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('clubs-tab-clubs')?.classList.toggle('active', tab === 'clubs');
    document.getElementById('clubs-tab-members')?.classList.toggle('active', tab === 'members');
    if (tab === 'members') renderClubMembers();
  });

  document.getElementById('btn-find-dupe-clubs')?.addEventListener('click', () => {
    document.getElementById('clubs-dupes-panel').hidden = false;
    document.getElementById('clubs-main-table').hidden = true;
    renderClubDupes(findDuplicateClubPairs());
  });
  document.getElementById('btn-close-dupe-clubs')?.addEventListener('click', () => {
    document.getElementById('clubs-dupes-panel').hidden = true;
    document.getElementById('clubs-main-table').hidden = false;
  });
  document.getElementById('clubs-dupes-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-keep]');
    if (!btn) return;
    mergeClubPair(btn.dataset.keep, btn.dataset.drop);
  });

  document.getElementById('btn-merge-clubs')?.addEventListener('click', openClubsMergePanel);
  document.getElementById('btn-do-merge-clubs')?.addEventListener('click', doMergeClubs);
  document.getElementById('btn-cancel-merge-clubs')?.addEventListener('click', () => {
    document.getElementById('clubs-merge-panel').hidden = true;
  });
  document.getElementById('clubs-merge-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doMergeClubs();
  });

  document.getElementById('clubs-tbody')?.addEventListener('change', e => {
    const cb = e.target.closest('input[type="checkbox"][data-club]');
    if (!cb) return;
    if (cb.checked) selectedClubs.add(cb.dataset.club);
    else selectedClubs.delete(cb.dataset.club);
  });

  document.getElementById('club-members-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-idx]');
    if (!btn) return;
    const idx = +btn.dataset.idx;
    if (btn.classList.contains('btn-edit'))        editClubMemberRow(idx);
    else if (btn.classList.contains('btn-delete')) deleteClubMemberRow(idx);
  });
}