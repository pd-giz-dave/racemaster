# ToDo

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
