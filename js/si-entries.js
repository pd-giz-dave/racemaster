'use strict';

import { state } from './state.js';
import { savePreEntries } from './state.js';
import { GENDER } from './constants.js';
import { normaliseDate, cleanName } from './utils.js';
import { parseSICSV } from './csv.js';

// ============================================================
// SportIdent pre-entry import logic (translated from SIEntries.xml)
// ============================================================

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
  // Pick all the fields we want from all those available.
  // Try field name variants for SI and EC (there is no overlap, so no ambiguity)

  const get = (...keys) => {
    // local function to test what we've got
    for (const k of keys) {
      const found = Object.keys(r).find(rk => rk.trim().toUpperCase() === k.toUpperCase());
      if (found !== undefined) return (r[found] || '').trim();
    }
    return '';
  };

  // get each field of interest (case insensitive)
  const participantNumber = get('Participant - Participant No','RaceNumber');
  const siEntriesId      = get('Participant - SiEntries ID');
  const firstName  = get('Participant - First Name','Forename');
  const lastName   = get('Participant - Last Name','Surname');
  const genderRaw  = get('Participant - Gender','Participant - Class Sex at Birth','Participant - Sex','Gender');
  const dob        = get('Participant - Date of Birth','DOB');
  const club       = get('Entry Details - Club','Club');
  const fraNumber  = get('Entry Details - FRA Membership Number','MembershipId');
  const category   = get('Participant - Class','AgeGroup');
  const email      = get('Participant - Email Address','email');
  const address1   = get('Participant - Address Line 1','Address1');
  const address2   = get('Participant - Address Line 2','Address2');
  const town       = get('Participant - Postal Town','Town/City');
  const county     = get('Participant - County','Region');
  const postcode   = get('Participant - Post Code','Postcode');
  const country    = get('Participant - Country','Country');
  const telephone  = get('Participant - Telephone No','phone');
  const mobile     = get('Participant - Mobile No');
  const eligibility= get('English Championships Eligibility - I am eligible for English Champs');
  const contactName= get('Emergency Details - Emergency Contact Name');
  const contactTelephone = get('Emergency Details - Emergency Contact Telephone');
  const medical    = get('Emergency Details - Medical Conditions');
  const carReg     = get('Emergency Details - Car Registration');

  // Normalise gender
  const genderFirst = genderRaw.toUpperCase().charAt(0);
  const gender = genderFirst === 'F' ? GENDER.FEMALE : GENDER.MALE;

  return {
    participantNumber, siEntriesId, firstName, lastName, gender, dob,
    club, fraNumber, category, email,
    address1, address2, town, county, postcode, country,
    telephone, mobile, eligibility,
    contactName, contactTelephone, medical, carReg,
  };
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

/** Count pre-entries */
export function getPreEntryCount() {
  return state.preEntries.length;
}