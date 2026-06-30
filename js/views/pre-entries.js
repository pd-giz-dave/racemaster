'use strict';

import { importSIEntries, verifySIEntries, clearSIEntries, getSortedPreEntries } from '../si-entries.js';
import { mergeSIEntries } from '../data.js';
import { cleanName, showBusy } from '../utils.js';
import { on, setHTML, showStatus, showConfirmDialog, escHtml, pickFile, renderTable, tableColumns, wireTabBar } from '../ui.js';
import { TABLES } from '../strings.js';
import { renderPeople } from './people.js';

const PRE_ENTRY_COLS = tableColumns(TABLES['pre-entries'], {
  ref:           pe => pe.participantNumber || '',
  name:          pe => cleanName(`${pe.firstName||''} ${pe.lastName||''}`.trim()),
  gender:        pe => pe.gender || '',
  dob:           pe => pe.dob || '',
  club:          pe => pe.club || '',
  cat:           pe => pe.category || '',
  fra:           pe => pe.fraNumber || '',
  si_id:         pe => pe.siEntriesId || '',
  eligibility:   pe => pe.eligibility || '',
  email:         pe => pe.email || '',
  addr1:         pe => pe.address1 || '',
  addr2:         pe => pe.address2 || '',
  town:          pe => pe.town || '',
  county:        pe => pe.county || '',
  postcode:      pe => pe.postcode || '',
  country:       pe => pe.country || '',
  telephone:     pe => pe.telephone || '',
  mobile:        pe => pe.mobile || '',
  emerg_contact: pe => pe.contactName || '',
  emerg_tel:     pe => pe.contactTelephone || '',
  medical:       pe => pe.medical || '',
  car_reg:       pe => pe.carReg || '',
});

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