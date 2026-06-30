'use strict';

import { state, saveRoles } from '../state.js';
import { createRole } from '../schema.js';
import { submitHelper, updateHelper, deleteHelper, getHelper, getSortedHelpers, clearAllHelpers, getNextHelperNumber } from '../helpers.js';
import {
  val, on, setHTML, showConfirmDialog, showStatus, clearForm, fillForm, escHtml,
  updateDatalistClubs, updateDatalistRoles, wireFormFocusTrap, clearRowEditing, wireNameTypeahead, wireClubTypeahead, wireRoleTypeahead,
  renderTable, tableColumns,
} from '../ui.js';
import { TABLES } from '../strings.js';
import { capitalise, ciEq, showBusy, normaliseClub, normaliseGender } from '../utils.js';
import { isBanned } from '../entries.js';

const HELPER_COLS = tableColumns(TABLES.helpers, {
  number:  h => h.number,
  name:    h => escHtml(h.name || '') + (isBanned(state.people.find(p => ciEq(p.name, h.name || ''))) ? ' (banned)' : ''),
  club:    h => escHtml(h.club || ''),
  role:    h => escHtml(h.role || ''),
  actions: () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-delete" data-action="del">Del</button>`,
});

// ---- Module state ----

export let editingNumber = 0;

// ---- Render ----

export function renderHelpers() {
  const helpers = getSortedHelpers();
  renderTable('helpers-tbody', HELPER_COLS, helpers, {
    rowAttrs: h => ({ 'data-num': h.number }),
  });
  setHTML('helper-count-display', `${helpers.length} helpers`);
  updateDatalistClubs();
  updateDatalistRoles();
  if (editingNumber > 0) {
    document.querySelector(`#helpers-tbody tr[data-num="${editingNumber}"]`)?.classList.add('row-editing');
  }
}

// ---- Form helpers ----

function fillFormForEdit(num) {
  const h = getHelper(num);
  if (!h) return;
  editingNumber = num;
  setHTML('helper-form-number', `#${num}`);
  fillForm('', {
    'helper-form-name':      h.name   || '',
    'helper-form-gender':    h.gender || '',
    'helper-form-dob':       h.dob    || '',
    'helper-form-club':      h.club   || '',
    'helper-form-role':      h.role   || '',
    'helper-form-role-desc': state.roles.find(r => r.role === h.role)?.description || '',
  });
  document.getElementById('btn-submit-helper').textContent = 'Update';
  document.getElementById('btn-cancel-helper-edit').style.display = '';
  document.getElementById('helper-form-name')?.focus();
  const editRow = document.querySelector(`#helpers-tbody tr[data-num="${num}"]`);
  editRow?.classList.add('row-editing');
  editRow?.scrollIntoView({ block: 'nearest' });
}

function resetHelperForm() {
  editingNumber = 0;
  clearRowEditing('helpers-tbody');
  clearForm('helper-form-fields');
  setHTML('helper-form-number', `#${getNextHelperNumber()}`);
  document.getElementById('btn-submit-helper').textContent = 'Add Helper';
  document.getElementById('btn-cancel-helper-edit').style.display = 'none';
}

// ---- Submit ----

export async function submitHelperForm() {
  const isEdit = editingNumber > 0;

  const name = val('helper-form-name').trim();
  if (!name) {
    showStatus('Please enter a name.', true);
    document.getElementById('helper-form-name')?.focus();
    return;
  }

  const role     = val('helper-form-role').trim();
  if (!role) {
    showStatus('Please enter a role.', true);
    document.getElementById('helper-form-role')?.focus();
    return;
  }

  const knownRole = state.roles.find(r => r.role.toLowerCase() === role.toLowerCase());
  const canonicalRole = knownRole ? knownRole.role : role;

  const roleDesc = val('helper-form-role-desc').trim();
  if (!knownRole && !roleDesc) {
    showStatus('Please enter a description for the new role.', true);
    document.getElementById('helper-form-role-desc')?.focus();
    return;
  }

  // Auto-add new role if not already in roles table
  if (!isEdit && !knownRole) {
    state.roles.push(createRole({ role: canonicalRole, description: roleDesc }));
    await saveRoles();
    updateDatalistRoles();
  }

  const formData = {
    name:   val('helper-form-name'),
    gender: val('helper-form-gender'),
    dob:    val('helper-form-dob'),
    club:   normaliseClub(val('helper-form-club')),
    role:   canonicalRole,
  };

  showBusy(isEdit ? 'Updating…' : 'Adding helper…');
  const result = isEdit
    ? await updateHelper(editingNumber, formData)
    : await submitHelper(formData);
  showBusy('');

  if (result.error) {
    showStatus(result.error, true);
    document.getElementById('helper-form-name')?.focus();
  } else {
    const num = isEdit ? editingNumber : result.number;
    showStatus(isEdit ? `Helper ${num} updated.` : `Helper ${num} added.`);
    resetHelperForm();
    renderHelpers();
    document.querySelector(`#helpers-tbody tr[data-num="${num}"]`)?.scrollIntoView({ block: 'nearest' });
    document.getElementById('helper-form-name')?.focus();
  }
}

// ---- Delete ----

export async function confirmDeleteHelper(num) {
  if (!await showConfirmDialog(`Delete helper ${num}?`, 'Delete', true)) return;
  const result = await deleteHelper(num);
  if (result.error) { showStatus(result.error, true); return; }
  showStatus(`Helper ${num} deleted.`);
  renderHelpers();
  document.getElementById('helper-form-name')?.focus();
}

// ---- Wire ----

export function wireHelpers() {
  on('btn-submit-helper',      'click', submitHelperForm);
  on('btn-cancel-helper-edit', 'click', () => { resetHelperForm(); document.getElementById('helper-form-name')?.focus(); });
  on('btn-reset-helper',       'click', () => { resetHelperForm(); document.getElementById('helper-form-name')?.focus(); });

  on('btn-clear-all-helpers', 'click', async () => {
    const n = getSortedHelpers().length;
    if (!n) return;
    if (!await showConfirmDialog(`Clear all ${n} helpers? This cannot be undone.`, 'Clear All', true)) return;
    if (!await showConfirmDialog(`Delete all ${n} helpers permanently?`, 'Yes, delete all', true, true)) return;
    await clearAllHelpers();
    resetHelperForm();
    renderHelpers();
    showStatus('All helpers cleared.');
  });

  // ---- Name typeahead against people database ----
  const helperFields = { 'helper-form-gender': '', 'helper-form-dob': '', 'helper-form-club': '' };
  const fillHelperFromPerson = p => fillForm('', {
    'helper-form-gender': normaliseGender(p.gender),
    'helper-form-dob':    p.dob  || '',
    'helper-form-club':   p.club || '',
  });
  wireNameTypeahead(document.getElementById('helper-form-name'), {
    onSelect:  fillHelperFromPerson,
    onClear:   () => fillForm('', helperFields),
  });

  // Auto-capitalise name and club fields
  for (const id of ['helper-form-name', 'helper-form-club']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input', () => {
      const s = el.selectionStart, e = el.selectionEnd;
      el.value = capitalise(el.value);
      el.setSelectionRange(s, e);
    });
  }

  wireClubTypeahead(document.getElementById('helper-form-club'));

  const roleDescEl = document.getElementById('helper-form-role-desc');
  wireRoleTypeahead(document.getElementById('helper-form-role'), {
    onSelect: r => { if (roleDescEl) roleDescEl.value = r.description || ''; },
  });

  if (roleDescEl) {
    roleDescEl.addEventListener('change', async () => {
      const roleName = document.getElementById('helper-form-role')?.value.trim();
      const desc = roleDescEl.value.trim();
      if (!roleName) return;
      const found = state.roles.find(r => r.role.toLowerCase() === roleName.toLowerCase());
      if (found && found.description !== desc) {
        found.description = desc;
        await saveRoles();
        updateDatalistRoles();
      }
    });
  }

  // Set initial form defaults
  resetHelperForm();

  // ---- Enter submits, Tab wraps within the form ----
  wireFormFocusTrap('helper-form-fields', submitHelperForm);

  document.getElementById('helpers-tbody')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const num = +btn.closest('[data-num]')?.dataset.num;
    if (btn.dataset.action === 'edit') {
      if (!await showConfirmDialog(`Edit helper ${num}?`, 'Edit')) return;
      fillFormForEdit(num);
    } else if (btn.dataset.action === 'del') {
      confirmDeleteHelper(num);
    }
  });
}