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
//   GET  /api/data  → full JSON state
//   PUT  /api/data  → replace full JSON state
// ============================================================

const API        = '/api/data';
const CACHE_KEY  = 'racemaster-data';   // localStorage key for state
const DIRTY_KEY  = 'racemaster-dirty';  // localStorage flag: unsynced changes exist
const SYNC_DELAY = 2000;                // ms to wait before pushing to server


export const hasFSA = false;

let _syncTimer = null;

// ---- Local cache ----

function cacheLoad() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function cacheSaveTable(table, rows) {
  try {
    const cache = cacheLoad();
    cache[table] = rows;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    localStorage.setItem(DIRTY_KEY, 'true');
  } catch (e) {
    console.warn('localStorage write failed:', e.message);
  }
}

// ---- Server sync ----

async function syncToServer() {
  if (localStorage.getItem(DIRTY_KEY) !== 'true') return;
  try {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: localStorage.getItem(CACHE_KEY) || '{}',
    });
    if (res.ok) localStorage.removeItem(DIRTY_KEY);
  } catch {
    // Server unreachable — dirty flag persists; will retry on next write
  }
}

function scheduleSyncToServer() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToServer, SYNC_DELAY);
}

// ---- Public API ----

/**
 * On startup: push any pending local changes, then pull fresh state from server.
 * Falls back to the localStorage cache if the server is offline.
 * Always returns truthy so loadAll() proceeds regardless.
 */
export async function restoreDirectory() {
  // Push local changes before pulling, so offline edits aren't overwritten
  if (localStorage.getItem(DIRTY_KEY) === 'true') {
    await syncToServer();
  }
  try {
    const res = await fetch(API);
    if (res.ok) {
      const serverData = await res.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(serverData));
      localStorage.removeItem(DIRTY_KEY);
    }
  } catch {
    // Use existing localStorage cache as-is
  }
  return true;
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