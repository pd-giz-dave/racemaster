# ToDo

## Add test suite

- [ ] JS logic
- [ ] view logic?

## Add importing results from other sources

- [ ] CSV file - make SI Results a generic CSV import as long as the file has required columns (in any order)

## Re-jig the mobile files "add to finishers"

- [x] instead of "add to finishers" create a separate tab on the page that shows the 
      consolidated results from the selected mobile files
- [x] the selected files must include one from the finish location and any number of cp locations
- [x] the results tab here must have the following columns:
      BibNumber, Name, Category, Course, FinishTime, CP1Time, ... CPnTime
      where CPnTime reflect whatever was discovered in the selected device files,
      CPnTime is calculated as the elapsed time to that CP since the start,
      the start time-of-day can be found via the timestamp against the time mode start line,
      the CP time-of-day can be found via the timestamp in its line, elapsed time is the difference
- [x] allow for CP mode entries, assume the course is in CP location order, e.g. CP1 -> CP2 -> .. CPn,
      compute elapsed times through CPs as their time-of-day minus time-of-day when the clock started
- [x] add the results tab here as another results source when generating the results page
- [ ] i think i've got muddled here: the idea of the results tab is to collate all the information
      in the selected mobile files in such a manner as they can be incorporated in the race results
      as rendered on the results page, currently there are 2 sources: the finishers list and the SI results
      list, the intention is these mobile files results set are a third source, i like the safety features
      you implemented but the results page has gone too wrt start and clock offsets, that is the
      domain of the adjust finish times function in format results, the mobile results page should just provide the
      required information to allow that, the mobile files contain all the same information as can be
      gleaned from the finishers list with the addition of the CP mode times, they must be in
      the formatted results in a similar way to the SI results
- [ ] change the results tab name to "Progress", the "Compute Results" to "Update Progress" and "Clear Results" to "Clear Progress",
- [ ] the Progress tab fulfills 2 roles: provide information required to produce results and provide feedback about where runners are on the course,
      to that end the ordering should be by bib number and not position (as it no longer knows that)
- [ ] the progress page should also show explicit start actions if a bib has done an early/late start
- [ ] when the results page is shown it should do an auto "Update Progress" when the context is appropriate
- [ ] on the safety page Last CP column, add "Start @..." for explicit early/late starts
      as we know we saw them there, also show the time-of-day not the elapsed time,
      also use time-of-day and not start time on the early starters tab,
      fallback to elapsed time if time-of-day is not available
- [ ] another possible change of tack on results: the only thing the finishers page cannot do is CP splits,
      for the SI case they are shown dynamically in the splits tab of the results, so the conventional results
      can be accommodated on the finishers page, explore the idea of consolidating all results sources into
      the finishers page and doing splits separately, the finishers page would need a 'source' column so that
      multiple sources can mix (e.g. juniors manual via stopwatch, seniors auto via SI), so the sources are (at present):
      manual, SI, bluetooth, would that simplify things?

## Data loss prevention

- [x] mobile files must be auto sync'd to the server whenever the server is reachable,
      specifically this scenario: web-app goes offline, mobile phones are also offline,
      mobile files are being pulled via bluetooth, web-app goes online,
      mobile files fetched or updated via bluetooth must be pushed/sync'd to the server,
      such push/sync must use the same delta mechanism the bluetooth route uses

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

## Race details

- [ ] in event settings add a section that lists CP numbers that must be passed and in what order
- [ ] if the list is empty CP records are optional and purely for safety purposes
- [ ] if the list is populated those CP are compulsory and a runner missing one is disqualified 
      and flagged as such in the results
- [ ] such disqualifications appear in the splits tab on the results page as DSQ
- [ ] on the progress tab of the mobile files page where a record has no CP time recorded for a commpulsory 
      CP add a button in that 'slot' - "Grant" - that when selected considers that runner to have passed that
      CP, this is intended to correct genuine mis-recordings at the CP, such corrections must be preserved
      across "Update progress" actions, the rest of the system must react as if there was a time there
      (ie. they may longer be considered as a DSQ)

