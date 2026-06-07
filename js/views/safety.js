'use strict';

import { state } from '../state.js';
import { buildSafetyList, updateSafetyStatus, getOutstandingSafetyCount } from '../finishers.js';
import { on, setHTML, showStatus } from '../ui.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';

export function renderSafety() {
  const tbody = document.getElementById('safety-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.safety.map(s => `
    <tr class="${s.status ? 'row-safe' : 'row-outstanding'}">
      <td>${s.number}</td>
      <td>${s.name || ''}</td>
      <td>${s.course || ''}</td>
      <td>${s.category || ''}</td>
      <td>${s.status || ''}</td>
      <td>${s.reason || ''}</td>
      <td>
        <button class="btn-sm btn-save" data-bib="${s.number}">Safe</button>
        <button class="btn-sm btn-withdraw" data-bib="${s.number}">Withdrew</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-save').forEach(b =>
    b.addEventListener('click', () => markSafe(+b.dataset.bib, 'Safe')));
  tbody.querySelectorAll('.btn-withdraw').forEach(b =>
    b.addEventListener('click', () => markSafe(+b.dataset.bib, 'Withdrew')));
  setHTML('safety-outstanding', getOutstandingSafetyCount() + ' outstanding');
}

export async function runBuildSafety() {
  showBusy('Building safety list…');
  const list = await buildSafetyList();
  showBusy('');
  showStatus(`${list.length} outstanding on safety list.`);
  renderSafety();
}

export async function markSafe(bib, status) {
  await updateSafetyStatus(bib, status, '');
  renderSafety();
  renderHome();
}

export function wireSafety() {
  on('btn-build-safety', 'click', runBuildSafety);
}