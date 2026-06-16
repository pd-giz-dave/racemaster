'use strict';


/** Normalise a time string to HH:MM:SS. Returns '' on failure.
 *  Accepts any separator and no leading zeros, e.g. 1.5.3, 5-30, 1 05 30.
 *  Two parts → M:S (h=0); one part → S (h=m=0).
 */
export function normaliseTime(t) {
  if (!t || typeof t !== 'string') return '';
  t = t.trim();
  if (!t) return '';
  const parts = t.split(/[^\d]+/).filter(Boolean).map(Number);
  if (parts.some(isNaN)) return '';
  let h = 0, m = 0, s = 0;
  if      (parts.length === 3) { [h, m, s] = parts; }
  else if (parts.length === 2) { [m, s]    = parts; }
  else if (parts.length === 1) { [s]        = parts; }
  else return '';
  if (h < 0 || h > 24 || m < 0 || m > 59 || s < 0 || s > 59) return '';
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/** Normalise a date string to DD/MM/YYYY. Returns '' on failure.
 *  Accepts any separator and leading-zero suppression, e.g. 1/1/90, 01-01-1990, 1.1.2000.
 */
export function normaliseDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  // Try YYYY?MM?DD (ISO-like, year first — check before day-first to avoid ambiguity)
  let m = s.match(/^(\d{4})[^\d](\d{1,2})[^\d](\d{1,2})$/);
  if (m) {
    const [,yyyy,mm,dd] = m;
    const dt = new Date(+yyyy, +mm-1, +dd);
    if (isNaN(dt)) return '';
    return `${String(+dd).padStart(2,'0')}/${String(+mm).padStart(2,'0')}/${yyyy}`;
  }
  // Try DD?MM?YYYY (any separator, with or without leading zeros)
  m = s.match(/^(\d{1,2})[^\d](\d{1,2})[^\d](\d{4})$/);
  if (m) {
    const [,dd,mm,yyyy] = m;
    const dt = new Date(+yyyy, +mm-1, +dd);
    if (isNaN(dt)) return '';
    return `${String(+dd).padStart(2,'0')}/${String(+mm).padStart(2,'0')}/${yyyy}`;
  }
  // Try DD?MM?YY (any separator) — expand 2-digit year: if 2000+yy is in the future use 1900+yy
  m = s.match(/^(\d{1,2})[^\d](\d{1,2})[^\d](\d{2})$/);
  if (m) {
    const [,dd,mm,yy] = m;
    const century = (2000 + +yy) > new Date().getFullYear() ? 1900 : 2000;
    const yyyy = String(century + +yy);
    const dt = new Date(+yyyy, +mm-1, +dd);
    if (isNaN(dt)) return '';
    return `${String(+dd).padStart(2,'0')}/${String(+mm).padStart(2,'0')}/${yyyy}`;
  }
  // Fallback to Date constructor (handles "1 Jan 2000" etc.)
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
  return (h % 24)*3600 + m*60 + s;
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
export function ciEq(a, b) {
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

/** Convert DD/MM/YYYY to YYYY-MM-DD for <input type="date"> */
export function toISODate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const [d, m, y] = ddmmyyyy.split('/');
  return y && m && d ? `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}` : '';
}

/** Convert YYYY-MM-DD from <input type="date"> back to DD/MM/YYYY */
export function fromISODate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** Show the busy/progress indicator */
export function showBusy(msg = '') {
  const el = document.getElementById('busy-message');
  if (el) el.textContent = msg;
  const overlay = document.getElementById('busy-overlay');
  if (overlay) overlay.style.display = msg ? 'flex' : 'none';
}
