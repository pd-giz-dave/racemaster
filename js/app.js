'use strict';

import { state, loadAll } from './state.js';
import { restoreDirectory, dumpState, restoreState } from './storage.js';
import { showBusy } from './utils.js';
import { on, showStatus, updateDatalistNames, updateDatalistClubs, updateDatalistRoles, showConfirmDialog, pickFile, downloadText, sanitise } from './ui.js';

import { renderHome }       from './views/home.js';
import { renderEvent, wireEvent }           from './views/event.js';
import { renderEntries, wireEntries }       from './views/entries.js';
import { renderHelpers, wireHelpers }       from './views/helpers.js';
import { renderFinishers, wireFinishers } from './views/finishers.js';
import { renderResults, wireResults }       from './views/results.js';
import { renderPreEntries, wirePreEntries } from './views/pre-entries.js';
import { renderSafety }                      from './views/safety.js';
import { buildSafetyList }                   from './finishers.js';
import { renderPeople, wirePeople }         from './views/people.js';
import { renderClubs, wireClubs }           from './views/clubs.js';
import { renderRoles, wireRoles }           from './views/roles.js';
import { renderDibbers, wireDibbers }       from './views/dibbers.js';
import { renderCategories, wireCategories } from './views/categories.js';
import { renderForms, wireForms }           from './views/view-forms.js';
import { renderSIResults, wireSIResults }   from './views/si-results.js';

// ============================================================
// Application bootstrap and UI wiring
// ============================================================

let currentView = 'home';

export async function init() {
  showBusy('Loading…');
  try {
    // Try to restore persisted directory handle
    const restored = await restoreDirectory();
    if (restored) {
      await loadAll();
      showStatus('Data loaded from ' + (state.event.name || 'event'));
    } else {
      showStatus('No saved data found — use Import to load a state file.');
    }
  } catch (e) {
    showStatus('Error loading data: ' + e.message, true);
  }

  wireNav();
  wireEvents();
  renderAll();
  showBusy('');
  showView('home');
  setTimeout(focusSidebar, 0);
}

// ---- Navigation ----

function focusSidebar() {
  const sidebar = document.querySelector('.app-sidebar');
  if (!sidebar) return;
  const active = sidebar.querySelector('a[data-view].active') ?? sidebar.querySelector('a[data-view]');
  active?.focus();
}

function wireNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      showView(el.dataset.view);
    });
  });
  window.addEventListener('rm:navigate', e => showView(e.detail));

  // Arrow-key navigation within the sidebar
  const sidebar = document.querySelector('.app-sidebar');
  if (sidebar) {
    sidebar.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const links = [...sidebar.querySelectorAll('a[data-view]')];
      const idx = links.indexOf(document.activeElement);
      if (idx < 0) return;
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? links[Math.min(idx + 1, links.length - 1)]
        : links[Math.max(idx - 1, 0)];
      next?.focus();
    });
  }

  // Escape: navigate to home; confirm first if the current view contains input fields
  document.addEventListener('keydown', async e => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.name-typeahead:not([hidden])')) return;
    e.preventDefault();
    const viewEl = document.getElementById(`view-${currentView}`);
    const hasInputs = !!viewEl?.querySelector('input');
    if (hasInputs && !await showConfirmDialog('Leave this view and go to Home?', 'Leave')) return;
    showView('home');
    setTimeout(focusSidebar, 0);
  });
}

export function showView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.view').forEach(v => {
    v.hidden = v.id !== `view-${viewName}`;
  });
  document.querySelectorAll('[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });
  renderView(viewName);
}

// ---- Render dispatcher ----

function renderAll() {
  renderHome();
  renderSafety();
  updateDatalistNames();
  updateDatalistClubs();
  updateDatalistRoles();
}

function renderView(v) {
  switch (v) {
    case 'home':         renderHome();         break;
    case 'event':        renderEvent();        break;
    case 'entries':
      renderEntries();
      setTimeout(() => {
        document.querySelector('#entries-tbody tr:last-child')?.scrollIntoView({ block: 'nearest' });
        document.getElementById('entry-form-peno')?.focus();
      }, 0);
      break;
    case 'helpers':
      renderHelpers();
      setTimeout(() => {
        document.querySelector('#helpers-tbody tr:last-child')?.scrollIntoView({ block: 'nearest' });
        document.getElementById('helper-form-name')?.focus();
      }, 0);
      break;
    case 'finishers':
      renderFinishers();
      setTimeout(() => {
        if (document.getElementById('finisher-mode')?.value !== 'time') {
          document.querySelector('#finishers-tbody tr:last-child')?.scrollIntoView({ block: 'nearest' });
        }
        document.getElementById('finisher-bib')?.focus();
      }, 0);
      break;
    case 'results':      renderResults();      break;
    case 'pre-entries':  renderPreEntries();   break;
    case 'safety':
      buildSafetyList().then(() => renderSafety());
      break;
    case 'people':       renderPeople();       break;
    case 'clubs':        renderClubs();        break;
    case 'roles':        renderRoles();        break;
    case 'dibbers':      renderDibbers();      break;
    case 'categories':   renderCategories();   break;
    case 'forms':        renderForms();        break;
    case 'si-results':   renderSIResults();    break;
  }
}

// ---- State export / import ----

function exportState() {
  const data = dumpState();
  const name = sanitise(state.event.name || 'racemaster');
  downloadText(JSON.stringify(data, null, 2), `${name}_state.json`);
  showStatus('State exported.');
}

async function importState() {
  const text = await pickFile('.json');
  if (!text) return;
  let data;
  try { data = JSON.parse(text); }
  catch { showStatus('Not a valid JSON file.', true); return; }
  if (!await showConfirmDialog('Import will replace ALL current data. This cannot be undone. Continue?', 'Import', true)) return;
  showBusy('Importing…');
  await restoreState(data);
  await loadAll();
  showBusy('');
  renderAll();
  showView('home');
  showStatus('State imported successfully.');
}

// ---- Event wiring (orchestration) ----

function wireEvents() {
  on('btn-export-state', 'click', exportState);
  on('btn-import-state', 'click', importState);

  wireEvent();
  wireEntries();
  wireHelpers();
  wireFinishers();
  wireResults();

  wirePreEntries();
  wirePeople();
  wireClubs();
  wireRoles();
  wireDibbers();
  wireCategories();
  wireForms();
  wireSIResults();
}

// Boot
document.addEventListener('DOMContentLoaded', init);