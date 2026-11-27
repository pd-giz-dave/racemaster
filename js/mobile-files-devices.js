'use strict';

import { escHtml } from './utils.js';
import { effectiveAdoptions } from './mobile-files-adoption.js';
import {
  byLineNumber, computeIncorporationStatus, getBleContact, latestEntryTimestamp, latestLineIso, parsePhoneTimestamp,
} from './mobile-files-shared.js';

// Devices tab — pure data logic: segment-view derivation and the device-list building it feeds.
// No DOM at all (not even a call to js/ui.js's renderTable) — js/views/mobile-files-devices.js
// is the thin rendering layer on top of this that actually puts these rows on screen.

// ---- Location resolution (mirrors racemaster-mobile's SyncRecordMapping's own doc) ----
//
// A device's location is constant except at 'Location' boundary-marker rows (Setup Race and
// Relocate both write one, immediately followed by their own ModeStart — see racemaster-mobile's
// RaceRepository.recordModeStart), which carry the location as of that point in their own `note`
// field. ModeStart's own `note` carries the explicit mode name instead now (see SyncRecord's own
// doc) — only 'Location' rows carry location. The wire/stored line shape no longer carries a
// `location` field of its own at all — this walks a device's lines once, in lineNumber order,
// tracking the most recent Location marker's `note` as the running "current location", and
// stamps every row with it.
const LOCATION_MARKER_ACTIONS = new Set(['Location']);

export function withResolvedLocations(lines, initialLocation = 'Finish') {
  let current = initialLocation;
  return [...lines].sort(byLineNumber).map(r => {
    if (LOCATION_MARKER_ACTIONS.has(r.action) && r.note) current = r.note;
    // NewRace (racemaster-mobile's HistoryAction.NEW_RACE) is always a race's own very first
    // line, deliberately location-agnostic — its real location arrives moments later via the
    // LOCATION marker that always immediately follows it (same recordModeStart transaction).
    // Stamping it with whatever `current` happens to be (the `initialLocation` default, on a
    // brand-new race) would misreport it as if it happened there — confirmed in the field: a
    // device's Where column showing a spurious "Finish" entry alongside its real location.
    if (r.action === 'NewRace') return { ...r, location: null };
    return { ...r, location: current };
  });
}

// ---- Segment view (mirrors racemaster-mobile's HistoryFold.kt) ----
//
// A device's file interleaves two independent, separately-numbered families of rows — Time
// splits (splitTime non-null) and Bibs/CP entries (splitTime null, bibNumber instead) — each
// with its own edit-echo/undo-marker history. "Current segment" here means every visit (the span
// from one 'Location' row up to, but not including, the next) that hasn't been individually
// closed by a Reset targeting it (via that Reset row's own refLineNumber — see
// resetTargetLineNumbers below), folded down to one row per logical entry (the latest edit, with
// anything since-undone dropped) — deliberately NOT narrowed to only the most-recently-visited
// location's own visits the way racemaster-mobile's own live mode-screen view is (see
// HistoryFold.currentSegmentRows there): a roaming device (CP marshal moving CP1 -> CP2 -> CP3
// with no Reset in between) still has every one of those visits open at once here, which is
// exactly what locationSegmentsOf() below (mobile-files-progress.js's own per-location bucketing)
// needs to work with — unlike the phone's own single-station screen, this file has no one
// "current location" of its own to narrow down to.

function foldLatestVisible(rows) {
  const latestByRoot = new Map();
  for (const r of rows) {
    const key = r.refLineNumber ?? r.lineNumber;
    const cur = latestByRoot.get(key);
    if (!cur || (r.lineNumber ?? 0) > (cur.lineNumber ?? 0)) latestByRoot.set(key, r);
  }
  // 'CountEjected' (racemaster-mobile's own HistoryAction.COUNT_EJECTED) used to be excluded here
  // too, the same way 'Undo' is, which (when its own refLineNumber correctly targets the beacon's
  // 'CountSeen' row, the normal case) makes that whole fold group vanish from this segment — same
  // as a plain Undo makes its own target vanish. That's still what happens below (CountEjected is
  // simply the later, winning row in that shared group, and is now kept rather than filtered away
  // — see the filter at the end of this function). The reason it must stay VISIBLE now, rather
  // than being dropped here the way it used to be: this is a single DEVICE's own segment, but a
  // beacon can be counted by more than one selected Count-mode device at once (ToDo.MD: "allow for
  // multiple devices reporting the same thing, e.g. 2 count phones recording CountSeen") — and an
  // eject recorded on THIS device has no way to retract an earlier, un-ejected CountSeen some
  // OTHER device already recorded for the same beacon. Confirmed live (race "callow-seniors",
  // beacon 1/bib 801): ejecting it on one Count phone left it still showing "on-course" from a
  // different Count phone's own, older, never-ejected sighting. Fixing that cross-device case
  // needs the eject's own timestamp to survive past this per-device fold, so mobile-files-
  // progress.js's own computeCountByBeacon()/mergeLatestByBeacon() can compare it against every
  // other selected device's own latest event for that beacon and let whichever is genuinely most
  // recent win — which is only possible if CountEjected rows are still here for it to see, instead
  // of silently vanishing (along with whatever CountSeen row they folded away) right here.
  return [...latestByRoot.values()].filter(r => r.action !== 'Undo');
}

// Every Location lineNumber some 'Reset' row's own refLineNumber has targeted — a visit whose own
// locationLineNumber is in this set has been individually closed and never becomes current again,
// even if a later visit shares its note. Computed from the RAW row list (Reset rows are excluded
// from foldLatestVisible's own input below, so this must be sourced separately, same as
// racemaster-mobile's HistoryFold.resetTargets).
function resetTargetLineNumbers(rows) {
  const targets = new Set();
  for (const r of rows) {
    if (r.action === 'Reset' && r.refLineNumber != null) targets.add(r.refLineNumber);
  }
  return targets;
}

// A "markerless" Reset — no refLineNumber at all — is the pre-this-feature convention (still
// possible from older/degraded data, or a Reset the phone otherwise failed to attach one to): it
// can't name which specific visit it closed, so it degrades to the old, cruder behavior instead
// of being silently ignored — a hard wall dropping every row at or before it, exactly what
// currentSegment() always did before location-grouping existed. The highest such lineNumber
// across the whole file (0 if none) is all that's needed; applied as a final filter in
// currentSegment() below, on top of (not instead of) the precise, refLineNumber-targeted closing
// above.
function legacyResetWallLine(rows) {
  return rows.reduce((max, r) => (r.action === 'Reset' && r.refLineNumber == null) ? Math.max(max, r.lineNumber ?? 0) : max, 0);
}

// Splits already fold-collapsed, ascending-by-lineNumber rows into per-Location "visits" — see
// racemaster-mobile's HistoryFold.visits. Rows before the first real Location marker in THIS
// family's own row list (there normally are none — every real device file's very first row for a
// family is always its own Location marker, see RaceRepository.recordModeStart — but older/
// degraded data, or a test fixture, might have none at all) are bucketed into an implicit visit of
// their own (locationLineNumber: 0, note: null) rather than dropped outright, so a file with no
// Location markers at all still shows everything, exactly as before this location-grouping
// existed. A bare `{action:'Reset'}` with no refLineNumber (the pre-this-feature convention) can
// never target lineNumber 0, so it can't close this implicit visit either — same "no boundary
// marker recognized, show everything" degradation.
//
// That implicit visit is folded into whichever REAL visit immediately follows it, though, rather
// than kept as its own standalone one — confirmed live (race "callow-seniors", device "witty-
// warbler"): a device repurposed INTO Bibs mode partway through its history (NewRace/Location/
// ModeStart, same as any mode switch) has a NewRace row that's the first-ever row in the 'bibs'
// family's own row list, even though the device's FILE as a whole has plenty of real Location
// rows (just for OTHER families) — resetTargetLineNumbers() only ever targets a real Location
// row's own lineNumber, never 0, so without this merge that lone NewRace survived every Reset of
// its own Bibs visit forever, stranding a phantom "current" bibsSegment containing nothing but a
// locationless NewRace row once the real Bibs visit it led into had long since been Reset-closed
// — which validateAndCompute() (mobile-files-progress.js) then rejected outright with "has no
// location recorded", even though the device's OTHER, genuinely current family (Count, in this
// case) had a perfectly good Location of its own.
function locationVisits(rows) {
  const result = [];
  let current = null;
  for (const r of rows) {
    if (r.action === 'Location') {
      if (current && current.locationLineNumber === 0) {
        current = { locationLineNumber: r.lineNumber, note: r.note, rows: [...current.rows, r] };
        continue;
      }
      if (current) result.push(current);
      current = { locationLineNumber: r.lineNumber, note: r.note, rows: [r] };
    } else {
      if (!current) current = { locationLineNumber: 0, note: null, rows: [] };
      current.rows.push(r);
    }
  }
  if (current) result.push(current);
  return result;
}

function currentSegment(rows) {
  const resetTargets = resetTargetLineNumbers(rows);
  const wallLine = legacyResetWallLine(rows);
  // 'Reset' must be excluded from foldLatestVisible's own input — a Reset row's own refLineNumber
  // points at a DIFFERENT row (the Location it invalidates, not its own edit history), so leaving
  // it in would let it hijack that Location row's fold group and silently make it vanish as if
  // edited away (see racemaster-mobile's own HistoryAction.RESET doc — this is the fold-
  // corruption fix). 'Ping' (a pure heartbeat — see HistoryAction.PING's own doc) is excluded the
  // same way, for the same "must never appear in a display list" reason. Unlike
  // racemaster-mobile's own live mode-screen view, 'ModeStart'/'NewRace' rows are deliberately
  // NOT excluded here — this segment still feeds locationSegmentsOf()/Compute Results
  // (mobile-files-progress.js), which read a bucket's own ModeStart row for baseline/context;
  // hasRealBib/hasRealSplit/rowFamily already separately keep them out of visible COUNTS
  // without needing them gone from the row list itself.
  const displayFiltered = rows.filter(r => r.action !== 'Reset' && r.action !== 'Ping');
  const folded = foldLatestVisible(displayFiltered).sort(byLineNumber);
  const visits = locationVisits(folded);
  return visits
    .filter(v => !resetTargets.has(v.locationLineNumber))
    .flatMap(v => v.rows)
    .filter(r => (r.lineNumber ?? 0) > wallLine);
}

// `expected` distinguishes "0 recorded, but this family genuinely IS in play here" (shows a
// literal "0") from "this family was never in play at all" (shows blank) — ToDo.MD's own
// distinction: a device that's declared its own Bibs ModeStart but hasn't recorded a bib yet is a
// real "0 so far", not the same as a Time-only device's Bibs column, which has nothing to do with
// bibs at all. `expected:false` is overridden by a genuinely non-zero count rather than hiding it
// — real recorded data must never be suppressed just because it wasn't predicted. Omitted
// (undefined) — the generic case, e.g. a progress.json row's own single bib count, which has no
// such family-expectation concept — falls back to the original "blank for zero" behavior.
export function formatCount(visible, expected) {
  if (expected === undefined) return visible === 0 ? '' : String(visible);
  return (expected || visible > 0) ? String(visible) : '';
}

// A CountComplete row's raw note is racemaster-mobile's own terse "of=<m>" encoding
// (CountModeRepository.kt) — shown as-is this read as just "of=1" with no seen count at all,
// since the row itself IS the "every issued beacon seen" moment, so the total doubles as the
// seen count. Mirrors that app's own HistoryActionLabels.displayNote, which turns the same note
// into "All <m> beacons seen" on-device; this table's plainer "<m> of <m>" instead matches the
// Bibs/Time columns' own "<visible> of <expected>" convention (formatCount above).
const COUNT_COMPLETE_NOTE_RE = /^of=(\d+)$/;

export function displayNote(action, note) {
  if (action === 'CountComplete') {
    const m = COUNT_COMPLETE_NOTE_RE.exec(note ?? '');
    if (m) return `${m[1]} of ${m[1]}`;
  }
  return note;
}

// A Bibs-family row with no real bib of its own — the family's own ModeStart marker (bibNumber
// always null now — see SyncRecord's own doc, mode is declared in `note` instead) must not
// inflate the "Bibs" visible count as if a bib had actually been recorded. A brand new, not-yet-
// synced device simply has zero lines at all until its first real ModeStart arrives (see
// flattenDevices() below for how that shows up: blank on both counts). NewRace (racemaster-
// mobile's HistoryAction.NEW_RACE — always a race's own first line, bibNumber always null) gets
// the same treatment, same reasoning.
function hasRealBib(r) {
  return r.action !== 'ModeStart' && r.action !== 'NewRace' && r.bibNumber != null;
}

// The Time family's own equivalent — its ModeStart marker's splitTime is always null now too
// (see SyncRecord's own doc) and must not inflate the "Time" visible count as if a split had
// actually been recorded. Deliberately still kept IN the segment itself (findStartTimestamp in
// mobile-files-progress.js, and this file's own latestStartedAt, both need it) — only excluded
// from the "Time" visible COUNT, so a Time-mode device with nothing but its own ModeStart marker
// correctly shows a split count of 0 rather than 1. NewRace gets the same exclusion, same
// reasoning as hasRealBib above.
// A Count-mode beacon currently "seen" (counted in) and not ejected is, for the Devices/All Files
// tabs' own Bibs column, exactly as real as a literal Finish/Pass bib — racemaster-mobile's own
// TODO.md "amalgamate Bibs, Count and Close modes" means Pen is now just another Bibs location
// (see isBibsExpected's own doc), and the whole point of counting beacons into the pen IS counting
// bibs, just via a beacon proxy instead of punching the number in directly. Close-mode rows are
// deliberately NOT included here — unlike an eject/un-eject, there's no "which beacons does this
// bib-count represent right now" status for a closed beacon, just a one-off physical event.
function countedBeaconCount(countSegmentRows) {
  return [...computeCountByBeacon(countSegmentRows).values()].filter(e => e.countedAt != null).length;
}

function hasRealSplit(r) {
  return r.action !== 'ModeStart' && r.action !== 'NewRace' && r.splitTime != null;
}

// Whether Bibs/Time are genuinely expected on this device at all — driven purely by the CURRENT
// segment's own latest ModeStart record's explicit mode declaration in `note` (see SyncRecord's
// own doc; AppMode.wireName() on the mobile side) rather than inspecting bibNumber/splitTime
// anywhere — every real device file now always carries a ModeStart marker (mode selection is
// mandatory at Setup Race), so there's no longer a realistic case where real entries exist
// without one already having declared the family; no segment-inspection fallback is kept.
//
// `modeStart` is null once every visit has been properly closed (a completely reset device — see
// latestModeStart() below) — both then correctly return false, matching ToDo.MD's "when a mobile
// file is completely reset ... both bibs and time columns should be blank as its mode is also now
// unknown" (formatCount()'s own `expected:false` is what turns that into a blank cell rather than
// a literal "0").
//
// A 'Bibs' note alone is no longer enough, though (see isBibsExpected's own location check
// below): racemaster-mobile's own TODO.md "amalgamate Bibs, Count and Close modes" dropped the
// separate COUNT/CLOSE AppMode values entirely — AppMode now only has TIME/BIBS
// (~/racemaster-mobile's own data/settings/AppMode.kt), with Pen/Close acting as two more Bibs
// LOCATIONS instead (AppMode.toHistoryMode(location); LocationValidation.isValidLocationForMode
// in that same repo), so a genuine Count- or Close-role device's own ModeStart note is now always
// literally 'Bibs' too, same as an ordinary Start/Finish/CPn phone's — it never writes 'Count'/
// 'Close' there any more (those two strings are only still recognised below for a file recorded
// before this app update).
function isBibsExpected(modeStart) {
  if (modeStart?.note !== 'Bibs' && modeStart?.note !== 'CP') return false;
  // A dedicated Close-role device (ModeStart note 'Bibs', but at location 'Close') never writes a
  // real Start/Finish/Pass row of its own, nor anything countedBeaconCount() can read — its Close/
  // CloseReopened rows are unconditionally classified into the 'close' family regardless of this
  // note (see rowFamily()'s own doc), so its bibsSegment only ever holds the bare Location/
  // ModeStart marker pair. Without this check it would wrongly show "0 so far, but genuinely
  // expected" in the Bibs column — exactly the "has nothing to do with bibs" case this already
  // correctly reports blank for an old-format file whose ModeStart note was still the literal
  // 'Close' (now excluded above before this location check ever runs).
  //
  // Pen, unlike Close, genuinely IS expected now — a currently-counted (seen, not ejected) beacon
  // counts as a bib for this same column's own purposes (see countedBeaconCount()'s own doc), so a
  // Count-role device with nothing counted yet should still show "0", not blank.
  const location = (modeStart.location || '').trim().toLowerCase();
  return location !== 'close';
}

function isTimeExpected(modeStart) {
  return modeStart?.note === 'Time';
}

// The CURRENT segment's own latest ModeStart record — i.e. belonging to whichever visit is still
// open, scoped the exact same way timeSegment/bibsSegment (buildSegmentView() below) already are,
// not the whole file regardless of Reset boundaries the way this used to work. ToDo.MD: "when a
// mobile file is completely reset (all the way back to the beginning) device view shows a blank
// location but has retained the mode, that should be blank too" — a device whose only/every visit
// has been properly closed (a Reset with a real refLineNumber targeting it — see
// resetTargetLineNumbers/currentSegment above) now correctly reports no current mode at all, the
// same way its own location/visible rows already correctly go empty, rather than falling back to
// whatever mode used to be declared there. Since a ModeStart row is never itself excluded from
// currentSegment()'s own output (see that function's own doc), this can just search the two
// already-computed segments directly rather than re-deriving anything of its own.
//
// Returns the record itself (not just its timestamp — contrast latestStartedAt() below, which is
// this same lookup for just that one field), so callers can also read its own bibNumber/splitTime
// (isBibsExpected/isTimeExpected above), location (flattenDevices below), or mode declaration
// (its own `note` — 'Time'/'Bibs'/'CP'/'Close'/'Count', see SyncRecord's own doc — read directly
// by js/views/mobile-files-devices.js's showDeviceModal() for its own "Mode:" summary line).
// Takes every segment buildSegmentView() produced (timeSegment, bibsSegment, and now
// closeSegment/countSegment) as separate arguments — a plain rest-spread, so an older call site
// passing only two segments still works unchanged.
export function latestModeStart(...segments) {
  const candidates = segments.flat().filter(r => r.action === 'ModeStart');
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.lineNumber ?? 0) > (a.lineNumber ?? 0) ? b : a);
}

// A Reset or an Undo on the phone is already fully reflected here — currentSegment() drops every
// visit a Reset has individually closed (see its own doc), and foldLatestVisible() drops anything
// whose latest state is an Undo marker. Compute Results (mobile-files-progress.js) exploits this:
// since the segment is always the true, current picture, syncing to Finishers never needs to
// diff against or patch around what's already there — it just wipes Finishers and rebuilds from
// the segment. Exported: mobile-files-progress.js's own validateAndCompute() resolves each
// selected file's segment the same way js/views/mobile-files-devices.js's showDeviceModal() does.
// A real (non-marker) row's own splitTime nullness is still the genuine structural signal for
// Time vs. everything else (a real Time row always has one, nothing else ever does) — unchanged.
// A real Close row (action:'Close', racemaster-mobile's own Close recording mode) or CountSeen
// row (action:'CountSeen', Count mode) is told apart by its own action string instead, not
// splitTime (both are always null, same as a Bibs/CP row) — without this, either would silently
// fall into the Bibs family's default and then get dropped outright downstream, since neither
// action is in TRANSFERABLE_BIBS_ACTIONS (mobile-files-progress.js) — confirmed in the field:
// beacon close/count data recorded on a phone never showing up anywhere once pulled. A ModeStart
// row's own splitTime is always null regardless of mode (see SyncRecord's own doc), so its
// placement instead reads its own explicit mode declaration ('Time'/'Bibs'/'CP'/'Close'/'Count').
// 'Location'/'Reset'/'NewRace' are NOT handled here any more (see resolveRowFamily's own doc for
// why they need context this per-row function doesn't have) — every other action is still
// classified purely from its own fields.
function familyFromModeNote(note) {
  if (note === 'Time') return 'time';
  if (note === 'Close') return 'close';
  if (note === 'Count') return 'count';
  return 'bibs'; // 'Bibs'/'CP', or an unrecognised mode — the pre-Close/Count default
}

function rowFamily(r) {
  if (r.action === 'ModeStart') return familyFromModeNote(r.note);
  if (r.action === 'Close') return 'close';
  // racemaster-mobile's own auto-reinstatement marker (HistoryAction.CLOSE_REOPENED) — a
  // previously-closed beacon heard advertising again. Must bucket into 'close' the same as a
  // real Close row, for the same reason CountSeen must (see this function's own doc) — without
  // this it falls into the Bibs family's default (splitTime is null, same as Close) and silently
  // vanishes, the exact bug that doc already warns about for Close/CountSeen.
  if (r.action === 'CloseReopened') return 'close';
  // CountComplete/CountStopped (racemaster-mobile's own HistoryAction.COUNT_COMPLETE/
  // COUNT_STOPPED) are Count-only markers, same shape/same bug-prone default as CloseReopened
  // above: both carry no bibNumber/splitTime of their own, so without this they fall into the
  // Bibs family's default and silently pollute it — confirmed in the field, a device repurposed
  // from Count to Bibs/CP mode (same physical phone/file) ended up with a leftover CountComplete
  // row stranding a phantom "Pen" location segment alongside the real CP one, and
  // resolveLocationKey('Pen') returning null (unrecognised) made validateAndCompute() reject the
  // ENTIRE selected batch with "location 'Pen' isn't recognised" — silently blocking the real
  // CP1 passes from ever reaching the Progress tab too (ToDo.MD: "progress tab is not being
  // updated by checkpoint passes").
  if (r.action === 'CountSeen' || r.action === 'CountComplete' || r.action === 'CountStopped') return 'count';
  // 'CountEjected'/'CountUnejected' (racemaster-mobile's own HistoryAction.COUNT_EJECTED/
  // COUNT_UNEJECTED — ToDo.MD: "allow for CountEjected in the device file ...") carry no
  // bibNumber/splitTime of their own either, same bug-prone default as CloseReopened/
  // CountComplete/CountStopped above: without their own case here they'd fall into the Bibs
  // family's default and strand a phantom "Pen"/"Close" location segment for
  // mobile-files-progress.js's own locationSegmentsOf() to stumble over, the exact bug those
  // three already guard against.
  if (r.action === 'CountEjected' || r.action === 'CountUnejected') return 'count';
  return r.splitTime != null ? 'time' : 'bibs';
}

// A 'Location'/'Reset'/'NewRace' row's own splitTime is now always null regardless of family
// (racemaster-mobile's SyncRecordMapping.toSyncRecord: a boundary marker is never a real timed
// split, same treatment as ModeStart/Ping) — so unlike every other shared-action row, none of
// these three can be told apart from a Bibs/CP/Close/Count one by splitTime (or, for Close/Count,
// by action string) alone any more. Each is resolved from its own structural neighbour instead,
// walking toward whichever Location row anchors that segment, then reading that Location's own
// next-row ModeStart the same way rowFamily already reads a ModeStart row's note directly:
//  - 'Location': the very next row by lineNumber is always that Location's own ModeStart, in the
//    same write transaction (racemaster-mobile's RaceRepository.recordModeStart writes the pair
//    back to back).
//  - 'Reset': its own refLineNumber always names the Location row of the segment it's closing
//    (racemaster-mobile's RaceRepository.closeCurrentSegment) — resolved via `byLineNumber`,
//    then the same rule as above.
//  - 'NewRace': always immediately followed by that race's own very first Location row, in the
//    same write transaction (racemaster-mobile's RaceRepository.recordModeStart's own NEW_RACE
//    branch) — resolved the same way, one hop further out.
// Falls back to 'bibs' (matching rowFamily's own default) if the expected neighbour is missing —
// shouldn't happen on real data, but degrades harmlessly rather than throwing.
function resolveRowFamily(r, index, sortedRows, byLineNumber) {
  if (r.action === 'Location') {
    const next = sortedRows[index + 1];
    return next?.action === 'ModeStart' ? familyFromModeNote(next.note) : 'bibs';
  }
  if (r.action === 'Reset' && r.refLineNumber != null) {
    const target = byLineNumber.get(r.refLineNumber);
    return target?.action === 'Location' ? resolveRowFamily(target, sortedRows.indexOf(target), sortedRows, byLineNumber) : 'bibs';
  }
  if (r.action === 'NewRace') {
    const next = sortedRows[index + 1];
    return next?.action === 'Location' ? resolveRowFamily(next, index + 1, sortedRows, byLineNumber) : 'bibs';
  }
  return rowFamily(r);
}

// Four independent, separately-numbered families now share one device file: Time (splitTime),
// Bibs/CP (bibNumber), and the two newer beacon-housekeeping ones, Close and CountSeen (see
// rowFamily's own doc) — a dedicated Close/Count phone never writes a Bib/Time entry of its own
// (racemaster-mobile's own convention), so in practice a given device's closeSegment/countSegment
// is only ever populated when its timeSegment/bibsSegment are both empty, and vice versa, but all
// four are always computed uniformly here regardless.
export function buildSegmentView(lines) {
  const sorted = [...lines].sort(byLineNumber);
  const byLineNum = new Map(sorted.map(r => [r.lineNumber, r]));
  const timeRows = [];
  const bibsRows = [];
  const closeRows = [];
  const countRows = [];
  sorted.forEach((r, i) => {
    const family = resolveRowFamily(r, i, sorted, byLineNum);
    const bucket = family === 'time' ? timeRows : family === 'close' ? closeRows : family === 'count' ? countRows : bibsRows;
    bucket.push(r);
  });
  return {
    timeSegment: currentSegment(timeRows).sort(byLineNumber),
    bibsSegment: currentSegment(bibsRows).sort(byLineNumber),
    closeSegment: currentSegment(closeRows).sort(byLineNumber),
    countSegment: currentSegment(countRows).sort(byLineNumber),
  };
}

const COUNT_NOTE_RE = /beacon=(\d+)/;

// A CountSeen row sets countedAt; a CountEjected row (racemaster-mobile's own
// HistoryAction.COUNT_EJECTED) un-sets it — but, unlike the earlier design, still produces a real
// Map entry (`{ at, countedAt: null }`) rather than simply having no entry at all. That distinction
// matters once mobile-files-progress.js's own mergeLatestByBeacon() compares this device's own
// result against every other selected device's: "no entry" would be indistinguishable from "this
// device never saw this beacon at all", so a genuinely later eject on THIS device could never beat
// an earlier, un-ejected CountSeen some OTHER selected device still has for the same beacon —
// confirmed live (race "callow-seniors", beacon 1/bib 801): ejecting it on one Count phone left it
// still "on-course" from a different Count phone's own older sighting, since the eject had nowhere
// to register against. Carrying the eject's own timestamp here is what lets it actually win that
// comparison when it's genuinely the most recent event for that beacon, same principle as Close's
// own CloseReopened (mobile-files-progress.js's own computeCloseByBeacon) — foldLatestVisible()
// above no longer drops CountEjected rows before they get here, for the same reason. CountUnejected
// (HistoryAction.COUNT_UNEJECTED) reverses an eject on the same device and must re-set countedAt
// the same way CountSeen does — confirmed live (race "callow-seniors", beacon 1): swift-puffin
// logged CountEjected then CountUnejected for it, and without this case Update Progress kept
// treating it as ejected forever, since the row was simply skipped here. Its own note still carries
// "beacon=N" even though its bibNumber/refLineNumber come through null from the mobile app (a
// separate, already-known gap there) — COUNT_NOTE_RE only ever reads the note.
//
// Exported: mobile-files-progress.js's own applyComputedResults()/buildProgressRows() use this for
// the Progress tab's "Counted" column (merged across every selected device via its own
// mergeLatestByBeacon()); flattenDevices() below uses it for the Devices/All Files tabs' own Bibs
// column — a single device's own current segment only, no cross-device merge needed there.
export function computeCountByBeacon(countSegmentRows) {
  const result = new Map();
  for (const r of countSegmentRows) {
    if (r.action !== 'CountSeen' && r.action !== 'CountEjected' && r.action !== 'CountUnejected') continue;
    const m = COUNT_NOTE_RE.exec(r.note || '');
    if (!m) continue;
    const beacon = +m[1];
    if (!Number.isFinite(beacon) || beacon <= 0) continue;
    const at = r.timestamp ?? r.timestampMillis ?? '';
    result.set(beacon, { at, countedAt: r.action === 'CountEjected' ? null : at });
  }
  return result;
}

// "yyyy/MM/dd HH:mm:ss" (the phone's own local time) → just the "HH:mm:ss" part. Field was
// renamed server-side from timestampMillis to timestamp (see server.js's coerce()) — files
// written before that rename are still on disk under the old name, so read whichever is present.
// Exported: js/views/mobile-files-devices.js's showDeviceModal() uses this directly.
export function whenOf(r) {
  return ((r.timestamp ?? r.timestampMillis) || '').split(' ')[1] || '';
}

// ---- Raw view (the Raw modal's own Ping-collapsing) ----
//
// Collapses a run of 2+ consecutive (adjacent in lineNumber order, nothing else between them)
// 'Ping' heartbeat rows into a single summary row — "<first> - <last>" in both the line number
// and timestamp columns — a busy device can log dozens of these with nothing else going on,
// which otherwise buries the genuinely interesting rows around them in js/views/
// mobile-files-devices.js's own showRawModal(). An isolated Ping (no other one immediately
// before/after it) is left exactly as-is; there's nothing to collapse it with. `sorted` must
// already be lineNumber-ascending (showRawModal's own raw, unfolded listing — unlike
// buildSegmentView() above, nothing here folds/filters anything else); `tsField` is whichever of
// 'timestamp'/'timestampMillis' these particular lines actually carry (see whenOf()'s own doc for
// why it's not always the same one), or null when neither is present at all.
export function collapsePingRuns(sorted, tsField) {
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    if (sorted[i].action === 'Ping') {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].action === 'Ping') j++;
      if (j > i) {
        const first = sorted[i], last = sorted[j];
        groups.push({
          lineNumber: `${first.lineNumber ?? ''} - ${last.lineNumber ?? ''}`,
          action: 'Ping',
          ...(tsField ? { [tsField]: `${first[tsField] ?? ''} - ${last[tsField] ?? ''}` } : {}),
        });
        i = j + 1;
        continue;
      }
    }
    groups.push(sorted[i]);
    i++;
  }
  return groups;
}

// The device's own most recent "session start" marker — action:'ModeStart', written the moment a
// mode (Bibs/CP or Time) is actually chosen, whichever family this device actually uses. A single
// unambiguous action name for both families (replacing the former per-family action:'Start' /
// action:'Clock' markers — ToDo.MD: "use the ModeStart records and not start or clock records"),
// so unlike before there's no risk of colliding with an individual runner's own bib-bearing
// action:'Start' entry (Bibs/CP mode's own early/late-start record) — that's a completely
// different action string now, nothing here needs to filter it out by family any more.
//
// Scoped to the CURRENT segment only, same as latestModeStart() itself now is (see its own doc) —
// a completely-reset device (every visit properly closed) correctly returns '' here too, not the
// timestamp of whatever ModeStart used to apply before the reset.
//
// Returns the raw "yyyy/mm/dd HH:MM:SS" timestamp (same shape latestLineTimestamp() above
// returns for Last Update, formatted the same way via formatStoredTimestamp() at render time —
// js/views/mobile-files-devices.js) from whichever qualifying record is latest, or '' if the
// device has no such record at all (nothing pulled yet, every visit closed, or an old file
// predating this marker convention).
export function latestStartedAt(lines) {
  const { timeSegment, bibsSegment, closeSegment, countSegment } = buildSegmentView(lines);
  const latest = latestModeStart(timeSegment, bibsSegment, closeSegment, countSegment);
  return latest ? (latest.timestamp ?? latest.timestampMillis ?? '') : '';
}

// A set of visible rows' own CURRENT location — the latest-wins (highest lineNumber) value,
// used wherever a single representative location is needed (the Devices list's own sort order,
// mobile-files-progress.js's own single-location bucketing). A device relocating mid-race is a
// real HistoryAction.LOCATION entry within the SAME race/file now (racemaster-mobile's own
// RaceRepository.relocateActiveModes) — not a new race filed under a new name — so a device's own
// `visibleRows` can genuinely span more than one location again; this is deliberately still just
// "whichever one is current" (see distinctLocationsOf() below for the full list). Returns null
// only when there's no visible row at all (or none of them carry a location).
function currentLocationOf(visibleRows) {
  if (!visibleRows.length) return null;
  const latest = visibleRows.reduce((a, b) => (b.lineNumber ?? 0) > (a.lineNumber ?? 0) ? b : a);
  return latest.location || null;
}

// Exported: js/views/mobile-files-devices.js's showDeviceModal() uses this directly.
export function locationSummary(visibleRows) {
  return escHtml(currentLocationOf(visibleRows) || '—');
}

// Same as locationSummary() above, but the raw string (or null when there isn't one) rather than
// a display-ready HTML snippet. Also used by mobile-files-progress.js's own validateAndCompute()
// as the single-location fallback for a row that's already been narrowed to one location's own
// rows (see that function's own doc).
export function rawLocationOf(visibleRows) {
  return currentLocationOf(visibleRows);
}

// Every distinct location a device has recorded at within its CURRENT (RESET-bounded) segment —
// course-ordered via locationSortKey, same convention the Devices list itself sorts by. Unlike
// currentLocationOf() above, this doesn't collapse down to one value: a relocated device's
// earlier station is exactly what the "Where" column (js/views/mobile-files-devices.js) needs to
// keep showing, not just wherever it ended up. Scoped to the same RESET-bounded `visibleRows` set
// every other per-row figure (bibsVisible, timeVisible, ...) already uses, not the raw whole
// file — a genuine Reset still means "discard", including whichever location(s) it happened at,
// consistent with everything else this file already treats that way.
export function distinctLocationsOf(visibleRows) {
  const locations = [...new Set(visibleRows.map(r => r.location).filter(Boolean))];
  return locations.sort((a, b) => {
    const ka = locationSortKey(a), kb = locationSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
}

// ---- Device view options (one per distinct location+mode combination) ----
//
// ToDo.MD: "I want the devices view to be split by location + mode ... these should be options
// on the view selector not sub-sections within the view" — a device that's switched mode without
// an intervening Reset (so more than one of buildSegmentView()'s four segments is genuinely open
// at once — see that function's own doc) previously had every one of those rows shown together.
// js/views/mobile-files.js's own viewDeviceRow() calls this first and offers each option
// returned here as a separate choice (prompting only when there's more than one), always handing
// showDeviceModal() lines already narrowed to exactly one location+mode — the modal itself never
// needs to merge or separate anything.
//
// A family with rows but no real entry of its own (e.g. a Bibs session opened, then the device
// switched to Close before ever recording an actual bib) is still offered as its own option — it
// genuinely happened and the operator may want to see the raw Location/ModeStart pair that opened
// it — just labelled "(empty)" so it reads at a glance as the one with nothing useful in it.
//
// EXCEPT at a Pen/Close location (see the loop below), where that Location/ModeStart pair is
// merged INTO the "Count"/"Close" option instead of being offered as its own separate "Bibs"
// option: racemaster-mobile's own TODO.md "amalgamate Bibs, Count and Close modes" means a
// Count/Close-role device's ModeStart record is now always declared 'Bibs' (AppMode only has
// TIME/BIBS — ~/racemaster-mobile's data/settings/AppMode.kt), with Pen/Close as two more Bibs
// locations rather than their own mode, so that same one ModeStart record is simultaneously what
// opens the real Count/Close session too — there's only one session there, not two. A genuinely
// still-empty Count/Close visit (relocated here, nothing counted/closed yet) still gets its own
// option this way, correctly labelled "Count (empty)"/"Close (empty)" and still showing the raw
// Location/ModeStart pair that opened it — the same "it genuinely happened, show it anyway" case
// this comment's first paragraph already describes, just under the right label now instead of the
// always-misleading "Bibs (empty)" every single Pen/Close device used to show alongside it.
const FAMILY_LABELS = ['Time', 'Bibs', 'Close', 'Count'];
function hasRealEntry(label, r) {
  if (label === 'Time') return hasRealSplit(r);
  if (label === 'Bibs') return hasRealBib(r);
  if (label === 'Close') return r.action === 'Close' || r.action === 'CloseReopened';
  return r.action === 'CountSeen'; // 'Count'
}

export function deviceViewOptions(resolvedLines) {
  const whole = buildSegmentView(resolvedLines);
  const allVisible = [...whole.timeSegment, ...whole.bibsSegment, ...whole.closeSegment, ...whole.countSegment];
  const locations = distinctLocationsOf(allVisible);
  // No location recorded at all (older/degraded data, or a test fixture — see
  // withResolvedLocations' own doc) still gets exactly one pass, over the whole file unfiltered,
  // same "no location-narrowing possible" degradation flattenDevices()/locationSegmentsOf()
  // already use elsewhere.
  const locationList = locations.length ? locations : [null];
  const options = [];
  for (const location of locationList) {
    const lines = location === null ? resolvedLines : resolvedLines.filter(l => l.location === location);
    const segments = buildSegmentView(lines);
    const familyRows = { Time: segments.timeSegment, Bibs: segments.bibsSegment, Close: segments.closeSegment, Count: segments.countSegment };
    const locLower = (location || '').trim().toLowerCase();
    // Which single family actually owns this location under the new architecture — a Count
    // session is always at 'Pen', a Close session always at 'Close' (CountModeRepository's own
    // doc: "Count's own location is always the fixed 'Pen'"; Close's own equivalent), so there's
    // never a real ambiguity between the two at one location to resolve here.
    const roleMode = locLower === 'pen' ? 'Count' : locLower === 'close' ? 'Close' : null;
    for (const mode of FAMILY_LABELS) {
      if (mode === 'Bibs' && roleMode) continue; // merged into roleMode's own option below instead
      const rows = mode === roleMode ? [...familyRows.Bibs, ...familyRows[mode]].sort(byLineNumber) : familyRows[mode];
      if (!rows.length) continue;
      options.push({ location, mode, empty: !rows.some(r => hasRealEntry(mode, r)), lines: rows });
    }
  }
  // Location only earns a place in the label when it actually distinguishes two options from
  // each other — the common "one location, several modes" case (this ToDo item's own example:
  // "for the start location there are 3 views - bibs (empty), close and count") reads as plain
  // mode names, with which location they're all at left to the dialog's own prompt/context.
  const multiLocation = new Set(options.map(o => o.location)).size > 1;
  return options.map(o => ({
    ...o,
    label: (multiLocation && o.location != null ? `${o.location} — ${o.mode}` : o.mode) + (o.empty ? ' (empty)' : ''),
  }));
}

// Every location is free text set by the phone operator (RaceMaster Mobile's own
// RaceEntity.location — e.g. "Finish", "Start", "1 - Polebank", "Hadden 2", "CP3", "cp 3"). The
// phone app itself enforces that a non-Finish, non-Start location contains exactly one number,
// so any location with a digit in it is a checkpoint identified by that number — there's no
// other convention to key off since location is otherwise arbitrary free text. "Start" is its
// own recognised kind (not a checkpoint) — a marshal pairs a Bibs-mode phone with a Time-mode
// phone at the start line, same as the Finish pairing, to catch early/late starters before both
// phones relocate to Finish for the main event — see mobile-files-progress.js's own
// validateAndCompute() for how a 'start' bucket is used. Used both by locationSortKey() below
// and by mobile-files-progress.js's own validateAndCompute().
// "Close" is recognised the same defensive way "Start" already was — not because anything here
// actually buckets by it (a Close-mode device is diverted to its own handling entirely before
// location-based bucketing ever runs, in mobile-files-progress.js's own validateAndCompute(), the
// same way a Count-mode device's forced "Start" location never reaches the 'start' bucket either —
// see that function's own doc), just so this never reports it as unrecognised if one somehow
// slips through to here regardless.
//
// "Pen" (ToDo.MD: "allow for a location of 'Pen' or 'Close' when selecting device file for
// updating progress") is Count mode's own real forced Location-marker note (racemaster-mobile's
// own RaceRepository.recordModeStart — see CountModeRepository's own doc; this file's "Start"
// reference above predates that and is itself now stale for Count specifically, though harmless,
// since nothing here actually keys off it either). Recognised for exactly the same defensive
// reason "Close" already is: a stray Count-family row misclassified into Bibs/Time (the bug
// rowFamily()'s own CountComplete/CountStopped/CountEjected/CountUnejected cases above guard
// against) would otherwise strand a phantom "Pen" segment here and get reported as an
// unrecognised location, rejecting the whole selected batch outright.
export function resolveLocationKey(location) {
  const loc = (location || '').trim();
  if (/^finish$/i.test(loc)) return { kind: 'finish' };
  if (/^start$/i.test(loc)) return { kind: 'start' };
  if (/^close$/i.test(loc)) return { kind: 'close' };
  if (/^pen$/i.test(loc)) return { kind: 'pen' };
  const m = loc.match(/(\d+)/);
  return m ? { kind: 'cp', number: +m[1] } : null; // null = unrecognised
}

// ---- List (one row per device) ----

// Finish first, then CP1, CP2, ... ascending, then anything unrecognised/inconsistent last
// (alphabetically among themselves) — mirrors resolveLocationKey's own Finish/CP convention
// (see the Results tab), so devices within one race list in course order rather than whatever
// order the server happened to return them in.
function locationSortKey(rawLocation) {
  const key = resolveLocationKey(rawLocation);
  if (key?.kind === 'finish') return [0, 0, ''];
  if (key?.kind === 'cp')     return [1, key.number, ''];
  return [2, 0, rawLocation || ''];
}

// Flattens races → one row per device (one physical server file), precomputing everything the
// columns need so js/views/mobile-files-devices.js's column render functions stay trivial reads,
// same as every other list view's *_COLS.
//
// One device file is always exactly one row — a marshal relocating mid-race now writes a
// HistoryAction.LOCATION marker into the SAME race/device file (racemaster-mobile's own
// RaceRepository.relocateActiveModes) rather than starting a new race, so a device's own rows can
// genuinely span more than one location again. This function still returns one row per device —
// `location` stays the single current/latest value (for sorting), and the new `locations` field
// carries the full course-ordered list for the "Where" column. js/views/mobile-files.js's `view`
// handlers use `locations` to decide whether to prompt before narrowing `device.resolvedLines`
// down to one location's own rows (each row's own `.location` — resolved here, once, via
// withResolvedLocations(), since the wire/stored shape no longer carries the field itself — says
// which station it belongs to, so no further client-side segment-boundary reconstruction is
// needed downstream).
//
// `device.lines` is deliberately left exactly as received — genuinely raw, whatever arrived over
// the wire/from the server, no field added or changed. The resolved (location-stamped) view lives
// on its own, `device.resolvedLines`, so a consumer wanting "what's actually stored" (Raw, Push)
// and one wanting "the current, interpreted picture" (View, Update Progress's own
// locationSegmentsOf() in mobile-files-progress.js) each read the one that's actually theirs,
// rather than both being handed the same post-processed array with no way to tell which they got.
// A device genuinely still connected pings often enough (racemaster-mobile's own configurable
// heartbeat — HistoryAction.PING, MuleSyncEngine.kt's startPingLoop(), 60s by default) that a much
// longer silence than one interval is a real connectivity concern, not just an unlucky sync
// moment — 3x the phone's own 60s default comfortably covers one missed beat plus normal sync lag
// without flagging a perfectly healthy device. The web app has no way to know a given phone's own
// configured interval (a local phone setting, never uploaded), so this is a single fixed
// threshold rather than per-device.
const DEVICE_OFFLINE_THRESHOLD_MS = 3 * 60 * 1000;

// ToDo.MD: "devices tab on mobile files page should indicate a device has gone off-line if it
// does not see regular pings" — [lastSeenIso] is the row's own lastSeen (latestLineIso(lines) in
// flattenDevices() below — the newest line of ANY kind, Ping included, so a device with heartbeat
// disabled still reads as offline once real activity itself goes quiet this long). A device with
// no lines/timestamp at all is never flagged offline — nothing to judge staleness from yet, the
// same "unknown, not alarming" convention formatDateTime()'s own muted em-dash already uses for a
// blank timestamp. [now] is injectable for tests, same convention raceLabelAgeDays() etc. use.
export function isDeviceOffline(lastSeenIso, now = Date.now()) {
  if (!lastSeenIso) return false;
  const t = new Date(lastSeenIso).getTime();
  if (isNaN(t)) return false;
  return now - t >= DEVICE_OFFLINE_THRESHOLD_MS;
}

// Exported for js/views/mobile-files.js's own pollServerForChanges() — that background poll only
// triggers a re-render when hasNewMobileData() says a file itself changed (new lines/mtime),
// which by design never fires for the one case Offline detection exists to catch: a device that's
// simply gone quiet, with nothing new to compare. Field report that prompted this: the Devices tab
// (and its "as at" indicator, also only refreshed inside a render) sat frozen well past a device's
// own last-seen threshold with no Offline tag — not because the poll timer had stopped, but
// because nothing ever gave it a reason to re-render once the device stopped producing new data.
// `rows` is js/views/mobile-files-devices.js's own currentRows (the last-rendered Devices tab
// rows, each already carrying its own `offline` as of that render) — true as soon as any of them
// would now compute differently from what's still on screen.
export function anyRowNewlyOffline(rows, now = Date.now()) {
  return rows.some(r => !r.offline && isDeviceOffline(r.lastSeen, now));
}

export function flattenDevices(races) {
  const rows = [];
  // Where each device has been adopted (js/mobile-files-adoption.js) — carried on its row as
  // adoptedInto, so anything grouping rows by race treats an adopted phone as part of the race
  // it's joining, not the arbitrary name it's still reporting until it renames.
  const adoptedInto = new Map(effectiveAdoptions(races).map(a => [`${a.owner} ${a.fromRaceLabel} ${a.deviceName}`, a.raceLabel]));
  for (const race of races) {
    const prepared = race.devices.map(rawDevice => {
      const resolvedLines = withResolvedLocations(rawDevice.lines);
      const device = { ...rawDevice, resolvedLines };
      const { timeSegment, bibsSegment, closeSegment, countSegment } = buildSegmentView(resolvedLines);
      const modeStart = latestModeStart(timeSegment, bibsSegment, closeSegment, countSegment);
      // No separate folding-in needed any more — modeStart, when it exists at all, is already one
      // of the rows currentSegment() itself returned (see that function's own doc: a ModeStart row
      // is never excluded from its output), so it's already present in one of the four segments.
      // Once every visit's been properly closed (a completely reset device), modeStart is
      // correctly null and `visible` is just the (now empty) segments — Where/Mode/Bibs/Time/
      // Started At all then report blank/unknown together, not some blank and some stale (ToDo.MD:
      // "when a mobile file is completely reset ... that should be blank too"). closeSegment/
      // countSegment are folded into `visible` here too, even though neither contributes to
      // bibsVisible/timeVisible below (a Close/CountSeen row is never a real bib or split) — a
      // pure Close/Count device would otherwise show no Where/Mode/Started At at all, despite its
      // own Location/ModeStart rows being perfectly real and resolved.
      const visible = [...timeSegment, ...bibsSegment, ...closeSegment, ...countSegment];
      return {
        device, timeSegment, bibsSegment, countSegment, modeStart,
        rawLocation: rawLocationOf(visible), location: locationSummary(visible),
        locations: distinctLocationsOf(visible),
      };
    });
    // Finish first, then CP1, CP2, ... ascending, then unrecognised last (see locationSortKey) —
    // so devices within one race list in course order rather than the server's own directory
    // order.
    prepared.sort((a, b) => {
      const ka = locationSortKey(a.rawLocation), kb = locationSortKey(b.rawLocation);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    });
    for (const { device, timeSegment, bibsSegment, countSegment, modeStart, rawLocation, location, locations } of prepared) {
      const r = { owner: race.owner, raceLabel: race.raceLabel, device, rawLocation };
      const lastSeen = latestLineIso(device.lines);
      rows.push({
        idx: rows.length,
        ...r,
        raceDate: race.raceDate,
        adoptedInto: adoptedInto.get(`${race.owner} ${race.raceLabel} ${device.name}`) ?? null,
        pending: !!device.pending,
        location,
        locations,
        // A Count-role device's own "bibs" are its currently-counted (seen, not ejected) beacons —
        // see countedBeaconCount()'s own doc — added alongside bibsSegment's literal Finish/Pass
        // bibs rather than instead of them, since the two are mutually exclusive per device/
        // location in practice (never both nonzero at once) but there's no need to pick one over
        // the other structurally.
        bibsVisible: bibsSegment.filter(hasRealBib).length + countedBeaconCount(countSegment),
        // Per-location bib counts, index-aligned with `locations` (ToDo.MD: "bibs column in
        // devices list should show a bib count for each location in the file, aligned with the
        // where column - 1 line per location") — a relocated device's Where column already lists
        // every location it's recorded at (distinctLocationsOf, course-ordered); this gives the
        // Devices tab's own Bibs column (js/views/mobile-files-devices.js) the matching per-line
        // breakdown instead of just the combined whole-file bibsVisible total above, so an
        // operator can tell at a glance how many bibs each individual station actually recorded.
        bibsByLocation: locations.map(loc =>
          bibsSegment.filter(b => b.location === loc && hasRealBib(b)).length +
          countedBeaconCount(countSegment.filter(r => r.location === loc))),
        timeVisible: timeSegment.filter(hasRealSplit).length,
        bibsExpected: isBibsExpected(modeStart),
        timeExpected: isTimeExpected(modeStart),
        lastSeen,
        offline: isDeviceOffline(lastSeen),
        bleContact: getBleContact(race.owner, race.raceLabel, device.name),
        lastUpdate: latestEntryTimestamp(device.lines),
        // Reuses the modeStart already resolved above rather than calling latestStartedAt(lines)
        // again — same lookup, no need to redo it.
        startedAt: modeStart ? (modeStart.timestamp ?? modeStart.timestampMillis ?? '') : '',
        incorporationStatus: computeIncorporationStatus(r),
      });
    }
  }
  return rows;
}

// A row's own effective "last activity" instant, as epoch ms — a device row's lastUpdate is the
// phone's own wire format, a progress row's is a plain ISO generatedAt (see flattenAllFiles
// below), so this needs to know which parser applies. Unparseable/missing sorts last (oldest),
// the conservative choice for a list whose whole purpose is surfacing what's safe to delete.
function rowSortMs(row) {
  const t = row.kind === 'progress' ? new Date(row.lastUpdate || '').getTime() : parsePhoneTimestamp(row.lastUpdate);
  return Number.isFinite(t) ? t : -Infinity;
}

// Every device row from flattenDevices(), plus one extra row per race for its progress.json (if
// it has one — see js/progress-sync.js) — for the Mobile Files page's "All Files" tab
// (js/views/mobile-files-all.js), the one place both kinds of server-side file are
// browsable/deletable together. `device.name` on a progress row is deliberately the literal
// string 'progress' — that's what makes deleteRow() (js/views/mobile-files.js) resolve to the
// right file via the ordinary device-delete API (mobileDeviceFilePath and progressFilePath build
// the identical path for that name — see server/mobile.js), no new server route needed.
//
// Sorted newest-first by each row's own last-activity date (not race date — two files under the
// same race can easily have very different ages, and this tab's whole purpose is surfacing the
// genuinely neglected ones regardless of which race they're filed under). Ties (including two
// unparseable dates) break by race label then file name, so the order is stable/deterministic
// rather than depending on the server's own directory-walk order. This order is what "Delete
// from here" (js/views/mobile-files.js) means by "below" — everything later in this same array.
export function flattenAllFiles(races) {
  const rows = flattenDevices(races).map(r => ({ ...r, kind: 'device' }));
  for (const race of races) {
    if (!race.progress) continue;
    rows.push({
      kind: 'progress',
      owner: race.owner,
      raceLabel: race.raceLabel,
      raceDate: race.raceDate,
      device: { name: 'progress' },
      progress: race.progress,
      bibsVisible: race.progress.entries.length,
      lastUpdate: race.progress.generatedAt,
    });
  }
  rows.sort((a, b) =>
    rowSortMs(b) - rowSortMs(a) || a.raceLabel.localeCompare(b.raceLabel) || a.device.name.localeCompare(b.device.name));
  rows.forEach((r, i) => { r.idx = i; });
  return rows;
}
