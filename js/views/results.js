'use strict';

import { formatResults, buildPrizes, getResultsForCourse } from '../results.js';
import { COURSE } from '../constants.js';
import { on, setHTML, showStatus } from '../ui.js';
import { showBusy } from '../utils.js';

export function renderResults() {
  const seniors = getResultsForCourse(COURSE.SENIORS);
  const juniors = getResultsForCourse(COURSE.JUNIORS);
  renderResultsTable('results-senior-tbody', seniors);
  renderResultsTable('results-junior-tbody', juniors);
}

export function renderResultsTable(tbodyId, results) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = results.map(r => `
    <tr class="${r.prize ? 'row-prize' : ''}">
      <td>${r.position < 9999 ? r.position : 'DNF'}</td>
      <td>${r.time || ''}</td>
      <td>${r.name || ''}</td>
      <td>${r.club || ''}</td>
      <td>${r.category || ''}</td>
      <td>${r.inCatPos || ''}</td>
      <td>${r.behindTime || ''}</td>
      <td>${r.prize ? '★' : ''}</td>
    </tr>`).join('');
}

export async function runFormatResults() {
  showBusy('Formatting results…');
  await formatResults();
  showBusy('');
  showStatus('Results generated.');
  renderResults();
}

export async function runBuildPrizes() {
  showBusy('Building prizes…');
  await buildPrizes();
  showBusy('');
  showStatus('Prize list generated.');
  renderResults();
}

export function wireResults() {
  on('btn-format-results', 'click', runFormatResults);
  on('btn-build-prizes',   'click', runBuildPrizes);
}