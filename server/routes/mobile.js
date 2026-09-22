'use strict';

import fs from 'fs';
import { readBody, jsonReply } from '../http-utils.js';
import { sanitiseName } from '../datasets.js';
import { getAuthUser, isAdmin } from '../auth.js';
import {
  mobileRaceDir, mobileDeviceFilePath, readMobileDeviceFile, writeMobileDeviceFile,
  mergeProgress, touchProgress, readProgress, progressIsUnchanged,
  getMobileRacesForUser, getMobileRacesStatusForUser, getAvailableRacesForUser,
} from '../mobile.js';
import { MOBILE_DIR } from '../config.js';
import path from 'path';

// Returns true if this request was matched and handled (a response was sent), false otherwise.
// `since` is only read by GET .../progress below (a query-string value, extracted once in
// server/router.js the same way that file already extracts `force` for handleDatasetRoutes) —
// every other route in this file ignores it. `maxAgeDays` is only read by GET /api/mobile/races.
export async function handleMobileRoutes(req, res, pathname, since, maxAgeDays) {
  // POST /api/mobile/:owner/:raceLabel/progress — the web app pushes changes to the Mobile Files
  // page's own Progress tab contents, race-wide: {raceName, raceDate, entries: [{bibNumber, name,
  // category, course, startTime, finishTime, cpTimes}], removed: [bibNumber, ...]} — only the
  // entries that actually changed since the web app's own last successful push for this race
  // label (see js/progress-sync.js), not its full recomputed set every time; `removed` names any
  // bib no longer present at all (e.g. an Entries deletion), the one thing a pure upsert can't
  // express. mergeProgress() (server/mobile.js) does the actual upsert-by-bibNumber merge into
  // whatever's already stored, mirroring POST /api/mobile/:raceLabel's own merge-by-lineNumber
  // shape — this route used to just replace the whole file every time, back when the web app sent
  // everything on every push; see mergeProgress's own doc for why that's no longer good enough
  // (metered mobile data + unreliable field connectivity, per TODO.md's own delta-payload
  // correction).
  // Checked before the broader POST /api/mobile/:raceLabel below, which would otherwise swallow
  // this path too once decoded (both start with `/api/mobile/`).
  // owner is the dataset's own owner (js/progress-sync.js sends session.dataset's owner half,
  // not necessarily the logged-in user) — same owner-only-or-admin write rule as
  // PUT /api/data/:owner/:fullName, so this lands in the exact owner-scoped
  // mobile/<owner>/<raceLabel>/ folder this race's own per-device files already use, not
  // wherever the pushing admin happens to be logged in as.
  if (/^\/api\/mobile\/[^/]+\/[^/]+\/progress$/.test(pathname) && req.method === 'POST') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const [owner, raceLabel] = pathname.slice('/api/mobile/'.length, -'/progress'.length)
      .split('/').map(decodeURIComponent).map(sanitiseName);
    if (!owner || !raceLabel) { jsonReply(res, 400, { error: 'Invalid path' }); return true; }
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot write to another user\'s dataset' }); return true; }
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { jsonReply(res, 400, { error: 'Invalid JSON' }); return true; }
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    // cpTimes is a plain {cpNumber: 'HH:MM:SS' | 'Retire'} object (see js/mobile-files-progress.js's
    // buildProgressRows()) — sanitised key-by-key rather than trusted wholesale.
    const sanitiseCpTimes = cp => {
      const out = {};
      if (cp && typeof cp === 'object') {
        for (const [k, v] of Object.entries(cp)) {
          const n = Number(k);
          if (Number.isFinite(n) && n > 0 && typeof v === 'string') out[n] = v;
        }
      }
      return out;
    };
    const sanitisedEntries = entries
      .map(e => ({
        bibNumber: Number(e?.bibNumber) || 0,
        name: typeof e?.name === 'string' ? e.name : '',
        category: typeof e?.category === 'string' ? e.category : '',
        course: typeof e?.course === 'string' ? e.course : '',
        startTime: typeof e?.startTime === 'string' ? e.startTime : '',
        finishTime: typeof e?.finishTime === 'string' ? e.finishTime : '',
        cpTimes: sanitiseCpTimes(e?.cpTimes),
      }))
      .filter(e => e.bibNumber > 0);
    const removed = Array.isArray(body?.removed) ? body.removed.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    const merged = mergeProgress(owner, raceLabel, {
      raceName: typeof body?.raceName === 'string' ? body.raceName : '',
      raceDate: typeof body?.raceDate === 'string' ? body.raceDate : '',
      entries: sanitisedEntries,
      removed,
    });
    if (!merged) {
      console.log(`[progress] ${username} -> ${owner}/${raceLabel}: no progress and no changes, progress file not created`);
    } else {
      console.log(`[progress] ${username} -> ${owner}/${raceLabel}: merged ${sanitisedEntries.length} changed, ${removed.length} removed (${merged.entries.length} total)`);
    }
    jsonReply(res, 200, { ok: true });
    return true;
  }

  // POST /api/mobile/:owner/:raceLabel/progress/touch — "Activate Race" (js/views/event.js):
  // refreshes progress.json's own generatedAt to now with no entries re-sent at all, purely a
  // "this race is current" signal for the mobile app's own server-race-scan (see
  // touchProgress's own doc in server/mobile.js). Same owner-or-admin rule as the progress POST
  // route above. Checked before the broader POST /api/mobile/:raceLabel below for the same reason
  // that route is.
  if (/^\/api\/mobile\/[^/]+\/[^/]+\/progress\/touch$/.test(pathname) && req.method === 'POST') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const [owner, raceLabel] = pathname.slice('/api/mobile/'.length, -'/progress/touch'.length)
      .split('/').map(decodeURIComponent).map(sanitiseName);
    if (!owner || !raceLabel) { jsonReply(res, 400, { error: 'Invalid path' }); return true; }
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot write to another user\'s dataset' }); return true; }
    const touched = touchProgress(owner, raceLabel);
    console.log(`[progress] ${username} -> ${owner}/${raceLabel}: activated (generatedAt=${touched.generatedAt})`);
    jsonReply(res, 200, { ok: true, generatedAt: touched.generatedAt });
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
  // this push is append-merged (new lineNumbers added, existing ones left alone) into
  // whatever's already stored — see the merge loop below; a section for a device not
  // present in this push is left untouched.
  //
  // Exception: a "NewRace" record anywhere in a device's own section (racemaster-mobile's
  // HistoryAction.NEW_RACE — always that device's own very first history line for a brand-new
  // race) means this file's whole existing content is from a DIFFERENT, since-superseded race
  // that merely reused the same label — a local race deleted and recreated under an identical
  // name (confirmed in the field: a genuine Stop permanently masked by a stale Reset left over
  // from an earlier race at the very same lineNumber). Wipe that device's file and write only
  // this push's own records in that case, instead of merging — see the loop below.
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
      action: String(r?.action || 'Finish'),
      bibNumber: r?.bibNumber ?? null,
      splitTime: r?.splitTime ?? null,
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

      const previousFile = readMobileDeviceFile(username, raceLabel, deviceName);
      // See this route's own doc above — a NewRace marker means whatever's already stored is
      // stale, from a different race that reused this exact label. Checked against the RAW
      // records (before coerce()'s own 'Finish' fallback applies to a missing/falsy action),
      // same as every other field this loop reads off them.
      const startingFresh = records.some(r => r?.action === 'NewRace');
      if (startingFresh && previousFile.length > 0) {
        console.log(`[mobile-sync] ${username}/${raceLabel}/${deviceName}: NewRace marker — discarding ${previousFile.length} stale line(s) from a previous race under this label`);
      }
      const current = startingFresh ? [] : previousFile;
      const previousLineNumbers = new Set(current.map(r => r.lineNumber).filter(n => Number.isFinite(n)));
      const genuinelyNew = records.map(coerce).filter(r => Number.isFinite(r.lineNumber) && !previousLineNumbers.has(r.lineNumber));
      added += genuinelyNew.length;
      // Append-merge, not replace: the app now sends only the lineNumber delta rather than
      // its full current record set every time, so wholesale-replacing this file with just
      // the delta would drop every previously-stored line not present in this smaller
      // payload. lineNumber still backstops dedup for a re-sent/overlapping range — this file
      // is already scoped to one device (its own filename), so a bare lineNumber is already
      // unambiguous here, the same way the /status route's own maxLineNumber cursor treats it.
      // (startingFresh's own `current = []` above makes this a full replace in that one case.)
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

  // GET /api/mobile/:raceLabel/progress?knownGeneratedAt=<ISO>  —  lets a phone fetch race-wide
  // progress directly from the server, bypassing Bluetooth entirely (the HTTP twin of the BLE
  // delivery in js/mule-ble.js's pullFromConnectedPhone/deliverProgress). Scoped to the
  // requesting user's own folder, same as GET .../status above — an admin's phone would need to
  // log in as the race's actual owner account for this to find the right folder, the same
  // pre-existing limitation that route already has. Requires login like every other mobile sync
  // endpoint here — deliberately NOT the same as progress.json's own incidental, unauthenticated
  // exposure via the generic static-file route (server/routes/static.js serves anything under
  // repo root, MOBILE_DIR included, with no auth check at all — untouched, out of scope here;
  // this is the properly-gated path going forward).
  //
  // `since` (an entry's own `updatedAt` cursor, e.g. whatever generatedAt this caller last saw)
  // is optional. When it matches what's on disk exactly, the response omits `entries` and returns
  // {unchanged: true, generatedAt} instead — the fast-path bandwidth-saving mechanism this route
  // has always had. Otherwise, `entries` is filtered down to only those whose own `updatedAt` is
  // newer than `since` (see mergeProgress's own doc for where that per-entry stamp comes from) —
  // a delta, not the whole race's entries every time; omitting `since` entirely still returns
  // everything, for a caller with nothing cached yet. There's no ETag/304 convention anywhere in
  // this server (a real conditional-GET would mean bypassing jsonReply for no real benefit here)
  // — this reuses the same "cheap JSON sentinel" idiom getMobileRacesStatusForUser already
  // established for the equivalent per-device problem.
  if (/^\/api\/mobile\/[^/]+\/progress$/.test(pathname) && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }

    const raceLabel = sanitiseName(decodeURIComponent(pathname.slice('/api/mobile/'.length, -'/progress'.length)));
    if (!raceLabel) { jsonReply(res, 400, { error: 'Invalid race label' }); return true; }

    const progress = readProgress(username, raceLabel);
    if (!progress) { jsonReply(res, 404, { error: 'No progress recorded for this race yet' }); return true; }

    if (progressIsUnchanged(progress, since)) {
      jsonReply(res, 200, { unchanged: true, generatedAt: progress.generatedAt });
    } else {
      const entries = since ? progress.entries.filter(e => e.updatedAt && e.updatedAt > since) : progress.entries;
      jsonReply(res, 200, {
        unchanged: false, generatedAt: progress.generatedAt,
        raceName: progress.raceName, raceDate: progress.raceDate, entries,
      });
    }
    return true;
  }

  // GET /api/mobile/races?maxAgeDays=N — the mobile app's setup-time server-race-scan (see
  // getAvailableRacesForUser's own doc in server/mobile.js for why this is a separate, lean route
  // rather than client-side filtering of GET /api/mobile below). Checked before that route since
  // both are exact-pathname matches with no prefix relationship, order doesn't actually matter
  // between them, but kept together for readability. maxAgeDays is required — a malformed/missing
  // value is a 400, not a silent "no filtering" fallback, since an unfiltered scan is exactly the
  // heavy behavior this route exists to avoid.
  if (pathname === '/api/mobile/races' && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const parsedMaxAgeDays = Number(maxAgeDays);
    if (!Number.isFinite(parsedMaxAgeDays) || parsedMaxAgeDays <= 0) {
      jsonReply(res, 400, { error: 'maxAgeDays must be a positive number' });
      return true;
    }
    jsonReply(res, 200, getAvailableRacesForUser(username, parsedMaxAgeDays, isAdmin(username)));
    return true;
  }

  // GET /api/mobile/status  —  lightweight "has anything changed" probe for the whole listing
  // (unlike GET /api/mobile/:raceLabel/status above, which is per-race and the requesting
  // user's own folder only). Same owner/admin scoping as GET /api/mobile below, but each
  // device file costs one fs.statSync (mtime+size) instead of a full read+parse — see
  // getMobileRacesStatusForUser's own doc in server/mobile.js. Used by the web app's own
  // background poll (js/views/mobile-files.js) to decide whether the full GET /api/mobile
  // fetch is actually worth making this tick.
  if (pathname === '/api/mobile/status' && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    jsonReply(res, 200, getMobileRacesStatusForUser(username, isAdmin(username)));
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