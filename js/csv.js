'use strict';

// CSV parsing and formatting utilities

/**
 * Parse a CSV string into an array of objects using the first row as headers.
 * Handles quoted fields, embedded commas, and embedded newlines.
 */
export function parseCSV(text) {
  const lines = splitCSVLines(text.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVRow(lines[0]).map(h => h.trim());
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] !== undefined ? vals[idx] : ''; });
    result.push(obj);
  }
  return result;
}

/**
 * Convert an array of objects to a CSV string.
 * Column order is determined by the fields array (if given) or object keys.
 */
export function formatCSV(rows, fields) {
  if (!rows || rows.length === 0) return '';
  const cols = fields || Object.keys(rows[0]);
  const lines = [cols.map(escapeCSV).join(',')];
  for (const row of rows) {
    lines.push(cols.map(c => escapeCSV(row[c] ?? '')).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function escapeCSV(val) {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function splitCSVLines(text) {
  const lines = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i+1] === '"') { current += '""'; i++; }
      else { current += '"'; inQuote = !inQuote; }
    } else if (!inQuote && (ch === '\n' || (ch === '\r' && text[i+1] === '\n'))) {
      if (ch === '\r') i++;
      lines.push(current);
      current = '';
    } else if (!inQuote && ch === '\r') {
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i+1] === '"') { current += '"'; i++; }
      else inQuote = !inQuote;
    } else if (!inQuote && ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse a CSV string where the first row is column headers but they may have
 * leading spaces and optional '*' prefix (as used by SI Entries format).
 * Returns {headers, rows} where headers are trimmed and '*' stripped.
 */
export function parseSICSV(text) {
  const lines = splitCSVLines(text.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const rawHeaders = parseCSVRow(lines[0]);
  // Deduplicate headers: second occurrence becomes Name_2, third Name_3, etc.
  const seen = {};
  const headers = rawHeaders.map(h => {
    const base = h.trim().replace(/^\*/, '');
    if (!base) return base;
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] > 1 ? `${base}_${seen[base]}` : base;
  });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] !== undefined ? vals[idx].trim() : ''; });
    rows.push(obj);
  }
  return { headers, rows };
}