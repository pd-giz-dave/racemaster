'use strict';

import fs from 'fs';
import { readBody, jsonReply, parseDataPath } from '../http-utils.js';
import { sanitiseName, validDatasetName, conflictingDatasetName, dataFilePath, readDataset, writeDataset, emptyDataset, getDatasetsForUser } from '../datasets.js';
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

    const toName = validDatasetName(body.toName);
    const toVisibility = body.visibility === 'public' ? 'public' : 'private';
    if (!toName) { jsonReply(res, 400, { error: 'Invalid dataset name — must be letters, numbers and hyphens only, and not "public" or "private"' }); return true; }

    const toFullName = `${toName}-${toVisibility}`;
    const toConflict = conflictingDatasetName(toOwner, toName, toVisibility);
    if (toConflict) {
      const error = toConflict.fullName === toFullName
        ? `"${toOwner}" already has a dataset named "${toName}" (${toVisibility})`
        : `"${toOwner}" already has a dataset named "${toName}" (${toConflict.visibility}) — a dataset can't exist as both private and public under the same name`;
      jsonReply(res, 409, { error });
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
    const name = validDatasetName(body.name);
    const visibility = body.visibility === 'public' ? 'public' : 'private';

    if (!name) { jsonReply(res, 400, { error: 'Invalid dataset name — must be letters, numbers and hyphens only, and not "public" or "private"' }); return true; }

    const fullName = `${name}-${visibility}`;
    const conflict = conflictingDatasetName(username, name, visibility);
    if (conflict) {
      const error = conflict.fullName === fullName
        ? `You already have a dataset named "${name}" (${visibility})`
        : `You already have a dataset named "${name}" (${conflict.visibility}) — a dataset can't exist as both private and public under the same name`;
      jsonReply(res, 409, { error });
      return true;
    }

    writeDataset(username, fullName, emptyDataset());
    console.log(`Dataset created: ${username}/${fullName}`);
    jsonReply(res, 200, { ok: true, name, fullName, owner: username, visibility });
    return true;
  }

  // PATCH /api/datasets/:owner/:fullName  —  rename and/or change visibility
  if (/^\/api\/datasets\/[^/]+\/[^/]+$/.test(pathname) && req.method === 'PATCH') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    const [, , , owner, fullName] = pathname.split('/');
    if (owner !== username && !isAdmin(username)) { jsonReply(res, 403, { error: 'Cannot modify another user\'s dataset' }); return true; }
    const body = JSON.parse(await readBody(req));

    let currentName, currentVisibility;
    if (fullName.endsWith('-private'))     { currentVisibility = 'private'; currentName = fullName.slice(0, -8); }
    else if (fullName.endsWith('-public')) { currentVisibility = 'public';  currentName = fullName.slice(0, -7); }
    else { jsonReply(res, 400, { error: 'Invalid dataset name format' }); return true; }

    // Visibility defaults to whatever it already is — not "private" — so a rename-only
    // request (no visibility field sent) can't silently flip a public dataset to private.
    const newVisibility = body.visibility === 'public' ? 'public'
      : body.visibility === 'private' ? 'private'
      : currentVisibility;

    let newName = currentName;
    if (body.name !== undefined) {
      newName = validDatasetName(body.name);
      if (!newName) { jsonReply(res, 400, { error: 'Invalid dataset name — must be letters, numbers and hyphens only, and not "public" or "private"' }); return true; }
    }

    const newFullName = `${newName}-${newVisibility}`;
    if (newFullName === fullName) { jsonReply(res, 200, { ok: true, name: newName, fullName, owner, visibility: newVisibility }); return true; }
    if (!fs.existsSync(dataFilePath(owner, fullName))) { jsonReply(res, 404, { error: 'Dataset not found' }); return true; }
    const conflict = conflictingDatasetName(owner, newName, newVisibility, fullName);
    if (conflict) {
      const error = conflict.fullName === newFullName
        ? `A dataset "${newName}" (${newVisibility}) already exists`
        : `A dataset "${newName}" (${conflict.visibility}) already exists — a dataset can't exist as both private and public under the same name`;
      jsonReply(res, 409, { error });
      return true;
    }
    writeDataset(owner, newFullName, readDataset(owner, fullName));
    fs.unlinkSync(dataFilePath(owner, fullName));
    console.log(`Dataset updated: ${owner}/${fullName} → ${owner}/${newFullName}`);
    jsonReply(res, 200, { ok: true, name: newName, fullName: newFullName, owner, visibility: newVisibility });
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