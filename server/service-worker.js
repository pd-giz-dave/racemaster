'use strict';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ROOT } from './config.js';

export function walkFiles(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory())                          walkFiles(full, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

export function buildSwContent() {
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