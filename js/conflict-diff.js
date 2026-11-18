'use strict';

// Pure diffing logic for a save-conflict (HTTP 409 — see server/routes/datasets.js's PUT
// /api/data/:owner/:fullName, which 409s purely on `_version` mismatch, never on content) between
// the local unsynced cache (js/storage.js's dumpState()) and the server's current dataset
// (js/storage.js's apiReadDataset()). Both are the exact same JSON shape — { _version,
// <table>: [...rows], ... } for every table in js/state.js's state — so no per-table key
// knowledge is needed: each table's two row arrays are set-diffed by JSON.stringify(row) identity.
// A row edited on one side naturally shows up as one "only local" + one "only remote" entry.

export function buildConflictDiff(local, remote) {
  const localVersion  = local?._version  || 0;
  const remoteVersion = remote?._version || 0;
  const tables = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  tables.delete('_version');
  const tableDiffs = [];
  for (const table of tables) {
    const localRows  = Array.isArray(local?.[table])  ? local[table]  : [];
    const remoteRows = Array.isArray(remote?.[table]) ? remote[table] : [];
    const remoteSet = new Set(remoteRows.map(r => JSON.stringify(r)));
    const localSet  = new Set(localRows.map(r => JSON.stringify(r)));
    const onlyLocal  = localRows.filter(r => !remoteSet.has(JSON.stringify(r)));
    const onlyRemote = remoteRows.filter(r => !localSet.has(JSON.stringify(r)));
    if (onlyLocal.length || onlyRemote.length) tableDiffs.push({ table, onlyLocal, onlyRemote });
  }
  return {
    localVersion,
    remoteVersion,
    tableDiffs: tableDiffs.sort((a, b) => a.table.localeCompare(b.table)),
  };
}
