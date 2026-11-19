'use strict';

// Beacons tab (ToDo.MD "Add a new timing method" — Beacons) — DOM/orchestration only, mirroring
// mobile-files-progress.js's own split: the actual validation/apply logic is pure and lives in
// js/mobile-beacons.js, with no DOM in it at all.
//
// This tab is purely a read-out of state.beaconReports/state.beacons now — mirroring
// mobile-files-progress.js's own "seed from the registry, then merge in report data" pattern,
// buildBeaconRows() below seeds one row per issuedBeaconNumbers() first (status 'issued', other
// columns pre-filled from the Beacons catalogue page) so the tab lists every beacon out on course
// even before any Close-mode data has been extracted, then overlays returned/missing status once
// it has. There's deliberately no button/action of its own any more (ToDo.MD: "Beacons tab still
// has read beacons report, now redundant as update progress should do it from entries in the
// selected device files") — js/mobile-files-progress.js's own applyComputedResults() calls
// js/mobile-beacons.js directly as part of every Update Progress run, so this tab just reflects
// whatever that last computed; there's nothing left here to trigger by hand.
// initBeaconsTab() still takes the same { renderAll } injection mobile-files.js's other sibling
// tab modules do, purely for consistency with that pattern (see mobile-files.js's own doc on why
// it's injected rather than imported directly) — kept even though this tab doesn't currently need
// to trigger a full mobile-files re-render itself.

import { on, val, renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import { state, saveEvent } from '../state.js';
import { coursesInUse } from '../categories.js';
import { deriveRaceLabel, formatStoredTimestamp } from '../mobile-files-shared.js';
import { issuedBeaconNumbers } from '../mobile-beacons.js';

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
  const missing = new Set(report ? report.missing : []);
  const returned = new Set(report ? report.returned : []);
  const numbers = [...new Set([...issuedBeaconNumbers(), ...returned, ...missing])].sort((a, b) => a - b);
  return numbers.map(number => {
    const beacon = state.beacons.find(b => +b.number === number);
    const status = missing.has(number) ? 'missing' : returned.has(number) ? 'returned' : 'issued';
    return {
      number,
      status,
      // Mirrors racemaster-mobile's own CloseBeaconsScreen "closed ×N" wording — a beacon
      // re-presented and closed more than once this race, not just a plain return.
      closeCount: report?.closeCounts?.[number] || 0,
      // ToDo.MD: "add an 'As At' column ... that reflects the time of last status change" — the
      // one status change this report actually timestamps per-beacon (computeBeaconCatalogueUpdates()'s
      // own appliedCloseAt, phone-clock closedAt, mobile-beacons.js), present only once a beacon's
      // actually been closed; missing/issued has had no status change to report a time for.
      asAt: report?.appliedCloseAt?.[number] || '',
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
  const rows = buildBeaconRows(report);

  const thresholdEl = document.getElementById('mobile-beacon-threshold');
  if (thresholdEl && document.activeElement !== thresholdEl) thresholdEl.value = threshold;

  renderTable('mobile-beacons-tbody', tableColumns(TABLES['mobile-beacons'], {
    number:       r => String(r.number),
    status:       r => (r.status === 'missing' ? '<span style="color:var(--danger)">Missing</span>'
      : r.status === 'issued' ? 'Issued' : 'Returned') + (r.closeCount > 1 ? ` (closed ×${r.closeCount})` : ''),
    asAt:         r => formatStoredTimestamp(r.asAt),
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
      statusEl.textContent = `From last Update Progress: ${report.missing.length} missing, ${report.returned.length} returned`
        + (report.processedAt ? ` (${new Date(report.processedAt).toLocaleString()})` : '');
    }
  }
}

async function saveBeaconThreshold() {
  const threshold = +val('mobile-beacon-threshold') || 20;
  if (threshold === +state.event.beaconLowBatteryThreshold) return;
  state.event.beaconLowBatteryThreshold = threshold;
  await saveEvent();
  renderMobileBeaconsTab();
}

export function wireBeaconsTab() {
  on('mobile-beacon-threshold', 'change', saveBeaconThreshold);
}
