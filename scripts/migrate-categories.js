#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// One-off migration over every data/ JSON file: converts category rows from the old 8-field
// per-gender shape (maleMinAge/maleCat/maleRef/maleMaxDist + female...) to the new 5-field
// shared shape (minAge/maleCat/femaleCat/ref/maxDist — see js/schema.js's createCategory), and
// drops the fraPreset/wfraPreset tables, now built-in constants rather than stored data.
// Idempotent — safe to rerun. Usage: node scripts/migrate-categories.js

const REMOVE_KEYS = ['fraPreset', 'wfraPreset'];

function migrateRow(c) {
  if ('minAge' in c) return c;  // already migrated
  return {
    minAge:    c.maleMinAge,
    maleCat:   c.maleCat,
    femaleCat: c.femaleCat,
    ref:       c.maleRef,
    maxDist:   c.maleMaxDist,
  };
}

function migrateFile(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`  SKIP (parse error): ${filePath} — ${e.message}`);
    return;
  }

  let changed = false;

  // Migrate category rows to 5-field format
  if (Array.isArray(data.categories) && data.categories.length > 0 && !('minAge' in data.categories[0])) {
    data.categories = data.categories.map(migrateRow);
    changed = true;
  }

  // Remove redundant tables
  for (const key of REMOVE_KEYS) {
    if (key in data) {
      delete data[key];
      changed = true;
      console.log(`  Removed ${key} from ${filePath}`);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`  Updated: ${filePath}`);
  }
}

function walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full);
    else if (entry.name.endsWith('.json')) migrateFile(full);
  }
}

const dataDir = path.join(__dirname, '..', 'data');
console.log(`Scanning ${dataDir} ...`);
walkDir(dataDir);
console.log('Done.');