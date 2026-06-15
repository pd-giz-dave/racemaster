#!/usr/bin/env node
'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT        = 3000;
const ROOT        = __dirname;
const DATA_DIR    = path.join(ROOT, 'data');
const USERS_FILE  = path.join(ROOT, 'users.txt');
const ADMINS_FILE = path.join(ROOT, 'admins.txt');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);


const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript; charset=utf-8',
  '.css':         'text/css; charset=utf-8',
  '.json':        'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png':         'image/png',
  '.ico':         'image/x-icon',
  '.svg':         'image/svg+xml',
};

// ---- Authentication ----

const sessions = new Map(); // token → username

function hashPw(pw)  { return crypto.createHash('sha256').update(pw).digest('hex'); }
function newToken()  { return crypto.randomBytes(32).toString('hex'); }

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(USERS_FILE, 'utf8').split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, Object.entries(users).map(([n, h]) => `${n}:${h}`).join('\n') + '\n', 'utf8');
}

function readAdmins() {
  if (!fs.existsSync(ADMINS_FILE)) return new Set();
  return new Set(fs.readFileSync(ADMINS_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean));
}

function writeAdmins(admins) {
  fs.writeFileSync(ADMINS_FILE, [...admins].join('\n') + '\n', 'utf8');
}

function isAdmin(username) { return readAdmins().has(username); }

function getAuthUser(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? (sessions.get(h.slice(7)) || null) : null;
}

// ---- Dataset helpers ----

// Sanitise to lowercase alphanumeric / hyphen / underscore, max 64 chars
function sanitiseName(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64).toLowerCase();
}

// Dataset names must not contain "public" or "private" (reserved as suffixes)
function containsVisibility(name) {
  return /public|private/i.test(name);
}

// data/<owner>/<name>-<visibility>.json
function dataFilePath(owner, fullName) {
  return path.join(DATA_DIR, owner, `${fullName}.json`);
}

function ownerDir(owner) {
  return path.join(DATA_DIR, owner);
}

function readDataset(owner, fullName) {
  const fp = dataFilePath(owner, fullName);
  if (!fs.existsSync(fp)) return {};
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return {}; }
}

function writeDataset(owner, fullName, data) {
  const dir = ownerDir(owner);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFilePath(owner, fullName), JSON.stringify(data, null, 2), 'utf8');
}

function emptyDataset() {
  return {};
}

// Returns array of { owner, name, fullName, visibility, orphaned } visible to username.
// adminAccess=true shows all datasets including other users' private ones.
function getDatasetsForUser(username, adminAccess = false) {
  const knownUsers = readUsers();
  const results = [];
  let entries;
  try { entries = fs.readdirSync(DATA_DIR); }
  catch { return results; }

  for (const entry of entries) {
    const entryPath = path.join(DATA_DIR, entry);
    try { if (!fs.statSync(entryPath).isDirectory()) continue; }
    catch { continue; }
    const owner = entry;
    let files;
    try { files = fs.readdirSync(entryPath); }
    catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const base = file.slice(0, -5);
      let visibility, name;
      if (base.endsWith('-private')) { visibility = 'private'; name = base.slice(0, -8); }
      else if (base.endsWith('-public')) { visibility = 'public';  name = base.slice(0, -7); }
      else continue;

      if (visibility === 'private' && owner !== username && !adminAccess) continue;

      const data = readDataset(owner, base);
      const ev   = Array.isArray(data.event) ? data.event[0] : null;
      results.push({ owner, name, fullName: base, visibility,
        eventName: ev?.name || '', eventDate: ev?.date || '',
        orphaned: !knownUsers[owner] });
    }
  }

  return results.sort((a, b) =>
    a.owner !== b.owner ? a.owner.localeCompare(b.owner) : a.name.localeCompare(b.name)
  );
}

// ---- HTTP helpers ----

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

function jsonReply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Parse /api/data/:owner/:fullName → { owner, fullName } or null
function parseDataPath(pathname) {
  const rest = pathname.slice('/api/data/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const owner    = sanitiseName(rest.slice(0, slash));
  const fullName = sanitiseName(rest.slice(slash + 1));
  if (!owner || !fullName) return null;
  if (!fullName.endsWith('-private') && !fullName.endsWith('-public')) return null;
  return { owner, fullName, visibility: fullName.endsWith('-public') ? 'public' : 'private' };
}

// ---- Request handler ----

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  try {

    // GET /api/ping  — liveness check, no auth
    if (pathname === '/api/ping' && req.method === 'GET') {
      return jsonReply(res, 200, { ok: true });
    }

    // POST /api/auth/login
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const users = readUsers();
      const username = (body.username || '').trim();
      if (!users[username] || users[username] !== hashPw(body.password || '')) {
        return jsonReply(res, 401, { error: 'Invalid username or password' });
      }
      const token = newToken();
      sessions.set(token, username);
      return jsonReply(res, 200, { token, username, isAdmin: isAdmin(username) });
    }

    // POST /api/auth/create
    if (pathname === '/api/auth/create' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const username = sanitiseName(body.username || '').slice(0, 32);
      const password = (body.password || '').trim();
      if (!username || password.length < 4) {
        return jsonReply(res, 400, { error: 'Username required; password must be at least 4 characters' });
      }
      const users = readUsers();
      if (users[username]) return jsonReply(res, 409, { error: `Username "${username}" already exists` });
      const admins = readAdmins();
      if (Object.keys(users).length === 0) { admins.add(username); writeAdmins(admins); }
      users[username] = hashPw(password);
      writeUsers(users);
      const token = newToken();
      sessions.set(token, username);
      console.log(`Account created: ${username}${admins.has(username) ? ' (admin)' : ''}`);
      return jsonReply(res, 200, { token, username, isAdmin: admins.has(username) });
    }

    // GET /api/datasets  —  list datasets visible to the authenticated user
    if (pathname === '/api/datasets' && req.method === 'GET') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      return jsonReply(res, 200, getDatasetsForUser(username, isAdmin(username)));
    }

    // POST /api/datasets/copy  —  copy any visible dataset into the requester's folder
    if (pathname === '/api/datasets/copy' && req.method === 'POST') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      const body = JSON.parse(await readBody(req));

      const fromOwner    = sanitiseName(body.fromOwner || '');
      const fromFullName = sanitiseName(body.fromFullName || '');
      if (!fromOwner || !fromFullName) return jsonReply(res, 400, { error: 'fromOwner and fromFullName required' });

      // Permission: must own the source or it must be public
      const srcVisibility = fromFullName.endsWith('-public') ? 'public' : 'private';
      if (srcVisibility === 'private' && fromOwner !== username) {
        return jsonReply(res, 403, { error: 'Cannot copy a private dataset you do not own' });
      }
      if (!fs.existsSync(dataFilePath(fromOwner, fromFullName))) {
        return jsonReply(res, 404, { error: 'Source dataset not found' });
      }

      const toName = sanitiseName(body.toName || '');
      const toVisibility = body.visibility === 'public' ? 'public' : 'private';
      if (!toName) return jsonReply(res, 400, { error: 'toName required' });
      if (containsVisibility(toName)) {
        return jsonReply(res, 400, { error: 'Dataset name must not contain "public" or "private"' });
      }

      const toFullName = `${toName}-${toVisibility}`;
      if (fs.existsSync(dataFilePath(username, toFullName))) {
        return jsonReply(res, 409, { error: `You already have a dataset named "${toName}" (${toVisibility})` });
      }

      const srcData = readDataset(fromOwner, fromFullName);
      writeDataset(username, toFullName, srcData);
      console.log(`Dataset copied: ${fromOwner}/${fromFullName} → ${username}/${toFullName}`);
      return jsonReply(res, 200, { ok: true, name: toName, fullName: toFullName, owner: username, visibility: toVisibility });
    }

    // POST /api/datasets  —  create a new empty dataset in the requester's folder
    if (pathname === '/api/datasets' && req.method === 'POST') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      const body = JSON.parse(await readBody(req));
      const name = sanitiseName(body.name || '');
      const visibility = body.visibility === 'public' ? 'public' : 'private';

      if (!name) return jsonReply(res, 400, { error: 'Invalid dataset name' });
      if (containsVisibility(name)) {
        return jsonReply(res, 400, { error: 'Dataset name must not contain "public" or "private"' });
      }

      const fullName = `${name}-${visibility}`;
      if (fs.existsSync(dataFilePath(username, fullName))) {
        return jsonReply(res, 409, { error: `You already have a dataset named "${name}" (${visibility})` });
      }

      writeDataset(username, fullName, emptyDataset());
      console.log(`Dataset created: ${username}/${fullName}`);
      return jsonReply(res, 200, { ok: true, name, fullName, owner: username, visibility });
    }

    // PATCH /api/datasets/:owner/:fullName  —  change dataset visibility
    if (/^\/api\/datasets\/[^/]+\/[^/]+$/.test(pathname) && req.method === 'PATCH') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      const [, , , owner, fullName] = pathname.split('/');
      if (owner !== username && !isAdmin(username)) return jsonReply(res, 403, { error: 'Cannot modify another user\'s dataset' });
      const body = JSON.parse(await readBody(req));
      const newVisibility = body.visibility === 'public' ? 'public' : 'private';
      let name;
      if (fullName.endsWith('-private'))     name = fullName.slice(0, -8);
      else if (fullName.endsWith('-public')) name = fullName.slice(0, -7);
      else return jsonReply(res, 400, { error: 'Invalid dataset name format' });
      const newFullName = `${name}-${newVisibility}`;
      if (newFullName === fullName) return jsonReply(res, 200, { ok: true, name, fullName, owner, visibility: newVisibility });
      if (!fs.existsSync(dataFilePath(owner, fullName))) return jsonReply(res, 404, { error: 'Dataset not found' });
      if (fs.existsSync(dataFilePath(owner, newFullName))) {
        return jsonReply(res, 409, { error: `A dataset "${name}" (${newVisibility}) already exists` });
      }
      writeDataset(owner, newFullName, readDataset(owner, fullName));
      fs.unlinkSync(dataFilePath(owner, fullName));
      console.log(`Dataset visibility changed: ${owner}/${fullName} → ${owner}/${newFullName}`);
      return jsonReply(res, 200, { ok: true, name, fullName: newFullName, owner, visibility: newVisibility });
    }

    // DELETE /api/datasets/:owner/:fullName  —  permanently delete a dataset (owner only)
    if (/^\/api\/datasets\/[^/]+\/[^/]+$/.test(pathname) && req.method === 'DELETE') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      const [, , , owner, fullName] = pathname.split('/');
      if (owner !== username && !isAdmin(username)) return jsonReply(res, 403, { error: 'Cannot delete another user\'s dataset' });
      const filePath = dataFilePath(owner, fullName);
      if (!fs.existsSync(filePath)) return jsonReply(res, 404, { error: 'Dataset not found' });
      fs.unlinkSync(filePath);
      console.log(`Dataset deleted: ${owner}/${fullName}`);
      return jsonReply(res, 200, { ok: true });
    }

    // GET /api/data/:owner/:fullName  —  read a dataset
    if (pathname.startsWith('/api/data/') && req.method === 'GET') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      const parsed = parseDataPath(pathname);
      if (!parsed) return jsonReply(res, 400, { error: 'Invalid path — expected /api/data/:owner/:name-{private|public}' });
      const { owner, fullName, visibility } = parsed;
      if (visibility === 'private' && owner !== username && !isAdmin(username)) return jsonReply(res, 403, { error: 'Access denied' });
      return jsonReply(res, 200, readDataset(owner, fullName));
    }

    // PUT /api/data/:owner/:fullName  —  write a dataset (owner only)
    if (pathname.startsWith('/api/data/') && req.method === 'PUT') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      const parsed = parseDataPath(pathname);
      if (!parsed) return jsonReply(res, 400, { error: 'Invalid path — expected /api/data/:owner/:name-{private|public}' });
      const { owner, fullName } = parsed;
      if (owner !== username && !isAdmin(username)) return jsonReply(res, 403, { error: 'Cannot write to another user\'s dataset' });
      try {
        const incoming = JSON.parse(await readBody(req));
        writeDataset(owner, fullName, incoming);
        return jsonReply(res, 200, { ok: true });
      } catch {
        return jsonReply(res, 400, { error: 'Invalid JSON' });
      }
    }

    // GET /api/users  — admin only, list all users
    if (pathname === '/api/users' && req.method === 'GET') {
      const username = getAuthUser(req);
      console.log(`GET /api/users — auth: ${username || 'none'}`);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      if (!isAdmin(username)) return jsonReply(res, 403, { error: 'Admin only' });
      const users  = readUsers();
      const admins = readAdmins();
      const list = Object.keys(users).sort().map(u => ({ username: u, isAdmin: admins.has(u) }));
      console.log(`GET /api/users — returning ${list.length} users`);
      return jsonReply(res, 200, list);
    }

    // PATCH /api/users/:username  — admin only, grant/revoke admin (not self)
    if (pathname.startsWith('/api/users/') && req.method === 'PATCH') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      if (!isAdmin(username)) return jsonReply(res, 403, { error: 'Admin only' });
      const target = sanitiseName(pathname.slice('/api/users/'.length));
      if (!target) return jsonReply(res, 400, { error: 'Invalid username' });
      if (target === username) return jsonReply(res, 400, { error: 'Cannot change your own admin status' });
      const users = readUsers();
      if (!users[target]) return jsonReply(res, 404, { error: 'User not found' });
      const body = JSON.parse(await readBody(req));
      const admins = readAdmins();
      if (body.isAdmin) admins.add(target); else admins.delete(target);
      writeAdmins(admins);
      console.log(`Admin ${username} ${body.isAdmin ? 'granted' : 'revoked'} admin for ${target}`);
      return jsonReply(res, 200, { ok: true });
    }

    // DELETE /api/users/:username  — admin only, cannot delete self
    if (pathname.startsWith('/api/users/') && req.method === 'DELETE') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      if (!isAdmin(username)) return jsonReply(res, 403, { error: 'Admin only' });
      const target = sanitiseName(pathname.slice('/api/users/'.length));
      if (!target) return jsonReply(res, 400, { error: 'Invalid username' });
      if (target === username) return jsonReply(res, 400, { error: 'Cannot delete your own account' });
      const users = readUsers();
      if (!users[target]) return jsonReply(res, 404, { error: 'User not found' });
      delete users[target];
      writeUsers(users);
      const admins = readAdmins();
      admins.delete(target);
      writeAdmins(admins);
      for (const [tok, u] of sessions) if (u === target) sessions.delete(tok);
      console.log(`User deleted by admin ${username}: ${target}`);
      return jsonReply(res, 200, { ok: true });
    }

    // ---- Static file serving ----
    const rel      = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.join(ROOT, rel);

    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }
      const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });

  } catch (e) {
    console.error('Request error:', e.message);
    jsonReply(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nRaceMaster dev server → http://localhost:${PORT}`);
  console.log(`Data directory        → ${DATA_DIR}`);
  console.log(`Users file            → ${USERS_FILE}\n`);
});