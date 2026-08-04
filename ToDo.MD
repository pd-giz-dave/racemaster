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
- [ ] i think i've got muddled here: the idea of the results tab is collate all the information
      in the selected mobile files in such a manner as they can be incorporated in the race results
      as rendered on the results page, currently there are 2 sources: the finishers list and the SI results
      list, the intention is this mobile files set is a third source, i like the safety features
      you implemented but the results page has gone too wrt start and clock offsets, that is the
      domain of the adjust finish times function, the mobile results page should just provide the
      required information to allow that, the mobile files contain all the same information as can be
      gleaned from the finishers list with the addition of the CP mode times, they must be in
      the formatted results in a similar way to the SI results

## Data loss prevention

- [ ] mobile files must be auto sync'd to the server whenever the server is reachable,
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
- [ ] the mobile password must be different to the web-app constraint must always be applied

