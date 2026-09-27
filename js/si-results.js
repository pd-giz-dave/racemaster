'use strict';

import { state } from './state.js';
import { saveSIResults } from './state.js';
import { normaliseTime } from './utils.js';
import { parseSICSV } from './csv.js';
import { getEntry, getEntryName } from './entries.js';
import { SI } from './si-schema.js';


/**
 * Import an SI results CSV file into state.siResults.
 * Returns {imported, errors[]}.
 */
export async function importSIResults(csvText) {
  if (!csvText) return { imported: 0, errors: ['Empty file'] };

  const { headers, rows } = parseSICSV(csvText);
  if (!rows.length) return { imported: 0, errors: ['No data in file'] };

  const missing = SI.resultsImport.required.filter(col => !hasSIColumn(headers, col));
  if (missing.length) {
    return { imported: 0, errors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const issues = verifySIResults(rows);
  if (issues.length) {
    return { imported: 0, issues, errors: [`Verification failed — ${issues.length} issue(s) across ${rows.length} bib(s). Have you selected the wrong file?`] };
  }

  state.siResults = rows;
  await saveSIResults();
  return { imported: rows.length, issues: [], errors: [] };
}

export async function clearSIResults() {
  state.siResults = [];
  await saveSIResults();
}

/**
 * Verify SI results rows against entries.
 * Checks bib exists, name matches, and course matches.
 * Returns array of {bib, name, issue} objects.
 */
export function verifySIResults(rows = state.siResults) {
  const issues = [];

  for (const r of rows) {
    const bib = getSIBib(r);
    if (!bib) continue;

    const entry = getEntry(bib);
    if (!entry) {
      issues.push({ bib, name: getSIName(r), issue: `Bib ${bib} not in entries` });
      continue;
    }

    const siName    = getSIName(r).toUpperCase().trim();
    const entryName = getEntryName(entry).toUpperCase().trim();
    if (siName && entryName && siName !== entryName) {
      issues.push({ bib, name: entry.name, issue: `Name mismatch: SI "${getSIName(r)}" vs entry "${getEntryName(entry)}"` });
    }

    const siCourse    = getSICourse(r).toUpperCase().trim();
    const entryCourse = (entry.course || '').toUpperCase().trim();
    if (siCourse && entryCourse && siCourse !== entryCourse) {
      issues.push({ bib, name: entry.name, issue: `Course mismatch: SI "${getSICourse(r)}" vs entry "${entry.course}"` });
    }
  }

  return issues;
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

/** True if headers contains col, or (when col is part of an alias group) any of its aliases. */
function hasSIColumn(headers, col) {
  if (headers.includes(col)) return true;
  for (const key of ['bib', 'raceTime', 'course', 'status', 'name']) {
    const aliases = SI.resultsImport[key];
    if (aliases.includes(col)) return aliases.some(a => headers.includes(a));
  }
  return false;
}

// Bib values may have arbitrary text bracketing the number (e.g. "Bib #123", "(123)"),
// so pull out the first run of digits rather than parsing the whole field as a number.
export function getSIBib(r)        { return +(getField(r, ...SI.resultsImport.bib).match(/\d+/) || [0])[0] || 0; }
export function getSIRaceTime(r)   { return normaliseTime(getField(r, ...SI.resultsImport.raceTime)) || ''; }
// FinishTime and StartTime are time-of-day, not elapsed — never run them through the same
// accessor as RaceTime.
export function getSIFinishTime(r) { return normaliseTime(getField(r, ...SI.resultsImport.finishTime)) || ''; }
export function getSIStartTime(r)  { return normaliseTime(getField(r, ...SI.resultsImport.startTime)) || ''; }
export function getSICourse(r)     { return getField(r, ...SI.resultsImport.course); }
export function getSIStatus(r)     { return getField(r, ...SI.resultsImport.status); }
export function getSINumSplits(r)  { return +getField(r, 'NumSplits') || 0; }

/** n is the 1-based split number — see SI.resultsImport.split's own doc comment in si-schema.js
 *  for the "_N" numbering convention this expands. */
export function getSISplitTime(r, n) {
  const col = SI.resultsImport.split.replace('##', n === 1 ? '' : `_${n}`);
  return normaliseTime(getField(r, col)) || '';
}

/** Set of bibs accounted for in SI results (have a race time or a non-blank status). */
export function getSIAccountedBibs() {
  const bibs = new Set();
  for (const r of state.siResults) {
    const bib = getSIBib(r);
    if (bib > 0 && (getSIRaceTime(r) || getSIStatus(r))) bibs.add(bib);
  }
  return bibs;
}
function getSIName(r)       { return getField(r, ...SI.resultsImport.name); }
