'use strict';

import { state } from './state.js';
import { savePeople, saveClubs } from './state.js';
import { GENDER, UNATTACHED_CLUB } from './constants.js';
import { normaliseDate, cleanName, sortBy, today, similarity } from './utils.js';

// ============================================================
// People, clubs and dibbers management (from Data.xml)
// ============================================================

/** Find a person by name, gender and DoB. Returns index or -1. */
export function findPerson(name, gender, dob) {
  const key = makePersonKey(name, gender, dob);
  return state.people.findIndex(p => makePersonKey(p.name, p.gender, p.dob) === key);
}

function makePersonKey(name, gender, dob) {
  return [cleanName(name), (gender||'').charAt(0).toUpperCase(), normaliseDate(dob)]
    .join('|').toUpperCase().replace(/\s/g,'');
}

/**
 * Add or update a person in the people list.
 * Returns the index if a new person was added, -1 if updated, or null for a pair.
 */
export function addPerson(name, nameId, genderIn, dob, clubIn, fraNumber, category, asHelper) {
  const gender = (genderIn || '').charAt(0).toUpperCase();
  if (gender === GENDER.PAIR_PREFIX) return null;
  if (!asHelper && !normaliseDate(dob)) return null;

  const club = (clubIn || '').split(' | ')[0].trim();
  const cleanedName = cleanName(name);
  const cleanedClub = cleanName(club);

  let idx = nameId ? nameId - 1 : findPerson(cleanedName, gender, dob);
  let isNew = false;

  if (idx < 0 || idx >= state.people.length) {
    idx = state.people.length;
    state.people.push({ seenTotal: 0, helpedTotal: 0 });
    isNew = true;
  }

  const p = state.people[idx];
  p.name   = cleanedName;
  p.gender = gender === GENDER.FEMALE_PREFIX ? GENDER.FEMALE : GENDER.MALE;
  p.dob    = normaliseDate(dob) || p.dob || '';
  if (cleanedClub) p.club = cleanedClub;
  if (+fraNumber > 0) p.fraNumber = fraNumber;

  const eventDate = state.event.date || today();
  if (asHelper) {
    p.lastHelped   = eventDate;
    p.helpedTotal  = (+p.helpedTotal || 0) + 1;
  } else {
    p.lastSeen    = eventDate;
    p.seenTotal   = (+p.seenTotal || 0) + 1;
  }

  return isNew ? idx : null;
}

/** Sort people by name then dob */
export function sortPeople() {
  state.people = sortBy(state.people, 'name', 'dob');
}

/** Sort clubs by name */
export function sortClubs() {
  state.clubs = sortBy(state.clubs, 'name');
}

/**
 * Add or update a club. Returns index if new, null if existing.
 * clubEntry may contain '@ rowid' suffix (list box format).
 */
export function addClub(clubEntryIn) {
  const clubEntry = cleanName((clubEntryIn || '').split(' | ')[0].split(' @ ')[0].trim());
  if (!clubEntry) return null;

  const existing = state.clubs.findIndex(c => cleanName(c.name).toUpperCase() === clubEntry.toUpperCase());
  let idx;
  let isNew = false;
  if (existing >= 0) {
    idx = existing;
  } else {
    idx = state.clubs.length;
    state.clubs.push({ seenTotal: 0 });
    isNew = true;
  }
  const c = state.clubs[idx];
  c.name     = clubEntry;
  c.lastSeen = today();
  c.seenTotal = (+c.seenTotal || 0) + 1;
  return isNew ? idx : null;
}

/** Map a dibber short code to long code. Returns 0 for no-dibber, -1 if not found. */
export function mapDibberNumber(shortCode) {
  if (!shortCode || +shortCode <= 0) return 0;
  const d = state.dibbers.find(d => +d.shortCode === +shortCode);
  return d ? +d.longCode : -1;
}

/** Get last dibber short code number used in entries */
export function getLastDibberNumber() {
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const n = +state.entries[i].dibberNumber;
    if (n > 0) return n;
  }
  return 0;
}

/** Get last bib number used in entries */
export function getLastBibNumber() {
  let max = 0;
  for (const e of state.entries) {
    const n = +e.bibNumber;
    if (n > max) max = n;
  }
  return max;
}

/** Get next bib number to use */
export function getNextBibNumber() {
  const last = getLastBibNumber();
  return last > 0 ? last + 1 : +state.event.firstBibNumber || 1;
}

/** Get next dibber number to use */
export function getNextDibberNumber() {
  const last = getLastDibberNumber();
  if (last > 0) {
    const idx = state.dibbers.findIndex(d => +d.shortCode === last);
    if (idx >= 0 && idx + 1 < state.dibbers.length) return +state.dibbers[idx+1].shortCode;
  }
  return state.dibbers.length > 0 ? +state.dibbers[0].shortCode : 1;
}

/** Get total number of dibbers available */
export function getNumberOfDibbers() { return state.dibbers.length; }

/** Check for duplicate-ish names in people (returns array of {idx, dups}) */
export function checkPeopleDuplicates(threshold = 2) {
  const result = [];
  const sorted = sortBy(state.people, 'name');
  for (let i = 0; i < sorted.length; i++) {
    const ref = sorted[i].name.toLowerCase().replace(/\s/g,'');
    const refChar = ref.charAt(0);
    const dups = [];
    for (let j = i+1; j < sorted.length; j++) {
      const other = sorted[j].name.toLowerCase().replace(/\s/g,'');
      if (other.charAt(0) !== refChar) break;
      if (similarity(ref, other) <= threshold) dups.push(sorted[j].name);
    }
    if (dups.length) result.push({ name: sorted[i].name, dups });
  }
  return result;
}

/** Merge pre-entries into people and clubs lists */
export async function mergeSIEntries() {
  const preEntries = state.preEntries;
  if (!preEntries.length) return { peopleAdded: 0, clubsAdded: 0 };

  let peopleAdded = 0, clubsAdded = 0;

  // Build set of existing people keys
  const existingKeys = new Set(state.people.map(p => makePersonKey(p.name, p.gender, p.dob)));

  for (const pe of preEntries) {
    const name   = cleanName(`${pe.firstName} ${pe.lastName}`.trim());
    const gender = normaliseGender(pe.gender);
    const dob    = normaliseDate(pe.dob);
    const club   = cleanName(pe.club || UNATTACHED_CLUB);
    const fra    = pe.fraNumber || '';

    const key = makePersonKey(name, gender, dob);
    if (!existingKeys.has(key)) {
      state.people.push({
        name, gender, dob, club, fraNumber: fra,
        lastSeen: '', seenTotal: 0, lastHelped: '', helpedTotal: 0,
      });
      existingKeys.add(key);
      peopleAdded++;
    } else {
      // Update club and FRA number
      const idx = state.people.findIndex(p => makePersonKey(p.name, p.gender, p.dob) === key);
      if (idx >= 0) {
        if (club && club !== UNATTACHED_CLUB) state.people[idx].club = club;
        if (fra) state.people[idx].fraNumber = fra;
      }
    }

    // Clubs
    const existingClub = state.clubs.findIndex(c => (c.name || '').toUpperCase() === club.toUpperCase());
    if (existingClub < 0 && club) {
      state.clubs.push({ name: club, lastSeen: today(), seenTotal: 1 });
      clubsAdded++;
    }
  }

  sortPeople();
  sortClubs();
  await savePeople();
  await saveClubs();
  return { peopleAdded, clubsAdded };
}

function normaliseGender(g) {
  const first = (g || '').toUpperCase().charAt(0);
  if (first === 'F') return GENDER.FEMALE;
  return GENDER.MALE;
}