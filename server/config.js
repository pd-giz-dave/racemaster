'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ROOT defaults to the repo directory (one level up from server/), but is overridable via
// RACEMASTER_ROOT so tests can point the whole server at a scratch directory instead of the
// real data/users.txt/etc. in this checkout — nothing else in this module (or anything that
// imports it) reads process.env directly, so this is the single place that decision is made.
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PORT = process.env.PORT || 3000;
export const HOST = process.env.HOST || '127.0.0.1';
export const ROOT = process.env.RACEMASTER_ROOT || path.join(SERVER_DIR, '..');

export const DATA_DIR    = path.join(ROOT, 'data');
export const MOBILE_DIR  = path.join(ROOT, 'mobile');
export const RESULTS_DIR = path.join(ROOT, 'results');

export const USERS_FILE    = path.join(ROOT, 'users.txt');
export const ADMINS_FILE   = path.join(ROOT, 'admins.txt');
export const SESSIONS_FILE = path.join(ROOT, 'sessions.txt');
export const SESSION_TTL   = 30 * 24 * 60 * 60 * 1000; // 30 days

export const LOG_FILE = path.join(ROOT, 'server.log');
export const LOG_MAX  = 1024 * 1024;

export function ensureDirs() {
  if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(MOBILE_DIR))  fs.mkdirSync(MOBILE_DIR);
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR);
}

export const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript; charset=utf-8',
  '.css':         'text/css; charset=utf-8',
  '.json':        'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png':         'image/png',
  '.ico':         'image/x-icon',
  '.svg':         'image/svg+xml',
  '.apk':         'application/vnd.android.package-archive',
};