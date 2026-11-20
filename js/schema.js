'use strict';

// ----------------------------------------------------------------
// Factory functions for all persisted model objects.
// These are the canonical definitions of each model's shape and defaults.
// Every construction site imports from here — add a field once, here.
// ----------------------------------------------------------------

export function createPerson({
  name = '', gender = '', dob = '', club = '', fraNumber = '',
  lastSeen = '', seenTotal = 0, lastHelped = '', helpedTotal = 0, banned = '',
} = {}) {
  return { name, gender, dob, club, fraNumber, lastSeen, seenTotal, lastHelped, helpedTotal, banned };
}

// lost is a plain date, DD/MM/YYYY — the same convention every other date field in the app
// uses (state.event.date, a person's dob, etc.) — never an ISO instant.
export function createDibber({
  shortCode = 0, longCode = 0, owner = '', lost = '', notes = '',
} = {}) {
  return { shortCode, longCode, owner, lost, notes };
}

// dateAcquired/lastUsed/lost are plain dates, DD/MM/YYYY — the same convention every other date
// field in the app uses (state.event.date, a person's dob, etc.) — never an ISO instant.
//
// status/asAt (ToDo.MD: "beacons page should have status and as at columns ... those states can
// cross race boundaries") track this beacon's own real-world state across races — '' until first
// allocated, then 'issued' once allocated to an entry, 'on-course' once Count mode has actually
// seen it this race, 'returned' once Close mode (or a manual return) has closed it. Kept current
// by js/mobile-beacons.js's applyBeaconStatusUpdates(), called from every Update Progress run —
// hand-editable on the Beacons page's own Edit form for a return noticed some other way. asAt is
// that status's own device timestamp ("yyyy/mm/dd HH:mm:ss", the phone-clock convention every
// Close/Count row uses, see mobile-files-shared.js's parsePhoneTimestamp) — blank for 'issued',
// since allocation itself has no device event to timestamp.
export function createBeacon({
  number = 0, owner = '', dateAcquired = '', usageCount = 0, totalHours = 0, batteryLevel = 100,
  lastUsed = '', lost = '', notes = '', status = '', asAt = '',
} = {}) {
  return { number, owner, dateAcquired, usageCount, totalHours, batteryLevel, lastUsed, lost, notes, status, asAt };
}

export function createEntry({
  // dibberNumber holds whichever fob number this entry has been allocated — an SI dibber or a
  // beacon, mutually exclusive per entry (a course has exactly one timing method at a time, see
  // js/time-utils.js's usingDibbers()/usingBeacons()) — which pool it's drawn from, and what it
  // means, is dictated entirely by the event's own timing-method setting, not by a separate field.
  bibNumber = 0, dibberNumber = 0, fraNumber = '', name = '', club = '',
  gender = '', dob = '', category = '', course = '', preEntry = '',
  partner = null,  // { name, gender, dob, club, fraNumber } — null for solo entries
  predictedTime = '',  // handicap races only — entrant's own predicted elapsed finish time
} = {}) {
  return { bibNumber, dibberNumber, fraNumber, name, club, gender, dob, category, course, preEntry, partner, predictedTime };
}

export function createHelper({
  number = 0, name = '', club = '', gender = '', dob = '', category = '', role = '',
} = {}) {
  return { number, name, club, gender, dob, category, role };
}

export function createFinisher({
  action = '', number = '', time = '',
} = {}) {
  return { action, number, time };
}

export function createRole({
  role = '', description = '',
} = {}) {
  return { role, description };
}

export function createCategory({
  minAge = '', maleCat = '', femaleCat = '', ref = '', maxDist = '',
} = {}) {
  return { minAge, maleCat, femaleCat, ref, maxDist };
}

export function createEvent({
  name = '', distance = 0, date = '', startTime = '19:30:00',
  firstBibNumber = 1, firstDibberNumber = 1, categories = 'FRA', entryLimit = 180,
  timingMethod = 'Stopwatch', maleRecord = '', femaleRecord = '',
  prizeDepthOverall = 3, prizeDepthPerCategory = 1, juniorPrizeDepthPerCategory = 6,
  juniorLimit = 'None', juniorStartTime = '18:50:00', juniorEntryLimit = 100,
  juniorTimingMethod = 'Stopwatch', hasPairs = false, notes = '',
  isHandicap = false, handicapTargetTime = '', handicapDsqThreshold = 10,
  beaconLowBatteryThreshold = 20,
} = {}) {
  return {
    name, distance, date, startTime,
    firstBibNumber, firstDibberNumber, categories, entryLimit,
    timingMethod, maleRecord, femaleRecord,
    prizeDepthOverall, prizeDepthPerCategory, juniorPrizeDepthPerCategory,
    juniorLimit, juniorStartTime, juniorEntryLimit, juniorTimingMethod, hasPairs, notes,
    isHandicap, handicapTargetTime, handicapDsqThreshold,
    beaconLowBatteryThreshold,
  };
}
