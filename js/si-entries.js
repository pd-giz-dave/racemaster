'use strict';

import { state } from './state.js';
import { savePreEntries } from './state.js';
import { GENDER, COURSE, FORMAT } from './constants.js';
import { normaliseDate, normaliseTime, cleanName, iequal } from './utils.js';
import { parseSICSV } from './csv.js';

// ============================================================
// SportIdent pre-entry import logic (translated from SIEntries.xml)
// ============================================================

/**
 * Parse raw SI Entries CSV text into preEntries array.
 * Supports both Sportident and EntryCentral formats.
 * Returns array of preEntry objects.
 */
export function parseSIEntriesCSV(text) {
  if (!text) return [];
  const { headers: rawHeaders, rows } = parseSICSV(text);
  if (!rows.length) return [];

  // Detect format by header fields
  const headers = rawHeaders.map(h => h.toUpperCase());
  const isEC = headers.some(h => h.includes('FIRST NAME') || h.includes('FIRSTNAME'));
  const isSI = headers.some(h => h === 'STNO' || h === 'CHIPNO');

  return rows.map(r => parsePreEntryRow(r, isEC));
}

function parsePreEntryRow(r, isEC) {
  // Normalise key access: try common field name variants
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(r).find(rk => rk.trim().toUpperCase() === k.toUpperCase());
      if (found !== undefined) return (r[found] || '').trim();
    }
    return '';
  };

  const participantNumber = get('participantNumber','Stno','Bib','BibNumber','Number');
  const firstName  = get('firstName','First name','Firstname','Given name','Forename');
  const lastName   = get('lastName','Surname','Last name','Lastname','Family name');
  const genderRaw  = get('gender','S','Sex','Gender');
  const dobRaw     = get('dob','YB','DOB','DateOfBirth','Date of birth','Birth date');
  const club       = get('club','club+city','Club','Team','Organisation');
  const fraNumber  = get('fraNumber','FRA','FRANumber','FRA Number');
  const category   = get('category','Cl.','Class','Category','Cat');
  const email      = get('email','Email','E-mail');
  const address1   = get('address1','Address','Address1','Add1');
  const address2   = get('address2','Address2','Add2');
  const town       = get('town','Town','City');
  const county     = get('county','County');
  const postcode   = get('postcode','Postcode','Post code','Zip');
  const country    = get('country','Country');
  const telephone  = get('telephone','Telephone','Phone','Tel');
  const mobile     = get('mobile','Mobile','Cell');
  const eligibility= get('eligibility','Eligibility');
  const contactName= get('contactName','Emergency contact','EmergencyContact','Contact name');
  const contactTel = get('contactTelephone','Emergency telephone','ContactTelephone','Contact tel');
  const medical    = get('medical','Medical','MedicalInfo');
  const carReg     = get('carReg','Car reg','CarReg','Car registration');
  const participantId = get('participantId','ParticipantId','Id');

  // Normalise gender
  const genderFirst = genderRaw.toUpperCase().charAt(0);
  const gender = genderFirst === 'F' ? GENDER.FEMALE : GENDER.MALE;

  // Normalise dob — may be year only (YB) or full date
  let dob = '';
  if (dobRaw) {
    if (/^\d{4}$/.test(dobRaw.trim())) {
      // Year-only from SI: convert to 01/01/YYYY
      dob = `01/01/${dobRaw.trim()}`;
    } else {
      dob = normaliseDate(dobRaw);
    }
  }

  return {
    participantNumber, firstName, lastName, gender, dob,
    club, fraNumber, category, email,
    address1, address2, town, county, postcode, country,
    telephone, mobile, eligibility,
    contactName, contactTelephone: contactTel, medical, carReg,
    participantId,
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
 * Checks for missing dob, duplicate names, unknown clubs etc.
 */
export function verifySIEntries() {
  const issues = [];
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