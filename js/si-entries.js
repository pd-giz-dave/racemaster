'use strict';

import { state } from './state.js';
import { savePreEntries } from './state.js';
import { GENDER } from './constants.js';
import { normaliseDate, cleanName } from './utils.js';
import { parseSICSV } from './csv.js';
import { SI } from './si-schema.js';


/**
 * Parse raw pre-entries CSV text into preEntries array.
 * Supports both Sportident and EntryCentral formats.
 * Returns array of preEntry objects.
 */
export function parseSIEntriesCSV(text) {
  if (!text) return [];
  const { rows } = parseSICSV(text);
  if (!rows.length) return [];

  return rows.map(r => parsePreEntryRow(r));
}

function parsePreEntryRow(r) {
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(r).find(rk => rk.trim().toUpperCase() === k.toUpperCase());
      if (found !== undefined) return (r[found] || '').trim();
    }
    return '';
  };

  const result = {};
  for (const [field, keys] of Object.entries(SI.entriesImport)) {
    result[field] = get(...keys);
  }

  // Normalise gender — leave blank if not recognised so verify can flag it
  const g = result.gender.toUpperCase().charAt(0);
  result.gender = g === 'F' ? GENDER.FEMALE : g === 'M' ? GENDER.MALE : '';

  return result;
}

/**
 * Import SI Entries CSV text into state.preEntries.
 * Deduplicates by participantNumber or name+dob.
 * Returns {added, updated, errors[]}.
 */
export async function importSIEntries(csvText) {
  const rows = parseSIEntriesCSV(csvText);
  if (!rows.length) return { added: 0, updated: 0, errors: ['No data found in file'] };

  let added = 0, updated = 0;
  const errors = [];

  for (const pe of rows) {
    const name = cleanName(`${pe.firstName} ${pe.lastName}`.trim());
    if (!name) continue;

    // Try to find existing by participant number
    let idx = -1;
    if (pe.participantNumber) {
      idx = state.preEntries.findIndex(e => e.participantNumber === pe.participantNumber);
    }
    // Fallback: find by name+dob
    if (idx < 0 && pe.dob) {
      const nameUC = name.toUpperCase();
      const dob = normaliseDate(pe.dob);
      idx = state.preEntries.findIndex(e => {
        const eName = cleanName(`${e.firstName} ${e.lastName}`).toUpperCase();
        return eName === nameUC && normaliseDate(e.dob) === dob;
      });
    }

    if (idx >= 0) {
      // Update
      Object.assign(state.preEntries[idx], pe);
      updated++;
    } else {
      state.preEntries.push(pe);
      added++;
    }
  }

  await savePreEntries();
  return { added, updated, errors };
}

/**
 * Verify pre-entries: return array of issues found.
 * Checks CSV format (required fields present), missing dob, duplicates.
 */
export function verifySIEntries() {
  const issues = [];

  if (!state.preEntries.length) return issues;

  // Format check: if required fields are absent across all entries the CSV format is wrong
  const missing = [];
  if (state.preEntries.every(pe => !pe.participantNumber))           missing.push('participant number');
  if (state.preEntries.every(pe => !pe.firstName && !pe.lastName))   missing.push('name');
  if (state.preEntries.every(pe => !pe.dob))                         missing.push('date of birth');
  if (state.preEntries.every(pe => !pe.gender))                      missing.push('gender');
  if (missing.length) {
    issues.push({ issue: `CSV format not recognised — required columns absent: ${missing.join(', ')}` });
    return issues;
  }

  const seen = new Map(); // key → index
  for (let i = 0; i < state.preEntries.length; i++) {
    const pe = state.preEntries[i];
    const name = cleanName(`${pe.firstName||''} ${pe.lastName||''}`.trim());
    const dob  = normaliseDate(pe.dob || '');

    if (!name) {
      issues.push({ row: i+1, issue: 'Missing name' });
      continue;
    }
    if (!dob) {
      issues.push({ row: i+1, name, issue: 'Missing or invalid date of birth' });
    }
    if (!pe.gender) {
      issues.push({ row: i+1, name, issue: 'Missing or unrecognised gender' });
    }

    const key = `${name.toUpperCase()}|${dob}`;
    if (seen.has(key)) {
      issues.push({ row: i+1, name, issue: `Duplicate of row ${seen.get(key)+1}` });
    } else {
      seen.set(key, i);
    }
  }

  return issues;
}

/**
 * Clear all pre-entries.
 */
export async function clearSIEntries() {
  state.preEntries = [];
  await savePreEntries();
}

/** Get pre-entries sorted by last name then first name */
export function getSortedPreEntries() {
  return [...state.preEntries].sort((a, b) => {
    const la = (a.lastName || '').toUpperCase();
    const lb = (b.lastName || '').toUpperCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
    const fa = (a.firstName || '').toUpperCase();
    const fb = (b.firstName || '').toUpperCase();
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });
}
