'use strict';

import { getSession, getIsAdmin, apiListMobileFiles, apiDeleteMobileFile } from '../storage.js';
import { escHtml, showConfirmDialog, showStatus } from '../ui.js';

function getEl(id) { return document.getElementById(id); }

let currentRaces = [];

function formatRaceDate(raceDate) {
  if (!raceDate) return '<span style="color:var(--muted)">Unknown</span>';
  return `${raceDate.dd}/${raceDate.mm}/${raceDate.yy}`;
}

// ---- Segment view (mirrors racemaster-mobile's observeCurrentSegment + foldLatestVisible) ----
//
// A device's file interleaves two independent, separately-numbered families of rows — Time
// splits (splitTime non-null) and Bibs/CP entries (splitTime null, bibNumber instead) — each
// with its own Reset boundary and its own edit-echo/undo-marker history. "Current segment" means
// only the rows since that family's own most recent Reset, folded down to one row per logical
// entry (the latest edit, with anything since-undone dropped) — exactly what the phone's own
// live screen would be showing. See HistoryLineDao.observeCurrentSegment / HistoryFold.
// foldLatestVisible in racemaster-mobile for the reference implementation this mirrors.

function currentSegment(rows) {
  const resetLine = rows.reduce((max, r) => r.action === 'Reset' ? Math.max(max, r.lineNumber ?? 0) : max, 0);
  return rows.filter(r => (r.lineNumber ?? 0) > resetLine);
}

function foldLatestVisible(rows) {
  const latestByRoot = new Map();
  for (const r of rows) {
    const key = r.refLineNumber ?? r.lineNumber;
    const cur = latestByRoot.get(key);
    if (!cur || (r.lineNumber ?? 0) > (cur.lineNumber ?? 0)) latestByRoot.set(key, r);
  }
  return [...latestByRoot.values()].filter(r => r.action !== 'Undo');
}

function bySplitNumber(a, b) { return (a.splitNumber ?? 0) - (b.splitNumber ?? 0); }

function formatCount(visible, raw) {
  return raw === 0 ? '' : `${visible} (from ${raw})`;
}

function buildSegmentView(lines) {
  const timeRows = lines.filter(r => r.splitTime != null);
  const bibsRows = lines.filter(r => r.splitTime == null);
  return {
    timeSegment: foldLatestVisible(currentSegment(timeRows)).sort(bySplitNumber),
    bibsSegment: foldLatestVisible(currentSegment(bibsRows)).sort(bySplitNumber),
  };
}

// "yyyy/MM/dd HH:mm:ss" (the phone's own local time) → just the "HH:mm:ss" part. Field was
// renamed server-side from timestampMillis to timestamp (see server.js's coerce()) — files
// written before that rename are still on disk under the old name, so read whichever is present.
function whenOf(r) {
  return ((r.timestamp ?? r.timestampMillis) || '').split(' ')[1] || '';
}

// Every visible line should share one location (it's stamped from the race's own
// RaceEntity.location, the same for every record a device sends for that race) — anything
// else means the file is invalid.
function locationSummary(visibleRows) {
  const locations = [...new Set(visibleRows.map(r => r.location))];
  if (locations.length <= 1) return escHtml(locations[0] || '—');
  return `<span style="color:var(--danger)">Inconsistent (${locations.map(escHtml).join(', ')}) — file is invalid</span>`;
}

function showDeviceModal(owner, raceLabel, deviceName, lines) {
  const { timeSegment, bibsSegment } = buildSegmentView(lines);
  const visibleRows = [...timeSegment, ...bibsSegment];
  const splitNumbers = [...new Set(visibleRows.map(r => r.splitNumber ?? 0))].sort((a, b) => a - b);

  const rows = splitNumbers.map(n => {
    const bib  = bibsSegment.find(r => (r.splitNumber ?? 0) === n);
    const time = timeSegment.find(r => (r.splitNumber ?? 0) === n);
    return `<tr>
      <td>${n}</td>
      <td>${bib ? escHtml(bib.action) : ''}</td>
      <td>${bib ? escHtml(bib.bibNumber ?? '') : ''}</td>
      <td>${bib ? whenOf(bib) : ''}</td>
      <td>${time ? escHtml(time.action) : ''}</td>
      <td>${time ? escHtml(time.splitTime ?? '') : ''}</td>
      <td>${time ? whenOf(time) : ''}</td>
    </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:640px">
      <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
      <p style="margin:0 0 12px;font-size:0.875rem">Location: ${locationSummary(visibleRows)}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th rowspan="2">Split #</th>
            <th colspan="3">Bibs</th>
            <th colspan="3">Time</th>
          </tr><tr>
            <th>Action</th><th>Bib</th><th>When</th><th>Action</th><th>Split Time</th><th>When</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="color:var(--muted)">No entries in the current segment.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="mobile-file-modal-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#mobile-file-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// Raw listing — every field of every line, unfiltered and unfolded, straight from the file.
function showRawModal(owner, raceLabel, deviceName, lines) {
  const fields = [...new Set(lines.flatMap(r => Object.keys(r)))];
  const sorted = [...lines].sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
  const headerRow = fields.map(f => `<th>${escHtml(f)}</th>`).join('');
  const rows = sorted.map(r => `<tr>${fields.map(f => `<td>${escHtml(r[f] ?? '')}</td>`).join('')}</tr>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:90vw;max-width:1100px">
      <h2>${escHtml(deviceName)} — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''} — raw</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${fields.length}" style="color:var(--muted)">No lines in this file.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="mobile-file-modal-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#mobile-file-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

// ---- List (one row per device) ----

function flattenDevices(races) {
  const rows = [];
  for (const race of races) {
    for (const device of race.devices) {
      rows.push({ owner: race.owner, raceLabel: race.raceLabel, raceDate: race.raceDate, device });
    }
  }
  return rows;
}

function renderRaceList(races, isAdminUser) {
  const list = getEl('mobile-files-list');
  if (!list) return;
  const rows = flattenDevices(races);
  if (!rows.length) {
    list.innerHTML = '<p style="color:var(--muted)">No mobile files uploaded yet.</p>';
    return;
  }
  const trs = rows.map((r, i) => {
    const { timeSegment, bibsSegment } = buildSegmentView(r.device.lines);
    const rawBibs = r.device.lines.filter(l => l.splitTime == null).length;
    const rawTime = r.device.lines.filter(l => l.splitTime != null).length;
    return `<tr>
      <td><input type="checkbox" class="mobile-file-select" data-idx="${i}" aria-label="Select ${escHtml(r.device.name)}"></td>
      ${isAdminUser ? `<td>${escHtml(r.owner)}</td>` : ''}
      <td>${escHtml(r.raceLabel)}</td>
      <td>${formatRaceDate(r.raceDate)}</td>
      <td>${escHtml(r.device.name)}</td>
      <td>${formatCount(bibsSegment.length, rawBibs)}</td>
      <td>${formatCount(timeSegment.length, rawTime)}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm mobile-file-view" data-idx="${i}">View</button>
        <button class="btn-sm mobile-file-raw" data-idx="${i}">Raw</button>
        <button class="btn-sm btn-delete mobile-file-delete" data-idx="${i}">Delete</button>
      </td>
    </tr>`;
  }).join('');
  list.innerHTML = `<table class="data-table">
    <thead><tr>
      <th></th>
      ${isAdminUser ? '<th>Owner</th>' : ''}
      <th>Race</th><th>Race Date</th><th>Device</th><th>Bibs</th><th>Time</th><th>Actions</th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>`;

  list.querySelectorAll('.mobile-file-view').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = rows[+btn.dataset.idx];
      showDeviceModal(r.owner, r.raceLabel, r.device.name, r.device.lines);
    });
  });
  list.querySelectorAll('.mobile-file-raw').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = rows[+btn.dataset.idx];
      showRawModal(r.owner, r.raceLabel, r.device.name, r.device.lines);
    });
  });
  list.querySelectorAll('.mobile-file-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = rows[+btn.dataset.idx];
      if (!await showConfirmDialog(`Delete "${r.device.name}" from "${r.raceLabel}"? This cannot be undone.`, 'Delete', true)) return;
      const session = getSession();
      const result = await apiDeleteMobileFile(session.token, r.owner, r.raceLabel, r.device.name);
      if (result.error) { showStatus(result.error, true); return; }
      showStatus(`"${r.device.name}" deleted.`);
      renderMobileFiles();
    });
  });
}

export function renderMobileFiles() {
  const session = getSession();
  const status  = getEl('mobile-files-status');
  const count   = getEl('mobile-files-count');
  if (!session) {
    if (status) status.textContent = 'Sign in on the Datasets page to view mobile files.';
    currentRaces = [];
    renderRaceList([], false);
    if (count) count.textContent = '0';
    return;
  }
  const isAdminUser = getIsAdmin();
  if (status) status.textContent = 'Loading…';
  apiListMobileFiles(session.token).then(races => {
    currentRaces = Array.isArray(races) ? races : [];
    if (status) status.textContent = '';
    if (count) count.textContent = `${currentRaces.length} race${currentRaces.length === 1 ? '' : 's'}`;
    renderRaceList(currentRaces, isAdminUser);
  }).catch(() => {
    if (status) status.textContent = 'Could not load mobile files.';
  });
}