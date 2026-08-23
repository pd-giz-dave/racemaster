'use strict';

import './helpers/setup-root.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { ensureDirs, DATA_DIR, RESULTS_DIR, ROOT } from '../../server/config.js';
import { writeUsers } from '../../server/auth.js';
import {
  sanitiseName, escapeHtml, containsVisibility, dataFilePath, ownerDir,
  readDataset, writeDataset, emptyDataset, getDatasetsForUser, syncPublishAssetsIfStale,
} from '../../server/datasets.js';

beforeEach(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
  ensureDirs();
});

describe('server/datasets.js:sanitiseName', () => {
  it('lowercases, strips disallowed characters, and truncates to 64 chars', () => {
    assert.equal(sanitiseName('My Race! 2026'), 'myrace2026');
    assert.equal(sanitiseName('a'.repeat(100)).length, 64);
    assert.equal(sanitiseName(''), '');
    assert.equal(sanitiseName(null), '');
  });
});

describe('server/datasets.js:escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('coerces null/undefined to empty string rather than the literal text', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

describe('server/datasets.js:containsVisibility', () => {
  it('flags "public"/"private" anywhere in the name, case-insensitively', () => {
    assert.equal(containsVisibility('my-private-race'), true);
    assert.equal(containsVisibility('PUBLIC-race'), true);
    assert.equal(containsVisibility('my-race'), false);
  });
});

describe('server/datasets.js:dataFilePath / ownerDir', () => {
  it('builds paths under DATA_DIR/<owner>/', () => {
    assert.equal(dataFilePath('alice', 'race-private'), path.join(DATA_DIR, 'alice', 'race-private.json'));
    assert.equal(ownerDir('alice'), path.join(DATA_DIR, 'alice'));
  });
});

describe('server/datasets.js:readDataset / writeDataset / emptyDataset', () => {
  it('round-trips a dataset through the file, creating the owner dir as needed', () => {
    writeDataset('alice', 'race-private', { _version: 1, entries: [{ bibNumber: 1 }] });
    assert.deepEqual(readDataset('alice', 'race-private'), { _version: 1, entries: [{ bibNumber: 1 }] });
  });

  it('readDataset returns {} for a missing file or corrupt JSON', () => {
    assert.deepEqual(readDataset('nobody', 'nothing-private'), {});
    const dir = ownerDir('alice');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dataFilePath('alice', 'broken-private'), 'not json', 'utf8');
    assert.deepEqual(readDataset('alice', 'broken-private'), {});
  });

  it('emptyDataset is {_version: 1}', () => {
    assert.deepEqual(emptyDataset(), { _version: 1 });
  });
});

describe('server/datasets.js:getDatasetsForUser', () => {
  beforeEach(() => {
    writeUsers({ alice: 'h1', bob: 'h2' });
    writeDataset('alice', 'race1-private', { event: [{ name: 'Race One', date: '01/01/2026' }] });
    writeDataset('alice', 'race2-public',  {});
    writeDataset('bob',   'race3-private', {});
  });

  it('a user sees their own private datasets plus everyone\'s public ones', () => {
    const seen = getDatasetsForUser('alice').map(d => d.fullName).sort();
    assert.deepEqual(seen, ['race1-private', 'race2-public']);
  });

  it('does not see another user\'s private dataset', () => {
    const seen = getDatasetsForUser('bob').map(d => d.fullName);
    assert.ok(!seen.includes('race1-private'));
    assert.ok(seen.includes('race2-public'));
  });

  it('admin access sees every dataset regardless of owner/visibility', () => {
    const seen = getDatasetsForUser('bob', true).map(d => d.fullName).sort();
    assert.deepEqual(seen, ['race1-private', 'race2-public', 'race3-private']);
  });

  it('extracts eventName/eventDate from the dataset\'s own event[0]', () => {
    const race1 = getDatasetsForUser('alice').find(d => d.fullName === 'race1-private');
    assert.equal(race1.eventName, 'Race One');
    assert.equal(race1.eventDate, '01/01/2026');
  });

  it('flags a dataset owned by a user no longer in users.txt as orphaned', () => {
    writeUsers({ alice: 'h1' }); // bob removed
    const race3 = getDatasetsForUser('alice', true).find(d => d.fullName === 'race3-private');
    assert.equal(race3.orphaned, true);
  });
});

describe('server/datasets.js:syncPublishAssetsIfStale', () => {
  it('copies a source asset into results/ when missing or different', () => {
    const srcDir = path.join(ROOT, 'js', 'publish');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'publish.css'), 'body{color:red}', 'utf8');
    syncPublishAssetsIfStale();
    assert.equal(fs.readFileSync(path.join(RESULTS_DIR, 'publish.css'), 'utf8'), 'body{color:red}');
  });

  it('does not touch the destination when it already matches the source', () => {
    const srcDir = path.join(ROOT, 'js', 'publish');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'publish.js'), 'console.log(1)', 'utf8');
    syncPublishAssetsIfStale();
    const before = fs.statSync(path.join(RESULTS_DIR, 'publish.js')).mtimeMs;
    syncPublishAssetsIfStale();
    const after = fs.statSync(path.join(RESULTS_DIR, 'publish.js')).mtimeMs;
    assert.equal(before, after); // not rewritten the second time
  });

  it('is a no-op (does not throw) when there is no source to sync from', () => {
    fs.rmSync(path.join(ROOT, 'js'), { recursive: true, force: true });
    assert.doesNotThrow(() => syncPublishAssetsIfStale());
  });
});
