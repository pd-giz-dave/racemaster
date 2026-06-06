'use strict';

import { GENDER, COURSE, LIST_SEP, SUFFIX_SEP } from './constants.js';

// ============================================================
// Utility functions (translated from Utils.xml)
// ============================================================

/** Normalise a time string to HH:MM:SS. Returns '' on failure. */
export function normaliseTime(t) {
  if (!t || typeof t !== 'string') return '';
  t = t.trim();
  if (!t) return '';
  // Accept HH:MM:SS, H:MM:SS, MM:SS, M:SS
  const parts = t.split(':').map(Number);
  if (parts.some(isNaN)) return '';
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) { [h, m, s] = parts; }
  else if (parts.length === 2) { [m, s] = parts; }
  else if (parts.length === 1) { s = parts[0]; }
  else return '';
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return '';
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/** Normalise a date string to DD/MM/YYYY. Returns '' on failure. */
export function normaliseDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  // Try DD/MM/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [,dd,mm,yyyy] = m;
    const dt = new Date(+yyyy, +mm-1, +dd);
    if (isNaN(dt)) return '';
    return `${String(dd).padStart(2,'0')}/${String(mm).padStart(2,'0')}/${yyyy}`;
  }
  // Try DD/MM/YY — expand 2-digit year: if 2000+yy is in the future use 1900+yy
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const [,dd,mm,yy] = m;
    const century = (2000 + +yy) > new Date().getFullYear() ? 1900 : 2000;
    const yyyy = String(century + +yy);
    const dt = new Date(+yyyy, +mm-1, +dd);
    if (isNaN(dt)) return '';
    return `${String(dd).padStart(2,'0')}/${String(mm).padStart(2,'0')}/${yyyy}`;
  }
  // Try YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [,yyyy,mm,dd] = m;
    return `${dd}/${mm}/${yyyy}`;
  }
  // Try to parse with Date (fallback)
  const dt = new Date(s);
  if (isNaN(dt)) return '';
  const dd  = String(dt.getDate()).padStart(2,'0');
  const mm  = String(dt.getMonth()+1).padStart(2,'0');
  const yyyy= String(dt.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/** Convert time string HH:MM:SS to total seconds since midnight */
export function timeToSeconds(t) {
  if (!t) return 0;
  const norm = normaliseTime(t);
  if (!norm) return 0;
  const [h, m, s] = norm.split(':').map(Number);
  return h*3600 + m*60 + s;
}

/** Convert seconds since midnight to HH:MM:SS string */
export function secondsToTime(secs) {
  secs = Math.max(0, Math.min(86399, Math.round(secs)));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/** Return true iff the time is a valid HH:MM:SS race time (not DNF/DSQ) */
export function isValidRaceTime(t) {
  if (!t) return false;
  return !!normaliseTime(String(t));
}

/** Strip a DNF/DSQ/no-time prefix from a race time */
export function sanitiseRaceTime(t) {
  if (!t) return t;
  const s = String(t);
  if (s.length >= 3) {
    const pre = s.substring(0, 3).toUpperCase();
    if (pre === 'DNF' || pre === 'DSQ' || pre === '?@P') return s.substring(3).trim();
  }
  return s;
}

/** Parse a date string (DD/MM/YYYY) to a Date object */
export function parseDate(d) {
  const s = normaliseDate(d);
  if (!s) return null;
  const [dd, mm, yyyy] = s.split('/').map(Number);
  return new Date(yyyy, mm-1, dd);
}

/** Format today's date as DD/MM/YYYY */
export function today() {
  const dt = new Date();
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

/** Build a display name for a person entry */
export function buildNameItem(firstName, lastName, gender, dob) {
  let fullName = firstName || '';
  if (lastName) fullName = (fullName + ' ' + lastName).trim();
  const g = (gender || '').toUpperCase();
  const gPrefix = g.startsWith(GENDER.PAIR_PREFIX)   ? GENDER.PAIR_PREFIX
                : g.startsWith(GENDER.FEMALE_PREFIX)  ? GENDER.FEMALE_PREFIX
                : GENDER.MALE_PREFIX;
  const dobStr = normaliseDate(dob) || '';
  return `${fullName}${SUFFIX_SEP}${gPrefix} ${dobStr}`;
}

/** Extract the name portion from a buildNameItem result */
export function unBuildNameItem(nameItem) {
  return extractPart(nameItem, 0, SUFFIX_SEP);
}

/** Build a pseudo multi-column list item */
export function buildListItem(...cols) {
  return cols.filter(c => c !== undefined).join(LIST_SEP);
}

/** Get a column from a pseudo multi-column list item */
export function getListColumn(item, col = 0) {
  if (!item) return '';
  const parts = String(item).split(LIST_SEP);
  return col < parts.length ? parts[col].trim() : '';
}

/** Extract part N from a string joined by sep (0-indexed) */
export function extractPart(s, part, sep) {
  if (!s) return '';
  const parts = String(s).split(sep);
  return part < parts.length ? parts[part] : '';
}

/** Strip a leading prefix from a string */
export function stripPrefix(prefix, s) {
  if (!s) return s;
  if (String(s).startsWith(prefix)) return s.substring(prefix.length);
  return s;
}

/** Capitalise each word */
export function capitalise(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}

/** Remove double spaces and trim */
export function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** Return ordinal string for a number (1st, 2nd, 3rd, etc.) */
export function ordinal(n) {
  const i = parseInt(n);
  if (isNaN(i)) return String(n);
  const s = ['th','st','nd','rd'];
  const v = i % 100;
  return i + (s[(v-20)%10] || s[v] || s[0]);
}

/** Case-insensitive string comparison */
export function iequal(a, b) {
  return String(a || '').toUpperCase() === String(b || '').toUpperCase();
}

/** Levenshtein-distance based similarity (lower = more similar) */
export function similarity(s1, s2) {
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i || j));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

/** Create a sanitised file name */
export function sanitiseFileName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
}

/** Show a simple confirm dialog */
export function confirm(msg) {
  return window.confirm(msg);
}

/** Show a simple alert */
export function alert(msg) {
  window.alert(msg);
}

/** Find a row index in an array by field value (case-insensitive) */
export function findByField(arr, field, value) {
  const v = String(value || '').toUpperCase();
  return arr.findIndex(r => String(r[field] || '').toUpperCase() === v);
}

/** Sort an array of objects by one or more string fields */
export function sortBy(arr, ...fields) {
  return [...arr].sort((a, b) => {
    for (const f of fields) {
      const av = String(a[f] || '').toUpperCase();
      const bv = String(b[f] || '').toUpperCase();
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

/** Number sort comparator for a field */
export function sortByNum(arr, field) {
  return [...arr].sort((a, b) => (+a[field] || 0) - (+b[field] || 0));
}

/** Deep clone a plain object/array */
export function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

/** Format a number as three zero-padded digits (for prize position sorting) */
export function pad3(n) { return String(+n || 0).padStart(3, '0'); }

/** Show the busy/progress indicator */
export function showBusy(msg = '') {
  const el = document.getElementById('busy-message');
  if (el) el.textContent = msg;
  const overlay = document.getElementById('busy-overlay');
  if (overlay) overlay.style.display = msg ? 'flex' : 'none';
}