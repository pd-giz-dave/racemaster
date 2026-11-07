'use strict';

// Beacons tab (ToDo.MD "Add a new timing method" — Beacons) — DOM/orchestration only, mirroring
// mobile-files-progress.js's own split: the actual report validation/apply logic is pure and
// lives in js/mobile-beacons.js, with no DOM in it at all.
//
// Unlike Progress, there's nothing here to select rows for — a beacons.json report is read
// whole, for one race, straight from the server (or, once the mobile side ships the real GATT
// characteristic, over Bluetooth first). initBeaconsTab() still takes the same
// { renderAll } injection mobile-files.js's other sibling tab modules do, purely for
// consistency with that pattern (see mobile-files.js's own doc on why it's injected rather than
// imported directly) — kept even though this tab doesn't currently need to trigger a full
// mobile-files re-render itself.

import { on, showConfirmDialog, showStatus, renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import { state } from '../state.js';
import { coursesInUse } from '../categories.js';
import { deriveRaceLabel } from '../mobile-files-shared.js';
import { getSession, getUsername, apiReadBeaconsReport } from '../storage.js';
import { pullBeaconsReportFromConnectedPhone } from '../mule-ble.js';
import { validateAndComputeBeaconReport, applyBeaconReportResults } from '../mobile-beacons.js';

let renderAll = null;
export function initBeaconsTab({ renderAll: r }) {
  renderAll = r;
}

// A beacon fleet isn't scoped to one course the way a phone's own progress upload is (see
// js/mobile-beacons.js's own raceStartMs() doc) — the earliest in-use course's own race label
// stands in for "this event" throughout this tab, same as that file's start-time calculation.
function currentBeaconsRaceLabel() {
  return deriveRaceLabel(state.event, coursesInUse()[0]);
}

function buildBeaconRows(report) {
  const missing = new Set(report.missing);
  const numbers = [...new Set([...report.returned, ...report.missing])].sort((a, b) => a - b);
  return numbers.map(number => {
    const beacon = state.beacons.find(b => +b.number === number);
    return {
      number,
      status: missing.has(number) ? 'missing' : 'returned',
      batteryLevel: beacon ? +beacon.batteryLevel : null,
      lastUsed: beacon?.lastUsed || '',
      owner: beacon?.owner || '',
    };
  });
}

export function renderMobileBeaconsTab() {
  const raceLabel = currentBeaconsRaceLabel();
  const report = raceLabel ? state.beaconReports.find(r => r.raceLabel === raceLabel) : null;
  const threshold = +state.event.beaconLowBatteryThreshold || 20;
  const rows = report ? buildBeaconRows(report) : [];

  renderTable('mobile-beacons-tbody', tableColumns(TABLES['mobile-beacons'], {
    number:       r => String(r.number),
    status:       r => r.status === 'missing' ? '<span style="color:var(--danger)">Missing</span>' : 'Returned',
    batteryLevel: r => r.batteryLevel == null ? '' : (r.batteryLevel < threshold
      ? `<span style="color:var(--danger)">${r.batteryLevel}%</span>` : `${r.batteryLevel}%`),
    lastUsed:     r => escHtml(r.lastUsed || ''),
    owner:        r => escHtml(r.owner || ''),
  }), rows, {
    rowAttrs: r => ({ class: r.status === 'missing' ? 'row-error' : '' }),
  });

  const statusEl = document.getElementById('mobile-beacons-status');
  if (statusEl) {
    statusEl.hidden = !report;
    if (report) {
      statusEl.textContent = `Last read: ${report.missing.length} missing, ${report.returned.length} returned`
        + (report.processedAt ? ` (processed ${new Date(report.processedAt).toLocaleString()})` : '');
    }
  }
}

export async function readBeaconsReport() {
  const session = getSession();
  if (!session) { showStatus('Sign in on the Datasets page to read a beacons report.', true); return; }
  const raceLabel = currentBeaconsRaceLabel();
  if (!raceLabel) { showStatus('Set the event name and date first.', true); return; }

  showStatus('Reading beacons report…');
  const bt = await pullBeaconsReportFromConnectedPhone();
  const report = bt.supported ? bt.report : await apiReadBeaconsReport(session.token, getUsername(), raceLabel);
  if (!report) {
    showStatus('No beacons report found for this race yet.', true);
    return;
  }

  const plan = validateAndComputeBeaconReport(report, raceLabel);
  const parts = [];
  if (plan.toApply.length) parts.push(`${plan.toApply.length} beacon(s) to update`);
  if (plan.missing.length) parts.push(`${plan.missing.length} beacon(s) still missing`);
  const summary = parts.length ? parts.join(', ') : 'nothing new';
  if (!await showConfirmDialog(`Apply this beacons report (${summary})?`, 'Read Beacons Report')) return;

  await applyBeaconReportResults(plan, report, raceLabel);
  renderMobileBeaconsTab();
  document.querySelector('#mobile-files-tab-bar [data-mf-tab="beacons"]')?.click();
  showStatus(`Beacons report applied: ${summary}.`);
}

export function wireBeaconsTab() {
  on('btn-read-beacons-report', 'click', readBeaconsReport);
}
