'use strict';

// Devices tab — pure data logic: segment-view derivation and the device-list building it feeds.
// No DOM at all (not even a call to js/ui.js's renderTable) — js/views/mobile-files-devices.js
// is the thin rendering layer on top of this that actually puts these rows on screen.

import { escHtml } from './utils.js';
import {
  byLineNumber, computeIncorporationStatus, getBleLastSeen, laterIso, latestLineTimestamp, parsePhoneTimestamp,
} from './mobile-files-shared.js';

// ---- Location resolution (mirrors racemaster-mobile's SyncRecordMapping.withResolvedLocations,
// now generalised to three marker actions instead of one) ----
//
// A device's location is constant except at three boundary-marker rows — 'Setup' (Setup Race),
// 'ModeStart' (a mode being started/reset) and 'Location' (an explicit mid-race relocation) —
// each of which carries the location as of that point in its own `note` field (racemaster-
// mobile's RaceRepository.recordSetupMarker/TimeModeRepository.startStopwatch/BibsModeRepository.
// startBibsMode/CpModeRepository.startCpMode/insertLocationMarkerAndReset). The wire/stored line
// shape no longer carries a `location` field of its own at all (see racemaster-mobile's
// SyncRecord doc) — this walks a device's lines once, in lineNumber order, tracking the most
// recent such marker's `note` as the running "current location", and stamps every row with it.
const LOCATION_MARKER_ACTIONS = new Set(['Setup', 'ModeStart', 'Location']);

export function withResolvedLocations(lines, initialLocation = 'Finish') {
  let current = initialLocation;
  return [...lines].sort(byLineNumber).map(r => {
    if (LOCATION_MARKER_ACTIONS.has(r.action) && r.note) current = r.note;
    return { ...r, location: current };
  });
}

// ---- Segment view (mirrors racemaster-mobile's observeCurrentSegment + foldLatestVisible) ----
//
// A device's file interleaves two independent, separately-numbered families of rows — Time
// splits (splitTime non-null) and Bibs/CP entries (splitTime null, bibNumber instead) — each
// with its own Reset boundary and its own edit-echo/undo-marker history. "Current segment" means
// only the rows since that family's own most recent Reset, folded down to one row per logical
// entry (the latest edit, with anything since-undone dropped) — exactly what the phone's own
// live screen would be showing. See HistoryLineDao.observeCurrentSegment / HistoryFold.
// foldLatestVisible in racemaster-mobile for the reference implementation this mirrors.

function currentSegment(rows) {
  const resetLine = rows.reduce((max, r) => r.action === 'Reset' ? Math.max(max, r.lineNumber ?? 0) : max, 0);
  return rows.filter(r => (r.lineNumber ?? 0) > resetLine);
}

function foldLatestVisible(rows) {
  const latestByRoot = new Map();
  for (const r of rows) {
    const key = r.refLineNumber ?? r.lineNumber;
    const cur = latestByRoot.get(key);
    if (!cur || (r.lineNumber ?? 0) > (cur.lineNumber ?? 0)) latestByRoot.set(key, r);
  }
  return [...latestByRoot.values()].filter(r => r.action !== 'Undo');
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

// A Bibs-family row with no real bib of its own — the family's own ModeStart marker (bibs
// variant: action:'ModeStart' with bibNumber:'n/a' — the mobile app sends 'n/a' rather than null,
// since null is already reserved as the Time-family discriminator — see server/mobile.js's own
// doc) — carries a blank/'n/a' bibNumber, never a real one, and must not inflate the "Bibs"
// visible count as if a bib had actually been recorded. Checked both by action (action:'ModeStart'
// is never a real bib, whatever value it happens to carry) and by value (blank/null/'n/a', for a
// genuinely corrupt row, or an old file predating the ModeStart convention entirely) — either is
// enough on its own to exclude a row here. There's no longer a separate mode-agnostic "Setup"
// record to also account for — ToDo.MD: "drop the 'Setup' record from the device file, its no
// longer created, there will always be a modestart record" — a brand new, not-yet-synced device
// simply has zero lines at all until its first real ModeStart arrives (see flattenDevices() below
// for how that shows up: blank on both counts, same outcome the old Setup record used to
// produce, just without a line of its own to represent it).
function hasRealBib(r) {
  if (r.action === 'ModeStart') return false;
  if (r.bibNumber == null) return false;
  const s = String(r.bibNumber).trim();
  return s !== '' && s.toLowerCase() !== 'n/a';
}

// The Time family's own equivalent ModeStart marker (time variant: action:'ModeStart', splitTime
// either the literal 'n/a' sentinel or a real-looking placeholder value — see this file's own
// latestStartedAt for where the marker itself is read) must not inflate the "Time" visible count
// as if a split had actually been recorded. Same dual action-or-value check as hasRealBib above,
// for the same reason: whichever convention a given marker actually uses, either check alone is
// enough to exclude it. Deliberately still kept IN the segment itself (findStartTimestamp in
// mobile-files-progress.js, and this file's own latestStartedAt, both need it) — only excluded
// from the "Time" visible COUNT, so a Time-mode device with nothing but its own ModeStart marker
// correctly shows a split count of 0 rather than 1.
function hasRealSplit(r) {
  if (r.action === 'ModeStart') return false;
  if (r.splitTime == null) return false;
  const s = String(r.splitTime).trim();
  return s !== '' && s.toLowerCase() !== 'n/a';
}

// Whether Bibs are genuinely expected on this device at all — ANY bibsSegment row with a
// non-null bibNumber, real or the bibs ModeStart marker's own 'n/a' sentinel, asserts it (a
// modestart record with a bib of 'n/a' IS a bibs expectation, per ToDo.MD). An empty bibsSegment
// (nothing recorded on this family at all — including no ModeStart of its own, e.g. a brand new
// device with no lines yet) correctly asserts nothing, now that there's no longer a separate
// "Setup" record whose own bibNumber:null needed excluding as a special case.
//
// `modeStart` (the file's own latest ModeStart record, whole-file — see latestModeStart() below —
// not just the post-Reset segment) covers ToDo.MD's "when a race has been reset in a device file,
// the latest modestart record is still valid wrt the location and mode": a Reset with no fresh
// marker immediately following it (the phone's own convention is to write one right away, but
// this must degrade gracefully rather than assume that always holds) would otherwise empty out
// bibsSegment entirely, wrongly reporting "never expected" for a device that plainly declared its
// own mode moments earlier.
function isBibsExpected(bibsSegment, modeStart) {
  if (modeStart?.bibNumber != null) return true;
  return bibsSegment.some(r => r.bibNumber != null);
}

// Whether Splits are genuinely expected on this device — every timeSegment row already has a
// real (non-null) splitTime by construction (see buildSegmentView's own splitTime!=null filter),
// so any row at all here — the ModeStart marker included — already satisfies ToDo.MD's "a
// modestart record with a blank bib and a non-blank split time is a splits expectation".
// `modeStart` — see isBibsExpected's own doc just above — covers the same "still valid across a
// markerless Reset" case for the Time family.
function isTimeExpected(timeSegment, modeStart) {
  if (modeStart?.splitTime != null) return true;
  return timeSegment.length > 0;
}

// The device's (or, once split by location, this location-group's) own latest ModeStart record,
// full stop — whole-file, deliberately ignoring Reset boundaries entirely (a Reset always
// immediately records a fresh ModeStart for the new segment in the common case — see
// racemaster-mobile's own Help text — but ToDo.MD's own "the latest modestart record is still
// valid wrt the location and mode" means this must keep working even when that doesn't happen).
// Returns the record itself (not just its timestamp — contrast latestStartedAt() below, which is
// this same lookup for just that one field), so callers can also read its own bibNumber/splitTime
// (isBibsExpected/isTimeExpected above) or location (flattenDevices below).
function latestModeStart(lines) {
  const candidates = lines.filter(r => r.action === 'ModeStart');
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.lineNumber ?? 0) > (a.lineNumber ?? 0) ? b : a);
}

// A Reset or an Undo on the phone is already fully reflected here — currentSegment() drops
// everything at/before the family's last Reset, and foldLatestVisible() drops anything whose
// latest state is an Undo marker. Compute Results (mobile-files-progress.js) exploits this:
// since the segment is always the true, current picture, syncing to Finishers never needs to
// diff against or patch around what's already there — it just wipes Finishers and rebuilds from
// the segment. Exported: mobile-files-progress.js's own validateAndCompute() resolves each
// selected file's segment the same way js/views/mobile-files-devices.js's showDeviceModal() does.
export function buildSegmentView(lines) {
  const timeRows = lines.filter(r => r.splitTime != null);
  const bibsRows = lines.filter(r => r.splitTime == null);
  return {
    timeSegment: foldLatestVisible(currentSegment(timeRows)).sort(byLineNumber),
    bibsSegment: foldLatestVisible(currentSegment(bibsRows)).sort(byLineNumber),
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
// "Most recent" (highest lineNumber across the whole file), not the current segment's own marker:
// a Reset always immediately records a fresh ModeStart for the new segment (see racemaster-
// mobile's own Help text), so this gives the same answer either way without needing this file's
// own segment-boundary logic at all — simpler, and correct even for a file this segment logic
// can't yet resolve for some other reason.
//
// Returns the raw "yyyy/mm/dd HH:MM:SS" timestamp (same shape latestLineTimestamp() above
// returns for Last Update, formatted the same way via formatStoredTimestamp() at render time —
// js/views/mobile-files-devices.js) from whichever qualifying record is latest, or '' if the
// device has no such record at all (nothing pulled yet, or an old file predating this marker
// convention).
export function latestStartedAt(lines) {
  const latest = latestModeStart(lines);
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
// handlers use `locations` to decide whether to prompt before narrowing `device.lines` down to
// one location's own rows (each row's own `.location` — resolved here, once, via
// withResolvedLocations(), since the wire/stored shape no longer carries the field itself — says
// which station it belongs to, so no further client-side segment-boundary reconstruction is
// needed downstream).
export function flattenDevices(races) {
  const rows = [];
  for (const race of races) {
    const prepared = race.devices.map(rawDevice => {
      const device = { ...rawDevice, lines: withResolvedLocations(rawDevice.lines) };
      const { timeSegment, bibsSegment } = buildSegmentView(device.lines);
      const modeStart = latestModeStart(device.lines);
      // modeStart folded in alongside the post-Reset segment — not just as an isBibsExpected/
      // isTimeExpected fallback (see their own doc), but here too: a Reset with no fresh marker
      // immediately following it would otherwise leave both segments empty, wrongly showing this
      // row's own Where column as blank ("—") even though the last ModeStart record still knows
      // exactly where this device is (ToDo.MD: "the latest modestart record is still valid wrt
      // the location and mode").
      const visible = modeStart ? [...timeSegment, ...bibsSegment, modeStart] : [...timeSegment, ...bibsSegment];
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
        bibsExpected: isBibsExpected(bibsSegment, modeStart),
        timeExpected: isTimeExpected(timeSegment, modeStart),
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
