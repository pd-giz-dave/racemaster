'use strict';

import { state } from '../state.js';
import { recordFinisher, getOutstandingCount } from '../finishers.js';
import { getEntriesOnCourse } from '../entries.js';
import { setHTML, showStatus, showConfirmDialog } from '../ui.js';
import { COURSE } from '../constants.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';

function getOutstandingEntries() {
  const finishedBibs = new Set(
    state.finishers
      .filter(f => f.action === 'Finish' || f.action === 'DNF')
      .map(f => +f.number)
      .filter(n => n > 0)
  );
  return state.entries.filter(e => {
    const bib = +e.bibNumber;
    return bib > 0 && !finishedBibs.has(bib) && e.retired !== 'Y';
  });
}

export function renderSafety() {
  const tbody = document.getElementById('safety-tbody');
  if (!tbody) return;
  tbody.innerHTML = getOutstandingEntries().map(e => `
    <tr>
      <td>${e.bibNumber}</td>
      <td>${e.name || ''}</td>
      <td>${e.course || ''}</td>
      <td>${e.category || ''}</td>
      <td>
        <button class="btn-sm btn-delete btn-retire-safety" data-bib="${e.bibNumber}">Retire</button>
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
  const result = await recordFinisher(bib, '', 'DNF');
  if (result.error) { showBusy(''); showStatus(result.error, true); return; }
  showBusy('');
  showStatus(`Bib ${bib} recorded as retired.`);
  renderSafety();
  renderHome();
}