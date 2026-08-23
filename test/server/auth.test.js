'use strict';

import './helpers/setup-root.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

import { ensureDirs, USERS_FILE, ADMINS_FILE, SESSIONS_FILE } from '../../server/config.js';
import {
  hashPw, newToken, readUsers, writeUsers, readAdmins, writeAdmins, isAdmin,
  loadSessions, saveSessions, addSession, getAuthUser, deleteSessionsForUser,
} from '../../server/auth.js';

beforeEach(() => {
  ensureDirs();
  for (const f of [USERS_FILE, ADMINS_FILE, SESSIONS_FILE]) {
    try { fs.unlinkSync(f); } catch { /* not present */ }
  }
});

describe('server/auth.js:hashPw / newToken', () => {
  it('hashPw is deterministic and produces a 64-char hex sha256', () => {
    const h = hashPw('secret');
    assert.equal(h, hashPw('secret'));
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, hashPw('different'));
  });

  it('newToken produces a 64-char hex random string, different each time', () => {
    const t1 = newToken();
    const t2 = newToken();
    assert.match(t1, /^[0-9a-f]{64}$/);
    assert.notEqual(t1, t2);
  });
});

describe('server/auth.js:readUsers / writeUsers', () => {
  it('round-trips a users map through the file', () => {
    writeUsers({ alice: 'hash1', bob: 'hash2' });
    assert.deepEqual(readUsers(), { alice: 'hash1', bob: 'hash2' });
  });

  it('returns {} when the file does not exist', () => {
    assert.deepEqual(readUsers(), {});
  });
});

describe('server/auth.js:readAdmins / writeAdmins / isAdmin', () => {
  it('round-trips an admin set through the file', () => {
    writeAdmins(new Set(['alice']));
    assert.deepEqual(readAdmins(), new Set(['alice']));
    assert.equal(isAdmin('alice'), true);
    assert.equal(isAdmin('bob'), false);
  });

  it('returns an empty set when the file does not exist', () => {
    assert.deepEqual(readAdmins(), new Set());
  });
});

describe('server/auth.js:sessions (loadSessions / saveSessions / addSession / getAuthUser)', () => {
  function fakeReq(token) {
    return { headers: token ? { authorization: `Bearer ${token}` } : {} };
  }

  it('addSession makes the token immediately usable via getAuthUser', () => {
    addSession('tok1', 'alice');
    assert.equal(getAuthUser(fakeReq('tok1')), 'alice');
  });

  it('getAuthUser returns null for a missing/malformed Authorization header', () => {
    assert.equal(getAuthUser(fakeReq(null)), null);
    assert.equal(getAuthUser({ headers: { authorization: 'NotBearer xyz' } }), null);
  });

  it('getAuthUser returns null for an unknown token', () => {
    assert.equal(getAuthUser(fakeReq('never-issued')), null);
  });

  it('addSession persists to SESSIONS_FILE, and loadSessions repopulates from it (e.g. after a restart)', () => {
    addSession('tok2', 'bob');
    assert.equal(fs.existsSync(SESSIONS_FILE), true);
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    assert.match(raw, /^tok2:bob:\d+$/m);
  });

  it('loadSessions skips already-expired entries from the file', () => {
    const past = Date.now() - 1000;
    fs.writeFileSync(SESSIONS_FILE, `expired-tok:carol:${past}\n`, 'utf8');
    loadSessions();
    assert.equal(getAuthUser(fakeReq('expired-tok')), null);
  });

  it('getAuthUser evicts and rejects a token that has since passed its expiry', () => {
    // Directly seed an expired session by writing the file and reloading, rather than waiting.
    const past = Date.now() - 1000;
    fs.writeFileSync(SESSIONS_FILE, `stale-tok:dave:${past}\n`, 'utf8');
    loadSessions();
    assert.equal(getAuthUser(fakeReq('stale-tok')), null);
  });

  it('deleteSessionsForUser removes every session belonging to that user, leaving others intact', () => {
    addSession('tokA', 'eve');
    addSession('tokB', 'eve');
    addSession('tokC', 'frank');
    deleteSessionsForUser('eve');
    saveSessions();
    assert.equal(getAuthUser(fakeReq('tokA')), null);
    assert.equal(getAuthUser(fakeReq('tokB')), null);
    assert.equal(getAuthUser(fakeReq('tokC')), 'frank');
  });
});
