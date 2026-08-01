# ToDo

## Add test suite

- [ ] JS logic
- [ ] view logic?

## Add importing results from other sources

- [ ] CSV file - make SI Results a generic CSV import

## Public datasets

Public datasets are read-only for non-owners and non-admins.
Allow read-only access to public datasets even if not logged in?

## Add a notes field to event setup

It appears as a paragraph before the results in the published html

## Re-jig the mobile files "add to finishers"

- [ ] instead of "add to finishers" create a separate tab that shows the consolidated
      results from the selected mobile files
- [ ] allow for CP mode entries, assume the course is in CP location order, e.g. CP1 -> CP2 -> .. CPn,
      compute elapsed times through CPs as their time-of-day minus time-of-day when the clock started
- [ ] add the results tab here as another results source when generating the results page
- [ ] need a mechanism for the bibs mode device to know what bibs are in what course,
      unlike the time mode phone, the bibs mode phone does not need to get to the finish before the first runner does,
      this means it can be loaded with bib numbers after registration closes,
      but...juniors go off before senior registration closes, how do deal with that,
      not an issue if we have a mobile signal - it can get the list via the server,
      see below for a possible mechanism
