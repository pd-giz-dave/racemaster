'use strict';

import fs from 'fs';
import crypto from 'crypto';
import { USERS_FILE, ADMINS_FILE, SESSIONS_FILE, SESSION_TTL } from './config.js';

const sessions = new Map(); // token → { username, expires }

export function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return;
  const now = Date.now();
  for (const line of fs.readFileSync(SESSIONS_FILE, 'utf8').split('\n')) {
    const parts = line.split(':');
    if (parts.length !== 3) continue;
    const [tok, username, exp] = parts;
    if (Number(exp) > now) sessions.set(tok.trim(), { username: username.trim(), expires: Number(exp) });
  }
}

export function saveSessions() {
  const lines = [];
  for (const [tok, s] of sessions) lines.push(`${tok}:${s.username}:${s.expires}`);
  fs.writeFileSync(SESSIONS_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

export function addSession(token, username) {
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL });
  saveSessions();
}

export function hashPw(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
export function newToken() { return crypto.randomBytes(32).toString('hex'); }

export function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(USERS_FILE, 'utf8').split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

export function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, Object.entries(users).map(([n, h]) => `${n}:${h}`).join('\n') + '\n', 'utf8');
}

export function readAdmins() {
  if (!fs.existsSync(ADMINS_FILE)) return new Set();
  return new Set(fs.readFileSync(ADMINS_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean));
}

export function writeAdmins(admins) {
  fs.writeFileSync(ADMINS_FILE, [...admins].join('\n') + '\n', 'utf8');
}

export function isAdmin(username) { return readAdmins().has(username); }

export function getAuthUser(req) {
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Bearer ')) return null;
  const s = sessions.get(h.slice(7));
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(h.slice(7)); saveSessions(); return null; }
  return s.username;
}

// Used by the DELETE /api/users/:username route to revoke a deleted user's sessions —
// `sessions` itself stays a private module-level singleton (every request handler shares one
// in-memory session table, same as the original monolithic file), so this is the one place
// outside this module that needs to reach into it.
export function deleteSessionsForUser(username) {
  for (const [tok, s] of sessions) if (s.username === username) sessions.delete(tok);
}