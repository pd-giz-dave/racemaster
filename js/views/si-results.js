'use strict';

import { state } from '../state.js';
import { importSIResults, clearSIResults } from '../si-results.js';
import { on, setHTML, showStatus, escHtml, pickFile, wireTabBar, showConfirmDialog } from '../ui.js';
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

function renderIssues(issues) {
  const tbody = document.getElementById('si-results-issues-tbody');
  if (!tbody) return;
  tbody.innerHTML = issues.map(({ bib, name, issue }) =>
    `<tr><td>${bib}</td><td>${escHtml(name || '')}</td><td>${escHtml(issue)}</td></tr>`
  ).join('');
}

function switchTab(tab) {
  const bar = document.getElementById('si-results-tab-bar');
  if (!bar) return;
  const btn = bar.querySelector(`[data-si-tab="${tab}"]`);
  btn?.click();
}

export async function importSIResultsFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  showBusy('Importing SI results…');
  const result = await importSIResults(text);
  showBusy('');
  if (result.errors.length) {
    showStatus(result.errors.join('; '), true);
    if (result.issues?.length) {
      renderIssues(result.issues);
      switchTab('issues');
    }
  } else {
    showStatus(`${result.imported} SI results imported.`);
    switchTab('data');
    renderSIResults();
  }
}

export function wireSIResults() {
  on('btn-import-si-results', 'click', importSIResultsFromFile);
  on('btn-clear-si-results', 'click', async () => {
    if (!await showConfirmDialog('Clear all SI results?', 'Clear', true)) return;
    await clearSIResults();
    renderSIResults();
    showStatus('SI results cleared.');
  });
  wireTabBar('si-results-tab-bar', 'si-results-tab-', 'data-si-tab');
}