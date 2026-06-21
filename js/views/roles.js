'use strict';

import { state, saveRoles } from '../state.js';
import { on, escHtml, setHTML, showStatus, showConfirmDialog, updateDatalistRoles, downloadText, pickFile, sanitise, renderTable } from '../ui.js';
import { TABLES } from '../locale.js';
import { formatCSV, parseCSV } from '../csv.js';
import { BUILTIN_ROLES } from '../roles.js';

const ROLE_COLS = (() => {
  const m = TABLES.roles;
  return [
    { ...m[0], render: r => escHtml(r.role || '') },
    { ...m[1], render: r => escHtml(r.description || '') },
    { ...m[2], render: () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-delete" data-action="del">Del</button>` },
  ];
})();


export function renderRoles() {
  const tbody = document.getElementById('roles-tbody');
  if (!tbody) return;
  const sorted = [...state.roles]
    .map((r, i) => ({ ...r, _si: i }))
    .sort((a, b) => (a.role || '').localeCompare(b.role || ''));
  renderTable('roles-tbody', ROLE_COLS, sorted, {
    rowAttrs: r => ({ id: `role-row-${r._si}`, 'data-idx': r._si }),
  });
  setHTML('roles-count', `${sorted.length} roles`);
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

  document.getElementById('roles-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = +btn.closest('[data-idx]')?.dataset.idx;
    if (btn.dataset.action === 'edit') editRoleRow(idx);
    else if (btn.dataset.action === 'del') deleteRoleRow(idx);
  });
}