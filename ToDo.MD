# ToDo

- Review all code and remove now not used code (there has been a lot of development).
- Re-factor the code to separate out data structure knowledge - a 'models' dir?
- Make the server console log persistent (with size limiting)
- Add test suite

## Implement the pairs system

- modified entry form, eg. Time Trial

## Add splits option to results when using dibbers

How? 
SI Timing only reports control code numbers, so a naming scheme is required.
SI Timing system provides: NumSplits, [ControlCode, Split] * NumSplits, 
split is  elapsed time from the previous control.

## Add How-To pages

Mimic the spreadsheet versions?
Especially need an overview of what the app is all about.

- contents
- things to-do before the event check-list
- how to prepare for an event in Racemaster
- hints on using SI Timing
- how to register entrants
- how to register helpers
- how to enter/process results
- how to use the stopwatch
- how to setup an event that involves pairs (eg. the Time Trial)

## Add notices printing

The spreadsheet version has a separate pages for all the standard race day notices.
Is that appropriate here, or should it be a separate system?

- Turn round signs
- Junior ages and category and bib colours by year of birth
- A5 folder labels for pre-entries (A-D, et al)
- A3 pre-entry notices (A-D, et al)
- A3 entry-on-the-day notices
- A3 download here notice

## Add a "What's New" page

Show when a new version is available before confirm do the update.
Need a way of re-showing it - make app header "Racemaster (version)" clickable.

## Add a "What's Changed" page

Show what has changed in the latest version.