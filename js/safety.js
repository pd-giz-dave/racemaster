'use strict';

import { state } from './state.js';
import { getEntry, isEntryBanned, getEntriesOnCourse, getEntryName } from './entries.js';
import { derivePairGender } from './categories.js';
import { getOutstandingCount } from './finishers.js';
import { getSIAccountedBibs, getSIBib, getSIRaceTime, getSIStatus } from './si-results.js';
import { formatResults } from './results.js';
import { COURSE } from './constants.js';

export function getFinishedBibs() {
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
  const e  = getEntry(bib);
  const pg = e?.partner ? derivePairGender(e.gender, e.partner.gender) : '';
  return {
    name:     getEntryName(e) + (isEntryBanned(e) ? ' (banned)' : ''),
    course:   e?.course   || '',
    category: pg ? `${e?.category || ''} ${pg}`.trim() : (e?.category || ''),
  };
}

export function getOutstandingRows() {
  const finishedBibs = getFinishedBibs();
  return [...state.entries]
    .filter(e => { const b = +e.bibNumber; return b > 0 && !finishedBibs.has(b); })
    .sort((a, b) => +a.bibNumber - +b.bibNumber);
}

export function getDnfRows() {
  const swDnfs = state.finishers
    .map((f, idx) => ({ bib: +f.number, idx }))
    .filter(d => d.bib > 0 && state.finishers[d.idx].action === 'DNF');
  const swDnfBibs = new Set(swDnfs.map(d => d.bib));

  const siDnfs = state.siResults
    .filter(r => getSIStatus(r) && getSIBib(r) > 0 && !swDnfBibs.has(getSIBib(r)))
    .map(r => ({ bib: getSIBib(r), idx: -1 }));

  return [...swDnfs, ...siDnfs]
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

  const siFinished = state.siResults
    .filter(r => getSIRaceTime(r) && getSIBib(r) > 0 && !swFinishedBibs.has(getSIBib(r)))
    .map(r => ({ number: getSIBib(r) }));

  const { seniors, juniors } = formatResults();
  const resultsByBib = new Map();
  for (const r of [...seniors, ...juniors]) {
    if (r.position < 9999) resultsByBib.set(+r.bibNumber, r);
  }

  return [...swFinished, ...siFinished]
    .sort((a, b) => +a.number - +b.number)
    .map(f => {
      const r   = entryInfo(+f.number);
      const res = resultsByBib.get(+f.number);
      return { number: f.number, name: r.name, course: r.course, category: r.category, pos: res?.position ?? '', time: res?.time ?? '' };
    });
}

export function getEarlyStarterRows() {
  return state.finishers
    .filter(f => f.action === 'Start' && +f.number > 0)
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