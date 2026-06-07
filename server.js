#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = 3000;
const ROOT      = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');

// All state tables — mirrors the shape in js/state.js
const TABLES = [
  'event', 'people', 'clubs', 'dibbers', 'categories', 'roles',
  'preEntries', 'entries', 'helpers', 'finishers', 'safety',
  'results', 'prizes', 'siResults', 'siTiming',
];

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

// ---- Load or initialise the data store ----

let db = Object.fromEntries(TABLES.map(t => [t, []]));

if (fs.existsSync(DATA_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const t of TABLES) {
      if (saved[t] !== undefined) db[t] = saved[t];
    }
    console.log(`Loaded ${DATA_FILE}`);
  } catch (e) {
    console.error(`Failed to parse ${DATA_FILE}:`, e.message);
  }
} else {
  console.log(`No ${DATA_FILE} found — starting with empty state`);
}

function persist() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ---- Helpers ----

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

// ---- Request handler ----

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  // ---- API ----
  if (pathname.startsWith('/api/data')) {
    const table = pathname.slice('/api/data'.length).replace(/^\//, '');

    // GET /api/data — full state
    if (req.method === 'GET' && !table) {
      return jsonReply(res, 200, db);
    }

    // PUT /api/data — replace full state (offline-first bulk sync)
    if (req.method === 'PUT' && !table) {
      try {
        const incoming = JSON.parse(await readBody(req));
        for (const t of TABLES) {
          if (incoming[t] !== undefined) db[t] = incoming[t];
        }
        persist();
        return jsonReply(res, 200, { ok: true });
      } catch {
        return jsonReply(res, 400, { error: 'Invalid JSON' });
      }
    }

    // GET /api/data/:table — single table
    if (req.method === 'GET') {
      if (!TABLES.includes(table)) return jsonReply(res, 404, { error: `Unknown table: ${table}` });
      return jsonReply(res, 200, db[table]);
    }

    // PUT /api/data/:table — single table
    if (req.method === 'PUT') {
      if (!TABLES.includes(table)) return jsonReply(res, 404, { error: `Unknown table: ${table}` });
      try {
        db[table] = JSON.parse(await readBody(req));
        persist();
        return jsonReply(res, 200, { ok: true });
      } catch {
        return jsonReply(res, 400, { error: 'Invalid JSON' });
      }
    }

    return jsonReply(res, 405, { error: 'Method not allowed' });
  }

  // ---- Static file serving ----
  const rel      = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(ROOT, rel);

  // Prevent directory traversal
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
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nRaceMaster dev server → http://localhost:${PORT}`);
  console.log(`State file            → ${DATA_FILE}\n`);
});