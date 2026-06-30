'use strict';

import { state } from '../state.js';
import { recordFinisher, deleteFinisher } from '../finishers.js';
import { isEntryBanned, getEntryName } from '../entries.js';
import { derivePairGender } from '../categories.js';
import { setHTML, showStatus, showConfirmDialog, wireTabBar, renderTable, tableColumns } from '../ui.js';
import { TABLES } from '../strings.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';
import {
  getOutstandingRows, getDnfRows, getFinishedRows,
  getEarlyStarterRows, buildNoShows, getSafetyCounts,
} from '../safety.js';

const SAFETY_OUT_COLS = tableColumns(TABLES['safety-outstanding'], {
  bib:     e => e.bibNumber,
  name:    e => getEntryName(e) + (isEntryBanned(e) ? ' (banned)' : ''),
  course:  e => e.course || '',
  cat:     e => {
    const pg = e.partner ? derivePairGender(e.gender, e.partner.gender) : '';
    return pg ? `${e.category || ''} ${pg}`.trim() : (e.category || '');
  },
  actions: () => `<button class="btn-sm btn-delete btn-retire-safety" data-action="retire">Retire</button>`,
});

const SAFETY_DNF_COLS = tableColumns(TABLES['safety-dnf'], {
  bib:     d => d.bib,
  name:    d => d.name,
  course:  d => d.course,
  cat:     d => d.category,
  actions: d => d.idx >= 0
    ? `<button class="btn-sm btn-secondary" data-action="unretire">Unretire</button>`
    : '',
});

const SAFETY_FIN_COLS = tableColumns(TABLES['safety-finished'], {
  bib:    f => f.number,
  name:   f => f.name,
  course: f => f.course,
  cat:    f => f.category,
  line:   f => f.pos,
  time:   f => f.time,
});

const SAFETY_EARLY_COLS = tableColumns(TABLES['safety-early'], {
  bib:        f => f.number,
  name:       f => f.name,
  course:     f => f.course,
  cat:        f => f.category,
  start_time: f => f.startTime,
});

const SAFETY_NOSHOWS_COLS = tableColumns(TABLES['safety-noshows'], {
  name:       r => r.name,
  dob:        r => r.dob,
  club:       r => r.club,
  cat:        r => r.category,
  pre_no:     r => r.participantNumber,
  on_day_bib: r => r.dupBib ?? '',
});

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