'use strict';

import { state } from './state.js';
import { saveSIResults } from './state.js';
import { COURSE, SI_RESULTS_COL_NAMES } from './constants.js';
import { normaliseTime, iequal, timeToSeconds } from './utils.js';
import { parseSICSV } from './csv.js';
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

  const { headers, rows } = parseSICSV(csvText);
  if (!rows.length) return { imported: 0, errors: ['No data in file'] };

  const required = Object.values(SI_RESULTS_COL_NAMES);
  const missing = required.filter(col => !headers.includes(col));
  if (missing.length) {
    return { imported: 0, errors: [`Missing required columns: ${missing.join(', ')}`] };
  }

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
  state.finishers = state.finishers.filter(f => {
    if (f.source !== 'si') return true;
    const e = +f.number > 0 ? getEntry(+f.number) : null;
    return !iequal(e?.course || '', course);
  });

  // Sort SI results by finish time / position
  const sorted = [...state.siResults]
    .filter(r => getSIBib(r) > 0 && getSIFinishTime(r))
    .sort((a, b) => timeToSeconds(getSIFinishTime(a)) - timeToSeconds(getSIFinishTime(b)));

  let added = 0;

  for (const r of sorted) {
    const bib = getSIBib(r);
    const rawTime = getSIFinishTime(r);
    const entry = getEntry(bib);

    if (!entry) { errors.push(`Bib ${bib} not in entries`); }

    // Check for existing manual finisher
    const existing = state.finishers.find(f => +f.number === bib && f.source !== 'si');
    if (existing) {
      errors.push(`Bib ${bib} already has a manual finish`);
    }

    state.finishers.push({ action: 'Finish', number: bib, time: rawTime, source: 'si' });
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
// ---- Field accessor helpers for SI result rows ----

function getField(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(rk => rk.trim().toUpperCase() === k.toUpperCase());
    if (found !== undefined) return (row[found] || '').trim();
  }
  return '';
}

function getSIBib(r)        { return +getField(r, 'BibNo', 'Bib', 'Number', 'bibNumber') || 0; }
function getSIName(r)       { return getField(r, 'Surname', 'Name', 'Last name', 'Lastname'); }
function getSIFinishTime(r) {
  const t = getField(r, 'Time', 'FinishTime', 'Finish time', 'RaceTime', 'Race time');
  return normaliseTime(t) || '';
}