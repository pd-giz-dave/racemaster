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

export function createDibber({
  shortCode = 0, longCode = 0, owner = '', lost = '', notes = '',
} = {}) {
  return { shortCode, longCode, owner, lost, notes };
}

export function createEntry({
  bibNumber = 0, dibberNumber = 0, fraNumber = '', name = '', club = '',
  gender = '', dob = '', category = '', course = '', preEntry = '',
} = {}) {
  return { bibNumber, dibberNumber, fraNumber, name, club, gender, dob, category, course, preEntry };
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
  maleMinAge = '', maleCat = '', maleRef = '', maleMaxDist = '',
  femaleMinAge = '', femaleCat = '', femaleRef = '', femaleMaxDist = '',
} = {}) {
  return { maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist };
}

export function createEvent({
  name = '', distance = 0, date = '', startTime = '19:30:00',
  firstBibNumber = 1, firstDibberNumber = 1, categories = 'FRA', entryLimit = 180,
  timingMethod = 'Stopwatch', maleRecord = '', femaleRecord = '',
  prizeDepthOverall = 3, prizeDepthPerCategory = 1, juniorPrizeDepthPerCategory = 6,
  juniorLimit = 'None', juniorStartTime = '18:50:00', juniorEntryLimit = 100,
  juniorTimingMethod = 'Stopwatch',
} = {}) {
  return {
    name, distance, date, startTime,
    firstBibNumber, firstDibberNumber, categories, entryLimit,
    timingMethod, maleRecord, femaleRecord,
    prizeDepthOverall, prizeDepthPerCategory, juniorPrizeDepthPerCategory,
    juniorLimit, juniorStartTime, juniorEntryLimit, juniorTimingMethod,
  };
}
