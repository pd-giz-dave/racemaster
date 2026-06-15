'use strict';

import { state } from './state.js';
import { saveResults, savePrizes, saveHelpersReport } from './state.js';
import { COURSE, GENDER } from './constants.js';
import { ciEq, timeToSeconds, secondsToTime, isValidRaceTime } from './utils.js';
import { calculateCategory, getCategoryPriority, genderFromCategory } from './categories.js';
import { getEntry, getSortedEntries, isEntryBanned } from './entries.js';
import { adjustedFinishTime } from './time-utils.js';
import { getSortedFinishers } from './finishers.js';
import { getSIBib, getSIRaceTime, getSICourse, getSIStatus } from './si-results.js';


/**
 * Generate full results from finishers and entries.
 * Populates state.results and state.prizes.
 */
export async function formatResults() {
  state.results = [];
  state.prizes  = [];

  const courses = [COURSE.SENIORS, COURSE.JUNIORS];

  const clashWarnings = [];

  for (const course of courses) {
    // Stopwatch finishers for this course (manual entries, source !== 'si')
    const swFinishers = getSortedFinishers(course)
      .filter(f => f.action === 'Finish');
    const swBibs = new Set(swFinishers.map(f => +f.number));

    // SI results for this course — skip bibs already in stopwatch source
    const siFinishers = state.siResults
      .filter(r => ciEq(getSICourse(r), course) && getSIBib(r) > 0 && getSIRaceTime(r))
      .map(r => ({ action: 'Finish', number: getSIBib(r), time: getSIRaceTime(r) }))
      .filter(f => {
        if (swBibs.has(+f.number)) {
          clashWarnings.push(`Bib ${f.number} has stopwatch and SI result — SI ignored`);
          return false;
        }
        return true;
      });
    const siBibSet = new Set(siFinishers.map(f => +f.number));

    // Assign each finisher a numeric sort key.
    // SI entries use their time. SW entries use adjusted time if available; untimed SW entries
    // get a fractional key interpolated between their nearest timed neighbours so they stay
    // in list order, interleaved with timed entries at the right point.
    const rawList = [...swFinishers, ...siFinishers];
    const keys = rawList.map(f => {
      const e = +f.number > 0 ? getEntry(+f.number) : null;
      const t = !siBibSet.has(+f.number) && e && f.time ? adjustedFinishTime(e, f.time) : f.time;
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
      const adjTime = !siBibSet.has(+f.number) && entry && f.time && f.time !== '-' ? adjustedFinishTime(entry, f.time) : (f.time || '');
      return { f, entry, adjTime };
    }).filter(({ entry }) => entry && !isEntryBanned(entry));

    if (!finishers.length) continue;

    // Top-10 average for %Ldrs — only timed finishers count
    const timedFinishers = finishers.filter(({ adjTime }) => timeToSeconds(adjTime) > 0);
    const top10    = timedFinishers.slice(0, 10);
    const avgTop10 = top10.length
      ? top10.reduce((s, { adjTime }) => s + timeToSeconds(adjTime), 0) / top10.length
      : 0;

    // Course records for record-breaking flag
    const maleRecordSecs   = state.event.maleRecord   ? timeToSeconds(state.event.maleRecord)   : 0;
    const femaleRecordSecs = state.event.femaleRecord ? timeToSeconds(state.event.femaleRecord) : 0;

    // Build result rows
    const courseResults = [];
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
      });
    }

    // Add DNF entries at end — from finishers list (action=DNF) and SI results (non-blank Status)
    const addedBibs = new Set(courseResults.map(r => +r.bibNumber));

    const dnfBibs = new Set(
      getSortedFinishers(course)
        .filter(f => f.action === 'DNF' && +f.number > 0)
        .map(f => +f.number)
    );
    // SI results with a non-blank Status are non-finishers (DNF, DNS, mispunch, etc.)
    for (const r of state.siResults) {
      if (!ciEq(getSICourse(r), course)) continue;
      const status = getSIStatus(r);
      if (!status) continue;
      const bib = getSIBib(r);
      if (bib > 0) dnfBibs.add(bib);
    }

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
      });
    }

    // Calculate in-category positions
    const catGroups = {};
    for (const r of courseResults) {
      if (r.position >= 9999) continue;
      const cat = r.category || '';
      if (!catGroups[cat]) catGroups[cat] = [];
      catGroups[cat].push(r);
    }
    for (const cat in catGroups) {
      catGroups[cat].sort((a,b) => a.position - b.position);
      catGroups[cat].forEach((r, i) => { r.inCatPos = i + 1; });
    }

    state.results.push(...courseResults);
  }

  await saveResults();
  await buildPrizes();
  await buildHelpersReport();
  return { warnings: clashWarnings };
}

/**
 * Build the ordered prize list from state.results.
 *
 * Order: junior girls by cat, junior boys by cat, senior overall,
 *        senior female overall, senior male overall,
 *        senior female by cat, senior male by cat.
 *
 * Category sections expand beyond catDepth so there are always catDepth
 * non-multi-winner entries per category (multi-winners counted but shown with *).
 * Overall and junior sections are fixed at overallDepth.
 */
export async function buildPrizes() {
  const overallDepth    = +state.event.prizeDepthOverall           || 3;
  const catDepth        = +state.event.prizeDepthPerCategory       || 3;
  const juniorCatDepth  = +state.event.juniorPrizeDepthPerCategory || 3;

  const isFinisher = r => r.position < 9999 && isValidRaceTime(r.time);
  const byPos      = (a, b) => a.position - b.position;
  const isFemale   = r => genderFromCategory(r.category) === GENDER.FEMALE;

  const juniors = getResultsForCourse(COURSE.JUNIORS).filter(isFinisher);
  const seniors = getResultsForCourse(COURSE.SENIORS).filter(isFinisher);

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
    return { section, category, isJunior, inCatPos: catPos, position: r.position, time: r.time, name: r.name, bibNumber: r.bibNumber, recordBreaker: !!r.recordBreaker, multiWinner: multiWinners.has(r.name) };
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

  state.prizes = prizes;
  await savePrizes();
}

export async function buildHelpersReport() {
  state.helpersReport = state.helpers
    .map(h => {
      const person    = state.people.find(p => ciEq(p.name, h.name || ''));
      const club      = h.club || person?.club || '';
      const cat       = h.dob && h.gender ? (calculateCategory(h.dob, h.gender) || '') : '';
      const lastRaced = person?.lastSeen || '';
      return { name: h.name || '', club, cat, role: h.role || '', lastRaced };
    })
    .sort((a, b) => (a.role || '').localeCompare(b.role || '') || (a.name || '').localeCompare(b.name || ''));
  await saveHelpersReport();
}

/** Get results sorted by position for a course */
export function getResultsForCourse(course) {
  return state.results
    .filter(r => ciEq(r.course, course))
    .sort((a,b) => a.position - b.position);
}

/** Get the prize list */
export function getPrizes() {
  return [...state.prizes];
}

/**
 * Compute the average time (HH:MM:SS) of the top N finishers for a course.
 * Uses state.results. Returns '' if no results.
 */
export function computeAvgTop10(course) {
  const finishers = getResultsForCourse(course).filter(r => r.position < 9999 && isValidRaceTime(r.time));
  const top10 = finishers.slice(0, 10);
  if (!top10.length) return '';
  const avgSecs = top10.reduce((s, r) => s + timeToSeconds(r.time), 0) / top10.length;
  return secondsToTime(Math.round(avgSecs));
}
