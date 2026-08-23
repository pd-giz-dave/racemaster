'use strict';

import './helpers/setup-root.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';

import { readBody, jsonReply, parseDataPath } from '../../server/http-utils.js';

function fakeReq(chunks) {
  const req = new EventEmitter();
  queueMicrotask(() => {
    for (const c of chunks) req.emit('data', Buffer.from(c));
    req.emit('end');
  });
  return req;
}

function fakeRes() {
  return {
    statusCode: null, headers: null, body: null,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

describe('server/http-utils.js:readBody', () => {
  it('concatenates data chunks into the full utf8 body', async () => {
    const body = await readBody(fakeReq(['{"a":', '1}']));
    assert.equal(body, '{"a":1}');
  });

  it('resolves to empty string for a body with no chunks', async () => {
    const body = await readBody(fakeReq([]));
    assert.equal(body, '');
  });

  it('rejects if the request stream errors', async () => {
    const req = new EventEmitter();
    queueMicrotask(() => req.emit('error', new Error('boom')));
    await assert.rejects(() => readBody(req), /boom/);
  });
});

describe('server/http-utils.js:jsonReply', () => {
  it('writes the status, a JSON content-type header, and the JSON-serialised body', () => {
    const res = fakeRes();
    jsonReply(res, 201, { ok: true, n: 1 });
    assert.equal(res.statusCode, 201);
    assert.equal(res.headers['Content-Type'], 'application/json');
    assert.equal(res.body, '{"ok":true,"n":1}');
  });
});

describe('server/http-utils.js:parseDataPath', () => {
  it('parses a valid /api/data/:owner/:fullName path', () => {
    assert.deepEqual(parseDataPath('/api/data/alice/race-private'),
      { owner: 'alice', fullName: 'race-private', visibility: 'private' });
    assert.deepEqual(parseDataPath('/api/data/alice/race-public'),
      { owner: 'alice', fullName: 'race-public', visibility: 'public' });
  });

  it('sanitises owner/fullName the same way dataset names are sanitised', () => {
    const parsed = parseDataPath('/api/data/Alice!/Race 2026-private');
    assert.equal(parsed.owner, 'alice');
    assert.equal(parsed.fullName, 'race2026-private');
  });

  it('returns null when there is no owner/fullName split, or no -private/-public suffix', () => {
    assert.equal(parseDataPath('/api/data/onlyowner'), null);
    assert.equal(parseDataPath('/api/data/alice/race-nosuffix'), null);
  });
});
