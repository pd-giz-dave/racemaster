'use strict';

import { state, saveRoles } from '../state.js';
import { on, escHtml, setHTML, showStatus, showConfirmDialog, updateDatalistRoles, downloadText, pickFile, sanitise } from '../ui.js';
import { formatCSV, parseCSV } from '../csv.js';

const BUILTIN_ROLES = [
  { role: 'HELPER',     description: 'General helper' },
  { role: 'RO',         description: 'Race Organiser' },
  { role: 'JUNIOR-RO',  description: 'Junior race organiser' },
  { role: 'DEPUTY-RO',  description: 'Deputy/assistant to race organiser' },
  { role: 'REG',        description: 'Registration' },
  { role: 'TIMING',     description: 'Clock timing' },
  { role: 'RESULTS',    description: 'Results recording and prize list generation' },
  { role: 'MARSHAL',    description: 'On-course marshal' },
  { role: 'FIRST-AIDER',description: 'First aider' },
  { role: 'RUNNER',     description: 'Finisher runner' },
  { role: 'RECORDER',   description: 'Finisher recorder' },
  { role: 'STARTER',    description: 'Race starter' },
  { role: 'FINISH',     description: 'Finish helper' },
  { role: 'PUBLISHER',  description: 'Results publisher' },
  { role: 'MARKER',     description: 'Course marking' },
  { role: 'PREP',       description: 'Race reg prep' },
  { role: 'CLEARER',    description: 'Course clearing' },
  { role: 'SWEEP',      description: '' },
];

export function renderRoles() {
  const tbody = document.getElementById('roles-tbody');
  if (!tbody) return;
  const sorted = [...state.roles]
    .map((r, i) => ({ ...r, _si: i }))
    .sort((a, b) => (a.role || '').localeCompare(b.role || ''));
  tbody.innerHTML = sorted.map(r => `
    <tr id="role-row-${r._si}">
      <td>${escHtml(r.role || '')}</td>
      <td>${escHtml(r.description || '')}</td>
      <td>
        <button class="btn-sm btn-edit"   data-idx="${r._si}">Edit</button>
        <button class="btn-sm btn-delete" data-idx="${r._si}">Del</button>
      </td>
    </tr>`).join('');
  setHTML('roles-count', `${sorted.length} roles`);
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editRoleRow(+b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete').forEach(b =>
    b.addEventListener('click', () => deleteRoleRow(+b.dataset.idx)));
}

function roleEditCells(prefix, r) {
  return `
    <td><input id="${prefix}-role"        type="text" value="${escHtml(r.role || '')}"        style="width:140px"></td>
    <td><input id="${prefix}-description" type="text" value="${escHtml(r.description || '')}" style="width:260px"></td>`;
}

function readRoleCells(prefix, r) {
  r.role        = document.getElementById(`${prefix}-role`)?.value.trim()        || r.role;
  r.description = document.getElementById(`${prefix}-description`)?.value.trim() || '';
}

function editRoleRow(idx) {
  const r = state.roles[idx];
  if (!r) return;
  const row = document.getElementById(`role-row-${idx}`);
  if (!row) return;
  const prefix = `role-${idx}`;
  row.innerHTML = `${roleEditCells(prefix, r)}
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => saveRoleRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderRoles());
  document.getElementById(`${prefix}-role`)?.focus();
}

async function saveRoleRow(idx) {
  const r = state.roles[idx];
  if (!r) return;
  readRoleCells(`role-${idx}`, r);
  await saveRoles();
  showStatus(`${r.role} updated.`);
  renderRoles();
  updateDatalistRoles();
}

function showAddRoleRow() {
  const tbody = document.getElementById('roles-tbody');
  if (!tbody || document.getElementById('role-row-new')) return;
  const tr = document.createElement('tr');
  tr.id = 'role-row-new';
  const prefix = 'role-new';
  tr.innerHTML = `${roleEditCells(prefix, {})}
    <td>
      <button class="btn-sm btn-save">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-save').addEventListener('click', saveNewRoleRow);
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  setTimeout(() => {
    const first = tr.querySelector('input');
    first?.scrollIntoView({ block: 'center' });
    first?.focus();
  }, 50);
}

async function saveNewRoleRow() {
  const prefix = 'role-new';
  const role = document.getElementById(`${prefix}-role`)?.value.trim();
  if (!role) { showStatus('Role name is required.', true); return; }
  const dup = state.roles.find(r => r.role.toLowerCase() === role.toLowerCase());
  if (dup) { showStatus(`Role "${dup.role}" already exists.`, true); return; }
  const r = {};
  readRoleCells(prefix, r);
  state.roles.push(r);
  await saveRoles();
  showStatus(`${r.role} added.`);
  renderRoles();
  updateDatalistRoles();
}

async function deleteRoleRow(idx) {
  const r = state.roles[idx];
  if (!r || !await showConfirmDialog(`Delete role "${r.role}"?`, 'Delete', true)) return;
  state.roles.splice(idx, 1);
  await saveRoles();
  showStatus(`${r.role} deleted.`);
  renderRoles();
  updateDatalistRoles();
}

function exportRoles() {
  downloadText(formatCSV(state.roles, ['role', 'description']),
    `${sanitise(state.event?.name || 'roles')}_roles.csv`);
}

async function importRoles() {
  const text = await pickFile('.csv');
  if (!text) return;
  const rows = parseCSV(text);
  if (!rows[0] || !('role' in rows[0])) { showStatus('Roles CSV missing required column: role', true); return; }
  let added = 0, updated = 0;
  for (const row of rows) {
    const role = (row.role || '').trim();
    if (!role) continue;
    const existing = state.roles.find(r => r.role.toLowerCase() === role.toLowerCase());
    if (existing) {
      existing.description = row.description || existing.description;
      updated++;
    } else {
      state.roles.push({ role, description: row.description || '' });
      added++;
    }
  }
  await saveRoles();
  updateDatalistRoles();
  showStatus(`Roles import: ${added} added, ${updated} updated.`);
  renderRoles();
}

async function clearRoles() {
  if (!await showConfirmDialog(`Clear all ${state.roles.length} roles?`, 'Clear All', true)) return;
  state.roles.length = 0;
  await saveRoles();
  updateDatalistRoles();
  showStatus('Roles list cleared.');
  renderRoles();
}

async function resetToBuiltin() {
  if (!await showConfirmDialog('Replace all current roles with the built-in defaults?', 'Replace', true)) return;
  state.roles = BUILTIN_ROLES.map(r => ({ ...r }));
  await saveRoles();
  showStatus('Roles reset to built-in defaults.');
  renderRoles();
  updateDatalistRoles();
}

export function wireRoles() {
  on('btn-add-role',     'click', showAddRoleRow);
  on('btn-export-roles', 'click', exportRoles);
  on('btn-import-roles', 'click', importRoles);
  on('btn-reset-roles',  'click', resetToBuiltin);
  on('btn-clear-roles',  'click', clearRoles);
}