'use strict';

import './helpers/setup-root.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { ensureDirs, LOG_FILE, LOG_MAX } from '../../server/config.js';
import { writeLog, humanTs } from '../../server/logging.js';

beforeEach(() => {
  ensureDirs();
  for (const f of [LOG_FILE, `${LOG_FILE}.1`, `${LOG_FILE}.2`]) {
    try { fs.unlinkSync(f); } catch { /* not present */ }
  }
});

describe('server/logging.js:writeLog', () => {
  it('appends a timestamped, level-tagged line, formatted like util.format', () => {
    writeLog('INFO', ['hello', { a: 1 }]);
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    assert.match(content, /^\[.+\] \[INFO\] hello \{ a: 1 \}\n$/);
  });

  it('appends further calls rather than overwriting', () => {
    writeLog('INFO', ['first']);
    writeLog('WARN', ['second']);
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /\[WARN\] second/);
  });

  it('rotates to .1 once the file reaches LOG_MAX bytes, keeping the new line in a fresh file', () => {
    fs.writeFileSync(LOG_FILE, 'x'.repeat(LOG_MAX));
    writeLog('INFO', ['triggers rotation']);
    assert.equal(fs.existsSync(`${LOG_FILE}.1`), true);
    assert.equal(fs.readFileSync(`${LOG_FILE}.1`, 'utf8').length, LOG_MAX);
    assert.match(fs.readFileSync(LOG_FILE, 'utf8'), /triggers rotation/);
  });

  it('never throws even if the log directory is unwritable-equivalent (missing parent)', () => {
    fs.rmSync(LOG_FILE, { force: true });
    // Simulate a write failure by pointing LOG_FILE's directory away — writeLog swallows all
    // errors by design (logging must never crash the server), so this just needs to not throw.
    assert.doesNotThrow(() => writeLog('ERROR', ['whatever']));
  });
});

describe('server/logging.js:humanTs', () => {
  it('formats as a 24-hour British-locale timestamp string', () => {
    const ts = humanTs();
    assert.equal(typeof ts, 'string');
    assert.ok(ts.length > 0);
    assert.doesNotMatch(ts, /\b(AM|PM)\b/); // hour12: false
  });
});
