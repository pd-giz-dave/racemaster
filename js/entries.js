'use strict';

import { state } from './state.js';
import { createEntry } from './schema.js';
import { SI } from './si-schema.js';
import { saveEntries, savePeople, saveBeacons } from './state.js';
import { COURSE } from './constants.js';
import { normaliseDate, normaliseTime, cleanName, ciEq, timeToSeconds, formatElapsedSeconds } from './utils.js';
import { calculateCategory, calculateCourse, calculatePairCategory } from './categories.js';
import { addPerson, sortPeople, getNextBibNumber, getNextDibberNumber, getNextBeaconNumber } from './data.js';
import { usingDibbers, usingBeacons } from './time-utils.js';

// A predicted time far outside these multiples of the event's target time is almost certainly a
// typo (e.g. minutes entered as seconds, or vice versa) rather than a genuine predicted pace.
const MIN_HANDICAP_TARGET_MULTIPLE = 0.5; // fastest allowed: twice as fast as target
const MAX_HANDICAP_TARGET_MULTIPLE = 3;   // slowest allowed: three times as slow as target

export function isBanned(p) {
  if (!p?.banned) return false;
  const [d, m, y] = p.banned.split('/').map(Number);
  if (!y) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return today <= new Date(y, m - 1, d);
}

export function isEntryBanned(entry) {
  if (!entry) return false;
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

/** Find an entry row by dibber short code or beacon number — one shared field, see
 *  createEntry()'s own doc on why there's no separate beaconNumber. Returns index or -1. */
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
  gender, dob, category, course, preEntry, partner, predictedTime,
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
  e.predictedTime = predictedTime !== undefined ? predictedTime : (e.predictedTime || '');

  return idx;
}

// ---- Dibber sequence helpers ----

function dibberListIdx(dibber) {
  return state.dibbers.findIndex(d => +d.shortCode === dibber);
}

// Scoped to dibber-timed entries only (usingDibbers(e.course)) — entry.dibberNumber is the one
// shared field both pools allocate into (see createEntry()'s own doc), so without this guard a
// beacon-timed entry's own number, sitting in the same field, would be mistaken for a dibber.
function predecessorDibber(entryIdx) {
  for (let i = entryIdx - 1; i >= 0; i--) {
    if (!usingDibbers(state.entries[i].course)) continue;
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

// Shift every dibber-using entry from fromEntryIdx onward one slot forward in the list. Guarded
// by usingDibbers(e.course) — see predecessorDibber()'s own doc on why.
function shiftDibbersForward(fromEntryIdx, insertedListIdx) {
  let listIdx = insertedListIdx;
  for (let i = fromEntryIdx; i < state.entries.length; i++) {
    const e = state.entries[i];
    if (usingDibbers(e.course) && +e.dibberNumber > 0) {
      listIdx++;
      while (listIdx < state.dibbers.length && state.dibbers[listIdx].lost) listIdx++;
      e.dibberNumber = listIdx < state.dibbers.length ? +state.dibbers[listIdx].shortCode : 0;
    }
  }
}

// Shift every dibber-using entry from fromEntryIdx onward one slot backward,
// filling the gap left by releasedDibber. Guarded by usingDibbers(e.course) — see
// predecessorDibber()'s own doc on why.
function shiftDibbersBackward(fromEntryIdx, releasedDibber) {
  const relIdx = dibberListIdx(releasedDibber);
  if (relIdx < 0) return;
  let targetIdx = relIdx;
  for (let i = fromEntryIdx; i < state.entries.length; i++) {
    const e = state.entries[i];
    if (usingDibbers(e.course) && +e.dibberNumber > 0) {
      while (targetIdx < state.dibbers.length && state.dibbers[targetIdx].lost) targetIdx++;
      e.dibberNumber = targetIdx < state.dibbers.length ? +state.dibbers[targetIdx].shortCode : 0;
      targetIdx++;
    }
  }
}

// ---- Beacon sequence helpers (mirror the dibber ones above, operating on state.beacons — the
// entry-side field is the same shared entry.dibberNumber the Dibbers branch uses, see
// createEntry()'s own doc; a course has one timing method at a time, so the two pools' own
// sequence helpers never actually collide on the same entry) ----

function beaconListIdx(beacon) {
  return state.beacons.findIndex(b => +b.number === beacon);
}

// A beacon counts as in-use for this race the moment it's actually allocated to an entry — not
// only once the post-race beacons.json housekeeping report comes back (that report just confirms
// what already happened, see js/mobile-beacons.js) — so the Beacons data page's own "Last Used"
// column reflects reality straight away rather than sitting blank until housekeeping. No-op if
// there's no event date yet to record, or the number isn't actually in the catalogue.
function markBeaconUsed(beaconNumber) {
  if (!beaconNumber || !state.event.date) return;
  const beacon = state.beacons.find(b => +b.number === +beaconNumber);
  if (beacon) beacon.lastUsed = state.event.date;
}

// Scoped to beacon-timed entries only — see predecessorDibber()'s own doc on why this guard is
// needed now that both pools allocate into the same entry.dibberNumber field.
function predecessorBeacon(entryIdx) {
  for (let i = entryIdx - 1; i >= 0; i--) {
    if (!usingBeacons(state.entries[i].course)) continue;
    const b = +state.entries[i].dibberNumber;
    if (b > 0) return b;
  }
  return 0;
}

// Returns { idx, skipped } — the list index the entry at entryIdx should occupy, skipping lost beacons.
function nextBeaconListIdx(entryIdx) {
  const pred = predecessorBeacon(entryIdx);
  let idx;
  if (pred > 0) {
    const pIdx = beaconListIdx(pred);
    if (pIdx < 0) return { idx: -1, skipped: [] };
    idx = pIdx + 1;
  } else {
    const first = +state.event.firstDibberNumber || 1;
    idx = state.beacons.findIndex(b => +b.number >= first);
    if (idx < 0) return { idx: -1, skipped: [] };
  }
  const skipped = [];
  while (idx < state.beacons.length && state.beacons[idx].lost) {
    skipped.push(state.beacons[idx].number);
    idx++;
  }
  return { idx: idx < state.beacons.length ? idx : -1, skipped };
}

// Shift every beacon-using entry from fromEntryIdx onward one slot forward in the list. Guarded
// by usingBeacons(e.course) — see predecessorDibber()'s own doc on why. A forward shift can hand
// an entry a beacon number genuinely never used before this race (the sequence extending by
// one) — markBeaconUsed() covers that same as a fresh allocation would.
function shiftBeaconsForward(fromEntryIdx, insertedListIdx) {
  let listIdx = insertedListIdx;
  for (let i = fromEntryIdx; i < state.entries.length; i++) {
    const e = state.entries[i];
    if (usingBeacons(e.course) && +e.dibberNumber > 0) {
      listIdx++;
      while (listIdx < state.beacons.length && state.beacons[listIdx].lost) listIdx++;
      e.dibberNumber = listIdx < state.beacons.length ? +state.beacons[listIdx].number : 0;
      markBeaconUsed(e.dibberNumber);
    }
  }
}

// Shift every beacon-using entry from fromEntryIdx onward one slot backward,
// filling the gap left by releasedBeacon. Guarded by usingBeacons(e.course) — see
// predecessorDibber()'s own doc on why.
function shiftBeaconsBackward(fromEntryIdx, releasedBeacon) {
  const relIdx = beaconListIdx(releasedBeacon);
  if (relIdx < 0) return;
  let targetIdx = relIdx;
  for (let i = fromEntryIdx; i < state.entries.length; i++) {
    const e = state.entries[i];
    if (usingBeacons(e.course) && +e.dibberNumber > 0) {
      while (targetIdx < state.beacons.length && state.beacons[targetIdx].lost) targetIdx++;
      e.dibberNumber = targetIdx < state.beacons.length ? +state.beacons[targetIdx].number : 0;
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
  const predictedTime = formData.predictedTime !== undefined
    ? normaliseTime(formData.predictedTime, 'minutes') : (ex?.predictedTime || '');

  if (!name)   return { error: 'Name is required' };
  if (!gender) return { error: 'Gender is required' };
  if (!dob)    return { error: 'Date of birth is required' };
  if (state.event.isHandicap && !predictedTime) return { error: 'Predicted Time is required for a Handicap Race' };
  if (state.event.isHandicap && predictedTime && state.event.handicapTargetTime) {
    const targetSecs    = timeToSeconds(state.event.handicapTargetTime);
    const predictedSecs = timeToSeconds(predictedTime);
    const fastestSecs   = targetSecs * MIN_HANDICAP_TARGET_MULTIPLE;
    const slowestSecs   = targetSecs * MAX_HANDICAP_TARGET_MULTIPLE;
    if (predictedSecs < fastestSecs || predictedSecs > slowestSecs) {
      const fastest = formatElapsedSeconds(fastestSecs);
      const slowest = formatElapsedSeconds(slowestSecs);
      return { error: `Predicted Time must be between ${fastest} and ${slowest} for a target of ${state.event.handicapTargetTime}` };
    }
  }

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

  return { name, gender, dob, club, fra, preEntry, partner, category, course, predictedTime };
}

function savePeople2(name, gender, dob, club, fra, category, partner) {
  addPerson(name, null, gender, dob, club, fra, category, false);
  if (partner) addPerson(partner.name, null, partner.gender, partner.dob, partner.club, partner.fraNumber, category, false);
}

export async function submitEntry(formData) {
  const prep = prepareEntry(formData);
  if (prep.error || prep.bannedWarning) return prep;
  const { name, gender, dob, club, fra, preEntry, partner, category, course, predictedTime } = prep;

  if (courseFull(course)) return { error: `${course} is full (limit ${getEntryLimit(course)})` };

  const bibNumber = (formData.bibOverride && +formData.bibOverride > 0)
    ? +formData.bibOverride : getNextBibNumber();

  let dibberNumber = 0;
  let lostWarning  = '';
  let usedBeacon   = 0;
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
  } else if (usingBeacons(course)) {
    if (formData.dibberOverride && +formData.dibberOverride > 0) {
      const lostBeacon = state.beacons.find(b => +b.number === +formData.dibberOverride);
      if (lostBeacon?.lost) return { error: `Beacon ${formData.dibberOverride} is marked lost (since ${lostBeacon.lost})` };
      dibberNumber = +formData.dibberOverride;
    } else {
      const next = getNextBeaconNumber();
      if (next === null) return { error: state.beacons.length === 0
        ? 'No beacons loaded — load beacon numbers before registering this entry'
        : 'No more beacon numbers available — load more beacon numbers' };
      dibberNumber = next.number;
      if (next.skipped.length)
        lostWarning = `Beacon${next.skipped.length > 1 ? 's' : ''} ${next.skipped.join(', ')} skipped (marked lost)`;
    }
    usedBeacon = dibberNumber;
  }

  addEntry({ bibNumber, dibberNumber, fraNumber: fra, name, club, gender, dob, category, course, preEntry, partner, predictedTime });
  savePeople2(name, gender, dob, club, fra, category, partner);
  sortPeople();
  markBeaconUsed(usedBeacon);
  await saveEntries();
  if (usedBeacon) await saveBeacons();
  await savePeople();
  return { bibNumber, dibberNumber, error: '', lostWarning };
}

export async function updateEntry(bibNumber, formData) {
  const idx = findEntryByBib(bibNumber);
  if (idx < 0) return { error: `Bib ${bibNumber} not found` };
  const e = state.entries[idx];

  const prep = prepareEntry(formData, e, bibNumber);
  if (prep.error || prep.bannedWarning) return prep;
  const { name, gender, dob, club, fra, preEntry, partner, category, course: prepCourse, predictedTime } = prep;

  // Bib change
  if (formData.bibOverride && +formData.bibOverride > 0 && +formData.bibOverride !== +bibNumber) {
    const newBib = +formData.bibOverride;
    if (findEntryByBib(newBib) >= 0) return { error: `Bib ${newBib} is already in use` };
    e.bibNumber = newBib;
  }

  // Dibber/beacon resequencing when course type changes
  let lostWarning = '';
  const newCourse = formData.course !== undefined ? formData.course : prepCourse;
  const wasUsingDibbers = usingDibbers(e.course);
  const nowUsingDibbers = usingDibbers(newCourse);
  const wasUsingBeacons = usingBeacons(e.course);
  const nowUsingBeacons = usingBeacons(newCourse);

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
  } else if (nowUsingDibbers && formData.dibberOverride !== undefined) {
    // Guarded by nowUsingDibbers (not just "formData.dibberOverride !== undefined") — the
    // entries form sends this one shared "Fob" field's value as formData.dibberOverride
    // regardless of which pool the course actually uses (see js/views/entries.js), so without
    // this guard a Beacons-timed entry's own override would also fall through to this branch and
    // clash-check itself against the wrong pool.
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

  if (wasUsingBeacons && !nowUsingBeacons) {
    const oldBeacon = +e.dibberNumber || 0;
    e.dibberNumber = 0;
    if (oldBeacon > 0) shiftBeaconsBackward(idx + 1, oldBeacon);
  } else if (!wasUsingBeacons && nowUsingBeacons) {
    if (state.beacons.length === 0)
      return { error: 'No beacons loaded — load beacon numbers before changing this entry to a beacon course' };
    const { idx: newListIdx, skipped } = nextBeaconListIdx(idx);
    if (newListIdx < 0 || newListIdx >= state.beacons.length)
      return { error: 'No more beacon numbers available — load more beacon numbers' };
    e.dibberNumber = +state.beacons[newListIdx].number;
    markBeaconUsed(e.dibberNumber);
    shiftBeaconsForward(idx + 1, newListIdx);
    if (skipped.length)
      lostWarning = `Beacon${skipped.length > 1 ? 's' : ''} ${skipped.join(', ')} skipped (marked lost)`;
  } else if (nowUsingBeacons && formData.dibberOverride !== undefined) {
    // See the dibberOverride branch's own doc above — same reasoning, guarded by
    // nowUsingBeacons instead.
    const newBeacon = +formData.dibberOverride || 0;
    if (newBeacon > 0 && newBeacon !== +e.dibberNumber) {
      const lostBeacon = state.beacons.find(b => +b.number === newBeacon);
      if (lostBeacon?.lost) return { error: `Beacon ${newBeacon} is marked lost (since ${lostBeacon.lost})` };
      const clashIdx = findEntryByDibber(newBeacon);
      if (clashIdx >= 0 && clashIdx !== idx)
        return { error: `Beacon ${newBeacon} is already assigned to bib ${state.entries[clashIdx].bibNumber}` };
    }
    if (newBeacon > 0) markBeaconUsed(newBeacon);
    e.dibberNumber = newBeacon;
  }

  e.name = name; e.gender = gender; e.dob = dob; e.club = club;
  e.fraNumber = fra; e.preEntry = preEntry; e.partner = partner;
  e.category = category; e.course = newCourse; e.predictedTime = predictedTime;

  await saveEntries();
  if (nowUsingBeacons) await saveBeacons();
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
  if (usingBeacons(course) && state.beacons.length === 0)
    return { error: 'No beacons loaded — load beacon numbers before registering this entry' };

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

  const useManualBeacon = !!(formData.dibberOverride && +formData.dibberOverride > 0);
  let shiftBeaconListIdx = -1;
  let usedBeacon = 0;

  if (usingBeacons(course) && !useManualBeacon) {
    const freeBeacon = +state.entries[idx].dibberNumber || 0;
    const newListIdx = freeBeacon > 0 ? beaconListIdx(freeBeacon) : nextBeaconListIdx(idx);
    if (newListIdx < 0 || newListIdx >= state.beacons.length)
      return { error: 'No more beacon numbers available — load more beacon numbers' };
    dibberNumber = +state.beacons[newListIdx].number;
    shiftBeaconListIdx = newListIdx;
    usedBeacon = dibberNumber;
  } else if (useManualBeacon) {
    dibberNumber = +formData.dibberOverride;
    usedBeacon = dibberNumber;
  }

  // Shift all entries from atBib upward — guarded by usingDibbers(e.course)/usingBeacons(e.course)
  // since both pools share the one entry.dibberNumber field (see createEntry()'s own doc); without
  // that guard, a beacon-timed entry sitting between dibber-timed ones (or vice versa) would be
  // mistaken for a member of the wrong sequence.
  let listIdx = shiftListIdx;
  let beaconListIdxCursor = shiftBeaconListIdx;
  for (let i = idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    e.bibNumber = +e.bibNumber + 1;
    if (listIdx >= 0 && usingDibbers(e.course) && +e.dibberNumber > 0) {
      listIdx++;
      e.dibberNumber = listIdx < state.dibbers.length ? +state.dibbers[listIdx].shortCode : 0;
    } else if (beaconListIdxCursor >= 0 && usingBeacons(e.course) && +e.dibberNumber > 0) {
      beaconListIdxCursor++;
      e.dibberNumber = beaconListIdxCursor < state.beacons.length ? +state.beacons[beaconListIdxCursor].number : 0;
      markBeaconUsed(e.dibberNumber);
    }
  }

  state.entries.splice(idx, 0, { bibNumber: atBib, dibberNumber, fraNumber: fra, name, club, gender, dob, category, course, preEntry, partner: partner || null });
  savePeople2(name, gender, dob, club, fra, category, partner);
  sortPeople();
  markBeaconUsed(usedBeacon);
  await saveEntries();
  if (usedBeacon || beaconListIdxCursor >= 0) await saveBeacons();
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

  // Track where to resume dibber/beacon allocation (the slot freed by the deleted entry) — which
  // pool the deleted entry's own dibberNumber belonged to is dictated by its course's timing
  // method (see createEntry()'s own doc on the shared field), not by a separate field.
  let nextDibberIdx = -1;
  if (usingDibbers(deleted.course) && +deleted.dibberNumber > 0) {
    nextDibberIdx = state.dibbers.findIndex(d => +d.shortCode === +deleted.dibberNumber);
  }
  let nextBeaconIdx = -1;
  if (usingBeacons(deleted.course) && +deleted.dibberNumber > 0) {
    nextBeaconIdx = state.beacons.findIndex(b => +b.number === +deleted.dibberNumber);
  }

  state.entries.splice(idx, 1);

  // Guarded by usingDibbers(e.course)/usingBeacons(e.course) — see insertEntryAndRenumber()'s own
  // doc on why, now that both pools share entry.dibberNumber.
  for (let i = idx; i < state.entries.length; i++) {
    const e = state.entries[i];
    e.bibNumber = +e.bibNumber - 1;
    if (nextDibberIdx >= 0 && usingDibbers(e.course) && +e.dibberNumber > 0) {
      if (nextDibberIdx < state.dibbers.length) {
        e.dibberNumber = +state.dibbers[nextDibberIdx].shortCode;
        nextDibberIdx++;
      }
    } else if (nextBeaconIdx >= 0 && usingBeacons(e.course) && +e.dibberNumber > 0) {
      if (nextBeaconIdx < state.beacons.length) {
        e.dibberNumber = +state.beacons[nextBeaconIdx].number;
        nextBeaconIdx++;
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
  if (!entry) return '';
  return entry.partner ? `${entry.name} / ${entry.partner.name}` : (entry.name || '');
}

/** Export dibber entries as SI Timing CSV rows. */
export function exportSITimingCSV(entries) {
  const rows = [];
  for (const e of entries) {
    // usingDibbers(e.course) — not just "has a dibberNumber" — since a beacon-timed entry's own
    // fob number lives in this same shared field (see createEntry()'s own doc) and would
    // otherwise be looked up against state.dibbers and wrongly rejected/thrown on below.
    if (!e.bibNumber || !e.dibberNumber || !usingDibbers(e.course)) continue;
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