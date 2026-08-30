'use strict';

// Mobile (Mule Mode) helpers.
//
// Scoped per logged-in user, mirroring data/<owner>/ —
// data/mobile/<username>/<raceLabel>/<deviceName>.json. One file per physical phone (not one
// shared file per race), holding that device's own lines as a single flat, chronological
// array — a Bibs line and a Time line are told apart by whether `splitTime` is null (Bibs has
// no stopwatch of its own) or `bibNumber` is null (Time has no bib concept at all — the mobile
// app never sends null there for a Bibs line, even one with no bib of its own, e.g. a Clock/
// Stop/Reset marker: those send the string "n/a" instead, matching how the app's own history
// list displays them, specifically so a bib-less Bibs line can never be wire-indistinguishable
// from a Time line by both fields being null at once), not by which array they're
// (hence there's no need to repeat deviceName per line, or split the array by category,
// either). Append-merged on every sync (new recordUuids added, existing ones left alone; see
// server/routes/mobile.js's merge loop), since the app sends only the lineNumber delta, not
// its full current record set, each time.

import fs from 'fs';
import path from 'path';
import { MOBILE_DIR } from './config.js';

export function mobileRaceDir(username, raceLabel) {
  return path.join(MOBILE_DIR, username, raceLabel);
}

export function mobileDeviceFilePath(username, raceLabel, deviceName) {
  return path.join(mobileRaceDir(username, raceLabel), `${deviceName}.json`);
}

export function readMobileDeviceFile(username, raceLabel, deviceName) {
  const fp = mobileDeviceFilePath(username, raceLabel, deviceName);
  if (!fs.existsSync(fp)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    // Anything other than an array means this file predates the flat-array format (the old
    // {time: [...], bibs: [...]} shape) — no migration, just treated as empty; a push for
    // this device starts the file over in the new format rather than erroring or merging
    // with the old shape.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeMobileDeviceFile(username, raceLabel, deviceName, lines) {
  const dir = mobileRaceDir(username, raceLabel);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mobileDeviceFilePath(username, raceLabel, deviceName), JSON.stringify(lines, null, 2), 'utf8');
}

// bib-allocations.json — a race-wide {raceName, raceDate, entries: [{bibNumber, name, course}]}
// file the web app pushes (see POST .../bib-allocations), not a per-device sync file, so it
// lives in the same owner-scoped race dir but is deliberately excluded from device enumeration
// in getMobileRacesForUser() below.
export function bibAllocationsFilePath(username, raceLabel) {
  return path.join(mobileRaceDir(username, raceLabel), 'bib-allocations.json');
}

export function readBibAllocations(username, raceLabel) {
  const fp = bibAllocationsFilePath(username, raceLabel);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

export function writeBibAllocations(username, raceLabel, payload) {
  const dir = mobileRaceDir(username, raceLabel);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(bibAllocationsFilePath(username, raceLabel), JSON.stringify(payload, null, 2), 'utf8');
}

// raceLabel ends "…-YY-MM-DD" (2-digit year first, e.g. "-26-08-04" = 4 August 2026 — the
// phone's own date suffix) — pull that out for sorting. Returns { yy, mm, dd } (strings) or
// null if the label doesn't end that way.
export function parseRaceLabelDate(raceLabel) {
  const m = /-(\d{2})-(\d{2})-(\d{2})$/.exec(raceLabel || '');
  return m ? { yy: m[1], mm: m[2], dd: m[3] } : null;
}

// Returns array of { owner, raceLabel, raceDate, devices: [{name, records, lines}], recordCount },
// newest race date first (by yy, then mm, then dd — races whose label has no trailing date
// sort last). adminAccess=true returns every user's races; otherwise only `username`'s own.
// `lines` is each device's full raw record array (see readMobileDeviceFile) — sent up front,
// same as the counts, so the Mobile Files page can render a device's segment view (View button)
// without a second round trip; these files are small per-device logs, never bulk data.
export function getMobileRacesForUser(username, adminAccess = false) {
  const results = [];
  let owners;
  try { owners = fs.readdirSync(MOBILE_DIR); }
  catch { return results; }

  for (const owner of owners) {
    if (!adminAccess && owner !== username) continue;
    const ownerPath = path.join(MOBILE_DIR, owner);
    try { if (!fs.statSync(ownerPath).isDirectory()) continue; }
    catch { continue; }

    let raceLabels;
    try { raceLabels = fs.readdirSync(ownerPath); }
    catch { continue; }

    for (const raceLabel of raceLabels) {
      const raceDirPath = path.join(ownerPath, raceLabel);
      try { if (!fs.statSync(raceDirPath).isDirectory()) continue; }
      catch { continue; }

      let files;
      try { files = fs.readdirSync(raceDirPath); }
      catch { continue; }

      const devices = [];
      let recordCount = 0;
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'bib-allocations.json') continue;
        const deviceName = file.slice(0, -'.json'.length);
        const records = readMobileDeviceFile(owner, raceLabel, deviceName);
        recordCount += records.length;
        // File mtime — i.e. when the server last actually received a sync from this device —
        // distinct from the records' own `timestamp` fields (when each split/entry happened on
        // the phone): a device can go quiet mid-race with its last-recorded data timestamp
        // frozen in the past, so the Mobile Files page shows both to tell "we haven't heard from
        // this phone in a while" apart from "this phone hasn't recorded anything new".
        let lastSeen = null;
        try { lastSeen = fs.statSync(path.join(raceDirPath, file)).mtime.toISOString(); } catch { /* races with readdirSync above are vanishingly rare and harmless to just omit */ }
        devices.push({ name: deviceName, records: records.length, lines: records, lastSeen });
      }
      devices.sort((a, b) => a.name.localeCompare(b.name));

      results.push({
        owner, raceLabel, devices, recordCount, raceDate: parseRaceLabelDate(raceLabel),
        bibAllocations: readBibAllocations(owner, raceLabel),
      });
    }
  }

  return results.sort((a, b) => {
    if (a.raceDate && b.raceDate) {
      return b.raceDate.yy !== a.raceDate.yy ? b.raceDate.yy.localeCompare(a.raceDate.yy)
        : b.raceDate.mm !== a.raceDate.mm ? b.raceDate.mm.localeCompare(a.raceDate.mm)
        : b.raceDate.dd.localeCompare(a.raceDate.dd);
    }
    if (a.raceDate) return -1;
    if (b.raceDate) return 1;
    return a.raceLabel.localeCompare(b.raceLabel);
  });
}