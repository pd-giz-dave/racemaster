'use strict';

import fs from 'fs';
import { readBody, jsonReply } from '../http-utils.js';
import { sanitiseName } from '../datasets.js';
import { getAuthUser, isAdmin } from '../auth.js';
import {
  mobileRaceDir, mobileDeviceFilePath, readMobileDeviceFile, writeMobileDeviceFile,
  writeBibAllocations, getMobileRacesForUser,
} from '../mobile.js';
import { MOBILE_DIR } from '../config.js';
import path from 'path';

// Returns true if this request was matched and handled (a response was sent), false otherwise.
export async function handleMobileRoutes(req, res, pathname) {
  // POST /api/mobile/:owner/:raceLabel/bib-allocations — the web app pushes a race-wide
  // {raceName, raceDate, entries: [{bibNumber, name, course}]} export so any phone syncing
  // this race (WiFi or Mule/BLE) can learn which bib belongs to which course, without needing
  // registration to have closed first.
  // Checked before the broader POST /api/mobile/:raceLabel below, which would otherwise
  // swallow this path too once decoded (both start with `/api/mobile/`).
  // owner is the dataset's own owner (js/bib-allocations.js sends session.dataset's owner
  // half, not necessarily the logged-in user) — same owner-only-or-admin write rule as
  // PUT /api/data/:owner/:fullName, so this lands in the exact owner-scoped
  // mobile/<owner>/<raceLabel>/ folder this race's own per-device files already use, not
  // wherever the pushing admin happens to be logged in as.
  if (/^\/api\/mobile\/[^/]+\/[^/]+\/bib-allocations$/.test(pathname) && req.method === 'POST') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const [owner, raceLabel] = pathname.slice('/api/mobile/'.length, -'/bib-allocations'.length)
      .split('/').map(decodeURIComponent).map(sanitiseName);
    if (!owner || !raceLabel) { jsonReply(res, 400, { error: 'Invalid path' }); return true; }
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot write to another user\'s dataset' }); return true; }
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { jsonReply(res, 400, { error: 'Invalid JSON' }); return true; }
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    const payload = {
      raceName: typeof body?.raceName === 'string' ? body.raceName : '',
      raceDate: typeof body?.raceDate === 'string' ? body.raceDate : '',
      generatedAt: new Date().toISOString(),
      entries: entries
        .map(e => ({
          bibNumber: Number(e?.bibNumber) || 0,
          name: typeof e?.name === 'string' ? e.name : '',
          course: typeof e?.course === 'string' ? e.course : '',
        }))
        .filter(e => e.bibNumber > 0),
    };
    writeBibAllocations(owner, raceLabel, payload);
    console.log(`[bib-allocations] ${username} -> ${owner}/${raceLabel}: updated (${payload.entries.length} entries)`);
    jsonReply(res, 200, { ok: true });
    return true;
  }

  // POST /api/mobile/:raceLabel  —  Android App Mule Mode's sync target.
  //
  // Lands in data/mobile/<username>/<raceLabel>/<deviceName>.json — one file per physical
  // phone, not one shared file per race/user. Scoped to the *pushing* user's own folder
  // (username comes from the bearer token, never a path/body parameter) and keyed by the
  // race's own name/label as recorded on the phone — a single push (from a mule
  // that's pulled from several phones) can span more than one device, so records are
  // grouped by `deviceName` here before being written out. Each section a device appears in
  // this push is append-merged (new recordUuids added, existing ones left alone) into
  // whatever's already stored — see the merge loop below; a section for a device not
  // present in this push is left untouched.
  //
  // ┌──────────────────────────────────────────────────────────────────────────────────┐
  // │ ⚠️  BIG FAT WARNING — DO NOT ADD `await` BETWEEN readMobileDeviceFile AND         │
  // │ writeMobileDeviceFile BELOW. Multiple phones/mules can legitimately push to the  │
  // │ same race at the same time. This is only safe because Node is single-threaded    │
  // │ and each device's read → replace-sections → write is 100% synchronous with no    │
  // │ `await`/Promise/setTimeout/callback in between.                                  │
  // └──────────────────────────────────────────────────────────────────────────────────┘
  if (pathname.startsWith('/api/mobile/') && req.method === 'POST') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }

    const raceLabel = sanitiseName(decodeURIComponent(pathname.slice('/api/mobile/'.length)));
    if (!raceLabel) { jsonReply(res, 400, { error: 'Invalid race label' }); return true; }

    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { jsonReply(res, 400, { error: 'Invalid JSON' }); return true; }
    const devices = body?.devices && typeof body.devices === 'object' && !Array.isArray(body.devices) ? body.devices : null;
    if (!devices) { jsonReply(res, 400, { error: 'Expected {devices: {"<deviceName>": [...lines]}}' }); return true; }

    const coerce = (r) => ({
      recordUuid: typeof r?.recordUuid === 'string' ? r.recordUuid : '',
      action: String(r?.action || 'Finish'),
      bibNumber: r?.bibNumber ?? null,
      splitTime: r?.splitTime ?? null,
      // Which physical point on the course this record came from (e.g. "Finish", "Start",
      // "Checkpoint 2") — the Android app's RaceEntity.location, repeated on every record
      // since there's no separate per-race metadata channel on this wire protocol to send
      // it through just once. Defaults to "Finish" to match that field's own default, for
      // any record that predates this field existing.
      location: typeof r?.location === 'string' && r.location ? r.location : 'Finish',
      splitNumber: r?.splitNumber ?? null,
      // Permanent, ascending history position — see the Android app's RaceEntity.nextLineNumber.
      // What the merge logic below (and the /status route) key off for delta-sync.
      lineNumber: Number.isFinite(r?.lineNumber) ? r.lineNumber : null,
      // Non-null for an edit-echo/undo-marker record — points at the original root row's
      // lineNumber. Passed through as-is; this endpoint doesn't interpret it, it's here so
      // a downstream consumer (e.g. the racemaster web app) can eventually replay the full
      // event log in order.
      refLineNumber: Number.isFinite(r?.refLineNumber) ? r.refLineNumber : null,
      note: r?.note ?? null,
      // "yyyy/MM/dd HH:mm:ss" (the device's own local time), not a raw epoch value — the
      // Android app formats this before sending; passed through as-is. Renamed from
      // timestampMillis (which it never actually was, on this side of the wire — a
      // formatted string, not a millis count) to timestamp.
      timestamp: typeof r?.timestamp === 'string' && r.timestamp ? r.timestamp : null,
    });

    // Everything from here to writeMobileDeviceFile() must stay synchronous — see the warning above.
    let added = 0;
    let received = 0;
    let deviceCount = 0;
    for (const [rawDeviceName, records] of Object.entries(devices)) {
      if (!Array.isArray(records)) continue;
      const deviceName = sanitiseName(rawDeviceName) || 'unknown-device';
      deviceCount++;
      received += records.length;

      const current = readMobileDeviceFile(username, raceLabel, deviceName);
      const previousUuids = new Set(current.map(r => r.recordUuid).filter(Boolean));
      const genuinelyNew = records.map(coerce).filter(r => r.recordUuid && !previousUuids.has(r.recordUuid));
      added += genuinelyNew.length;
      // Append-merge, not replace: the app now sends only the lineNumber delta rather than
      // its full current record set every time, so wholesale-replacing this file with just
      // the delta would drop every previously-stored line not present in this smaller
      // payload. recordUuid still backstops dedup for a re-sent/overlapping range.
      writeMobileDeviceFile(username, raceLabel, deviceName, [...current, ...genuinelyNew]);
    }

    console.log(`[mobile-sync] ${username}/${raceLabel}: updated ${deviceCount} device file(s), ${received} record(s) received`);
    jsonReply(res, 200, { ok: true, added, received, version: 1 });
    return true;
  }

  // DELETE /api/mobile/:owner/:raceLabel/:deviceName  —  Mobile Files page's Delete button.
  // Owner or admin only. Also removes the raceLabel/owner directories once they're left empty.
  if (/^\/api\/mobile\/[^/]+\/[^/]+\/[^/]+$/.test(pathname) && req.method === 'DELETE') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }

    const [owner, raceLabel, deviceName] = pathname.slice('/api/mobile/'.length).split('/').map(decodeURIComponent).map(sanitiseName);
    if (!owner || !raceLabel || !deviceName) { jsonReply(res, 400, { error: 'Invalid path' }); return true; }
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot delete another user\'s mobile file' }); return true; }

    const fp = mobileDeviceFilePath(owner, raceLabel, deviceName);
    if (!fs.existsSync(fp)) { jsonReply(res, 404, { error: 'Not found' }); return true; }
    fs.unlinkSync(fp);

    const raceDir = mobileRaceDir(owner, raceLabel);
    try { if (fs.readdirSync(raceDir).length === 0) fs.rmdirSync(raceDir); } catch { /* not empty, or already gone */ }
    const ownerDirPath = path.join(MOBILE_DIR, owner);
    try { if (fs.readdirSync(ownerDirPath).length === 0) fs.rmdirSync(ownerDirPath); } catch { /* not empty, or already gone */ }

    console.log(`[mobile-files] ${username} deleted ${owner}/${raceLabel}/${deviceName}`);
    jsonReply(res, 200, { ok: true });
    return true;
  }

  // GET /api/mobile/:raceLabel/status  —  lets a phone ask what the server already has,
  // per device, for this race before pushing — so it only needs to send the lineNumber
  // delta rather than resending everything every time. Scoped to the requesting user's
  // own folder, same as the POST route above. Returns the max lineNumber for every device
  // file already stored under this race, e.g. {"clever-gecko": 12, "quiet-thicket": 7} — a
  // device absent from the response (or with a value of 0) means the server has nothing
  // for it yet.
  if (/^\/api\/mobile\/[^/]+\/status$/.test(pathname) && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }

    const raceLabel = sanitiseName(decodeURIComponent(pathname.slice('/api/mobile/'.length, -'/status'.length)));
    if (!raceLabel) { jsonReply(res, 400, { error: 'Invalid race label' }); return true; }

    const dir = mobileRaceDir(username, raceLabel);
    const result = {};
    let files = [];
    try { files = fs.readdirSync(dir); } catch { /* no folder yet — nothing pushed for this race */ }
    const maxLineNumber = (records) => records.reduce((max, r) => Math.max(max, r.lineNumber || 0), 0);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const deviceName = file.slice(0, -'.json'.length);
      result[deviceName] = maxLineNumber(readMobileDeviceFile(username, raceLabel, deviceName));
    }
    jsonReply(res, 200, result);
    return true;
  }

  // GET /api/mobile  — races/devices under mobile/. Own races only, unless admin (all users').
  if (pathname === '/api/mobile' && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    jsonReply(res, 200, getMobileRacesForUser(username, isAdmin(username)));
    return true;
  }

  return false;
}