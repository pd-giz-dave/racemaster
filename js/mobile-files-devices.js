'use strict';

// Devices tab — pure data logic: segment-view derivation and the device-list building it feeds.
// No DOM at all (not even a call to js/ui.js's renderTable) — js/views/mobile-files-devices.js
// is the thin rendering layer on top of this that actually puts these rows on screen.

import { escHtml } from './utils.js';
import {
  byLineNumber, computeIncorporationStatus, getBleLastSeen, laterIso, latestLineTimestamp,
} from './mobile-files-shared.js';

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

export function formatCount(visible) {
  return visible === 0 ? '' : String(visible);
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

// Every visible line should share one location (it's stamped from the race's own
// RaceEntity.location, the same for every record a device sends for that race) — anything
// else means the file is invalid. Exported: js/views/mobile-files-devices.js's showDeviceModal()
// uses this directly.
export function locationSummary(visibleRows) {
  const locations = [...new Set(visibleRows.map(r => r.location))];
  if (locations.length <= 1) return escHtml(locations[0] || '—');
  return `<span style="color:var(--danger)">Inconsistent (${locations.map(escHtml).join(', ')}) — file is invalid</span>`;
}

// Same "every visible line should share one location" rule as locationSummary(), but returns
// the raw string (or null if the file disagrees with itself, which is already invalid) rather
// than a display-ready HTML snippet. Also used by mobile-files-progress.js's own
// validateAndCompute() to bucket selected files by resolved location rather than show them.
export function rawLocationOf(visibleRows) {
  const locations = [...new Set(visibleRows.map(r => r.location))];
  return locations.length === 1 ? locations[0] : null;
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

// Flattens races → one row per device, precomputing everything the columns need so
// js/views/mobile-files-devices.js's column render functions stay trivial reads, same as every
// other list view's *_COLS.
export function flattenDevices(races) {
  const rows = [];
  for (const race of races) {
    const withLocation = race.devices.map(device => {
      const { timeSegment, bibsSegment } = buildSegmentView(device.lines);
      return { device, timeSegment, bibsSegment, rawLocation: rawLocationOf([...timeSegment, ...bibsSegment]) };
    });
    withLocation.sort((a, b) => {
      const ka = locationSortKey(a.rawLocation), kb = locationSortKey(b.rawLocation);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    });
    for (const { device, timeSegment, bibsSegment } of withLocation) {
      const r = { owner: race.owner, raceLabel: race.raceLabel, device };
      rows.push({
        idx: rows.length,
        ...r,
        raceDate: race.raceDate,
        pending: !!device.pending,
        location: locationSummary([...timeSegment, ...bibsSegment]),
        bibsVisible: bibsSegment.length,
        timeVisible: timeSegment.length,
        lastSeen: laterIso(device.lastSeen, getBleLastSeen(race.owner, race.raceLabel, device.name)),
        lastUpdate: latestLineTimestamp(device.lines),
        incorporationStatus: computeIncorporationStatus(r),
      });
    }
  }
  return rows;
}
