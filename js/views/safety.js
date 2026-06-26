'use strict';

import { state } from '../state.js';
import { recordFinisher, deleteFinisher, getOutstandingCount } from '../finishers.js';
import { getEntriesOnCourse, getEntry, isEntryBanned } from '../entries.js';
import { getSIAccountedBibs, getSIBib, getSIRaceTime, getSIStatus } from '../si-results.js';
import { formatResults, getResultsForCourse } from '../results.js';
import { setHTML, showStatus, showConfirmDialog, wireTabBar, renderTable } from '../ui.js';
import { TABLES } from '../locale.js';
import { COURSE } from '../constants.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';

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

function buildNoShows() {
  return state.preEntries.map(pe => {
    // Accounted for if any entry directly references this pre-entry
    if (pe.participantNumber && state.entries.some(e => e.preEntry === pe.participantNumber)) return null;

    const peName = [pe.firstName, pe.lastName].filter(Boolean).join(' ').trim();
    const dob    = pe.dob || '';

    // Check for an entry with matching name+dob that wasn't linked (entered on the day)
    const dupEntry = state.entries.find(e => {
      if ((e.name || '').toUpperCase() !== peName.toUpperCase()) return false;
      return !dob || !e.dob || e.dob === dob;
    });

    return {
      name:              peName,
      dob:               pe.dob      || '',
      club:              pe.club     || '',
      category:          pe.category || '',
      participantNumber: pe.participantNumber || '',
      dupBib:            dupEntry ? dupEntry.bibNumber : null,
    };
  }).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.dob.localeCompare(b.dob));
}

function getFinishedBibs() {
  const bibs = new Set(
    state.finishers
      .filter(f => f.action === 'Finish' || f.action === 'DNF')
      .map(f => +f.number)
      .filter(n => n > 0)
  );
  for (const bib of getSIAccountedBibs()) bibs.add(bib);
  return bibs;
}

function entryInfo(bib) {
  const e = getEntry(bib);
  return {
    name:     (e?.name || '') + (isEntryBanned(e) ? ' (banned)' : ''),
    course:   e?.course   || '',
    category: e?.category || '',
  };
}

export function renderSafety() {
  const finishedBibs = getFinishedBibs();

  // ---- Outstanding ----
  const outstanding = [...state.entries]
    .filter(e => { const b = +e.bibNumber; return b > 0 && !finishedBibs.has(b); })
    .sort((a, b) => +a.bibNumber - +b.bibNumber);

  renderTable('safety-outstanding-tbody', SAFETY_OUT_COLS, outstanding, {
    rowAttrs: e => ({ 'data-bib': e.bibNumber }),
  });

  // ---- Retirees / DNFs ----
  // SW entries (with state index for unretire)
  const swDnfs = state.finishers
    .map((f, idx) => ({ bib: +f.number, idx }))
    .filter(d => d.bib > 0 && state.finishers[d.idx].action === 'DNF');
  const swDnfBibs = new Set(swDnfs.map(d => d.bib));

  // SI entries with a non-blank Status not already in SW list
  const siDnfs = state.siResults
    .filter(r => getSIStatus(r) && getSIBib(r) > 0 && !swDnfBibs.has(getSIBib(r)))
    .map(r => ({ bib: getSIBib(r), idx: -1 }));

  // Deduplicate by bib (SW wins), sort by bib
  const allDnfs = [...swDnfs, ...siDnfs]
    .filter((d, i, arr) => arr.findIndex(x => x.bib === d.bib) === i)
    .sort((a, b) => a.bib - b.bib);

  const dnfRows = allDnfs.map(({ bib, idx }) => {
    const r = entryInfo(bib);
    return { bib, idx, name: r.name, course: r.course, category: r.category };
  });
  renderTable('safety-dnf-tbody', SAFETY_DNF_COLS, dnfRows, {
    rowAttrs: d => ({ 'data-bib': d.bib }),
  });

  // ---- Finishers ----
  // SW finishers
  const swFinished = state.finishers.filter(f => f.action === 'Finish' && +f.number > 0);
  const swFinishedBibs = new Set(swFinished.map(f => +f.number));

  // SI finishers (have a race time, not already in SW list)
  const siFinished = state.siResults
    .filter(r => getSIRaceTime(r) && getSIBib(r) > 0 && !swFinishedBibs.has(getSIBib(r)))
    .map(r => ({ number: getSIBib(r) }));

  const allFinished = [...swFinished, ...siFinished]
    .sort((a, b) => +a.number - +b.number);

  const { results } = formatResults();
  const resultsByBib = new Map();
  for (const course of [COURSE.SENIORS, COURSE.JUNIORS]) {
    for (const r of getResultsForCourse(course, results)) {
      if (r.position < 9999) resultsByBib.set(+r.bibNumber, r);
    }
  }

  const finRows = allFinished.map(f => {
    const r   = entryInfo(+f.number);
    const res = resultsByBib.get(+f.number);
    return { number: f.number, name: r.name, course: r.course, category: r.category, pos: res?.position ?? '', time: res?.time ?? '' };
  });
  renderTable('safety-finished-tbody', SAFETY_FIN_COLS, finRows);

  // ---- Early Starters ----
  const earlyStarters = state.finishers
    .filter(f => f.action === 'Start' && +f.number > 0)
    .sort((a, b) => +a.number - +b.number);

  const earlyRows = earlyStarters.map(f => {
    const r = entryInfo(+f.number);
    return { number: f.number, name: r.name, course: r.course, category: r.category, startTime: f.time || '' };
  });
  renderTable('safety-early-tbody', SAFETY_EARLY_COLS, earlyRows);

  // ---- No-shows ----
  const noShowRows = buildNoShows();
  renderTable('safety-noshows-tbody', SAFETY_NOSHOWS_COLS, noShowRows, {
    rowAttrs: r => ({ class: r.dupBib !== null ? 'row-timing-target' : '' }),
  });

  // ---- Header counts ----
  const senOut = getOutstandingCount(COURSE.SENIORS);
  const jnrOut = getOutstandingCount(COURSE.JUNIORS);

  const senDnf = allDnfs.filter(({ bib }) => getEntry(bib)?.course === COURSE.SENIORS).length;
  const jnrDnf = allDnfs.filter(({ bib }) => getEntry(bib)?.course === COURSE.JUNIORS).length;

  const senEntries = getEntriesOnCourse(COURSE.SENIORS);
  const jnrEntries = getEntriesOnCourse(COURSE.JUNIORS);
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
  // Re-find the DNF index at confirm time, not at render time
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