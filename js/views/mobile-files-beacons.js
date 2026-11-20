'use strict';

// Beacons tab (ToDo.MD "Add a new timing method" — Beacons) — DOM/orchestration only, mirroring
// mobile-files-progress.js's own split: the actual validation/apply logic is pure and lives in
// js/mobile-beacons.js, with no DOM in it at all.
//
// This tab is mostly a read-out of state.beacons/state.beaconReports — one row per
// issuedBeaconNumbers(), with status/asAt read straight off the catalogue (state.beacons[].status/
// asAt — see buildBeaconRows()'s own doc), kept current by js/mobile-beacons.js's
// applyBeaconStatusUpdates(), called from js/mobile-files-progress.js's applyComputedResults() as
// part of every Update Progress run (ToDo.MD: "Beacons tab still has read beacons report, now
// redundant as update progress should do it from entries in the selected device files"). The one
// action this tab still has of its own is manually returning a beacon (ToDo.MD: "need a way to
// manually return a beacon ... after the race was all over") — for the case a real Close report
// never arrives at all, see the "Manual beacon return" section below.
// initBeaconsTab() still takes the same { renderAll } injection mobile-files.js's other sibling
// tab modules do, purely for consistency with that pattern (see mobile-files.js's own doc on why
// it's injected rather than imported directly) — kept even though this tab doesn't currently need
// to trigger a full mobile-files re-render itself.

import { on, val, renderTable, tableColumns, showStatus } from '../ui.js';
import { escHtml, normaliseDate } from '../utils.js';
import { TABLES } from '../strings.js';
import { state, saveEvent } from '../state.js';
import { coursesInUse } from '../categories.js';
import { deriveRaceLabel, formatStoredTimestamp } from '../mobile-files-shared.js';
import { issuedBeaconNumbers, applyManualBeaconReturn, toPhoneTimestamp } from '../mobile-beacons.js';

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

// status/asAt come straight off the Beacons catalogue (state.beacons[].status/asAt, kept current
// by js/mobile-beacons.js's applyBeaconStatusUpdates() every Update Progress run) rather than
// being re-derived here from this race's own report — that's what lets them cross race boundaries
// (ToDo.MD) instead of resetting to blank/"Issued" the moment a new race's own report hasn't run
// yet. Strictly a 3-state pipeline — issued -> on-course -> returned (ToDo.MD) — with no separate
// "missing" alarm state of its own any more: a beacon still only 'issued' this late in a race just
// shows as Issued, the same as it would right after allocation. A beacon not yet in the catalogue
// at all (deleted, or never added) falls back to 'issued' too, since issuedBeaconNumbers() is the
// only way it could appear in this tab's row set in the first place.
function buildBeaconRows(report) {
  const numbers = [...issuedBeaconNumbers()].sort((a, b) => a - b);
  return numbers.map(number => {
    const beacon = state.beacons.find(b => +b.number === number);
    const status = beacon?.status === 'returned' || beacon?.status === 'on-course' ? beacon.status : 'issued';
    return {
      number,
      status,
      // Mirrors racemaster-mobile's own CloseBeaconsScreen "closed ×N" wording — a beacon
      // re-presented and closed more than once this race, not just a plain return.
      closeCount: report?.closeCounts?.[number] || 0,
      asAt: beacon?.asAt || '',
      batteryLevel: beacon ? +beacon.batteryLevel : null,
      lastUsed: beacon?.lastUsed || '',
      owner: beacon?.owner || '',
    };
  });
}

// Set while the inline Return form is open for a beacon — mirrors js/views/beacons.js's own
// editingNumber pattern. returnFormDefaults is snapshotted once, at open time, so a re-render
// triggered by something else (e.g. the battery threshold changing) while the form is still open
// doesn't reset whatever the operator has already typed back to "now".
let returningNumber = 0;
let returnFormDefaults = null;

export function renderMobileBeaconsTab() {
  const raceLabel = currentBeaconsRaceLabel();
  const report = raceLabel ? state.beaconReports.find(r => r.raceLabel === raceLabel) : null;
  const threshold = +state.event.beaconLowBatteryThreshold || 20;
  const rows = buildBeaconRows(report);

  const thresholdEl = document.getElementById('mobile-beacon-threshold');
  if (thresholdEl && document.activeElement !== thresholdEl) thresholdEl.value = threshold;

  const columns = tableColumns(TABLES['mobile-beacons'], {
    number:       r => String(r.number),
    status:       r => (r.status === 'on-course' ? 'On-course' : r.status === 'returned' ? 'Returned' : 'Issued')
      + (r.closeCount > 1 ? ` (closed ×${r.closeCount})` : ''),
    asAt:         r => formatStoredTimestamp(r.asAt),
    batteryLevel: r => r.batteryLevel == null ? '' : (r.batteryLevel < threshold
      ? `<span style="color:var(--danger)">${r.batteryLevel}%</span>` : `${r.batteryLevel}%`),
    lastUsed:     r => escHtml(r.lastUsed || ''),
    owner:        r => escHtml(r.owner || ''),
    actions:      r => `<button class="btn-sm" data-action="return" data-number="${r.number}">Return</button>`,
  });
  renderTable('mobile-beacons-tbody', columns, rows, {
    rowAttrs: r => ({ 'data-beacon-row': r.number }),
  });

  // Return form row (ToDo.MD: "the in-line return form should come up under the line being
  // returned and not always be at the top of the list") — inserted fresh after whichever row's
  // own number matches returningNumber, rather than living at a fixed position; see this
  // function's own re-render note above for why returnFormDefaults is snapshotted rather than
  // recomputed here.
  if (returningNumber) {
    const row = document.querySelector(`#mobile-beacons-tbody tr[data-beacon-row="${returningNumber}"]`);
    if (row) {
      row.insertAdjacentHTML('afterend', `<tr class="mobile-beacon-return-row"><td colspan="${columns.length}">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:2px 0">
          <strong style="font-size:0.875rem;white-space:nowrap">Return beacon ${returningNumber}:</strong>
          <label class="mf-option">Date <input type="text" id="mobile-beacon-return-date" placeholder="DD/MM/YY" data-normalise="date" value="${escHtml(returnFormDefaults.date)}" style="width:8em"></label>
          <label class="mf-option">Time <input type="text" id="mobile-beacon-return-time" placeholder="HH:MM" value="${escHtml(returnFormDefaults.time)}" style="width:4.5em"></label>
          <label class="mf-option">Battery <input type="number" id="mobile-beacon-return-battery" min="0" max="100" value="${escHtml(String(returnFormDefaults.battery))}" style="width:4.5em">%</label>
          <button class="btn btn-sm" data-action="confirm-return">Return</button>
          <button class="btn btn-secondary btn-sm" data-action="cancel-return">Cancel</button>
        </div>
      </td></tr>`);
      document.getElementById('mobile-beacon-return-battery')?.focus();
    }
  }

  const statusEl = document.getElementById('mobile-beacons-status');
  if (statusEl) {
    statusEl.hidden = !report;
    if (report) {
      statusEl.textContent = `From last Update Progress: ${report.missing.length} missing, ${report.returned.length} returned`
        + (report.processedAt ? ` (${new Date(report.processedAt).toLocaleString()})` : '');
    }
  }
}

// ---- Manual beacon return (ToDo.MD: "need a way to manually return a beacon via an action on
// the beacons tab ... that button should open a form to allow the last used date/time (default
// to now) and battery level to be entered") — for a beacon that comes back too late for its own
// race's own Update Progress run to ever see a real Close report for (a runner who went home
// with it and returned it some time later, after the race was all over).

function openReturnPanel(number) {
  const beacon = state.beacons.find(b => +b.number === number);
  if (!beacon) return;
  returningNumber = number;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  returnFormDefaults = {
    date: normaliseDate(`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    battery: beacon.batteryLevel ?? '',
  };
  renderMobileBeaconsTab();
}

function closeReturnPanel() {
  returningNumber = 0;
  returnFormDefaults = null;
  renderMobileBeaconsTab();
}

async function confirmBeaconReturn() {
  const number = returningNumber;
  if (!number) return;
  const date = normaliseDate(val('mobile-beacon-return-date').trim());
  if (!date) { showStatus('Enter a valid date.', true); return; }
  const time = /^(\d{1,2}):(\d{2})/.exec(val('mobile-beacon-return-time').trim());
  if (!time) { showStatus('Enter a valid time (HH:MM).', true); return; }
  const battery = val('mobile-beacon-return-battery').trim();
  if (battery === '' || isNaN(+battery)) { showStatus('Enter a battery level.', true); return; }
  const [dd, mm, yyyy] = date.split('/');
  const closedAt = toPhoneTimestamp(new Date(+yyyy, +mm - 1, +dd, +time[1], +time[2]));
  await applyManualBeaconReturn(number, closedAt, +battery);
  returningNumber = 0;
  returnFormDefaults = null;
  showStatus(`Beacon ${number} marked returned.`);
  renderMobileBeaconsTab();
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
  // Event delegation, not one-time on() bindings — the return form's own buttons are recreated
  // (as part of the tbody's own innerHTML) every render, not fixed DOM nodes wired once at
  // startup, so a listener attached directly to them would be lost the moment the row re-renders.
  document.getElementById('mobile-beacons-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'return') openReturnPanel(+btn.dataset.number);
    else if (btn.dataset.action === 'confirm-return') confirmBeaconReturn();
    else if (btn.dataset.action === 'cancel-return') closeReturnPanel();
  });
}
