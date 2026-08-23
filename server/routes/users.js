'use strict';

import { readBody, jsonReply } from '../http-utils.js';
import { sanitiseName } from '../datasets.js';
import { getAuthUser, isAdmin, readUsers, writeUsers, readAdmins, writeAdmins, deleteSessionsForUser, saveSessions } from '../auth.js';

// Returns true if this request was matched and handled (a response was sent), false otherwise.
export async function handleUserRoutes(req, res, pathname) {
  // GET /api/users  — admin only, list all users
  if (pathname === '/api/users' && req.method === 'GET') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    if (!isAdmin(username)) { jsonReply(res, 403, { error: 'Admin only' }); return true; }
    const users  = readUsers();
    const admins = readAdmins();
    const list = Object.keys(users).sort().map(u => ({ username: u, isAdmin: admins.has(u) }));
    jsonReply(res, 200, list);
    return true;
  }

  // PATCH /api/users/:username  — admin only, grant/revoke admin (not self)
  if (pathname.startsWith('/api/users/') && req.method === 'PATCH') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    if (!isAdmin(username)) { jsonReply(res, 403, { error: 'Admin only' }); return true; }
    const target = sanitiseName(pathname.slice('/api/users/'.length));
    if (!target) { jsonReply(res, 400, { error: 'Invalid username' }); return true; }
    if (target === username) { jsonReply(res, 400, { error: 'Cannot change your own admin status' }); return true; }
    const users = readUsers();
    if (!users[target]) { jsonReply(res, 404, { error: 'User not found' }); return true; }
    const body = JSON.parse(await readBody(req));
    const admins = readAdmins();
    if (body.isAdmin) admins.add(target); else admins.delete(target);
    writeAdmins(admins);
    console.log(`Admin ${username} ${body.isAdmin ? 'granted' : 'revoked'} admin for ${target}`);
    jsonReply(res, 200, { ok: true });
    return true;
  }

  // DELETE /api/users/:username  — admin only, cannot delete self
  if (pathname.startsWith('/api/users/') && req.method === 'DELETE') {
    const username = getAuthUser(req);
    if (!username) { jsonReply(res, 401, { error: 'Unauthorised' }); return true; }
    if (!isAdmin(username)) { jsonReply(res, 403, { error: 'Admin only' }); return true; }
    const target = sanitiseName(pathname.slice('/api/users/'.length));
    if (!target) { jsonReply(res, 400, { error: 'Invalid username' }); return true; }
    if (target === username) { jsonReply(res, 400, { error: 'Cannot delete your own account' }); return true; }
    const users = readUsers();
    if (!users[target]) { jsonReply(res, 404, { error: 'User not found' }); return true; }
    delete users[target];
    writeUsers(users);
    const admins = readAdmins();
    admins.delete(target);
    writeAdmins(admins);
    deleteSessionsForUser(target);
    saveSessions();
    console.log(`User deleted by admin ${username}: ${target}`);
    jsonReply(res, 200, { ok: true });
    return true;
  }

  return false;
}