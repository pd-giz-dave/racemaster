'use strict';

import { state } from './state.js';
import { getSortedEntries, getEntryName } from './entries.js';
import { getSession, apiPushBibAllocations } from './storage.js';

// Mirrors server.js's own sanitiseName() — also duplicated in mule-ble.js. Established
// convention in this codebase rather than sharing a one-line helper across modules.
function sanitiseName(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64).toLowerCase();
}

// Same "<name>-dd-mm-yy" convention a phone's own raceLabel already uses (see server.js's
// parseRaceLabelDate) — state.event.date is stored dd/mm/yyyy.
function deriveRaceLabel(event) {
  const [dd, mm, yyyy] = (event.date || '').split('/');
  if (!dd || !mm || !yyyy || !event.name) return '';
  return `${sanitiseName(event.name) || 'race'}-${dd}-${mm}-${yyyy.slice(-2)}`;
}

function buildPayload() {
  return {
    raceName: state.event.name,
    raceDate: state.event.date,
    entries: getSortedEntries().map(e => ({
      bibNumber: +e.bibNumber,
      name: getEntryName(e),
      course: e.course || '',
    })),
  };
}

async function pushBibAllocations() {
  const session = getSession();
  if (!session) return; // standalone/logged-out — nothing to push to
  const raceLabel = deriveRaceLabel(state.event);
  const payload = buildPayload();
  if (!raceLabel || !payload.entries.length) return; // no event name/date yet, or no entries
  try { await apiPushBibAllocations(session.token, raceLabel, payload); }
  catch { /* server unreachable — next dirty-change retries, same as storage.js's syncToServer() */ }
}

let _timer = null;
function schedulePush() {
  clearTimeout(_timer);
  _timer = setTimeout(pushBibAllocations, 2000);
}

// app.js's connectAndLoad() (and hence this) can run more than once per page load — switching
// datasets re-runs it — so the previous listener must be torn down first, or repeated switches
// pile up duplicate listeners each firing their own push per edit. Same reason
// presence.js's startPresenceWatch() tears down its own previous channel/timer on every call.
let _unlisten = null;

// Call once at startup (see app.js). Reuses storage.js's existing 'racemaster-dirty-change'
// CustomEvent (dispatched on every local table write) rather than importing entries.js/state.js
// into storage.js — that would cycle back through storage.js (entries.js -> state.js ->
// storage.js already), so the DOM event is the same decoupling idiom already used for
// 'racemaster-conflict'.
export function startBibAllocationsSync() {
  if (_unlisten) _unlisten();
  clearTimeout(_timer);
  window.addEventListener('racemaster-dirty-change', schedulePush);
  _unlisten = () => window.removeEventListener('racemaster-dirty-change', schedulePush);
  schedulePush(); // cover the just-loaded dataset too, not only future edits
}