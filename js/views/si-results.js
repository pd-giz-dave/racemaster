'use strict';

import { state } from '../state.js';
import { importSIResults } from '../si-results.js';
import { on, setHTML, showStatus, pickFile } from '../ui.js';
import { showBusy } from '../utils.js';

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

export function wireSIResults() {
  on('btn-import-si-results', 'click', importSIResultsFromFile);
}