'use strict';

import { state } from '../state.js';
import { importSIResults, verifySIResults, formatSIResults } from '../si-results.js';
import { COURSE } from '../constants.js';
import { on, setHTML, showStatus, pickFile } from '../ui.js';
import { showBusy } from '../utils.js';
import { renderFinishers } from './finishers.js';

export function renderSIResults() {
  const tbody = document.getElementById('si-results-tbody');
  const thead = document.getElementById('si-results-head');
  if (!tbody) return;
  const keys = state.siResults.length ? Object.keys(state.siResults[0]) : [];
  if (thead) thead.innerHTML = keys.map(k => `<th>${k}</th>`).join('');
  tbody.innerHTML = state.siResults.map(r =>
    `<tr>${keys.map(k => `<td>${r[k] || ''}</td>`).join('')}</tr>`
  ).join('');
  setHTML('si-results-count', `${state.siResults.length} SI results`);
}

export async function importSIResultsFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  showBusy('Importing SI results…');
  const result = await importSIResults(text);
  showBusy('');
  if (result.errors.length) showStatus(result.errors.join('; '), true);
  else showStatus(`${result.imported} SI results imported.`);
  renderSIResults();
}

export async function runVerifySIResults() {
  const issues = verifySIResults();
  if (!issues.length) showStatus('SI results OK — no issues found.');
  else showStatus(`${issues.length} issue(s): ` + issues.map(i => i.issue).join('; '), true);
}

export async function runFormatSIResults(course) {
  showBusy('Formatting SI results…');
  const result = await formatSIResults(course);
  showBusy('');
  if (result.errors.length) showStatus(result.errors.join('; '), true);
  else showStatus(`${result.added} SI finishers merged for ${course}.`);
  renderFinishers();
}

export function wireSIResults() {
  on('btn-import-si-results',         'click', importSIResultsFromFile);
  on('btn-verify-si-results',         'click', runVerifySIResults);
  on('btn-format-si-results-senior',  'click', () => runFormatSIResults(COURSE.SENIORS));
  on('btn-format-si-results-junior',  'click', () => runFormatSIResults(COURSE.JUNIORS));
}