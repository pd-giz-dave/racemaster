'use strict';

import { state } from './state.js';
import { COURSE, GENDER } from './constants.js';
import { ciEq, timeToSeconds, secondsToTime, isValidRaceTime } from './utils.js';
import { calculateCategory, getCategoryPriority, genderFromCategory, derivePairGender } from './categories.js';
import { getEntry, getSortedEntries, isEntryBanned, getEntryName } from './entries.js';
import { adjustedFinishTime } from './time-utils.js';
import { getSortedFinishers } from './finishers.js';
import { getSIBib, getSIRaceTime, getSICourse, getSIStatus, getSINumSplits, getSISplitTime } from './si-results.js';
import { getMobileCheckpointNumbers, getMobileCheckpointTimes, getMobileCheckpointBib } from './mobile-checkpoints.js';
import { getSortedMobileProgress } from './mobile-progress.js';


const SOURCE_PRIORITY = ['SI', 'stopwatch', 'mobile'];
const STATUS_VERB = { Finish: 'finished', DNF: 'retired' };

// Records this source's own opinion of `bib` (Finish, with a time, or DNF/retired) into `map`,
// keyed by bib — at most one entry per bib per source. A single source recording BOTH for the
// same bib (a data inconsistency, e.g. a stopwatch edit history with a stray leftover row) isn't
// a genuine cross-source conflict, so it's resolved silently rather than warned about: Finish
// wins, matching the pre-existing "Finish always shown over DNF" convention this file already
// used before source-priority existed at all.
function recordVerdict(map, bib, status, time) {
  const existing = map.get(bib);
  if (!existing || (existing.status === 'DNF' && status === 'Finish')) map.set(bib, { status, time: time || '' });
}

// Resolves which of up to three sources — SI results, the stopwatch/manual Finishers list, and
// Mobile Files' Update Progress — gets to supply a bib's own Finish-or-DNF verdict for `course`,
// whenever more than one source has an opinion about the same bib. Priority is SI, then
// stopwatch, then mobile: an SI import is the most authoritative (a dedicated timing system's own
// export), a stopwatch/manual Finishers entry is a deliberate action by whoever's running that
// page, and a mobile Update Progress run is the most likely to have picked up something stray (a
// mistyped bib, a phone that shouldn't have been selected). A conflict isn't only two sources
// disagreeing on a Finish *time* — one source recording a Finish while another records a DNF/
// retirement for the very same bib is exactly the same "which do I trust" problem, resolved the
// same way, and is very much a real field scenario (a phone's Update Progress run picking up a
// bib that was actually retired at the finish line, recorded there on paper/stopwatch instead).
//
// Returns { siFinishers, swFinishers, mobileFinishers, winners, warnings, conflictedBibs }. The
// first three are each source's own *winning* Finish rows only (no bib appears in more than one,
// and none appear here at all if their winning verdict was actually DNF) — what formatResults()
// below builds results from. `winners` is every bib's own winning verdict as { bib, source,
// status, time }; also available keyed by bib via js/safety.js's own resolveAllFinishVerdicts(),
// the same ground truth Safety Check's Finished/Retirees tabs are built from, so the two pages
// can never disagree about which bibs are in which state. `warnings` is a human-readable list of
// every clash actually found, for display on both pages. `conflictedBibs` is just the bare bib
// numbers behind those warnings, for a caller that wants to flag a row rather than read prose —
// js/mobile-files-progress.js's buildProgressRows(), via js/safety.js's own getConflictedBibs().
export function resolveFinishSources(course) {
  const bySource = { SI: new Map(), stopwatch: new Map(), mobile: new Map() };

  for (const r of state.siResults) {
    const bib = getSIBib(r);
    if (bib <= 0) continue;
    // Falls back to the matched Entry's own course only when the SI row itself doesn't specify
    // one at all — a real SI export always carries CourseClass, but tolerating a blank one here
    // (rather than the row silently becoming invisible to every course) costs nothing when we
    // already know the bib's course from Entries anyway. An SI row that DOES specify a course,
    // even a wrong/mismatched one, is trusted as given — that's a genuine data question, not
    // something this fallback should paper over.
    const siCourse = getSICourse(r) || getEntry(bib)?.course || '';
    if (!ciEq(siCourse, course)) continue;
    const time = getSIRaceTime(r);
    if (time) { recordVerdict(bySource.SI, bib, 'Finish', time); continue; }
    if (getSIStatus(r)) recordVerdict(bySource.SI, bib, 'DNF', '');
  }
  for (const f of getSortedFinishers(course)) {
    const bib = +f.number;
    if (bib <= 0) continue;
    if (f.action === 'Finish') recordVerdict(bySource.stopwatch, bib, 'Finish', f.time);
    else if (f.action === 'DNF') recordVerdict(bySource.stopwatch, bib, 'DNF', f.time);
  }
  for (const f of getSortedMobileProgress(course)) {
    const bib = +f.number;
    if (bib <= 0) continue;
    if (f.action === 'Finish') recordVerdict(bySource.mobile, bib, 'Finish', f.time);
    else if (f.action === 'DNF') recordVerdict(bySource.mobile, bib, 'DNF', f.time);
  }

  // Group every source's opinion of each bib together, in priority order — the first entry for a
  // bib is always the highest-priority source that has one, i.e. the winner.
  const byBib = new Map();
  for (const source of SOURCE_PRIORITY) {
    for (const [bib, verdict] of bySource[source]) {
      const list = byBib.get(bib) || [];
      list.push({ bib, source, ...verdict });
      byBib.set(bib, list);
    }
  }

  const warnings = [];
  const winners = [];
  const conflictedBibs = new Set();
  for (const [bib, entries] of byBib) {
    const winner = entries[0];
    winners.push(winner);
    for (const loser of entries.slice(1)) {
      conflictedBibs.add(bib);
      warnings.push(
        `${course}: Bib ${bib} — ${winner.source} says ${STATUS_VERB[winner.status]}, `
        + `${loser.source} says ${STATUS_VERB[loser.status]} (${winner.source} used)`
      );
    }
  }

  const siFinishers      = winners.filter(w => w.source === 'SI' && w.status === 'Finish').map(w => ({ action: 'Finish', number: w.bib, time: w.time }));
  const swFinishers      = winners.filter(w => w.source === 'stopwatch' && w.status === 'Finish').map(w => ({ action: 'Finish', number: w.bib, time: w.time }));
  const mobileFinishers  = winners.filter(w => w.source === 'mobile' && w.status === 'Finish').map(w => ({ action: 'Finish', number: w.bib, time: w.time }));

  return { siFinishers, swFinishers, mobileFinishers, winners, warnings, conflictedBibs };
}

/** Generate full results from finishers and entries. Returns { warnings, seniors, juniors, pairsResults, prizes, helpersReport }. */
export function formatResults() {
  const results = [];

  const courses = [COURSE.SENIORS, COURSE.JUNIORS];

  const clashWarnings = [];

  for (const course of courses) {
    const { siFinishers, swFinishers, mobileFinishers, winners, warnings } = resolveFinishSources(course);
    clashWarnings.push(...warnings);
    const siBibSet = new Set(siFinishers.map(f => +f.number));

    // Assign each finisher a numeric sort key.
    // SI entries use their time. SW/mobile entries use adjusted time if available; untimed
    // entries get a fractional key interpolated between their nearest timed neighbours so they
    // stay in list order, interleaved with timed entries at the right point.
    const rawList = [...swFinishers, ...mobileFinishers, ...siFinishers];
    const keys = rawList.map(f => {
      const e = +f.number > 0 ? getEntry(+f.number) : null;
      const t = !siBibSet.has(+f.number) && e && f.time ? adjustedFinishTime(e, f.time, f) : f.time;
      return timeToSeconds(t);   // 0 means no time
    });
    // Fill zeros with interpolated values so untimed entries sit between their neighbours
    const filled = [...keys];
    for (let i = 0; i < filled.length; i++) {
      if (filled[i] > 0) continue;
      // find nearest timed predecessor and successor
      let prev = 0, next = 0;
      for (let j = i - 1; j >= 0; j--) if (keys[j] > 0) { prev = keys[j]; break; }
      for (let j = i + 1; j < keys.length; j++) if (keys[j] > 0) { next = keys[j]; break; }
      if (prev && next) filled[i] = (prev + next) / 2;
      else if (prev)    filled[i] = prev + 0.5;
      else if (next)    filled[i] = next - 0.5;
      else              filled[i] = i;          // entire list untimed: index order
    }
    const allCourseFinishers = rawList
      .map((f, i) => ({ f, key: filled[i], idx: i }))
      .sort((a, b) => a.key - b.key || a.idx - b.idx)
      .map(({ f }) => f);

    const finishers = allCourseFinishers.map(f => {
      const entry = +f.number > 0 ? getEntry(+f.number) : null;
      const adjTime = !siBibSet.has(+f.number) && entry && f.time && f.time !== '-' ? adjustedFinishTime(entry, f.time, f) : (f.time || '');
      return { f, entry, adjTime };
    }).filter(({ entry }) => entry && !isEntryBanned(entry));

    // Build result rows — a course with genuinely no Finish records at all (everyone still out,
    // or a course whose every bib's winning verdict turned out to be DNF) skips all of this
    // ranking-specific work below (nothing to rank), but must NOT skip the whole course: the
    // DNF-union section right after still needs to run, or a course with DNF-only bibs would show
    // no Retirees at all in Results & Prize List.
    const courseResults = [];
    if (finishers.length) {
      // Top-10 average for %Ldrs — only timed finishers count
      const timedFinishers = finishers.filter(({ adjTime }) => timeToSeconds(adjTime) > 0);
      const top10    = timedFinishers.slice(0, 10);
      const avgTop10 = top10.length
        ? top10.reduce((s, { adjTime }) => s + timeToSeconds(adjTime), 0) / top10.length
        : 0;

      // Course records for record-breaking flag
      const maleRecordSecs   = state.event.maleRecord   ? timeToSeconds(state.event.maleRecord)   : 0;
      const femaleRecordSecs = state.event.femaleRecord ? timeToSeconds(state.event.femaleRecord) : 0;

      let position = 0;

      for (const { f, entry, adjTime } of finishers) {
        position++;
        const bib  = +f.number;
        const secs = timeToSeconds(adjTime);
        const leaderSecs   = timeToSeconds(finishers[0].adjTime);
        const behindSecs   = secs > 0 && leaderSecs > 0 ? secs - leaderSecs : 0;
        const behindTime   = behindSecs > 0 ? secondsToTime(behindSecs) : '';
        const pctLdrs      = avgTop10 > 0 && secs > 0 ? Math.round(avgTop10 / secs * 100) : '';

        const gender = genderFromCategory(entry?.category || '');
        const recordSecs = gender === GENDER.FEMALE ? femaleRecordSecs : maleRecordSecs;
        const recordBreaker = recordSecs > 0 && secs > 0 && secs < recordSecs;

        const isPair     = !!(entry?.partner);
        const pairGender = isPair ? derivePairGender(entry.gender, entry.partner.gender) : '';

        courseResults.push({
          course,
          bibNumber:    bib || '',
          position,
          inCatPos:     0,
          name:         entry?.name     || '',
          club:         entry?.club     || '',
          category:     entry?.category || '',
          time:         adjTime,
          behindTime,
          pctLdrs,
          recordBreaker,
          prize:        '',
          isPair,
          partner:      entry?.partner  ?? null,
          pairGender,
        });
      }
    }

    // Add DNF entries at end — one per bib whose own *winning* verdict (resolveFinishSources()
    // above) is DNF, not merely "some source somewhere said DNF" — a bib can't win as both Finish
    // (already in courseResults, from siFinishers/swFinishers/mobileFinishers above) and DNF at
    // once, so addedBibs below is only ever a belt-and-braces check, not what actually prevents
    // this from double-counting.
    const addedBibs = new Set(courseResults.map(r => +r.bibNumber));
    const dnfBibs = new Set(winners.filter(w => w.status === 'DNF').map(w => w.bib));

    for (const e of getSortedEntries()) {
      if (!ciEq(e.course, course)) continue;
      if (!dnfBibs.has(+e.bibNumber)) continue;
      if (addedBibs.has(+e.bibNumber)) continue;
      if (isEntryBanned(e)) continue;
      addedBibs.add(+e.bibNumber);
      courseResults.push({
        course,
        bibNumber:     e.bibNumber,
        position:      9999,
        inCatPos:      0,
        name:          e.name,
        club:          e.club,
        category:      e.category,
        time:          'DNF',
        behindTime:    '',
        pctLdrs:       '',
        recordBreaker: false,
        prize:         '',
        isPair:        !!(e.partner),
        partner:       e.partner ?? null,
        pairGender:    e.partner ? derivePairGender(e.gender, e.partner.gender) : '',
      });
    }

    // Calculate in-category positions (excluding pairs from individual categories)
    const catGroups = {};
    for (const r of courseResults) {
      if (r.position >= 9999 || r.isPair) continue;
      const cat = r.category || '';
      if (!catGroups[cat]) catGroups[cat] = [];
      catGroups[cat].push(r);
    }
    for (const cat in catGroups) {
      catGroups[cat].sort((a,b) => a.position - b.position);
      catGroups[cat].forEach((r, i) => { r.inCatPos = i + 1; });
    }

    results.push(...courseResults);
  }

  const pairsResults = results.filter(r => r.isPair);

  // Calculate in-category positions for pairs: grouped by (isJunior, pairGender)
  const isJuniorCat = r => /^U\d/i.test(r.category || '');
  const pairCatGroups = {};
  for (const r of pairsResults) {
    if (r.position >= 9999) continue;
    const key = `${isJuniorCat(r) ? 'J' : 'S'}|${r.pairGender}`;
    if (!pairCatGroups[key]) pairCatGroups[key] = [];
    pairCatGroups[key].push(r);
  }
  for (const group of Object.values(pairCatGroups)) {
    group.sort((a, b) => a.position - b.position);
    group.forEach((r, i) => { r.inCatPos = i + 1; });
  }

  const depth         = +state.event.prizeDepthOverall || 3;
  const prizes        = [
    ...buildPrizes(results),
    ...(pairsResults.length ? buildPairsPrizes(pairsResults, depth) : []),
  ];
  const seniors       = getResultsForCourse(COURSE.SENIORS, results);
  const juniors       = getResultsForCourse(COURSE.JUNIORS, results);
  const helpersReport = buildHelpersReport();
  return { warnings: clashWarnings, seniors, juniors, pairsResults, prizes, helpersReport };
}

function buildPrizes(results) {
  const overallDepth    = +state.event.prizeDepthOverall           || 3;
  const catDepth        = +state.event.prizeDepthPerCategory       || 3;
  const juniorCatDepth  = +state.event.juniorPrizeDepthPerCategory || 3;

  const isFinisher = r => r.position < 9999 && !r.isPair;
  const byPos      = (a, b) => a.position - b.position;
  const isFemale   = r => genderFromCategory(r.category) === GENDER.FEMALE;

  const juniors = getResultsForCourse(COURSE.JUNIORS, results).filter(isFinisher);
  const seniors = getResultsForCourse(COURSE.SENIORS, results).filter(isFinisher);

  function catsSorted(results) {
    return [...new Set(results.map(r => r.category))]
      .sort((a, b) => getCategoryPriority(a) - getCategoryPriority(b));
  }

  function topN(results, n) {
    return [...results].sort(byPos).slice(0, n);
  }

  function topNPerCat(results, n) {
    return catsSorted(results).flatMap(cat =>
      results.filter(r => r.category === cat).sort(byPos).slice(0, n)
    );
  }

  // Phase 1: collect names at base depths to identify multi-winners.
  // Category sections use overallDepth+catDepth: in the worst case all overallDepth
  // overall slots are filled by one category, and the next catDepth runners beyond
  // them could themselves appear in a different overall section.
  const tentativeCatDepth = overallDepth + catDepth;
  const tentativeJuniorCatDepth = overallDepth + juniorCatDepth;
  const sectionSets = [
    topNPerCat(juniors.filter(isFemale),          tentativeJuniorCatDepth),
    topNPerCat(juniors.filter(r => !isFemale(r)), tentativeJuniorCatDepth),
    topN(seniors,                                  overallDepth),
    topN(seniors.filter(isFemale),                 overallDepth),
    topN(seniors.filter(r => !isFemale(r)),        overallDepth),
    topNPerCat(seniors.filter(isFemale),           tentativeCatDepth),
    topNPerCat(seniors.filter(r => !isFemale(r)), tentativeCatDepth),
  ].map(results => new Set(results.map(r => r.name)));

  const nameCounts = {};
  for (const nameSet of sectionSets) {
    for (const name of nameSet) nameCounts[name] = (nameCounts[name] || 0) + 1;
  }
  const multiWinners = new Set(Object.keys(nameCounts).filter(n => nameCounts[n] > 1));

  // Phase 2: build final prize list
  const prizes = [];

  function makeRow(section, category, isJunior, r, catPos) {
    return { section, category, entryCategory: r.category, isJunior, inCatPos: catPos, position: r.position, time: r.time, name: r.name, bibNumber: r.bibNumber, recordBreaker: !!r.recordBreaker, multiWinner: multiWinners.has(r.name) };
  }

  function addFixed(section, results, category, depth, isJunior) {
    [...results].sort(byPos).slice(0, depth).forEach((r, i) => prizes.push(makeRow(section, category, isJunior, r, i + 1)));
  }

  function addFixedByCat(section, results, depth, isJunior) {
    for (const cat of catsSorted(results))
      addFixed(section, results.filter(r => r.category === cat), cat, depth, isJunior);
  }

  // Category sections expand: include multi-winners but only non-multi count toward depth
  function addExpandedByCat(section, results, isJunior) {
    for (const cat of catsSorted(results)) {
      const sorted = [...results.filter(r => r.category === cat)].sort(byPos);
      let nonMultiCount = 0;
      let catPos = 0;
      for (const r of sorted) {
        const isMulti = multiWinners.has(r.name);
        if (!isMulti && nonMultiCount >= catDepth) break;
        catPos++;
        if (!isMulti) nonMultiCount++;
        prizes.push(makeRow(section, cat, isJunior, r, catPos));
      }
    }
  }

  addFixedByCat('Junior Girls',              juniors.filter(isFemale),          juniorCatDepth, true);
  addFixedByCat('Junior Boys',               juniors.filter(r => !isFemale(r)), juniorCatDepth, true);
  addFixed('Senior Overall',                 seniors,                            'Overall',        overallDepth, false);
  addFixed('Senior Female Overall',          seniors.filter(isFemale),           'Female', overallDepth, false);
  addFixed('Senior Male Overall',            seniors.filter(r => !isFemale(r)), 'Male',   overallDepth, false);
  addExpandedByCat('Senior Female Categories', seniors.filter(isFemale),          false);
  addExpandedByCat('Senior Male Categories',   seniors.filter(r => !isFemale(r)), false);

  return prizes;
}

function buildPairsPrizes(pairsResults, depth) {
  const byPos      = (a, b) => a.position - b.position;
  const isFinisher = r => r.position < 9999;
  const isJuniorCat = r => /^U\d/i.test(r.category || '');
  const finishers  = pairsResults.filter(isFinisher);
  if (!finishers.length) return [];

  const juniors = finishers.filter(isJuniorCat);
  const seniors = finishers.filter(r => !isJuniorCat(r));

  const prizes = [];
  const addGroup = (label, group, isJunior) => {
    const section = `${isJunior ? 'Junior ' : ''}${label} Pairs`;
    [...group.filter(r => r.pairGender === label)].sort(byPos).slice(0, depth)
      .forEach((r, i) => prizes.push({
        section,
        category:      label,
        entryCategory: r.category,
        isJunior,
        inCatPos:      i + 1,
        position:      r.position,
        time:          r.time,
        name:          getEntryName(r),
        bibNumber:     r.bibNumber,
        recordBreaker: false,
        multiWinner:   false,
      }));
  };

  for (const label of ['Male', 'Female', 'Mixed']) {
    addGroup(label, juniors, true);
    addGroup(label, seniors, false);
  }
  return prizes;
}

function buildHelpersReport() {
  return state.helpers
    .map(h => {
      const person    = state.people.find(p => ciEq(p.name, h.name || ''));
      const club      = h.club || person?.club || '';
      const cat       = h.dob && h.gender ? (calculateCategory(h.dob, h.gender) || '') : '';
      const lastRaced = person?.lastSeen || '';
      return { name: h.name || '', club, cat, role: h.role || '', lastRaced };
    })
    .sort((a, b) => (a.role || '').localeCompare(b.role || '') || (a.name || '').localeCompare(b.name || ''));
}

/**
 * Build one row per SI result that carries split times, joined against the
 * already-computed official results (for position/name/category), UNIONed with
 * one row per bib carrying mobile checkpoint data (see js/mobile-checkpoints.js) —
 * the mobile-derived elapsed times are approximate/raw (crossing timestamp minus
 * the stopwatch's own start timestamp) and get the same early/late-start and
 * clock-offset correction applied here, via adjustedFinishTime(), that ordinary
 * finish times already get in formatResults() above — that correction is this
 * function's job, not Mobile Files' own Progress tab, which only ever shows the
 * raw values.
 *
 * A union, not an attachment onto SI's own row list, because state.siResults is
 * empty for the common mobile-only event — attaching cpTimes only to existing SI
 * rows would show nothing at all in that case, the primary one this serves.
 *
 * SI's split times are cumulative (elapsed since the start), not leg times —
 * each split/finish-time value is returned as { cumulative, delta }, where
 * delta is the time since the previous control (or, for the finish, since
 * the last control). Mobile checkpoint times have no leg-delta concept (no
 * intermediate splits of their own), so cpTimes are plain 'HH:MM:SS' strings.
 *
 * Returns { maxSplits, maxCp, cpNumbers, rows }.
 */
export function getSplitsRows(seniors, juniors) {
  const maxSplits = Math.max(0, ...state.siResults.map(getSINumSplits));
  const cpNumbers = getMobileCheckpointNumbers();
  const maxCp = cpNumbers.length;
  if (!maxSplits && !maxCp) return { maxSplits: 0, maxCp: 0, cpNumbers: [], rows: [] };

  const resultsByBib = new Map();
  for (const r of [...seniors, ...juniors]) {
    if (r.position < 9999) resultsByBib.set(+r.bibNumber, r);
  }

  const rowsByBib = new Map();

  if (maxSplits) {
    for (const si of state.siResults) {
      const n = getSINumSplits(si);
      if (!n) continue;
      const bib = getSIBib(si);
      const r = bib > 0 ? resultsByBib.get(bib) : null;
      if (!r) continue;

      const cumTimes = Array.from({ length: n }, (_, i) => getSISplitTime(si, i + 1));
      const raceTime = getSIRaceTime(si) || r.time;

      // index 0 = start (always valid, always 0); 1..n = controls; n+1 = finish.
      // A zero-second leg (two controls reached in the same second) is legitimate
      // data, not missing data — only a negative gap or an unparsed time is rejected.
      const secs  = [0, ...cumTimes.map(timeToSeconds), timeToSeconds(raceTime)];
      const valid = [true, ...cumTimes.map(t => timeToSeconds(t) > 0), timeToSeconds(raceTime) > 0];
      const legDelta = i => (valid[i] && valid[i - 1] && secs[i] - secs[i - 1] >= 0)
        ? secondsToTime(secs[i] - secs[i - 1])
        : '';

      const splits = cumTimes.map((cumulative, i) => ({ cumulative, delta: legDelta(i + 1) }));
      const finishTime = { cumulative: raceTime, delta: legDelta(n + 1) };

      rowsByBib.set(bib, { position: r.position, bibNumber: bib, name: getEntryName(r), category: r.category, splits, finishTime, cpTimes: {} });
    }
  }

  if (maxCp) {
    for (const mc of state.mobileCheckpoints) {
      const bib = getMobileCheckpointBib(mc);
      const entry = getEntry(bib);
      if (!entry) continue;

      // Anchor on this bib's own *manual* Finish/DNF record if one exists (state.mobileProgress
      // has no position to anchor on — adjustedFinishTime() falls back to its own last-record
      // search there when this is null, see time-utils.js) — matters once mid-race clock resets
      // land manual-side: without this, a DNF'd/still-out bib's checkpoint time would silently
      // pick up whichever clock reset is last overall, not whichever was in effect when that bib
      // was actually seen.
      const finisherRecord = state.finishers.find(f => +f.number === bib && (f.action === 'Finish' || f.action === 'DNF')) || null;
      const raw = getMobileCheckpointTimes(mc);
      const cpTimes = {};
      for (const n of cpNumbers) {
        if (raw[n] != null) cpTimes[n] = adjustedFinishTime(entry, raw[n], finisherRecord);
      }

      const r = resultsByBib.get(bib);
      const existing = rowsByBib.get(bib);
      if (existing) {
        existing.cpTimes = cpTimes;
      } else if (r) {
        // Finished (via any of formatResults()'s three sources) but with no SI split row of its
        // own (e.g. a mobile-only finisher) — still show the actual finish time, not a blank cell.
        rowsByBib.set(bib, { position: r.position, bibNumber: bib, name: getEntryName(entry), category: entry.category || '', splits: [], finishTime: { cumulative: r.time }, cpTimes, status: 'finished' });
      } else {
        // Seen at a checkpoint but never finished — either retired (a DNF recorded anywhere:
        // manual, mobile, or SI status) or still genuinely out on the course. sortKey pushes
        // both to the bottom, same as formatResults()'s own DNF position 9999, without reusing
        // that literal as a value ever shown to the user (see buildSplitsBodyHTML).
        // finishTime: {} (not null) — splitCellHTML destructures its argument; a missing/
        // undefined argument falls back to its own default, but null does not and would throw.
        const dnf = isRecordedDnf(bib);
        rowsByBib.set(bib, { position: Number.MAX_SAFE_INTEGER, bibNumber: bib, name: getEntryName(entry), category: entry.category || '', splits: [], finishTime: {}, cpTimes, status: dnf ? 'dnf' : 'outstanding' });
      }
    }
  }

  const rows = [...rowsByBib.values()].sort((a, b) => a.position - b.position || a.bibNumber - b.bibNumber);
  return { maxSplits, maxCp, cpNumbers, rows };
}

/** True if bib has a DNF/retirement recorded anywhere — manual Finishers entry, mobile Update
 *  Progress, or an SI result with a non-blank Status. Used by getSplitsRows() to tell "retired"
 *  apart from "still out on the course" for a bib with a checkpoint sighting but no finish. */
function isRecordedDnf(bib) {
  if (state.finishers.some(f => f.action === 'DNF' && +f.number === bib)) return true;
  if (state.mobileProgress.some(f => f.action === 'DNF' && +f.number === bib)) return true;
  return state.siResults.some(r => getSIBib(r) === bib && getSIStatus(r));
}

/** Get results sorted by position for a course */
export function getResultsForCourse(course, results) {
  return results
    .filter(r => ciEq(r.course, course))
    .sort((a,b) => a.position - b.position);
}

export function computeAvgTop10(results) {
  const finishers = results.filter(r => r.position < 9999 && isValidRaceTime(r.time));
  const top10 = finishers.slice(0, 10);
  if (!top10.length) return '';
  const avgSecs = top10.reduce((s, r) => s + timeToSeconds(r.time), 0) / top10.length;
  return secondsToTime(Math.round(avgSecs));
}
