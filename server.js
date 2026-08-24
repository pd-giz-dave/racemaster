#!/usr/bin/env node
'use strict';

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  PORT, HOST, DATA_DIR, MOBILE_DIR, RESULTS_DIR,
  USERS_FILE, ADMINS_FILE, SESSIONS_FILE, LOG_FILE, ensureDirs,
} from './server/config.js';
import { installConsoleLogging } from './server/logging.js';
import { loadSessions } from './server/auth.js';
import { route } from './server/router.js';
import { walkFiles } from './server/service-worker.js';

ensureDirs();
installConsoleLogging();
loadSessions();

// Dev convenience: restart on code change. Watches server.js itself plus every file under the
// server/ directory (the module breakdown this file used to be) — an external process
// supervisor (e.g. docker-compose's `restart: unless-stopped`) is expected to bring the process
// back up after this exit, same as before the breakup.
//
// fs.watchFile (stat-polling) for every file individually, NOT fs.watch(dir, {recursive:true})
// — deliberately. fs.watch relies on inotify, which does not reliably deliver events through a
// Docker bind mount on this app's actual VPS deployment (confirmed: restarting on changes to
// server.js itself, still fs.watchFile-based, kept working after the breakup; restarting on
// changes anywhere under server/, which briefly used fs.watch(recursive), did not). Polling is
// slightly more overhead per file, but for this file count that's negligible, and it's the same
// mechanism already relied on before the breakup.
//
// SERVER_DIR is this file's own real location on disk, NOT derived from ROOT (which
// RACEMASTER_ROOT overrides for data-directory test isolation — see
// test/server/helpers/setup-root.js). The code being watched must stay put regardless of where
// the *data* root points; deriving it from ROOT used to silently no-op instead of crash
// (fs.watch on a nonexistent path is inert) until the switch to fs.watchFile-per-file below,
// whose walkFiles()/readdirSync throws hard on one.
const SERVER_FILENAME = fileURLToPath(import.meta.url);
const SERVER_DIR       = path.join(path.dirname(SERVER_FILENAME), 'server');
function restartOnChange() {
  setTimeout(() => process.exit(0), 500);
}
fs.watchFile(SERVER_FILENAME, { interval: 1000 }, restartOnChange);
for (const file of walkFiles(SERVER_DIR, ['.js'])) {
  fs.watchFile(file, { interval: 1000 }, restartOnChange);
}

const server = http.createServer(route);

server.listen(PORT, HOST, () => {
  console.log(`\nRaceMaster server → http://${HOST}:${PORT}`);
  console.log(  `Data directory    → ${DATA_DIR}`);
  console.log(  `Mobile directory  → ${MOBILE_DIR}`);
  console.log(  `Results directory → ${RESULTS_DIR}`)
  console.log(  `Users file        → ${USERS_FILE}`);
  console.log(  `Admins file       → ${ADMINS_FILE}`);
  console.log(  `Sessions file     → ${SESSIONS_FILE}`);
  console.log(  `Log file          → ${LOG_FILE}\n`)
});
