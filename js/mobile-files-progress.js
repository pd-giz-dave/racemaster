'use strict';

// Compute Results (formerly "Add to Finishers") + the Progress tab — pure logic and the
// non-DOM state mutations it drives (state.mobileProgress/state.mobileCheckpoints). No DOM at
// all — js/views/mobile-files-progress.js is the thin layer on top that wires buttons, shows
// confirm dialogs/status toasts, and renders the actual table.

import { getEntry } from './entries.js';
import { entryInfo } from './safety.js';
import { getMobileCheckpointTimes } from './mobile-checkpoints.js';
import { secondsToTime } from './utils.js';
import { state, saveMobileCheckpoints, saveMobileProgress } from './state.js';
import { byLineNumber, setLastSyncedLineNumber } from './mobile-files-shared.js';
import { buildSegmentView, rawLocationOf, resolveLocationKey } from './mobile-files-devices.js';

// Maps a mobile Bibs-mode action onto the equivalent finishers.js action — "Pass" (Checkpoint
// mode) is treated as a Finish, since it only makes sense here at all when the CP happened to
// be the finish line. "Stop"/"Reset" are session-boundary markers with no finisher meaning —
// left out of this map entirely so they're dropped rather than transferred.
const BIBS_ACTION_TO_FINISHER = {
  Start: 'Start', Finish: 'Finish', DNF: 'DNF', Pass: 'Finish',
  Clock: 'Clock', Ignore: 'Ignore', Seniors: 'Seniors', Juniors: 'Juniors', Male: 'Male', Female: 'Female',
};
const TRANSFERABLE_BIBS_ACTIONS = new Set(Object.keys(BIBS_ACTION_TO_FINISHER));
const BIB_REQUIRED_FINISHER_ACTIONS = new Set(['Start', 'Finish', 'DNF', 'Pass']);
// Time mode's own "Stop"/"Reset"/"Undo" markers carry no split of their own — only Start (the
// fixed t=0 marker) and ordinary Split rows pair with a bib.
const TRANSFERABLE_TIME_ACTIONS = new Set(['Start', 'Split']);

// "HH:MM:SS.CC" (elapsed, as stored in splitTime) → "HH:MM:SS" — finishers.js's own
// parseFinishTime() splits on any non-digit run and rejects more than 3 numeric parts, so a
// trailing ".CC" must be stripped before it's usable as a finisher time.
function stripCentiseconds(splitTime) {
  return (splitTime || '').split('.')[0];
}

// "yyyy/MM/dd HH:mm:ss" (the phone's own local time) → epoch millis, for the timestamp
// arithmetic checkpoint times need (see computeCpTimes below). Returns null on anything
// unparseable rather than NaN, so callers can cleanly skip a bad/missing timestamp.
function parseTimestamp(ts) {
  const t = new Date(ts || '');
  return Number.isFinite(t.getTime()) ? t.getTime() : null;
}

// "The time mode start line" — the one Start row in a Time-mode device's file, whose own
// timestamp is wall-clock zero for every elapsed time computed against it (both FinishTime's
// existing splitNumber pairing and the new CP timestamp arithmetic use this same instant).
function findStartTimestamp(finishTimeRows) {
  const start = finishTimeRows.find(r => r.action === 'Start');
  return start ? parseTimestamp(start.timestamp) : null;
}

// Checkpoint times are approximate by nature (a CP-mode phone has no stopwatch of its own,
// only an absolute timestamp per bib) — unlike FinishTime's authoritative splitNumber pairing,
// this is genuinely just (crossing timestamp − start timestamp). A bib appearing twice in one
// CP file (e.g. an operator's accidental double-tap) keeps its earliest crossing, sorted by
// lineNumber — the file's own unambiguous record order.
function computeCpTimes(bibsRows, startMs) {
  const byBib = new Map();
  for (const r of [...bibsRows].sort(byLineNumber)) {
    const bib = +r.bibNumber;
    if (!Number.isFinite(bib) || bib <= 0 || byBib.has(bib) || startMs == null) continue;
    const ts = parseTimestamp(r.timestamp);
    if (ts == null) continue;
    const elapsed = Math.round((ts - startMs) / 1000);
    if (elapsed < 0) continue; // bad data/clock skew — leave blank rather than show nonsense
    byBib.set(bib, secondsToTime(elapsed));
  }
  return byBib; // bib -> 'HH:MM:SS'
}

// Derives what state.mobileProgress *should* contain for one file's current segment — bib-driven
// (a split with no matching bib is just excess, never looked up; a bib with no matching split is
// still included, just untimed), pairing each bib with the Time entry at the same split number if
// one exists. Retirees never carry a split time (finishers.js's own NO_SPLIT_ACTIONS convention);
// Clock's own "time" is its offset/time-of-day value from its note field, not a paired split.
// This relies on racemaster-mobile not allocating a splitNumber to DNF rows at all (so they
// never consume a slot the Time-mode side didn't also produce) — without that, a retiree
// partway through a race would permanently offset every later bib's splitNumber against its
// true corresponding Time split.
//
// The result is sorted by lineNumber, not splitNumber — applyComputedResults() assigns it to
// state.mobileProgress in this same order, and adjustedFinishTime()'s own mobile fallback (see
// time-utils.js) relies on that order to find the *last* matching Clock/Start/etc record, so
// getting this order right matters beyond just display. splitNumber is null for Clock/DNF rows,
// which would otherwise all collapse to the front ahead of every real split. lineNumber order
// matters in its own right too: several Clock lines in one file is legitimate (a later one marks
// a clock reset — not yet implemented mobile-side, but must already land in the right relative
// order for when it is), and only lineNumber order preserves which came first.
//
// This is the single source of truth both the red/green status check and the actual rebuild
// below are computed from, so they can never disagree with each other.
function expectedFinisherEntries(bibs, times) {
  const timeBySplit = new Map(times.map(t => [t.splitNumber, t]));
  return [...bibs].sort(byLineNumber).map(b => {
    const action = BIBS_ACTION_TO_FINISHER[b.action];
    const number = BIB_REQUIRED_FINISHER_ACTIONS.has(b.action) ? +b.bibNumber : 0;
    const paired = timeBySplit.get(b.splitNumber);
    const time = action === 'DNF' ? ''
      : action === 'Clock' ? (b.note || '')
      : (paired ? stripCentiseconds(paired.splitTime) : '');
    return { action, number, time };
  });
}

// Duplicate split numbers within one bucket mean two independent recording streams got
// selected together (e.g. two separate bibs-recording phones) — their split numbers aren't
// comparable, so nothing here can be safely paired or transferred. Rows with no real
// splitNumber (DNF/Clock — see NO_SPLIT_ACTIONS in finishers.js) all carry the same null
// sentinel and must be skipped here, or two-or-more of them (e.g. multiple retirees in one
// pull) would falsely collide and abort the whole rebuild.
function findDuplicateSplitNumbers(rows) {
  const seen = new Set(), dupes = new Set();
  for (const r of rows) {
    if (r.splitNumber == null) continue;
    if (seen.has(r.splitNumber)) dupes.add(r.splitNumber);
    seen.add(r.splitNumber);
  }
  return [...dupes].sort((a, b) => a - b);
}

// Wipes both data sources an Update Progress run produces — state.mobileProgress (Start/Finish/
// DNF/etc, genuinely separate from the manually-entered Finishers list, see js/mobile-progress.js)
// and state.mobileCheckpoints — as one explicit step. Used both by the standalone Clear Progress
// button and by applyComputedResults() below, which always clears before rebuilding rather than
// leaving the old arrays in place until the very end and relying on the final assignment to
// replace them; this way there's no ambiguity about the old set being gone before anything new
// is written. Everything downstream — the Progress tab itself, Safety Check's finished/
// outstanding counts and "Last CP" hint, the Results & Prize List page — reads live from
// state.mobileProgress/state.mobileCheckpoints, so clearing these two arrays is itself what
// "undoes the effects" of a previous run everywhere else in the app; no other state needs
// touching, and the manually-entered Finishers list is never affected either way.
export async function clearProgressData() {
  state.mobileProgress = [];
  state.mobileCheckpoints = [];
  await saveMobileProgress();
  await saveMobileCheckpoints();
}

// Combines the selected files' current-segment Bibs/Time entries (each device's own segment
// resolved independently first, exactly like js/views/mobile-files-devices.js's showDeviceModal,
// since Reset boundaries and line numbers are per-device) and validates them — no dialogs, no
// state mutation, so this same logic can be shared between the button handler
// (js/views/mobile-files-progress.js's updateProgress) and the silent auto-update path
// (autoUpdateProgress, below). Returns either { error } or the computed
// { finishRows, cpBuckets, expected, cpTimesByCp }.
//
// Selected files are bucketed by their own resolved location (see resolveLocationKey) rather
// than requiring every selected file to be "Finish" — Finish drives the (unchanged, accurate)
// FinishTime computation below; any additional checkpoint-location files each contribute an
// approximate CP time, computed independently via timestamp arithmetic against the Finish
// bucket's own Time-mode Start row (see computeCpTimes). FinishTime is authoritative (the same
// splitNumber pairing this used to do as "Add to Finishers"); CP times are not — a CP-mode
// phone has no stopwatch of its own, only an absolute per-bib timestamp, so they're
// necessarily an approximation, primarily useful for safety awareness (roughly where on the
// course an outstanding runner was last seen) rather than as a results input.
export async function validateAndCompute(selected) {
  const raceLabels = [...new Set(selected.map(r => r.raceLabel))];
  if (raceLabels.length > 1) {
    return { error: `Cannot compute results — selected files are from different races: ${raceLabels.join(', ')}.` };
  }

  const finishRows = [];
  const cpBuckets = new Map(); // cp number -> row
  for (const r of selected) {
    const { timeSegment, bibsSegment } = buildSegmentView(r.device.lines);
    const visibleRows = [...timeSegment, ...bibsSegment];
    if (!visibleRows.length) {
      return { error: `Cannot compute results — "${r.device.name}" is empty (no entries in its current segment).` };
    }
    const raw = rawLocationOf(visibleRows);
    if (raw == null) {
      return { error: `Cannot compute results — "${r.device.name}" has inconsistent locations within its own file.` };
    }
    const key = resolveLocationKey(raw);
    if (!key) {
      return { error: `Cannot compute results — location "${raw}" isn't recognised as Finish or a checkpoint.` };
    }
    if (key.kind === 'finish') {
      finishRows.push(r);
    } else if (cpBuckets.has(key.number)) {
      return { error: `Cannot compute results — more than one file selected for CP${key.number}.` };
    } else {
      cpBuckets.set(key.number, r);
    }
  }

  if (!finishRows.length) return { error: 'Select at least the Finish location file(s) too.' };

  const bibs = [], times = [];
  for (const r of finishRows) {
    const { timeSegment, bibsSegment } = buildSegmentView(r.device.lines);
    bibs.push(...bibsSegment.filter(b => TRANSFERABLE_BIBS_ACTIONS.has(b.action)));
    times.push(...timeSegment.filter(t => TRANSFERABLE_TIME_ACTIONS.has(t.action)));
  }

  if (!bibs.length && !times.length) return { error: 'Selected Finish file(s) have no transferable entries.' };

  const dupBibSplits = findDuplicateSplitNumbers(bibs);
  if (dupBibSplits.length) {
    return { error: `Cannot compute results — more than one bibs-recording phone selected at Finish (duplicate split number(s) ${dupBibSplits.join(', ')}).` };
  }
  const dupTimeSplits = findDuplicateSplitNumbers(times);
  if (dupTimeSplits.length) {
    return { error: `Cannot compute results — more than one time-recording phone selected at Finish (duplicate split number(s) ${dupTimeSplits.join(', ')}).` };
  }

  const invalidBibs = [...new Set(
    bibs.filter(b => BIB_REQUIRED_FINISHER_ACTIONS.has(b.action))
      .map(b => +b.bibNumber)
      .filter(n => !Number.isFinite(n) || n <= 0 || !getEntry(n))
  )];
  if (invalidBibs.length) {
    return { error: `Cannot compute results — bib number(s) not in entries: ${invalidBibs.join(', ')}.` };
  }

  // Checkpoint buckets need the Finish bucket's own Time-mode Start row as the universal t=0
  // reference — without it, no elapsed time (CP or otherwise) can be computed at all.
  const cpTimesByCp = new Map(); // cp number -> Map<bib, 'HH:MM:SS'>
  if (cpBuckets.size) {
    const startMs = findStartTimestamp(times);
    if (startMs == null) {
      return { error: 'Cannot compute checkpoint times — no Start record found in the Finish location\'s time file; select it too.' };
    }
    const invalidCpBibs = [];
    for (const [cpNumber, r] of cpBuckets) {
      const { bibsSegment } = buildSegmentView(r.device.lines);
      const cpRows = bibsSegment.filter(b => BIB_REQUIRED_FINISHER_ACTIONS.has(b.action));
      const bad = [...new Set(cpRows.map(b => +b.bibNumber).filter(n => !Number.isFinite(n) || n <= 0 || !getEntry(n)))];
      if (bad.length) { invalidCpBibs.push(`CP${cpNumber}: ${bad.join(', ')}`); continue; }
      cpTimesByCp.set(cpNumber, computeCpTimes(cpRows, startMs));
    }
    if (invalidCpBibs.length) {
      return { error: `Cannot compute results — bib number(s) not in entries: ${invalidCpBibs.join('; ')}.` };
    }
  }

  const expected = expectedFinisherEntries(bibs, times);
  return { finishRows, cpBuckets, expected, cpTimesByCp };
}

// The actual mutation, shared by both the button handler and the silent auto-update path —
// wipes state.mobileProgress and rebuilds it wholesale from `expected` (line-by-line diffing
// against whatever Progress already held turned out to be a losing battle with every new edge
// case the phone's own history could produce — see validateAndCompute()'s own doc for why a
// full rebuild sidesteps that; every bib in `expected` was already validated against entries by
// validateAndCompute(), so no further per-entry validation is needed here), then rebuilds
// state.mobileCheckpoints wholesale too, stored raw (crossing timestamp minus start timestamp,
// no offset correction) — early/late-start and clock-offset adjustment is the domain of
// adjustedFinishTime() in results.js/formatResults(), not this page; this page's job is only to
// provide the raw information that needs. Never touches the manually-entered Finishers list.
// Returns { added } for the caller's own status message.
export async function applyComputedResults(expected, cpTimesByCp, selected) {
  await clearProgressData();

  state.mobileProgress = expected.map(({ action, number, time }) => ({ action, number, time }));
  await saveMobileProgress();

  const bibsSeen = new Set();
  for (const cpMap of cpTimesByCp.values()) for (const bib of cpMap.keys()) bibsSeen.add(bib);
  state.mobileCheckpoints = [...bibsSeen].map(bib => {
    const cpTimes = {};
    for (const [cpNumber, cpMap] of cpTimesByCp) if (cpMap.has(bib)) cpTimes[cpNumber] = cpMap.get(bib);
    return { bibNumber: bib, cpTimes };
  });
  await saveMobileCheckpoints();

  // Mark every selected file as "seen as of now" — this run covered whatever these files held at
  // this moment. See mobile-files-shared.js's own tracking block for why a lineNumber is enough.
  for (const r of selected) setLastSyncedLineNumber(r);

  return { added: expected.length };
}

// ---- Progress tab (raw BibNumber/Name/Category/Course/Start/FinishTime/CP*n* view) ----
//
// Deliberately pre-adjustment and position-agnostic — this tab's job is to provide the raw
// information Results & Prize List's own adjustedFinishTime()-based pipeline needs (see
// js/results.js's formatResults()/getSplitsRows()), plus safety feedback on where runners are
// on the course, not to mirror final results. That's why this reads state.mobileProgress/
// state.mobileCheckpoints directly rather than safety.js's getFinishedRows()/getDnfRows() (both
// of which call formatResults() and return already-adjusted times + computed race positions) —
// sorted by bib number, since this tab has no position to sort by at all.

// Exported for js/views/mobile-files-progress.js's own renderMobileProgressTable() to build its
// table-columns config from — cpNumbers comes from js/mobile-checkpoints.js's
// getMobileCheckpointNumbers(), read there rather than here since it's a DOM-render-time concern
// (which CP columns are currently worth showing), not part of computing the rows themselves.
export function buildProgressColumns(baseColumns, cpNumbers) {
  const idx = baseColumns.findIndex(c => c.id === 'cp');
  const proforma = baseColumns[idx];
  const cpCols = cpNumbers.map(n => ({ id: `cp_${n}`, label: `CP${n}`, title: `${proforma.title} ${n}` }));
  return [...baseColumns.slice(0, idx), ...cpCols, ...baseColumns.slice(idx + 1)];
}

// Rows = every bib with a Start/Finish/DNF record in state.mobileProgress (mobile-recorded only
// — the manually-entered Finishers list is never read here, see js/mobile-progress.js) UNION
// every bib with at least one checkpoint sighting, even if never finished — that union is
// deliberate: a bib seen only at a CP, with no finish, is exactly the safety-relevant case
// (still out on the course, last seen at CP*n*). FinishTime here is the raw, unadjusted
// stopwatch/paired-split value — the adjusted race time lives on the Results & Prize List page,
// not here.
export function buildProgressRows() {
  const rowsByBib = new Map();
  const ensure = bib => {
    if (!rowsByBib.has(bib)) {
      const info = entryInfo(bib);
      rowsByBib.set(bib, { bibNumber: bib, name: info.name, category: info.category, course: info.course, startTime: '', finishTime: '', cpTimes: {} });
    }
    return rowsByBib.get(bib);
  };
  for (const f of state.mobileProgress) {
    const bib = +f.number;
    if (bib <= 0) continue;
    if (f.action === 'Start')       ensure(bib).startTime  = f.time || '';
    else if (f.action === 'Finish') ensure(bib).finishTime = f.time || '';
    else if (f.action === 'DNF')    ensure(bib).finishTime = 'DNF';
  }
  for (const r of state.mobileCheckpoints) {
    ensure(+r.bibNumber).cpTimes = getMobileCheckpointTimes(r);
  }
  return [...rowsByBib.values()].sort((a, b) => a.bibNumber - b.bibNumber);
}
