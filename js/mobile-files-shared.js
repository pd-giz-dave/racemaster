'use strict';

// Pure data/storage helpers shared across the Mobile Files feature's own split-out modules —
// both the pure-logic ones (mobile-files-devices.js, mobile-files-progress.js) and the view
// layer that renders them (js/views/mobile-files*.js). No DOM rendering, and deliberately no
// dependency on any of those other modules, so this stays a true leaf every one of them can
// safely import from without any risk of a circular import.

import { state } from './state.js';
import { getSession } from './storage.js';
import { getRaceStaleAfterDays, raceLabelAgeDays, sanitiseName } from './mule-ble.js';

// Ticked checkboxes, keyed by identity rather than row index — row indices are reassigned on
// every render (races/devices can appear in a different order once sorted), so persisting
// selection across a re-render (or navigating away from Mobile Files and back) needs a stable
// key instead.
export const selectedKeys = new Set();
export function rowKey(r) { return `${r.owner} ${r.raceLabel} ${r.device.name}`; }

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

// ---- "Last actually polled over Bluetooth" tracking ----
//
// device.lastSeen (see mobile-files-devices.js's flattenDevices()) is either the server's own
// file mtime for a synced device, or a pending file's own pulledAt — neither of which updates on
// a poll that found nothing new: pullAndSyncConnectedPhone() (js/views/mobile-files-ble.js)
// skips its push loop entirely whenever totalLines is 0 (see its own doc), so a phone polled
// repeatedly with nothing new to report would otherwise show the same stale Last Seen from
// whenever it was first synced, even though this browser just successfully talked to it again a
// moment ago. This tracks that contact independently of whether it found anything new, persisted
// (not just in memory, same as LAST_SYNCED_KEY above) so it survives a page reload — keyed the
// same way rowKey() is, since a pull's own results carry owner/raceLabel/deviceName but no
// ready-made row object to key off.
const BLE_LAST_SEEN_KEY = 'racemaster-mobile-ble-last-seen';

export function loadBleLastSeen() {
  try { return JSON.parse(localStorage.getItem(BLE_LAST_SEEN_KEY) || '{}'); } catch { return {}; }
}
export function recordBleLastSeen(owner, raceLabel, deviceName) {
  const map = loadBleLastSeen();
  map[`${owner} ${raceLabel} ${deviceName}`] = new Date().toISOString();
  try { localStorage.setItem(BLE_LAST_SEEN_KEY, JSON.stringify(map)); } catch { /* storage unavailable/full — best effort only */ }
}
export function getBleLastSeen(owner, raceLabel, deviceName) {
  return loadBleLastSeen()[`${owner} ${raceLabel} ${deviceName}`] || null;
}

// Later of two ISO timestamps (either may be null/undefined) — device.lastSeen and a
// getBleLastSeen() lookup are both real UTC toISOString() output, so a plain Date comparison is
// all that's needed; no need for the string-surgery formatStoredTimestamp() below deals with,
// which is only for the phone's own non-ISO "yyyy/mm/dd HH:MM:SS" wire format.
export function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
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
export function latestLineTimestamp(lines) {
  let max = null;
  for (const l of lines) {
    const ts = l.timestamp ?? l.timestampMillis;
    if (ts && (!max || ts > max)) max = ts;
  }
  return max;
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

// Same "<name>-yy-mm-dd" convention a phone's own raceLabel already uses (2-digit year FIRST —
// see parseRaceLabelDate above and js/mule-ble.js's raceLabelAgeDays, both of which parse a
// label's trailing "-dd-dd-dd" strictly as yy-mm-dd) — state.event.date is stored dd/mm/yyyy, so
// the day and year swap position here. Getting this order wrong doesn't error — it just silently
// misdates the race for every consumer of that shared parsing, which is exactly what was
// happening before this was fixed (see git history) — never re-derive this independently
// elsewhere; this is now the one place it lives (js/progress-sync.js imports it back).
export function deriveRaceLabel(event) {
  const [dd, mm, yyyy] = (event.date || '').split('/');
  if (!dd || !mm || !yyyy || !event.name) return '';
  return `${sanitiseName(event.name) || 'race'}-${yyyy.slice(-2)}-${mm}-${dd}`;
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
// device (deduping by recordUuid, same convention as storage.js's own savePendingMobileFile),
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
    const knownLines = known ? known.lines : [];
    const seenUuids = new Set(knownLines.map(l => l.recordUuid).filter(Boolean));
    const lines = [...knownLines, ...p.lines.filter(l => l.recordUuid && !seenUuids.has(l.recordUuid))];
    race.devices = race.devices.filter(d => d.name !== p.deviceName);
    race.devices.push({ name: p.deviceName, deviceId: p.deviceId, lines, pending: true, lastSeen: p.pulledAt });
  }
  return sortRaces(merged);
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

// The cached progress payload (already fetched via GET /api/mobile — see race.progress in
// server/mobile.js's getMobileRacesForUser) for whatever race [owner]/[raceLabel] currently is —
// used by js/views/mobile-files-ble.js to decide what (if anything) to deliver to a connected
// phone over BLE, without a second server round trip just for that. null when not found (races
// not yet fetched, or no match).
export function findCurrentRaceProgress(races, owner, raceLabel) {
  return races.find(r => r.owner === owner && r.raceLabel === raceLabel)?.progress ?? null;
}
