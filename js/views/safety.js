'use strict';

import { state } from '../state.js';
import { recordFinisher, deleteFinisher } from '../finishers.js';
import { isEntryBanned, getEntryName } from '../entries.js';
import { derivePairGender } from '../categories.js';
import { setHTML, showStatus, showConfirmDialog, wireTabBar, renderTable, tableColumns } from '../ui.js';
import { TABLES } from '../strings.js';
import { COURSE } from '../constants.js';
import { showBusy, elapsedToTimeOfDay } from '../utils.js';
import { renderHome } from './home.js';
import {
  getOutstandingRows, getDnfRows, getFinishedRows,
  getEarlyStarterRows, buildNoShows, getSafetyCounts, getExplicitStart,
} from '../safety.js';
import { getLatestCheckpoint } from '../mobile-checkpoints.js';
import { removeMobileProgressRecord } from '../mobile-progress.js';

// Every time-of-day field here is really about judging how long ago someone was actually last
// seen. `rawTimeOfDay`, when given, is the phone's own device clock reading for the moment in
// question (see mobile-files-progress.js's deviceTimeOfDay doc) and always wins — it doesn't
// depend on the phone's own Start row lining up exactly with the race's official start time the
// way converting `elapsed` does. Falls back to converting `elapsed` via the race start when
// there's no device reading (a stopwatch-only record has no such concept at all), and further
// back to showing `elapsed` itself raw when even that conversion isn't possible (no race start
// time set, or the value isn't a real time at all — e.g. a checkpoint retire's own "Retire"
// placeholder) — never shows nothing when there's a value of some kind to fall back to.
function toTimeOfDay(elapsed, rawTimeOfDay) {
  return rawTimeOfDay || elapsedToTimeOfDay(elapsed, state.event.startTime) || elapsed;
}

const SAFETY_OUT_COLS = tableColumns(TABLES['safety-outstanding'], {
  bib:     e => e.bibNumber,
  name:    e => getEntryName(e) + (isEntryBanned(e) ? ' (banned)' : ''),
  course:  e => e.course || '',
  cat:     e => {
    const pg = e.partner ? derivePairGender(e.gender, e.partner.gender) : '';
    return pg ? `${e.category || ''} ${pg}`.trim() : (e.category || '');
  },
  lastCP:  e => {
    const bib = +e.bibNumber;
    const last = getLatestCheckpoint(bib);
    if (last) return `CP${last.cp} @ ${toTimeOfDay(last.time, last.timeOfDay)}`;
    // No checkpoint sighting yet — but an explicit early/late start is itself a sighting, and
    // otherwise this column would stay blank for someone we do actually know something about.
    const start = getExplicitStart(bib);
    return start ? `Start @ ${toTimeOfDay(start.time, start.timeOfDay)}` : '';
  },
  actions: () => `<button class="btn-sm btn-delete btn-retire-safety" data-action="retire">Retire</button>`,
});

const SAFETY_DNF_COLS = tableColumns(TABLES['safety-dnf'], {
  bib:     d => d.bib,
  name:    d => d.name,
  course:  d => d.course,
  cat:     d => d.category,
  where:   d => d.where,
  when:    d => toTimeOfDay(d.when, d.whenTimeOfDay),
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
  start_time: f => toTimeOfDay(f.startTime, f.startTimeOfDay),
});

const SAFETY_NOSHOWS_COLS = tableColumns(TABLES['safety-noshows'], {
  name:       r => r.name,
  dob:        r => r.dob,
  club:       r => r.club,
  cat:        r => r.category,
  pre_no:     r => r.participantNumber,
  on_day_bib: r => r.dupBib ?? '',
});

// Current wall-clock time as HH:MM:SS — same "the phone/wall clock in front of you" convention
// as ts() (utils.js), just without its milliseconds (of no use at a glance here).
function timeNow() {
  return new Date().toTimeString().slice(0, 8);
}

function updateSafetyClockLine() {
  setHTML('safety-race-start', state.event.startTime || '—');
  setHTML('safety-time-now', timeNow());
}

export function renderSafety() {
  updateSafetyClockLine();
  renderTable('safety-outstanding-seniors-tbody', SAFETY_OUT_COLS, getOutstandingRows(COURSE.SENIORS), {
    rowAttrs: e => ({ 'data-bib': e.bibNumber }),
  });
  renderTable('safety-outstanding-juniors-tbody', SAFETY_OUT_COLS, getOutstandingRows(COURSE.JUNIORS), {
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
  showBusy('Removing retirement…');
  if (stateIdx >= 0) {
    const result = await deleteFinisher(stateIdx);
    if (result?.error) { showBusy(''); showStatus(result.error, true); return; }
  } else if (!await removeMobileProgressRecord(bib, 'DNF')) {
    showBusy('');
    showStatus('Retirement record not found.', true);
    return;
  }
  showBusy('');
  showStatus(`Bib ${bib} unretired.`);
  renderSafety();
  renderHome();
}

export function wireSafety() {
  wireTabBar('safety-tab-bar', 'safety-tab-', 'data-safety-tab');

  // Ticks "Time now" independently of renderSafety() (which only runs on an actual data
  // change) — not page-scoped, same one-time-at-init convention as this app's other background
  // tickers (e.g. startServerPing() in connect.js), so it stays right even if Safety Check is
  // left open and untouched for a while.
  setInterval(updateSafetyClockLine, 1000);

  const onRetireClick = e => {
    const btn = e.target.closest('[data-action="retire"]');
    if (!btn) return;
    retireFromSafety(+btn.closest('[data-bib]')?.dataset.bib);
  };
  document.getElementById('safety-outstanding-seniors-tbody')?.addEventListener('click', onRetireClick);
  document.getElementById('safety-outstanding-juniors-tbody')?.addEventListener('click', onRetireClick);

  document.getElementById('safety-dnf-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="unretire"]');
    if (!btn) return;
    unretire(+btn.closest('[data-bib]')?.dataset.bib);
  });
}