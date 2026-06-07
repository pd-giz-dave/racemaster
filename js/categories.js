'use strict';

import { state } from './state.js';
import { GENDER, COURSE, FRA_CATEGORIES, WFRA_CATEGORIES, DEFAULT_PAIR_CATEGORIES } from './constants.js';
import { normaliseDate, parseDate } from './utils.js';

// ============================================================
// Category logic (translated from Categories.xml)
// ============================================================

/** Get all male/open category names from state */
export function getMaleCategories() {
  return state.categories
    .map(r => r.maleCat)
    .filter(c => c && c !== '-' && c.toLowerCase() !== 'none');
}

/** Get all female category names from state */
export function getFemaleCategories() {
  return state.categories
    .map(r => r.femaleCat)
    .filter(c => c && c !== '-' && c.toLowerCase() !== 'none');
}

/** Get all pair category names from state */
export function getPairCategories() {
  return state.categories
    .map(r => r.pairCat)
    .filter(c => c && c !== '-' && c.toLowerCase() !== 'none');
}

/** Get categories for a given gender (M/F/P prefix) */
export function getCategoriesForGender(genderPrefix) {
  const g = (genderPrefix || '').toUpperCase().charAt(0);
  if (g === GENDER.FEMALE_PREFIX) return getFemaleCategories();
  if (g === GENDER.PAIR_PREFIX)   return getPairCategories();
  return getMaleCategories();
}

/**
 * Calculate the category for the given DoB and gender on the race date.
 * Returns the category string or '' if cannot determine.
 */
export function calculateCategory(dob, genderIn) {
  const gender = (genderIn || '').toUpperCase().charAt(0);
  if (gender === GENDER.PAIR_PREFIX) return '';

  const raceDateStr = state.event.date;
  const raceDate = parseDate(raceDateStr);
  const dobDate  = parseDate(normaliseDate(dob));
  if (!raceDate || !dobDate) return '';

  const isFemale = gender === GENDER.FEMALE_PREFIX;

  // EOY age = age at end of race year
  const eoyAge = raceDate.getFullYear() - dobDate.getFullYear();
  // NOW age = actual age on race date
  const birthday = new Date(raceDate.getFullYear(), dobDate.getMonth(), dobDate.getDate());
  const nowAge = birthday > raceDate ? eoyAge - 1 : eoyAge;

  let setCat = '';
  let prevRef = '';

  for (const row of state.categories) {
    const minAge = isFemale ? +row.femaleMinAge : +row.maleMinAge;
    const cat    = isFemale ? row.femaleCat     : row.maleCat;
    const ref    = isFemale ? row.femaleRef     : row.maleRef;

    if (!cat || cat.toLowerCase() === 'none') break;
    if (cat === '-') continue;

    if (ref === 'EOY') {
      if (minAge > eoyAge) break;
      setCat  = cat;
      prevRef = ref;
    } else if (minAge === eoyAge && prevRef === 'EOY') {
      // Edge case: transitioning from EOY to NOW
      break;
    } else {
      if (minAge > nowAge) break;
      setCat  = cat;
      prevRef = ref;
    }
  }
  return setCat;
}

/**
 * Calculate the max age limit (exclusive) for a category.
 * Returns 0 if not found.
 */
export function maxAgeFromCategory(fromCategory) {
  const maleCat = toMaleCategory(fromCategory);
  for (let i = 0; i < state.categories.length - 1; i++) {
    if ((state.categories[i].maleCat || '').toUpperCase() === maleCat.toUpperCase()) {
      return +state.categories[i+1].maleMinAge || 0;
    }
  }
  return 0;
}

/** Return the male version of a category (strips/adds gender prefix) */
export function toMaleCategory(category, truncate = false) {
  if (!category) return '';
  const c = String(category).trim();
  // Junior: starts with U, ends with G or B
  if (c.toUpperCase().startsWith('U')) {
    const base = /[GB]$/i.test(c) ? c.slice(0, -1) : c;
    if (truncate) return base;
    return base + 'B';
  }
  // Senior female: starts with W
  if (c.toUpperCase().startsWith('W')) {
    if (truncate) return c.slice(1);
    return 'M' + c.slice(1);
  }
  // Senior male: starts with M
  if (c.toUpperCase().startsWith('M')) {
    if (truncate) return c.slice(1);
    return c;
  }
  // Truncated senior
  if (truncate) return c;
  return 'M' + c;
}

/** Return true if the category qualifies for the senior race */
export function seniorAllowed(category) {
  const juniorLimit = (state.event.juniorLimit || '').toUpperCase();
  if (!juniorLimit || juniorLimit === 'NONE') return true;
  const catMax = maxAgeFromCategory(category);
  if (catMax === 0) return true; // unknown or open-ended (oldest) category → senior
  return catMax > maxAgeFromCategory(juniorLimit);
}

/** Get the max distance allowed for a category. Returns 0 if not found. */
export function distanceFromCategory(category) {
  for (const row of state.categories) {
    if (iequal(row.femaleCat, category)) return +row.femaleMaxDist || 0;
    if (iequal(row.maleCat,   category)) return +row.maleMaxDist   || 0;
    if (iequal(row.pairCat,   category)) return +row.pairMaxDist   || 0;
  }
  return 0;
}

function iequal(a, b) {
  return (a || '').toUpperCase() === (b || '').toUpperCase();
}

/**
 * Given a distance, return the highest junior category (male, truncated)
 * that is NOT allowed at that distance.
 * Returns '' if all categories are allowed.
 */
export function categoryFromDistance(distance) {
  let best = '';
  let bestDist = 0;
  for (const row of state.categories) {
    const dist = +row.maleMaxDist || 0;
    if (dist > 0 && dist < distance && dist > bestDist) {
      bestDist = dist;
      best = row.maleCat;
    }
  }
  return best ? toMaleCategory(best, true) : '';
}

/** Determine the gender from a category name */
export function genderFromCategory(category) {
  for (const row of state.categories) {
    if (iequal(row.femaleCat, category)) return GENDER.FEMALE;
    if (iequal(row.maleCat,   category)) return GENDER.MALE;
    if (iequal(row.pairCat,   category)) return GENDER.PAIR;
  }
  return GENDER.UNKNOWN;
}

/** Return the sort priority of a category (lower = higher priority for prizes) */
export function getCategoryPriority(category) {
  const n = state.categories.length;
  for (let i = 0; i < n; i++) {
    const row = state.categories[i];
    if (iequal(row.femaleCat, category)) return i;
    if (iequal(row.maleCat,   category)) return i + n + 1;
    if (iequal(row.pairCat,   category)) return i + n*2 + 1;
  }
  return 999999;
}

/** Calculate the course for an entrant based on their category or DoB */
export function calculateCourse(category, dob) {
  let cat = category;
  if (!cat) cat = calculateCategory(dob, GENDER.MALE);
  if (seniorAllowed(cat)) return COURSE.SENIORS;
  return COURSE.JUNIORS;
}

/** Apply FRA preset to state.categories (uses editable fraPreset if populated) */
export function applyFRAPreset() {
  const src = state.fraPreset && state.fraPreset.length > 0 ? state.fraPreset : null;
  state.categories = src ? src.map(r => ({ ...r })) : _builtinRows(FRA_CATEGORIES);
}

/** Apply WFRA preset to state.categories (uses editable wfraPreset if populated) */
export function applyWFRAPreset() {
  const src = state.wfraPreset && state.wfraPreset.length > 0 ? state.wfraPreset : null;
  state.categories = src ? src.map(r => ({ ...r })) : _builtinRows(WFRA_CATEGORIES);
}

/** Reset state.fraPreset to built-in hardcoded values */
export function resetFRAPreset() {
  state.fraPreset = _builtinRows(FRA_CATEGORIES);
}

/** Reset state.wfraPreset to built-in hardcoded values */
export function resetWFRAPreset() {
  state.wfraPreset = _builtinRows(WFRA_CATEGORIES);
}

function _builtinRows(preset) {
  return preset.map((row, i) => {
    const pair = DEFAULT_PAIR_CATEGORIES[i] || [999, 'none', 'NOW', 999];
    return {
      maleMinAge: row[0], maleCat: row[1], maleRef: row[2], maleMaxDist: row[3],
      femaleMinAge: row[4], femaleCat: row[5], femaleRef: row[6], femaleMaxDist: row[7],
      pairMinAge: pair[0], pairCat: pair[1], pairRef: pair[2], pairMaxDist: pair[3],
    };
  });
}