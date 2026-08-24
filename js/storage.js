'use strict';

import { formatCSV } from './csv.js';

// ============================================================
// Offline-first server-backed storage.
//
// Startup  — push any pending local changes to the server, then
//            pull the full JSON state into localStorage.  Falls
//            back to the cached copy if the server is offline.
// Runtime  — all reads/writes hit localStorage immediately.
//            A debounced task syncs the full state to the server
//            2 s after the last write, whenever it is reachable.
//
// Server endpoints (server.js):
//   POST /api/auth/login         { username, password } → { token, username }
//   POST /api/auth/create        { username, password } → { token, username }
//   GET  /api/datasets           → string[]
//   POST /api/datasets           { name } → { ok, name }
//   GET  /api/data/:dataset      → full JSON state
//   PUT  /api/data/:dataset      → replace full JSON state → { ok }
// ============================================================

const CACHE_KEY      = 'racemaster-data';       // localStorage: full state object
const DIRTY_KEY      = 'racemaster-dirty';      // localStorage: unsynced changes flag
const TOKEN_KEY      = 'racemaster-token';      // localStorage: auth token
const DATASET_KEY    = 'racemaster-dataset';    // localStorage: current dataset name
const USERNAME_KEY   = 'racemaster-username';   // localStorage: logged-in username
const IS_ADMIN_KEY   = 'racemaster-isadmin';    // localStorage: admin flag
const STANDALONE_KEY = 'racemaster-standalone'; // localStorage: standalone mode flag

let _syncTimer    = null;
let _conflicted   = false;

// Fetch with a hard timeout — a stalled response (e.g. reconnecting after being
// offline) must not hang the caller forever and leave the app stuck on "Loading…".
async function fetchTimed(url, opts = {}, ms = 15000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- Session management ----

export function getSession() {
  const token   = localStorage.getItem(TOKEN_KEY);
  const dataset = localStorage.getItem(DATASET_KEY);
  if (!token || !dataset) return null;
  return { token, dataset };
}

export function setSession(token, dataset) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(DATASET_KEY, dataset);
  localStorage.removeItem(STANDALONE_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(DATASET_KEY);
}

export function clearCredentials() {
  localStorage.removeItem(USERNAME_KEY);
  localStorage.removeItem(IS_ADMIN_KEY);
}

export function getUsername() { return localStorage.getItem(USERNAME_KEY) || ''; }
export function setUsername(u) { localStorage.setItem(USERNAME_KEY, u || ''); }
export function getIsAdmin()   { return localStorage.getItem(IS_ADMIN_KEY) === 'true'; }
export function setIsAdmin(v)  { localStorage.setItem(IS_ADMIN_KEY, v ? 'true' : 'false'); }

export function isDirty() {
  return localStorage.getItem(DIRTY_KEY) === 'true';
}

export function getVersion()     { return cacheLoad()._version || 0; }
export function isConflicted()  { return _conflicted; }

export function hasCachedData() {
  const data = cacheLoad();
  return Object.values(data).some(v => Array.isArray(v) && v.length > 0);
}

export function isStandalone() {
  return localStorage.getItem(STANDALONE_KEY) === 'true';
}

export function setStandalone(value) {
  if (value) localStorage.setItem(STANDALONE_KEY, 'true');
  else        localStorage.removeItem(STANDALONE_KEY);
}

// ---- Auth API calls ----

export async function apiLogin(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function apiCreateAccount(username, password) {
  const res = await fetch('/api/auth/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function apiListDatasets(token) {
  const res = await fetch('/api/datasets', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function apiCreateDataset(token, name, visibility) {
  const res = await fetch('/api/datasets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name, visibility }),
  });
  return res.json();
}

export async function apiChangeVisibility(token, owner, fullName, visibility) {
  const res = await fetch(`/api/datasets/${owner}/${fullName}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ visibility }),
  });
  return res.json();
}

export async function apiCopyDataset(token, fromOwner, fromFullName, toName, visibility) {
  const res = await fetch('/api/datasets/copy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ fromOwner, fromFullName, toName, visibility }),
  });
  return res.json();
}

export async function apiDeleteDataset(token, owner, fullName) {
  const res = await fetch(`/api/datasets/${owner}/${fullName}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

export async function apiListMobileFiles(token) {
  const res = await fetch('/api/mobile', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function apiDeleteMobileFile(token, owner, raceLabel, deviceName) {
  const res = await fetch(`/api/mobile/${owner}/${encodeURIComponent(raceLabel)}/${encodeURIComponent(deviceName)}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

// Same endpoint a phone's own WiFi sync posts to (server.js's POST /api/mobile/:raceLabel) —
// used to push a Bluetooth-pulled device file (see mule-ble.js) into the server exactly as if
// the phone had sent it directly.
export async function apiPushMobileSync(token, raceLabel, deviceName, lines) {
  const res = await fetch(`/api/mobile/${encodeURIComponent(raceLabel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ devices: { [deviceName]: lines } }),
  });
  return res.json();
}

// Pushes a race-wide {raceName, raceDate, entries} bib/name/course export to
// server.js's POST /api/mobile/:owner/:raceLabel/bib-allocations — see js/bib-allocations.js.
// owner is the current dataset's own owner (not necessarily the logged-in user — an admin can
// push this for someone else's dataset), same as every other owner-scoped mobile/dataset route.
export async function apiPushBibAllocations(token, owner, raceLabel, payload) {
  const res = await fetch(`/api/mobile/${owner}/${encodeURIComponent(raceLabel)}/bib-allocations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ---- Bluetooth-pulled files pending an eventual server push (field use, no network) ----
//
// Keyed by owner (the signed-in user at pull time) + raceLabel + deviceName, same identity a
// server-stored file has, so a pending entry and its eventually-pushed server copy are never
// mistaken for two different files. Lives entirely in this browser — there is deliberately no
// server counterpart until it's actually pushed.

const PENDING_MOBILE_KEY = 'racemaster-pending-mobile';

function loadPendingMobileFiles() {
  try { return JSON.parse(localStorage.getItem(PENDING_MOBILE_KEY) || '[]'); } catch { return []; }
}

function storePendingMobileFiles(list) {
  localStorage.setItem(PENDING_MOBILE_KEY, JSON.stringify(list));
}

export function getPendingMobileFiles() {
  return loadPendingMobileFiles();
}

// Append-merges [lines] into any existing pending entry for this device (deduped by
// recordUuid), rather than replacing it outright — mule-ble.js's Bluetooth pulls now request
// only the delta since last time (see its own getLastPulledLineNumber), so a failed push after
// a second pull must not overwrite (and so silently lose) records from an earlier pull that
// never made it to the server yet. Same append-merge semantics as server.js's own POST
// /api/mobile/:raceLabel, which this is standing in for while the server's unreachable.
//
// deviceId (the true origin device's own stable id from mule-ble.js's pull result, never the
// connected Mule's for a relayed entry) is carried alongside purely so a later Discard can call
// mule-ble.js's resetLastPulledLineNumber — without it, discarding this copy would leave that
// delta cursor advanced past the very data just thrown away, and the next pull would only
// fetch what's new since then instead of the whole file again.
export function savePendingMobileFile(owner, raceLabel, deviceName, deviceId, lines) {
  const list = loadPendingMobileFiles();
  const existing = list.find(f => f.owner === owner && f.raceLabel === raceLabel && f.deviceName === deviceName);
  if (existing) {
    const seenUuids = new Set(existing.lines.map(l => l.recordUuid).filter(Boolean));
    existing.lines = [...existing.lines, ...lines.filter(l => l.recordUuid && !seenUuids.has(l.recordUuid))];
    existing.deviceId = deviceId;
    existing.pulledAt = new Date().toISOString();
  } else {
    list.push({ owner, raceLabel, deviceName, deviceId, lines, pulledAt: new Date().toISOString() });
  }
  storePendingMobileFiles(list);
}

export function removePendingMobileFile(owner, raceLabel, deviceName) {
  storePendingMobileFiles(loadPendingMobileFiles().filter(f => !(f.owner === owner && f.raceLabel === raceLabel && f.deviceName === deviceName)));
}

// Scenario this exists for: web-app offline, phones also offline, a Bluetooth pull lands in
// the pending queue above because pullAndSyncConnectedPhone()'s own push attempt failed —
// then the web-app comes back online. Without this, that data only ever leaves the browser if
// someone remembers to click Push on the Mobile Files page. Called from connect.js's
// pingServerNow() on every successful ping, so it naturally retries each tick until it
// succeeds; reuses the exact same push call (and so the exact same delta data — the pending
// queue only ever holds what mule-ble.js pulled since its own last-pulled cursor) that the
// manual Push button and the initial BLE-pull push already use — just triggered automatically
// instead of by a click. flushInProgress guards against a slow flush still running when the
// next tick's ping succeeds again.
let flushInProgress = false;
export async function flushPendingMobileFiles() {
  if (flushInProgress) return;
  const session = getSession();
  if (!session) return;
  const owner = getUsername();
  const pending = loadPendingMobileFiles().filter(f => f.owner === owner);
  if (!pending.length) return;
  flushInProgress = true;
  try {
    for (const f of pending) {
      let result;
      try {
        result = await apiPushMobileSync(session.token, f.raceLabel, f.deviceName, f.lines);
      } catch {
        return; // server went unreachable again mid-flush — leave the rest queued for next tick
      }
      if (result.error) continue; // leave this one queued rather than silently dropping its data
      removePendingMobileFile(f.owner, f.raceLabel, f.deviceName);
    }
  } finally {
    flushInProgress = false;
  }
}

export async function apiListUsers(token) {
  const res = await fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } });
  return res.json();
}

export async function apiSetUserAdmin(token, username, makeAdmin) {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ isAdmin: makeAdmin }),
  });
  return res.json();
}

export async function apiDeleteUser(token, username) {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

export async function apiReadDataset(token, owner, fullName) {
  const res = await fetch(`/api/data/${owner}/${fullName}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Create a new dataset and push the current local cache into it without switching. */
export async function saveAsDataset(token, owner, name, visibility) {
  const createRes = await fetch('/api/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name, visibility }),
  });
  const created = await createRes.json();
  if (created.error) return created;

  const saveData = cacheLoad();
  saveData._version = 1; // new dataset always starts at version 1
  const pushRes = await fetch(`/api/data/${owner}/${created.fullName}?force=true`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(saveData),
  });
  if (!pushRes.ok) return { error: 'Dataset created but push failed' };
  return created;
}

// ---- Local cache ----

function cacheLoad() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function notifyDirty() {
  window.dispatchEvent(new CustomEvent('racemaster-dirty-change'));
}

function cacheSaveTable(table, rows) {
  try {
    const cache = cacheLoad();
    cache[table] = rows;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    localStorage.setItem(DIRTY_KEY, 'true');
    notifyDirty();
  } catch (e) {
    console.warn('localStorage write failed:', e.message);
  }
}

// ---- Server sync ----

function notifyConflict() {
  window.dispatchEvent(new CustomEvent('racemaster-conflict'));
}

async function syncToServer(force = false, silent = false) {
  if (_conflicted) return;
  if (localStorage.getItem(DIRTY_KEY) !== 'true') return;
  const session = getSession();
  if (!session) return;
  try {
    const url = `/api/data/${session.dataset}${force ? '?force=true' : ''}`;
    const res = await fetchTimed(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`,
      },
      body: localStorage.getItem(CACHE_KEY) || '{}',
    });
    if (res.ok) {
      const { version } = await res.json();
      const cache = cacheLoad();
      cache._version = version;
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      localStorage.removeItem(DIRTY_KEY);
      notifyDirty();
    } else if (res.status === 409) {
      _conflicted = true;
      if (!silent) notifyConflict();
    }
  } catch {
    // Server unreachable — dirty flag persists; will retry on next write
  }
}

function scheduleSyncToServer() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToServer, 2000);
}

// ---- Public API ----

/**
 * On startup: push any pending local changes, then pull fresh state from server.
 * Always returns true — the app always proceeds using whatever data is available.
 * Standalone mode (no session): uses localStorage cache as-is.
 * On 401 (token expired / server restarted): clears session, uses cache.
 * On network error: falls back to cache.
 */
// Returns true if the server was actually reached (or there was no session to reach it with),
// false if it fell back to the local cache because the server was unreachable — callers that
// need to tell a genuine connect from a silent offline fallback (e.g. datasets.js's Connect
// button) can use this; callers that don't care (e.g. app.js's own startup load) can ignore it.
export async function restoreDirectory() {
  const session = getSession();
  if (!session) return true; // standalone — use localStorage cache

  if (localStorage.getItem(DIRTY_KEY) === 'true') {
    await syncToServer(false); // not silent — a 409 here must surface to the user
    // Conflict: another session already saved a newer version. Do NOT fall through
    // to the GET below — that would silently overwrite these unsynced local edits.
    // Leave the cache dirty and let the conflict dialog (connect.js) decide.
    if (_conflicted) return true;
  }
  try {
    const res = await fetchTimed(`/api/data/${session.dataset}`, {
      headers: { 'Authorization': `Bearer ${session.token}` },
    });
    if (res.status === 401) {
      clearSession(); // token expired — fall through to cache
    } else if (res.ok) {
      const serverData = await res.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(serverData));
      localStorage.removeItem(DIRTY_KEY);
      _conflicted = false;
    }
  } catch {
    // Server unreachable (or timed out) — use localStorage cache as-is
    return false;
  }
  return true;
}

/** Explicitly discard unsynced local edits after a conflict, so the next
 *  restoreDirectory() pulls a clean copy from the server instead of retrying
 *  a push that will just conflict again. */
export function discardConflict() {
  localStorage.removeItem(DIRTY_KEY);
  _conflicted = false;
}

/**
 * Switch to a different dataset.
 * pushFirst=true: push any dirty local state to the target dataset before fetching.
 * pushFirst=false (default): discard local cache and fetch fresh from server.
 * dataset is stored as 'owner/fullName' where fullName = 'name-private' | 'name-public'.
 */
export async function switchDataset(token, owner, fullName, { pushFirst = false } = {}) {
  setSession(token, `${owner}/${fullName}`);
  if (!pushFirst) {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(DIRTY_KEY);
  }
  return restoreDirectory();
}

/** Read a table from the local cache by name. Returns [] if not found. */
export async function readTable(table) {
  const data = cacheLoad()[table];
  return Array.isArray(data) ? data : [];
}

/** Write a table to the local cache immediately, then schedule a server sync. */
export async function writeTable(table, rows) {
  cacheSaveTable(table, rows);
  scheduleSyncToServer();
}

/** Return the full cache as a plain object (all tables that exist). */
export function dumpState() { return cacheLoad(); }

/** Replace the full cache with the given object and push to server. */
export async function restoreState(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(DIRTY_KEY, 'true');
  notifyDirty();
  await syncToServer(true); // force — intentional overwrite from imported file
}

/** Download rows as a CSV file to the local filesystem */
export function downloadCSV(filename, rows, fields) {
  const text = formatCSV(rows, fields);
  const blob = new Blob([text], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}