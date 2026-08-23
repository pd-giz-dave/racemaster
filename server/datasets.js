'use strict';

import fs from 'fs';
import path from 'path';
import { DATA_DIR, RESULTS_DIR, ROOT } from './config.js';
import { readUsers } from './auth.js';

// Sanitise to lowercase alphanumeric / hyphen / underscore, max 64 chars
export function sanitiseName(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64).toLowerCase();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Dataset names must not contain "public" or "private" (reserved as suffixes)
export function containsVisibility(name) {
  return /public|private/i.test(name);
}

// data/<owner>/<name>-<visibility>.json
export function dataFilePath(owner, fullName) {
  return path.join(DATA_DIR, owner, `${fullName}.json`);
}

export function ownerDir(owner) {
  return path.join(DATA_DIR, owner);
}

// Every published result copies publish.css/publish.js from js/publish/ into results/
// at publish time (see /api/publish-results), so that's the single source of truth for
// them going forward. If the source has since moved on (a deploy) and no result has been
// republished, results/ still holds the stale copies every published page links to —
// this brings them back in sync whenever the results listing is loaded.
const PUBLISH_ASSET_NAMES = ['publish.css', 'publish.js'];

export function syncPublishAssetsIfStale() {
  for (const name of PUBLISH_ASSET_NAMES) {
    const srcPath = path.join(ROOT, 'js', 'publish', name);
    let srcContent;
    try { srcContent = fs.readFileSync(srcPath); } catch { continue; } // no source to sync from

    const destPath = path.join(RESULTS_DIR, name);
    let destContent = null;
    try { destContent = fs.readFileSync(destPath); } catch { /* missing — treat as stale */ }

    if (destContent === null || !srcContent.equals(destContent)) {
      fs.writeFileSync(destPath, srcContent);
      console.log(`[results] synced stale asset into results/: ${name}`);
    }
  }
}

export function readDataset(owner, fullName) {
  const fp = dataFilePath(owner, fullName);
  if (!fs.existsSync(fp)) return {};
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return {}; }
}

export function writeDataset(owner, fullName, data) {
  const dir = ownerDir(owner);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFilePath(owner, fullName), JSON.stringify(data, null, 2), 'utf8');
}

export function emptyDataset() {
  return { _version: 1 };
}

// Returns array of { owner, name, fullName, visibility, orphaned } visible to username.
// adminAccess=true shows all datasets including other users' private ones.
export function getDatasetsForUser(username, adminAccess = false) {
  const knownUsers = readUsers();
  const results = [];
  let entries;
  try { entries = fs.readdirSync(DATA_DIR); }
  catch { return results; }

  for (const entry of entries) {
    const entryPath = path.join(DATA_DIR, entry);
    try { if (!fs.statSync(entryPath).isDirectory()) continue; }
    catch { continue; }
    const owner = entry;
    let files;
    try { files = fs.readdirSync(entryPath); }
    catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const base = file.slice(0, -5);
      let visibility, name;
      if (base.endsWith('-private')) { visibility = 'private'; name = base.slice(0, -8); }
      else if (base.endsWith('-public')) { visibility = 'public';  name = base.slice(0, -7); }
      else continue;

      if (visibility === 'private' && owner !== username && !adminAccess) continue;

      const data = readDataset(owner, base);
      const ev   = Array.isArray(data.event) ? data.event[0] : null;
      results.push({ owner, name, fullName: base, visibility,
        eventName: ev?.name || '', eventDate: ev?.date || '',
        orphaned: !knownUsers[owner] });
    }
  }

  return results.sort((a, b) =>
    a.owner !== b.owner ? a.owner.localeCompare(b.owner) : a.name.localeCompare(b.name)
  );
}