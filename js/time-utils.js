'use strict';

import { state } from './state.js';
import { TIMING, COURSE } from './constants.js';
import { normaliseTime, timeToSeconds, secondsToTime, ciEq } from './utils.js';


/** Get the stopwatch offset time in seconds (0 if elapsed-time mode, -ve if clock started late) */
export function stopwatchOffsetTime() {
  const offset = state.event.stopwatchOffsetTime;
  if (!offset) return 0;
  const secs = timeToSeconds(normaliseTime(offset));
  return state.event.stopwatchLateStart ? -secs : secs;
}

/** Get the stopwatch start offset for a course in seconds */
export function stopwatchStartOffset(course) {
  const cell = ciEq(course, COURSE.JUNIORS)
    ? state.event.juniorStopwatchStartOffset
    : state.event.stopwatchStartOffset;
  if (!cell) return 0;
  return timeToSeconds(normaliseTime(cell));
}

/** Set the stopwatch start offset for a course */
export function setStopwatchStartOffset(course, timeStr) {
  if (ciEq(course, COURSE.JUNIORS)) {
    state.event.juniorStopwatchStartOffset = timeStr;
  } else {
    state.event.stopwatchStartOffset = timeStr;
  }
}

/**
 * Get the timing method (first letter) for a course.
 * Returns 'S', 'D', or 'N'.
 */
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
 * Adjust finish time to get actual flight-time.
 * entry: the entry object {course, startTime}
 * finishTime: raw time string from finishers sheet
 * ignoreOffset: boolean
 * Returns HH:MM:SS string
 */
export function adjustedFinishTime(entry, finishTime, ignoreOffset = false) {
  const course = entry.course || COURSE.SENIORS;
  const tm = getTimingMethod(course);
  if (ciEq(tm, TIMING.DIBBERS)) return finishTime; // dibbers handle their own timing

  let startOff = stopwatchStartOffset(course);

  // Individual start time from a 'Start' finisher record overrides course start time
  const startRecord = state.finishers.find(f => f.action === 'Start' && +f.number === +entry.bibNumber);
  if (startRecord?.time) {
    startOff = timeToSeconds(normaliseTime(startRecord.time));
  }

  let clockOff = ignoreOffset ? 0 : stopwatchOffsetTime();
  if (ignoreOffset) { clockOff = 0; startOff = 0; }

  const normFinishTime = normaliseTime(finishTime);
  if (!normFinishTime) return finishTime;
  let secs = timeToSeconds(normFinishTime);
  secs = secs - startOff - clockOff;
  if (secs < 0) secs = 1;
  if (secs >= 86400) secs = 86399;
  return secondsToTime(secs);
}

/**
 * Adjust race start time for a course or individual bib.
 * clockTime: the stopwatch time recorded at start
 * Returns an object {course/bib, adjustedTime} or null on error.
 */
export function adjustStartTime(courseOrBib, clockTimeStr) {
  const clockTime = timeToSeconds(normaliseTime(clockTimeStr));
  const offset = stopwatchOffsetTime();
  let startTime;
  if (offset < 0) {
    // Late clock start
    if (Math.abs(offset) > 3600) return { error: 'Offset must be no more than 1 hour' };
    startTime = secondsToTime(clockTime - Math.abs(offset));
  } else {
    if (clockTime < offset) return { error: `Clock time must be at least ${secondsToTime(offset)}` };
    startTime = secondsToTime(clockTime - offset);
  }
  return { startTime };
}

/** Get the current time as HH:MM:SS */
export function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
}

/**
 * Validate a finish time relative to the previous time.
 * Returns an error string or '' if OK.
 */
export function validateFinishTime(prevTime, thisTime) {
  if (!thisTime) return '';
  const norm = normaliseTime(thisTime);
  if (!norm) return 'Invalid time format';
  if (prevTime) {
    const normPrev = normaliseTime(prevTime);
    if (normPrev && timeToSeconds(norm) < timeToSeconds(normPrev)) {
      return `Time ${norm} is before previous ${normPrev}`;
    }
  }
  return '';
}