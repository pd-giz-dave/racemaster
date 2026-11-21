# Done

## Handicap race mode

Each runner predicts their own finish time; starts are staggered (based on
predicted time vs a common elapsed target) so that, if predictions were
perfect, everyone would finish together. Winner = first across the line.
Runners are DSQ'd if actual time deviates from prediction by more than a
configurable %. Opt-in via a single `isHandicap` event flag — must not
affect normal races. Full plan: `/home/dave/.claude/plans/i-would-like-to-swirling-castle.md`.

- [x] `js/schema.js`: `createEntry.predictedTime`; `createEvent.isHandicap`,
      `handicapTargetTime` (elapsed), `handicapDsqThreshold` (%)
- [x] Event settings UI (`js/views/event.js`, `index.html`): Handicap race
      checkbox + target time + DSQ threshold fields, shown/hidden on toggle
- [x] Digital entry form (`index.html`, `js/views/entries.js`): predicted-time
      input wired into fillFormForEdit/resetEntryForm/submitEntryForm/prepareEntry
- [x] Printed paper entry form (`js/forms/entry-form.js`): blank Predicted
      Time box appended to the Full Name row, gated on `isHandicap`, for both
      blank and pre-filled (Pre-Entries) forms
- [x] Start slip (new `js/forms/handicap-start-slip.js` +
      `handicap-start-slip.css`): per-entry elapsed-offset + clock-time
      calc, 80mm-thermal printable (reuse `prize-list.js`'s narrow/`@page`
      pattern), "Print Start Slip" button on entry add AND edit
- [x] `js/results.js`: handicap sort key = raw crossing time (f.time /
      getSIFinishTime, not adjustedFinishTime); deviationPct + dsq fields;
      buildPrizes() excludes dsq
- [x] Results display (`js/forms/results-html.js`, `js/strings.js`):
      conditional predicted/deviation/DSQ columns, kept in sync between
      in-app table and published-page `seniorsSection()`
- [x] Bump version (`index.html` header button), add `whats-new` entry, update
      relevant per-view help text in `js/strings.js`

Implemented and verified end-to-end (v0.0.24-alpha): unit tests added in
test/schema.test.js, test/entries.test.js, test/results.test.js (763 total,
all passing); manually exercised in a browser against a scratch dataset -
registered entries with predicted times, printed paper form + entries table,
recorded staggered starts/finishes via Finishers, confirmed Results & Prize
List places by crossing order with DSQ correctly flagged and excluded from
prizes, and confirmed toggling the event flag off restores normal behaviour.
Found and fixed one bug along the way: `.form-grid`'s CSS `display: grid`
was overriding the `hidden` attribute (browsers' own `[hidden]` UA rule loses
to an author stylesheet of equal specificity) — fixed via `.form-grid:not([hidden])`.

### Tweaks required due to testing

- [x] pairs and handicap are mutually exclusive, so change the event settings form
      such that there is a race mode card with 3 options: solo, pairs and handicap
- [x] use a named constant not 86400 in handicap-start-slip.js as that is more readable
- [x] make the predicted time field on the entry form not dependent on the race mode
      (otherwise I'd need to hold stock of 2 types of entry forms, the field can be ignored
      when not relevant), also the gap is the wrong side of the prompt, it should be
      gap --> prompt --> underline, its currently prompt --> gap --> underline, also
      add a dim grey hint over the underline of "hh:mm:ss" as to the expected format
- [x] in handicap-start-slip.js drop the esc(s) function and put the || '' bit in escHtml
      and use that instead
- [x] the start slip printing needs to be fully automatic from the entry form, if a
      preview pops up that must be interacted with, it's a non-starter as it will delay
      the registration process too much, if it cannot be made fully automatic due to
      browser limitations, then an alternative scheme must be proposed
- [x] drop the handicapTargetTime and associated offset time on the start slip, it adds
      no value and is confusing

Implemented (v0.0.25-alpha): Race Mode card replaces the separate Has-pairs/Handicap
checkboxes with one mutually-exclusive solo/pairs/handicap radio group (schema fields
unchanged — `hasPairs`/`isHandicap` are still independent booleans, just derived from the
one radio on save). The printed entry form's Predicted Time box is now unconditional (any
race mode), with the gap moved before its label and a dim-grey "hh:mm:ss" hint. `escHtml`
(js/utils.js) now folds in its own `|| ''` guard; handicap-start-slip.js's local `esc()`
wrapper is gone. Registering a handicap entry now prints its start slip immediately via a
hidden iframe (no popup window, no button click) — the "Print Start Slip" button remains
for manual reprints after an edit. A fully silent (no OS print dialog) race day still needs
the browser launched with a silent-printing flag (e.g. Chrome's `--kiosk-printing`) — that's
a one-time race-day browser/OS setup note, not something the app's code can control. The
start slip no longer shows the target-time-derived "Offset" row — just Bib, Name, Predicted,
and the big START TIME. `npm test` — 763/763 passing throughout; manually verified in a
browser against a scratch dataset (Race Mode toggle, predicted-time field + hint on a
non-handicap form, automatic start-slip print on Register, reprint button on Edit).

### More testing tweaks required

- [x] need instructions somewhere discoverable that describes how to get the browser into kiosk mode for auto printing
- [x] print start slip when editing an entry should read update and print start slip and do that
- [x] drop the late notification on the start slip, its not useful
- [x] add a column on the entries list for the predicted time
- [x] when the race is a handicap, an entry without a predicted time should still show the update and print start slip and do that
- [x] allow usual convention on entering target handicap time (like male/female records) - h m s or m s
- [x] all dirty forms (entries, helpers, et al) should be reset when a new race is setup and clear previous event is checked
- [x] echo target time and DSQ threshold on hone page when in handicap mode, just under the race mode line
- [x] when in handicap mode do not show the top n average, nor the %ldrs and behind columns in the results

### Yet more test tweaks

- [x] in a handicap race replace the time column in the prize list with their % deviation from predicted
- [x] in a handicap race, include a trailing section in the prize list that shows the DSQ's

Implemented (v0.0.26-alpha): the actual `--kiosk-printing` launch commands for Windows/macOS/Linux
(including how to still get the app-like window via `--app=`, since the installed PWA shortcut
itself can't take extra flags) now live on a new dedicated static page, "Auto Printing", under a
new "Help" nav section below Data — `PAGES['auto-printing']` in `js/strings.js`, rendered into a
new `<div class="view" id="view-auto-printing">` by the existing `wireStaticPages()` mechanism
(`js/help.js`), no dispatch code needed. The Entries page help panel now just links to it
(`<a data-view="auto-printing">`); the real content was moved there, not duplicated, and expanded
into a proper guided walkthrough: a critical caveat (the silent-printing flag is silently ignored
if the browser is already running at all — a separate `--user-data-dir` profile forces a genuinely
new instance and remembers its own default printer between launches), step-by-step one-time setup
instructions, race-day launch commands per OS for Chrome-family browsers (also noting Brave/
Edge/Chromium share the same flags), a Firefox section (different flags, no `--app` equivalent,
silent printing via `about:config`'s `print.always_print_silent` instead of a flag), and a note
that Safari isn't supported at all. Predicted Time is now a
required field for a handicap race, and is also sanity-checked against the event's Target Time —
rejected if it's faster than half, or slower than three times, the target, catching a likely
mistyped time (`prepareEntry()` in `js/entries.js`, shared by Register, Insert and Update, e.g.
"Predicted Time is required for a Handicap Race" / "Predicted Time must be between 00:12:30 and
01:15:00 for a target of 00:25:00") — so the submit button can unconditionally relabel to
"Register and Print Start Slip" (or "Insert and Print Start Slip" when inserting a missed entry)
as a reliable visual reminder to the entry
clerk that it's about to happen, never a maybe. Registering/inserting — by clicking the button or
just pressing Enter — always registers and immediately prints the slip. Editing an existing entry
shows two buttons: a plain "Update" (saves only) and "Update and Re-print Start Slip" (saves
through the normal Update path, then prints the freshly saved entry, so a just-typed predicted
time is never printed stale) — both always present for a handicap race (an older entry predating
the race being switched to Handicap mode may still lack one, hence Update enforcing the same
requirement going forward); either leaves the form reset and ready for the next entry exactly
like a plain Update. The start slip no longer shows a "check this entry" late warning
(`computeHandicapStart()` now just returns the start time
directly). The Entries list has an always-present Predicted column (blank outside handicap
races). Target Time's label/placeholder now read HH:MM:SS to match the male/female record
fields — it already silently accepted both `M:S` and `H:M:S` via the same duration-mode
`normaliseTime()`, so this was a discoverability fix only. "Clear previous event" now also
resets any dirty, unsubmitted Entries/Helpers/Finishers forms. The Home page echoes Target Time
and DSQ Threshold under Race Mode for a handicap event. The Results page (in-app and published)
no longer shows the "Top N average" note, nor the %Ldrs/Behind columns, for a handicap race — they
rank by raw elapsed time, which is meaningless once starts are staggered; `TABLES['results-senior']`
split into a standard-only `results-senior-standard` (%Ldrs/Behind) alongside the existing
handicap-only `results-senior-handicap` (Predicted/Dev%/DSQ), shown instead, not alongside.
`npm test` — 772/772 passing throughout; manually verified via a standalone script exercising
`buildSeniorsBodyHTML()` in both modes.

Implemented (v0.0.28-alpha): for a handicap race, the Prize List (both the in-app Prizes tab and
the printed/published page) now shows each row's **Dev %** in its 4th column instead of a finish
time (`buildPrizes()`'s `makeRow()` now carries `deviationPct` through onto every prize row;
`js/forms/prize-list.js`'s `buildPrizeRowsHTML`/`buildPrizeListHTML` and a new
`TABLES['prizes-handicap']` in `js/strings.js` swap the column/header when `isHandicap`). A new
`buildDsqPrizeRows()` in `js/results.js` collects every DSQ'd finisher (juniors before seniors,
matching the main prize list's own section order, then by crossing position) into a trailing
**Disqualified** section — returned as a new, separate `dsqPrizeRows` key from `formatResults()`
so `buildPrizes()`'s existing "DSQ'd runners don't win prizes" behaviour (and the test asserting
it) is untouched; both Prize List surfaces append it after the normal prize sections and gate
their "nothing to show" checks on the combined length. `npm test` — 775/775 passing throughout
(3 new tests in `test/results.test.js` covering `deviationPct` on ordinary prize rows, an empty
`dsqPrizeRows` when nobody's disqualified, and junior-before-senior DSQ ordering).

### Start slip print overflow (found after real-world kiosk-printing use)

- [x] the start slip layout overflows the right paper edge and gets truncated (a genuine ~3mm
      forced margin on the physical print, not a browser-rendering/overflow issue) — fix it the
      way the prize list print already gets right

Two attempts so far, both real-world-tested by the user and insufficient:

1. CSS only — `.hss-row`'s flex layout let a long value force the row wider than the label,
   since flex items default to `min-width: auto`. Fixed to mirror `prize-list.css`'s own
   narrow-print cells (label `flex-shrink: 0`, value `min-width: 0` +
   `overflow:hidden;white-space:nowrap;text-overflow:ellipsis`) — this is still in place as a
   content-overflow safety net (`js/forms/handicap-start-slip.css`), but did NOT fix the real
   margin problem: it's a forced print-time margin, not a content-overflow/rendering issue.
2. Switched the print mechanism from a hidden `<iframe>` + `iframe.contentWindow.print()` to
   `preview.js`'s `openPopup()` (a real popup window + `win.print()`), on the theory that Chrome's
   print pipeline doesn't honour `@page{margin:0}` the same way for an iframe under
   `--kiosk-printing`, since the prize list (which uses `openPopup()`) never showed the problem.
   **Reverted** — real-world tested and made things worse: the margin bug was NOT fixed, and it
   introduced a regression, a popup window left on screen needing a manual close (`win.print()`
   via a real window does not auto-close the window afterwards) — unacceptable during live,
   back-to-back registration. `js/forms/handicap-start-slip.js` is back to the hidden-iframe
   approach.

A byte-for-byte comparison against `prize-list.css` found the actual difference: the prize list's
narrow table sets no `text-align` on its cells (browser default: left), so a typical value's text
never reaches anywhere near the physical right edge even though the table box itself spans the
full content width — any clipping there is invisible blank space. The start slip's `.hss-val {
text-align: right; }` does the opposite on purpose (values line up on the right) — every value,
especially the big START TIME figure, sits with its rightmost character exactly at the edge of
the padded content box. That box's padding (`3mm 3mm 3mm 1mm`) was sized to exactly match the
user's own measured ~3mm unprintable margin, i.e. zero buffer — any overshoot at all would clip.

3. **Fixed (v0.0.27-alpha), confirmed on the real printer.** `js/forms/handicap-start-slip.js`
   adds a named `RIGHT_EDGE_MM = 6` (was a bare `3mm`) used for `.hss-slip`'s right padding only —
   doubles the margin so right-aligned text clears the known ~3mm unprintable zone with an actual
   buffer, rather than landing exactly on its boundary. Left/top/bottom padding unchanged. If a
   future printer needs more clearance, raise `RIGHT_EDGE_MM` rather than re-trying attempts 1 or 2
   above (both real-world-tested and ruled out).

## Add test suite

- [x] JS logic
- [x] server logic

## Re-test BT stuff wrt auto progress update

- [x] make sure BT pulls of progress behave same as a server pull (update server, propagate to phones)

## Mobile-app changes to reflect through to Mobile Files processing

- [x] allow for device files only having a modestart setup record when updating progress,
      this is required so the web-app can adopt the phones before they have recorded anything
- [x] allow for the location changing in a device file (it means the marshall has moved),
- [x] do not count lines with a blank or n/a bib number as a bib line
- [x] do not count lines with a blank or n/a split time as a split line
- [x] if the modestart record is 'bibs' (ie. bib number is n/a) and there are no bib lines show a bib count of 0
- [x] if the modestart record is 'time' (ie. split time is n/a) and there are no splits show a split count of 0
- [x] when a race has been reset in a device file, the latest modestart record is still valid wrt the location and mode
- [x] drop the 'Setup' record from the device file, its no longer created, there will always be a modestart record

## Random tweaks

- [x] the segment view in the web-app has columns for both time and bibs, but nowadays there is
  only ever 1 mode per segment, so rationalise the view for this, eg:
  Location: <...> Mode: <...>
  Split# Action Bib/Split When Note
  ...
- [x] progress view on the mobile files page is showing elapsed times for start and finish, they should be time-of-day
- [x] when a mobile file is completely reset (all the way back to the beginning) device view shows a blank location
      but has retained the mode, that should be blank too, also the device list should show unknown in the where
      column and both bibs and time columns should be blank as its mode is also now unknown

## Noticed issues

- [x] the mobile/owner/race folder created should follow the same convention the mobile app uses when creating its
      initial 'arbitrary' race label, ie. mobile/owner/race-<yy-mm-dd>,
      the _adoptions.meta.json file should use that race label
- [x] the date in the race label used above should be the race date as set in event settings, not todays date
- [x] rename _adoptions.meta.json to adoptions.json and add it to the exclusion list alongside progress.json
- [x] remove the bib_allocations.json exclusion, it is no longer generated

## Tweaks noted when doing a handicap race

- [x] The hh:mm:ss prompt hint on the entry forms is far too dark, it is almost the same as normal text
- [x] Some print formatting, e.g. type size on the handicap start ticket, gets lost when there is no internet connection
- [x] Add a start time column to the entries list after the predicted time column, that reflects the start time on their start ticket
- [x] When entering a predicted time in the entry form if a single number is entered assume it is minutes and allow for >60, adjust the hint text to mm or mm:ss

## Add a new timing method

Racemaster-mobile is being updated to use bluetooth beacons to record runners at CPs and the finish.
This will completely automate CP tracking, finishers and race results; potentially replacing the SI dibber system.
To that end:

- [x] The racemaster-mobile app will provide a facility to read the battery status and power off the beacons as part
      of its post race housekeeping. This will produce a report of a list of beacons so processed that records the
      beacon number and its battery staus and the date/time the beacon was powered off
  - [x] This app must be able to read that report, either from the server, or via the bluetooth link, or both
    - [x] Add a button on the Mobile Files page to initiate that read from the BT connected phone if there is one
    - [x] The mobile app will put the file on the server in the mobile/owner/race folder as beacons.json in a
          similar manner to the device.json files when it has internet access - superseded by putting it in the
          device file
  - [x] The report must be processed such that:
    - [x] this app can verify every beacon issued has been returned and highlight missing ones
    - [x] update the battery level, last used date, and total hours in the beacons data page
    - [x] total hours to be an accumulation of each race usage which is to be calculated as the time between 2 hours 
          before the race started and the power-off time reported from the mobile app
    - [x] battery level will be a % (0-100), a battery below a certain threshold must be highlighted
  - [x] The results of that processing should be summarised in a "Beacons" tab on the Mobile Files page and it must be
        persisted as part of the dataset
- [x] Add a new timing method - Beacons
- [x] Add a new data page - Beacons - this is to be persisted in the same manner as the Dibbers page
- [x] Add a field to the progress.json - beaconNum - populated from the entries Beacon field (see below)
- [x] When timing is 'Beacon' the Dibber field in the entries form becomes "Beacon" - no becomes "Fob" always
- [x] The beacon number is allocated to entries in an analogous manner to dibber numbers:
  - [x] The Beacon data page defines the beacons available and their status
    - [x] The columns on that page will be: Number, Owner, Date Acquired, Total Hours, Battery Level, Last Used, Lost, Notes, Actions
    - [x] Actions will be Edit, Del from here
    - [x] Page header will be as Dibbers - (?), Beacons, count
    - [x] Page actions will be as Dibbers - Add, import, export, merge, clear
- [x] the CP and finish records received from the mobile app, or read from the server, is unaffected
- [x] the beacons tab should list issued beacons even before a report is read (similar to the progress tab), the
      initial status should show as 'issued', the other columns should be pre-filled from the beacons page pending
      a real update from beacon status report
- [x] beacons.json's powerOffBatch now carries closeCount (how many times racemaster-mobile
      recorded that beacon being closed this race, e.g. re-presented after an early close) through
      end to end — mobile app wire format, the server route's field whitelist, and the Beacons tab,
      which shows "Returned (closed ×N)" for N>1, mirroring the phone's own "closed ×N" wording
- [x] racemaster-mobile: a beacon-close report push that fails (offline, logged out, server error)
      no longer disappears silently — unpushed closes are tracked (BeaconCloseEntity.pushedAt) and
      retried automatically every 15s while any are pending, with a "N not yet synced" indicator
      on the Close Beacons screen
- [x] racemaster-mobile's newer Close/Count device recording modes (a dedicated phone presenting
      each beacon in turn — Close reads battery then powers off, Count only logs it seen) are now
      consumed: a 'Close'/'CountSeen' row (and its own ModeStart/'Close'|'Count' marker) is
      classified into its own segment rather than silently falling into Bibs and getting dropped;
      Count's forced "Start" location no longer gets swept into the Bibs-mode early-starters
      bucket. Update Progress now also extracts beacon close/count data (matched by beacon
      number, not bib, since bibNumber may be null) into state.mobileBeaconOps, stamped onto the
      Progress tab's own rows as beaconClosedAt/beaconBatteryPercent/beaconCountedAt and sent on
      to the phone in progress.json

## Bugs/Tweaks

- [x] Beacons tab's own "Read Beacons Report" button/action removed — redundant now that Update
      Progress applies this race's own Close-mode data straight from the selected device files:
      js/mobile-files-progress.js's applyComputedResults() calls js/mobile-beacons.js's new
      computeBeaconCatalogueUpdates/applyBeaconCatalogueUpdates directly (closeByBeacon's own
      closedAt/batteryPercent, idempotent per beacon per race the same way the old report-driven
      version was). The Beacons tab (js/views/mobile-files-beacons.js) just reads state.
      beaconReports/state.beacons now, with nothing left to trigger by hand. The old bespoke
      beacons.json endpoint/apiReadBeaconsReport/pullBeaconsReportFromConnectedPhone are left in
      place server-side, unused — a separate cleanup decision.
- [x] beacons page not updating with progress results - total hours — fixed by the above: battery
      level, last-used date and accumulated total hours on the Beacons catalogue (state.beacons)
      are now written directly by Update Progress, not left waiting on a report that was never
      being read any more.
- [x] viewing device file was getting muddled wrt close and count entries — the Devices tab's own
      "View" action is now split by location AND mode: js/mobile-files-devices.js's new
      deviceViewOptions() returns one option per distinct (location, mode) combination actually
      present (e.g. a device sharing one "Start" location across Bibs/Close/Count sessions with
      no Reset between them shows 3 separate options: "Bibs (empty)", "Close", "Count" — location
      only joins the label once it genuinely varies across the options), and
      js/views/mobile-files.js's viewDeviceRow() prompts with these whenever there's more than
      one, always handing showDeviceModal() lines already narrowed to exactly one combination.
      These are options on the view selector, not sub-sections within one modal — the modal itself
      (js/views/mobile-files-devices.js) stays a single plain table, same as before any of this
      Close/Count-mode work existed.
- [x] Raw device view now collapses a run of 2+ consecutive Ping heartbeat rows into one summary
      row — "<from line> - <to line>" in the line number column, "<from time> - <to time>" in the
      timestamp column — via js/mobile-files-devices.js's new collapsePingRuns(), used by
      js/views/mobile-files-devices.js's showRawModal(). The per-mode views
      (showDeviceModal()) now lead every row with its own line number too, so a row shown there
      can be manually matched back to its own line in the Raw view for diagnostic purposes.
- [x] Progress tab on the mobile files page should have separate columns for "Counted" and "Closed",
      counted before the start column, closed after the finish column, use these instead of annotating
      the fob column — **done**: js/strings.js's 'mobile-progress' table gained 'counted' (before
      'start') and 'closed' (after 'finishTime') columns; js/views/mobile-files-progress.js's
      renderMobileProgressTable() now renders Fob as the bare number again, Counted from
      row.beaconCountedAt's own device time-of-day, and Closed from row.beaconClosedAt (+ battery
      %), falling back to the older fobReturned 'missing'/'returned' text (still red while missing)
      only when there's no beaconClosedAt of its own.
- [x] beacons tab add an "As At" column between status and battery that reflects the time of last
      status change — **done**: js/strings.js's 'mobile-beacons' table gained an 'asAt' column
      between 'status' and 'batteryLevel'; js/views/mobile-files-beacons.js's buildBeaconRows() now
      reads each beacon's own closedAt straight off computeBeaconCatalogueUpdates()'s own
      appliedCloseAt map (mobile-beacons.js) — the one per-beacon status-change timestamp this
      report actually carries — and renders it via formatStoredTimestamp(), blank for a beacon still
      missing or merely issued (neither has had a status change to time yet).
- [x] progress tab not showing Counted when the device file has CountSeen records — **done**:
      js/mobile-files-progress.js's validateAndCompute() checked closeSegment/countSegment with an
      if/continue each, so a device repurposed mid-race (Count mode for the pre-start headcount,
      then relocated into Close mode afterwards, same physical phone/file) had both segments
      non-empty at once, but the Close check ran first and `continue`d before the Count check ever
      ran — silently dropping that device's countByBeacon entirely. Now checks both independently,
      only `continue`ing once both have had their chance.
- [x] on the Progress tab, when there is no count record for a beacon-timed entry the Counted
      column should highlight "not seen" — **done**: js/mobile-files-progress.js's
      buildProgressRows() now sets a new `beaconCountNotSeen` flag whenever a beacon-timed entry's
      own beacon has no countedAt in state.mobileBeaconOps, but ONLY once Count mode has genuinely
      run this race at all (some other beacon in mobileBeaconOps does have a countedAt) — a race
      that never used Count mode doesn't flag every beacon-timed entry for a check that was simply
      never attempted. js/views/mobile-files-progress.js's Counted column renders this the same
      color:var(--danger) way Closed/the Beacons/Dibbers pages already flag "needs attention".
      beaconCountNotSeen is display-only — js/progress-sync.js's buildPayloadForCourse() strips it
      before pushing to the phone, same footing as fobReturned/fobNumber/invalid/conflict.
- [x] need a way to manually return a beacon via an action on the beacons tab (to allow for the case
      where a runner went home with it and returned it some time later after the race was all over)
      that button should open a form to allow the last used date/time (default to now) and battery
      level to be entered, it should auto calculate the hours and update the total on the beacons
      page just as if report had been received from a phone — **done**: Mobile Files Beacons tab
      gained a Return button per row (js/views/mobile-files-beacons.js), opening an inline panel
      (date/time defaulting to now, battery defaulting to the beacon's last known reading) that
      calls js/mobile-beacons.js's new `applyManualBeaconReturn()` — the same battery/lastUsed/
      totalHours math a real Close report gets (computeBeaconCatalogueUpdates's own raceStartMs()-
      based hoursDelta), without touching state.beaconReports (a whole-race snapshot keyed by every
      other beacon too — see that function's own doc for why overwriting it here would be wrong).
- [x] beacons tap should show a status of "On-course" if its been counted, and as at reflects when
      — **done**: folded into the status/asAt work below — the tab now reads status/asAt straight
      off the catalogue (state.beacons[].status/asAt) rather than re-deriving its own, so this and
      the next item share one source of truth.
- [x] beacons page should have status and as at columns, status should be 'issued' when it has been
      allocated, 'on-course' when it has been counted and 'returned' when it has been closed, those
      states can cross race boundaries, and should be editable via the edit action — **done**:
      schema.js's createBeacon() gained `status`/`asAt`. js/mobile-beacons.js's new
      `computeBeaconStatusUpdates()`/`applyBeaconStatusUpdates()` derive them from the same
      closeByBeacon/countByBeacon maps Update Progress already extracts (priority returned >
      on-course > issued), called from js/mobile-files-progress.js's applyComputedResults() every
      run. A beacon untouched by this race's own live data (not issued, not counted, not closed)
      is left out of the update entirely, which is what lets status/asAt cross race boundaries
      rather than resetting every time a new race starts. Both the standalone Beacons page
      (js/views/beacons.js) and the Mobile Files Beacons tab now render these straight off the
      catalogue. The Beacons page's own Edit form gained a Status dropdown — changing it by hand
      stamps asAt to now, for a status change noticed some other way than Update Progress.
- [x] when a new race is setup (i.e. clear previous event is checked) using beacons timing the operator
      should be warned if any beacons are still in an 'issued' or 'on-course' state — **done**:
      js/views/event.js's saveEventForm() adds a line to the existing clear-previous confirmation
      dialog listing any beacon still marked issued/on-course. Checked against the catalogue's own
      persisted status, not issuedBeaconNumbers() — that needs state.entries, which this same
      clear is about to wipe, so order no longer matters.
- [x] on the beacons page when a beacon is edited the total hours field should only show 1 dp —
      **done**: js/views/beacons.js's fillBeaconFormForEdit() now formats totalHours with
      `.toFixed(1)` when populating the Edit form (it already accumulates as a float via
      +=hoursDelta, routinely landing on screen as something like 3.7333333333333334 without this).
- [x] progress tab is not being updated by checkpoint passes — **done**: two compounding bugs in
      a device repurposed mid-race (same physical phone/file, e.g. Count mode for the pre-start
      headcount, then relocated to run CP1 afterwards). (1) js/mobile-files-devices.js's
      `rowFamily()` had no case for `CountComplete`/`CountStopped` (racemaster-mobile's own
      Count-only markers, both null bibNumber/splitTime like `CountSeen`/`CloseReopened` before
      them), so they fell into the Bibs family's own default and stranded a phantom "Pen" (or
      whatever the old Count location was) segment alongside the device's real CP segment —
      `resolveLocationKey('Pen')` returning null then made `validateAndCompute()` reject the
      ENTIRE selected batch with "location 'Pen' isn't recognised", silently blocking every
      other selected device's progress too, not just this one's. (2) even with that fixed,
      `validateAndCompute()`'s own per-device loop still unconditionally `continue`d past the
      location-bucketing step whenever the device's (per-family, not per-device) countSegment/
      closeSegment was non-empty at all — true forever once a device has ANY never-explicitly-
      Reset Count/Close visit in its history, even long after it's moved on to genuine CP/Bibs
      work — so the device's real CP passes were silently dropped with no error at all. Now only
      skips the location loop when there's truly no Bibs/Time segment to bucket (a dedicated,
      location-less Close/Count phone); a device with both now gets its beacon data recorded
      AND its CP/Finish/Start segments bucketed normally.
- [x] when auto update progress is checked, show an indication that its happening, e.g. as at and
      a count — **done**: index.html gained a `#mf-auto-progress-status` span next to the
      checkbox; js/views/mobile-files-progress.js's new `updateAutoProgressStatus()` stamps it
      "As at HH:MM:SS — N record(s)" from `maybeAutoUpdateProgress()` every time that actually
      runs (gated on the checkbox being enabled, not on whether anything was new this tick), so an
      operator watching it can tell the background poll is genuinely still alive even on a quiet
      check. `syncAutoProgressCheckbox()` hides it again the moment the checkbox isn't ticked
      (unticked, or locked back down after a failed run), same as every other state that
      control already reflects.
- [x] when a page opens it should be fully scrolled left - e.g. Beacons page partially obscures the 
      add beacon form due to the actions column being off screen

# To Do

## Add test suite

- [ ] view logic?

## Add importing results from other sources?

- [ ] CSV file - make SI Results a generic CSV import as long as the file has required columns (in any order)

## Security improvement

- [ ] introduce a 2-tier log-in system: web-app and mobile,
- [ ] a user created in the web-app also creates a mobile user with
      that name but with a "-mobile" suffix
- [ ] the mobile user must have a password but it must be different to its web-app user
- [ ] when a web-app user logs in and its corresponding mobile user does not exist the
      user must be prompted to supply that password and the mobile user created with that password
- [ ] the mobile users show in the user list in admin mode
- [ ] an admin may delete any mobile user, including self (just triggers its re-generation)
- [ ] allow the admin user to create other web-app users and their mobile version and their passwords
- [ ] provide a means for users to change their password and their mobile one too
- [ ] an admin user can change any password
- [ ] the mobile password must be different to the web-app and its constraint must always be applied (a-zA-Z0-9)

## Race details to mimic SI wrt course CPs

- [ ] in event settings add a section that lists CP numbers that must be passed and in what order
- [ ] if the list is empty CP records are optional and purely for safety purposes
- [ ] if the list is populated those CP are compulsory and a runner missing one is disqualified 
      and flagged as such in the results
- [ ] such disqualifications appear in the splits tab on the results page as DSQ
- [ ] on the progress tab of the mobile files page where a record has no CP time recorded for a compulsory 
      CP add a button in that 'slot' - "Grant" - that when selected considers that runner to have passed that
      CP, this is intended to correct genuine mis-recordings at the CP, such corrections must be preserved
      across "Update progress" actions, the rest of the system must react as if there was a time there
      (ie. they may longer be considered as a DSQ), such manual grants should also be revocable
- [ ] also need to mimic the Trigs race time allowance between 2 CP's, and being able to visit a CP more than once

## Using same clock for both juniors and seniors

In this context the phones see bibs for both senior and junior courses.
We need a way to do this and still create junior results separately.
Use an event setting of 'shared stopwatch' for juniors timing.
When set the race id becomes racename-mixed-date and the progress record contains all bibs.

## Re-write the help

Claude's version is too verbose.
Needs re-structuring so people will actually read it and understand it.

## Tweaks noted when doing a handicap race

- [ ] server/service-worker.js should be caching everything, so working offline is identical to working online, 
      check this is so, there is evidence some files are being missed

## Add a new timing method

Racemaster-mobile is being updated to use bluetooth beacons to record runners at CPs and the finish.
This will completely automate CP tracking, finishers and race results; potentially replacing the SI dibber system.
To that end:

- [ ] when no time mode device is selected on the Mobile Files page, appropriate times must be extracted from the
      bibs mode devices instead (when using beacons there will usually be no time mode phone in use)
- [ ] if a beacon is recorded as closed but has no finish scan, interpret that as a DNF
- [ ] need a way to print splits for runners as the beacon is closed to mimic what SI Timing does
