'use strict';

import { state } from './state.js';
import { createHelper } from './schema.js';
import { saveHelpers, savePeople } from './state.js';
import { normaliseDate, cleanName } from './utils.js';
import { calculateCategory } from './categories.js';
import { addPerson, sortPeople } from './data.js';


/** Get total number of helpers */
export function getNumberOfHelpers() {
  return state.helpers.length;
}

/** Find a helper by number. Returns index or -1. */
export function findHelperByNumber(number) {
  if (!number || +number <= 0) return -1;
  return state.helpers.findIndex(h => +h.number === +number);
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
    state.helpers.push(createHelper());
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

function prepareHelper(formData, existingHelper = null) {
  const ex = existingHelper;
  const name   = cleanName(formData.name   !== undefined ? formData.name   : (ex?.name   || ''));
  const gender =          (formData.gender !== undefined ? formData.gender : (ex?.gender || ''));
  const dob    = normaliseDate(formData.dob!== undefined ? formData.dob    : (ex?.dob    || ''));
  const club   = cleanName(formData.club   !== undefined ? formData.club   : (ex?.club   || ''));
  const role   =          (formData.role   !== undefined ? formData.role   : (ex?.role   || ''));

  if (!name) return { error: 'Name is required' };

  const category = dob ? calculateCategory(dob, gender) : (ex?.category || '');

  return { name, gender, dob, club, role, category };
}

export async function submitHelper(formData) {
  const prep = prepareHelper(formData);
  if (prep.error) return { error: prep.error };
  const { name, gender, dob, club, role, category } = prep;

  const number = getNextHelperNumber();
  addHelper({ number, name, club, gender, dob, category, role });
  addPerson(name, null, gender, dob, club, '', category, true);
  sortPeople();
  await saveHelpers();
  await savePeople();
  return { number, error: '' };
}

export async function updateHelper(number, formData) {
  const idx = findHelperByNumber(number);
  if (idx < 0) return { error: `Helper ${number} not found` };

  const prep = prepareHelper(formData, state.helpers[idx]);
  if (prep.error) return { error: prep.error };
  const { name, gender, dob, club, role, category } = prep;

  const h = state.helpers[idx];
  h.name = name; h.gender = gender; h.dob = dob;
  h.club = club; h.role = role; h.category = category;

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

/** Delete all helpers. */
export async function clearAllHelpers() {
  state.helpers = [];
  await saveHelpers();
  return { error: '' };
}

/** Get helpers sorted by number */
export function getSortedHelpers() {
  return [...state.helpers].sort((a, b) => (+a.number || 0) - (+b.number || 0));
}
