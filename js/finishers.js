'use strict';

import { state } from './state.js';
import { saveFinishers } from './state.js';
import { COURSE } from './constants.js';
import { iequal } from './utils.js';
import { getEntry } from './entries.js';

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
    const bib = +f.number;
    if (!bib) continue;
    const entry = getEntry(bib);
    if (!entry?.course) continue;
    const key = courseKey(entry.course, bib);
    if (!state.finishNumbersMap[key]) state.finishNumbersMap[key] = [];
    state.finishNumbersMap[key].push(i);
  }
  buildSplitNumbers();
}

const NO_SPLIT_ACTIONS = new Set(['DNF', 'NoStart', 'Offset', 'Clock', 'Time']);

/** Assign sequential splitNumber (1-based) to each finisher; DNF/NoStart/Offset/Clock/Time get null. */
export function buildSplitNumbers() {
  let n = 1;
  for (const f of state.finishers) {
    f.splitNumber = NO_SPLIT_ACTIONS.has(f.action) ? null : n++;
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
export async function recordFinisher(bibNumber, timeStr, action) {
  action = action || 'Finish';
  const bib = +bibNumber;
  const entry = bib > 0 ? getEntry(bib) : null;

  // Reject illegal bibs outright — bib must exist in entries
  if (bib > 0 && !entry) {
    return { line: state.finishers.length, error: `Bib ${bib} not in entries` };
  }

  // Reject duplicate bibs: no two starts for same bib; no two finish/retire for same bib
  if (bib > 0) {
    const isStartAction = action === 'Start';
    const dupIdx = state.finishers.findIndex(f => {
      if (+f.number !== bib) return false;
      return isStartAction
        ? f.action === 'Start'
        : (f.action === 'Finish' || f.action === 'DNF');
    });
    if (dupIdx >= 0) {
      const dup = state.finishers[dupIdx];
      const ref = dup.splitNumber !== null && dup.splitNumber !== undefined ? dup.splitNumber : `[${dupIdx}]`;
      return { line: state.finishers.length, error: `Bib ${bib} already recorded at split ${ref}` };
    }
  }

  const idx = state.finishers.length;
  state.finishers.push({ action, number: bib || '', time: timeStr || '' });

  if (bib > 0 && entry?.course) {
    const key = courseKey(entry.course, bib);
    if (!state.finishNumbersMap[key]) state.finishNumbersMap[key] = [];
    state.finishNumbersMap[key].push(idx);
  }

  buildSplitNumbers();
  await saveFinishers();
  return { line: idx, error: '' };
}

/**
 * Update a finisher record (e.g. correct bib number or time).
 * Returns {error}
 */
export async function updateFinisher(idx, updates) {
  if (idx < 0 || idx >= state.finishers.length) return { error: 'Invalid index' };
  const f = state.finishers[idx];
  if (updates.number !== undefined) f.number = updates.number;
  if (updates.time   !== undefined) f.time   = updates.time;
  if (updates.action !== undefined) f.action = updates.action;
  buildFinishNumbersMap();
  await saveFinishers();
  return { error: '' };
}

/** Delete the finisher at stateIdx and all that follow it. */
/** Delete all finishers. */
export async function clearAllFinishers() {
  state.finishers = [];
  buildFinishNumbersMap();
  await saveFinishers();
}

export async function deleteFinishersFrom(stateIdx) {
  if (stateIdx < 0 || stateIdx >= state.finishers.length) return { error: 'Finisher not found', deleted: 0 };
  const deleted = state.finishers.length - stateIdx;
  state.finishers.splice(stateIdx);
  buildFinishNumbersMap();
  await saveFinishers();
  return { error: '', deleted };
}

/** Count entries on a course that have not finished (NORMAL) or retired (DNF) in the finishers list or SI results. */
export function getOutstandingCount(course) {
  const finishedOrRetiredBibs = new Set(
    state.finishers
      .filter(f => f.action === 'Finish' || f.action === 'DNF')
      .map(f => +f.number)
      .filter(n => n > 0)
  );
  // Inline SI results lookup (can't import si-results.js — circular dep)
  for (const r of state.siResults) {
    const bib = +(Object.keys(r).reduce((v, k) => v || (k.trim().toUpperCase() === 'RACENUMBER' ? r[k] : ''), '') || 0);
    const time   = Object.keys(r).reduce((v, k) => v || (k.trim().toUpperCase() === 'RACETIME' ? r[k] : ''), '');
    const status = Object.keys(r).reduce((v, k) => v || (k.trim().toUpperCase() === 'STATUS'   ? r[k] : ''), '');
    if (bib > 0 && (time || status)) finishedOrRetiredBibs.add(bib);
  }
  return state.entries.filter(e => {
    if (!iequal(e.course, course)) return false;
    const bib = +e.bibNumber;
    if (!bib) return false;
    return !finishedOrRetiredBibs.has(bib);
  }).length;
}

/** Get finishers in recording order, optionally filtered by course (derived from entries). */
export function getSortedFinishers(course) {
  if (!course) return [...state.finishers];
  return state.finishers.filter(f => {
    const entry = +f.number > 0 ? getEntry(+f.number) : null;
    return iequal(entry?.course || '', course);
  });
}

/** Delete a single finisher by index. */
export async function deleteFinisher(stateIdx) {
  if (stateIdx < 0 || stateIdx >= state.finishers.length) return { error: 'Invalid index' };
  state.finishers.splice(stateIdx, 1);
  buildFinishNumbersMap();
  await saveFinishers();
  return { error: '' };
}

/** Insert a blank finisher record above stateIdx. */
export async function insertFinisherAbove(stateIdx) {
  if (stateIdx < 0 || stateIdx > state.finishers.length) return { error: 'Invalid index', newIdx: -1 };
  state.finishers.splice(stateIdx, 0, { action: 'Finish', number: '', time: '' });
  buildFinishNumbersMap();
  await saveFinishers();
  return { error: '', newIdx: stateIdx };
}