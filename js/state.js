'use strict';

import { readTable, writeTable } from './storage.js';
import { FRA_CATEGORIES, WFRA_CATEGORIES } from './categories.js';
import { BUILTIN_ROLES } from './roles.js';
import { createCategory, createEvent } from './schema.js';

// ============================================================
// Global in-memory state, loaded from and saved to JSON tables
// ============================================================

export const state = {
  event: createEvent(),
  people:     [],  // {name, gender, dob, club, fraNumber, lastSeen, seenTotal, lastHelped, helpedTotal, banned}
  // clubs derived from people — not persisted
  dibbers:    [],  // {shortCode, longCode, owner, lost, notes}
  categories: [],  // {maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist}
  roles:      [],  // {role, description}
  preEntries: [],  // {participantNumber, firstName, lastName, gender, dob, club, fraNumber, category, email, ...}
  entries:    [],  // {bibNumber, dibberNumber, fraNumber, name, club, gender, dob, category, course, preEntry}
  helpers:    [],  // {number, name, club, gender, dob, category, role}
  finishers:  [],  // {action, number, time}
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
    loadList('dibbers'),
    loadList('categories'),
    loadList('preEntries'),
    loadList('entries'),
    loadList('helpers'),
    loadList('finishers'),
    loadList('siResults'),
    loadPreset('roles', BUILTIN_ROLES, r => ({ ...r })),
    loadPreset('fraPreset',  FRA_CATEGORIES),
    loadPreset('wfraPreset', WFRA_CATEGORIES),
  ]);
  if (state.categories.length === 0) applyFRACategories();
}

async function loadEvent() {
  const rows = await readTable('event');
  if (rows.length > 0) {
    Object.assign(state.event, rows[0]);
    state.event.hasPairs          = !!rows[0].hasPairs;
    state.event.distance          = +state.event.distance || 0;
    state.event.firstBibNumber    = +state.event.firstBibNumber || 1;
    state.event.entryLimit        = +state.event.entryLimit || 200;
    state.event.juniorEntryLimit  = +state.event.juniorEntryLimit || 0;
    state.event.prizeDepthOverall            = +state.event.prizeDepthOverall            || 3;
    state.event.prizeDepthPerCategory        = +state.event.prizeDepthPerCategory        || 3;
    state.event.juniorPrizeDepthPerCategory  = +state.event.juniorPrizeDepthPerCategory  || 3;
  }
}

const categoryMapper = ([maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist]) =>
  createCategory({ maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist });

async function loadPreset(key, defaults, mapFn = categoryMapper) {
  const rows = await readTable(key);
  state[key] = (rows && rows.length > 0) ? rows : defaults.map(mapFn);
}

async function loadList(key) {
  const rows = await readTable(key);
  state[key] = Array.isArray(rows) ? rows : [];
}

// ---- Save individual tables ----

export async function saveEvent()        { await writeTable('event',      [state.event]); }
export async function savePeople()       { await writeTable('people',     state.people); }
export async function saveDibbers()      { await writeTable('dibbers',    state.dibbers); }
export async function saveCategories()   { await writeTable('categories', state.categories); }
export async function saveFraPreset()    { await writeTable('fraPreset',  state.fraPreset); }
export async function saveWfraPreset()   { await writeTable('wfraPreset', state.wfraPreset); }
export async function saveRoles()        { await writeTable('roles',      state.roles); }
export async function savePreEntries()   { await writeTable('preEntries', state.preEntries); }
export async function saveEntries()      { await writeTable('entries',    state.entries); }
export async function saveHelpers()      { await writeTable('helpers',    state.helpers); }
export async function saveFinishers()    { await writeTable('finishers',  state.finishers); }
export async function saveSIResults()    { await writeTable('siResults',  state.siResults); }

/** Apply the FRA preset categories to state.categories */
export function applyFRACategories() {
  _applyPreset(FRA_CATEGORIES);
}

export function applyWFRACategories() {
  _applyPreset(WFRA_CATEGORIES);
}

function _applyPreset(preset) {
  state.categories = preset.map(categoryMapper);
}
