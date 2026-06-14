'use strict';

import { state, saveRoles } from '../state.js';
import { submitHelper, updateHelper, deleteHelper, getHelper, getSortedHelpers, clearAllHelpers, getNextHelperNumber } from '../helpers.js';
import {
  val, on, setHTML, showConfirmDialog, showStatus, clearForm, fillForm, escHtml,
  updateDatalistClubs, updateDatalistRoles,
} from '../ui.js';
import { capitalise, iequal, showBusy } from '../utils.js';
import { isBanned } from '../entries.js';

// ---- Module state ----

export let editingNumber = 0;

// ---- Render ----

export function renderHelpers() {
  const helpers = getSortedHelpers();
  const tbody = document.getElementById('helpers-tbody');
  if (!tbody) return;
  tbody.innerHTML = helpers.map(h => `
    <tr data-num="${h.number}">
      <td>${h.number}</td>
      <td>${(h.name || '') + (isBanned(state.people.find(p => iequal(p.name, h.name || ''))) ? ' (banned)' : '')}</td>
      <td>${h.club || ''}</td>
      <td>${h.role || ''}</td>
      <td>
        <button class="btn-sm btn-edit btn-edit-helper"  data-num="${h.number}">Edit</button>
        <button class="btn-sm btn-delete btn-del-helper" data-num="${h.number}">Del</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit-helper').forEach(b =>
    b.addEventListener('click', async () => {
      if (!await showConfirmDialog(`Edit helper ${b.dataset.num}?`, 'Edit')) return;
      fillFormForEdit(+b.dataset.num);
    }));
  tbody.querySelectorAll('.btn-del-helper').forEach(b =>
    b.addEventListener('click', () => confirmDeleteHelper(+b.dataset.num)));
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
  document.querySelectorAll('#helpers-tbody .row-editing')
    .forEach(r => r.classList.remove('row-editing'));
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
    state.roles.push({ role: canonicalRole, description: roleDesc });
    await saveRoles();
    updateDatalistRoles();
  }

  const formData = {
    name:   val('helper-form-name'),
    gender: val('helper-form-gender'),
    dob:    val('helper-form-dob'),
    club:   val('helper-form-club'),
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
  const nameEl = document.getElementById('helper-form-name');
  if (nameEl) {
    const dropdown = document.createElement('ul');
    dropdown.className = 'name-typeahead';
    dropdown.hidden = true;
    const nameWrapper = nameEl.closest('.form-field');
    nameWrapper.style.position = 'relative';
    nameWrapper.appendChild(dropdown);

    let currentMatches = [];
    let deletingText   = false;

    const normGender = g => {
      const u = (g || '').toUpperCase().trim();
      return u === 'M' || u === 'MALE' ? 'M' : u === 'F' || u === 'FEMALE' ? 'F' : '';
    };

    const fillFromPerson = p => {
      fillForm('', {
        'helper-form-gender': normGender(p.gender),
        'helper-form-dob':    p.dob  || '',
        'helper-form-club':   p.club || '',
      });
    };

    const closeDropdown = () => { dropdown.hidden = true; dropdown.innerHTML = ''; };

    const showDropdown = () => {
      if (currentMatches.length < 2) { closeDropdown(); return; }
      dropdown.innerHTML = currentMatches.map((p, i) => {
        const detail = [p.dob, p.club].filter(Boolean).join(' – ');
        return `<li data-i="${i}" tabindex="-1">${escHtml(p.name)}${detail ? ` <span class="text-muted text-sm">(${escHtml(detail)})</span>` : ''}</li>`;
      }).join('');
      dropdown.hidden = false;
      dropdown.querySelectorAll('li').forEach(li =>
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          const p = currentMatches[+li.dataset.i];
          nameEl.value = p.name;
          fillFromPerson(p);
          closeDropdown();
        })
      );
    };

    nameEl.addEventListener('input', () => {
      const raw   = nameEl.value;
      const typed = raw.trim();
      if (!typed) {
        currentMatches = [];
        deletingText   = false;
        closeDropdown();
        fillForm('', { 'helper-form-gender': '', 'helper-form-dob': '', 'helper-form-club': '' });
        return;
      }
      const hasTrailingSpace = raw.endsWith(' ');
      const low = typed.toLowerCase();
      currentMatches = state.people.filter(p => (p.name || '').toLowerCase().startsWith(low));
      if (currentMatches.length === 1 && !deletingText && !hasTrailingSpace && typed.length < currentMatches[0].name.length) {
        const s = nameEl.selectionStart;
        nameEl.value = currentMatches[0].name;
        nameEl.setSelectionRange(s, currentMatches[0].name.length);
        fillFromPerson(currentMatches[0]);
      } else if (currentMatches.length === 1 && !hasTrailingSpace) {
        fillFromPerson(currentMatches[0]);
      } else if (!currentMatches.length) {
        fillForm('', { 'helper-form-gender': '', 'helper-form-dob': '', 'helper-form-club': '' });
      }
      deletingText = false;
      showDropdown();
    });

    nameEl.addEventListener('keydown', e => {
      deletingText = (e.key === 'Backspace' || e.key === 'Delete');
      if (e.key === 'ArrowDown' && currentMatches.length > 1) {
        e.preventDefault();
        showDropdown();
        dropdown.querySelector('li')?.focus();
      }
    });

    dropdown.addEventListener('keydown', e => {
      const items = [...dropdown.querySelectorAll('li')];
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx > 0 ? items[idx - 1].focus() : nameEl.focus(); }
      else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault(); e.stopPropagation();
        const p = currentMatches[idx];
        nameEl.value = p.name;
        fillFromPerson(p);
        closeDropdown();
        nameEl.focus();
      }
      else if (e.key === 'Escape') { closeDropdown(); nameEl.focus(); }
    });

    nameEl.addEventListener('change', () => {
      const typed = nameEl.value.trim();
      if (!typed) return;
      const exact = state.people.find(p => iequal(p.name, typed));
      if (exact) fillFromPerson(exact);
    });

    nameEl.addEventListener('blur', () => setTimeout(() => {
      if (dropdown.contains(document.activeElement)) return;
      const typed = nameEl.value.trim();
      if (!typed) {
        fillForm('', { 'helper-form-gender': '', 'helper-form-dob': '', 'helper-form-club': '' });
        currentMatches = [];
      } else if (currentMatches.length === 1) {
        nameEl.value = currentMatches[0].name;
        fillFromPerson(currentMatches[0]);
      }
      closeDropdown();
    }, 150));
  }

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

  // Club field: autofill when typed text becomes unambiguous
  const clubEl = document.getElementById('helper-form-club');
  if (clubEl) {
    let clubDeleting = false;
    clubEl.addEventListener('keydown', e => { clubDeleting = (e.key === 'Backspace' || e.key === 'Delete'); });
    clubEl.addEventListener('input', () => {
      const raw   = clubEl.value;
      const typed = raw.trim();
      if (!typed) { clubDeleting = false; return; }
      const low = typed.toLowerCase();
      const clubs = [...new Set(state.people.map(p => p.club).filter(Boolean))];
      const matches = clubs.filter(c => c.toLowerCase().startsWith(low));
      if (matches.length === 1 && !clubDeleting && !raw.endsWith(' ') && typed.length < matches[0].length) {
        const s = clubEl.selectionStart;
        clubEl.value = matches[0];
        clubEl.setSelectionRange(s, matches[0].length);
      }
      clubDeleting = false;
    });
  }

  // ---- Role field: auto-fill description; description edits update roles table ----
  const roleEl     = document.getElementById('helper-form-role');
  const roleDescEl = document.getElementById('helper-form-role-desc');

  if (roleEl && roleDescEl) {
    let roleDeleting = false;
    roleEl.addEventListener('keydown', e => { roleDeleting = (e.key === 'Backspace' || e.key === 'Delete'); });
    roleEl.addEventListener('input', () => {
      const raw   = roleEl.value;
      const typed = raw.trim();
      if (!typed) { roleDescEl.value = ''; roleDeleting = false; return; }
      const low = typed.toLowerCase();
      const matches = state.roles.filter(r => r.role.toLowerCase().startsWith(low));
      if (matches.length === 1 && !roleDeleting && !raw.endsWith(' ') && typed.length < matches[0].role.length) {
        const s = roleEl.selectionStart;
        roleEl.value = matches[0].role;
        roleEl.setSelectionRange(s, matches[0].role.length);
        roleDescEl.value = matches[0].description || '';
      } else {
        const exact = matches.find(r => r.role.toLowerCase() === low);
        if (exact) roleDescEl.value = exact.description || '';
        else if (!matches.length) roleDescEl.value = '';
      }
      roleDeleting = false;
    });

    roleDescEl.addEventListener('change', async () => {
      const roleName = roleEl.value.trim();
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
  const formContainer = document.getElementById('helper-form-fields');
  if (formContainer) {
    formContainer.addEventListener('keydown', async e => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        await submitHelperForm();
      } else if (e.key === 'Tab') {
        const focusable = [...formContainer.querySelectorAll(
          'input:not([disabled]), select:not([disabled]), button:not([disabled])'
        )].filter(el => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });
  }
}