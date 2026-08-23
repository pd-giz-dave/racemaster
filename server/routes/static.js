'use strict';

import fs from 'fs';
import path from 'path';
import { buildSwContent } from '../service-worker.js';
import { ROOT, MIME } from '../config.js';

// Returns true if this request was matched and handled (a response was sent), false otherwise.
export async function handleStaticRoutes(req, res, pathname) {
  // GET /sw.js — generated dynamically so PRECACHE and cache name stay current
  if (pathname === '/sw.js' && req.method === 'GET') {
    const content = buildSwContent();
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    res.end(content);
    return true;
  }

  // ---- Static file serving ----
  const rel      = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(ROOT, rel);

  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); res.end('Forbidden');
    return true;
  }

  await new Promise(resolve => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'EISDIR') {
          res.writeHead(301, { Location: '/' + rel + '/index.js' });
          res.end();
          return resolve();
        }
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
        return resolve();
      }
      const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
      const headers = { 'Content-Type': mime };
      if (rel === 'index.html') headers['Cache-Control'] = 'no-cache';
      res.writeHead(200, headers);
      res.end(data);
      resolve();
    });
  });
  return true;
}