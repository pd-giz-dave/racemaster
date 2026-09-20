'use strict';

import { state } from './state.js';
import { getEntry, isEntryBanned, getEntriesOnCourse, getEntryName } from './entries.js';
import { derivePairGender, getCategoryPriority } from './categories.js';
import { getOutstandingCount } from './finishers.js';
import { getSIAccountedBibs, getSIBib, getSIRaceTime, getSIStatus } from './si-results.js';
import { formatResults, resolveFinishSources } from './results.js';
import { COURSE } from './constants.js';
import { getMobileCheckpointTimes, CP_RETIRE } from './mobile-checkpoints.js';

// Every bib-number clash between SI results, the stopwatch/manual Finishers list, and Mobile
// Files' Update Progress, across both courses — the same conflicts formatResults() itself
// resolves (SI wins, then stopwatch, then mobile — see resolveFinishSources()'s own doc), surfaced
// here too so a race director watching Safety Check (who may never open Results & Prize List
// directly) still sees that one of these bibs' recorded finish time might not be the one actually
// used. A conflict includes two sources disagreeing on whether a bib even finished at all (one
// says Finish, another says DNF/retired) just as much as two sources agreeing it finished but
// disagreeing on the time — resolveFinishSources() treats both the same way. Also includes a
// stopwatch/mobile clash over an early/late Start record (resolveStartSources() below) — the same
// kind of "recorded twice, which do I trust" problem, just with no SI side to it at all.
export function getBibConflictWarnings() {
  const finishWarnings = [COURSE.SENIORS, COURSE.JUNIORS].flatMap(course => resolveFinishSources(course).warnings);
  return [...finishWarnings, ...resolveStartSources().warnings];
}

// Just the bare bib numbers behind getBibConflictWarnings() above, across both courses and both
// Finish/DNF and Start conflicts — for a caller that wants to flag a row rather than read prose.
// js/mobile-files-progress.js's buildProgressRows() uses this to highlight the Progress tab's own
// row for a conflicted bib, the same one Results & Prize List and this file's own Finished/
// Retirees/Early Starters all already resolve (SI wins, then stopwatch, then mobile — see
// resolveFinishSources()'s own doc in results.js; resolveStartSources() below for Start, stopwatch
// then mobile, no SI) — so a race director scanning Mobile Files' Progress tab sees the same
// signal without having to cross-reference the warning banner's text against every row by eye.
export function getConflictedBibs() {
  const bibs = new Set();
  for (const course of [COURSE.SENIORS, COURSE.JUNIORS]) {
    for (const bib of resolveFinishSources(course).conflictedBibs) bibs.add(bib);
  }
  for (const bib of resolveStartSources().conflictedBibs) bibs.add(bib);
  return bibs;
}

// Every bib's own resolved Finish/DNF verdict — { source, status, time } — across both courses at
// once, from the exact same priority resolution formatResults() uses (resolveFinishSources() in
// results.js: SI wins, then stopwatch, then mobile). This is what getDnfRows()/getFinishedRows()
// below are built from, so Safety Check can never show one bib as both a Finisher and a Retiree
// at once, nor disagree with what Results & Prize List actually computed for it.
//
// A bib with no matching Entry at all ("invalid" — see entryInfo()'s own doc below) never appears
// here: resolveFinishSources() is course-based (it needs to know which of Seniors/Juniors to
// check), and a bib with no Entry has no course to resolve against — it's already excluded from
// Results itself for the same reason. getDnfRows()/getFinishedRows() union such a bib back in
// separately, unresolved (there's no course-scoped conflict to resolve without an Entry), exactly
// as they did before this function existed.
function resolveAllFinishVerdicts() {
  const merged = new Map();
  for (const course of [COURSE.SENIORS, COURSE.JUNIORS]) {
    const { winners } = resolveFinishSources(course);
    for (const w of winners) merged.set(w.bib, w);
  }
  return merged;
}

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

// "Truly finished", DNF/retired excluded — the same bib set getFinishedRows() itself builds its
// rows from (resolveAllFinishVerdicts()'s own winning Finish verdicts, plus any invalid bib), so
// this can never disagree with what actually shows up there or on Results & Prize List: a bib
// whose winning verdict is DNF (even if some other, lower-priority source recorded a Finish for
// it) is correctly excluded here rather than double-counted as both finished and DNF.
export function getFinishedOnlyBibs() {
  const verdicts = resolveAllFinishVerdicts();
  const bibs = new Set([...verdicts.entries()].filter(([, v]) => v.status === 'Finish').map(([bib]) => bib));
  for (const bib of unresolvedBibsFor('Finish', verdicts)) bibs.add(bib);
  return bibs;
}

// One row per category actually used by an entry, in age order — for the Results page's
// Progress tab, to judge when it's safe to do the prize presentation. "Entries" is every
// bib'd entry in the category regardless of finish status, so it's populated before any
// finishers are recorded, and always equals finished + outstanding + dnf — the three
// branches below are mutually exclusive and exhaustive over every counted entry. "Finished"
// excludes DNF/retirees (getFinishedOnlyBibs); "dnf" is anyone accounted for (finished,
// DNF'd, or SI-accounted — getFinishedBibs) but not truly finished; "outstanding" is
// everyone else — same "not accounted for" definition getOutstandingRows() already uses,
// just grouped by category instead of course. Entries with no resolvable category
// (bad/missing DOB, manual data issue) get folded into a synthetic "Uncategorised" row
// rather than silently dropped — the one thing this tab must never do is hide someone
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
    const row = byCategory.get(cat) || { category: cat, entries: 0, finished: 0, outstanding: 0, dnf: 0 };
    row.entries++;
    if (finishedBibs.has(bib)) row.finished++;
    else if (accountedBibs.has(bib)) row.dnf++;
    else row.outstanding++;
    byCategory.set(cat, row);
  }
  return [...byCategory.values()].sort((a, b) =>
    getCategoryPriority(a.category) - getCategoryPriority(b.category));
}

// `invalid` is true when `bib` has no matching Entry at all — either not yet added (the race
// director hasn't got to it yet) or a mistyped/unregistered number a phone genuinely recorded;
// there's no way to tell those two apart from the data alone, and both need the exact same
// treatment: shown, not silently dropped, but clearly flagged rather than looking like an
// ordinary resolved row. Every caller below (getDnfRows/getFinishedRows/getEarlyStarterRows,
// and mobile-files-progress.js's buildProgressRows()) passes this straight through onto its own
// row so the view layer can apply the same row-error styling Finishers/Entries already use for
// an equivalent "bib not in Entries" case.
export function entryInfo(bib) {
  const e  = getEntry(bib);
  const pg = e?.partner ? derivePairGender(e.gender, e.partner.gender) : '';
  return {
    name:     getEntryName(e) + (isEntryBanned(e) ? ' (banned)' : ''),
    course:   e?.course   || '',
    category: pg ? `${e?.category || ''} ${pg}`.trim() : (e?.category || ''),
    invalid:  !e,
  };
}

// Every bib with SOME real record — a mobile checkpoint sighting, a mobile Start/Finish/DNF/etc
// entry, or a manual stopwatch entry — but no matching Entry at all, and not yet accounted for
// (getFinishedBibs() — already shown on the Finished/DNF tabs instead, via unresolvedBibsFor()'s
// own equivalent union there). A person recording splits under a mistyped or genuinely
// unregistered bib is still a person out on the course — this app has a duty of care to keep
// tracking them until they're accounted for, the same reasoning that already keeps such a bib
// visible (flagged) on Mobile Files' own Progress tab and this file's Finished/DNF rows, just not
// previously extended to Outstanding.
function unregisteredOutstandingBibs(finishedBibs) {
  const seen = new Set();
  for (const f of [...state.finishers, ...state.mobileProgress]) {
    const bib = +f.number;
    if (bib > 0) seen.add(bib);
  }
  for (const r of state.mobileCheckpoints) {
    const bib = +r.bibNumber;
    if (bib > 0) seen.add(bib);
  }
  return [...seen].filter(bib => !getEntry(bib) && !finishedBibs.has(bib));
}

// `course` filters the real, registered entries as before; an unregistered bib has no course
// field to filter by at all — there's no way to know which course they're actually running — so
// every one is included regardless of which course's tab is asking, rather than silently dropped
// from whichever tab doesn't happen to match a course it never had. Carries `invalid: true` (see
// entryInfo()'s own doc) purely so the view layer can flag it the same way Finished/DNF/Early
// Starters rows already do — this app never distinguishes "no Entry yet" from "mistyped/
// unregistered" from the data alone, and both need the same "shown, not silently dropped, but
// clearly flagged" treatment.
export function getOutstandingRows(course) {
  const finishedBibs = getFinishedBibs();
  const registered = [...state.entries]
    .filter(e => { const b = +e.bibNumber; return b > 0 && !finishedBibs.has(b) && (!course || e.course === course); });
  const unregistered = unregisteredOutstandingBibs(finishedBibs)
    .map(bib => ({ bibNumber: String(bib), name: '', course: '', category: '', gender: '', partner: null, invalid: true }));
  return [...registered, ...unregistered].sort((a, b) => +a.bibNumber - +b.bibNumber);
}

// Where (literal "Finish", or "CPn") and when (raw elapsed-since-start, '' if unknown) a bib
// actually retired — for the Retirees tab. A stopwatch retiree is always "Finish" (the
// Finishers page has no checkpoint concept); its time is whatever the operator typed, or ''
// for the common case of no time given at all. A mobile retiree's time comes already computed
// (see computeCpTimes'/expectedFinisherEntries' own docs in mobile-files-progress.js — a real
// elapsed value when derivable, '' otherwise), and its location is "Finish" unless
// state.mobileCheckpoints shows the CP_RETIRE sentinel at some checkpoint for this bib, in
// which case that checkpoint is where it actually happened. An SI-only DNF has no location or
// time concept at all — both come back blank rather than guessing.
function getRetireDetails(bib, idx) {
  if (idx >= 0) {
    const time = state.finishers[idx].time || '';
    // '-' is finishers.js's own "no time given" marker; a stopwatch record has no device
    // time-of-day concept at all.
    return { where: 'Finish', when: time === '-' ? '' : time, whenTimeOfDay: '' };
  }
  const mobile = state.mobileProgress.find(f => f.action === 'DNF' && +f.number === bib);
  if (mobile) {
    const cpRow = state.mobileCheckpoints.find(r => +r.bibNumber === bib);
    const cpEntry = cpRow && Object.entries(getMobileCheckpointTimes(cpRow)).find(([, t]) => t === CP_RETIRE);
    return { where: cpEntry ? `CP${cpEntry[0]}` : 'Finish', when: mobile.time || '', whenTimeOfDay: mobile.timeOfDay || '' };
  }
  return { where: '', when: '', whenTimeOfDay: '' }; // SI-only DNF
}

// Every bib recorded as `status` (Finishers list, Mobile Files, or SI) but with no matching Entry
// at all — invisible to resolveAllFinishVerdicts() (see its own doc: there's no course to resolve
// a conflict against without one — the fallback to an Entry's own course in
// resolveFinishSources() itself needs that same Entry to exist) — unioned back into
// getDnfRows()/getFinishedRows() below, unresolved, same permissive treatment they had before
// conflict resolution existed at all.
function unresolvedBibsFor(status, verdicts) {
  const bibs = new Set(
    [...state.finishers, ...state.mobileProgress]
      .filter(f => f.action === status && +f.number > 0)
      .map(f => +f.number)
  );
  for (const r of state.siResults) {
    const bib = getSIBib(r);
    if (bib <= 0) continue;
    if (status === 'Finish' && getSIRaceTime(r)) bibs.add(bib);
    else if (status === 'DNF' && !getSIRaceTime(r) && getSIStatus(r)) bibs.add(bib);
  }
  // Anyone resolveAllFinishVerdicts() actually reached a verdict for (whatever that verdict is)
  // is already correctly handled via that verdict — only a bib with NO verdict at all is left
  // here: no matching Entry at all ("invalid" — see entryInfo()'s own doc below), or one whose
  // own course field isn't Seniors/Juniors (resolveFinishSources() is course-based, so either way
  // there's no course to resolve a cross-source conflict against). Unioned back in unresolved,
  // same permissive treatment this had before conflict resolution existed at all.
  for (const bib of [...bibs]) if (verdicts.has(bib)) bibs.delete(bib);
  return bibs;
}

export function getDnfRows() {
  const verdicts = resolveAllFinishVerdicts();
  const bibs = [...new Set([
    ...[...verdicts.entries()].filter(([, v]) => v.status === 'DNF').map(([bib]) => bib),
    ...unresolvedBibsFor('DNF', verdicts),
  ])].sort((a, b) => a - b);

  return bibs.map(bib => {
    const verdict = verdicts.get(bib); // undefined for an invalid bib — nothing was resolved
    // idx >= 0 only when the *winning* verdict is actually this bib's stopwatch record (or, for
    // an invalid bib with no verdict at all, whatever's genuinely in state.finishers) — a losing
    // stopwatch DNF that SI/mobile outranked must never point getRetireDetails() at its own
    // (overridden) time instead of the actual winning source's.
    const idx = (!verdict || verdict.source === 'stopwatch')
      ? state.finishers.findIndex(f => f.action === 'DNF' && +f.number === bib)
      : -1;
    const r = entryInfo(bib);
    const { where, when, whenTimeOfDay } = getRetireDetails(bib, idx);
    return { bib, idx, name: r.name, course: r.course, category: r.category, where, when, whenTimeOfDay, invalid: r.invalid };
  });
}

export function getFinishedRows() {
  const verdicts = resolveAllFinishVerdicts();
  const bibs = [...new Set([
    ...[...verdicts.entries()].filter(([, v]) => v.status === 'Finish').map(([bib]) => bib),
    ...unresolvedBibsFor('Finish', verdicts),
  ])].sort((a, b) => a - b);

  const { seniors, juniors } = formatResults();
  const resultsByBib = new Map();
  for (const r of [...seniors, ...juniors]) {
    if (r.position < 9999) resultsByBib.set(+r.bibNumber, r);
  }

  return bibs.map(bib => {
    const r   = entryInfo(bib);
    const res = resultsByBib.get(bib);
    return { number: bib, name: r.name, course: r.course, category: r.category, pos: res?.position ?? '', time: res?.time ?? '', invalid: r.invalid };
  });
}

// This bib's own explicit Start record — an early/late start actually SEEN (stopwatch or
// mobile), not merely assumed to be the scheduled race start — or null if there isn't one. A
// plain per-bib lookup rather than reusing getEarlyStarterRows() below: the Safety Check page's
// "Last CP" column renders one bib at a time, so building that function's full combined list on
// every row would be wasted work. `timeOfDay` (mobile source only — see
// mobile-files-progress.js's expectedFinisherEntries doc) is the phone's own device time-of-day
// for this Start row, the view layer's preferred source over converting `time` (elapsed) via
// the race start; '' when there isn't one (a stopwatch Start has no such concept at all).
// Already stopwatch-first, same priority resolveStartSources() below applies for the exact same
// reason — a stopwatch/manual entry is a deliberate action, kept even though this doesn't go on
// to warn about a clash the way that function does (a per-bib lookup has no "everyone else" to
// compare against without doing the full-table work this exists specifically to avoid).
export function getExplicitStart(bib) {
  const b = +bib;
  const sw = state.finishers.find(f => f.action === 'Start' && +f.number === b);
  if (sw) return { time: sw.time || '', timeOfDay: '' };
  const mobile = state.mobileProgress.find(f => f.action === 'Start' && +f.number === b);
  return mobile ? { time: mobile.time || '', timeOfDay: mobile.timeOfDay || '' } : null;
}

// Every bib's own winning Start (early/late start) verdict — stopwatch wins over mobile, same
// reasoning as resolveFinishSources()'s own priority in results.js (a deliberate stopwatch/manual
// entry outranks a mobile Update Progress run's own record) — but SI never has a Start concept
// at all, so only these two sources ever compete here. Two sources both recording an early/late
// start for the same bib is exactly the same "which do I trust" conflict as a Finish/DNF clash
// (resolveFinishSources()'s own doc) even when they happen to agree on the time — a bib shouldn't
// be independently timed twice with nobody noticing either record exists.
function resolveStartSources() {
  const bySource = { stopwatch: new Map(), mobile: new Map() };
  for (const f of state.finishers) {
    const bib = +f.number;
    // `number` kept as the source's own raw value (not coerced) — getEarlyStarterRows() below
    // passes it straight through onto its row the same way it always has.
    if (f.action === 'Start' && bib > 0) bySource.stopwatch.set(bib, { time: f.time || '', timeOfDay: '', number: f.number });
  }
  for (const f of state.mobileProgress) {
    const bib = +f.number;
    if (f.action === 'Start' && bib > 0) bySource.mobile.set(bib, { time: f.time || '', timeOfDay: f.timeOfDay || '', number: f.number });
  }

  const byBib = new Map();
  for (const source of ['stopwatch', 'mobile']) {
    for (const [bib, v] of bySource[source]) {
      const list = byBib.get(bib) || [];
      list.push({ bib, source, ...v });
      byBib.set(bib, list);
    }
  }

  const warnings = [];
  const winners = [];
  const conflictedBibs = new Set();
  for (const [bib, entries] of byBib) {
    const winner = entries[0];
    winners.push(winner);
    if (entries.length > 1) {
      conflictedBibs.add(bib);
      warnings.push(`Bib ${bib} — an early/late start is recorded by both stopwatch and mobile (stopwatch used)`);
    }
  }
  return { winners, warnings, conflictedBibs };
}

export function getEarlyStarterRows() {
  const { winners } = resolveStartSources();
  return winners
    .sort((a, b) => a.bib - b.bib)
    .map(w => {
      const r = entryInfo(w.bib);
      return {
        number: w.number, name: r.name, course: r.course, category: r.category,
        startTime: w.time || '', startTimeOfDay: w.timeOfDay || '', invalid: r.invalid,
      };
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