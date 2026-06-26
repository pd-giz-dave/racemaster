'use strict';

import { state } from '../state.js';
import { recordFinisher, deleteFinisher } from '../finishers.js';
import { isEntryBanned } from '../entries.js';
import { setHTML, showStatus, showConfirmDialog, wireTabBar, renderTable } from '../ui.js';
import { TABLES } from '../locale.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';
import {
  getOutstandingRows, getDnfRows, getFinishedRows,
  getEarlyStarterRows, buildNoShows, getSafetyCounts,
} from '../safety.js';

const SAFETY_OUT_COLS = (() => {
  const m = TABLES['safety-outstanding'];
  return [
    { ...m[0], render: e => e.bibNumber },
    { ...m[1], render: e => (e.name || '') + (isEntryBanned(e) ? ' (banned)' : '') },
    { ...m[2], render: e => e.course || '' },
    { ...m[3], render: e => e.category || '' },
    { ...m[4], render: () => `<button class="btn-sm btn-delete btn-retire-safety" data-action="retire">Retire</button>` },
  ];
})();

const SAFETY_DNF_COLS = (() => {
  const m = TABLES['safety-dnf'];
  return [
    { ...m[0], render: d => d.bib },
    { ...m[1], render: d => d.name },
    { ...m[2], render: d => d.course },
    { ...m[3], render: d => d.category },
    { ...m[4], render: d => d.idx >= 0
        ? `<button class="btn-sm btn-secondary" data-action="unretire">Unretire</button>`
        : '' },
  ];
})();

const SAFETY_FIN_COLS = (() => {
  const m = TABLES['safety-finished'];
  return [
    { ...m[0], render: f => f.number },
    { ...m[1], render: f => f.name },
    { ...m[2], render: f => f.course },
    { ...m[3], render: f => f.category },
    { ...m[4], render: f => f.pos },
    { ...m[5], render: f => f.time },
  ];
})();

const SAFETY_EARLY_COLS = (() => {
  const m = TABLES['safety-early'];
  return [
    { ...m[0], render: f => f.number },
    { ...m[1], render: f => f.name },
    { ...m[2], render: f => f.course },
    { ...m[3], render: f => f.category },
    { ...m[4], render: f => f.startTime },
  ];
})();

const SAFETY_NOSHOWS_COLS = (() => {
  const m = TABLES['safety-noshows'];
  return [
    { ...m[0], render: r => r.name },
    { ...m[1], render: r => r.dob },
    { ...m[2], render: r => r.club },
    { ...m[3], render: r => r.category },
    { ...m[4], render: r => r.participantNumber },
    { ...m[5], render: r => r.dupBib ?? '' },
  ];
})();

export function renderSafety() {
  renderTable('safety-outstanding-tbody', SAFETY_OUT_COLS, getOutstandingRows(), {
    rowAttrs: e => ({ 'data-bib': e.bibNumber }),
  });

  const dnfRows = getDnfRows();
  renderTable('safety-dnf-tbody', SAFETY_DNF_COLS, dnfRows, {
    rowAttrs: d => ({ 'data-bib': d.bib }),
  });

  renderTable('safety-finished-tbody', SAFETY_FIN_COLS, getFinishedRows());

  renderTable('safety-early-tbody', SAFETY_EARLY_COLS, getEarlyStarterRows());

  renderTable('safety-noshows-tbody', SAFETY_NOSHOWS_COLS, buildNoShows(), {
    rowAttrs: r => ({ class: r.dupBib !== null ? 'row-timing-target' : '' }),
  });

  const { senOut, jnrOut, senDnf, jnrDnf, senEntries, jnrEntries } = getSafetyCounts(dnfRows);
  setHTML('safety-senior-outstanding', `${senOut} of ${senEntries}`);
  setHTML('safety-junior-outstanding', `${jnrOut} of ${jnrEntries}`);
  const setBadgeBg = (id, alert) => {
    const el = document.getElementById(id)?.closest('.count-badge');
    if (el) el.style.background = alert ? 'var(--danger)' : '';
  };
  setBadgeBg('safety-senior-outstanding', senOut > 0);
  setBadgeBg('safety-junior-outstanding', jnrOut > 0);
  setHTML('safety-senior-dnf', senDnf);
  setHTML('safety-junior-dnf', jnrDnf);
}

async function retireFromSafety(bib) {
  if (!await showConfirmDialog(`Record bib ${bib} as retired?`, 'Retire', true)) return;
  showBusy('Recording retirement…');
  const result = await recordFinisher(bib, '-', 'DNF');
  if (result.error) { showBusy(''); showStatus(result.error, true); return; }
  showBusy('');
  showStatus(`Bib ${bib} recorded as retired.`);
  renderSafety();
  renderHome();
}

async function unretire(bib) {
  if (!await showConfirmDialog(`Remove retirement for bib ${bib}?`, 'Unretire', true)) return;
  const stateIdx = state.finishers.findIndex(f => f.action === 'DNF' && +f.number === bib);
  if (stateIdx < 0) { showStatus('Retirement record not found.', true); return; }
  showBusy('Removing retirement…');
  const result = await deleteFinisher(stateIdx);
  if (result?.error) { showBusy(''); showStatus(result.error, true); return; }
  showBusy('');
  showStatus(`Bib ${bib} unretired.`);
  renderSafety();
  renderHome();
}

export function wireSafety() {
  wireTabBar('safety-tab-bar', 'safety-tab-', 'data-safety-tab');

  document.getElementById('safety-outstanding-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="retire"]');
    if (!btn) return;
    retireFromSafety(+btn.closest('[data-bib]')?.dataset.bib);
  });

  document.getElementById('safety-dnf-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="unretire"]');
    if (!btn) return;
    unretire(+btn.closest('[data-bib]')?.dataset.bib);
  });
}