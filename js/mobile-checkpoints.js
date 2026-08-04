'use strict';

import { state } from './state.js';

// Consolidated checkpoint times computed from Mobile Files' "Compute Results" action —
// approximate (crossing timestamp minus the stopwatch's own Start-line timestamp), unlike
// state.finishers' FinishTime which is an authoritative stopwatch/splitNumber-paired value.
// Mirrors si-results.js's own thin-accessor-over-a-dynamic-array pattern.

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

/** Highest CP number reached by this bib, and its (approximate) elapsed time — for a
 *  Safety Check "last seen" display. Returns null if this bib has no CP sighting at all. */
export function getLatestCheckpoint(bib) {
  const r = state.mobileCheckpoints.find(row => getMobileCheckpointBib(row) === +bib);
  if (!r) return null;
  const nums = Object.keys(r.cpTimes || {}).map(Number).sort((a, b) => b - a);
  return nums.length ? { cp: nums[0], time: r.cpTimes[nums[0]] } : null;
}
