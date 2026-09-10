'use strict';

import { state } from './state.js';

// Consolidated checkpoint times computed from Mobile Files' "Compute Results" action —
// approximate (crossing timestamp minus the stopwatch's own Start-line timestamp), unlike
// state.finishers' FinishTime which is an authoritative stopwatch/splitNumber-paired value.
// Mirrors si-results.js's own thin-accessor-over-a-dynamic-array pattern.

// Sentinel value stored in a bib's cpTimes at the checkpoint it retired at, instead of a
// computed elapsed time — see mobile-files-progress.js's computeCpTimes() for the full doc on
// why (that's the only place this is actually set). Lives here rather than there so a consumer
// that only needs to recognise the sentinel (e.g. safety.js's own Retirees-tab "where" lookup)
// doesn't have to import the whole Compute Results module to get it — that module already
// imports safety.js itself, and importing back the other way would be circular.
export const CP_RETIRE = 'Retire';

export function getMobileCheckpointBib(r)   { return +r.bibNumber || 0; }
export function getMobileCheckpointTimes(r) { return r.cpTimes || {}; }

/** Every CP number present across all rows, ascending — for building dynamic table columns. */
export function getMobileCheckpointNumbers() {
  const nums = new Set();
  for (const r of state.mobileCheckpoints) {
    for (const k of Object.keys(r.cpTimes || {})) nums.add(+k);
  }
  return [...nums].sort((a, b) => a - b);
}

/** Highest CP number reached by this bib, its (approximate) elapsed time, and — when the
 *  crossing came from a mobile pull — the phone's own device time-of-day for it (Safety
 *  Check's preferred display source; see mobile-files-progress.js's deviceTimeOfDay doc).
 *  timeOfDay is '' when unavailable (e.g. the CP time was set some other way). Returns null if
 *  this bib has no CP sighting at all. */
export function getLatestCheckpoint(bib) {
  const r = state.mobileCheckpoints.find(row => getMobileCheckpointBib(row) === +bib);
  if (!r) return null;
  const nums = Object.keys(r.cpTimes || {}).map(Number).sort((a, b) => b - a);
  if (!nums.length) return null;
  const cp = nums[0];
  return { cp, time: r.cpTimes[cp], timeOfDay: (r.cpTimesOfDay || {})[cp] || '' };
}
