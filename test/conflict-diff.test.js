'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildConflictDiff } from '../js/conflict-diff.js';

describe('buildConflictDiff', () => {
  it('reports no table diffs for identical snapshots', () => {
    const local  = { _version: 5, entries: [{ bibNumber: 1, name: 'A' }] };
    const remote = { _version: 5, entries: [{ bibNumber: 1, name: 'A' }] };
    const result = buildConflictDiff(local, remote);
    assert.equal(result.localVersion, 5);
    assert.equal(result.remoteVersion, 5);
    assert.deepEqual(result.tableDiffs, []);
  });

  it('reports the version gap even when content is identical', () => {
    const local  = { _version: 5, entries: [{ bibNumber: 1, name: 'A' }] };
    const remote = { _version: 6, entries: [{ bibNumber: 1, name: 'A' }] };
    const result = buildConflictDiff(local, remote);
    assert.equal(result.localVersion, 5);
    assert.equal(result.remoteVersion, 6);
    assert.deepEqual(result.tableDiffs, []);
  });

  it('flags a row that only exists locally', () => {
    const local  = { _version: 1, entries: [{ bibNumber: 1, name: 'A' }, { bibNumber: 2, name: 'B' }] };
    const remote = { _version: 1, entries: [{ bibNumber: 1, name: 'A' }] };
    const result = buildConflictDiff(local, remote);
    assert.equal(result.tableDiffs.length, 1);
    assert.equal(result.tableDiffs[0].table, 'entries');
    assert.deepEqual(result.tableDiffs[0].onlyLocal, [{ bibNumber: 2, name: 'B' }]);
    assert.deepEqual(result.tableDiffs[0].onlyRemote, []);
  });

  it('flags a row that only exists on the server', () => {
    const local  = { _version: 1, entries: [{ bibNumber: 1, name: 'A' }] };
    const remote = { _version: 1, entries: [{ bibNumber: 1, name: 'A' }, { bibNumber: 2, name: 'B' }] };
    const result = buildConflictDiff(local, remote);
    assert.equal(result.tableDiffs.length, 1);
    assert.deepEqual(result.tableDiffs[0].onlyLocal, []);
    assert.deepEqual(result.tableDiffs[0].onlyRemote, [{ bibNumber: 2, name: 'B' }]);
  });

  it('shows an edited row as one local entry paired with one remote entry', () => {
    const local  = { _version: 1, entries: [{ bibNumber: 1, name: 'A' }] };
    const remote = { _version: 1, entries: [{ bibNumber: 1, name: 'Alice' }] };
    const result = buildConflictDiff(local, remote);
    assert.equal(result.tableDiffs.length, 1);
    assert.deepEqual(result.tableDiffs[0].onlyLocal, [{ bibNumber: 1, name: 'A' }]);
    assert.deepEqual(result.tableDiffs[0].onlyRemote, [{ bibNumber: 1, name: 'Alice' }]);
  });

  it('treats a table missing from one side as empty rather than crashing', () => {
    const local  = { _version: 1, entries: [{ bibNumber: 1, name: 'A' }] };
    const remote = { _version: 1 };
    const result = buildConflictDiff(local, remote);
    assert.equal(result.tableDiffs.length, 1);
    assert.deepEqual(result.tableDiffs[0].onlyLocal, [{ bibNumber: 1, name: 'A' }]);
    assert.deepEqual(result.tableDiffs[0].onlyRemote, []);
  });

  it('ignores _version as a table name', () => {
    const local  = { _version: 1 };
    const remote = { _version: 2 };
    const result = buildConflictDiff(local, remote);
    assert.deepEqual(result.tableDiffs, []);
  });
});
