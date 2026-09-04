'use strict';

// Pure data/storage helpers shared across the Mobile Files feature's own split-out modules —
// both the pure-logic ones (mobile-files-devices.js, mobile-files-progress.js) and the view
// layer that renders them (js/views/mobile-files*.js). No DOM rendering, and deliberately no
// dependency on any of those other modules, so this stays a true leaf every one of them can
// safely import from without any risk of a circular import.

import { state } from './state.js';

// Ticked checkboxes, keyed by identity rather than row index — row indices are reassigned on
// every render (races/devices can appear in a different order once sorted), so persisting
// selection across a re-render (or navigating away from Mobile Files and back) needs a stable
// key instead.
export const selectedKeys = new Set();
export function rowKey(r) { return `${r.owner} ${r.raceLabel} ${r.device.name}`; }

// Persisted (unlike selectedKeys' own in-memory Set, which this only ever seeds/mirrors) so
// the Results & Prize List page's autoUpdateProgress() (see mobile-files-progress.js) can find
// "what was last ticked here" even after a page reload, with the event name+date stored
// alongside so a later dataset switch doesn't get an old event's selection silently replayed
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
      eventName: state.event.name, eventDate: state.event.date, keys: [...selectedKeys],
    }));
  } catch { /* storage unavailable/full — best effort only, same as other persisted state here */ }
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
// see mobile-files-devices.js's flattenDevices()) → "dd/mm/yy HH:MM" local time, matching
// formatRaceDate()'s own dd/mm/yy convention elsewhere on this page.
export function formatDateTime(iso) {
  if (!iso) return '<span style="color:var(--muted)">—</span>';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '<span style="color:var(--muted)">—</span>';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
