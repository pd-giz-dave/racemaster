'use strict';

import { state } from './state.js';
import { TIMING, COURSE } from './constants.js';
import { normaliseTime, timeToSeconds, secondsToTime, ciEq } from './utils.js';



/** Returns the timing method string ('Stopwatch', 'Dibbers', or 'None') for a course. */
export function getTimingMethod(course) {
  const isJunior = course && ciEq(course, COURSE.JUNIORS);
  const raw = isJunior ? state.event.juniorTimingMethod : state.event.timingMethod;
  return raw || TIMING.STOPWATCH;
}

/** Return true if the given course uses dibbers */
export function usingDibbers(course) {
  return ciEq(getTimingMethod(course), TIMING.DIBBERS);
}

/**
 * Compute a runner's race time from their raw finish time.
 * Pass the finisher record (from state.finishers) so the lookup walks backward
 * from that position; if omitted the first matching Finish record for the bib is used.
 *
 * Clock modes (nearest Clock record above the finisher):
 *   no Clock record, or Clock with no time → relative, ref = 0
 *   Clock with h = 0 (mm:ss or ss)         → relative, ref = Clock.time (late-start offset)
 *   Clock with h > 0 (hh:mm:ss)            → time-of-day, ref = Clock.time
 *
 * Start time sources (nearest above, priority order):
 *   1. Start finisher record for this bib
 *   2. Category finisher record (action === entry.category)
 *   3. Male / Female finisher record (seniors only; gender derived from categories list)
 *   4. Seniors / Juniors finisher record for the course
 *   default: clock reference (elapsed = finishTime − clockRef)
 *
 * Race time = finishTime − startRef  (clockRef cancels when both are in the same frame)
 */
export function adjustedFinishTime(entry, finishTime, finisherRecord = null) {
  const course = entry.course || COURSE.SENIORS;
  if (ciEq(getTimingMethod(course), TIMING.DIBBERS)) return finishTime;

  const normFinishTime = normaliseTime(finishTime);
  if (!normFinishTime) return finishTime;
  const finishSecs = timeToSeconds(normFinishTime);

  const bib = +entry.bibNumber;
  const finishIdx = finisherRecord
    ? state.finishers.indexOf(finisherRecord)
    : state.finishers.findIndex(f => f.action === 'Finish' && +f.number === bib);
  const searchFrom = finishIdx >= 0 ? finishIdx : state.finishers.length;

  // Nearest Clock record above
  let clockRecord = null;
  for (let i = searchFrom - 1; i >= 0; i--) {
    if (state.finishers[i].action === 'Clock') { clockRecord = state.finishers[i]; break; }
  }
  const isTOD       = clockRecord?.time ? +clockRecord.time.split(':')[0] > 0 : false;
  const clockOffset = clockRecord?.time ? timeToSeconds(normaliseTime(clockRecord.time)) : 0;

  // In time-of-day mode startRef defaults to the clock reference (elapsed = finish − clockRef).
  // In relative offset mode startRef defaults to 0; the offset is subtracted from finish directly.
  let startRef = isTOD ? clockOffset : 0;

  // Source 1: nearest bib-specific Start record above
  let bibStart = null;
  for (let i = searchFrom - 1; i >= 0; i--) {
    const f = state.finishers[i];
    if (f.action === 'Start' && +f.number === bib) { bibStart = f; break; }
  }

  if (bibStart?.time) {
    startRef = timeToSeconds(normaliseTime(bibStart.time));
  } else {
    let found = false;

    // Source 2: nearest category record above (action === runner's category)
    if (entry.category) {
      for (let i = searchFrom - 1; i >= 0; i--) {
        const f = state.finishers[i];
        if (ciEq(f.action, entry.category) && f.time) { startRef = timeToSeconds(normaliseTime(f.time)); found = true; break; }
      }
    }

    if (!found && !ciEq(course, COURSE.JUNIORS)) {
      // Source 3: nearest Male / Female record above (seniors only)
      // Derive gender from which column the category sits in the categories list
      const catRow = state.categories.find(c => ciEq(c.maleCat, entry.category) || ciEq(c.femaleCat, entry.category));
      const genderAction = catRow && ciEq(catRow.femaleCat, entry.category) ? 'Female' : 'Male';
      for (let i = searchFrom - 1; i >= 0; i--) {
        const f = state.finishers[i];
        if (f.action === genderAction && f.time) { startRef = timeToSeconds(normaliseTime(f.time)); found = true; break; }
      }
    }

    if (!found) {
      // Source 4: nearest Seniors / Juniors course-start record above
      const courseAction = ciEq(course, COURSE.JUNIORS) ? 'Juniors' : 'Seniors';
      for (let i = searchFrom - 1; i >= 0; i--) {
        const f = state.finishers[i];
        if (f.action === courseAction && f.time) { startRef = timeToSeconds(normaliseTime(f.time)); break; }
      }
    }
  }

  // Time-of-day: race time = finish − startRef (startRef is an absolute time-of-day value)
  // Relative: race time = (finish + clockOffset) − startRef (late-start offset added to finish)
  let secs = isTOD ? (finishSecs - startRef) : (finishSecs + clockOffset - startRef);
  if (secs < 0) secs = 1;
  if (secs >= 86400) secs = 86399;
  return secondsToTime(secs);
}
