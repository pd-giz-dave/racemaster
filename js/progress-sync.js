'use strict';

import { state } from './state.js';
import { getSession, apiPushProgress } from './storage.js';
import { buildProgressRows } from './mobile-files-progress.js';

// Race-wide push of the Mobile Files page's own Progress tab contents (now including every
// entry, not just mobile-recorded ones — see buildProgressRows()'s own doc) to
// POST /api/mobile/:owner/:raceLabel/progress. This is what a phone in Bibs or Checkpoint mode
// reads to know which bib is on which course — formerly a separate bib-allocations.json push
// (js/bib-allocations.js, since removed), folded in here once buildProgressRows() started
// carrying every entry regardless of mobile activity, making a separate file/push redundant.

// Same "<name>-yy-mm-dd" convention a phone's own raceLabel already uses (2-digit year FIRST —
// see server/mobile.js's parseRaceLabelDate and js/mule-ble.js's raceLabelAgeDays, both of which
// parse a label's trailing "-dd-dd-dd" strictly as yy-mm-dd) — state.event.date is stored
// dd/mm/yyyy, so the day and year swap position here. Getting this order wrong doesn't error —
// it just silently misdates the race for every consumer of that shared parsing (stale-race
// filtering on this page's own Devices/All Files tabs, and getMobileRacesForUser()'s own date
// sort).
function sanitiseName(s) {
  return (s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64).toLowerCase();
}
function deriveRaceLabel(event) {
  const [dd, mm, yyyy] = (event.date || '').split('/');
  if (!dd || !mm || !yyyy || !event.name) return '';
  return `${sanitiseName(event.name) || 'race'}-${yyyy.slice(-2)}-${mm}-${dd}`;
}

function buildPayload() {
  return {
    raceName: state.event.name,
    raceDate: state.event.date,
    entries: buildProgressRows(),
  };
}

async function pushProgress() {
  const session = getSession();
  if (!session) return; // standalone/logged-out — nothing to push to
  // The current dataset's own owner, not getUsername() — an admin (or anyone else with write
  // access to someone else's dataset) must land this under *that dataset's* mobile/ folder, or
  // phones syncing this race (which look for progress.json under the race's actual owner) would
  // never find it.
  const [owner] = session.dataset.split('/');
  const raceLabel = deriveRaceLabel(state.event);
  const payload = buildPayload();
  if (!raceLabel || !payload.entries.length) return; // no event name/date yet, or no entries at all
  try { await apiPushProgress(session.token, owner, raceLabel, payload); }
  catch { /* server unreachable — next dirty-change retries, same as storage.js's syncToServer() */ }
}

let _timer = null;
function schedulePush() {
  clearTimeout(_timer);
  _timer = setTimeout(pushProgress, 2000);
}

// connectAndLoad() (app.js) can run more than once per page load — switching datasets re-runs
// it — so the previous listener must be torn down first, or repeated switches pile up duplicate
// listeners each firing their own push per edit.
let _unlisten = null;

// Call once at startup (see app.js). Reuses storage.js's existing 'racemaster-dirty-change'
// CustomEvent (dispatched on every local table write) — including saveEntries() (so a bib/name/
// course/category edit re-pushes, the former Bib Allocations tab's own "kept up to date" promise)
// and saveMobileProgress()/saveMobileCheckpoints() (Update Progress, Clear Progress) — so this
// fires on any edit that touches the Progress tab's own data, with no new event-wiring needed.
export function startProgressSync() {
  if (_unlisten) _unlisten();
  clearTimeout(_timer);
  window.addEventListener('racemaster-dirty-change', schedulePush);
  _unlisten = () => window.removeEventListener('racemaster-dirty-change', schedulePush);
  schedulePush(); // cover the just-loaded dataset too, not only future edits
}
