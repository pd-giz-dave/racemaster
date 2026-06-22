'use strict';

import { state } from './state.js';
import { savePeople } from './state.js';
import { GENDER } from './constants.js';
import { normaliseDate, cleanName, sortBy, today } from './utils.js';

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
export function addPerson(name, nameId, gender, dob, clubIn, fraNumber, _category, asHelper) {
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
  p.gender = gender === GENDER.FEMALE ? GENDER.FEMALE : GENDER.MALE;
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

/** Get next dibber number to use. Returns null if no dibbers loaded or list exhausted. */
export function getNextDibberNumber() {
  if (state.dibbers.length === 0) return null;
  const last = getLastDibberNumber();
  if (last > 0) {
    const idx = state.dibbers.findIndex(d => +d.shortCode === last);
    if (idx >= 0) return idx + 1 < state.dibbers.length ? +state.dibbers[idx + 1].shortCode : null;
  }
  const first = +state.event.firstDibberNumber || 1;
  const d = state.dibbers.find(d => +d.shortCode >= first);
  return d ? +d.shortCode : null;
}

/** Merge pre-entries into people list */
export async function mergeSIEntries() {
  const preEntries = state.preEntries;
  if (!preEntries.length) return { peopleAdded: 0 };

  let peopleAdded = 0;

  const existingKeys = new Set(state.people.map(p => makePersonKey(p.name, p.gender, p.dob)));

  for (const pe of preEntries) {
    const name   = cleanName(`${pe.firstName} ${pe.lastName}`.trim());
    const gender = normaliseGender(pe.gender);
    const dob    = normaliseDate(pe.dob);
    const club   = cleanName(pe.club);
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
      const idx = state.people.findIndex(p => makePersonKey(p.name, p.gender, p.dob) === key);
      if (idx >= 0) {
        if (club) state.people[idx].club = club;
        if (fra) state.people[idx].fraNumber = fra;
      }
    }
  }

  sortPeople();
  await savePeople();
  return { peopleAdded };
}

export function normaliseGender(g) {
  const u = (g || '').toUpperCase().trim();
  return u === 'M' || u === 'MALE' ? GENDER.MALE : u === 'F' || u === 'FEMALE' ? GENDER.FEMALE : '';
}
