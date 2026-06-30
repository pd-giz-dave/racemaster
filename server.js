#!/usr/bin/env node
'use strict';

const http   = require('http');
const fs     = require('fs');
const path        = require('path');
const crypto = require('crypto');

const PORT        = process.env.PORT || 3000;
const HOST        = process.env.HOST || '127.0.0.1';
const ROOT        = __dirname;
const DATA_DIR    = path.join(ROOT, 'data');
const RESULTS_DIR = path.join(ROOT, 'results');
const USERS_FILE    = path.join(ROOT, 'users.txt');
const ADMINS_FILE   = path.join(ROOT, 'admins.txt');
const SESSIONS_FILE = path.join(ROOT, 'sessions.txt');
const SESSION_TTL  = 30 * 24 * 60 * 60 * 1000; // 30 days

if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR);

// ---- Persistent logging ----
// Appends timestamped lines to server.log; rotates to server.log.1 at 1 MB.

const { format: utilFormat } = require('util');
const LOG_FILE  = path.join(ROOT, 'server.log');
const LOG_MAX   = 1 * 1024 * 1024;

function writeLog(level, args) {
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

const _log  = console.log.bind(console);
const _warn = console.warn.bind(console);
const _err  = console.error.bind(console);
console.log   = (...a) => { _log(...a);  writeLog('INFO',  a); };
console.warn  = (...a) => { _warn(...a); writeLog('WARN',  a); };
console.error = (...a) => { _err(...a);  writeLog('ERROR', a); };

fs.watchFile(__filename, { interval: 1000 }, () => {
  setTimeout(() => process.exit(0), 500);
});


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

const sessions = new Map(); // token → { username, expires }

function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return;
  const now = Date.now();
  for (const line of fs.readFileSync(SESSIONS_FILE, 'utf8').split('\n')) {
    const parts = line.split(':');
    if (parts.length !== 3) continue;
    const [tok, username, exp] = parts;
    if (Number(exp) > now) sessions.set(tok.trim(), { username: username.trim(), expires: Number(exp) });
  }
}

function saveSessions() {
  const lines = [];
  for (const [tok, s] of sessions) lines.push(`${tok}:${s.username}:${s.expires}`);
  fs.writeFileSync(SESSIONS_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function addSession(token, username) {
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL });
  saveSessions();
}

loadSessions();

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
  if (!h.startsWith('Bearer ')) return null;
  const s = sessions.get(h.slice(7));
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(h.slice(7)); saveSessions(); return null; }
  return s.username;
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
  return { _version: 1 };
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

// ---- Service worker generation ----

function walkFiles(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory())                          walkFiles(full, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

function buildSwContent() {
  const statics = ['index.html', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'manifest.json', 'sw.js']
    .map(f => { const p = path.join(ROOT, f); return { url: `/${f}`, mtime: fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0 }; });

  const discovered = ['css', 'js'].flatMap(dir => {
    const abs = path.join(ROOT, dir);
    return fs.existsSync(abs) ? walkFiles(abs, ['.js', '.css']) : [];
  }).map(f => ({ url: '/' + path.relative(ROOT, f).replace(/\\/g, '/'), mtime: fs.statSync(f).mtimeMs }))
    .filter(({ url }) => url !== '/sw.js')
    .sort((a, b) => a.url.localeCompare(b.url));

  const fingerprint = crypto.createHash('sha1')
    .update([...statics, ...discovered].map(({ url, mtime }) => `${url}:${mtime}`).join('\n'))
    .digest('hex').slice(0, 12);

  const precache = ['/', ...statics.filter(f => f.url !== '/sw.js').map(f => f.url), ...discovered.map(f => f.url)];
  const precacheStr = `const PRECACHE = [\n${precache.map(f => `  '${f}',`).join('\n')}\n];`;

  return fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
    .replace(/const CACHE = '[^']+';/,        `const CACHE = 'racemaster-${fingerprint}';`)
    .replace(/const PRECACHE = \[[\s\S]*?];/, precacheStr);
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
  const _url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = _url;
  const force = _url.searchParams.get('force') === 'true';

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
      addSession(token, username);
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
      addSession(token, username);
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
        const current  = readDataset(owner, fullName);
        const currentVersion  = current._version  || 0;
        const incomingVersion = incoming._version || 0;
        if (!force && currentVersion > 0 && incomingVersion !== currentVersion) {
          return jsonReply(res, 409, { error: 'Dataset has been modified by another session — reload to get the latest data.' });
        }
        incoming._version = currentVersion + 1;
        writeDataset(owner, fullName, incoming);
        console.log(`[data] ${owner}/${fullName} saved at version ${incoming._version}`);
        return jsonReply(res, 200, { ok: true, version: incoming._version });
      } catch {
        return jsonReply(res, 400, { error: 'Invalid JSON' });
      }
    }

    // GET /api/users  — admin only, list all users
    if (pathname === '/api/users' && req.method === 'GET') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      if (!isAdmin(username)) return jsonReply(res, 403, { error: 'Admin only' });
      const users  = readUsers();
      const admins = readAdmins();
      const list = Object.keys(users).sort().map(u => ({ username: u, isAdmin: admins.has(u) }));
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
      for (const [tok, s] of sessions) if (s.username === target) sessions.delete(tok);
      saveSessions();
      console.log(`User deleted by admin ${username}: ${target}`);
      return jsonReply(res, 200, { ok: true });
    }

    // POST /api/publish-results — write an HTML results page to the results/ directory
    if (pathname === '/api/publish-results' && req.method === 'POST') {
      const username = getAuthUser(req);
      if (!username) return jsonReply(res, 401, { error: 'Unauthorised' });
      const body = JSON.parse(await readBody(req));
      const safe = (body.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!safe || !safe.endsWith('.html')) return jsonReply(res, 400, { error: 'Invalid filename' });
      const dest = path.join(RESULTS_DIR, safe);
      if (!dest.startsWith(RESULTS_DIR + path.sep)) return jsonReply(res, 400, { error: 'Invalid filename' });
      fs.writeFileSync(dest, body.html || '', 'utf8');
      for (const { src, name } of (body.copy || [])) {
        const safeName = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
        const srcPath  = path.join(ROOT, String(src || ''));
        const dstPath  = path.join(RESULTS_DIR, safeName);
        if (safeName && srcPath.startsWith(ROOT + path.sep) && dstPath.startsWith(RESULTS_DIR + path.sep))
          fs.copyFileSync(srcPath, dstPath);
      }
      console.log(`Results published: ${safe} by ${username}`);
      return jsonReply(res, 200, { ok: true, url: `/results/${safe}` });
    }

    // GET /sw.js — generated dynamically so PRECACHE and cache name stay current
    if (pathname === '/sw.js' && req.method === 'GET') {
      const content = buildSwContent();
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      res.end(content);
      return;
    }

    // ---- Static file serving ----
    const rel      = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.join(ROOT, rel);

    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'EISDIR') {
          res.writeHead(301, { Location: '/' + rel + '/index.js' });
          res.end();
          return;
        }
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }
      const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
      const headers = { 'Content-Type': mime };
      if (rel === 'index.html') headers['Cache-Control'] = 'no-cache';
      res.writeHead(200, headers);
      res.end(data);
    });

  } catch (e) {
    console.error('Request error:', e.message);
    jsonReply(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\nRaceMaster server → http://${HOST}:${PORT}`);
  console.log(  `Data directory    → ${DATA_DIR}`);
  console.log(  `Results directory → ${RESULTS_DIR}`)
  console.log(  `Users file        → ${USERS_FILE}`);
  console.log(  `Admins file       → ${ADMINS_FILE}`);
  console.log(  `Sessions file     → ${SESSIONS_FILE}`);
  console.log(  `Log file          → ${LOG_FILE}\n`)
});
