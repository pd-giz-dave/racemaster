'use strict';

// Processes a beacons.json post-race housekeeping report (see server/mobile.js's own doc for the
// wire shape) against the Beacons catalogue (state.beacons) and the entries currently allocated a
// beacon number for this race — the pure-logic half, mirroring js/mobile-files-progress.js's own
// validateAndCompute/applyComputedResults split. The DOM/orchestration half lives in
// js/views/mobile-files-beacons.js.

import { state, saveBeacons, saveBeaconReports } from './state.js';
import { coursesInUse } from './categories.js';
import { getEventStartTime, usingBeacons } from './time-utils.js';
import { parseDate, timeToSeconds, normaliseDate } from './utils.js';

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
 *  missing-beacon check (ToDo.MD: "verify every beacon issued has been returned") is scoped to.
 *  Scoped to usingBeacons(e.course) — entry.dibberNumber is the one field an SI dibber and a
 *  beacon number are both allocated into (see createEntry()'s own doc in schema.js), so without
 *  this guard a Dibbers-timed entry's own number would be mistaken for an issued beacon. */
function issuedBeaconNumbers() {
  return new Set(state.entries.filter(e => usingBeacons(e.course)).map(e => +e.dibberNumber).filter(n => n > 0));
}

/**
 * Compute what applying [report] (a beacons.json payload) would do, without mutating state yet.
 * Returns { toApply: [{number, batteryLevel, poweredOffAt, hoursDelta}], returned: [number...],
 * missing: [number...], appliedPowerOffs: {number: poweredOffAt} }.
 *
 * toApply excludes any power-off event already applied — a beacon this race's own prior report
 * (state.beaconReports, by raceLabel) already recorded the same `poweredOffAt` for was processed
 * by an earlier read of this (or an earlier, smaller) report — so this is safe to call again
 * with the same or a growing report (late returns): re-reading a bigger report naturally shrinks
 * `missing` and only queues the genuinely-new power-off events, without double-counting hours
 * already accumulated. This can't be done by comparing against the catalogue's own `lastUsed`
 * (as an earlier version of this function did) because that field is now a plain DD/MM/YYYY date
 * — the same convention every other date in the app uses — and, per ToDo.MD, gets set the moment
 * a beacon is allocated to an entry, before any report is ever read; `appliedPowerOffs` (carried
 * on the race's own state.beaconReports entry — see applyBeaconReportResults below) is this
 * function's own private bookkeeping for exactly this check, entirely separate from the
 * catalogue's own display fields.
 */
export function validateAndComputeBeaconReport(report, raceLabel) {
  const batch = Array.isArray(report?.powerOffBatch) ? report.powerOffBatch : [];
  const startMs = raceStartMs();
  const activeFromMs = startMs !== null ? startMs - TWO_HOURS_MS : null;
  const previouslyApplied = state.beaconReports.find(r => r.raceLabel === raceLabel)?.appliedPowerOffs || {};

  const toApply = [];
  const returned = [];
  const appliedPowerOffs = {};
  for (const r of batch) {
    const number = +r?.beaconNumber || 0;
    if (number <= 0) continue;
    returned.push(number);
    // Recorded for every returned beacon, not just the ones in toApply below — a beacons.json
    // upload is always the full current snapshot (see server/mobile.js's own doc), so this is
    // simply what to persist as "already applied" once this plan is actually applied.
    appliedPowerOffs[number] = r.poweredOffAt || '';

    const beacon = state.beacons.find(b => +b.number === number);
    if (!beacon) continue; // not in the catalogue — nothing to update
    if (previouslyApplied[number] && previouslyApplied[number] === r.poweredOffAt) continue; // already applied

    let hoursDelta = 0;
    if (activeFromMs !== null && r.poweredOffAt) {
      const offMs = Date.parse(r.poweredOffAt);
      if (Number.isFinite(offMs)) hoursDelta = Math.max(0, (offMs - activeFromMs) / 3600000);
    }
    toApply.push({ number, batteryLevel: +r.batteryLevel || 0, poweredOffAt: r.poweredOffAt || '', hoursDelta });
  }

  const returnedSet = new Set(returned);
  const missing = [...issuedBeaconNumbers()].filter(n => !returnedSet.has(n)).sort((a, b) => a - b);

  return { toApply, returned: [...new Set(returned)].sort((a, b) => a - b), missing, appliedPowerOffs };
}

/**
 * Applies a previously computed plan (see validateAndComputeBeaconReport above) to the Beacons
 * catalogue, and replaces this race's own entry in state.beaconReports with a fresh summary —
 * both steps are naturally idempotent: toApply already excludes already-processed power-offs, and
 * the summary (including appliedPowerOffs, the idempotency bookkeeping the next call's own
 * validateAndComputeBeaconReport() reads back) is a point-in-time snapshot derived fresh from the
 * latest report each call, not an accumulation across calls.
 */
export async function applyBeaconReportResults(plan, report, raceLabel) {
  for (const { number, batteryLevel, poweredOffAt, hoursDelta } of plan.toApply) {
    const beacon = state.beacons.find(b => +b.number === number);
    if (!beacon) continue;
    beacon.batteryLevel = batteryLevel;
    // DD/MM/YYYY, same convention every other date in the app uses — not the raw ISO instant
    // poweredOffAt carries on the wire.
    if (poweredOffAt) beacon.lastUsed = normaliseDate(poweredOffAt.slice(0, 10)) || beacon.lastUsed;
    beacon.totalHours = (+beacon.totalHours || 0) + hoursDelta;
  }
  if (plan.toApply.length) await saveBeacons();

  const entry = {
    raceLabel,
    generatedAt: report?.generatedAt || '',
    processedAt: new Date().toISOString(),
    returned: plan.returned,
    missing: plan.missing,
    appliedPowerOffs: plan.appliedPowerOffs,
  };
  const existingIdx = state.beaconReports.findIndex(r => r.raceLabel === raceLabel);
  const prev = existingIdx >= 0 ? state.beaconReports[existingIdx] : null;
  const unchanged = !!prev && prev.generatedAt === entry.generatedAt &&
    JSON.stringify(prev.returned) === JSON.stringify(entry.returned) &&
    JSON.stringify(prev.missing) === JSON.stringify(entry.missing) &&
    JSON.stringify(prev.appliedPowerOffs) === JSON.stringify(entry.appliedPowerOffs);

  if (existingIdx >= 0) state.beaconReports[existingIdx] = entry;
  else state.beaconReports.push(entry);
  if (!unchanged) await saveBeaconReports();
}
