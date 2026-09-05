'use strict';

import fs from 'fs';
import { readBody, jsonReply, parseDataPath } from '../http-utils.js';
import { sanitiseName, containsVisibility, dataFilePath, readDataset, writeDataset, emptyDataset, getDatasetsForUser } from '../datasets.js';
import { getAuthUser, isAdmin, readUsers } from '../auth.js';

// Returns true if this request was matched and handled (a response was sent), false otherwise.
export async function handleDatasetRoutes(req, res, pathname, force) {
  // GET /api/datasets  —  list datasets visible to the authenticated user
  if (pathname === '/api/datasets' && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    jsonReply(res, 200, getDatasetsForUser(username, isAdmin(username)));
    return true;
  }

  // POST /api/datasets/copy  —  copy any visible dataset into the requester's folder
  if (pathname === '/api/datasets/copy' && req.method === 'POST') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const body = JSON.parse(await readBody(req));

    const fromOwner    = sanitiseName(body.fromOwner || '');
    const fromFullName = sanitiseName(body.fromFullName || '');
    if (!fromOwner || !fromFullName) { jsonReply(res, 400, { error: 'fromOwner and fromFullName required' }); return true; }

    // Permission: must own the source, it must be public, or the requester must be an admin
    // (admins can already see every private dataset in the list — see getDatasetsForUser()).
    const srcVisibility = fromFullName.endsWith('-public') ? 'public' : 'private';
    if (srcVisibility === 'private' && fromOwner !== username && !isAdmin(username)) {
      jsonReply(res, 403, { error: 'Cannot copy a private dataset you do not own' });
      return true;
    }
    if (!fs.existsSync(dataFilePath(fromOwner, fromFullName))) {
      jsonReply(res, 404, { error: 'Source dataset not found' });
      return true;
    }

    // Destination owner: defaults to the requester, but an admin may redirect the copy to any
    // existing user's folder instead — a non-admin naming anyone but themselves is rejected.
    let toOwner = username;
    if (body.toOwner) {
      const requestedOwner = sanitiseName(body.toOwner);
      if (requestedOwner !== username) {
        if (!isAdmin(username)) { jsonReply(res, 403, { error: 'Only an admin can copy a dataset to another user' }); return true; }
        if (!readUsers()[requestedOwner]) { jsonReply(res, 404, { error: `User "${requestedOwner}" does not exist` }); return true; }
      }
      toOwner = requestedOwner;
    }

    const toName = sanitiseName(body.toName || '');
    const toVisibility = body.visibility === 'public' ? 'public' : 'private';
    if (!toName) { jsonReply(res, 400, { error: 'toName required' }); return true; }
    if (containsVisibility(toName)) {
      jsonReply(res, 400, { error: 'Dataset name must not contain "public" or "private"' });
      return true;
    }

    const toFullName = `${toName}-${toVisibility}`;
    if (fs.existsSync(dataFilePath(toOwner, toFullName))) {
      jsonReply(res, 409, { error: `"${toOwner}" already has a dataset named "${toName}" (${toVisibility})` });
      return true;
    }

    const srcData = readDataset(fromOwner, fromFullName);
    writeDataset(toOwner, toFullName, srcData);
    console.log(`Dataset copied: ${fromOwner}/${fromFullName} → ${toOwner}/${toFullName}`);
    jsonReply(res, 200, { ok: true, name: toName, fullName: toFullName, owner: toOwner, visibility: toVisibility });
    return true;
  }

  // POST /api/datasets  —  create a new empty dataset in the requester's folder
  if (pathname === '/api/datasets' && req.method === 'POST') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const body = JSON.parse(await readBody(req));
    const name = sanitiseName(body.name || '');
    const visibility = body.visibility === 'public' ? 'public' : 'private';

    if (!name) { jsonReply(res, 400, { error: 'Invalid dataset name' }); return true; }
    if (containsVisibility(name)) {
      jsonReply(res, 400, { error: 'Dataset name must not contain "public" or "private"' });
      return true;
    }

    const fullName = `${name}-${visibility}`;
    if (fs.existsSync(dataFilePath(username, fullName))) {
      jsonReply(res, 409, { error: `You already have a dataset named "${name}" (${visibility})` });
      return true;
    }

    writeDataset(username, fullName, emptyDataset());
    console.log(`Dataset created: ${username}/${fullName}`);
    jsonReply(res, 200, { ok: true, name, fullName, owner: username, visibility });
    return true;
  }

  // PATCH /api/datasets/:owner/:fullName  —  change dataset visibility
  if (/^\/api\/datasets\/[^/]+\/[^/]+$/.test(pathname) && req.method === 'PATCH') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const [, , , owner, fullName] = pathname.split('/');
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot modify another user\'s dataset' }); return true; }
    const body = JSON.parse(await readBody(req));
    const newVisibility = body.visibility === 'public' ? 'public' : 'private';
    let name;
    if (fullName.endsWith('-private'))     name = fullName.slice(0, -8);
    else if (fullName.endsWith('-public')) name = fullName.slice(0, -7);
    else { jsonReply(res, 400, { error: 'Invalid dataset name format' }); return true; }
    const newFullName = `${name}-${newVisibility}`;
    if (newFullName === fullName) { jsonReply(res, 200, { ok: true, name, fullName, owner, visibility: newVisibility }); return true; }
    if (!fs.existsSync(dataFilePath(owner, fullName))) { jsonReply(res, 404, { error: 'Dataset not found' }); return true; }
    if (fs.existsSync(dataFilePath(owner, newFullName))) {
      jsonReply(res, 409, { error: `A dataset "${name}" (${newVisibility}) already exists` });
      return true;
    }
    writeDataset(owner, newFullName, readDataset(owner, fullName));
    fs.unlinkSync(dataFilePath(owner, fullName));
    console.log(`Dataset visibility changed: ${owner}/${fullName} → ${owner}/${newFullName}`);
    jsonReply(res, 200, { ok: true, name, fullName: newFullName, owner, visibility: newVisibility });
    return true;
  }

  // DELETE /api/datasets/:owner/:fullName  —  permanently delete a dataset (owner only)
  if (/^\/api\/datasets\/[^/]+\/[^/]+$/.test(pathname) && req.method === 'DELETE') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const [, , , owner, fullName] = pathname.split('/');
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot delete another user\'s dataset' }); return true; }
    const filePath = dataFilePath(owner, fullName);
    if (!fs.existsSync(filePath)) { jsonReply(res, 404, { error: 'Dataset not found' }); return true; }
    fs.unlinkSync(filePath);
    console.log(`Dataset deleted: ${owner}/${fullName}`);
    jsonReply(res, 200, { ok: true });
    return true;
  }

  // GET /api/data/:owner/:fullName  —  read a dataset
  if (pathname.startsWith('/api/data/') && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const parsed = parseDataPath(pathname);
    if (!parsed) { jsonReply(res, 400, { error: 'Invalid path — expected /api/data/:owner/:name-{private|public}' }); return true; }
    const { owner, fullName, visibility } = parsed;
    if (visibility === 'private' && owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Access denied' }); return true; }
    jsonReply(res, 200, readDataset(owner, fullName));
    return true;
  }

  // PUT /api/data/:owner/:fullName  —  write a dataset (owner only)
  if (pathname.startsWith('/api/data/') && req.method === 'PUT') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const parsed = parseDataPath(pathname);
    if (!parsed) { jsonReply(res, 400, { error: 'Invalid path — expected /api/data/:owner/:name-{private|public}' }); return true; }
    const { owner, fullName } = parsed;
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot write to another user\'s dataset' }); return true; }
    try {
      const incoming = JSON.parse(await readBody(req));
      const current  = readDataset(owner, fullName);
      const currentVersion  = current._version  || 0;
      const incomingVersion = incoming._version || 0;
      if (!force && currentVersion > 0 && incomingVersion !== currentVersion) {
        jsonReply(res, 409, { error: 'Dataset has been modified by another session — reload to get the latest data.' });
        return true;
      }
      incoming._version = currentVersion + 1;
      writeDataset(owner, fullName, incoming);
      console.log(`[data] ${owner}/${fullName} saved at version ${incoming._version}`);
      jsonReply(res, 200, { ok: true, version: incoming._version });
    } catch {
      jsonReply(res, 400, { error: 'Invalid JSON' });
    }
    return true;
  }

  return false;
}