#!/usr/bin/env node
'use strict';

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  PORT, HOST, ROOT, DATA_DIR, MOBILE_DIR, RESULTS_DIR,
  USERS_FILE, ADMINS_FILE, SESSIONS_FILE, LOG_FILE, ensureDirs,
} from './server/config.js';
import { installConsoleLogging } from './server/logging.js';
import { loadSessions } from './server/auth.js';
import { route } from './server/router.js';

ensureDirs();
installConsoleLogging();
loadSessions();

// Dev convenience: restart on code change. Watches server.js itself plus the whole server/
// directory (the module breakdown this file used to be) — an external process supervisor is
// expected to bring the process back up after this exit, same as before the breakup.
const SERVER_FILENAME = fileURLToPath(import.meta.url);
const SERVER_DIR       = path.join(ROOT, 'server');
function restartOnChange() {
  setTimeout(() => process.exit(0), 500);
}
fs.watchFile(SERVER_FILENAME, { interval: 1000 }, restartOnChange);
fs.watch(SERVER_DIR, { recursive: true }, restartOnChange);

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