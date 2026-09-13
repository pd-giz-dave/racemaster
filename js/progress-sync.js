'use strict';

import { state } from './state.js';
import { getSession, apiPushProgress } from './storage.js';
import { buildProgressRows } from './mobile-files-progress.js';
import { deriveRaceLabel } from './mobile-files-shared.js';
import { COURSE } from './constants.js';

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
//
// Progress itself has no course of its own — one web-app event/dataset covers Seniors AND
// Juniors at once — but a phone's own race folder does, from the moment a course is chosen at
// Start time (racemaster-mobile's own RaceLabels.kt). Pushing one combined progress.json to a
// single course-less label therefore never actually lands where a phone with a course already
// chosen looks for it — it's a genuinely different race folder as far as the server's concerned.
// Pushed here instead as one course-filtered payload per course, each to that course's own
// raceLabel (deriveRaceLabel(event, course)) — a real fix, not a guess at which single folder to
// use, and it also means a phone only ever receives entries for its own course.
function buildPayloadForCourse(course) {
  return {
    raceName: state.event.name,
    raceDate: state.event.date,
    // `invalid` (buildProgressRows()'s own doc in mobile-files-progress.js — a bib with mobile
    // activity but no matching Entry) is Progress-tab/Safety-Check display metadata, dropped here
    // rather than sent on: a phone's own bib-allocation logic has no use for it, and it's not
    // part of the wire format racemaster-mobile already expects.
    entries: buildProgressRows()
      .filter(r => r.course === course)
      .map(({ invalid, ...entry }) => entry),
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
  for (const course of [COURSE.SENIORS, COURSE.JUNIORS]) {
    const raceLabel = deriveRaceLabel(state.event, course);
    const payload = buildPayloadForCourse(course);
    if (!raceLabel || !payload.entries.length) continue; // no event name/date yet, or nobody on this course
    try { await apiPushProgress(session.token, owner, raceLabel, payload); }
    catch { /* server unreachable — next dirty-change retries, same as storage.js's syncToServer() */ }
  }
}

let _timer = null;
function schedulePush() {
  clearTimeout(_timer);
  _timer = setTimeout(pushProgress, 2000);
}

// Pushes right now instead of waiting out the usual 2s debounce, cancelling any already-pending
// one — for an explicit, one-off action (Clear Progress) where leaving the persisted
// progress.json stale until the debounce happens to fire (or relying on it surviving a tab
// close/navigation in the meantime) isn't good enough: the operator just told the app "this data
// is gone," and the server-side copy other phones/admins read should reflect that immediately,
// not eventually. Same best-effort contract as the debounced path otherwise — a server outage
// here is silently swallowed by pushProgress() itself and simply retried on the next dirty-change
// (or the next explicit call), never surfaced as an error to the caller.
export async function pushProgressNow() {
  clearTimeout(_timer);
  await pushProgress();
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
