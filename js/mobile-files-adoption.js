'use strict';

// Device adoption — the Mobile Files Devices tab's own row tick, for a device whose race label
// isn't one of the loaded event's course labels (a phone set up with an arbitrary name, e.g.
// "unknown-26-09-23"), also tells that phone which real race it belongs to. Three routes out:
//   - the server's adoption marker in the folder the phone pushes to (server/mobile.js's
//     readAdoptions), which the phone polls over HTTP;
//   - a Bluetooth targeted delivery (mule-ble.js's adoptionTargetFor/adoptionPayload), direct or
//     via a mule, which also lets a logged-in mule write that same marker for us;
//   - progress, via the tick itself (it's the same selection Update Progress already reads).
// Identity is (owner, fromRaceLabel, deviceName) — rowKey()'s own triple — never a deviceId,
// which the server never learns. No DOM here; js/views/mobile-files.js does the wiring.

import { deriveRaceLabel, findCurrentRaceProgress } from './mobile-files-shared.js';

// Adoptions the server hasn't confirmed yet — ticked while offline, or a write that failed.
// { [key]: { owner, fromRaceLabel, deviceName, raceLabel|null } } (null = clear).
const PENDING_ADOPTIONS_KEY = 'racemaster-pending-adoptions';

export function adoptionKey(owner, fromRaceLabel, deviceName) {
  return `${owner} ${fromRaceLabel} ${deviceName}`;
}

export function loadPendingAdoptions() {
  try { return JSON.parse(localStorage.getItem(PENDING_ADOPTIONS_KEY) || '{}'); } catch { return {}; }
}

function savePendingAdoptions(map) {
  try { localStorage.setItem(PENDING_ADOPTIONS_KEY, JSON.stringify(map)); } catch { /* best effort */ }
}

export function setPendingAdoption(owner, fromRaceLabel, deviceName, raceLabel) {
  const map = loadPendingAdoptions();
  map[adoptionKey(owner, fromRaceLabel, deviceName)] = { owner, fromRaceLabel, deviceName, raceLabel: raceLabel || null };
  savePendingAdoptions(map);
}

export function clearPendingAdoption(owner, fromRaceLabel, deviceName) {
  const map = loadPendingAdoptions();
  delete map[adoptionKey(owner, fromRaceLabel, deviceName)];
  savePendingAdoptions(map);
}

// The loaded event's own per-course race labels — a row already under one of these needs no
// adoption, its tick only feeds progress.
export function eventCourseLabels(event, courses) {
  return courses.map(c => deriveRaceLabel(event, c)).filter(Boolean);
}

// Every adoption in effect, server-confirmed ones overlaid by any still-pending local change:
// [{ owner, fromRaceLabel, deviceName, raceLabel }].
export function effectiveAdoptions(races, pending = loadPendingAdoptions()) {
  const byKey = new Map();
  for (const race of races) {
    for (const [deviceName, a] of Object.entries(race.adoptions || {})) {
      if (a?.raceLabel) byKey.set(adoptionKey(race.owner, race.raceLabel, deviceName), { owner: race.owner, fromRaceLabel: race.raceLabel, deviceName, raceLabel: a.raceLabel });
    }
  }
  for (const [key, p] of Object.entries(pending)) {
    if (p.raceLabel) byKey.set(key, { owner: p.owner, fromRaceLabel: p.fromRaceLabel, deviceName: p.deviceName, raceLabel: p.raceLabel });
    else byKey.delete(key);
  }
  return [...byKey.values()];
}

export function adoptionFor(races, owner, fromRaceLabel, deviceName, pending = loadPendingAdoptions()) {
  return effectiveAdoptions(races, pending)
    .find(a => a.owner === owner && a.fromRaceLabel === fromRaceLabel && a.deviceName === deviceName)?.raceLabel ?? null;
}

// pullFromConnectedPhone's adoptedTargets. Progress is looked up under [progressOwner] (the
// dataset owner, where progress.json is written) — null when none is cached, which still sends an
// adoption-only payload.
export function buildAdoptedTargets(races, progressOwner, pending = loadPendingAdoptions()) {
  return effectiveAdoptions(races, pending).map(a => ({
    deviceName: a.deviceName, fromRaceLabel: a.fromRaceLabel, raceLabel: a.raceLabel,
    progress: findCurrentRaceProgress(races, progressOwner, a.raceLabel),
  }));
}

// Adoptions that have landed: the same device name now has a (server, not pending) file in the
// target race under the same owner — so its old file, the marker, and the tick can move over.
export function completedAdoptions(races, pending = loadPendingAdoptions()) {
  return effectiveAdoptions(races, pending).filter(a =>
    races.some(r => r.owner === a.owner && r.raceLabel === a.raceLabel &&
      r.devices.some(d => d.name === a.deviceName && !d.pending)));
}
