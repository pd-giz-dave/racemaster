'use strict';

import { state, saveEvent, saveEntries, saveHelpers, saveFinishers, saveCategories, saveSIResults } from '../state.js';
import { applyFRAPreset, applyWFRAPreset, categoryFromDistance } from '../categories.js';
import { reapplyEntryCategories } from '../entries.js';
import { clearSIEntries } from '../si-entries.js';
import { val, fillForm, showConfirmDialog, showStatus, updateBannerEventName, on, notImplemented } from '../ui.js';
import { showBusy, toISODate, fromISODate } from '../utils.js';
import { renderHome } from './home.js';
import { renderCategories } from './categories.js';

function populateJuniorLimitDropdown() {
  const el = document.getElementById('ev-junior-limit');
  if (!el) return;
  const catSel = (document.getElementById('ev-categories')?.value || 'FRA').toUpperCase();
  const preset = catSel === 'WFRA' ? state.wfraPreset : state.fraPreset;
  const current = el.value;
  const seen = new Set();
  const opts = preset
    .map(r => r.maleCat || '')
    .filter(c => /^U\d+[BG]?$/i.test(c))
    .map(c => /[BG]$/i.test(c) ? c.slice(0, -1) : c)
    .filter(c => { const k = c.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  el.innerHTML = `<option value="None">None</option>` +
    opts.map(c => `<option value="${c}">${c}</option>`).join('');
  el.value = opts.includes(current) ? current : 'None';
}

export function renderEvent() {
  const ev = state.event;
  populateJuniorLimitDropdown();
  fillForm('event-form', {
    'ev-name':               ev.name,
    'ev-date':               toISODate(ev.date),
    'ev-distance':           ev.distance,
    'ev-start-time':         ev.startTime,
    'ev-categories':         ev.categories || 'FRA',
    'ev-first-bib':          ev.firstBibNumber,
    'ev-first-dibber':       ev.firstDibberNumber,
    'ev-entry-limit':        ev.entryLimit,
    'ev-timing-method':      ev.timingMethod,
    'ev-junior-limit':       ev.juniorLimit,
    'ev-junior-timing':      ev.juniorTimingMethod,
    'ev-junior-limit-n':     ev.juniorEntryLimit,
    'ev-junior-start-time':  ev.juniorStartTime,
    'ev-prize-overall':      ev.prizeDepthOverall,
    'ev-prize-per-cat':      ev.prizeDepthPerCategory,
    'ev-prize-junior-cat':   ev.juniorPrizeDepthPerCategory,
    'ev-male-record':        ev.maleRecord,
    'ev-female-record':      ev.femaleRecord,
    'ev-organisation':       ev.organisation,
    'ev-clear-previous':     false,
  });
}

export async function saveEventForm() {
  const ev = state.event;
  const newName       = val('ev-name');
  const newCategories = val('ev-categories');
  const doClear       = document.getElementById('ev-clear-previous')?.checked || false;
  const oldCategories = ev.categories || 'FRA';

  // Validate: dibbers requires a non-empty dibber list
  if (state.dibbers.length === 0) {
    const seniorDibbers = val('ev-timing-method') === 'Dibbers';
    const juniorDibbers = val('ev-junior-timing') === 'Dibbers';
    if (seniorDibbers || juniorDibbers) {
      const which = seniorDibbers && juniorDibbers ? 'Senior and Junior timing are both set to Dibbers'
                  : seniorDibbers ? 'Senior timing is set to Dibbers'
                  : 'Junior timing is set to Dibbers';
      showStatus(`${which} but no dibber list has been imported. Either change the timing method or import a dibber list via the Dibbers page.`, true);
      return;
    }
  }

  // Build confirmation message
  const lines = [`Save settings for "${newName || '(unnamed event)'}"?`];

  if (newCategories !== oldCategories) {
    lines.push(`\nCategories will change from ${oldCategories} to ${newCategories} — active categories will be updated and all existing entry categories will be recalculated.`);
  }

  if (doClear) {
    const counts = [
      ['Entries',     state.entries.length],
      ['Pre-entries', state.preEntries.length],
      ['Finishers',   state.finishers.length],
      ['Helpers',     state.helpers.length],
      ['SI Results',  state.siResults.length],
    ].filter(([, n]) => n > 0);
    if (counts.length) {
      lines.push('\nThe following will be permanently cleared:');
      counts.forEach(([label, n]) => lines.push(`  • ${label}: ${n}`));
      lines.push('\nThis cannot be undone.');
    }
  }

  if (!await showConfirmDialog(lines.join('\n'), 'Save', doClear)) return;

  // Apply fields
  ev.name                       = newName;
  ev.categories                 = newCategories;
  ev.date                       = fromISODate(val('ev-date'));
  ev.distance                   = +val('ev-distance');
  ev.startTime                  = val('ev-start-time');
  ev.juniorStartTime            = val('ev-junior-start-time');
  ev.firstBibNumber             = +val('ev-first-bib');
  ev.firstDibberNumber          = +val('ev-first-dibber');
  ev.entryLimit                 = +val('ev-entry-limit');
  ev.timingMethod               = val('ev-timing-method');
  ev.juniorLimit                = val('ev-junior-limit');
  ev.juniorTimingMethod         = val('ev-junior-timing');
  ev.juniorEntryLimit           = +val('ev-junior-limit-n');
  ev.prizeDepthOverall             = +val('ev-prize-overall');
  ev.prizeDepthPerCategory         = +val('ev-prize-per-cat');
  ev.juniorPrizeDepthPerCategory   = +val('ev-prize-junior-cat');
  ev.maleRecord                 = val('ev-male-record');
  ev.femaleRecord               = val('ev-female-record');
  ev.organisation               = val('ev-organisation');

  showBusy('Saving…');

  // Apply category preset if changed, then re-evaluate all entry categories
  if (newCategories !== oldCategories) {
    if (newCategories === 'WFRA') applyWFRAPreset();
    else applyFRAPreset();
    await saveCategories();
    await reapplyEntryCategories();
  }

  // Clear previous race data if requested
  if (doClear) {
    state.entries   = [];  state.finishers = [];
    state.helpers   = [];  state.finishNumbersMap = {};
    state.siResults = [];
    await Promise.all([
      saveEntries(), saveHelpers(), saveFinishers(),
      clearSIEntries(), saveSIResults(), saveCategories(),
    ]);
    document.getElementById('ev-clear-previous').checked = false;
  }

  await saveEvent();
  updateBannerEventName(state.event.name);
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
  on('ev-categories',   'change', populateJuniorLimitDropdown);

  const distEl = document.getElementById('ev-distance');
  if (distEl) {
    distEl.addEventListener('change', () => {
      const dist = +distEl.value || 0;
      if (!dist) return;
      const limitEl = document.getElementById('ev-junior-limit');
      if (limitEl) limitEl.value = categoryFromDistance(dist);
    });
  }

  const pairsEl = document.getElementById('ev-has-pairs');
  if (pairsEl) {
    pairsEl.addEventListener('change', async () => {
      if (!pairsEl.checked) return;
      await notImplemented();
      pairsEl.checked = false;
    });
  }
}