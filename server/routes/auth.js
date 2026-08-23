'use strict';

import { readBody, jsonReply } from '../http-utils.js';
import { sanitiseName } from '../datasets.js';
import { readUsers, writeUsers, readAdmins, writeAdmins, hashPw, newToken, addSession, isAdmin } from '../auth.js';

// Returns true if this request was matched and handled (a response was sent), false otherwise.
export async function handleAuthRoutes(req, res, pathname) {
  // POST /api/auth/login
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const users = readUsers();
    const username = (body.username || '').trim();
    if (!users[username] || users[username] !== hashPw(body.password || '')) {
      jsonReply(res, 401, { error: 'Invalid username or password' });
      return true;
    }
    const token = newToken();
    addSession(token, username);
    jsonReply(res, 200, { token, username, isAdmin: isAdmin(username) });
    return true;
  }

  // POST /api/auth/create
  if (pathname === '/api/auth/create' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const username = sanitiseName(body.username || '').slice(0, 32);
    const password = (body.password || '').trim();
    if (!username || password.length < 4) {
      jsonReply(res, 400, { error: 'Username required; password must be at least 4 characters' });
      return true;
    }
    const users = readUsers();
    if (users[username]) { jsonReply(res, 409, { error: `Username "${username}" already exists` }); return true; }
    const admins = readAdmins();
    if (Object.keys(users).length === 0) { admins.add(username); writeAdmins(admins); }
    users[username] = hashPw(password);
    writeUsers(users);
    const token = newToken();
    addSession(token, username);
    console.log(`Account created: ${username}${admins.has(username) ? ' (admin)' : ''}`);
    jsonReply(res, 200, { token, username, isAdmin: admins.has(username) });
    return true;
  }

  return false;
}