'use strict';

import { state, loadAll } from './state.js';
import { restoreDirectory, getSession, isStandalone } from './storage.js';
import { updateDataFileButton, startServerPing, startUpdateCheck, startConflictWatch } from './connect.js';
import { wireDatasets, renderDatasets } from './views/datasets.js';
import { showBusy } from './utils.js';
import { showStatus, updateBannerEventName, updateDatalistNames, updateDatalistClubs, updateDatalistRoles, showConfirmDialog } from './ui.js';

import { renderHome }       from './views/home.js';
import { renderEvent, wireEvent }           from './views/event.js';
import { renderEntries, wireEntries }       from './views/entries.js';
import { renderHelpers, wireHelpers }       from './views/helpers.js';
import { renderFinishers, wireFinishers } from './views/finishers.js';
import { renderResults, wireResults }       from './views/results.js';
import { renderPreEntries, wirePreEntries } from './views/pre-entries.js';
import { renderSafety, wireSafety }           from './views/safety.js';
import { renderPeople, wirePeople }         from './views/people.js';
import { renderClubs, wireClubs }         from './views/clubs.js';
import { renderRoles, wireRoles }           from './views/roles.js';
import { renderDibbers, wireDibbers }       from './views/dibbers.js';
import { renderCategories, wireCategories } from './views/categories.js';
import { renderForms, wireForms }           from './views/forms.js';
import { renderSIResults, wireSIResults }   from './views/si-results.js';
import { wireViewHelp, wireTooltips, wireStaticPages } from './help.js';

// ============================================================
// Application bootstrap and UI wiring
// ============================================================

let currentView = 'home';

export async function init() {
  showBusy('Loading…');

  async function connectAndLoad() {
    const session = getSession();
    showBusy('Loading…');
    try {
      await restoreDirectory();
      await loadAll();
      updateBannerEventName(state.event.name);
      if (session) {
        showStatus(`${session.dataset}: ${state.event.name || 'no event set'}`);
      } else {
        showStatus(state.event.name ? `Standalone: ${state.event.name}` : 'Standalone mode — no server sync');
      }
    } catch (e) {
      showStatus('Error loading data: ' + e.message, true);
    }
    updateDataFileButton();
    renderAll();
    showView('home');
    showBusy('');
    setTimeout(focusSidebar, 0);
  }

  wireViewHelp();
  wireTooltips();
  wireStaticPages();
  startServerPing();
  startUpdateCheck();
  startConflictWatch();
  window.addEventListener('racemaster-dirty-change', updateDataFileButton);
  wireDatasets(connectAndLoad);
  wireNav();
  wireEvents();

  if (!getSession() && !isStandalone()) {
    showView('datafile');
    showBusy('');
    return;
  }

  await connectAndLoad();
}

// ---- Navigation ----

function focusSidebar() {
  const sidebar = document.querySelector('.app-sidebar');
  if (!sidebar) return;
  const active = sidebar.querySelector('a[data-view].active') ?? sidebar.querySelector('a[data-view]');
  active?.focus();
}

function closeNavDrawer() {
  document.querySelector('.app-shell')?.classList.remove('nav-open');
}

function wireNavToggle() {
  const shell = document.querySelector('.app-shell');
  document.getElementById('btn-nav-toggle')
    ?.addEventListener('click', () => shell?.classList.toggle('nav-open'));
  document.getElementById('nav-backdrop')
    ?.addEventListener('click', closeNavDrawer);
  document.querySelector('.app-sidebar')
    ?.addEventListener('click', e => { if (e.target.matches('a[data-view]')) closeNavDrawer(); });
}

function wireNav() {
  wireNavToggle();
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

export function renderAll() {
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
    case 'safety':       renderSafety();       break;
    case 'people':
      renderPeople();
      setTimeout(() => document.getElementById('people-filter')?.focus(), 0);
      break;
    case 'clubs':        renderClubs();        break;
    case 'roles':        renderRoles();        break;
    case 'dibbers':      renderDibbers();      break;
    case 'categories':   renderCategories();   break;
    case 'forms':        renderForms();        break;
    case 'si-results':   renderSIResults();    break;
    case 'datafile':     renderDatasets(); break;
  }
}

// ---- Event wiring (orchestration) ----

function wireEvents() {
  wireEvent();
  wireEntries();
  wireHelpers();
  wireFinishers();
  wireResults();

  wireSafety();
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