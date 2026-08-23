'use strict';

// server/config.js reads RACEMASTER_ROOT once, at import time, into module-level consts
// (ROOT, DATA_DIR, etc.) — so this must be the very first import in any test file that touches
// anything under server/, before any other import that transitively pulls in config.js. ESM
// imports evaluate in declaration order, so listing this literally first is what makes that
// guarantee hold. Each test FILE gets its own fresh scratch directory (node:test runs each
// file in its own process, so this only needs to be unique per process, not per test).

import fs from 'fs';
import os from 'os';
import path from 'path';

export const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'racemaster-test-'));
process.env.RACEMASTER_ROOT = scratchRoot;
