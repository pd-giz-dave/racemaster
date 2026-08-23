'use strict';

// Persistent logging — appends timestamped lines to server.log; rotates to server.log.1
// (through .9) at LOG_MAX bytes.

import fs from 'fs';
import { format as utilFormat } from 'util';
import { LOG_FILE, LOG_MAX } from './config.js';

export function writeLog(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${utilFormat(...args)}\n`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size >= LOG_MAX) {
      if (fs.existsSync(`${LOG_FILE}.9`)) fs.unlinkSync(`${LOG_FILE}.9`);
      for (let i = 8; i >= 1; i--) {
        if (fs.existsSync(`${LOG_FILE}.${i}`)) fs.renameSync(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`);
      }
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* never let logging break the server */ }
}

export function humanTs() {
  return new Date().toLocaleString('en-GB', { hour12: false });
}

// Patches console.log/warn/error to also prefix a human timestamp and persist to LOG_FILE —
// call once, at startup.
export function installConsoleLogging() {
  const _log  = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _err  = console.error.bind(console);
  console.log   = (...a) => { _log(`[${humanTs()}]`, ...a);  writeLog('INFO',  a); };
  console.warn  = (...a) => { _warn(`[${humanTs()}]`, ...a); writeLog('WARN',  a); };
  console.error = (...a) => { _err(`[${humanTs()}]`, ...a);  writeLog('ERROR', a); };
}