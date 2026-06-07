'use strict';

import { state, loadAll } from './state.js';
import { openDirectory, restoreDirectory } from './storage.js';
import { showBusy } from './utils.js';
import { on, showStatus, updateDatalistNames, updateDatalistClubs } from './ui.js';

import { renderHome }       from './views/home.js';
import { renderEvent, wireEvent }           from './views/event.js';
import { renderEntries, wireEntries }       from './views/entries.js';
import { renderHelpers, wireHelpers }       from './views/helpers.js';
import { renderFinishers, wireFinishers, finisherPass, initPass2 } from './views/finishers.js';
import { renderResults, wireResults }       from './views/results.js';
import { renderPreEntries, wirePreEntries } from './views/pre-entries.js';
import { renderSafety, wireSafety }         from './views/safety.js';
import { renderPeople, wirePeople }         from './views/people.js';
import { renderClubs, wireClubs }           from './views/clubs.js';
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
      showStatus('No data directory selected — click "Open Data Folder"');
    }
  } catch (e) {
    showStatus('Error loading data: ' + e.message, true);
  }

  wireNav();
  wireEvents();
  renderAll();
  showBusy('');
  showView('home');
}

// ---- Navigation ----

function wireNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      showView(el.dataset.view);
    });
  });
  window.addEventListener('rm:navigate', e => showView(e.detail));
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
  updateDatalistNames();
  updateDatalistClubs();
}

function renderView(v) {
  switch (v) {
    case 'home':         renderHome();         break;
    case 'event':        renderEvent();        break;
    case 'entries':
      renderEntries();
      setTimeout(() => document.getElementById('entry-form-peno')?.focus(), 0);
      break;
    case 'helpers':      renderHelpers();      break;
    case 'finishers':
      if (finisherPass === 2) initPass2();
      renderFinishers();
      setTimeout(() => document.getElementById(finisherPass === 1 ? 'finish-bib-rapid' : 'finish-time-rapid')?.focus(), 0);
      break;
    case 'results':      renderResults();      break;
    case 'pre-entries':  renderPreEntries();   break;
    case 'safety':       renderSafety();       break;
    case 'people':       renderPeople();       break;
    case 'clubs':        renderClubs();        break;
    case 'dibbers':      renderDibbers();      break;
    case 'categories':   renderCategories();   break;
    case 'forms':        renderForms();        break;
    case 'si-results':   renderSIResults();    break;
  }
}

// ---- Directory open ----

async function openDir() {
  showBusy('Opening folder…');
  try {
    await openDirectory();
    await loadAll();
    renderAll();
    showStatus('Data loaded.');
  } catch (e) {
    if (e.name !== 'AbortError') showStatus('Error: ' + e.message, true);
  }
  showBusy('');
}

// ---- Event wiring (orchestration) ----

function wireEvents() {
  on('btn-open-dir', 'click', openDir);

  wireEvent();
  wireEntries();
  wireHelpers();
  wireFinishers();
  wireResults();
  wireSafety();
  wirePreEntries();
  wirePeople();
  wireClubs();
  wireDibbers();
  wireCategories();
  wireForms();
  wireSIResults();
}

// Boot
document.addEventListener('DOMContentLoaded', init);