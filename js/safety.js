'use strict';

import { state } from './state.js';
import { getEntry, isEntryBanned, getEntriesOnCourse, getEntryName } from './entries.js';
import { derivePairGender, getCategoryPriority } from './categories.js';
import { getOutstandingCount } from './finishers.js';
import { getSIAccountedBibs, getSIBib, getSIRaceTime, getSIStatus } from './si-results.js';
import { formatResults } from './results.js';
import { COURSE } from './strings.js';

export function getFinishedBibs() {
  const bibs = new Set(
    [...state.finishers, ...state.mobileProgress]
      .filter(f => f.action === 'Finish' || f.action === 'DNF')
      .map(f => +f.number)
      .filter(n => n > 0)
  );
  for (const bib of getSIAccountedBibs()) bibs.add(bib);
  return bibs;
}

// "Truly finished", DNF/retired excluded — Finish action or an SI row with a race time.
// Deliberately separate from getFinishedRows()'s own inline version of this same idea below:
// that function uses the stopwatch/mobile finish set to decide which SI rows are *additional*
// (not already accounted for elsewhere) — reusing this combined set there instead would make
// every SI-only finisher's row test true against itself and silently drop them from that list.
export function getFinishedOnlyBibs() {
  const bibs = new Set(
    [...state.finishers, ...state.mobileProgress]
      .filter(f => f.action === 'Finish' && +f.number > 0).map(f => +f.number)
  );
  for (const r of state.siResults) {
    const bib = getSIBib(r);
    if (bib > 0 && getSIRaceTime(r)) bibs.add(bib);
  }
  return bibs;
}

// One row per category actually used by an entry, in age order — for the Results page's
// Progress tab, to judge when it's safe to do the prize presentation. "Finished" excludes
// DNF/retirees (getFinishedOnlyBibs); "outstanding" excludes anyone finished, DNF'd, or
// SI-accounted (getFinishedBibs) — same "not accounted for" definition getOutstandingRows()
// already uses, just grouped by category instead of course. Entries with no resolvable
// category (bad/missing DOB, manual data issue) get folded into a synthetic "Uncategorised"
// row rather than silently dropped — the one thing this tab must never do is hide someone
// who's genuinely still outstanding.
const UNCATEGORISED = 'Uncategorised';
export function getCategoryProgress() {
  const finishedBibs  = getFinishedOnlyBibs();
  const accountedBibs = getFinishedBibs();
  const byCategory = new Map();
  for (const e of state.entries) {
    const bib = +e.bibNumber;
    if (!bib) continue;
    const cat = e.category || UNCATEGORISED;
    const row = byCategory.get(cat) || { category: cat, finished: 0, outstanding: 0 };
    if (finishedBibs.has(bib)) row.finished++;
    else if (!accountedBibs.has(bib)) row.outstanding++;
    byCategory.set(cat, row);
  }
  return [...byCategory.values()].sort((a, b) =>
    getCategoryPriority(a.category) - getCategoryPriority(b.category));
}

export function entryInfo(bib) {
  const e  = getEntry(bib);
  const pg = e?.partner ? derivePairGender(e.gender, e.partner.gender) : '';
  return {
    name:     getEntryName(e) + (isEntryBanned(e) ? ' (banned)' : ''),
    course:   e?.course   || '',
    category: pg ? `${e?.category || ''} ${pg}`.trim() : (e?.category || ''),
  };
}

export function getOutstandingRows(course) {
  const finishedBibs = getFinishedBibs();
  return [...state.entries]
    .filter(e => { const b = +e.bibNumber; return b > 0 && !finishedBibs.has(b) && (!course || e.course === course); })
    .sort((a, b) => +a.bibNumber - +b.bibNumber);
}

export function getDnfRows() {
  const swDnfs = state.finishers
    .map((f, idx) => ({ bib: +f.number, idx }))
    .filter(d => d.bib > 0 && state.finishers[d.idx].action === 'DNF');
  const swDnfBibs = new Set(swDnfs.map(d => d.bib));

  // Mobile-recorded DNFs (state.mobileProgress) have no editable Finishers-page row of their
  // own, same as an SI-only DNF below — idx: -1.
  const mobileDnfs = state.mobileProgress
    .filter(f => f.action === 'DNF' && +f.number > 0 && !swDnfBibs.has(+f.number))
    .map(f => ({ bib: +f.number, idx: -1 }));
  const knownDnfBibs = new Set([...swDnfBibs, ...mobileDnfs.map(d => d.bib)]);

  const siDnfs = state.siResults
    .filter(r => getSIStatus(r) && getSIBib(r) > 0 && !knownDnfBibs.has(getSIBib(r)))
    .map(r => ({ bib: getSIBib(r), idx: -1 }));

  return [...swDnfs, ...mobileDnfs, ...siDnfs]
    .filter((d, i, arr) => arr.findIndex(x => x.bib === d.bib) === i)
    .sort((a, b) => a.bib - b.bib)
    .map(({ bib, idx }) => {
      const r = entryInfo(bib);
      return { bib, idx, name: r.name, course: r.course, category: r.category };
    });
}

export function getFinishedRows() {
  const swFinished = state.finishers.filter(f => f.action === 'Finish' && +f.number > 0);
  const swFinishedBibs = new Set(swFinished.map(f => +f.number));

  const mobileFinished = state.mobileProgress
    .filter(f => f.action === 'Finish' && +f.number > 0 && !swFinishedBibs.has(+f.number));
  const knownFinishedBibs = new Set([...swFinishedBibs, ...mobileFinished.map(f => +f.number)]);

  const siFinished = state.siResults
    .filter(r => getSIRaceTime(r) && getSIBib(r) > 0 && !knownFinishedBibs.has(getSIBib(r)))
    .map(r => ({ number: getSIBib(r) }));

  const { seniors, juniors } = formatResults();
  const resultsByBib = new Map();
  for (const r of [...seniors, ...juniors]) {
    if (r.position < 9999) resultsByBib.set(+r.bibNumber, r);
  }

  return [...swFinished, ...mobileFinished, ...siFinished]
    .sort((a, b) => +a.number - +b.number)
    .map(f => {
      const r   = entryInfo(+f.number);
      const res = resultsByBib.get(+f.number);
      return { number: f.number, name: r.name, course: r.course, category: r.category, pos: res?.position ?? '', time: res?.time ?? '' };
    });
}

export function getEarlyStarterRows() {
  const swStarts = state.finishers.filter(f => f.action === 'Start' && +f.number > 0);
  const swStartBibs = new Set(swStarts.map(f => +f.number));
  const mobileStarts = state.mobileProgress
    .filter(f => f.action === 'Start' && +f.number > 0 && !swStartBibs.has(+f.number));

  return [...swStarts, ...mobileStarts]
    .sort((a, b) => +a.number - +b.number)
    .map(f => {
      const r = entryInfo(+f.number);
      return { number: f.number, name: r.name, course: r.course, category: r.category, startTime: f.time || '' };
    });
}

export function buildNoShows() {
  return state.preEntries.map(pe => {
    if (pe.participantNumber && state.entries.some(e => e.preEntry === pe.participantNumber)) return null;

    const peName = [pe.firstName, pe.lastName].filter(Boolean).join(' ').trim();
    const dob    = pe.dob || '';

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

export function getSafetyCounts(dnfRows) {
  return {
    senOut:     getOutstandingCount(COURSE.SENIORS),
    jnrOut:     getOutstandingCount(COURSE.JUNIORS),
    senDnf:     dnfRows.filter(d => getEntry(d.bib)?.course === COURSE.SENIORS).length,
    jnrDnf:     dnfRows.filter(d => getEntry(d.bib)?.course === COURSE.JUNIORS).length,
    senEntries: getEntriesOnCourse(COURSE.SENIORS),
    jnrEntries: getEntriesOnCourse(COURSE.JUNIORS),
  };
}