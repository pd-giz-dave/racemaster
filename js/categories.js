'use strict';

import { state } from './state.js';
import { GENDER, COURSE } from './constants.js';
import { normaliseDate, parseDate, ciEq } from './utils.js';

// [maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist]
export const FRA_CATEGORIES = [
  [6,  'U10B', 'EOY', 1.5,  6, 'U10G', 'EOY', 1.5],
  [10, 'U12B', 'EOY', 3,   10, 'U12G', 'EOY', 3],
  [12, 'U14B', 'EOY', 5,   12, 'U14G', 'EOY', 5],
  [14, 'U16B', 'EOY', 6,   14, 'U16G', 'EOY', 6],
  [16, 'U18B', 'EOY', 8,   16, 'U18G', 'EOY', 8],
  [18, 'U20B', 'EOY', 10,  18, 'U20G', 'EOY', 10],
  [20, 'MU23', 'EOY', 999, 20, 'WU23', 'EOY', 999],
  [23, 'MSEN', 'NOW', 999, 23, 'WSEN', 'NOW', 999],
  [40, 'M40',  'NOW', 999, 40, 'W40',  'NOW', 999],
  [45, 'M45',  'NOW', 999, 45, 'W45',  'NOW', 999],
  [50, 'M50',  'NOW', 999, 50, 'W50',  'NOW', 999],
  [55, 'M55',  'NOW', 999, 55, 'W55',  'NOW', 999],
  [60, 'M60',  'NOW', 999, 60, 'W60',  'NOW', 999],
  [65, 'M65',  'NOW', 999, 65, 'W65',  'NOW', 999],
  [70, 'M70',  'NOW', 999, 70, 'W70',  'NOW', 999],
  [75, 'M75',  'NOW', 999, 75, 'W75',  'NOW', 999],
  [80, 'M80',  'NOW', 999, 80, 'W80',  'NOW', 999],
];

export const WFRA_CATEGORIES = [
  [6,  'U10B', 'EOY', 1.5,  6, 'U10G', 'EOY', 1.5],
  [10, 'U12B', 'EOY', 3,   10, 'U12G', 'EOY', 3],
  [12, 'U14B', 'EOY', 5,   12, 'U14G', 'EOY', 5],
  [14, 'U16B', 'EOY', 6,   14, 'U16G', 'EOY', 6],
  [16, 'U18B', 'EOY', 8,   16, 'U18G', 'EOY', 8],
  [18, 'U20B', 'EOY', 10,  18, 'U20G', 'EOY', 10],
  [20, 'MU23', 'EOY', 999, 20, 'WU23', 'EOY', 999],
  [23, 'MSEN', 'NOW', 999, 23, 'WSEN', 'NOW', 999],
  [40, 'M40',  'NOW', 999, 40, 'W40',  'NOW', 999],
  [50, 'M50',  'NOW', 999, 50, 'W50',  'NOW', 999],
  [60, 'M60',  'NOW', 999, 60, 'W60',  'NOW', 999],
  [70, 'M70',  'NOW', 999, 70, 'W70',  'NOW', 999],
  [80, 'M80',  'NOW', 999, 80, 'W80',  'NOW', 999],
];

/** Get all male/open category names from state */
export function getMaleCategories() {
  return state.categories.map(r => r.maleCat).filter(Boolean);
}

/** Get all female category names from state */
export function getFemaleCategories() {
  return state.categories.map(r => r.femaleCat).filter(Boolean);
}

/**
 * Calculate the category for the given DoB and gender on the race date.
 * Returns the category string or '' if cannot determine.
 */
export function calculateCategory(dob, genderIn) {
  const gender = genderIn || '';

  const raceDateStr = state.event.date;
  const raceDate = parseDate(raceDateStr);
  const dobDate  = parseDate(normaliseDate(dob));
  if (!raceDate || !dobDate) return '';

  const isFemale = ciEq(gender, GENDER.FEMALE);

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
    if (ciEq(row.femaleCat, category)) return GENDER.FEMALE;
    if (ciEq(row.maleCat,   category)) return GENDER.MALE;
  }
  return '';
}

/** Return the age-band row index of a category (same for both genders, lower = younger) */
export function getCategoryPriority(category) {
  for (let i = 0; i < state.categories.length; i++) {
    const row = state.categories[i];
    if (ciEq(row.femaleCat, category) || ciEq(row.maleCat, category)) return i;
  }
  return 999999;
}

/** Derive pair gender label from two gender strings */
export function derivePairGender(gender1, gender2) {
  const f1 = (gender1 || '').charAt(0).toUpperCase() === 'F';
  const f2 = (gender2 || '').charAt(0).toUpperCase() === 'F';
  if (f1 && f2)   return 'Female';
  if (!f1 && !f2) return 'Male';
  return 'Mixed';
}

/**
 * Calculate the combined category and pair gender for a pairs entry.
 * Rule: if either competitor is a junior, use the younger one's category;
 *       if both are senior, use the older one's category.
 * Returns { category, pairGender } where pairGender is 'Male'/'Female'/'Mixed'.
 */
export function calculatePairCategory(dob1, gender1, dob2, gender2) {
  const cat1 = calculateCategory(dob1, gender1);
  const cat2 = calculateCategory(dob2, gender2);
  const pg   = derivePairGender(gender1, gender2);
  if (!cat1 && !cat2) return { category: '', pairGender: pg };
  if (!cat1) return { category: cat2, pairGender: pg };
  if (!cat2) return { category: cat1, pairGender: pg };

  const p1 = getCategoryPriority(cat1);
  const p2 = getCategoryPriority(cat2);
  const isJunior = cat => /^U\d/i.test(cat || '');

  let category;
  if (isJunior(cat1) || isJunior(cat2)) {
    // Use younger person (lower table index = smaller age = younger junior)
    category = p1 <= p2 ? cat1 : cat2;
  } else {
    // Both senior — use older person (higher table index = higher age band)
    category = p1 >= p2 ? cat1 : cat2;
  }
  return { category, pairGender: pg };
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
  return preset.map(row => ({
    maleMinAge: row[0], maleCat: row[1], maleRef: row[2], maleMaxDist: row[3],
    femaleMinAge: row[4], femaleCat: row[5], femaleRef: row[6], femaleMaxDist: row[7],
  }));
}