'use strict';

import { state, saveMobileProgress } from './state.js';
import { getEntry } from './entries.js';
import { ciEq } from './utils.js';

// Mobile-derived Start/Finish/DNF/Clock/etc records from Mobile Files' Update Progress — kept
// as a genuinely separate array from state.finishers (manual stopwatch entry only) so a mobile
// pull can never overwrite/clobber a manual entry, or vice versa. Mirrors finishers.js's own
// getSortedFinishers() so results.js/safety.js can treat this as a parallel source, the same
// way state.siResults already is.

/** Get mobile progress entries in the mobile file's own recording order, optionally filtered
 *  by course (derived from entries). */
export function getSortedMobileProgress(course) {
  if (!course) return [...state.mobileProgress];
  return state.mobileProgress.filter(f => {
    const entry = +f.number > 0 ? getEntry(+f.number) : null;
    return ciEq(entry?.course || '', course);
  });
}

/** Remove one mobile-derived progress record (e.g. undoing a mobile-recorded retirement from
 *  the Safety page) — returns true if a matching record was found and removed. */
export async function removeMobileProgressRecord(bib, action) {
  const idx = state.mobileProgress.findIndex(f => f.action === action && +f.number === +bib);
  if (idx < 0) return false;
  state.mobileProgress.splice(idx, 1);
  await saveMobileProgress();
  return true;
}
