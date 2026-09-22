'use strict';

// Devices tab — pure data logic: segment-view derivation and the device-list building it feeds.
// No DOM at all (not even a call to js/ui.js's renderTable) — js/views/mobile-files-devices.js
// is the thin rendering layer on top of this that actually puts these rows on screen.

import { escHtml } from './utils.js';
import {
  byLineNumber, computeIncorporationStatus, getBleLastSeen, laterIso, latestLineTimestamp, parsePhoneTimestamp,
} from './mobile-files-shared.js';

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
// racemaster-mobile's HistoryFold.visits. Rows before the first real Location marker (there
// normally are none — every real device file's very first row for a family is always its own
// Location marker, see RaceRepository.recordModeStart — but older/degraded data, or a test
// fixture, might have none at all) are bucketed into an implicit visit of their own
// (locationLineNumber: 0, note: null) rather than dropped outright, so a file with no Location
// markers at all still shows everything, exactly as before this location-grouping existed. A
// bare `{action:'Reset'}` with no refLineNumber (the pre-this-feature convention) can never
// target lineNumber 0, so it can't close this implicit visit either — same "no boundary marker
// recognized, show everything" degradation.
function locationVisits(rows) {
  const result = [];
  let current = null;
  for (const r of rows) {
    if (r.action === 'Location') {
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
  // hasRealBib/hasRealSplit/isTimeFamilyRow already separately keep them out of visible COUNTS
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
function isBibsExpected(modeStart) {
  return modeStart?.note === 'Bibs' || modeStart?.note === 'CP';
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
// (its own `note` — 'Time'/'Bibs'/'CP', see SyncRecord's own doc — read directly by
// js/views/mobile-files-devices.js's showDeviceModal() for its own "Mode:" summary line).
export function latestModeStart(timeSegment, bibsSegment) {
  const candidates = [...timeSegment, ...bibsSegment].filter(r => r.action === 'ModeStart');
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
// which family it belongs to (a real Time row always has one, a real Bibs/CP row never does) —
// unchanged. A ModeStart row's own splitTime is always null now regardless of mode (see
// SyncRecord's own doc), so its placement instead reads its own explicit mode declaration.
// 'Location'/'Reset'/'NewRace' are NOT handled here any more (see rowIsTimeFamily's own doc for
// why they need context this per-row function doesn't have) — every other action is still
// classified purely from its own fields.
function isTimeFamilyRow(r) {
  if (r.action === 'ModeStart') return r.note === 'Time';
  return r.splitTime != null;
}

// A 'Location'/'Reset'/'NewRace' row's own splitTime is now always null regardless of family
// (racemaster-mobile's SyncRecordMapping.toSyncRecord: a boundary marker is never a real timed
// split, same treatment as ModeStart/Ping) — so unlike every other shared-action row, none of
// these three can be told apart from a Bibs/CP one by splitTime alone any more. Each is resolved
// from its own structural neighbour instead, walking toward whichever Location row anchors that
// segment, then reading that Location's own next-row ModeStart the same way isTimeFamilyRow
// already reads a ModeStart row's note directly:
//  - 'Location': the very next row by lineNumber is always that Location's own ModeStart, in the
//    same write transaction (racemaster-mobile's RaceRepository.recordModeStart writes the pair
//    back to back).
//  - 'Reset': its own refLineNumber always names the Location row of the segment it's closing
//    (racemaster-mobile's RaceRepository.closeCurrentSegment) — resolved via `byLineNumber`,
//    then the same rule as above.
//  - 'NewRace': always immediately followed by that race's own very first Location row, in the
//    same write transaction (racemaster-mobile's RaceRepository.recordModeStart's own NEW_RACE
//    branch) — resolved the same way, one hop further out.
// Falls back to "not Time" (grouped with Bibs/CP, matching isTimeFamilyRow's own default) if the
// expected neighbour is missing — shouldn't happen on real data, but degrades harmlessly rather
// than throwing.
function rowIsTimeFamily(r, index, sortedRows, byLineNumber) {
  if (r.action === 'Location') {
    const next = sortedRows[index + 1];
    return next?.action === 'ModeStart' && next.note === 'Time';
  }
  if (r.action === 'Reset' && r.refLineNumber != null) {
    const target = byLineNumber.get(r.refLineNumber);
    return target?.action === 'Location' && rowIsTimeFamily(target, sortedRows.indexOf(target), sortedRows, byLineNumber);
  }
  if (r.action === 'NewRace') {
    const next = sortedRows[index + 1];
    return next?.action === 'Location' && rowIsTimeFamily(next, index + 1, sortedRows, byLineNumber);
  }
  return isTimeFamilyRow(r);
}

export function buildSegmentView(lines) {
  const sorted = [...lines].sort(byLineNumber);
  const byLineNum = new Map(sorted.map(r => [r.lineNumber, r]));
  const timeRows = [];
  const bibsRows = [];
  sorted.forEach((r, i) => {
    (rowIsTimeFamily(r, i, sorted, byLineNum) ? timeRows : bibsRows).push(r);
  });
  return {
    timeSegment: currentSegment(timeRows).sort(byLineNumber),
    bibsSegment: currentSegment(bibsRows).sort(byLineNumber),
  };
}

// "yyyy/MM/dd HH:mm:ss" (the phone's own local time) → just the "HH:mm:ss" part. Field was
// renamed server-side from timestampMillis to timestamp (see server.js's coerce()) — files
// written before that rename are still on disk under the old name, so read whichever is present.
// Exported: js/views/mobile-files-devices.js's showDeviceModal() uses this directly.
export function whenOf(r) {
  return ((r.timestamp ?? r.timestampMillis) || '').split(' ')[1] || '';
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
  const { timeSegment, bibsSegment } = buildSegmentView(lines);
  const latest = latestModeStart(timeSegment, bibsSegment);
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

// Every location is free text set by the phone operator (RaceMaster Mobile's own
// RaceEntity.location — e.g. "Finish", "1 - Polebank", "Hadden 2", "CP3", "cp 3"). The phone
// app itself enforces that a non-Finish location contains exactly one number, so any location
// with a digit in it is a checkpoint identified by that number — there's no other convention
// to key off since location is otherwise arbitrary free text. Used both by locationSortKey()
// below and by mobile-files-progress.js's own validateAndCompute().
export function resolveLocationKey(location) {
  const loc = (location || '').trim();
  if (/^finish$/i.test(loc)) return { kind: 'finish' };
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
export function flattenDevices(races) {
  const rows = [];
  for (const race of races) {
    const prepared = race.devices.map(rawDevice => {
      const resolvedLines = withResolvedLocations(rawDevice.lines);
      const device = { ...rawDevice, resolvedLines };
      const { timeSegment, bibsSegment } = buildSegmentView(resolvedLines);
      const modeStart = latestModeStart(timeSegment, bibsSegment);
      // No separate folding-in needed any more — modeStart, when it exists at all, is already one
      // of the rows currentSegment() itself returned (see that function's own doc: a ModeStart row
      // is never excluded from its output), so it's already present in timeSegment/bibsSegment.
      // Once every visit's been properly closed (a completely reset device), modeStart is
      // correctly null and `visible` is just the (now empty) segments — Where/Mode/Bibs/Time/
      // Started At all then report blank/unknown together, not some blank and some stale (ToDo.MD:
      // "when a mobile file is completely reset ... that should be blank too").
      const visible = [...timeSegment, ...bibsSegment];
      return {
        device, timeSegment, bibsSegment, modeStart,
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
    for (const { device, timeSegment, bibsSegment, modeStart, rawLocation, location, locations } of prepared) {
      const r = { owner: race.owner, raceLabel: race.raceLabel, device, rawLocation };
      rows.push({
        idx: rows.length,
        ...r,
        raceDate: race.raceDate,
        pending: !!device.pending,
        location,
        locations,
        bibsVisible: bibsSegment.filter(hasRealBib).length,
        timeVisible: timeSegment.filter(hasRealSplit).length,
        bibsExpected: isBibsExpected(modeStart),
        timeExpected: isTimeExpected(modeStart),
        lastSeen: laterIso(device.lastSeen, getBleLastSeen(race.owner, race.raceLabel, device.name)),
        lastUpdate: latestLineTimestamp(device.lines),
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
