'use strict';

// Compute Results (formerly "Add to Finishers") + the Progress tab — pure logic and the
// non-DOM state mutations it drives (state.mobileProgress/state.mobileCheckpoints). No DOM at
// all — js/views/mobile-files-progress.js is the thin layer on top that wires buttons, shows
// confirm dialogs/status toasts, and renders the actual table.

import { getSortedEntries } from './entries.js';
import { entryInfo, getConflictedBibs } from './safety.js';
import { getMobileCheckpointTimes, getMobileCheckpointTimesOfDay, CP_RETIRE } from './mobile-checkpoints.js';
import { secondsToTime, formatElapsedSeconds } from './utils.js';
import { state, saveMobileCheckpoints, saveMobileProgress } from './state.js';
import { byLineNumber, setLastSyncedLineNumber } from './mobile-files-shared.js';
import { buildSegmentView, rawLocationOf, resolveLocationKey, distinctLocationsOf } from './mobile-files-devices.js';

// Maps a mobile Bibs-mode action onto the equivalent finishers.js action — "Pass" (Checkpoint
// mode) is treated as a Finish, since it only makes sense here at all when the CP happened to
// be the finish line. "Reset"/"Ping" are session-boundary/heartbeat markers with no finisher
// meaning — left out of this map entirely so they're dropped rather than transferred (moot in
// practice for these two specifically, since mobile-files-devices.js's own current-segment view
// already excludes both before this map ever sees a row).
//
// `ModeStart` (the Bibs-family device marker on the wire — see mobile-files-devices.js's own
// hasRealBib/latestStartedAt doc; ToDo.MD: "use the ModeStart records and not start or clock
// records") maps to the OUTPUT action `'Clock'`, not `'ModeStart'` — that rename is purely a wire
// -format/input concern. state.mobileProgress's own action vocabulary is the same one
// state.finishers (the manually-entered stopwatch list) has used for years — time-utils.js's
// adjustedFinishTime(), safety.js and finishers.js itself all still look for a literal `'Clock'`
// record there, well beyond Mobile Files' own concerns, so the OUTPUT value must stay `'Clock'`
// regardless of what the device's own wire action is now called.
const BIBS_ACTION_TO_FINISHER = {
  Start: 'Start', Finish: 'Finish', DNF: 'DNF', Pass: 'Finish',
  ModeStart: 'Clock', Ignore: 'Ignore', Seniors: 'Seniors', Juniors: 'Juniors', Male: 'Male', Female: 'Female',
};
const TRANSFERABLE_BIBS_ACTIONS = new Set(Object.keys(BIBS_ACTION_TO_FINISHER));
const BIB_REQUIRED_FINISHER_ACTIONS = new Set(['Start', 'Finish', 'DNF', 'Pass']);
// Time mode's own "Reset"/"Undo"/"Ping" markers carry no split of their own — only its own
// ModeStart marker (the fixed t=0 mark, formerly action:'Start' — see BIBS_ACTION_TO_FINISHER's
// own doc above for why the wire rename doesn't touch the OUTPUT vocabulary) and ordinary Split
// rows pair with a bib.
const TRANSFERABLE_TIME_ACTIONS = new Set(['ModeStart', 'Split']);

// "yyyy/MM/dd HH:mm:ss" (the phone's own local time) → epoch millis, for the timestamp
// arithmetic checkpoint times need (see computeCpTimes below). Returns null on anything
// unparseable rather than NaN, so callers can cleanly skip a bad/missing timestamp.
function parseTimestamp(ts) {
  const t = new Date(ts || '');
  return Number.isFinite(t.getTime()) ? t.getTime() : null;
}

// "yyyy/MM/dd HH:mm:ss[.cc]" → "HH:mm:ss" — the phone's own wall-clock reading for a row,
// straight out of its timestamp, no arithmetic at all. Preferred over race-start-plus-elapsed
// wherever it's available (Safety Check — see safety.js/views/safety.js) since it doesn't
// depend on the phone's own Start row lining up exactly with the race's official start time;
// plain string extraction rather than round-tripping through Date, so there's no local-timezone
// parsing/formatting mismatch to worry about either. Returns '' on anything not in this shape.
function deviceTimeOfDay(ts) {
  const m = /^\d{4}\/\d{2}\/\d{2} (\d{2}:\d{2}:\d{2})/.exec(ts || '');
  return m ? m[1] : '';
}

// "The time mode start line" — the one ModeStart row in a Time-mode device's file, whose own
// timestamp is wall-clock zero for every elapsed time computed against it (both FinishTime's
// existing splitNumber pairing and the new CP timestamp arithmetic use this same instant).
function findStartTimestamp(finishTimeRows) {
  const start = finishTimeRows.find(r => r.action === 'ModeStart');
  return start ? parseTimestamp(start.timestamp) : null;
}

// Checkpoint times are approximate by nature (a CP-mode phone has no stopwatch of its own,
// only an absolute timestamp per bib) — unlike FinishTime's authoritative splitNumber pairing,
// this is genuinely just (crossing timestamp − start timestamp). A bib appearing twice in one
// CP file (e.g. an operator's accidental double-tap) keeps its earliest crossing, sorted by
// lineNumber — the file's own unambiguous record order.
//
// A DNF row (a retire recorded at this checkpoint, not just at Finish) gets the CP_RETIRE
// sentinel instead of a computed elapsed time in the returned `cpTimes` map — there's no
// crossing to time in the *course* sense, and treating it as an ordinary bib would produce a
// nonsense split for someone who didn't continue past here. Recorded regardless of whether a
// valid Start timestamp exists (unlike an ordinary crossing): a retire needs no arithmetic
// against it for this map, and is worth keeping even when the Start row itself is missing/
// corrupt. validateAndCompute() below scans `cpTimes` for this sentinel to also mark the bib
// DNF in state.mobileProgress — see its own doc — and every other consumer of
// state.mobileCheckpoints (buildProgressRows() here, the Splits tab's adjustedFinishTime() in
// results.js, Safety Check's "Last CP" hint) already treats a CP time as an opaque display
// string, so no further special-casing is needed there.
//
// An ORDINARY crossing's own bib always gets a `cpTimes` entry too, even when no elapsed time is
// computable (no Finish file selected yet — validateAndCompute() no longer requires one — or its
// own timestamp is unparseable): the value is '' rather than the row being skipped entirely. This
// matters beyond display — applyComputedResults() derives *which bibs appear in
// state.mobileCheckpoints at all* purely from `cpTimes` map keys (bibsSeen), and
// getLatestCheckpoint() (mobile-checkpoints.js, Safety Check's "Last CP" hint) reads the same
// map — skipping the entry would make a checkpoint-only sighting (the exact scenario a phone
// adopted before any Finish phone exists produces) invisible everywhere downstream, not just
// untimed. Safety Check's own toTimeOfDay() already prefers cpTimeOfDay over cpTimes when both
// exist, so an empty elapsed string here costs nothing there — the device's own wall-clock time
// still shows.
//
// `retireElapsed` is the separate, genuine elapsed-since-start moment a retire row's own
// timestamp represents — when it's computable (a valid Start timestamp and a parseable row
// timestamp), the same arithmetic an ordinary crossing gets. Kept apart from `cpTimes` rather
// than overwriting the CP_RETIRE sentinel there: the Progress tab's CP column must keep showing
// literal "Retire" text, not a time, but Safety Check's Retirees tab (validateAndCompute()'s own
// caller) wants exactly this moment for its "when" column — the two displays have opposite
// needs for the same underlying fact.
//
// CP_RETIRE itself is re-exported here (defined in mobile-checkpoints.js) purely so existing
// importers of this module don't need to change where they get it from.
export { CP_RETIRE };
function computeCpTimes(bibsRows, startMs) {
  const cpTimes = new Map();
  const cpTimeOfDay = new Map(); // bib -> 'HH:MM:SS', the crossing row's own device timestamp
  const retireElapsed = new Map();
  for (const r of [...bibsRows].sort(byLineNumber)) {
    const bib = +r.bibNumber;
    if (!Number.isFinite(bib) || bib <= 0 || cpTimes.has(bib)) continue;
    const tod = deviceTimeOfDay(r.timestamp);
    if (r.action === 'DNF') {
      cpTimes.set(bib, CP_RETIRE);
      if (tod) cpTimeOfDay.set(bib, tod);
      if (startMs != null) {
        const ts = parseTimestamp(r.timestamp);
        if (ts != null) {
          const elapsed = Math.round((ts - startMs) / 1000);
          if (elapsed >= 0) retireElapsed.set(bib, secondsToTime(elapsed));
        }
      }
      continue;
    }
    if (tod) cpTimeOfDay.set(bib, tod);
    let elapsedStr = '';
    if (startMs != null) {
      const ts = parseTimestamp(r.timestamp);
      if (ts != null) {
        const elapsed = Math.round((ts - startMs) / 1000);
        if (elapsed >= 0) elapsedStr = secondsToTime(elapsed); // negative = bad data/clock skew, leave blank
      }
    }
    cpTimes.set(bib, elapsedStr);
  }
  // cpTimes: bib -> 'HH:MM:SS' elapsed | '' (seen, but no Finish file to anchor elapsed time
  // against yet) | CP_RETIRE; cpTimeOfDay: bib -> 'HH:MM:SS' time-of-day (independent of
  // startMs/elapsed validity — Safety Check's own preferred source, see deviceTimeOfDay's own
  // doc); retireElapsed: bib -> 'HH:MM:SS' elapsed, retirees only.
  return { cpTimes, cpTimeOfDay, retireElapsed };
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
// A bib-required action (BIB_REQUIRED_FINISHER_ACTIONS) whose bib number doesn't match any
// current Entry is still emitted here, not dropped — validateAndCompute() no longer rejects the
// whole run over this (see that function's own doc for why), and there's nothing left upstream
// that filters it out. buildProgressRows()/safety.js's entryInfo() are what actually flag it as
// `invalid` for display, purely by checking getEntry(bib) again at read time — nothing here needs
// to know or record that itself. Only a genuinely malformed bib number (not a positive integer at
// all — data corruption, not a mistyped/unregistered one) is dropped outright: there's no sensible
// row to show for it, unlike an ordinary wrong-but-well-formed bib.
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
//
// startMs (the Finish bucket's own Time-mode Start timestamp, when one exists — see
// findStartTimestamp) gives a retire recorded directly at Finish a real elapsed-since-start
// "when", the same timestamp arithmetic a checkpoint retire gets in computeCpTimes' own
// retireElapsed — a DNF row has no paired split (NO_SPLIT_ACTIONS in finishers.js), so this is
// the only source such a time can come from.
//
// `timeOfDay` — a Start, Finish or DNF row's own device timestamp, straight out of
// deviceTimeOfDay, no arithmetic — is both Safety Check's preferred source for the Early
// Starters/Retirees tabs (see that file's own doc) and the Progress tab's own Start/Finish
// columns (buildProgressRows() below, mirroring how its CP columns already prefer
// cpTimesOfDay over cpTimes — see that function's own doc); unlike `time` above it needs no
// startMs at all, so it's set whenever the row itself has one, independent of whether the
// elapsed figure could be computed.
function expectedFinisherEntries(bibs, times, startMs) {
  const timeBySplit = new Map(times.map(t => [t.splitNumber, t]));
  const out = [];
  for (const b of [...bibs].sort(byLineNumber)) {
    const action = BIBS_ACTION_TO_FINISHER[b.action];
    const bibRequired = BIB_REQUIRED_FINISHER_ACTIONS.has(b.action);
    const number = bibRequired ? +b.bibNumber : 0;
    // Genuinely corrupt data (not a positive integer at all) rather than an unregistered/
    // mistyped-but-well-formed bib — see this function's own top-of-file doc for why those two
    // are treated differently: this one is dropped outright rather than flagged.
    if (bibRequired && (!Number.isFinite(number) || number <= 0)) continue;
    const paired = timeBySplit.get(b.splitNumber);
    const timeOfDay = (action === 'DNF' || action === 'Start' || action === 'Finish') ? deviceTimeOfDay(b.timestamp) : '';
    let time = '';
    if (action === 'DNF') {
      if (startMs != null) {
        const ts = parseTimestamp(b.timestamp);
        if (ts != null) {
          const elapsed = Math.round((ts - startMs) / 1000);
          if (elapsed >= 0) time = secondsToTime(elapsed);
        }
      }
    } else if (action === 'Clock' && b.action === 'Clock') {
      // A genuine wire "Clock" action (Bibs mode's own operator-typed manual clock reading) —
      // its own note is a real free-text time value. A ModeStart row also maps to this same
      // output action (see BIBS_ACTION_TO_FINISHER's own doc) but its `note` is now the
      // explicit mode name (see SyncRecord's own doc), never a time reading — must not be read
      // here, so it falls through to the plain '' default below instead.
      time = b.note || '';
    } else {
      time = paired?.splitTime != null ? formatElapsedSeconds(paired.splitTime) : '';
    }
    // Only actually carried when non-empty (Start/DNF with a usable device timestamp) — keeps
    // every other entry's shape exactly as before rather than padding it with a field it has no
    // use for.
    out.push(timeOfDay ? { action, number, time, timeOfDay } : { action, number, time });
  }
  return out;
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
//
// A Finish file is not required at all: a race may genuinely have no phone at Finish yet (one
// hasn't relocated there — see racemaster-mobile's own mid-race LOCATION-marker relocation), and
// this still computes whatever it can from checkpoint files alone — cpTimesByCp/cpTimeOfDayByCp
// populate from time-of-day data (see computeCpTimes' own doc for why elapsed times need a
// Finish Start row but sightings don't), and a checkpoint retire still promotes to a DNF entry
// in `expected` below. FinishTime itself, and elapsed (as opposed to time-of-day) checkpoint
// times, simply stay empty until a Finish file exists to select.
// Splits one selected row's own lines into one segment per location it's recorded at — a
// relocated device's file can span more than one (see mobile-files-devices.js's own
// flattenDevices() doc) — so each location buckets independently below, exactly as if it were
// its own separate file. Reads `r.device.resolvedLines` — each row's own `.location`, already
// resolved per-row by flattenDevices()'s own withResolvedLocations() call — never
// `r.device.lines` (the genuinely raw array that function keeps apart from it specifically so
// this kind of "current, interpreted picture" work doesn't get the raw one by mistake): filtering
// straight on `.location` keeps buildSegmentView()'s own RESET-boundary logic correctly scoped to
// just that location, with no separate segment-boundary reconstruction needed here. A device with
// no location recorded at all (locations.length === 0) still gets exactly one segment, its whole
// (unfiltered) lines — the existing "no location recorded" error below is what catches that, same
// as before this split existed.
function locationSegmentsOf(r) {
  const { timeSegment, bibsSegment } = buildSegmentView(r.device.resolvedLines);
  const locations = distinctLocationsOf([...timeSegment, ...bibsSegment]);
  if (!locations.length) return [{ r, location: null, lines: r.device.resolvedLines }];
  return locations.map(location => ({ r, location, lines: r.device.resolvedLines.filter(l => l.location === location) }));
}

export async function validateAndCompute(selected) {
  // An adopted phone counts as part of the race it's been adopted into — it keeps reporting its
  // arbitrary name (e.g. "unknown-26-09-25") until it picks the adoption up and renames, and
  // ticking it is exactly what adopts it, so it's always selected alongside that race's phones.
  const raceLabels = [...new Set(selected.map(r => r.adoptedInto ?? r.raceLabel))];
  if (raceLabels.length > 1) {
    return { error: `Cannot compute results — selected files are from different races: ${raceLabels.join(', ')}.` };
  }

  const finishRows = []; // segments ({ r, location, lines }), not raw selected rows — see locationSegmentsOf
  const cpBuckets = new Map(); // cp number -> segment
  for (const r of selected) {
    for (const seg of locationSegmentsOf(r)) {
      const { timeSegment, bibsSegment } = buildSegmentView(seg.lines);
      const visibleRows = [...timeSegment, ...bibsSegment];
      const label = seg.location ? `${r.device.name} (${seg.location})` : r.device.name;
      if (!visibleRows.length) {
        return { error: `Cannot compute results — "${label}" is empty (no entries in its current segment).` };
      }
      // A location genuinely changing mid-file (the marshal moved) is expected, not an error —
      // locationSegmentsOf() above already splits it into one segment per location, so
      // rawLocationOf() here only ever sees rows already narrowed to a single location, and this
      // only fires when a segment somehow carries no location at all.
      const raw = rawLocationOf(visibleRows);
      if (raw == null) {
        return { error: `Cannot compute results — "${label}" has no location recorded.` };
      }
      const key = resolveLocationKey(raw);
      if (!key) {
        return { error: `Cannot compute results — location "${raw}" isn't recognised as Finish or a checkpoint.` };
      }
      if (key.kind === 'finish') {
        finishRows.push(seg);
      } else if (cpBuckets.has(key.number)) {
        return { error: `Cannot compute results — more than one file selected for CP${key.number}.` };
      } else {
        cpBuckets.set(key.number, seg);
      }
    }
  }

  const bibs = [], times = [];
  for (const seg of finishRows) {
    const { timeSegment, bibsSegment } = buildSegmentView(seg.lines);
    bibs.push(...bibsSegment.filter(b => TRANSFERABLE_BIBS_ACTIONS.has(b.action)));
    times.push(...timeSegment.filter(t => TRANSFERABLE_TIME_ACTIONS.has(t.action)));
  }

  // Only an error when a Finish file WAS selected and turned out empty — no Finish file at all
  // is now a legitimate, common state (see this function's own top-of-file doc), and bibs/times
  // are always empty in that case by construction (the loop above only ever draws from
  // finishRows), so this must not fire just because finishRows itself is empty.
  if (finishRows.length && !bibs.length && !times.length) {
    return { error: 'Selected Finish file(s) have no transferable entries.' };
  }

  const dupBibSplits = findDuplicateSplitNumbers(bibs);
  if (dupBibSplits.length) {
    return { error: `Cannot compute results — more than one bibs-recording phone selected at Finish (duplicate split number(s) ${dupBibSplits.join(', ')}).` };
  }
  const dupTimeSplits = findDuplicateSplitNumbers(times);
  if (dupTimeSplits.length) {
    return { error: `Cannot compute results — more than one time-recording phone selected at Finish (duplicate split number(s) ${dupTimeSplits.join(', ')}).` };
  }

  // The Finish bucket's own Time-mode Start row is the universal t=0 reference for every
  // timestamp-based elapsed calc below — checkpoint crossings, a checkpoint retire's own "when"
  // (computeCpTimes' retireElapsed), and a Finish-location retire's "when" too
  // (expectedFinisherEntries below). Found unconditionally (not just when cpBuckets.size), since
  // a Finish-only selection still wants it for that last case. null when there's no Finish file
  // selected at all (or it has no ModeStart row) — computeCpTimes() below tolerates that, falling
  // back to time-of-day-only sightings rather than refusing to compute anything.
  const startMs = findStartTimestamp(times);

  // Checkpoint buckets degrade gracefully with no startMs — see computeCpTimes' own doc — rather
  // than refusing to compute anything: a bib's own device time-of-day is still worth showing
  // (Safety Check's "Last CP" hint) even before any phone has reached Finish.
  const cpTimesByCp = new Map(); // cp number -> Map<bib, 'HH:MM:SS' | ''>
  const cpTimeOfDayByCp = new Map(); // cp number -> Map<bib, 'HH:MM:SS'> — see computeCpTimes' own doc
  const retireElapsedByBib = new Map(); // bib -> 'HH:MM:SS', checkpoint retirees only
  const retireTimeOfDayByBib = new Map(); // bib -> 'HH:MM:SS', checkpoint retirees only
  if (cpBuckets.size) {
    for (const [cpNumber, seg] of cpBuckets) {
      const { bibsSegment } = buildSegmentView(seg.lines);
      const cpRows = bibsSegment.filter(b => BIB_REQUIRED_FINISHER_ACTIONS.has(b.action));
      // computeCpTimes() itself already drops a malformed (non-positive-integer) bib — see its
      // own doc — so a crossing recorded for a bib that just doesn't match any current Entry
      // passes straight through here unfiltered, same as expectedFinisherEntries() above; see
      // this file's top-of-function doc for why that's no longer rejected.
      const { cpTimes, cpTimeOfDay, retireElapsed } = computeCpTimes(cpRows, startMs);
      cpTimesByCp.set(cpNumber, cpTimes);
      cpTimeOfDayByCp.set(cpNumber, cpTimeOfDay);
      for (const [bib, t] of retireElapsed) retireElapsedByBib.set(bib, t);
      for (const [bib, t] of cpTimeOfDay) if (cpTimes.get(bib) === CP_RETIRE) retireTimeOfDayByBib.set(bib, t);
    }
  }

  const expected = expectedFinisherEntries(bibs, times, startMs);

  // A bib retired at a checkpoint (CP_RETIRE, see computeCpTimes' own doc) may never reach the
  // Finish location at all — exactly the safety-relevant case buildProgressRows() already
  // exists for ("a bib seen only at a CP, with no finish"). Surface it as a DNF the same way a
  // Finish-location retire already does (FinishTime shows "DNF"), rather than leaving it
  // silently absent from Progress/Safety Check's finished/outstanding counts/the Results Splits
  // tab's status — all three read state.mobileProgress for a 'DNF' action (see isRecordedDnf()
  // in results.js, getFinishedBibs() in safety.js). Finish stays authoritative when there IS a
  // genuine Finish-location record for this bib (Start/Finish/DNF) — this only fills the gap
  // for a bib with no Finish entry at all. Its own retire moment (elapsed and, preferably, its
  // real device time-of-day) comes along with it, for Safety Check's Retirees tab "when" column.
  const finishKnownBibs = new Set(expected.map(e => e.number).filter(n => n > 0));
  const cpRetiredBibs = new Set();
  for (const cpMap of cpTimesByCp.values()) {
    for (const [bib, time] of cpMap) if (time === CP_RETIRE) cpRetiredBibs.add(bib);
  }
  for (const bib of cpRetiredBibs) {
    if (finishKnownBibs.has(bib)) continue;
    const entry = { action: 'DNF', number: bib, time: retireElapsedByBib.get(bib) || '' };
    const tod = retireTimeOfDayByBib.get(bib);
    if (tod) entry.timeOfDay = tod;
    expected.push(entry);
  }

  return { finishRows, cpBuckets, expected, cpTimesByCp, cpTimeOfDayByCp };
}

// The actual mutation, shared by both the button handler and the silent auto-update path —
// wipes state.mobileProgress and rebuilds it wholesale from `expected` (line-by-line diffing
// against whatever Progress already held turned out to be a losing battle with every new edge
// case the phone's own history could produce — see validateAndCompute()'s own doc for why a
// full rebuild sidesteps that; a bib in `expected` with no matching Entry is stored exactly the
// same as any other — see expectedFinisherEntries()'s own doc for why that's deliberate, and
// buildProgressRows()/safety.js's entryInfo() for where it actually gets flagged), then rebuilds
// state.mobileCheckpoints wholesale too, stored raw (crossing timestamp minus start timestamp,
// no offset correction) — early/late-start and clock-offset adjustment is the domain of
// adjustedFinishTime() in results.js/formatResults(), not this page; this page's job is only to
// provide the raw information that needs. Never touches the manually-entered Finishers list.
// Returns { added } for the caller's own status message.
export async function applyComputedResults(expected, cpTimesByCp, selected, cpTimeOfDayByCp = new Map()) {
  const progress = expected.map(({ action, number, time, timeOfDay }) =>
    timeOfDay ? { action, number, time, timeOfDay } : { action, number, time });

  const bibsSeen = new Set();
  for (const cpMap of cpTimesByCp.values()) for (const bib of cpMap.keys()) bibsSeen.add(bib);
  const checkpoints = [...bibsSeen].map(bib => {
    const cpTimes = {};
    const cpTimesOfDay = {};
    for (const [cpNumber, cpMap] of cpTimesByCp) if (cpMap.has(bib)) cpTimes[cpNumber] = cpMap.get(bib);
    for (const [cpNumber, todMap] of cpTimeOfDayByCp) if (todMap.has(bib)) cpTimesOfDay[cpNumber] = todMap.get(bib);
    return Object.keys(cpTimesOfDay).length ? { bibNumber: bib, cpTimes, cpTimesOfDay } : { bibNumber: bib, cpTimes };
  });

  // Mark every selected file as "seen as of now" — this run covered whatever these files held at
  // this moment. See mobile-files-shared.js's own tracking block for why a lineNumber is enough.
  for (const r of selected) setLastSyncedLineNumber(r);

  // Nothing to write when the rebuild comes out identical — the usual case for an auto-update
  // triggered by a line that changes no result (every phone's Ping heartbeat is one). Writing
  // anyway (a clear, then the same arrays back) marked the dataset changed and re-uploaded it,
  // bumping its version every few seconds with no real change (confirmed in the field).
  if (JSON.stringify(progress) === JSON.stringify(state.mobileProgress) &&
      JSON.stringify(checkpoints) === JSON.stringify(state.mobileCheckpoints)) {
    return { added: expected.length };
  }

  await clearProgressData();
  state.mobileProgress = progress;
  await saveMobileProgress();
  state.mobileCheckpoints = checkpoints;
  await saveMobileCheckpoints();

  // Home/Safety Check/Results & Prize List all read state.mobileProgress/state.mobileCheckpoints
  // live (see this function's own doc above) — correct the moment this function returns, but
  // only actually reflected on screen the next time each page happens to render. That's fine
  // when *this* run was itself triggered by opening one of those pages (they re-render right
  // after anyway), but this can just as easily run in the background — the new server poll, a
  // Bluetooth auto-pull, autoUpdateProgress() from a Results-page visit that's since been left
  // open — while the operator is looking at any of those pages already, in which case nothing
  // would otherwise tell the page it's now stale. app.js listens for this and re-renders them
  // (and whatever view is actually showing right now) — a plain DOM CustomEvent rather than a
  // direct call so this pure, DOM-free module doesn't need to import any of the view layer to
  // reach them; same decoupling storage.js's own 'racemaster-dirty-change'/'racemaster-conflict'
  // events already use for the equivalent problem.
  window.dispatchEvent(new CustomEvent('racemaster-progress-updated'));

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

// Rows = every entry (bib, name, course, category — the former Bib Allocations tab's own role,
// now folded in here so that standalone tab/file is no longer needed: a bib with no mobile
// activity at all still gets a row, blank Start/Finish/CP, kept live simply by virtue of this
// being read fresh on every render/push — no separate generation or sync step of its own) UNION
// every bib with a Start/Finish/DNF record in state.mobileProgress (mobile-recorded only — the
// manually-entered Finishers list is never read here, see js/mobile-progress.js) UNION every bib
// with at least one checkpoint sighting, even if never finished — that extra union is deliberate:
// a bib seen only at a CP, with no finish, is exactly the safety-relevant case (still out on the
// course, last seen at CP*n*). FinishTime here is the raw, unadjusted stopwatch/paired-split
// value — the adjusted race time lives on the Results & Prize List page, not here. `cpTimes`
// carries straight through from state.mobileCheckpoints (elapsed | CP_RETIRE, or '' when a Finish
// file hasn't anchored an elapsed value yet — see computeCpTimes' own doc) purely so a caller can
// still tell CP_RETIRE apart from an ordinary sighting; `cpTimesOfDay` is what the Progress tab's
// own CP columns actually display (js/views/mobile-files-progress.js's own renderer) — the raw
// device time-of-day, unadjusted, unlike the Splits tab's own elapsed-since-start figures.
//
// `invalid` (from entryInfo()'s own doc in safety.js) marks a bib with mobile activity but no
// matching Entry — validateAndCompute() deliberately no longer rejects such a bib, so it needs
// somewhere to actually surface: this tab shows it, flagged, rather than silently dropping it (the
// old behavior) or letting it look like an ordinary row, so the race director can catch a
// mistyped/unregistered bib. It's excluded from Results & Prize List and its Splits tab on its
// own, without needing to be filtered out here too — see js/mobile-progress.js's
// getSortedMobileProgress() (course-filtered via the same getEntry() lookup) and js/results.js's
// getSplitsRows() (an explicit `if (!entry) continue`).
//
// `conflict` (js/safety.js's own getConflictedBibs()) marks a bib SI Results, the stopwatch/
// manual Finishers list, and Mobile Files disagree about — either a different Finish time, or one
// source saying Finish while another says DNF/retired — the same clash Results & Prize List and
// Safety Check both already resolve and warn about (resolveFinishSources() in results.js: SI
// wins, then stopwatch, then mobile). This tab shows whichever value actually won (same as those
// two pages), flagged, so the race director doesn't mistake it for settled, undisputed data.
export function buildProgressRows() {
  const rowsByBib = new Map();
  // Computed once per call, not per row — getConflictedBibs() itself re-resolves both courses'
  // worth of sources, so it's worth sharing across every ensure() call here rather than redoing
  // that per bib.
  const conflictedBibs = getConflictedBibs();
  const ensure = bib => {
    if (!rowsByBib.has(bib)) {
      const info = entryInfo(bib);
      rowsByBib.set(bib, {
        bibNumber: bib, name: info.name, category: info.category, course: info.course,
        startTime: '', finishTime: '', startTimeOfDay: '', finishTimeOfDay: '',
        cpTimes: {}, cpTimesOfDay: {},
        invalid: info.invalid, conflict: conflictedBibs.has(bib),
      });
    }
    return rowsByBib.get(bib);
  };
  for (const e of getSortedEntries()) {
    const bib = +e.bibNumber;
    if (bib > 0) ensure(bib);
  }
  // startTime/finishTime (elapsed) are kept for other consumers (finishers.js/results.js/
  // safety.js all read a mobileProgress 'Finish' entry's own `.time` as a genuine elapsed finish
  // time for results computation) — startTimeOfDay/finishTimeOfDay (mirroring cpTimesOfDay below)
  // are what this tab's own renderer actually displays; see that function's own doc.
  for (const f of state.mobileProgress) {
    const bib = +f.number;
    if (bib <= 0) continue;
    if (f.action === 'Start') {
      ensure(bib).startTime = f.time || '';
      ensure(bib).startTimeOfDay = f.timeOfDay || '';
    } else if (f.action === 'Finish') {
      ensure(bib).finishTime = f.time || '';
      ensure(bib).finishTimeOfDay = f.timeOfDay || '';
    } else if (f.action === 'DNF') {
      ensure(bib).finishTime = 'DNF';
      // Stored even though the renderer shows the literal 'DNF' text, not a time, for this row
      // (same as cpTimesOfDay staying populated under a CP_RETIRE sentinel — see that field's own
      // doc) — keeps the two fields' own presence consistent regardless of what a given render
      // actually chooses to show.
      ensure(bib).finishTimeOfDay = f.timeOfDay || '';
    }
  }
  for (const r of state.mobileCheckpoints) {
    const row = ensure(+r.bibNumber);
    row.cpTimes = getMobileCheckpointTimes(r);
    row.cpTimesOfDay = getMobileCheckpointTimesOfDay(r);
  }
  return [...rowsByBib.values()].sort((a, b) => a.bibNumber - b.bibNumber);
}
