'use strict';

import { state } from './state.js';
import { createEntry } from './schema.js';
import { SI } from './si-schema.js';
import { saveEntries, savePeople } from './state.js';
import { COURSE } from './constants.js';
import { normaliseDate, cleanName, ciEq } from './utils.js';
import { calculateCategory, calculateCourse } from './categories.js';
import { addPerson, sortPeople, getNextBibNumber, getNextDibberNumber } from './data.js';
import { usingDibbers } from './time-utils.js';


export function isBanned(p) {
  if (!p?.banned) return false;
  const [d, m, y] = p.banned.split('/').map(Number);
  if (!y) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return today <= new Date(y, m - 1, d);
}

export function isEntryBanned(entry) {
  const p = state.people.find(p => ciEq(p.name, entry.name || '') && p.dob === (entry.dob || ''));
  return isBanned(p);
}

/** Count entries on a given course */
export function getEntriesOnCourse(course) {
  return state.entries.filter(e => ciEq(e.course, course)).length;
}

/** Get the entry limit for a course */
export function getEntryLimit(course) {
  if (course && ciEq(course, COURSE.JUNIORS)) {
    return +state.event.juniorEntryLimit || 0;
  }
  return +state.event.entryLimit || 0;
}

/** Check if a course is full */
export function courseFull(course) {
  const limit = getEntryLimit(course);
  if (!limit) return false;
  return getEntriesOnCourse(course) >= limit;
}

/** Find an entry row by bib number. Returns index or -1. */
export function findEntryByBib(bibNumber) {
  if (!bibNumber || +bibNumber <= 0) return -1;
  return state.entries.findIndex(e => +e.bibNumber === +bibNumber);
}

/** Find an entry row by dibber short code. Returns index or -1. */
export function findEntryByDibber(dibberShortCode) {
  if (!dibberShortCode || +dibberShortCode <= 0) return -1;
  return state.entries.findIndex(e => +e.dibberNumber === +dibberShortCode);
}

/** Get an entry object by bib number. Returns null if not found. */
export function getEntry(bibNumber) {
  const idx = findEntryByBib(bibNumber);
  return idx >= 0 ? state.entries[idx] : null;
}

/**
 * Add or update a single entry.
 * Returns the index in state.entries, or -1 on validation failure.
 */
export function addEntry({
  bibNumber, dibberNumber, fraNumber, name, club,
  gender, dob, category, course, preEntry
}) {
  if (!bibNumber || +bibNumber <= 0) return -1;
  const bib = +bibNumber;

  let idx = findEntryByBib(bib);
  if (idx < 0) {
    idx = state.entries.length;
    state.entries.push(createEntry());
  }

  const e = state.entries[idx];
  e.bibNumber    = bib;
  e.dibberNumber = dibberNumber !== undefined ? dibberNumber : (e.dibberNumber || 0);
  e.fraNumber    = fraNumber    !== undefined ? fraNumber    : (e.fraNumber    || '');
  e.name         = cleanName(name  || e.name  || '');
  e.club         = cleanName(club  || e.club  || '');
  e.gender       = gender        !== undefined ? gender      : (e.gender       || '');
  e.dob          = normaliseDate(dob || e.dob || '');
  e.category     = category      !== undefined ? category    : (e.category     || '');
  e.course       = course        !== undefined ? course      : (e.course       || COURSE.SENIORS);
  e.preEntry     = preEntry      !== undefined ? preEntry    : (e.preEntry     || '');

  return idx;
}

// ---- Dibber sequence helpers ----

function dibberListIdx(dibber) {
  return state.dibbers.findIndex(d => +d.shortCode === dibber);
}

function predecessorDibber(entryIdx) {
  for (let i = entryIdx - 1; i >= 0; i--) {
    const d = +state.entries[i].dibberNumber;
    if (d > 0) return d;
  }
  return 0;
}

// Returns { idx, skipped } — the list index the entry at entryIdx should occupy, skipping lost dibbers.
function nextDibberListIdx(entryIdx) {
  const pred = predecessorDibber(entryIdx);
  let idx;
  if (pred > 0) {
    const pIdx = dibberListIdx(pred);
    if (pIdx < 0) return { idx: -1, skipped: [] };
    idx = pIdx + 1;
  } else {
    const first = +state.event.firstDibberNumber || 1;
    idx = state.dibbers.findIndex(d => +d.shortCode >= first);
    if (idx < 0) return { idx: -1, skipped: [] };
  }
  const skipped = [];
  while (idx < state.dibbers.length && state.dibbers[idx].lost) {
    skipped.push(state.dibbers[idx].shortCode);
    idx++;
  }
  return { idx: idx < state.dibbers.length ? idx : -1, skipped };
}

// Shift every dibber-using entry from fromEntryIdx onward one slot forward in the list.
function shiftDibbersForward(fromEntryIdx, insertedListIdx) {
  let listIdx = insertedListIdx;
  for (let i = fromEntryIdx; i < state.entries.length; i++) {
    if (+state.entries[i].dibberNumber > 0) {
      listIdx++;
      while (listIdx < state.dibbers.length && state.dibbers[listIdx].lost) listIdx++;
      state.entries[i].dibberNumber = listIdx < state.dibbers.length ? +state.dibbers[listIdx].shortCode : 0;
    }
  }
}

// Shift every dibber-using entry from fromEntryIdx onward one slot backward,
// filling the gap left by releasedDibber.
function shiftDibbersBackward(fromEntryIdx, releasedDibber) {
  const relIdx = dibberListIdx(releasedDibber);
  if (relIdx < 0) return;
  let targetIdx = relIdx;
  for (let i = fromEntryIdx; i < state.entries.length; i++) {
    if (+state.entries[i].dibberNumber > 0) {
      while (targetIdx < state.dibbers.length && state.dibbers[targetIdx].lost) targetIdx++;
      state.entries[i].dibberNumber = targetIdx < state.dibbers.length ? +state.dibbers[targetIdx].shortCode : 0;
      targetIdx++;
    }
  }
}

/**
 * Submit a new entry from the registration form.
 * formData: {name, gender, dob, club, fraNumber, category, course, preEntry}
 * Allocates bib number and dibber if needed.
 * Returns {bibNumber, dibberNumber, error} — error is '' on success.
 */
export async function submitEntry(formData) {
  const name    = cleanName(formData.name || '');
  const gender  = formData.gender || '';
  const dob     = normaliseDate(formData.dob || '');
  const club    = cleanName(formData.club || '');
  const fra     = formData.fraNumber || '';
  const preEntry = formData.preEntry || '';

  if (!name) return { error: 'Name is required' };
  if (!gender) return { error: 'Gender is required' };
  if (!dob) return { error: 'Date of birth is required' };

  const person = state.people.find(p => ciEq(p.name, name) && p.dob === dob);
  if (isBanned(person) && !formData.overrideBan) return { bannedWarning: person.banned };

  let category = formData.category || '';
  if (!category && dob) category = calculateCategory(dob, gender);
  if (!category && dob && state.event.date) return { error: 'Too young to enter — below the minimum age for this event' };

  let course = formData.course || '';
  if (!course) course = calculateCourse(category, dob);

  if (courseFull(course)) {
    return { error: `${course} is full (limit ${getEntryLimit(course)})` };
  }

  const normName = name.toUpperCase();
  const duplicate = state.entries.find(e => {
    if (cleanName(e.name || '').toUpperCase() !== normName) return false;
    return dob ? normaliseDate(e.dob || '') === dob : true;
  });
  if (duplicate) {
    return { error: `${name} is already entered as bib ${duplicate.bibNumber}` };
  }

  const bibNumber = (formData.bibOverride && +formData.bibOverride > 0)
    ? +formData.bibOverride
    : getNextBibNumber();

  let dibberNumber = 0;
  let lostWarning  = '';
  if (usingDibbers(course)) {
    if (formData.dibberOverride && +formData.dibberOverride > 0) {
      const lostDibber = state.dibbers.find(d => +d.shortCode === +formData.dibberOverride);
      if (lostDibber?.lost) return { error: `Dibber ${formData.dibberOverride} is marked lost (since ${lostDibber.lost})` };
      dibberNumber = +formData.dibberOverride;
    } else {
      const next = getNextDibberNumber();
      if (next === null) return { error: state.dibbers.length === 0
        ? 'No dibbers loaded — load dibber numbers before registering this entry'
        : 'No more dibber numbers available — load more dibber numbers' };
      dibberNumber = next.number;
      if (next.skipped.length)
        lostWarning = `Dibber${next.skipped.length > 1 ? 's' : ''} ${next.skipped.join(', ')} skipped (marked lost)`;
    }
  }

  addEntry({ bibNumber, dibberNumber, fraNumber: fra, name, club, gender, dob, category, course, preEntry });

  // Update people and clubs lists
  const nameId = null;
  addPerson(name, nameId, gender, dob, club, fra, category, false);

  sortPeople();
  await saveEntries();
  await savePeople();

  return { bibNumber, dibberNumber, error: '', lostWarning };
}

/**
 * Update an existing entry (edit mode).
 * Returns {error} — error is '' on success.
 */
export async function updateEntry(bibNumber, formData) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };

  const e = state.entries[idx];
  let lostWarning = '';

  // Bib change — clash-check against other entries
  if (formData.bibOverride && +formData.bibOverride > 0 && +formData.bibOverride !== +bibNumber) {
    const newBib = +formData.bibOverride;
    if (findEntryByBib(newBib) >= 0) return { error: `Bib ${newBib} is already in use` };
    e.bibNumber = newBib;
  }

  // Course-type change drives dibber resequencing; manual override handles same-type edits
  const oldCourse = e.course;
  const newCourse = formData.course !== undefined ? formData.course : oldCourse;
  const wasUsingDibbers = usingDibbers(oldCourse);
  const nowUsingDibbers = usingDibbers(newCourse);

  if (wasUsingDibbers && !nowUsingDibbers) {
    const oldDibber = +e.dibberNumber || 0;
    e.dibberNumber = 0;
    if (oldDibber > 0) shiftDibbersBackward(idx + 1, oldDibber);
  } else if (!wasUsingDibbers && nowUsingDibbers) {
    if (state.dibbers.length === 0)
      return { error: 'No dibbers loaded — load dibber numbers before changing this entry to a dibber course' };
    const { idx: newListIdx, skipped } = nextDibberListIdx(idx);
    if (newListIdx < 0 || newListIdx >= state.dibbers.length)
      return { error: 'No more dibber numbers available — load more dibber numbers' };
    e.dibberNumber = +state.dibbers[newListIdx].shortCode;
    shiftDibbersForward(idx + 1, newListIdx);
    if (skipped.length)
      lostWarning = `Dibber${skipped.length > 1 ? 's' : ''} ${skipped.join(', ')} skipped (marked lost)`;
  } else if (formData.dibberOverride !== undefined) {
    const newDibber = +formData.dibberOverride || 0;
    if (newDibber > 0 && newDibber !== +e.dibberNumber) {
      const lostDibber = state.dibbers.find(d => +d.shortCode === newDibber);
      if (lostDibber?.lost) return { error: `Dibber ${newDibber} is marked lost (since ${lostDibber.lost})` };
      const clashIdx = findEntryByDibber(newDibber);
      if (clashIdx >= 0 && clashIdx !== idx)
        return { error: `Dibber ${newDibber} is already assigned to bib ${state.entries[clashIdx].bibNumber}` };
    }
    e.dibberNumber = newDibber;
  }

  if (formData.name      !== undefined) e.name      = cleanName(formData.name);
  if (formData.gender    !== undefined) e.gender    = formData.gender;
  if (formData.dob       !== undefined) e.dob       = normaliseDate(formData.dob);
  if (formData.club      !== undefined) e.club      = cleanName(formData.club);
  if (formData.fraNumber !== undefined) e.fraNumber = formData.fraNumber;
  if (formData.category  !== undefined) e.category  = formData.category;
  if (formData.course    !== undefined) e.course    = newCourse;

  await saveEntries();
  return { error: '', lostWarning };
}

/**
 * Insert a new entry at atBib, shifting all existing entries from atBib upward
 * (bib +1 each, dibber slots shift forward by one), as if this entry had always been there.
 * Returns {bibNumber, dibberNumber, error}.
 */
export async function insertEntryAndRenumber(atBib, formData) {
  const name     = cleanName(formData.name || '');
  const gender   = formData.gender || '';
  const dob      = normaliseDate(formData.dob || '');
  const club     = cleanName(formData.club || '');
  const fra      = formData.fraNumber || '';
  const preEntry = formData.preEntry || '';

  if (!name)   return { error: 'Name is required' };
  if (!gender) return { error: 'Gender is required' };
  if (!dob) return { error: 'Date of birth is required' };

  const person2 = state.people.find(p => ciEq(p.name, name) && p.dob === dob);
  if (isBanned(person2) && !formData.overrideBan) return { bannedWarning: person2.banned };

  let category = formData.category || '';
  if (!category && dob) category = calculateCategory(dob, gender);
  if (!category && dob && state.event.date) return { error: 'Too young to enter — below the minimum age for this event' };

  let course = formData.course || '';
  if (!course) course = calculateCourse(category, dob);

  const normName = name.toUpperCase();
  const duplicate = state.entries.find(e => {
    if (cleanName(e.name || '').toUpperCase() !== normName) return false;
    return dob ? normaliseDate(e.dob || '') === dob : true;
  });
  if (duplicate) return { error: `${name} is already entered as bib ${duplicate.bibNumber}` };

  if (usingDibbers(course) && state.dibbers.length === 0)
    return { error: 'No dibbers loaded — load dibber numbers before registering this entry' };

  const idx = findEntryByBib(atBib);
  if (idx < 0) return { error: `Bib ${atBib} not found` };

  const useManualDibber = !!(formData.dibberOverride && +formData.dibberOverride > 0);

  // Determine the dibber for the new entry and the list index at which to begin
  // shifting subsequent dibber-using entries one slot forward.
  let dibberNumber = 0;
  let shiftListIdx = -1;

  if (usingDibbers(course) && !useManualDibber) {
    const freeDibber = +state.entries[idx].dibberNumber || 0;
    const newListIdx = freeDibber > 0 ? dibberListIdx(freeDibber) : nextDibberListIdx(idx);
    if (newListIdx < 0 || newListIdx >= state.dibbers.length)
      return { error: 'No more dibber numbers available — load more dibber numbers' };
    dibberNumber  = +state.dibbers[newListIdx].shortCode;
    shiftListIdx  = newListIdx;
  } else if (useManualDibber) {
    dibberNumber = +formData.dibberOverride;
  }

  // Shift all entries from atBib upward (bibs +1; dibbers advance one slot when shiftListIdx is set)
  let listIdx = shiftListIdx;
  for (let i = idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    e.bibNumber = +e.bibNumber + 1;
    if (listIdx >= 0 && +e.dibberNumber > 0) {
      listIdx++;
      e.dibberNumber = listIdx < state.dibbers.length ? +state.dibbers[listIdx].shortCode : 0;
    }
  }

  state.entries.splice(idx, 0, {
    bibNumber: atBib, dibberNumber, fraNumber: fra,
    name, club, gender, dob, category, course, preEntry,
  });

  addPerson(name, null, gender, dob, club, fra, category, false);
  sortPeople();
  await saveEntries();
  await savePeople();

  return { bibNumber: atBib, dibberNumber, error: '' };
}

/**
 * Delete a single entry and renumber all subsequent entries as if it was never registered.
 * Bib numbers above the deleted one are each decremented by 1.
 * Dibber numbers are similarly shifted: each subsequent entry that uses a dibber
 * takes the dibber slot freed by the deletion.
 */
export async function deleteEntryAndRenumber(bibNumber) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };

  const deleted = state.entries[idx];

  // Track where to resume dibber allocation (the slot freed by the deleted entry)
  let nextDibberIdx = -1;
  if (+deleted.dibberNumber > 0) {
    nextDibberIdx = state.dibbers.findIndex(d => +d.shortCode === +deleted.dibberNumber);
  }

  state.entries.splice(idx, 1);

  for (let i = idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    e.bibNumber = +e.bibNumber - 1;
    if (nextDibberIdx >= 0 && +e.dibberNumber > 0) {
      if (nextDibberIdx < state.dibbers.length) {
        e.dibberNumber = +state.dibbers[nextDibberIdx].shortCode;
        nextDibberIdx++;
      }
    }
  }

  await saveEntries();
  return { error: '' };
}

/** Delete all entries. */
export async function clearAllEntries() {
  state.entries = [];
  await saveEntries();
}

/** Re-evaluate category and course for every entry that has a DOB, using current category tables. */
export async function reapplyEntryCategories() {
  for (const e of state.entries) {
    if (!e.dob) continue;
    e.category = calculateCategory(e.dob, e.gender);
    e.course   = calculateCourse(e.category, e.dob);
  }
  await saveEntries();
}

/** Get entries sorted by bib number */
export function getSortedEntries() {
  return [...state.entries].sort((a, b) => (+a.bibNumber || 0) - (+b.bibNumber || 0));
}

/**
 * Export entries in SI timing CSV format.
 * dibberNumber is stored as shortCode; mapped to longCode here for CardNumbers.
 * Returns an array of row objects keyed by SI_TIMING_COL_NAMES values.
 */
/** Export dibber entries as SI Timing CSV rows. */
export function exportSITimingCSV(entries) {
  const rows = [];
  for (const e of entries) {
    if (!e.bibNumber || !e.dibberNumber) continue;
    const dibberEntry = state.dibbers.find(d => +d.shortCode === +e.dibberNumber);
    if (!dibberEntry) throw new Error(`Bib ${e.bibNumber}: dibber ${e.dibberNumber} not found in dibbers list — reload dibbers and retry`);
    const dibberLong = dibberEntry.longCode;
    const genderPrefix = (e.gender || '').charAt(0).toUpperCase() === 'F' ? 'F' : 'M';
    const nameParts    = (e.name || '').trim().split(/\s+/);
    const pe           = e.preEntry ? state.preEntries.find(p => p.participantNumber === e.preEntry) : null;
    const c = SI.timingExport;
    rows.push({
      [c.BIB_NUMBER]:           e.bibNumber,
      [c.NUM_ENTRANTS]:         '',
      [c.DIBBER_NUMBER]:        dibberLong,
      [c.FRA_NUMBER]:           `${pe?.siEntriesId || ''}&${e.fraNumber || ''}`,
      [c.FORENAMES]:            nameParts[0] || '',
      [c.SURNAMES]:             nameParts.slice(1).join(' '),
      [c.NAME]:                 e.name || '',
      [c.CATEGORY]:             e.category || '',
      [c.CLUB]:                 e.club || '',
      [c.COUNTRY]:              pe?.country || '',
      [c.COURSE]:               e.course || '',
      [c.ENTRIES_ID]:           pe?.siEntriesId || '',
      [c.ELIGIBILITY]:          pe?.eligibility?.trim().toLowerCase() === 'yes' ? 'E' : '',
      [c.GENDER_DOB]:           e.dob ? `${genderPrefix}${e.dob}` : genderPrefix,
    });
  }
  return rows;
}