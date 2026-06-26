'use strict';

// ----------------------------------------------------------------
// SI Timing format definitions — update here when SI changes their formats.
// Last verified: June 2026
// ----------------------------------------------------------------

export const SI = {
  // Column names produced when exporting entries to SI Timing software
  timingExport: {
    BIB_NUMBER:           'RaceNumber',
    NUM_ENTRANTS:         'NumberCompetitors',
    DIBBER_NUMBER:        'CardNumbers',
    FRA_NUMBER:           'MembershipNumbers',
    FORENAMES:            'Forenames',
    SURNAMES:             'Surnames',
    NAME:                 'Name (Free Format)',
    CATEGORY:             'Category',
    CLUB:                 'Club',
    COUNTRY:              'Country',
    COURSE:               'CourseClass',
    START_TIME:           'StartTime',
    START_TIME_PREFERRED: 'StartTimePreference',
    ENVELOPE_NUMBER:      'EnvelopeNumber',
    NON_COMPETITIVE:      'NonCompetitive',
    SEEDED:               'Seeded',
    NOT_USED:             'NotUsed',
    HANDICAP:             'Handicap',
    REGISTRATION_NOTES:   'RegistrationNotes',
    ENTRIES_ID:           'Participant ID',
    ELIGIBILITY:          'Eligibility',
    SOCIAL_MEDIA:         'SocialMedia',
    GENDER_DOB:           'GenderDOB',
  },

  // Column names and field aliases for importing SI results
  resultsImport: {
    required: ['RaceNumber', 'Name (Free Format)', 'Category', 'Club', 'CourseClass', 'RaceTime', 'Position', 'Status'],
    bib:      ['RaceNumber', 'BibNo', 'Bib', 'Number', 'bibNumber'],
    raceTime: ['RaceTime', 'Race time', 'Time', 'FinishTime', 'Finish time'],
    course:   ['CourseClass', 'Course', 'Class'],
    status:   ['Status'],
    name:     ['Name (Free Format)', 'Surname', 'Name', 'Last name', 'Lastname'],
  },

  // Field lookup aliases for importing pre-entries (SI Entries / EntryCentral)
  entriesImport: {
    participantNumber: ['Participant - Participant No', 'RaceNumber'],
    siEntriesId:       ['Participant - SiEntries ID'],
    firstName:         ['Participant - First Name',    'Forename'],
    lastName:          ['Participant - Last Name',     'Surname'],
    gender:            ['Participant - Gender', 'Participant - Class Sex at Birth', 'Participant - Sex', 'Gender'],
    dob:               ['Participant - Date of Birth', 'DOB'],
    club:              ['Entry Details - Club',                     'Club'],
    fraNumber:         ['Entry Details - FRA Membership Number',    'MembershipId'],
    category:          ['Participant - Class',                      'AgeGroup'],
    email:             ['Participant - Email Address',              'email'],
    address1:          ['Participant - Address Line 1',             'Address1'],
    address2:          ['Participant - Address Line 2',             'Address2'],
    town:              ['Participant - Postal Town',                'Town/City'],
    county:            ['Participant - County',                     'Region'],
    postcode:          ['Participant - Post Code',                  'Postcode'],
    country:           ['Participant - Country',                    'Country'],
    telephone:         ['Participant - Telephone No',               'phone'],
    mobile:            ['Participant - Mobile No'],
    eligibility:       ['English Championships Eligibility - I am eligible for English Champs'],
    contactName:       ['Emergency Details - Emergency Contact Name'],
    contactTelephone:  ['Emergency Details - Emergency Contact Telephone'],
    medical:           ['Emergency Details - Medical Conditions'],
    carReg:            ['Emergency Details - Car Registration'],
  },
};