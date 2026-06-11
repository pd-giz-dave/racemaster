'use strict';

import { state } from './state.js';
import { saveResults, savePrizes } from './state.js';
import { COURSE, GENDER, PRIZE_PRIORITY } from './constants.js';
import { iequal, timeToSeconds, secondsToTime, pad3, isValidRaceTime } from './utils.js';
import { getCategoryPriority, genderFromCategory } from './categories.js';
import { getEntry, getSortedEntries, isEntryBanned } from './entries.js';
import { adjustedFinishTime } from './time-utils.js';
import { getSortedFinishers } from './finishers.js';

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

  for (const course of courses) {
    const allCourseFinishers = getSortedFinishers(course).filter(f => f.action === 'Finish');
    const finishers = allCourseFinishers.map(f => {
      const entry = +f.number > 0 ? getEntry(+f.number) : null;
      const adjTime = entry && f.time && f.time !== '-' ? adjustedFinishTime(entry, f.time) : f.time;
      return { f, entry, adjTime };
    }).filter(({ adjTime, entry }) => isValidRaceTime(adjTime) && !isEntryBanned(entry));

    if (!finishers.length) continue;

    // Build result rows
    const courseResults = [];
    let position = 0;

    // Winner time for percent calculations
    const winnerSecs = timeToSeconds(finishers[0].adjTime);

    for (const { f, entry, adjTime } of finishers) {
      position++;
      const bib = +f.number;
      const secs = timeToSeconds(adjTime);
      const behindSecs = secs - winnerSecs;
      const behindPercent = winnerSecs > 0 ? ((secs - winnerSecs) / winnerSecs * 100).toFixed(1) : '';
      const behindTime   = behindSecs > 0 ? secondsToTime(behindSecs) : '';

      courseResults.push({
        course,
        bibNumber:     bib || '',
        position,
        inCatPos:      0,
        name:          entry?.name     || '',
        club:          entry?.club     || '',
        category:      entry?.category || '',
        time:          adjTime,
        behindPercent,
        behindTime,
        prize:         '',
      });
    }

    // Add DNF / retired entries at end (skip bibs already present from finisher records)
    const addedBibs = new Set(courseResults.map(r => +r.bibNumber));
    for (const e of getSortedEntries()) {
      if (!iequal(e.course, course)) continue;
      if (e.retired !== 'Y') continue;
      if (addedBibs.has(+e.bibNumber)) continue;
      if (isEntryBanned(e)) continue;
      courseResults.push({
        course,
        bibNumber: e.bibNumber,
        position:  9999,
        inCatPos:  0,
        name:      e.name,
        club:      e.club,
        category:  e.category,
        time:      'DNF',
        behindPercent: '',
        behindTime:    '',
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
}

/**
 * Build the prize list from state.results.
 */
export async function buildPrizes() {
  state.prizes = [];

  const overallDepth   = +state.event.prizeDepthOverall   || 3;
  const categoryDepth  = +state.event.prizeDepthPerCategory || 3;

  const courses = [COURSE.SENIORS, COURSE.JUNIORS];

  for (const course of courses) {
    const isJunior = course.toUpperCase().startsWith(COURSE.JUNIORS_PREFIX.toUpperCase());
    const courseResults = state.results
      .filter(r => iequal(r.course, course) && isValidRaceTime(r.time))
      .sort((a,b) => a.position - b.position);

    if (!courseResults.length) continue;

    // --- Overall prizes ---
    let overallCount = 0;
    for (const r of courseResults) {
      if (overallCount >= overallDepth) break;
      overallCount++;
      addPrize({
        position:  r.position,
        category:  'Overall',
        inCatPos:  overallCount,
        time:      r.time,
        number:    r.bibNumber,
        name:      r.name,
        priority:  PRIZE_PRIORITY.OVERALL + pad3(overallCount),
      });
    }

    // --- Per-category prizes ---
    const catWinners = {};

    for (const r of courseResults) {
      const cat = r.category || '';
      if (!cat) continue;
      if (!catWinners[cat]) catWinners[cat] = 0;
      if (catWinners[cat] >= categoryDepth) continue;

      catWinners[cat]++;
      const priority = getCategoryPriority(cat);
      addPrize({
        position:  r.position,
        category:  cat,
        inCatPos:  catWinners[cat],
        time:      r.time,
        number:    r.bibNumber,
        name:      r.name,
        priority:  PRIZE_PRIORITY.CATEGORY + pad3(priority) + pad3(catWinners[cat]),
      });
    }
  }

  // Sort prizes by priority
  state.prizes.sort((a,b) => {
    if (a.priority < b.priority) return -1;
    if (a.priority > b.priority) return 1;
    return 0;
  });

  // Mark prize column in results
  const prizeSet = new Set(state.prizes.map(p => `${p.number}|${p.category}`));
  for (const r of state.results) {
    r.prize = prizeSet.has(`${r.bibNumber}|${r.category}`) ? 'Y' : '';
  }

  await savePrizes();
  await saveResults();
}

function addPrize(prize) {
  state.prizes.push(prize);
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