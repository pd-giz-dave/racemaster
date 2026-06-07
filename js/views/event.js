'use strict';

import { state, saveEvent, saveEntries, saveHelpers, saveFinishers, saveResults, savePrizes, saveCategories, saveSafety, saveSIResults } from '../state.js';
import { applyFRAPreset, applyWFRAPreset, categoryFromDistance } from '../categories.js';
import { clearSIEntries } from '../si-entries.js';
import { val, fillForm, confirm, showStatus, on } from '../ui.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';
import { renderCategories } from './categories.js';

export function renderEvent() {
  const ev = state.event;
  fillForm('event-form', {
    'ev-name':               ev.name,
    'ev-date':               ev.date,
    'ev-distance':           ev.distance,
    'ev-start-time':         ev.startTime,
    'ev-categories':         ev.categories || 'FRA',
    'ev-first-bib':          ev.firstBibNumber,
    'ev-entry-limit':        ev.entryLimit,
    'ev-timing-method':      ev.timingMethod,
    'ev-junior-limit':       ev.juniorLimit,
    'ev-junior-timing':      ev.juniorTimingMethod,
    'ev-junior-limit-n':     ev.juniorEntryLimit,
    'ev-junior-start-time':  ev.juniorStartTime,
    'ev-prize-overall':      ev.prizeDepthOverall,
    'ev-prize-per-cat':      ev.prizeDepthPerCategory,
    'ev-male-record':        ev.maleRecord,
    'ev-female-record':      ev.femaleRecord,
    'ev-clear-previous':     false,
  });
}

export async function saveEventForm() {
  const ev = state.event;
  const newName       = val('ev-name');
  const newCategories = val('ev-categories');
  const doClear       = document.getElementById('ev-clear-previous')?.checked || false;
  const oldCategories = ev.categories || 'FRA';

  // Build confirmation message
  const lines = [`Save settings for "${newName || '(unnamed event)'}"?`];

  if (newCategories !== oldCategories) {
    lines.push(`\nCategories will change from ${oldCategories} to ${newCategories} — active categories will be updated.`);
  }

  if (doClear) {
    const counts = [
      ['Entries',     state.entries.length],
      ['Pre-entries', state.preEntries.length],
      ['Finishers',   state.finishers.length],
      ['Results',     state.results.length],
      ['Prizes',      state.prizes.length],
      ['Helpers',     state.helpers.length],
      ['Safety',      state.safety.length],
      ['SI Results',  state.siResults.length],
    ].filter(([, n]) => n > 0);
    if (counts.length) {
      lines.push('\nThe following will be permanently cleared:');
      counts.forEach(([label, n]) => lines.push(`  • ${label}: ${n}`));
      lines.push('\nThis cannot be undone.');
    }
  }

  if (!confirm(lines.join('\n'))) return;

  // Apply fields
  ev.name                       = newName;
  ev.categories                 = newCategories;
  ev.date                       = val('ev-date');
  ev.distance                   = +val('ev-distance') || 0;
  ev.startTime                  = val('ev-start-time');
  ev.juniorStartTime            = val('ev-junior-start-time');
  ev.firstBibNumber             = +val('ev-first-bib') || 1;
  ev.entryLimit                 = +val('ev-entry-limit') || 200;
  ev.timingMethod               = val('ev-timing-method');
  ev.juniorLimit                = val('ev-junior-limit');
  ev.juniorTimingMethod         = val('ev-junior-timing');
  ev.juniorEntryLimit           = +val('ev-junior-limit-n') || 0;
  ev.prizeDepthOverall          = +val('ev-prize-overall') || 3;
  ev.prizeDepthPerCategory      = +val('ev-prize-per-cat') || 3;
  ev.maleRecord                 = val('ev-male-record');
  ev.femaleRecord               = val('ev-female-record');

  showBusy('Saving…');

  // Apply category preset if changed
  if (newCategories !== oldCategories) {
    if (newCategories === 'WFRA') applyWFRAPreset();
    else applyFRAPreset();
    await saveCategories();
  }

  // Clear previous race data if requested
  if (doClear) {
    state.entries   = [];  state.finishers = [];
    state.results   = [];  state.prizes    = [];
    state.helpers   = [];  state.finishNumbersMap = {};
    state.safety    = [];  state.siResults = [];
    await Promise.all([
      saveEntries(), saveHelpers(), saveFinishers(),
      saveResults(), savePrizes(), clearSIEntries(),
      saveSafety(), saveSIResults(),
    ]);
    document.getElementById('ev-clear-previous').checked = false;
  }

  await saveEvent();
  showBusy('');
  showStatus('Event saved' + (doClear ? ' — race data cleared.' : '.'));
  renderHome();
}

export function applyCatPreset(preset) {
  return async () => {
    if (preset === 'FRA') applyFRAPreset();
    else applyWFRAPreset();
    await saveCategories();
    renderCategories();
    showStatus(`${preset} categories applied.`);
  };
}

export function wireEvent() {
  on('btn-save-event',  'click', saveEventForm);
  on('btn-apply-fra',   'click', applyCatPreset('FRA'));
  on('btn-apply-wfra',  'click', applyCatPreset('WFRA'));

  const distEl = document.getElementById('ev-distance');
  if (distEl) {
    distEl.addEventListener('change', () => {
      const dist = +distEl.value || 0;
      if (!dist) return;
      const limitEl = document.getElementById('ev-junior-limit');
      if (limitEl) limitEl.value = categoryFromDistance(dist);
    });
  }
}