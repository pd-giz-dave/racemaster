'use strict';

// End-to-end HTTP tests: spawns the real `node server.js` as a child process, pointed at a
// scratch RACEMASTER_ROOT so it never touches this checkout's real data/users.txt/etc., and
// drives it entirely over real HTTP with fetch() — no mocking, no importing server internals.
// This is deliberately the "does the wiring actually work end-to-end" layer; exact per-field
// behavior of each route's logic is already covered by the other test/server/*.test.js files
// against the individual modules directly.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVER_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.js');

let child;
let base;
let scratchRoot;

// A fixed port, not PORT=0 — the startup banner logs the *configured* PORT value, not the
// OS-assigned one server.address() would report, so with PORT=0 there'd be no reliable way to
// discover which port it actually bound to short of changing server.js just for this. Only
// this one file uses it, so no collision risk even though node --test runs files concurrently.
const TEST_PORT = 39875;

before(async () => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'racemaster-integration-'));
  fs.writeFileSync(path.join(scratchRoot, 'index.html'), '<!doctype html><title>scratch</title>', 'utf8');
  fs.writeFileSync(path.join(scratchRoot, 'sw.js'), "'use strict';\nconst CACHE = 'x';\nconst PRECACHE = [\n  '/',\n];\n", 'utf8');
  base = `http://127.0.0.1:${TEST_PORT}`;

  let stderr = '';
  child = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, RACEMASTER_ROOT: scratchRoot, PORT: String(TEST_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const deadline = Date.now() + 5000;
  for (;;) {
    if (!child || child.exitCode !== null) throw new Error(`server exited early; stderr:\n${stderr}`);
    try {
      const r = await fetch(`${base}/api/ping`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server did not respond to /api/ping within 5s; stderr:\n${stderr}`);
    await new Promise(r => setTimeout(r, 50));
  }
});

after(() => {
  child?.kill();
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

async function createAndLogin(username, password = 'secret123') {
  await fetch(`${base}/api/auth/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const { token } = await r.json();
  return token;
}

describe('server integration: liveness', () => {
  it('GET /api/ping responds ok, no auth required', async () => {
    const r = await fetch(`${base}/api/ping`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, sink: true });
  });
});

describe('server integration: auth', () => {
  it('the first-ever account created becomes admin; a second does not', async () => {
    const r1 = await fetch(`${base}/api/auth/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'first-user', password: 'secret123' }),
    });
    assert.equal((await r1.json()).isAdmin, true);

    const r2 = await fetch(`${base}/api/auth/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'second-user', password: 'secret123' }),
    });
    assert.equal((await r2.json()).isAdmin, false);
  });

  it('rejects login with the wrong password', async () => {
    await createAndLogin('wrongpw-user');
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'wrongpw-user', password: 'nope' }),
    });
    assert.equal(r.status, 401);
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    const r = await fetch(`${base}/api/datasets`);
    assert.equal(r.status, 401);
  });
});

describe('server integration: datasets', () => {
  it('create -> list -> get -> put with version conflict, end to end', async () => {
    const token = await createAndLogin('dataset-user');
    const auth = { Authorization: `Bearer ${token}` };

    const created = await fetch(`${base}/api/datasets`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'my-race', visibility: 'private' }),
    });
    assert.equal(created.status, 200);

    const list = await (await fetch(`${base}/api/datasets`, { headers: auth })).json();
    assert.ok(list.some(d => d.fullName === 'my-race-private'));

    const got = await (await fetch(`${base}/api/data/dataset-user/my-race-private`, { headers: auth })).json();
    assert.deepEqual(got, { _version: 1 });

    const put1 = await fetch(`${base}/api/data/dataset-user/my-race-private`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ _version: 1, entries: [{ bibNumber: 1 }] }),
    });
    assert.equal((await put1.json()).version, 2);

    // Stale version -> 409
    const put2 = await fetch(`${base}/api/data/dataset-user/my-race-private`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ _version: 1, entries: [] }),
    });
    assert.equal(put2.status, 409);
  });

  it('cannot read another user\'s private dataset', async () => {
    const tokenA = await createAndLogin('owner-user');
    const tokenB = await createAndLogin('other-user');
    await fetch(`${base}/api/datasets`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'secret-race', visibility: 'private' }),
    });
    const r = await fetch(`${base}/api/data/owner-user/secret-race-private`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(r.status, 403);
  });

  it('a non-admin cannot copy a dataset into another user\'s folder', async () => {
    const token = await createAndLogin('copy-plain-user');
    await createAndLogin('copy-plain-target');
    await fetch(`${base}/api/datasets`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'own-race', visibility: 'private' }),
    });
    const r = await fetch(`${base}/api/datasets/copy`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromOwner: 'copy-plain-user', fromFullName: 'own-race-private',
        toName: 'copied-race', visibility: 'private', toOwner: 'copy-plain-target',
      }),
    });
    assert.equal(r.status, 403);
  });

  it('an admin can copy a dataset into a different, existing user\'s folder', async () => {
    // 'first-user' from the earlier auth test is this run's admin.
    const adminToken = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'first-user', password: 'secret123' }),
    }).then(r => r.json())).token;
    const sourceToken = await createAndLogin('copy-admin-source');
    const targetToken = await createAndLogin('copy-admin-target');
    await fetch(`${base}/api/datasets`, {
      method: 'POST', headers: { Authorization: `Bearer ${sourceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'donor-race', visibility: 'private' }),
    });

    const copy = await fetch(`${base}/api/datasets/copy`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromOwner: 'copy-admin-source', fromFullName: 'donor-race-private',
        toName: 'donor-race-copy', visibility: 'private', toOwner: 'copy-admin-target',
      }),
    });
    assert.equal(copy.status, 200);
    assert.deepEqual(await copy.json(), {
      ok: true, name: 'donor-race-copy', fullName: 'donor-race-copy-private',
      owner: 'copy-admin-target', visibility: 'private',
    });

    const got = await fetch(`${base}/api/data/copy-admin-target/donor-race-copy-private`, {
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    assert.equal(got.status, 200);
  });

  it('rejects an admin copy to a user that does not exist', async () => {
    const adminToken = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'first-user', password: 'secret123' }),
    }).then(r => r.json())).token;
    const sourceToken = await createAndLogin('copy-admin-source2');
    await fetch(`${base}/api/datasets`, {
      method: 'POST', headers: { Authorization: `Bearer ${sourceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'donor-race2', visibility: 'private' }),
    });

    const r = await fetch(`${base}/api/datasets/copy`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromOwner: 'copy-admin-source2', fromFullName: 'donor-race2-private',
        toName: 'donor-race2-copy', visibility: 'private', toOwner: 'no-such-user',
      }),
    });
    assert.equal(r.status, 404);
  });
});

describe('server integration: mobile sync', () => {
  it('push -> status -> list, with delta-merge dedup by recordUuid', async () => {
    const token = await createAndLogin('mobile-user');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const raceLabel = 'integration-race-26-08-23';

    const push1 = await fetch(`${base}/api/mobile/${raceLabel}`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ devices: { PhoneA: [{ recordUuid: 'u1', action: 'Finish', bibNumber: 1, lineNumber: 1 }] } }),
    });
    assert.deepEqual(await push1.json(), { ok: true, added: 1, received: 1, version: 1 });

    // Re-push the same record -> not re-added
    const push2 = await fetch(`${base}/api/mobile/${raceLabel}`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ devices: { PhoneA: [{ recordUuid: 'u1', action: 'Finish', bibNumber: 1, lineNumber: 1 }] } }),
    });
    assert.equal((await push2.json()).added, 0);

    const status = await (await fetch(`${base}/api/mobile/${raceLabel}/status`, { headers: auth })).json();
    assert.deepEqual(status, { phonea: 1 });

    const list = await (await fetch(`${base}/api/mobile`, { headers: auth })).json();
    const race = list.find(r => r.raceLabel === raceLabel);
    assert.equal(race.recordCount, 1);
  });
});

describe('server integration: bib-allocations', () => {
  it('an owner pushing their own bib-allocations lands under their own mobile/ folder', async () => {
    const token = await createAndLogin('ba-owner');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const raceLabel = 'ba-race-26-08-23';

    const push = await fetch(`${base}/api/mobile/ba-owner/${raceLabel}/bib-allocations`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ raceName: 'X', raceDate: '23/08/2026', entries: [{ bibNumber: 1, name: 'A', course: '10K' }] }),
    });
    assert.equal(push.status, 200);

    const list = await (await fetch(`${base}/api/mobile`, { headers: auth })).json();
    const race = list.find(r => r.raceLabel === raceLabel);
    assert.ok(race.bibAllocations);
  });

  it('rejects pushing bib-allocations under a dataset owned by a different, non-admin user', async () => {
    const victimToken = await createAndLogin('ba-victim');
    await fetch(`${base}/api/mobile/ba-victim/some-race/bib-allocations`, {
      method: 'POST', headers: { Authorization: `Bearer ${victimToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ bibNumber: 1, name: 'A', course: '10K' }] }),
    });

    const attackerToken = await createAndLogin('ba-attacker');
    const r = await fetch(`${base}/api/mobile/ba-victim/some-race/bib-allocations`, {
      method: 'POST', headers: { Authorization: `Bearer ${attackerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ bibNumber: 2, name: 'B', course: '10K' }] }),
    });
    assert.equal(r.status, 403);
  });

  it('lets an admin push bib-allocations under another user\'s dataset', async () => {
    // 'first-user' from the earlier auth test is this run's admin.
    const adminToken = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'first-user', password: 'secret123' }),
    }).then(r => r.json())).token;
    await createAndLogin('ba-someone-else');

    const r = await fetch(`${base}/api/mobile/ba-someone-else/admin-pushed-race/bib-allocations`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ bibNumber: 3, name: 'C', course: '10K' }] }),
    });
    assert.equal(r.status, 200);
  });
});

describe('server integration: admin users routes', () => {
  it('a non-admin gets 403 from the admin-only user routes', async () => {
    const token = await createAndLogin('plain-user');
    const r = await fetch(`${base}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 403);
  });

  it('deleting a user revokes their existing session', async () => {
    // 'first-user' from the earlier test is this run's admin.
    const adminToken = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'first-user', password: 'secret123' }),
    }).then(r => r.json())).token;
    const victimToken = await createAndLogin('victim-user');

    const del = await fetch(`${base}/api/users/victim-user`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(del.status, 200);

    const r = await fetch(`${base}/api/datasets`, { headers: { Authorization: `Bearer ${victimToken}` } });
    assert.equal(r.status, 401);
  });
});

describe('server integration: static files', () => {
  it('serves the scratch root\'s index.html at /, and 404s an unknown path', async () => {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /scratch/);
    const missing = await fetch(`${base}/definitely-not-a-real-file.xyz`);
    assert.equal(missing.status, 404);
  });

  it('serves the dynamically generated /sw.js', async () => {
    const r = await fetch(`${base}/sw.js`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /const CACHE = 'racemaster-[0-9a-f]{12}';/);
  });
});
