'use strict';

import { importSIEntries, verifySIEntries, clearSIEntries, getSortedPreEntries } from '../si-entries.js';
import { loadPreEntries } from '../entries.js';
import { mergeSIEntries } from '../data.js';
import { cleanName, showBusy } from '../utils.js';
import { on, setHTML, showStatus, showConfirmDialog, pickFile } from '../ui.js';
import { renderPeople } from './people.js';
import { renderEntries } from './entries.js';
import { renderHome } from './home.js';

export function renderPreEntries() {
  const preEntries = getSortedPreEntries();
  const tbody = document.getElementById('pre-entries-tbody');
  if (!tbody) return;
  tbody.innerHTML = preEntries.map(pe => {
    const name = cleanName(`${pe.firstName||''} ${pe.lastName||''}`.trim());
    return `<tr>
      <td>${pe.participantNumber || ''}</td>
      <td>${name}</td>
      <td>${pe.gender || ''}</td>
      <td>${pe.dob || ''}</td>
      <td>${pe.club || ''}</td>
      <td>${pe.category || ''}</td>
      <td>${pe.fraNumber || ''}</td>
    </tr>`;
  }).join('');
  setHTML('pre-entry-count', `${preEntries.length} pre-entries`);
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
    showStatus(
      `${result.added} added, ${result.updated} updated — ${issues.length} issue(s): ` +
      issues.map(i => i.name ? `${i.name}: ${i.issue}` : i.issue).join('; '),
      true
    );
    renderPreEntries();
    return;
  }

  showBusy('Merging…');
  const merged = await mergeSIEntries();
  showBusy('');
  showStatus(
    `${result.added} added, ${result.updated} updated — merged: +${merged.peopleAdded} people.`
  );
  renderPreEntries();
  renderPeople();
}

export async function runLoadPreEntries() {
  showBusy('Loading pre-entries…');
  const result = await loadPreEntries();
  showBusy('');
  if (result.errors.length) showStatus(result.errors.join('; '), true);
  else showStatus(`${result.added} entries added, ${result.updated} updated.`);
  renderEntries();
  renderHome();
}

export async function runClearPreEntries() {
  if (!await showConfirmDialog('Clear all pre-entries?', 'Clear', true)) return;
  await clearSIEntries();
  showStatus('Pre-entries cleared.');
  renderPreEntries();
}

export function wirePreEntries() {
  on('btn-import-si-entries',   'click', importSIEntriesFromFile);
  on('btn-load-pre-to-entries', 'click', runLoadPreEntries);
  on('btn-clear-pre-entries',   'click', runClearPreEntries);
}