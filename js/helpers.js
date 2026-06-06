'use strict';

import { state } from './state.js';
import { saveHelpers, savePeople, saveClubs } from './state.js';
import { GENDER } from './constants.js';
import { normaliseDate, cleanName, iequal } from './utils.js';
import { calculateCategory } from './categories.js';
import { addPerson, addClub, sortPeople, sortClubs } from './data.js';

// ============================================================
// Helper registration logic (translated from Helpers.xml)
// ============================================================

/** Get total number of helpers */
export function getNumberOfHelpers() {
  return state.helpers.length;
}

/** Find a helper by number. Returns index or -1. */
export function findHelperByNumber(number) {
  if (!number || +number <= 0) return -1;
  return state.helpers.findIndex(h => +h.number === +number);
}

/** Find a helper by name (case-insensitive). Returns index or -1. */
export function findHelperByName(name) {
  const n = (name || '').toUpperCase().trim();
  return state.helpers.findIndex(h => (h.name || '').toUpperCase() === n);
}

/** Get a helper object by number. Returns null if not found. */
export function getHelper(number) {
  const idx = findHelperByNumber(number);
  return idx >= 0 ? state.helpers[idx] : null;
}

/** Get the next helper number to use */
export function getNextHelperNumber() {
  let max = 0;
  for (const h of state.helpers) {
    const n = +h.number;
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * Add or update a helper.
 * Returns the index in state.helpers, or -1 on failure.
 */
export function addHelper({ number, name, club, gender, dob, category, role }) {
  if (!name) return -1;

  let idx = number ? findHelperByNumber(number) : -1;
  if (idx < 0) {
    idx = state.helpers.length;
    state.helpers.push({});
  }

  const h = state.helpers[idx];
  h.number   = number   || getNextHelperNumber();
  h.name     = cleanName(name);
  h.club     = cleanName(club || h.club || '');
  h.gender   = gender   || h.gender || '';
  h.dob      = normaliseDate(dob || h.dob || '');
  h.category = category || h.category || '';
  h.role     = role     || h.role || '';

  return idx;
}

/**
 * Submit a new helper from the registration form.
 * formData: {name, gender, dob, club, role}
 * Returns {number, error} — error is '' on success.
 */
export async function submitHelper(formData) {
  const name   = cleanName(formData.name || '');
  const gender = (formData.gender || '').charAt(0).toUpperCase();
  const dob    = normaliseDate(formData.dob || '');
  const club   = cleanName(formData.club || '');
  const role   = formData.role || '';

  if (!name) return { error: 'Name is required' };

  let category = '';
  if (dob && gender !== GENDER.PAIR_PREFIX) {
    category = calculateCategory(dob, gender);
  }

  const number = getNextHelperNumber();
  addHelper({ number, name, club, gender, dob, category, role });

  // Update people list (as helper)
  addPerson(name, null, gender, dob, club, '', category, true);
  if (club) addClub(club);

  sortPeople();
  sortClubs();
  await saveHelpers();
  await savePeople();
  await saveClubs();

  return { number, error: '' };
}

/**
 * Update an existing helper.
 * Returns {error} — error is '' on success.
 */
export async function updateHelper(number, formData) {
  const idx = findHelperByNumber(number);
  if (idx < 0) return { error: `Helper ${number} not found` };

  const h = state.helpers[idx];
  if (formData.name     !== undefined) h.name     = cleanName(formData.name);
  if (formData.gender   !== undefined) h.gender   = formData.gender;
  if (formData.dob      !== undefined) h.dob      = normaliseDate(formData.dob);
  if (formData.club     !== undefined) h.club     = cleanName(formData.club);
  if (formData.category !== undefined) h.category = formData.category;
  if (formData.role     !== undefined) h.role     = formData.role;

  await saveHelpers();
  return { error: '' };
}

/** Delete a helper by number */
export async function deleteHelper(number) {
  const idx = findHelperByNumber(number);
  if (idx < 0) return { error: `Helper ${number} not found` };
  state.helpers.splice(idx, 1);
  await saveHelpers();
  return { error: '' };
}

/** Get helpers sorted by number */
export function getSortedHelpers() {
  return [...state.helpers].sort((a, b) => (+a.number || 0) - (+b.number || 0));
}

/** Get all roles defined in state.roles */
export function getRoles() {
  return state.roles.map(r => r.role).filter(Boolean);
}

/** Get helpers for a specific role */
export function getHelpersByRole(role) {
  return state.helpers.filter(h => iequal(h.role, role));
}