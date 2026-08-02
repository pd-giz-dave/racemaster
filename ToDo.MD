# ToDo

## Add test suite

- [ ] JS logic
- [ ] view logic?

## Add importing results from other sources

- [ ] CSV file - make SI Results a generic CSV import as long as the file has required columns (in any order)

## Re-jig the mobile files "add to finishers"

- [ ] instead of "add to finishers" create a separate tab on the page that shows the 
      consolidated results from the selected mobile files
- [ ] the selected files must include one from the finish location and any number of cp locations
- [ ] the results tab here must have the following columns:
      BibNumber, Name, Category, Course, FinishTime, CP1, CP1Time, ... CPn, CPnTime
      where CPn+CPnTime reflect whatever was discovered in the selected device files,
      CPnTime is calculated as the elapsed time to that CP since the start,
      the start time-of-day can be found via the timestamp against the time mode start line,
      the CP time-of-day can be found via the timestamp in its line, elapsed time is the difference
- [ ] allow for CP mode entries, assume the course is in CP location order, e.g. CP1 -> CP2 -> .. CPn,
      compute elapsed times through CPs as their time-of-day minus time-of-day when the clock started
- [ ] add the results tab here as another results source when generating the results page
