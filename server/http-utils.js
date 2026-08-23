'use strict';

import { sanitiseName } from './datasets.js';

export function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

export function jsonReply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Parse /api/data/:owner/:fullName → { owner, fullName, visibility } or null
export function parseDataPath(pathname) {
  const rest = pathname.slice('/api/data/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const owner    = sanitiseName(rest.slice(0, slash));
  const fullName = sanitiseName(rest.slice(slash + 1));
  if (!owner || !fullName) return null;
  if (!fullName.endsWith('-private') && !fullName.endsWith('-public')) return null;
  return { owner, fullName, visibility: fullName.endsWith('-public') ? 'public' : 'private' };
}