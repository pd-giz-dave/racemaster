'use strict';

import { state } from './state.js';
import { getSession, apiPushProgress } from './storage.js';
import { buildProgressRows } from './mobile-files-progress.js';
import { deriveRaceLabel } from './mobile-files-shared.js';
import { coursesInUse } from './categories.js';

// The last payload actually pushed for each owner+raceLabel, keyed by "owner:raceLabel" (not
// raceLabel alone — an admin can push the same-looking label for two different owners' datasets
// in one session, and those must never be treated as the same cache entry) — this session's own
// record of "what the server should already have", so pushProgress() below can diff a freshly
// built payload against it and send only what changed instead of everything, every time (see
// TODO.md's delta-payload correction — BT and internet traffic must both stay minimal, since
// field connectivity is unreliable and mobile data is metered). Deliberately in-memory, not
// localStorage: a page reload has nothing cached, so its first push naturally sends everything,
// self-healing any drift between what this browser believes the server has and what's actually
// there (e.g. if the server's copy was reset by something else entirely) — persisting this
// across reloads would trade that self-healing away for no real benefit, since the first push of
// a fresh session is cheap regardless.
const lastPushedByRaceLabel = new Map();

function pushCacheKey(owner, raceLabel) { return `${owner}:${raceLabel}`; }

// Test-only: clears the in-memory push cache so each test starts from "nothing pushed yet",
// same as a fresh page load — needed because, unlike this module's other state (_timer/
// _unlisten), the cache's actual *content* changes what a subsequent push sends, so leaving it
// to leak between test cases would make later tests silently depend on earlier ones' state.
export function resetProgressPushCacheForTests() {
  lastPushedByRaceLabel.clear();
}

// True if two entries (same bibNumber, by construction — see diffEntries below) differ in any
// field the server actually stores — cpTimes is a plain object, so a shallow compare isn't
// enough for it specifically.
function entriesDiffer(a, b) {
  if (!a || !b) return true;
  if (a.name !== b.name || a.category !== b.category || a.course !== b.course ||
      a.startTime !== b.startTime || a.finishTime !== b.finishTime) return true;
  const aCp = a.cpTimes || {};
  const bCp = b.cpTimes || {};
  const aKeys = Object.keys(aCp);
  const bKeys = Object.keys(bCp);
  if (aKeys.length !== bKeys.length) return true;
  return aKeys.some(k => aCp[k] !== bCp[k]);
}

// Diffs a freshly built entries array against the last snapshot actually pushed for this
// raceLabel — returns {changed, removed}: `changed` is every entry that's new or differs from
// what was last sent (by bibNumber), `removed` is every bibNumber that was in the last snapshot
// but isn't in the fresh array at all (e.g. an Entries deletion) — the one thing a pure upsert on
// the server side can't express (see server/mobile.js's mergeProgress own doc).
function diffEntries(owner, raceLabel, freshEntries) {
  const previous = lastPushedByRaceLabel.get(pushCacheKey(owner, raceLabel));
  if (!previous) return { changed: freshEntries, removed: [] };
  const changed = freshEntries.filter(e => entriesDiffer(e, previous.get(e.bibNumber)));
  const freshBibs = new Set(freshEntries.map(e => e.bibNumber));
  const removed = [...previous.keys()].filter(bib => !freshBibs.has(bib));
  return { changed, removed };
}

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
//
// `inUse` (coursesInUse() in categories.js — Event Settings alone, never state.entries) is passed
// in rather than recomputed per course: when it's just [Seniors] (no junior age limit configured
// at all), EVERY row is swept into that one payload regardless of its own `course` field —
// "all entrants will be running the same course" — rather than filtering by `r.course === course`
// as usual. That filter alone isn't enough here: an entry's own `course` is only ever recomputed
// when its category changes (see entries.js), so a bib assigned 'Juniors' while a junior limit
// used to be configured stays tagged that way even after the race director removes it — without
// this sweep such a bib would silently vanish from every progress.json rather than landing in the
// one course that's actually left.
function buildPayloadForCourse(course, inUse) {
  return {
    raceName: state.event.name,
    raceDate: state.event.date,
    // `invalid` and `conflict` (buildProgressRows()'s own doc in mobile-files-progress.js) are
    // Progress-tab/Safety-Check display metadata, dropped here rather than sent on: a phone's own
    // bib-allocation logic has no use for either, and neither is part of the wire format
    // racemaster-mobile already expects.
    entries: buildProgressRows()
      .filter(r => inUse.length === 1 || r.course === course)
      .map(({ invalid, conflict, ...entry }) => entry),
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
  const inUse = coursesInUse();
  for (const course of inUse) {
    const raceLabel = deriveRaceLabel(state.event, course);
    if (!raceLabel) continue; // no event name/date yet
    const fresh = buildPayloadForCourse(course, inUse);
    const { changed, removed } = diffEntries(owner, raceLabel, fresh.entries);
    // Nothing to send: either nobody's ever been on this course (fresh and the cache are both
    // empty), or nothing's changed since the last push. Deliberately NOT forced through even on a
    // course's first push of the session: server/mobile.js's mergeProgress() itself now refuses
    // to create a progress.json from an empty delta with nothing already on disk (so a stray
    // "Clear previous event" or an idle empty dataset never spawns one) — the one thing that DOES
    // create a file from nothing is Activate Race (touchProgress()), a deliberate action, not this
    // background auto-push. A course that HAD entries and now has none must still fall through
    // and push, so `removed` actually reaches the server — see diffEntries' own doc.
    if (!changed.length && !removed.length) continue;
    const payload = { raceName: fresh.raceName, raceDate: fresh.raceDate, entries: changed, removed };
    try {
      await apiPushProgress(session.token, owner, raceLabel, payload);
      // Only the freshly-pushed snapshot advances on success — a failed push (server
      // unreachable) must leave lastPushedByRaceLabel exactly as it was, so the same diff
      // (not an empty one) is retried on the next dirty-change instead of silently giving up
      // on entries the server never actually received.
      lastPushedByRaceLabel.set(pushCacheKey(owner, raceLabel), new Map(fresh.entries.map(e => [e.bibNumber, e])));
    } catch { /* server unreachable — next dirty-change retries, same as storage.js's syncToServer() */ }
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
