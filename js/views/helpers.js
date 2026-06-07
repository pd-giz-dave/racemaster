'use strict';

import { submitHelper, deleteHelper, getSortedHelpers } from '../helpers.js';
import { val, on, setHTML, confirm, showStatus, updateDatalistClubs, clearForm } from '../ui.js';
import { showBusy } from '../utils.js';

export function renderHelpers() {
  const helpers = getSortedHelpers();
  const tbody = document.getElementById('helpers-tbody');
  if (!tbody) return;
  tbody.innerHTML = helpers.map(h => `
    <tr>
      <td>${h.number}</td>
      <td>${h.name || ''}</td>
      <td>${h.club || ''}</td>
      <td>${h.role || ''}</td>
      <td><button class="btn-sm btn-del-helper" data-num="${h.number}">Del</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-del-helper').forEach(b =>
    b.addEventListener('click', () => confirmDeleteHelper(+b.dataset.num)));
  setHTML('helper-count-display', `${helpers.length} helpers`);
  updateDatalistClubs();
}

export async function submitHelperForm() {
  const formData = {
    name:   val('helper-form-name'),
    gender: val('helper-form-gender'),
    dob:    val('helper-form-dob'),
    club:   val('helper-form-club'),
    role:   val('helper-form-role'),
  };
  showBusy('Adding helper…');
  const result = await submitHelper(formData);
  showBusy('');
  if (result.error) {
    showStatus(result.error, true);
  } else {
    showStatus(`Helper ${result.number} added.`);
    clearForm('helper-form-fields');
    renderHelpers();
  }
}

export async function confirmDeleteHelper(num) {
  if (!confirm(`Delete helper ${num}?`)) return;
  const result = await deleteHelper(num);
  if (result.error) showStatus(result.error, true);
  else { showStatus(`Helper ${num} deleted.`); renderHelpers(); }
}

export function wireHelpers() {
  on('btn-submit-helper', 'click', submitHelperForm);
}