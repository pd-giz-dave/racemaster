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