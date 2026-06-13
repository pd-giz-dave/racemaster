'use strict';

import { state } from './state.js';
import { saveResults, savePrizes } from './state.js';
import { COURSE, GENDER } from './constants.js';
import { iequal, timeToSeconds, secondsToTime, isValidRaceTime } from './utils.js';
import { getCategoryPriority, genderFromCategory } from './categories.js';
import { getEntry, getSortedEntries, isEntryBanned } from './entries.js';
import { adjustedFinishTime } from './time-utils.js';
import { getSortedFinishers } from './finishers.js';
import { getSIBib, getSIRaceTime, getSICourse, getSIStatus } from './si-results.js';

// ============================================================
// Results and prize generation (translated from Results.xml)
// ============================================================

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
      .filter(f => f.action === 'Finish' && f.source !== 'si');
    const swBibs = new Set(swFinishers.map(f => +f.number));

    // SI results for this course — skip bibs already in stopwatch source
    const siFinishers = state.siResults
      .filter(r => iequal(getSICourse(r), course) && getSIBib(r) > 0 && getSIRaceTime(r))
      .map(r => ({ action: 'Finish', number: getSIBib(r), time: getSIRaceTime(r), source: 'si' }))
      .filter(f => {
        if (swBibs.has(+f.number)) {
          clashWarnings.push(`Bib ${f.number} has stopwatch and SI result — SI ignored`);
          return false;
        }
        return true;
      });

    // Merge and sort by adjusted race time
    const allCourseFinishers = [...swFinishers, ...siFinishers]
      .sort((a, b) => {
        const ea = +a.number > 0 ? getEntry(+a.number) : null;
        const eb = +b.number > 0 ? getEntry(+b.number) : null;
        const ta = ea && a.time ? adjustedFinishTime(ea, a.time) : a.time;
        const tb = eb && b.time ? adjustedFinishTime(eb, b.time) : b.time;
        return timeToSeconds(ta) - timeToSeconds(tb);
      });

    const finishers = allCourseFinishers.map(f => {
      const entry = +f.number > 0 ? getEntry(+f.number) : null;
      const adjTime = f.source !== 'si' && entry && f.time && f.time !== '-' ? adjustedFinishTime(entry, f.time) : f.time;
      return { f, entry, adjTime };
    }).filter(({ adjTime, entry }) => isValidRaceTime(adjTime) && !isEntryBanned(entry));

    if (!finishers.length) continue;

    // Top-10 average for %Ldrs (computed from adjTimes before results are saved)
    const top10     = finishers.slice(0, 10);
    const avgTop10  = top10.reduce((s, { adjTime }) => s + timeToSeconds(adjTime), 0) / top10.length;

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
      const behindSecs   = secs - timeToSeconds(finishers[0].adjTime);
      const behindTime   = behindSecs > 0 ? secondsToTime(behindSecs) : '';
      const pctLdrs      = avgTop10 > 0 ? Math.round(avgTop10 / secs * 100) : '';

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
      if (!iequal(getSICourse(r), course)) continue;
      const status = getSIStatus(r);
      if (!status) continue;
      const bib = getSIBib(r);
      if (bib > 0) dnfBibs.add(bib);
    }

    for (const e of getSortedEntries()) {
      if (!iequal(e.course, course)) continue;
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
  const overallDepth = +state.event.prizeDepthOverall    || 3;
  const catDepth     = +state.event.prizeDepthPerCategory || 3;

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

  // Phase 1: collect names at base depths to identify multi-winners
  const sectionSets = [
    topNPerCat(juniors.filter(isFemale),          overallDepth),
    topNPerCat(juniors.filter(r => !isFemale(r)), overallDepth),
    topN(seniors,                                  overallDepth),
    topN(seniors.filter(isFemale),                 overallDepth),
    topN(seniors.filter(r => !isFemale(r)),        overallDepth),
    topNPerCat(seniors.filter(isFemale),           catDepth),
    topNPerCat(seniors.filter(r => !isFemale(r)), catDepth),
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

  addFixedByCat('Junior Girls',              juniors.filter(isFemale),          overallDepth, true);
  addFixedByCat('Junior Boys',               juniors.filter(r => !isFemale(r)), overallDepth, true);
  addFixed('Senior Overall',                 seniors,                            'Overall',        overallDepth, false);
  addFixed('Senior Female Overall',          seniors.filter(isFemale),           'Overall Female', overallDepth, false);
  addFixed('Senior Male Overall',            seniors.filter(r => !isFemale(r)), 'Overall Male',   overallDepth, false);
  addExpandedByCat('Senior Female Categories', seniors.filter(isFemale),          false);
  addExpandedByCat('Senior Male Categories',   seniors.filter(r => !isFemale(r)), false);

  state.prizes = prizes;
  await savePrizes();
}

/** Get results sorted by position for a course */
export function getResultsForCourse(course) {
  return state.results
    .filter(r => iequal(r.course, course))
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

/**
 * Calculate the percent behind leader and time behind for a result.
 * leaderSecs: the leader's time in seconds
 * mySecs: this runner's time in seconds
 */
export function calcBehind(leaderSecs, mySecs) {
  if (!leaderSecs) return { behindPercent: '', behindTime: '' };
  const diff = mySecs - leaderSecs;
  if (diff <= 0) return { behindPercent: '0.0', behindTime: '00:00:00' };
  return {
    behindPercent: (diff / leaderSecs * 100).toFixed(1),
    behindTime:    secondsToTime(diff),
  };
}

/**
 * Check if any records have been broken.
 * Returns {maleRecord, femaleRecord} each as {broken, time, name} or null.
 */
export function checkRecords() {
  const maleRecord   = state.event.maleRecord;
  const femaleRecord = state.event.femaleRecord;
  const result = { male: null, female: null };

  const maleResults = state.results.filter(r =>
    isValidRaceTime(r.time) &&
    (genderFromCategory(r.category) === GENDER.MALE)
  ).sort((a,b) => a.position - b.position);

  const femaleResults = state.results.filter(r =>
    isValidRaceTime(r.time) &&
    (genderFromCategory(r.category) === GENDER.FEMALE)
  ).sort((a,b) => a.position - b.position);

  if (maleResults.length && maleRecord) {
    const winnerSecs = timeToSeconds(maleResults[0].time);
    if (winnerSecs > 0 && winnerSecs < timeToSeconds(maleRecord)) {
      result.male = { broken: true, time: maleResults[0].time, name: maleResults[0].name };
    }
  }
  if (femaleResults.length && femaleRecord) {
    const winnerSecs = timeToSeconds(femaleResults[0].time);
    if (winnerSecs > 0 && winnerSecs < timeToSeconds(femaleRecord)) {
      result.female = { broken: true, time: femaleResults[0].time, name: femaleResults[0].name };
    }
  }

  return result;
}