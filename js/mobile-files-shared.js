'use strict';

// Pure data/storage helpers shared across the Mobile Files feature's own split-out modules —
// both the pure-logic ones (mobile-files-devices.js, mobile-files-progress.js) and the view
// layer that renders them (js/views/mobile-files*.js). No DOM rendering, and deliberately no
// dependency on any of those other modules, so this stays a true leaf every one of them can
// safely import from without any risk of a circular import.

import { getSession } from './storage.js';
import { getRaceStaleAfterDays, raceLabelAgeDays, sanitiseName } from './mule-ble.js';

// Ticked checkboxes, keyed by identity rather than row index — row indices are reassigned on
// every render (races/devices can appear in a different order once sorted), so persisting
// selection across a re-render (or navigating away from Mobile Files and back) needs a stable
// key instead.
export const selectedKeys = new Set();
// device.name alone already uniquely identifies a row: one device file is always exactly one
// row (js/mobile-files-devices.js's own flattenDevices()), even once a marshal relocates
// mid-race — that stays the same file, same device, just a new HistoryAction.LOCATION marker
// inside it, not a second file. So two rows never share an owner/raceLabel/device.name triple,
// and no location component is needed in the key at all.
export function rowKey(r) {
  return `${r.owner} ${r.raceLabel} ${r.device.name}`;
}

// The connected dataset's own identity — owner/fullName, exactly what the server itself uses
// to address it (see storage.js's own use of session.dataset) — for guarding persisted
// selection/auto-progress state below against a dataset switch. Deliberately NOT event
// name+date: that's only a heuristic, and a real collision is easy to hit in practice — a Copy
// of a dataset, or two genuinely unrelated ones, sharing the exact same event name and date
// while holding completely different entries/mobile files. Standalone (no session) has no
// dataset identity of its own, but there's only ever one standalone dataset per browser, so a
// constant stands in for it.
export function currentDatasetContext() {
  return getSession()?.dataset || 'standalone';
}

// Persisted (unlike selectedKeys' own in-memory Set, which this only ever seeds/mirrors) so
// the Results & Prize List page's autoUpdateProgress() (see mobile-files-progress.js) can find
// "what was last ticked here" even after a page reload, with the dataset identity stored
// alongside so a later dataset switch doesn't get an old dataset's selection silently replayed
// against a new one.
const SELECTED_KEYS_STORAGE_KEY = 'racemaster-mobile-selected-keys';

export function loadSelectedKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTED_KEYS_STORAGE_KEY) || 'null');
    return parsed && Array.isArray(parsed.keys) ? parsed : null;
  } catch { return null; }
}
export function saveSelectedKeys() {
  try {
    localStorage.setItem(SELECTED_KEYS_STORAGE_KEY, JSON.stringify({
      context: currentDatasetContext(), keys: [...selectedKeys],
    }));
  } catch { /* storage unavailable/full — best effort only, same as other persisted state here */ }
}

// selectedKeys itself is only ever in-memory — a real page reload (F5, not just navigating
// within the app) starts it as an empty Set with nothing to repopulate it, even though the
// persisted copy above (and anything gated behind it, e.g. #mf-auto-progress — see
// mobile-files-progress.js) survives fine. Previously the only place that ever read the
// persisted copy back in was autoUpdateProgress()'s own inline restore, which only runs when
// the Results page is opened — landing straight on Mobile Files after a reload left the ticked
// checkboxes empty (and #mf-auto-progress, watching an empty selection, with nothing to do)
// until the operator either re-ticked them by hand or happened to visit Results first. Called
// from renderMobileFiles() (see js/views/mobile-files.js) so it also covers that path — safe to
// call more than once (autoUpdateProgress() still does its own restore too, for its own reasons
// — see its doc), every call after the first for a given page load is a no-op.
let selectionRestoredForSession = false;
export function restoreSelectedKeysOnce() {
  if (selectionRestoredForSession) return;
  selectionRestoredForSession = true;
  const persisted = loadSelectedKeys();
  if (!persisted || persisted.context !== currentDatasetContext()) return;
  selectedKeys.clear();
  for (const k of persisted.keys) selectedKeys.add(k);
}

// ---- "New since last Compute Results" tracking ----
//
// Every line in a device's file — a new bib/split, an edit-echo, an Undo marker, a Reset marker —
// gets a brand new, permanent, never-reused lineNumber (see racemaster-mobile's own
// RaceEntity.nextLineNumber). So "has anything changed since the last Compute Results run for
// this device" reduces to one number: the highest lineNumber present now, compared against
// whatever it was the last time this device was included in a run. Persisted (not just in
// memory) so the red/green marker survives a page reload the same way selection itself doesn't
// need to — this genuinely needs to.
const LAST_SYNCED_KEY = 'racemaster-mobile-last-synced';

export function loadLastSynced() {
  try { return JSON.parse(localStorage.getItem(LAST_SYNCED_KEY) || '{}'); } catch { return {}; }
}
export function saveLastSynced(map) {
  try { localStorage.setItem(LAST_SYNCED_KEY, JSON.stringify(map)); } catch { /* storage unavailable/full — best effort only */ }
}
export function getLastSyncedLineNumber(r) {
  return loadLastSynced()[rowKey(r)] || 0;
}
export function setLastSyncedLineNumber(r) {
  const map = loadLastSynced();
  map[rowKey(r)] = maxLineNumber(r.device.lines);
  saveLastSynced(map);
}
export function maxLineNumber(lines) {
  return lines.reduce((max, l) => Math.max(max, l.lineNumber ?? 0), 0);
}

// ---- Bluetooth contact (the Devices tab's own Bluetooth column) ----
//
// When this browser last pulled each device over Bluetooth, and how — straight from the phone
// ('direct') or relayed through the connected mule (its name). Feedback that the Bluetooth link
// is working, deliberately kept apart from Last Seen (the phone's own newest line — see
// latestLineIso): a mule can keep relaying a phone that no longer exists, which proves the link
// to the mule, not that the phone is alive. Persisted so it survives a reload; keyed like rowKey().
const BLE_CONTACT_KEY = 'racemaster-mobile-ble-contact';

function loadBleContacts() {
  try { return JSON.parse(localStorage.getItem(BLE_CONTACT_KEY) || '{}'); } catch { return {}; }
}
export function recordBleContact(owner, raceLabel, deviceName, via) {
  const map = loadBleContacts();
  map[`${owner} ${raceLabel} ${deviceName}`] = { at: new Date().toISOString(), via: via || 'direct' };
  try { localStorage.setItem(BLE_CONTACT_KEY, JSON.stringify(map)); } catch { /* best effort only */ }
}
// { at: ISO, via: 'direct' | '<mule name>' } or null if never pulled over Bluetooth.
export function getBleContact(owner, raceLabel, deviceName) {
  return loadBleContacts()[`${owner} ${raceLabel} ${deviceName}`] || null;
}

export function formatRaceDate(raceDate) {
  if (!raceDate) return '<span style="color:var(--muted)">Unknown</span>';
  return `${raceDate.dd}/${raceDate.mm}/${raceDate.yy}`;
}

// ISO string (device.lastSeen — either a server file mtime or a pending file's local pulledAt,
// see mobile-files-devices.js's flattenDevices() — or progress.json's own generatedAt) →
// "dd/mm/yy HH:MM" local time, matching formatRaceDate()'s own dd/mm/yy convention elsewhere on
// this page. `seconds: true` appends ":SS" — off by default (Last Seen has no use for that
// precision), on for a progress row's own Last Update column on the All Files tab.
export function formatDateTime(iso, { seconds = false } = {}) {
  if (!iso) return '<span style="color:var(--muted)">—</span>';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '<span style="color:var(--muted)">—</span>';
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}` + (seconds ? `:${pad(d.getSeconds())}` : '');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${time}`;
}

// device.lastUpdate (see mobile-files-devices.js's latestLineTimestamp()) is the phone's own
// "yyyy/mm/dd HH:MM:SS" stamp (formatTimestamp() in mule-ble.js) — reformatted to the same
// "dd/mm/yy HH:MM" shape as formatDateTime() above via plain string surgery, not Date parsing,
// since that separator ("/" for both date and, on some engines' toString, ambiguously for time
// too) isn't reliably cross-browser-parseable back into a Date.
export function formatStoredTimestamp(ts) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/.exec(ts || '');
  if (!m) return '<span style="color:var(--muted)">—</span>';
  const [, yyyy, mm, dd, HH, MM] = m;
  return `${dd}/${mm}/${yyyy.slice(-2)} ${HH}:${MM}`;
}

// Latest of a device's own record timestamps ("yyyy/mm/dd HH:MM:SS", zero-padded so it sorts
// correctly as a plain string) — across *all* lines, not just the currently-visible segment, so
// this still reflects real recency after a Reset. Distinct from device.lastSeen (see above):
// this is when the newest split/entry actually happened on the phone, not when the server (or
// this browser, for a pending file) last heard from it.
// [filter] narrows which lines count — see latestEntryTimestamp below.
export function latestLineTimestamp(lines, filter = () => true) {
  let max = null;
  for (const l of lines) {
    if (!filter(l)) continue;
    const ts = l.timestamp ?? l.timestampMillis;
    if (ts && (!max || ts > max)) max = ts;
  }
  return max;
}

// Last Update: the newest genuine entry — a Ping heartbeat proves the phone is alive, it isn't
// an update (it still counts towards Last Seen — see latestLineIso).
export function latestEntryTimestamp(lines) {
  return latestLineTimestamp(lines, l => l.action !== 'Ping');
}

// Last Seen: the newest line of any kind in the device's own history, as an ISO instant (null if
// none). Taken from the phone's own record timestamps — kept current by its Ping heartbeat —
// never from when the server file was last written or when this browser last pulled it: a mule
// relaying a phone that no longer exists still rewrites/re-delivers its file, which made a
// long-gone phone read as seen "now".
export function latestLineIso(lines) {
  const t = parsePhoneTimestamp(latestLineTimestamp(lines));
  return t == null ? null : new Date(t).toISOString();
}

// Mirrors server.js's parseRaceLabelDate/sort exactly — needed client-side because a
// Bluetooth-pulled, not-yet-pushed file has no server entry to derive/sort a race date from.
// raceLabel ends "…-YY-MM-DD" (2-digit year first, e.g. "-26-08-04" = 4 August 2026 — confirmed
// against real racemaster-mobile-generated labels), not "dd-mm-yy" as an earlier version of this
// comment claimed — that mislabeling had the date-sort comparator below effectively sorting by
// day-of-month first, which only looked right by accident whenever every race fell in one month.
export function parseRaceLabelDate(raceLabel) {
  const m = /-(\d{2})-(\d{2})-(\d{2})$/.exec(raceLabel || '');
  return m ? { yy: m[1], mm: m[2], dd: m[3] } : null;
}

// The trailing "-DD-MM-YY" is just the date suffix baked into every raceLabel (see
// parseRaceLabelDate above) — stripped off so two races sharing the same date sort by their
// actual name, not by a string that already differs in the very date component being grouped on.
export function raceNameOf(raceLabel) {
  return (raceLabel || '').replace(/-\d{2}-\d{2}-\d{2}$/, '');
}

// The race's own server folder label: "<name>[-<course>]-<yy>-<mm>-<dd>", the same date-suffixed
// convention racemaster-mobile uses for a phone's own initial arbitrary label (e.g.
// "unknown-26-09-23" — its SetupRaceScreen default). Phones don't need to type this exactly:
// they either pick it from Setup Race's server scan (which lists these folders' progress.json)
// or are adopted into it (js/mobile-files-adoption.js). state.event.date is dd/mm/yyyy, so day
// and year swap position here — 2-digit year FIRST, matching parseRaceLabelDate/raceNameOf above
// and mule-ble.js's raceLabelAgeDays. `course`, when given, is inserted before the date: one
// web-app event covers Seniors AND Juniors at once (js/constants.js's COURSE), so a caller that
// needs an actual per-course folder (progress-sync.js's push, the BLE delivery/adoption legs)
// derives one label per course. '' until the event has both a name and a date.
export function deriveRaceLabel(event, course) {
  const [dd, mm, yyyy] = (event.date || '').split('/');
  if (!event.name || !dd || !mm || !yyyy) return '';
  const name = sanitiseName(event.name) || 'race';
  const date = `${yyyy.slice(-2)}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  return course ? `${name}-${sanitiseName(course)}-${date}` : `${name}-${date}`;
}

// Newest date first, then race name, matching how an organiser actually thinks about a list
// spanning several events — "today's race" first, and same-day races (e.g. a multi-course
// event) grouped together in a stable, readable order rather than whatever order the server
// happened to return them in.
export function sortRaces(races) {
  return [...races].sort((a, b) => {
    if (a.raceDate && b.raceDate) {
      const dateCmp = b.raceDate.yy !== a.raceDate.yy ? b.raceDate.yy.localeCompare(a.raceDate.yy)
        : b.raceDate.mm !== a.raceDate.mm ? b.raceDate.mm.localeCompare(a.raceDate.mm)
        : b.raceDate.dd.localeCompare(a.raceDate.dd);
      if (dateCmp !== 0) return dateCmp;
    } else if (a.raceDate) {
      return -1;
    } else if (b.raceDate) {
      return 1;
    }
    return raceNameOf(a.raceLabel).localeCompare(raceNameOf(b.raceLabel));
  });
}

// Folds this browser's not-yet-pushed Bluetooth pulls into the server's own race list, so a
// pending file shows up in exactly the same place it will once it's actually pushed — same
// race grouping, same date-sort position. p.lines is only ever the *delta* since this device's
// own last successful BLE pull (see mule-ble.js's delta-sync), never the whole file — so a
// pending device's lines are merged into whatever the server already knows about that same
// device (deduping by lineNumber, same convention as storage.js's own savePendingMobileFile),
// not used to replace it outright. Replacing outright used to be correct back when a pull always
// returned everything, but doing that now would make the server's already-known lines vanish
// the moment a single new delta line arrives while offline.
export function mergePendingIntoRaces(races, pending) {
  const merged = races.map(race => ({ ...race, devices: [...race.devices] }));
  for (const p of pending) {
    let race = merged.find(r => r.owner === p.owner && r.raceLabel === p.raceLabel);
    if (!race) {
      race = { owner: p.owner, raceLabel: p.raceLabel, raceDate: parseRaceLabelDate(p.raceLabel), devices: [] };
      merged.push(race);
    }
    const known = race.devices.find(d => d.name === p.deviceName);
    // A NewRace marker in the pending entry's own lines (see storage.js's savePendingMobileFile
    // — it's already been wiped-and-replaced there, so p.lines is the new race's own fresh,
    // correct content) means whatever the server has reported for this device is from a
    // different, since-superseded race that reused the same label — the server hasn't applied
    // its own wipe yet (this push hasn't landed), so merging with it here would resurrect the
    // very staleness this whole mechanism exists to prevent, e.g. the old race's lineNumber 1
    // masking the new race's own NewRace marker at the same number. Use the pending entry's own
    // lines alone in that case; the server's copy is superseded the moment the real push lands.
    const startingFresh = p.lines.some(l => l?.action === 'NewRace');
    const knownLines = (known && !startingFresh) ? known.lines : [];
    const seenLineNumbers = new Set(knownLines.map(l => l.lineNumber).filter(n => Number.isFinite(n)));
    const lines = [...knownLines, ...p.lines.filter(l => Number.isFinite(l.lineNumber) && !seenLineNumbers.has(l.lineNumber))];
    race.devices = race.devices.filter(d => d.name !== p.deviceName);
    // Deleted on the phone (a lone tombstone NewRace — see isTombstonedLines): pushed on to the
    // server like any other pull, but never shown.
    if (!isTombstonedLines(lines)) {
      race.devices.push({ name: p.deviceName, deviceId: p.deviceId, lines, pending: true, lastSeen: p.pulledAt });
    }
  }
  return sortRaces(merged);
}

// A device file whose current generation opens with a NewRace noted "Deleted" — the race was
// deleted on the phone (racemaster-mobile's RaceRepository.requestDeleteRace). The server hides
// these from its own listings (server/mobile.js's isTombstoned); this is the same check for a
// Bluetooth-pulled copy not yet pushed.
export function isTombstonedLines(lines) {
  let latest = null;
  for (const l of lines) {
    if (l?.action === 'NewRace' && Number.isFinite(l.lineNumber) && (!latest || l.lineNumber > latest.lineNumber)) latest = l;
  }
  return latest?.note === 'Deleted';
}

// Sorts by the file's own lineNumber — the one field every row has and that's never ambiguous.
// splitNumber can't be used for this: it's null for rows with no real split (Clock, DNF — see
// NO_SPLIT_ACTIONS in finishers.js), and `?? 0` would collide those with each other and with any
// genuine split 0, scrambling their order. That matters beyond just DNF: multiple Clock lines are
// legitimate (a later one is a clock reset — not yet implemented mobile-side, but the ordering
// must already be right for when it is), and only lineNumber order preserves which came first.
// Shared between mobile-files-devices.js's own segment-fold logic and
// mobile-files-progress.js's expectedFinisherEntries()/computeCpTimes(), so it lives here rather
// than in either of those two.
export function byLineNumber(a, b) { return (a.lineNumber ?? 0) - (b.lineNumber ?? 0); }

// Deliberately has nothing to do with Finishers' own content — comparing against it line by line
// kept breaking on one edge case after another (corrections, retirees, Clock notes, Undo, Reset…).
// All that actually matters to the operator is "has this file changed since I last ran Compute
// Results on it" — answered purely from the file's own lineNumbers (see the tracking block
// above). Only meaningful for a currently-selected file; an unselected one is always left
// uncoloured, since it's not what a Compute Results click would even touch right now. Shared
// between mobile-files-devices.js's own list rendering (flattenDevices()) and
// mobile-files-progress.js's own auto-update check, so it lives here rather than in either.
export function computeIncorporationStatus(r) {
  if (!selectedKeys.has(rowKey(r))) return 'none';
  return maxLineNumber(r.device.lines) > getLastSyncedLineNumber(r) ? 'outstanding' : 'incorporated';
}

// ---- Background server poll (ToDo.MD line 42's server-side half) ----

// How often the web app asks the server whether anything's new (js/views/mobile-files.js's own
// background poll) while Auto-update progress is ticked — same persistence shape as
// getRaceStaleAfterDays/setRaceStaleAfterDays (mule-ble.js): plain localStorage, no JSON
// wrapper, clamped/defaulted only in the getter. Floored at 5s rather than 1s like stale-days'
// own floor — this drives a real HTTP round trip every tick (see GET /api/mobile/status,
// server/routes/mobile.js), not just a local decision, so it's worth a slightly higher floor to
// discourage setting it low enough to needlessly hammer the server.
const SERVER_POLL_INTERVAL_KEY = 'racemaster-mobile-server-poll-seconds';
const DEFAULT_SERVER_POLL_INTERVAL_SECONDS = 30;

export function getServerPollIntervalSeconds() {
  const n = parseInt(localStorage.getItem(SERVER_POLL_INTERVAL_KEY), 10);
  return Number.isFinite(n) && n >= 5 ? n : DEFAULT_SERVER_POLL_INTERVAL_SECONDS;
}
export function setServerPollIntervalSeconds(seconds) {
  try { localStorage.setItem(SERVER_POLL_INTERVAL_KEY, String(seconds)); } catch { /* storage unavailable — best effort only */ }
}

// Compares a GET /api/mobile/status response (device name -> {mtime, size}, no `lines` — see
// server/mobile.js's own getMobileRacesStatusForUser) against what's already cached from the
// last full fetch (races' own device.lastSeen — the exact same file mtime the status endpoint
// reports as `mtime`, both ultimately one fs.statSync server-side) to decide whether the full
// GET /api/mobile fetch is actually worth making. No separate client-side cache needed —
// lastKnownRaces (js/views/mobile-files.js) already carries everything required. Any
// difference at all — a new/removed device or race, or a changed mtime — counts as "something's
// new"; an identical listing (the overwhelmingly common case for a quiet poll tick) is detected
// without transferring a single line of actual data.
export function hasNewMobileData(status, lastKnownRaces) {
  const key = (owner, raceLabel, deviceName) => `${owner} ${raceLabel} ${deviceName}`;
  const known = new Map();
  for (const race of lastKnownRaces) {
    for (const device of race.devices) known.set(key(race.owner, race.raceLabel, device.name), device.lastSeen);
  }
  const current = new Map();
  for (const race of status) {
    for (const device of race.devices) current.set(key(race.owner, race.raceLabel, device.name), device.mtime);
  }
  if (known.size !== current.size) return true;
  for (const [k, mtime] of current) {
    if (known.get(k) !== mtime) return true;
  }
  return false;
}

// Shared "is this race label old enough for staleness to even be a question" gate — a young or
// unparseable label always means "not stale", regardless of any device/file's own activity.
function isRaceLabelOld(raceLabel, staleAfterDays) {
  const ageDays = raceLabelAgeDays(raceLabel);
  return ageDays !== null && ageDays >= staleAfterDays;
}

// "yyyy/mm/dd HH:MM:SS" (a device line's own timestamp) → epoch ms, or null if unparseable.
// Exported for js/mobile-files-devices.js's own flattenAllFiles(), which needs a real epoch
// value (not just a threshold check) to sort All Files tab rows by date across both device and
// progress rows, whose own timestamps come in two different wire formats.
export function parsePhoneTimestamp(ts) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ts || '');
  if (!m) return null;
  const [, yyyy, mm, dd, HH, MM, SS] = m;
  const t = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS)).getTime();
  return isNaN(t) ? null : t;
}

function deviceHasRecentActivity(lines, staleAfterDays) {
  const t = parsePhoneTimestamp(latestLineTimestamp(lines || []));
  if (t == null) return false;
  return (Date.now() - t) / (24 * 60 * 60 * 1000) < staleAfterDays;
}

// progress.json's own generatedAt is a plain ISO string (server-stamped — see
// server/routes/mobile.js's progress POST handler), a different wire format from a device
// line's "yyyy/mm/dd HH:mm:ss", so it needs its own (simpler) recency check.
function isoWithinDays(iso, staleAfterDays) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  return (Date.now() - t) / (24 * 60 * 60 * 1000) < staleAfterDays;
}

// Hides a race whose label is older than getRaceStaleAfterDays() from the whole Mobile Files
// page — extending that option (previously BLE-pull-only, see js/mule-ble.js's own
// isRaceLabelStale) to races fetched from the server too. Carries the exact same safety
// exemption as the BLE version and for the same reason (see isRaceLabelStale's own doc — a
// multi-day event's label is set once on day one and never changes while the race keeps
// recording for days after; date alone would otherwise start hiding a still-running event's own
// data mid-race): a race stays visible if *any* of its devices has a line timestamped within
// the staleness window, even with an old label. There's no BLE-style "already pulled" cursor to
// compare against here — server data is already in hand once fetched, so recency is judged
// directly from the data itself via latestLineTimestamp() rather than a delta-sync cursor.
export function filterStaleRaces(races) {
  const staleAfterDays = getRaceStaleAfterDays();
  return races.filter(race => {
    if (!isRaceLabelOld(race.raceLabel, staleAfterDays)) return true;
    return race.devices.some(device => deviceHasRecentActivity(device.lines, staleAfterDays));
  });
}

// Per-file (not race-level) staleness, for *highlighting* (not hiding) a row on the Mobile Files
// page's "All Files" tab (js/views/mobile-files-all.js) — deliberately narrower than
// filterStaleRaces' own "keep the race if ANY device is recent" rule above. That rule protects a
// still-running multi-day event's whole race from disappearing; this exists specifically so an
// individually-abandoned file can still be flagged for review/deletion even inside an otherwise-
// active race (e.g. last year's watch nobody wiped, sitting next to this year's live phones under
// a similarly-old label) — the two are intentionally allowed to disagree, not accidentally so.
export function isDeviceStale(raceLabel, device) {
  const staleAfterDays = getRaceStaleAfterDays();
  if (!isRaceLabelOld(raceLabel, staleAfterDays)) return false;
  return !deviceHasRecentActivity(device.lines, staleAfterDays);
}

// Same idea as isDeviceStale() above, for a race's progress.json — judged by its own generatedAt
// rather than a device's recorded lines.
export function isProgressStale(raceLabel, progress) {
  const staleAfterDays = getRaceStaleAfterDays();
  if (!isRaceLabelOld(raceLabel, staleAfterDays)) return false;
  return !isoWithinDays(progress?.generatedAt, staleAfterDays);
}

// A genuinely different question from isProgressStale() above: that one only ever *flags* a row
// that already exists in a list, and treats a race whose own label isn't old yet as automatically
// "not stale" even with no progress.json at all — the right behavior for a "should this already-
// listed row be highlighted" check, wrong for "does this course actually have a live progress.json
// right now". This is existence AND recency together — used by Mobile Files' own Activate Race
// status (js/views/mobile-files.js), which needs "no progress.json at all" to read the same as "a
// stale one", not silently pass as fine just because the race label itself is recent.
export function isProgressRecent(progress) {
  return isoWithinDays(progress?.generatedAt, getRaceStaleAfterDays());
}

// The cached progress payload (already fetched via GET /api/mobile — see race.progress in
// server/mobile.js's getMobileRacesForUser) for whatever race [owner]/[raceLabel] currently is —
// used by js/views/mobile-files-ble.js to decide what (if anything) to deliver to a connected
// phone over BLE, without a second server round trip just for that. null when not found (races
// not yet fetched, or no match).
export function findCurrentRaceProgress(races, owner, raceLabel) {
  return races.find(r => r.owner === owner && r.raceLabel === raceLabel)?.progress ?? null;
}

// ---- Locally-persisted progress cache (survives a reload while offline) ----
//
// js/views/mobile-files.js's own `lastKnownRaces` already gives every tab a same-session
// fallback once a server fetch has failed — but it's a plain in-memory variable, so it starts
// empty again on a genuine page reload (closing/reopening the app, or a real crash) with no
// route back to what was last known. That's fine for the Devices tab (its own offline story is
// Bluetooth, not a stale copy of what the server had — see mergePendingIntoRaces above) and for
// Update Progress (validateAndCompute() is pure local computation over already-loaded/pulled
// data, no server round trip at all) — but the All Files tab's own progress.json row, and
// mule-ble.js's own progress-delivery-to-a-connected-phone leg (currentRaceProgressContext(),
// which reads exactly this same races array), have no other source for "what progress.json did
// we last know about" once genuinely offline since before the page loaded. This is that source:
// a small, dataset-scoped localStorage cache of just the progress-bearing races (never device
// lines — those would go stale immediately and Bluetooth is the real source of truth for them),
// written on every successful fetch, read back only when nothing fresher is available in memory.
const CACHED_PROGRESS_RACES_KEY = 'racemaster-mobile-cached-progress-races';

// Deliberately strips `devices` down to a fixed, always-empty array (never real device lines —
// those would go stale immediately, and Bluetooth is the real source of truth for them) rather
// than dropping the field outright: mergePendingIntoRaces() above (and everything downstream of
// it — flattenDevices()/flattenAllFiles() in js/mobile-files-devices.js) unconditionally spreads
// and filters race.devices, so every cached race still needs a real (empty) array to stay a
// drop-in-compatible race object for any caller expecting one, not just the progress-specific
// ones this cache was actually built for. Races with no progress.json at all are dropped
// entirely — nothing useful to cache about them.
export function saveCachedProgressRaces(races) {
  try {
    // Adoption markers ride along too (js/mobile-files-adoption.js) — a reload while offline must
    // still know which devices to send a Bluetooth adoption to.
    const slim = races
      .filter(r => r.progress || (r.adoptions && Object.keys(r.adoptions).length))
      .map(r => ({ owner: r.owner, raceLabel: r.raceLabel, raceDate: r.raceDate, progress: r.progress ?? null, adoptions: r.adoptions, devices: [] }));
    localStorage.setItem(CACHED_PROGRESS_RACES_KEY, JSON.stringify({
      context: currentDatasetContext(), races: slim,
    }));
  } catch { /* storage unavailable/full — best effort only, same as other persisted state here */ }
}

// Returns [] if nothing was ever cached, the cache is corrupt, or it belongs to a different
// dataset (same guard loadSelectedKeys() uses — see currentDatasetContext()'s own doc).
export function loadCachedProgressRaces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHED_PROGRESS_RACES_KEY) || 'null');
    if (!parsed || parsed.context !== currentDatasetContext() || !Array.isArray(parsed.races)) return [];
    return parsed.races;
  } catch { return []; }
}
