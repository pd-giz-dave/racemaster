'use strict';

import { state } from './state.js';
import { saveSIResults } from './state.js';
import { COURSE, FINISHER } from './constants.js';
import { normaliseTime, iequal, timeToSeconds } from './utils.js';
import { parseSICSV } from './csv.js';
import { adjustedFinishTime } from './time-utils.js';
import { getEntry } from './entries.js';
import { buildFinishNumbersMap } from './finishers.js';

// ============================================================
// SportIdent results import/export (translated from SIResults.xml)
// ============================================================

/**
 * Import an SI results CSV file into state.siResults.
 * Returns {imported, errors[]}.
 */
export async function importSIResults(csvText) {
  if (!csvText) return { imported: 0, errors: ['Empty file'] };

  const { rows } = parseSICSV(csvText);
  if (!rows.length) return { imported: 0, errors: ['No data in file'] };

  state.siResults = rows;
  await saveSIResults();
  return { imported: rows.length, errors: [] };
}

/**
 * Verify SI results against entries.
 * Returns array of {bib, name, issue} objects.
 */
export function verifySIResults() {
  const issues = [];

  for (const r of state.siResults) {
    const bib = getSIBib(r);
    if (!bib) continue;

    const entry = getEntry(bib);
    if (!entry) {
      issues.push({ bib, name: getSIName(r), issue: `Bib ${bib} not in entries` });
      continue;
    }

    // Check name similarity (warn if very different)
    const siName = getSIName(r).toUpperCase();
    const entryName = (entry.name || '').toUpperCase();
    if (siName && entryName && siName !== entryName) {
      issues.push({ bib, name: entry.name, issue: `Name mismatch: SI has "${getSIName(r)}"` });
    }
  }

  return issues;
}

/**
 * Convert SI results into finishers format and merge into state.finishers.
 * Clears existing SI-sourced finishers first.
 * Returns {added, errors[]}.
 */
export async function formatSIResults(course) {
  course = course || COURSE.SENIORS;
  const errors = [];

  // Remove previously imported SI finishers for this course
  state.finishers = state.finishers.filter(
    f => !(iequal(f.course, course) && f.source === 'si')
  );

  // Sort SI results by finish time / position
  const sorted = [...state.siResults]
    .filter(r => getSIBib(r) > 0 && getSIFinishTime(r))
    .sort((a, b) => timeToSeconds(getSIFinishTime(a)) - timeToSeconds(getSIFinishTime(b)));

  let position = state.finishers.filter(f => iequal(f.course, course)).length + 1;
  let added = 0;

  for (const r of sorted) {
    const bib = getSIBib(r);
    const rawTime = getSIFinishTime(r);
    const entry = getEntry(bib);

    const name     = entry ? entry.name     : getSIName(r);
    const club     = entry ? entry.club     : getSIClub(r);
    const category = entry ? entry.category : getSICategory(r);
    let error = '';

    if (!entry) error = `Bib ${bib} not in entries`;

    const adjustedTime = entry && rawTime
      ? adjustedFinishTime(entry, rawTime)
      : rawTime;

    // Check for existing finisher
    const existing = state.finishers.find(
      f => iequal(f.course, course) && +f.number === bib && f.source !== 'si'
    );
    if (existing) {
      error = `Bib ${bib} already has a manual finish`;
      errors.push(error);
    }

    state.finishers.push({
      position,
      action:       FINISHER.NORMAL,
      number:       bib,
      time:         rawTime,
      name,
      club,
      category,
      course,
      error,
      adjustedTime,
      status:       '',
      source:       'si',
    });
    position++;
    added++;
  }

  buildFinishNumbersMap();
  return { added, errors };
}

/**
 * Export entries in SI Timing CSV format (for loading into SI timing software).
 * Returns an array of row objects keyed by SI_TIMING_COL_NAMES values.
 * dibberNumber is stored as shortCode; mapped to longCode here for CardNumbers.
 */
export function exportSITimingCSV(entries) {
  const rows = [];
  for (const e of entries) {
    if (!e.bibNumber) continue;
    const dibberLong = e.dibberNumber > 0
      ? (state.dibbers.find(d => +d.shortCode === +e.dibberNumber)?.longCode || '')
      : '';
    const genderPrefix = (e.gender || '').charAt(0).toUpperCase() === 'F' ? 'F' : 'M';
    rows.push({
      'RaceNumber':         e.bibNumber,
      'NumberCompetitors':  '',
      'CardNumbers':        dibberLong,
      'MembershipNumbers':  e.fraNumber || '',
      'Forenames':          '',
      'Surnames':           e.name || '',
      'Name (Free Format)': e.name || '',
      'Category':           e.category || '',
      'Club':               e.club || '',
      'CourseClass':        e.course || '',
      'Entry System IDs':   e.preEntry || '',
      'Eligibility':        '',
      'GenderDOB':          e.dob ? `${genderPrefix}${e.dob}` : genderPrefix,
    });
  }
  return rows;
}

// ---- Field accessor helpers for SI result rows ----

function getField(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(rk => rk.trim().toUpperCase() === k.toUpperCase());
    if (found !== undefined) return (row[found] || '').trim();
  }
  return '';
}

function getSIBib(r)        { return +getField(r, 'Stno', 'BibNo', 'Bib', 'Number', 'bibNumber') || 0; }
function getSIName(r)       { return getField(r, 'Surname', 'Name', 'Last name', 'Lastname'); }
function getSIClub(r)       { return getField(r, 'club+city', 'Club', 'Team', 'Organisation'); }
function getSICategory(r)   { return getField(r, 'Cl.', 'Class', 'Category', 'Cat'); }
function getSIFinishTime(r) {
  const t = getField(r, 'Time', 'FinishTime', 'Finish time', 'RaceTime', 'Race time');
  return normaliseTime(t) || '';
}