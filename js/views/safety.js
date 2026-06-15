'use strict';

import { state } from '../state.js';
import { recordFinisher, deleteFinisher, getOutstandingCount } from '../finishers.js';
import { getEntriesOnCourse, getEntry, isEntryBanned } from '../entries.js';
import { getSIAccountedBibs, getSIBib, getSIRaceTime, getSIStatus } from '../si-results.js';
import { getResultsForCourse } from '../results.js';
import { setHTML, showStatus, showConfirmDialog } from '../ui.js';
import { COURSE } from '../constants.js';
import { showBusy } from '../utils.js';
import { renderHome } from './home.js';

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

  const outTbody = document.getElementById('safety-outstanding-tbody');
  if (outTbody) {
    outTbody.innerHTML = outstanding.map(e => `
      <tr>
        <td>${e.bibNumber}</td>
        <td>${(e.name || '') + (isEntryBanned(e) ? ' (banned)' : '')}</td>
        <td>${e.course || ''}</td>
        <td>${e.category || ''}</td>
        <td><button class="btn-sm btn-delete btn-retire-safety" data-bib="${e.bibNumber}">Retire</button></td>
      </tr>`).join('');
    outTbody.querySelectorAll('.btn-retire-safety').forEach(b =>
      b.addEventListener('click', () => retireFromSafety(+b.dataset.bib)));
  }

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

  const dnfTbody = document.getElementById('safety-dnf-tbody');
  if (dnfTbody) {
    dnfTbody.innerHTML = allDnfs.map(({ bib, idx }) => {
      const r = entryInfo(bib);
      const btn = idx >= 0
        ? `<button class="btn-sm btn-secondary btn-unretire" data-bib="${bib}">Unretire</button>`
        : '';
      return `<tr>
        <td>${bib}</td>
        <td>${r.name}</td>
        <td>${r.course}</td>
        <td>${r.category}</td>
        <td>${btn}</td>
      </tr>`;
    }).join('');
    dnfTbody.querySelectorAll('.btn-unretire').forEach(b =>
      b.addEventListener('click', () => unretire(+b.dataset.bib)));
  }

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

  // Position/time from state.results (populated by Format Results)
  const resultsByBib = new Map();
  for (const course of [COURSE.SENIORS, COURSE.JUNIORS]) {
    for (const r of getResultsForCourse(course)) {
      if (r.position < 9999) resultsByBib.set(+r.bibNumber, r);
    }
  }

  const finTbody = document.getElementById('safety-finished-tbody');
  if (finTbody) {
    finTbody.innerHTML = allFinished.map(f => {
      const r   = entryInfo(+f.number);
      const res = resultsByBib.get(+f.number);
      return `<tr>
        <td>${f.number}</td>
        <td>${r.name}</td>
        <td>${r.course}</td>
        <td>${r.category}</td>
        <td>${res ? res.position : ''}</td>
        <td>${res ? res.time     : ''}</td>
      </tr>`;
    }).join('');
  }

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
  const result = await recordFinisher(bib, '', 'DNF');
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
  document.querySelectorAll('#safety-tab-bar [data-safety-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#safety-tab-bar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('#view-safety .tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`safety-tab-${btn.dataset.safetyTab}`)?.classList.add('active');
    });
  });
}