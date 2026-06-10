'use strict';

import { readTable, writeTable } from './storage.js';
import { FRA_CATEGORIES, WFRA_CATEGORIES, DEFAULT_PAIR_CATEGORIES } from './constants.js';

// ============================================================
// Global in-memory state, loaded from and saved to JSON tables
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
  finishers:  [],  // {action, number, time} — all other fields derived from entries
  results:    [],  // {course, bibNumber, position, inCatPos, name, club, category, time, behindPercent, behindTime, prize}
  prizes:     [],  // {position, category, inCatPos, time, number, name, priority}
  siResults:  [],  // dynamic - whatever comes from SI results CSV
  fraPreset:  [],  // editable FRA category preset (saved to fra_preset.csv)
  wfraPreset: [],  // editable WFRA category preset (saved to wfra_preset.csv)

  // Runtime-only (not persisted)
  finishNumbersMap: {},  // 'S101' -> ['5','7'] (course-prefix + bib -> array of finisher indices)
  dirty: new Set(),      // set of FILE keys that need saving
};

// ---- Load all data from CSV files ----

export async function loadAll() {
  await Promise.all([
    loadEvent(),
    loadList('people'),
    loadList('clubs'),
    loadList('dibbers'),
    loadList('categories'),
    loadList('roles'),
    loadList('preEntries'),
    loadList('entries'),
    loadList('helpers'),
    loadList('finishers'),
    loadList('results'),
    loadList('prizes'),
    loadList('siResults'),
    loadPreset('fraPreset',  FRA_CATEGORIES),
    loadPreset('wfraPreset', WFRA_CATEGORIES),
  ]);
  if (state.categories.length === 0) applyFRACategories();
}

async function loadEvent() {
  const rows = await readTable('event');
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

async function loadPreset(key, defaults) {
  const rows = await readTable(key);
  if (rows && rows.length > 0) {
    state[key] = rows;
  } else {
    state[key] = defaults.map((row, i) => {
      const pair = DEFAULT_PAIR_CATEGORIES[i] || [999, 'none', 'NOW', 999];
      return {
        maleMinAge: row[0], maleCat: row[1], maleRef: row[2], maleMaxDist: row[3],
        femaleMinAge: row[4], femaleCat: row[5], femaleRef: row[6], femaleMaxDist: row[7],
        pairMinAge: pair[0], pairCat: pair[1], pairRef: pair[2], pairMaxDist: pair[3],
      };
    });
  }
}

async function loadList(key) {
  const rows = await readTable(key);
  state[key] = Array.isArray(rows) ? rows : [];
}

// ---- Save individual tables ----

export async function saveEvent()        { await writeTable('event',      [state.event]); }
export async function savePeople()       { await writeTable('people',     state.people); }
export async function saveClubs()        { await writeTable('clubs',      state.clubs); }
export async function saveDibbers()      { await writeTable('dibbers',    state.dibbers); }
export async function saveCategories()   { await writeTable('categories', state.categories); }
export async function saveFraPreset()    { await writeTable('fraPreset',  state.fraPreset); }
export async function saveWfraPreset()   { await writeTable('wfraPreset', state.wfraPreset); }
export async function saveRoles()        { await writeTable('roles',      state.roles); }
export async function savePreEntries()   { await writeTable('preEntries', state.preEntries); }
export async function saveEntries()      { await writeTable('entries',    state.entries); }
export async function saveHelpers()      { await writeTable('helpers',    state.helpers); }
export async function saveFinishers()    { await writeTable('finishers',  state.finishers); }
export async function saveResults()      { await writeTable('results',    state.results); }
export async function savePrizes()       { await writeTable('prizes',     state.prizes); }
export async function saveSIResults()    { await writeTable('siResults',  state.siResults); }

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
