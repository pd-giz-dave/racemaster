'use strict';

import { readCSV, writeCSV } from './storage.js';
import { FILE, FRA_CATEGORIES, WFRA_CATEGORIES, DEFAULT_PAIR_CATEGORIES } from './constants.js';

// ============================================================
// Global in-memory state, loaded from and saved to CSV files
// ============================================================

export const state = {
  event: {
    name: '', distance: 0, date: '', startTime: '11:00:00',
    firstBibNumber: 1, categories: 'FRA', entryLimit: 200,
    preEntryFormat: 'None', timingMethod: 'Stopwatch',
    maleRecord: '', femaleRecord: '',
    prizeDepthOverall: 3, prizeDepthPerCategory: 3,
    juniorLimit: 'None', juniorStartTime: '', juniorEntryLimit: 0,
    juniorTimingMethod: 'None',
    stopwatchOffsetTime: '', stopwatchLateStart: false,
    stopwatchStartOffset: '', juniorStopwatchStartOffset: '',
  },
  people:     [],  // {name, gender, dob, club, fraNumber, lastSeen, seenTotal, lastHelped, helpedTotal}
  clubs:      [],  // {name, lastSeen, seenTotal}
  dibbers:    [],  // {shortCode, longCode, availability}
  categories: [],  // {maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist, pairMinAge, pairCat, pairRef, pairMaxDist}
  roles:      [],  // {role, description}
  preEntries: [],  // {participantNumber, firstName, lastName, gender, dob, club, fraNumber, category, email, ...}
  entries:    [],  // {bibNumber, dibberNumber, fraNumber, name, club, gender, dob, category, course, preEntry, startTime, retired, status}
  helpers:    [],  // {number, name, club, gender, dob, category, role}
  finishers:  [],  // {position, action, number, time, name, club, category, course, error, adjustedTime, status, source}
  safety:     [],  // {number, name, course, dob, category, status, reason}
  results:    [],  // {course, bibNumber, position, inCatPos, name, club, category, time, behindPercent, behindTime, prize}
  prizes:     [],  // {position, category, inCatPos, time, number, name, priority}
  siResults:  [],  // dynamic - whatever comes from SI timing CSV

  // Runtime-only (not persisted)
  finishNumbersMap: {},  // 'S101' -> ['5','7'] (course-prefix + bib -> array of finisher indices)
  dirty: new Set(),      // set of FILE keys that need saving
};

// ---- Load all data from CSV files ----

export async function loadAll() {
  await Promise.all([
    loadEvent(),
    loadList('people',     PEOPLE_FIELDS),
    loadList('clubs',      CLUBS_FIELDS),
    loadList('dibbers',    DIBBERS_FIELDS),
    loadList('categories', CAT_FIELDS),
    loadList('roles',      ROLES_FIELDS),
    loadList('preEntries', PRE_ENTRY_FIELDS, FILE.PRE_ENTRIES),
    loadList('entries',    ENTRY_FIELDS),
    loadList('helpers',    HELPER_FIELDS),
    loadList('finishers',  FINISHER_FIELDS),
    loadList('safety',     SAFETY_FIELDS),
    loadList('results',    RESULT_FIELDS),
    loadList('prizes',     PRIZE_FIELDS),
    loadList('siResults',  null, FILE.SI_RESULTS),
  ]);
  if (state.categories.length === 0) applyFRACategories();
}

async function loadEvent() {
  const rows = await readCSV(FILE.EVENT);
  if (rows.length > 0) {
    Object.assign(state.event, rows[0]);
    state.event.distance          = +state.event.distance || 0;
    state.event.firstBibNumber    = +state.event.firstBibNumber || 1;
    state.event.entryLimit        = +state.event.entryLimit || 200;
    state.event.juniorEntryLimit  = +state.event.juniorEntryLimit || 0;
    state.event.prizeDepthOverall     = +state.event.prizeDepthOverall || 3;
    state.event.prizeDepthPerCategory = +state.event.prizeDepthPerCategory || 3;
    state.event.stopwatchLateStart    = state.event.stopwatchLateStart === 'true';
  }
}

async function loadList(key, fields, filename) {
  const fn = filename || FILE[key.toUpperCase()] || FILE[key.replace(/([A-Z])/g, '_$1').toUpperCase()];
  const actualFile = filename || guessFile(key);
  const rows = await readCSV(actualFile);
  state[key] = rows;
}

function guessFile(key) {
  const map = {
    people: FILE.PEOPLE, clubs: FILE.CLUBS, dibbers: FILE.DIBBERS,
    categories: FILE.CATEGORIES, roles: FILE.ROLES,
    preEntries: FILE.PRE_ENTRIES, entries: FILE.ENTRIES,
    helpers: FILE.HELPERS, finishers: FILE.FINISHERS,
    safety: FILE.SAFETY, results: FILE.RESULTS, prizes: FILE.PRIZES,
    siResults: FILE.SI_RESULTS,
  };
  return map[key];
}

// ---- Save individual tables ----

export async function saveEvent() {
  await writeCSV(FILE.EVENT, [state.event], EVENT_FIELDS);
}

export async function savePeople()     { await writeCSV(FILE.PEOPLE,      state.people,     PEOPLE_FIELDS); }
export async function saveClubs()      { await writeCSV(FILE.CLUBS,       state.clubs,      CLUBS_FIELDS); }
export async function saveDibbers()    { await writeCSV(FILE.DIBBERS,     state.dibbers,    DIBBERS_FIELDS); }
export async function saveCategories() { await writeCSV(FILE.CATEGORIES,  state.categories, CAT_FIELDS); }
export async function saveRoles()      { await writeCSV(FILE.ROLES,       state.roles,      ROLES_FIELDS); }
export async function savePreEntries() { await writeCSV(FILE.PRE_ENTRIES, state.preEntries, PRE_ENTRY_FIELDS); }
export async function saveEntries()    { await writeCSV(FILE.ENTRIES,     state.entries,    ENTRY_FIELDS); }
export async function saveHelpers()    { await writeCSV(FILE.HELPERS,     state.helpers,    HELPER_FIELDS); }
export async function saveFinishers()  { await writeCSV(FILE.FINISHERS,   state.finishers,  FINISHER_FIELDS); }
export async function saveSafety()     { await writeCSV(FILE.SAFETY,      state.safety,     SAFETY_FIELDS); }
export async function saveResults()    { await writeCSV(FILE.RESULTS,     state.results,    RESULT_FIELDS); }
export async function savePrizes()     { await writeCSV(FILE.PRIZES,      state.prizes,     PRIZE_FIELDS); }
export async function saveSIResults()  { await writeCSV(FILE.SI_RESULTS,  state.siResults); }
export async function saveSITiming(rows) { await writeCSV(FILE.SI_TIMING, rows); }

/** Apply the FRA preset categories to state.categories */
export function applyFRACategories() {
  _applyPreset(FRA_CATEGORIES, DEFAULT_PAIR_CATEGORIES);
}

export function applyWFRACategories() {
  _applyPreset(WFRA_CATEGORIES, DEFAULT_PAIR_CATEGORIES);
}

function _applyPreset(preset, pairs) {
  state.categories = preset.map((row, i) => {
    const pair = pairs[i] || [999, 'none', 'NOW', 999];
    return {
      maleMinAge:   row[0], maleCat:  row[1], maleRef:  row[2], maleMaxDist:   row[3],
      femaleMinAge: row[4], femaleCat: row[5], femaleRef: row[6], femaleMaxDist: row[7],
      pairMinAge:   pair[0], pairCat: pair[1], pairRef: pair[2], pairMaxDist:   pair[3],
    };
  });
}

// ---- Field definitions (used as CSV column headers) ----

export const EVENT_FIELDS = [
  'name','distance','date','startTime','firstBibNumber','categories',
  'entryLimit','preEntryFormat','timingMethod','maleRecord','femaleRecord',
  'prizeDepthOverall','prizeDepthPerCategory',
  'juniorLimit','juniorStartTime','juniorEntryLimit','juniorTimingMethod',
  'stopwatchOffsetTime','stopwatchLateStart','stopwatchStartOffset','juniorStopwatchStartOffset',
];

export const PEOPLE_FIELDS = [
  'name','gender','dob','club','fraNumber','lastSeen','seenTotal','lastHelped','helpedTotal',
];

export const CLUBS_FIELDS = ['name','lastSeen','seenTotal'];

export const DIBBERS_FIELDS = ['shortCode','longCode','availability'];

export const CAT_FIELDS = [
  'maleMinAge','maleCat','maleRef','maleMaxDist',
  'femaleMinAge','femaleCat','femaleRef','femaleMaxDist',
  'pairMinAge','pairCat','pairRef','pairMaxDist',
];

export const ROLES_FIELDS = ['role','description'];

export const PRE_ENTRY_FIELDS = [
  'participantNumber','firstName','lastName','gender','dob','club','fraNumber',
  'category','email','address1','address2','town','county','postcode','country',
  'telephone','mobile','eligibility','contactName','contactTelephone','medical','carReg',
  'participantId',
];

export const ENTRY_FIELDS = [
  'bibNumber','dibberNumber','fraNumber','name','club','gender','dob',
  'category','course','preEntry','startTime','retired','status',
];

export const HELPER_FIELDS = [
  'number','name','club','gender','dob','category','role',
];

export const FINISHER_FIELDS = [
  'position','action','number','time','name','club','category','course',
  'error','adjustedTime','status','source',
];

export const SAFETY_FIELDS = [
  'number','name','course','dob','category','status','reason',
];

export const RESULT_FIELDS = [
  'course','bibNumber','position','inCatPos','name','club','category',
  'time','behindPercent','behindTime','prize',
];

export const PRIZE_FIELDS = [
  'position','category','inCatPos','time','number','name','priority',
];