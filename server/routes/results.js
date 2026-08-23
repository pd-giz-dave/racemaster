'use strict';

import fs from 'fs';
import path from 'path';
import { readBody, jsonReply } from '../http-utils.js';
import { escapeHtml, syncPublishAssetsIfStale } from '../datasets.js';
import { getAuthUser } from '../auth.js';
import { ROOT, RESULTS_DIR, MIME } from '../config.js';

// Returns true if this request was matched and handled (a response was sent), false otherwise.
export async function handleResultsRoutes(req, res, pathname) {
  // POST /api/publish-results — write an HTML results page to the results/ directory
  if (pathname === '/api/publish-results' && req.method === 'POST') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const body = JSON.parse(await readBody(req));
    const safe = (body.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safe || !safe.endsWith('.html')) { jsonReply(res, 400, { error: 'Invalid filename' }); return true; }
    const dest = path.join(RESULTS_DIR, safe);
    if (!dest.startsWith(RESULTS_DIR + path.sep)) { jsonReply(res, 400, { error: 'Invalid filename' }); return true; }
    fs.writeFileSync(dest, body.html || '', 'utf8');
    for (const { src, name } of (body.copy || [])) {
      const safeName = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const srcPath  = path.join(ROOT, String(src || ''));
      const dstPath  = path.join(RESULTS_DIR, safeName);
      if (safeName && srcPath.startsWith(ROOT + path.sep) && dstPath.startsWith(RESULTS_DIR + path.sep))
        fs.copyFileSync(srcPath, dstPath);
    }
    console.log(`Results published: ${safe} by ${username}`);
    jsonReply(res, 200, { ok: true, url: `/results/${safe}` });
    return true;
  }

  // GET /results — public, searchable listing of every published results page.
  // No auth: publishing already makes a result world-readable at /results/<file>,
  // this just makes the set of them discoverable without knowing filenames.
  if (pathname === '/results' && req.method === 'GET') {
    syncPublishAssetsIfStale();

    let files = [];
    try { files = fs.readdirSync(RESULTS_DIR); } catch { /* dir missing — empty list */ }

    const entries = files
      .map(f => ({ file: f, m: f.match(/^(.*)_(\d{4}-\d{2}-\d{2})_results\.html$/) }))
      .filter(({ m }) => m)
      .map(({ file: f, m }) => {
        const name = m[1].replace(/_/g, ' ').trim();
        const date = m[2];
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(path.join(RESULTS_DIR, f)).mtimeMs; } catch { /* skip */ }
        return { file: f, name, date, mtimeMs };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.mtimeMs - a.mtimeMs);

    const rows = entries.map(e => {
      const searchKey = escapeHtml(`${e.name} ${e.date}`.toLowerCase());
      return `<tr data-search="${searchKey}">
        <td>${escapeHtml(e.name)}</td>
        <td>${escapeHtml(e.date)}</td>
        <td><a href="/results/${encodeURIComponent(e.file)}">View results</a></td>
      </tr>`;
    }).join('\n');

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RaceMaster — Published Results</title>
<link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="48x48">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="stylesheet" href="/results/publish.css">
</head>
<body>
<header class="rm-banner">
  <img src="/favicon.ico" class="rm-icon" alt="">
  <span class="rm-brand">RaceMaster</span>
  <span class="rm-event">Published Results</span>
</header>
<div class="re-page">
  <div class="re-search-row"><input type="search" id="re-search" placeholder="Search by event name or date…" autocomplete="off" autofocus></div>
  <p class="re-summary" id="re-count"></p>
  <table class="data-table">
    <thead><tr><th>Event</th><th>Date</th><th></th></tr></thead>
    <tbody id="results-tbody">${rows}</tbody>
  </table>
  <p class="re-summary" id="re-empty" hidden>No matching results.</p>
</div>
<script src="/results/publish.js"></script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(html);
    return true;
  }

  return false;
}