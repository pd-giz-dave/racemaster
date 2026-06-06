'use strict';

import { state } from './state.js';
import { saveFinishers, saveSafety } from './state.js';
import { FINISHER, COURSE, GENDER } from './constants.js';
import { normaliseTime, iequal, cleanName } from './utils.js';
import { adjustedFinishTime } from './time-utils.js';
import { findEntryByBib, getEntry } from './entries.js';

// ============================================================
// Finish time recording logic (translated from Finishers.xml)
// ============================================================

/**
 * Build the finishNumbersMap: maps 'S101' → [finisher_index, ...] etc.
 * Key is course-prefix + bib number. Called after loading or modifying finishers.
 */
export function buildFinishNumbersMap() {
  state.finishNumbersMap = {};
  for (let i = 0; i < state.finishers.length; i++) {
    const f = state.finishers[i];
    if (!f.number || !f.course) continue;
    const key = courseKey(f.course, f.number);
    if (!state.finishNumbersMap[key]) state.finishNumbersMap[key] = [];
    state.finishNumbersMap[key].push(i);
  }
}

function courseKey(course, bibNumber) {
  const prefix = (course || COURSE.SENIORS).toUpperCase().charAt(0);
  return `${prefix}${bibNumber}`;
}

/** Get all finisher indices for a given bib and course */
export function getFinisherIndices(bibNumber, course) {
  return state.finishNumbersMap[courseKey(course || COURSE.SENIORS, bibNumber)] || [];
}

/** Get the primary (first) finisher record for a bib+course */
export function getFinisher(bibNumber, course) {
  const idxs = getFinisherIndices(bibNumber, course);
  return idxs.length > 0 ? state.finishers[idxs[0]] : null;
}

/**
 * Record a finisher.
 * bibNumber: the race number (or 0 for unknown)
 * timeStr: raw finish time string (HH:MM:SS or clock time)
 * course: COURSE.SENIORS or COURSE.JUNIORS
 * action: FINISHER.NORMAL, FINISHER.DNF, FINISHER.DSQ, etc.
 * Returns {position, error}
 */
export async function recordFinisher(bibNumber, timeStr, course, action) {
  course = course || COURSE.SENIORS;
  action = action || FINISHER.NORMAL;
  const bib = +bibNumber;

  // Determine position: next in sequence for this course
  const position = state.finishers.filter(f => iequal(f.course, course)).length + 1;

  const entry = bib > 0 ? getEntry(bib) : null;
  const name     = entry ? entry.name     : '';
  const club     = entry ? entry.club     : '';
  const category = entry ? entry.category : '';
  const entryObj = entry || { course, startTime: '' };

  // Compute adjusted time
  let adjustedTime = '';
  let timeToStore = timeStr || '';
  if (action === FINISHER.NORMAL && timeStr) {
    adjustedTime = adjustedFinishTime(entryObj, timeStr);
  }

  // Error check: duplicate bib
  let error = '';
  if (bib > 0) {
    const existing = getFinisherIndices(bib, course);
    if (existing.length > 0 && action === FINISHER.NORMAL) {
      error = `Bib ${bib} already recorded`;
    } else if (!entry) {
      error = `Bib ${bib} not in entries`;
    }
  }

  const idx = state.finishers.length;
  state.finishers.push({
    position:     position,
    action:       action,
    number:       bib || '',
    time:         timeToStore,
    name:         name,
    club:         club,
    category:     category,
    course:       course,
    error:        error,
    adjustedTime: adjustedTime,
    status:       '',
    source:       'manual',
  });

  // Update map
  if (bib > 0) {
    const key = courseKey(course, bib);
    if (!state.finishNumbersMap[key]) state.finishNumbersMap[key] = [];
    state.finishNumbersMap[key].push(idx);
  }

  await saveFinishers();
  return { position, error };
}

/**
 * Delete the last recorded finisher for a course (undo last finish).
 * Returns {error}
 */
export async function deleteLastFinisher(course) {
  course = course || COURSE.SENIORS;
  // Find last finisher for this course
  for (let i = state.finishers.length - 1; i >= 0; i--) {
    if (iequal(state.finishers[i].course, course)) {
      const f = state.finishers[i];
      state.finishers.splice(i, 1);
      buildFinishNumbersMap();
      await processFinishers();
      return { error: '', deleted: f };
    }
  }
  return { error: 'No finishers to delete' };
}

/**
 * Update a finisher record (e.g. correct bib number or time).
 * Returns {error}
 */
export async function updateFinisher(idx, updates) {
  if (idx < 0 || idx >= state.finishers.length) return { error: 'Invalid index' };
  const f = state.finishers[idx];
  if (updates.number   !== undefined) f.number       = updates.number;
  if (updates.time     !== undefined) f.time         = updates.time;
  if (updates.action   !== undefined) f.action       = updates.action;
  if (updates.course   !== undefined) f.course       = updates.course;
  if (updates.error    !== undefined) f.error        = updates.error;
  if (updates.status   !== undefined) f.status       = updates.status;

  // Recompute adjusted time if time or course changed
  if (updates.time !== undefined || updates.number !== undefined) {
    const entry = f.number > 0 ? getEntry(+f.number) : { course: f.course, startTime: '' };
    f.adjustedTime = f.action === FINISHER.NORMAL && f.time
      ? adjustedFinishTime(entry || { course: f.course, startTime: '' }, f.time)
      : '';
  }

  buildFinishNumbersMap();
  await saveFinishers();
  return { error: '' };
}

/**
 * Scan finishers: match bib numbers to entries, fill in name/club/category,
 * flag errors (unknown bib, duplicate, retired, wrong course).
 * Returns array of error descriptions.
 */
export async function scanFinishers() {
  const errors = [];
  buildFinishNumbersMap();

  for (let i = 0; i < state.finishers.length; i++) {
    const f = state.finishers[i];
    f.error = '';

    if (!f.number || +f.number <= 0) continue;
    const bib = +f.number;
    const entry = getEntry(bib);

    if (!entry) {
      f.error = `Bib ${bib} not in entries`;
      errors.push(f.error);
      continue;
    }

    // Fill in details
    f.name     = entry.name;
    f.club     = entry.club;
    f.category = entry.category;

    // Check course mismatch
    if (entry.course && f.course && !iequal(entry.course, f.course)) {
      f.error = `Bib ${bib} entered on ${entry.course} but recorded on ${f.course}`;
      errors.push(f.error);
    }

    // Check retired
    if (entry.retired === 'Y' && f.action === FINISHER.NORMAL) {
      f.error = `Bib ${bib} (${entry.name}) marked as retired`;
      errors.push(f.error);
    }

    // Check duplicate in same course
    const sameCourseDups = getFinisherIndices(bib, f.course).filter(idx2 => idx2 !== i);
    if (sameCourseDups.length > 0 && f.action === FINISHER.NORMAL) {
      f.error = `Bib ${bib} duplicate finish`;
      errors.push(f.error);
    }
  }

  await saveFinishers();
  return errors;
}

/**
 * Process finishers: compute adjusted times and re-sequence positions.
 * Should be called before generating results.
 */
export async function processFinishers() {
  let seniorPos = 0, juniorPos = 0;

  for (const f of state.finishers) {
    if (f.action !== FINISHER.NORMAL) continue;
    const course = f.course || COURSE.SENIORS;
    const isJunior = course.toUpperCase().startsWith(COURSE.JUNIORS_PREFIX.toUpperCase());

    if (isJunior) {
      juniorPos++;
      f.position = juniorPos;
    } else {
      seniorPos++;
      f.position = seniorPos;
    }

    const entry = f.number > 0 ? getEntry(+f.number) : null;
    f.adjustedTime = f.time
      ? adjustedFinishTime(entry || { course, startTime: '' }, f.time)
      : '';
  }

  await saveFinishers();
}

/**
 * Build the safety check list.
 * Returns array of {number, name, course, dob, category, status, reason}
 * for all entries that have not finished or been marked DNF/retired.
 */
export async function buildSafetyList() {
  const finishedBibs = new Set();
  for (const f of state.finishers) {
    if (f.number && (f.action === FINISHER.NORMAL || f.action === FINISHER.DNF)) {
      finishedBibs.add(+f.number);
    }
  }

  state.safety = [];
  for (const e of state.entries) {
    const bib = +e.bibNumber;
    if (!bib) continue;
    if (finishedBibs.has(bib)) continue;
    if (e.retired === 'Y') continue;

    state.safety.push({
      number:   bib,
      name:     e.name,
      course:   e.course,
      dob:      e.dob,
      category: e.category,
      status:   '',
      reason:   '',
    });
  }

  await saveSafety();
  return state.safety;
}

/**
 * Update a safety record status.
 * Returns {error}
 */
export async function updateSafetyStatus(bibNumber, status, reason) {
  const idx = state.safety.findIndex(s => +s.number === +bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not in safety list` };
  state.safety[idx].status = status || '';
  state.safety[idx].reason = reason || '';
  await saveSafety();
  return { error: '' };
}

/** Get count of outstanding (no status) safety records */
export function getOutstandingSafetyCount() {
  return state.safety.filter(s => !s.status).length;
}

/** Get finishers sorted by position for a given course */
export function getSortedFinishers(course) {
  return state.finishers
    .filter(f => !course || iequal(f.course, course))
    .sort((a, b) => (+a.position || 9999) - (+b.position || 9999));
}