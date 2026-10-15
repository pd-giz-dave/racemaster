# ToDo

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
all passing); manually exercised in a browser against a scratch dataset —
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

## More testing tweaks required

- [x] need instructions somewhere discoverable that describes how to get the browser into kiosk mode for auto printing
- [x] print start slip when editing an entry should read update and print start slip and do that
- [x] drop the late notification on the start slip, its not useful
- [x] add a column on the entries list for the predicted time
- [x] when the race is a handicap, an entry without a predicted time should still show the update and print start slip and do that
- [x] allow usual convention on entering target handicap time (like male/female records) - h m s or m s
- [x] all dirty forms (entries, helpers, et al) should be reset when a new race is setup and clear previous event is checked
- [x] echo target time and DSQ threshold on hone page when in handicap mode, just under the race mode line
- [x] when in handicap mode do not show the top n average, nor the %ldrs and behind columns in the results

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

## Add test suite

- [x] JS logic
- [x] server logic
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

## Race details to mimic SI wrt course CPs?

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

## Re-test BT stuff wrt auto progress update

- [ ] make sure BT pulls of progress behave same as a server pull (update server, propagate to phones)

## Using same clock for both juniors and seniors

In this context the phones see bibs for both senior and junior courses.
We need a way to do this and still create junior results separately.
Use an event setting of 'shared stopwatch' for juniors timing.
When set the race id becomes racename-mixed-date and the progress record contains all bibs.

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

## Re-write the help

Claude's version is too verbose.
Needs re-structuring so people will actually read it and understand it.

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
