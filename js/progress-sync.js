'use strict';

import { state } from './state.js';
import { getSession, apiPushProgress } from './storage.js';
import { buildProgressRows } from './mobile-files-progress.js';
import { deriveRaceLabel } from './mobile-files-shared.js';

// Race-wide push of the Mobile Files page's own Progress tab contents (now including every
// entry, not just mobile-recorded ones — see buildProgressRows()'s own doc) to
// POST /api/mobile/:owner/:raceLabel/progress. This is what a phone in Bibs or Checkpoint mode
// reads to know which bib is on which course — formerly a separate bib-allocations.json push
// (js/bib-allocations.js, since removed), folded in here once buildProgressRows() started
// carrying every entry regardless of mobile activity, making a separate file/push redundant.
// deriveRaceLabel is imported (not hand-copied) from mobile-files-shared.js — js/mule-ble.js's
// own progress-delivery leg (see its own doc) needs the exact same derivation to know whether a
// connected phone's race matches this dataset's, so it now lives in the one shared leaf module
// both this file and js/views/mobile-files-ble.js can import from with no risk of drifting apart.

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
