'use strict';

import { scratchRoot } from './helpers/setup-root.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { ROOT, DATA_DIR, MOBILE_DIR, RESULTS_DIR, ensureDirs, MIME } from '../../server/config.js';

describe('server/config.js:ROOT override', () => {
  it('resolves ROOT from RACEMASTER_ROOT, not the real repo directory', () => {
    assert.equal(ROOT, scratchRoot);
    assert.equal(DATA_DIR, `${scratchRoot}/data`);
  });
});

describe('server/config.js:ensureDirs', () => {
  it('creates data/mobile/results under ROOT if missing', () => {
    assert.equal(fs.existsSync(DATA_DIR), false);
    ensureDirs();
    assert.equal(fs.existsSync(DATA_DIR), true);
    assert.equal(fs.existsSync(MOBILE_DIR), true);
    assert.equal(fs.existsSync(RESULTS_DIR), true);
  });

  it('is idempotent — calling it again with the dirs already present does not throw', () => {
    ensureDirs();
    assert.doesNotThrow(() => ensureDirs());
  });
});

describe('server/config.js:MIME', () => {
  it('maps common extensions to content types', () => {
    assert.equal(MIME['.html'], 'text/html; charset=utf-8');
    assert.equal(MIME['.js'], 'application/javascript; charset=utf-8');
    assert.equal(MIME['.json'], 'application/json');
  });
});
