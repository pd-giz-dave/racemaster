'use strict';

import { state } from './state.js';
import { createEntry } from './schema.js';
import { SI } from './si-schema.js';
import { saveEntries, savePeople } from './state.js';
import { COURSE } from './constants.js';
import { normaliseDate, cleanName, ciEq } from './utils.js';
import { calculateCategory, calculateCourse, calculatePairCategory } from './categories.js';
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

/** Check if a name+dob is already entered (checks both primary and partner fields). */
function findDuplicate(name, dob, excludeBib = 0) {
  const normName = cleanName(name).toUpperCase();
  const normDob  = normaliseDate(dob);
  return state.entries.find(e => {
    if (excludeBib && +e.bibNumber === +excludeBib) return false;
    if (cleanName(e.name || '').toUpperCase() === normName && (normDob ? normaliseDate(e.dob || '') === normDob : true)) return true;
    if (e.partner) {
      const p = e.partner;
      if (cleanName(p.name || '').toUpperCase() === normName && (normDob ? normaliseDate(p.dob || '') === normDob : true)) return true;
    }
    return false;
  });
}

/** Validate and normalise a partner object. Returns { partner, error }. */
function normalisePartner(p, primaryName, primaryDob) {
  const pName   = cleanName(p.name || '');
  const pGender = p.gender || '';
  const pDob    = normaliseDate(p.dob || '');
  if (!pName)   return { error: 'Partner name is required' };
  if (!pGender) return { error: 'Partner gender is required' };
  if (!pDob)    return { error: 'Partner date of birth is required' };
  if (pName.toUpperCase() === primaryName.toUpperCase() && pDob === primaryDob)
    return { error: 'Partner cannot be the same person as the primary entrant' };
  return { partner: { name: pName, gender: pGender, dob: pDob, club: cleanName(p.club || ''), fraNumber: p.fraNumber || '' } };
}

/**
 * Add or update a single entry.
 * Returns the index in state.entries, or -1 on validation failure.
 */
export function addEntry({
  bibNumber, dibberNumber, fraNumber, name, club,
  gender, dob, category, course, preEntry, partner
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
  e.partner      = partner       !== undefined ? (partner || null) : (e.partner ?? null);

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
 * formData: {name, gender, dob, club, fraNumber, category, course, preEntry, partner?}
 * partner: { name, gender, dob, club, fraNumber } for pair entries, null/undefined for solo.
 * Allocates bib number and dibber if needed.
 * Returns {bibNumber, dibberNumber, error} — error is '' on success.
 */
/**
 * Validate and normalise formData for an entry.
 * existingEntry: the current entry object when editing (supplies defaults for unset fields).
 * excludeBib: bib to exclude from duplicate checks (the entry being edited).
 * Returns { name, gender, dob, club, fra, preEntry, partner, category, course }
 * or { error } or { bannedWarning }.
 */
function prepareEntry(formData, existingEntry = null, excludeBib = 0) {
  const ex = existingEntry;
  const name     = cleanName(formData.name     !== undefined ? formData.name     : (ex?.name     || ''));
  const gender   =          (formData.gender   !== undefined ? formData.gender   : (ex?.gender   || ''));
  const dob      = normaliseDate(formData.dob  !== undefined ? formData.dob      : (ex?.dob      || ''));
  const club     = cleanName(formData.club     !== undefined ? formData.club     : (ex?.club     || ''));
  const fra      =          (formData.fraNumber!== undefined ? formData.fraNumber: (ex?.fraNumber|| ''));
  const preEntry =          (formData.preEntry !== undefined ? formData.preEntry : (ex?.preEntry || ''));

  if (!name)   return { error: 'Name is required' };
  if (!gender) return { error: 'Gender is required' };
  if (!dob)    return { error: 'Date of birth is required' };

  // Partner
  let partner = ex?.partner ?? null;
  if (formData.partner !== undefined) {
    if (formData.partner) {
      const pv = normalisePartner(formData.partner, name, dob);
      if (pv.error) return { error: pv.error };
      const partnerDup = findDuplicate(pv.partner.name, pv.partner.dob, excludeBib);
      if (partnerDup) return { error: `${pv.partner.name} is already entered as bib ${partnerDup.bibNumber}` };
      partner = pv.partner;
    } else {
      partner = null;
    }
  }

  const person = state.people.find(p => ciEq(p.name, name) && p.dob === dob);
  if (isBanned(person) && !formData.overrideBan) return { bannedWarning: person.banned };

  let category = formData.category || ex?.category || '';
  if (!category) {
    if (partner) {
      const { category: pc } = calculatePairCategory(dob, gender, partner.dob, partner.gender);
      category = pc;
    } else {
      category = calculateCategory(dob, gender);
      if (!category && dob && state.event.date) return { error: 'Too young to enter — below the minimum age for this event' };
    }
  }

  let course = formData.course || ex?.course || '';
  if (!course) course = calculateCourse(category, dob);

  const duplicate = findDuplicate(name, dob, excludeBib);
  if (duplicate) return { error: `${name} is already entered as bib ${duplicate.bibNumber}` };

  return { name, gender, dob, club, fra, preEntry, partner, category, course };
}

function savePeople2(name, gender, dob, club, fra, category, partner) {
  addPerson(name, null, gender, dob, club, fra, category, false);
  if (partner) addPerson(partner.name, null, partner.gender, partner.dob, partner.club, partner.fraNumber, category, false);
}

export async function submitEntry(formData) {
  const prep = prepareEntry(formData);
  if (prep.error || prep.bannedWarning) return prep;
  const { name, gender, dob, club, fra, preEntry, partner, category, course } = prep;

  if (courseFull(course)) return { error: `${course} is full (limit ${getEntryLimit(course)})` };

  const bibNumber = (formData.bibOverride && +formData.bibOverride > 0)
    ? +formData.bibOverride : getNextBibNumber();

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

  addEntry({ bibNumber, dibberNumber, fraNumber: fra, name, club, gender, dob, category, course, preEntry, partner });
  savePeople2(name, gender, dob, club, fra, category, partner);
  sortPeople();
  await saveEntries();
  await savePeople();
  return { bibNumber, dibberNumber, error: '', lostWarning };
}

export async function updateEntry(bibNumber, formData) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };
  const e = state.entries[idx];

  const prep = prepareEntry(formData, e, bibNumber);
  if (prep.error || prep.bannedWarning) return prep;
  const { name, gender, dob, club, fra, preEntry, partner, category, course: prepCourse } = prep;

  // Bib change
  if (formData.bibOverride && +formData.bibOverride > 0 && +formData.bibOverride !== +bibNumber) {
    const newBib = +formData.bibOverride;
    if (findEntryByBib(newBib) >= 0) return { error: `Bib ${newBib} is already in use` };
    e.bibNumber = newBib;
  }

  // Dibber resequencing when course type changes
  let lostWarning = '';
  const newCourse = formData.course !== undefined ? formData.course : prepCourse;
  const wasUsingDibbers = usingDibbers(e.course);
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

  e.name = name; e.gender = gender; e.dob = dob; e.club = club;
  e.fraNumber = fra; e.preEntry = preEntry; e.partner = partner;
  e.category = category; e.course = newCourse;

  await saveEntries();
  return { error: '', lostWarning };
}

/**
 * Insert a new entry at atBib, shifting all existing entries from atBib upward
 * (bib +1 each, dibber slots shift forward by one), as if this entry had always been there.
 */
export async function insertEntryAndRenumber(atBib, formData) {
  const prep = prepareEntry(formData);
  if (prep.error || prep.bannedWarning) return prep;
  const { name, gender, dob, club, fra, preEntry, partner, category, course } = prep;

  if (usingDibbers(course) && state.dibbers.length === 0)
    return { error: 'No dibbers loaded — load dibber numbers before registering this entry' };

  const idx = findEntryByBib(atBib);
  if (idx < 0) return { error: `Bib ${atBib} not found` };

  const useManualDibber = !!(formData.dibberOverride && +formData.dibberOverride > 0);
  let dibberNumber = 0;
  let shiftListIdx = -1;

  if (usingDibbers(course) && !useManualDibber) {
    const freeDibber = +state.entries[idx].dibberNumber || 0;
    const newListIdx = freeDibber > 0 ? dibberListIdx(freeDibber) : nextDibberListIdx(idx);
    if (newListIdx < 0 || newListIdx >= state.dibbers.length)
      return { error: 'No more dibber numbers available — load more dibber numbers' };
    dibberNumber = +state.dibbers[newListIdx].shortCode;
    shiftListIdx = newListIdx;
  } else if (useManualDibber) {
    dibberNumber = +formData.dibberOverride;
  }

  // Shift all entries from atBib upward
  let listIdx = shiftListIdx;
  for (let i = idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    e.bibNumber = +e.bibNumber + 1;
    if (listIdx >= 0 && +e.dibberNumber > 0) {
      listIdx++;
      e.dibberNumber = listIdx < state.dibbers.length ? +state.dibbers[listIdx].shortCode : 0;
    }
  }

  state.entries.splice(idx, 0, { bibNumber: atBib, dibberNumber, fraNumber: fra, name, club, gender, dob, category, course, preEntry, partner: partner || null });
  savePeople2(name, gender, dob, club, fra, category, partner);
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
export function getEntryName(entry) {
  return entry.partner ? `${entry.name} / ${entry.partner.name}` : (entry.name || '');
}

/** Export dibber entries as SI Timing CSV rows. */
export function exportSITimingCSV(entries) {
  const rows = [];
  for (const e of entries) {
    if (!e.bibNumber || !e.dibberNumber) continue;
    const dibberEntry = state.dibbers.find(d => +d.shortCode === +e.dibberNumber);
    if (!dibberEntry) throw new Error(`Bib ${e.bibNumber}: dibber ${e.dibberNumber} not found in dibbers list — reload dibbers and retry`);
    const dibberLong = dibberEntry.longCode;
    const genderPrefix = (e.gender || '').charAt(0).toUpperCase() === 'F' ? 'F' : 'M';
    const pe           = e.preEntry ? state.preEntries.find(p => p.participantNumber === e.preEntry) : null;
    const c = SI.timingExport;
    rows.push({
      [c.BIB_NUMBER]:           e.bibNumber,
      [c.NUM_ENTRANTS]:         '',
      [c.DIBBER_NUMBER]:        dibberLong,
      [c.FRA_NUMBER]:           e.partner ? '' : `${pe?.siEntriesId || ''}&${e.fraNumber || ''}`,
      [c.FORENAMES]:            '',
      [c.SURNAMES]:             '',
      [c.NAME]:                 getEntryName(e),
      [c.CATEGORY]:             e.category || '',
      [c.CLUB]:                 e.club || '',
      [c.COUNTRY]:              pe?.country || '',
      [c.COURSE]:               e.course || '',
      [c.ENTRIES_ID]:           e.partner ? '' : (pe?.siEntriesId || ''),
      [c.ELIGIBILITY]:          e.partner ? '' : (pe?.eligibility?.trim().toLowerCase() === 'yes' ? 'E' : ''),
      [c.GENDER_DOB]:           e.partner ? '' : (e.dob ? `${genderPrefix}${e.dob}` : genderPrefix),
    });
  }
  return rows;
}