'use strict';

import { importSIEntries, verifySIEntries, clearSIEntries, getSortedPreEntries } from '../si-entries.js';
import { mergeSIEntries } from '../data.js';
import { cleanName, showBusy } from '../utils.js';
import { on, setHTML, showStatus, showConfirmDialog, escHtml, pickFile, renderTable, wireTabBar } from '../ui.js';
import { TABLES } from '../locale.js';
import { renderPeople } from './people.js';

const PRE_ENTRY_COLS = (() => {
  const m = TABLES['pre-entries'];
  return [
    { ...m[0],  render: pe => pe.participantNumber || '' },
    { ...m[1],  render: pe => cleanName(`${pe.firstName||''} ${pe.lastName||''}`.trim()) },
    { ...m[2],  render: pe => pe.gender || '' },
    { ...m[3],  render: pe => pe.dob || '' },
    { ...m[4],  render: pe => pe.club || '' },
    { ...m[5],  render: pe => pe.category || '' },
    { ...m[6],  render: pe => pe.fraNumber || '' },
    { ...m[7],  render: pe => pe.siEntriesId || '' },
    { ...m[8],  render: pe => pe.eligibility || '' },
    { ...m[9],  render: pe => pe.email || '' },
    { ...m[10], render: pe => pe.address1 || '' },
    { ...m[11], render: pe => pe.address2 || '' },
    { ...m[12], render: pe => pe.town || '' },
    { ...m[13], render: pe => pe.county || '' },
    { ...m[14], render: pe => pe.postcode || '' },
    { ...m[15], render: pe => pe.country || '' },
    { ...m[16], render: pe => pe.telephone || '' },
    { ...m[17], render: pe => pe.mobile || '' },
    { ...m[18], render: pe => pe.contactName || '' },
    { ...m[19], render: pe => pe.contactTelephone || '' },
    { ...m[20], render: pe => pe.medical || '' },
    { ...m[21], render: pe => pe.carReg || '' },
  ];
})();

export function renderPreEntries() {
  const preEntries = getSortedPreEntries();
  renderTable('pre-entries-tbody', PRE_ENTRY_COLS, preEntries);
  setHTML('pre-entry-count', `${preEntries.length} pre-entries`);
}

function renderIssues(issues) {
  const tbody = document.getElementById('pre-entries-issues-tbody');
  if (!tbody) return;
  tbody.innerHTML = issues.map(({ row, name, issue }) =>
    `<tr><td>${row ?? ''}</td><td>${escHtml(name || '')}</td><td>${escHtml(issue)}</td></tr>`
  ).join('');
}

function switchTab(tab) {
  document.getElementById('pre-entries-tab-bar')?.querySelector(`[data-pe-tab="${tab}"]`)?.click();
}

export async function importSIEntriesFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  showBusy('Importing…');
  const result = await importSIEntries(text);
  showBusy('');
  if (result.errors.length) {
    showStatus(result.errors.join('; '), true);
    renderPreEntries();
    return;
  }

  // Auto-verify
  const issues = verifySIEntries();
  if (issues.length) {
    showStatus(`${result.added} added, ${result.updated} updated — ${issues.length} issue(s) found.`, true);
    renderIssues(issues);
    switchTab('issues');
    renderPreEntries();
    return;
  }

  showBusy('Merging…');
  const merged = await mergeSIEntries();
  showBusy('');
  showStatus(`${result.added} added, ${result.updated} updated — merged: +${merged.peopleAdded} people.`);
  switchTab('data');
  renderPreEntries();
  renderPeople();
}

export async function runClearPreEntries() {
  if (!await showConfirmDialog('Clear all pre-entries?', 'Clear', true)) return;
  await clearSIEntries();
  showStatus('Pre-entries cleared.');
  renderPreEntries();
}

export function wirePreEntries() {
  on('btn-import-si-entries', 'click', importSIEntriesFromFile);
  on('btn-clear-pre-entries', 'click', runClearPreEntries);
  wireTabBar('pre-entries-tab-bar', 'pre-entries-tab-', 'data-pe-tab');
}