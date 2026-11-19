'use strict';

import { state, saveBeacons, saveBeaconReports } from './state.js';
import { coursesInUse } from './categories.js';
import { getEventStartTime, usingBeacons } from './time-utils.js';
import { parseDate, timeToSeconds, normaliseDate } from './utils.js';
import { parsePhoneTimestamp } from './mobile-files-shared.js';

// Applies the Close/Count-mode beacon housekeeping data Update Progress already extracts from the
// selected device files (js/mobile-files-progress.js's own closeByBeacon map, built from 'Close'
// rows' note field) to the Beacons catalogue (state.beacons) and the entries currently allocated a
// beacon number for this race — the pure-logic half, mirroring js/mobile-files-progress.js's own
// validateAndCompute/applyComputedResults split. The DOM/orchestration half lives in
// js/views/mobile-files-beacons.js.
//
// Formerly driven by a separate beacons.json post-race report, read on demand via its own "Read
// Beacons Report" button (server/mobile.js's own doc still describes that wire shape) — now
// redundant and removed (ToDo.MD: "Beacons tab still has read beacons report, now redundant as
// update progress should do it from entries in the selected device files"): the device files
// Update Progress already has selected are the same, more current source, so there's no reason to
// ask the phone/server for a second, separately-pulled summary of the same data. The bespoke
// endpoint and beacons.json itself are left in place server-side (unused) — a separate cleanup
// decision, not this one.

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// The earliest in-use course's scheduled start, as an absolute instant (event date + that
// course's own start time) — a single physical beacon fleet isn't scoped to one course, so the
// earliest start covers a beacon that was active across both Seniors' and Juniors' races.
// Returns null when the event date, or every in-use course's start time, is unset/invalid.
function raceStartMs() {
  const dateMs = parseDate(state.event.date)?.getTime();
  if (!dateMs) return null;
  const starts = coursesInUse()
    .map(c => getEventStartTime(c))
    .filter(Boolean)
    .map(t => timeToSeconds(t));
  if (!starts.length) return null;
  return dateMs + Math.min(...starts) * 1000;
}

/** Beacon numbers currently allocated to an entry for this race — the "issued" set the
 *  missing-beacon check (ToDo.MD: "verify every beacon issued has been returned") is scoped to,
 *  and also what js/views/mobile-files-beacons.js seeds its tab's rows from before any report has
 *  been read. Scoped to usingBeacons(e.course) — entry.dibberNumber is the one field an SI dibber
 *  and a beacon number are both allocated into (see createEntry()'s own doc in schema.js), so
 *  without this guard a Dibbers-timed entry's own number would be mistaken for an issued beacon. */
export function issuedBeaconNumbers() {
  return new Set(state.entries.filter(e => usingBeacons(e.course)).map(e => +e.dibberNumber).filter(n => n > 0));
}

/**
 * Compute what applying [closeByBeacon] (js/mobile-files-progress.js's own per-beacon Close-row
 * map: beacon -> { closedAt, batteryPercent, closeCount }, or just { closeCount } for a beacon
 * whose latest row was actually a reopen — see that function's own doc) would do, without
 * mutating state yet. Returns { toApply: [{number, batteryLevel, closedAt, hoursDelta}],
 * returned: [number...], missing: [number...], appliedCloseAt: {number: closedAt},
 * closeCounts: {number: count} } — `returned`/`appliedCloseAt`/`closeCounts` only ever cover a
 * beacon that's genuinely closed right now, never one that's been reopened since (see
 * [closedEntries] below): a reopened beacon falls straight through to `missing` instead, the
 * same as if it had never been closed this race at all.
 *
 * toApply excludes any close already applied — a beacon this race's own prior run (state.
 * beaconReports, by raceLabel) already recorded the same `closedAt` for was processed by an
 * earlier Update Progress run over the same (or an earlier, smaller) selection — so this is safe
 * to call again with the same or a growing selection (late returns, or a re-run after new devices
 * are ticked): re-running naturally shrinks `missing` and only queues the genuinely-new closes,
 * without double-counting hours already accumulated. This can't be done by comparing against the
 * catalogue's own `lastUsed` (as an earlier version of this function did) because that field is a
 * plain DD/MM/YYYY date — the same convention every other date in the app uses — and, per
 * ToDo.MD, gets set the moment a beacon is allocated to an entry, before Update Progress is ever
 * run; `appliedCloseAt` (carried on the race's own state.beaconReports entry — see
 * applyBeaconCatalogueUpdates below) is this function's own private bookkeeping for exactly this
 * check, entirely separate from the catalogue's own display fields.
 */
export function computeBeaconCatalogueUpdates(closeByBeacon, raceLabel) {
  const startMs = raceStartMs();
  const activeFromMs = startMs !== null ? startMs - TWO_HOURS_MS : null;
  const previouslyApplied = state.beaconReports.find(r => r.raceLabel === raceLabel)?.appliedCloseAt || {};

  // A beacon whose latest Close-mode row was actually a reopen (racemaster-mobile's own
  // HistoryAction.CLOSE_REOPENED — see mobile-files-progress.js's own computeCloseByBeacon doc)
  // carries no closedAt in its closeByBeacon entry at all; the catalogue must treat that beacon
  // as still out, not returned — it falls through to `missing` below the same as if it had never
  // been closed this race, instead of wrongly showing as returned with a stale/zeroed battery
  // reading applied to it.
  const closedEntries = [...closeByBeacon].filter(([, entry]) => entry.closedAt);

  const toApply = [];
  const returned = closedEntries.map(([number]) => number).sort((a, b) => a - b);
  const appliedCloseAt = {};
  // How many times each returned beacon was closed this race (racemaster-mobile's own device
  // never dedupes a re-presentation — see mobile-files-progress.js's own computeCloseByBeacon doc)
  // — surfaced on the Beacons tab (js/views/mobile-files-beacons.js) rather than applied to the
  // catalogue itself.
  const closeCounts = {};
  for (const [number, { closedAt, batteryPercent, closeCount }] of closedEntries) {
    closeCounts[number] = closeCount || 1;
    // Recorded for every returned beacon, not just the ones in toApply below — closeByBeacon is
    // always the current full picture of the selected devices (see validateAndCompute()'s own
    // doc), so this is simply what to persist as "already applied" once this plan is applied.
    appliedCloseAt[number] = closedAt || '';

    const beacon = state.beacons.find(b => +b.number === number);
    if (!beacon) continue; // not in the catalogue — nothing to update
    if (previouslyApplied[number] && previouslyApplied[number] === closedAt) continue; // already applied

    let hoursDelta = 0;
    if (activeFromMs !== null && closedAt) {
      const offMs = parsePhoneTimestamp(closedAt);
      if (offMs != null) hoursDelta = Math.max(0, (offMs - activeFromMs) / 3600000);
    }
    toApply.push({ number, batteryLevel: batteryPercent || 0, closedAt: closedAt || '', hoursDelta });
  }

  const returnedSet = new Set(returned);
  const missing = [...issuedBeaconNumbers()].filter(n => !returnedSet.has(n)).sort((a, b) => a - b);

  return { toApply, returned, missing, appliedCloseAt, closeCounts };
}

/**
 * Applies a previously computed plan (see computeBeaconCatalogueUpdates above) to the Beacons
 * catalogue, and replaces this race's own entry in state.beaconReports with a fresh summary —
 * both steps are naturally idempotent: toApply already excludes already-processed closes, and the
 * summary (including appliedCloseAt, the idempotency bookkeeping the next call's own
 * computeBeaconCatalogueUpdates() reads back) is a point-in-time snapshot derived fresh from the
 * latest selection each call, not an accumulation across calls.
 */
export async function applyBeaconCatalogueUpdates(plan, raceLabel) {
  for (const { number, batteryLevel, closedAt, hoursDelta } of plan.toApply) {
    const beacon = state.beacons.find(b => +b.number === number);
    if (!beacon) continue;
    beacon.batteryLevel = batteryLevel;
    // DD/MM/YYYY, same convention every other date in the app uses — not the raw "yyyy/MM/dd
    // HH:mm:ss" closedAt carries on the wire.
    if (closedAt) beacon.lastUsed = normaliseDate(closedAt.slice(0, 10)) || beacon.lastUsed;
    beacon.totalHours = (+beacon.totalHours || 0) + hoursDelta;
  }
  if (plan.toApply.length) await saveBeacons();

  const entry = {
    raceLabel,
    processedAt: new Date().toISOString(),
    returned: plan.returned,
    missing: plan.missing,
    appliedCloseAt: plan.appliedCloseAt,
    closeCounts: plan.closeCounts,
  };
  const existingIdx = state.beaconReports.findIndex(r => r.raceLabel === raceLabel);
  const prev = existingIdx >= 0 ? state.beaconReports[existingIdx] : null;
  const unchanged = !!prev &&
    JSON.stringify(prev.returned) === JSON.stringify(entry.returned) &&
    JSON.stringify(prev.missing) === JSON.stringify(entry.missing) &&
    JSON.stringify(prev.appliedCloseAt) === JSON.stringify(entry.appliedCloseAt) &&
    JSON.stringify(prev.closeCounts) === JSON.stringify(entry.closeCounts);

  if (existingIdx >= 0) state.beaconReports[existingIdx] = entry;
  else state.beaconReports.push(entry);
  if (!unchanged) await saveBeaconReports();
}
