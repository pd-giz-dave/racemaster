'use strict';

import { state } from '../state.js';
import { buildSafetyList, recordFinisher, getOutstandingCount } from '../finishers.js';
import { getEntriesOnCourse } from '../entries.js';
import { setHTML, showStatus, showConfirmDialog } from '../ui.js';
import { COURSE } from '../constants.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';

export function renderSafety() {
  const tbody = document.getElementById('safety-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.safety.map(s => `
    <tr>
      <td>${s.number}</td>
      <td>${s.name || ''}</td>
      <td>${s.course || ''}</td>
      <td>${s.category || ''}</td>
      <td>
        <button class="btn-sm btn-delete btn-retire-safety" data-bib="${s.number}">Retire</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-retire-safety').forEach(b =>
    b.addEventListener('click', () => retireFromSafety(+b.dataset.bib)));
  setHTML('safety-senior-outstanding', `${getOutstandingCount(COURSE.SENIORS)} of ${getEntriesOnCourse(COURSE.SENIORS)}`);
  setHTML('safety-junior-outstanding', `${getOutstandingCount(COURSE.JUNIORS)} of ${getEntriesOnCourse(COURSE.JUNIORS)}`);
}


async function retireFromSafety(bib) {
  if (!await showConfirmDialog(`Record bib ${bib} as retired?`, 'Retire', true)) return;
  showBusy('Recording retirement…');
  const result = await recordFinisher(bib, '', null, 'DNF');
  if (result.error) {
    showBusy('');
    showStatus(result.error, true);
    return;
  }
  await buildSafetyList();
  showBusy('');
  showStatus(`Bib ${bib} recorded as retired.`);
  renderSafety();
  renderHome();
}
