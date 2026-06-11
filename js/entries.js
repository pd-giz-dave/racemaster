'use strict';

import { state } from './state.js';
import { saveEntries, savePeople } from './state.js';
import { GENDER, COURSE } from './constants.js';
import { normaliseDate, cleanName, iequal } from './utils.js';
import { calculateCategory, calculateCourse } from './categories.js';
import { addPerson, sortPeople, getNextBibNumber, getNextDibberNumber, mapDibberNumber } from './data.js';
import { usingDibbers } from './time-utils.js';

export function isBanned(p) {
  if (!p?.banned) return false;
  const [d, m, y] = p.banned.split('/').map(Number);
  if (!y) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return today <= new Date(y, m - 1, d);
}

export function isEntryBanned(entry) {
  const p = state.people.find(p => iequal(p.name, entry.name || '') && p.dob === (entry.dob || ''));
  return isBanned(p);
}

// ============================================================
// Entry registration logic (translated from Entries.xml)
// ============================================================

/** Get total registered entries */
export function getNumberOfEntries() {
  return state.entries.length;
}

/** Count entries on a given course */
export function getEntriesOnCourse(course) {
  return state.entries.filter(e => iequal(e.course, course)).length;
}

/** Get the entry limit for a course */
export function getEntryLimit(course) {
  if (course && course.toUpperCase().startsWith(COURSE.JUNIORS_PREFIX.toUpperCase())) {
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
  gender, dob, category, course, preEntry, startTime, retired, status
}) {
  if (!bibNumber || +bibNumber <= 0) return -1;
  const bib = +bibNumber;

  let idx = findEntryByBib(bib);
  if (idx < 0) {
    idx = state.entries.length;
    state.entries.push({});
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
  e.startTime    = startTime     !== undefined ? startTime   : (e.startTime    || '');
  e.retired      = retired       !== undefined ? retired     : (e.retired      || '');
  e.status       = status        !== undefined ? status      : (e.status       || '');

  return idx;
}

/**
 * Submit a new entry from the registration form.
 * formData: {name, gender, dob, club, fraNumber, category, course, preEntry}
 * Allocates bib number and dibber if needed.
 * Returns {bibNumber, dibberNumber, error} — error is '' on success.
 */
export async function submitEntry(formData) {
  const name    = cleanName(formData.name || '');
  const gender  = (formData.gender || '').charAt(0).toUpperCase();
  const dob     = normaliseDate(formData.dob || '');
  const club    = cleanName(formData.club || '');
  const fra     = formData.fraNumber || '';
  const preEntry = formData.preEntry || '';

  if (!name) return { error: 'Name is required' };
  if (!gender) return { error: 'Gender is required' };
  if (!dob && gender !== GENDER.PAIR_PREFIX) return { error: 'Date of birth is required' };

  const person = state.people.find(p => iequal(p.name, name) && p.dob === dob);
  if (isBanned(person) && !formData.overrideBan) return { bannedWarning: person.banned };

  let category = formData.category || '';
  if (!category && dob) category = calculateCategory(dob, gender);

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
  const dibberNumber = (formData.dibberOverride && +formData.dibberOverride > 0)
    ? +formData.dibberOverride
    : (usingDibbers(course) ? getNextDibberNumber() : 0);

  addEntry({ bibNumber, dibberNumber, fraNumber: fra, name, club, gender, dob, category, course, preEntry });

  // Update people and clubs lists
  const nameId = null;
  addPerson(name, nameId, gender, dob, club, fra, category, false);

  sortPeople();
  await saveEntries();
  await savePeople();

  return { bibNumber, dibberNumber, error: '' };
}

/**
 * Update an existing entry (edit mode).
 * Returns {error} — error is '' on success.
 */
export async function updateEntry(bibNumber, formData) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };

  const e = state.entries[idx];

  // Bib change — clash-check against other entries
  if (formData.bibOverride && +formData.bibOverride > 0 && +formData.bibOverride !== +bibNumber) {
    const newBib = +formData.bibOverride;
    if (findEntryByBib(newBib) >= 0) return { error: `Bib ${newBib} is already in use` };
    e.bibNumber = newBib;
  }

  // Dibber change — clash-check against other entries
  if (formData.dibberOverride !== undefined) {
    const newDibber = +formData.dibberOverride || 0;
    if (newDibber > 0 && newDibber !== +e.dibberNumber) {
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
  if (formData.course    !== undefined) e.course    = formData.course;
  if (formData.startTime !== undefined) e.startTime = formData.startTime;
  if (formData.retired   !== undefined) e.retired   = formData.retired;
  if (formData.status    !== undefined) e.status    = formData.status;

  await saveEntries();
  return { error: '' };
}

/**
 * Insert a new entry at atBib, shifting all existing entries from atBib upward
 * (bib +1 each, dibber slots shift forward by one), as if this entry had always been there.
 * Returns {bibNumber, dibberNumber, error}.
 */
export async function insertEntryAndRenumber(atBib, formData) {
  const name     = cleanName(formData.name || '');
  const gender   = (formData.gender || '').charAt(0).toUpperCase();
  const dob      = normaliseDate(formData.dob || '');
  const club     = cleanName(formData.club || '');
  const fra      = formData.fraNumber || '';
  const preEntry = formData.preEntry || '';

  if (!name)   return { error: 'Name is required' };
  if (!gender) return { error: 'Gender is required' };
  if (!dob && gender !== GENDER.PAIR_PREFIX) return { error: 'Date of birth is required' };

  const person2 = state.people.find(p => iequal(p.name, name) && p.dob === dob);
  if (isBanned(person2) && !formData.overrideBan) return { bannedWarning: person2.banned };

  let category = formData.category || '';
  if (!category && dob) category = calculateCategory(dob, gender);
  let course = formData.course || '';
  if (!course) course = calculateCourse(category, dob);

  const normName = name.toUpperCase();
  const duplicate = state.entries.find(e => {
    if (cleanName(e.name || '').toUpperCase() !== normName) return false;
    return dob ? normaliseDate(e.dob || '') === dob : true;
  });
  if (duplicate) return { error: `${name} is already entered as bib ${duplicate.bibNumber}` };

  const idx = findEntryByBib(atBib);
  if (idx < 0) return { error: `Bib ${atBib} not found` };

  // The entry currently at atBib holds the dibber slot the new entry should occupy
  const freeDibber = +state.entries[idx].dibberNumber || 0;
  let nextDibberIdx = freeDibber > 0
    ? state.dibbers.findIndex(d => +d.shortCode === freeDibber)
    : -1;

  // Shift all entries from atBib upward
  for (let i = idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    e.bibNumber = +e.bibNumber + 1;
    if (nextDibberIdx >= 0 && +e.dibberNumber > 0) {
      const shiftIdx = nextDibberIdx + 1;
      e.dibberNumber = shiftIdx < state.dibbers.length ? +state.dibbers[shiftIdx].shortCode : 0;
      nextDibberIdx++;
    }
  }

  const dibberNumber = (formData.dibberOverride && +formData.dibberOverride > 0)
    ? +formData.dibberOverride
    : (usingDibbers(course) ? freeDibber : 0);

  state.entries.splice(idx, 0, {
    bibNumber: atBib, dibberNumber, fraNumber: fra,
    name, club, gender, dob, category, course, preEntry,
    retired: '', startTime: '',
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

/** Delete an entry by bib number */
export async function deleteEntry(bibNumber) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };
  state.entries.splice(idx, 1);
  await saveEntries();
  return { error: '' };
}

/** Mark an entry as retired (DNF) */
export async function retireEntry(bibNumber) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };
  state.entries[idx].retired = 'Y';
  await saveEntries();
  return { error: '' };
}

/** Clear the retired flag on an entry */
export async function unretireEntry(bibNumber) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };
  state.entries[idx].retired = '';
  await saveEntries();
  return { error: '' };
}

/** Assign a dibber to an entry (short code → long code) */
export async function assignDibber(bibNumber, dibberShortCode) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };
  const longCode = mapDibberNumber(dibberShortCode);
  if (longCode < 0) return { error: `Dibber ${dibberShortCode} not found in dibber list` };
  state.entries[idx].dibberNumber = +dibberShortCode;
  await saveEntries();
  return { error: '' };
}

/** Set individual start time for an entry */
export async function setEntryStartTime(bibNumber, timeStr) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };
  state.entries[idx].startTime = timeStr;
  await saveEntries();
  return { error: '' };
}

/**
 * Load pre-entries into the entries list.
 * Matches by pre-entry participant number or by name/dob.
 * Returns {added, updated, errors[]}.
 */
export async function loadPreEntries() {
  let added = 0, updated = 0;
  const errors = [];

  for (const pe of state.preEntries) {
    const name    = cleanName(`${pe.firstName||''} ${pe.lastName||''}`.trim());
    const gender  = (pe.gender || '').charAt(0).toUpperCase() === 'F' ? GENDER.FEMALE : GENDER.MALE;
    const dob     = normaliseDate(pe.dob || '');
    const club    = cleanName(pe.club || '');
    const fra     = pe.fraNumber || '';
    const preNum  = pe.participantNumber || '';

    if (!name) continue;
    if (!dob && gender !== GENDER.PAIR_PREFIX) {
      errors.push(`Pre-entry ${preNum} (${name}) has no DoB`);
      continue;
    }

    let category = pe.category || '';
    if (!category && dob) category = calculateCategory(dob, gender);
    const course = calculateCourse(category, dob);

    // Check if already in entries by preEntry number
    let existing = -1;
    if (preNum) existing = state.entries.findIndex(e => e.preEntry === preNum);

    if (existing >= 0) {
      // Update existing entry
      const e = state.entries[existing];
      e.name = name; e.gender = gender; e.dob = dob;
      e.club = club; e.fraNumber = fra; e.category = category; e.course = course;
      updated++;
    } else {
      // New entry
      const bibNumber = getNextBibNumber();
      const dibberNumber = usingDibbers(course) ? getNextDibberNumber() : 0;
      addEntry({ bibNumber, dibberNumber, fraNumber: fra, name, club, gender, dob, category, course, preEntry: preNum });
      added++;
    }
  }

  await saveEntries();
  return { added, updated, errors };
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

/** Get entries for a given course */
export function getEntriesForCourse(course) {
  return state.entries.filter(e => iequal(e.course, course));
}

/** Count unique categories in entries */
export function getCategoryCount() {
  const cats = new Set(state.entries.map(e => e.category).filter(Boolean));
  return cats.size;
}

/**
 * Export entries in SI timing CSV format.
 * dibberNumber is stored as shortCode; mapped to longCode here for CardNumbers.
 * Returns an array of row objects keyed by SI_TIMING_COL_NAMES values.
 */
export function buildSITimingExport() {
  const rows = [];
  for (const e of getSortedEntries()) {
    if (!e.bibNumber) continue;
    const longCode = e.dibberNumber > 0 ? mapDibberNumber(e.dibberNumber) : 0;
    const genderPrefix = e.gender === GENDER.FEMALE_PREFIX ? 'F' : 'M';
    rows.push({
      'RaceNumber':         e.bibNumber,
      'NumberCompetitors':  '',
      'CardNumbers':        longCode > 0 ? longCode : '',
      'MembershipNumbers':  e.fraNumber || '',
      'Forenames':          '',
      'Surnames':           e.name || '',
      'Name (Free Format)': e.name || '',
      'Category':           e.category || '',
      'Club':               e.club || '',
      'CourseClass':        e.course || '',
      'Entry System IDs':   e.preEntry || '',
      'Eligibility':        '',
      'GenderDOB':          e.dob ? `${genderPrefix}${e.dob}` : genderPrefix,
    });
  }
  return rows;
}

/** Export entries as SI Timing CSV rows. */
export function exportSITimingCSV(entries) {
  const rows = [];
  for (const e of entries) {
    if (!e.bibNumber) continue;
    const dibberLong = e.dibberNumber > 0
      ? (state.dibbers.find(d => +d.shortCode === +e.dibberNumber)?.longCode || '')
      : '';
    const genderPrefix = (e.gender || '').charAt(0).toUpperCase() === 'F' ? 'F' : 'M';
    rows.push({
      'RaceNumber':         e.bibNumber,
      'NumberCompetitors':  '',
      'CardNumbers':        dibberLong,
      'MembershipNumbers':  e.fraNumber || '',
      'Forenames':          '',
      'Surnames':           e.name || '',
      'Name (Free Format)': e.name || '',
      'Category':           e.category || '',
      'Club':               e.club || '',
      'CourseClass':        e.course || '',
      'Entry System IDs':   e.preEntry || '',
      'Eligibility':        '',
      'GenderDOB':          e.dob ? `${genderPrefix}${e.dob}` : genderPrefix,
    });
  }
  return rows;
}