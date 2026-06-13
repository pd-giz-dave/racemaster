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
const STANDALONE_KEY = 'racemaster-standalone'; // localStorage: standalone mode flag

export const hasFSA = false;

let _syncTimer = null;

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
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(DATASET_KEY);
}

export function isDirty() {
  return localStorage.getItem(DIRTY_KEY) === 'true';
}

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

/** Create a new dataset and push the current local cache into it without switching. */
export async function saveAsDataset(token, owner, name, visibility) {
  const createRes = await fetch('/api/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name, visibility }),
  });
  const created = await createRes.json();
  if (created.error) return created;

  const pushRes = await fetch(`/api/data/${owner}/${created.fullName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: localStorage.getItem(CACHE_KEY) || '{}',
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

async function syncToServer() {
  if (localStorage.getItem(DIRTY_KEY) !== 'true') return;
  const session = getSession();
  if (!session) return;
  try {
    const res = await fetch(`/api/data/${session.dataset}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`,
      },
      body: localStorage.getItem(CACHE_KEY) || '{}',
    });
    if (res.ok) { localStorage.removeItem(DIRTY_KEY); notifyDirty(); }
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
export async function restoreDirectory() {
  const session = getSession();
  if (!session) return true; // standalone — use localStorage cache

  if (localStorage.getItem(DIRTY_KEY) === 'true') {
    await syncToServer();
  }
  try {
    const res = await fetch(`/api/data/${session.dataset}`, {
      headers: { 'Authorization': `Bearer ${session.token}` },
    });
    if (res.status === 401) {
      clearSession(); // token expired (server restarted) — fall through to cache
    } else if (res.ok) {
      const serverData = await res.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(serverData));
      localStorage.removeItem(DIRTY_KEY);
    }
  } catch {
    // Server unreachable — use localStorage cache as-is
  }
  return true;
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

/** Not used with server storage — kept for call-site compatibility */
export async function readText()  { return null; }
export async function writeText() {}

/** Return the full cache as a plain object (all tables that exist). */
export function dumpState() { return cacheLoad(); }

/** Replace the full cache with the given object and push to server. */
export async function restoreState(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(DIRTY_KEY, 'true');
  notifyDirty();
  await syncToServer();
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