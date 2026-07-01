#!/usr/bin/env node
'use strict';

// Migrates all data JSON files:
//
// 1. Category rows: old 8-field format → new 5-field format (idempotent)
//    Old: { maleMinAge, maleCat, maleRef, maleMaxDist,
//           femaleMinAge, femaleCat, femaleRef, femaleMaxDist }
//    New: { minAge, maleCat, femaleCat, ref, maxDist }
//
// 2. Removes redundant tables: fraPreset, wfraPreset
//    (presets are now built-in constants, not stored in data files)
//
// Safe to run more than once.
// Usage: node scripts/migrate-categories.js

const fs   = require('fs');
const path = require('path');

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