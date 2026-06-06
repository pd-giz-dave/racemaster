'use strict';

// ============================================================
// All constants translated from LibreOffice Basic Main.xml
// ============================================================

export const LOGGING = false;

// Sheet / file names (used as CSV filenames)
export const FILE = {
  EVENT:       'event.csv',
  PEOPLE:      'people.csv',
  CLUBS:       'clubs.csv',
  DIBBERS:     'dibbers.csv',
  CATEGORIES:  'categories.csv',
  ROLES:       'roles.csv',
  PRE_ENTRIES: 'pre_entries.csv',
  ENTRIES:     'entries.csv',
  HELPERS:     'helpers.csv',
  FINISHERS:   'finishers.csv',
  SAFETY:      'safety.csv',
  RESULTS:     'results.csv',
  PRIZES:      'prizes.csv',
  SI_RESULTS:  'si_results.csv',
  SI_TIMING:   'si_timing.csv',
};

// Gender constants
export const GENDER = {
  UNKNOWN:        'Unknown',
  FEMALE:         'Female',
  MALE:           'Male',
  PAIR:           'Pair',
  NON_BINARY:     'Non-binary',
  FEMALE_PREFIX:  'F',
  MALE_PREFIX:    'M',
  PAIR_PREFIX:    'P',
  NON_BINARY_PREFIX: 'N',
};

// Course constants
export const COURSE = {
  JUNIORS:        'Juniors',
  SENIORS:        'Seniors',
  SENIORS_PREFIX: 'S',
  JUNIORS_PREFIX: 'J',
};

// Timing method constants
export const TIMING = {
  STOPWATCH:        'Stopwatch',
  DIBBERS:          'Dibbers',
  NONE:             'None',
  STOPWATCH_PREFIX: 'S',
  DIBBERS_PREFIX:   'D',
  NONE_PREFIX:      'N',
};

// Entry format constants
export const FORMAT = {
  SI_ENTRIES:           'SI Entries',
  ENTRY_CENTRAL:        'Entry Central',
  NONE:                 'None',
  SI_ENTRIES_PREFIX:    'S',
  ENTRY_CENTRAL_PREFIX: 'E',
  NONE_PREFIX:          'N',
};

// Finisher action constants
export const FINISHER = {
  NORMAL:        'F',   // normal finish
  DNF:           'N',   // did not finish
  DSQ:           'D',   // disqualified
  IMPORTED:      'Imported',
  MANUAL:        'Manual',
  ACTION_START:  'Start',
  ACTION_FINISH: 'Finish',
  ACTION_IGNORE: 'Ignore',
  SENIORS:       'Seniors',
  JUNIORS:       'Juniors',
  CLOCK:         'Clock',
  IGNORE:        'Ignore',
  NO_START:      'NoStart',
  TIME:          'Time',
  OFFSET:        'Offset',
};

// Results prefix constants
export const RESULTS = {
  NO_TIME_PREFIX: '?@P',
  DNF_PREFIX:     'DNF',
  DSQ_PREFIX:     'DSQ',
  PREFIX_LENGTH:  3,
  LEADERS_COUNT:  10,
};

// Prize priorities (string prefixes for lexicographic sort)
export const PRIZE_PRIORITY = {
  OVERALL:            '1',
  CATEGORY:           '2',
  GIRLS_BY_CATEGORY:  1000,
  BOYS_BY_CATEGORY:   2000,
  FEMALE_OVERALL:     4000,
  MALE_OVERALL:       5000,
  PAIR_OVERALL:       6000,
  FEMALE_BY_CATEGORY: 7000,
  MALE_BY_CATEGORY:   8000,
  PAIR_BY_CATEGORY:   9000,
  MULTIPLE_MARKER:    '*',
};

// Misc constants
export const UNATTACHED_CLUB = 'Unattached';
export const LIST_SEP        = ' | ';
export const SUFFIX_SEP      = ' @ ';

// SI Entries expected column names (SI Entries format)
// leading '*' means its optional, space means its compulsory
export const SI_COL_NAMES = {
  PARTICIPANT_NUMBER: ' Participant - Participant No',
  PARTICIPANT_ID:     '*Participant - SiEntries ID',
  FIRST_NAME:         ' Participant - First Name',
  LAST_NAME:          ' Participant - Last Name',
  GENDER1:            ' Participant - Gender',
  GENDER2:            ' Participant - Class Sex at Birth',
  GENDER3:            ' Participant - Sex',
  DOB:                ' Participant - Date of Birth',
  CATEGORY:           '*Participant - Class',
  EMAIL:              '*Participant - Email Address',
  ADDRESS1:           '*Participant - Address Line 1',
  ADDRESS2:           '*Participant - Address Line 2',
  TOWN:               '*Participant - Postal Town',
  COUNTY:             '*Participant - County',
  POSTCODE:           '*Participant - Post Code',
  COUNTRY:            '*Participant - Country',
  TELEPHONE:          '*Participant - Telephone No',
  MOBILE:             ' Participant - Mobile No',
  ELIGIBILITY:        '*English Championships Eligibility - I am eligible for English Champs',
  CLUB:               '*Entry Details - Club',
  FRA_NUMBER:         '*Entry Details - FRA Membership Number',
  CONTACT_NAME:       '*Emergency Details - Emergency Contact Name',
  CONTACT_TELEPHONE:  '*Emergency Details - Emergency Contact Telephone',
  MEDICAL:            '*Emergency Details - Medical Conditions',
  CAR_REG:            '*Emergency Details - Car Registration',
};

// Entry Central expected column names
// leading '*' means its optional, space means its compulsory
export const EC_COL_NAMES = {
  PARTICIPANT_NUMBER: ' RaceNumber',
  FIRST_NAME:         ' Forename',
  LAST_NAME:          ' Surname',
  GENDER:             ' Gender',
  DOB:                ' DOB',
  CATEGORY:           '*AgeGroup',
  EMAIL:              '*email',
  ADDRESS1:           '*Address1',
  ADDRESS2:           '*Address2',
  TOWN:               '*Town/City',
  COUNTY:             '*Region',
  POSTCODE:           '*Postcode',
  COUNTRY:            '*Country',
  TELEPHONE:          '*phone',
  CLUB:               '*Club',
  FRA_NUMBER:         '*MembershipId',
};

// SI Results expected column names
export const SI_RESULTS_COL_NAMES = {
  RACE_NUMBER: 'RaceNumber',
  NAME:        'Name (Free Format)',
  CATEGORY:    'Category',
  CLUB:        'Club',
  COURSE:      'CourseClass',
  RACE_TIME:   'RaceTime',
  POSITION:    'Position',
  STATUS:      'Status',
};

// SI Timing export column names
export const SI_TIMING_COL_NAMES = {
  BIB_NUMBER:    'RaceNumber',
  NUM_ENTRANTS:  'NumberCompetitors',
  DIBBER_NUMBER: 'CardNumbers',
  FRA_NUMBER:    'MembershipNumbers',
  FORENAMES:     'Forenames',
  SURNAMES:      'Surnames',
  NAME:          'Name (Free Format)',
  CATEGORY:      'Category',
  CLUB:          'Club',
  COURSE:        'CourseClass',
  ENTRIES_ID:    'Entry System IDs',
  ELIGIBILITY:   'Eligibility',
  GENDER_DOB:    'GenderDOB',
};

// FRA category preset data [maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist]
export const FRA_CATEGORIES = [
  [-1, '-',    'NOW', 0,    -1, '-',    'NOW', 0],
  [6,  'U10B', 'EOY', 1.5,  6, 'U10G', 'EOY', 1.5],
  [10, 'U12B', 'EOY', 3,   10, 'U12G', 'EOY', 3],
  [12, 'U14B', 'EOY', 5,   12, 'U14G', 'EOY', 5],
  [14, 'U16B', 'EOY', 6,   14, 'U16G', 'EOY', 6],
  [16, 'U18B', 'EOY', 8,   16, 'U18G', 'EOY', 8],
  [18, 'U20B', 'EOY', 10,  18, 'U20G', 'EOY', 10],
  [20, 'MU23', 'EOY', 999, 20, 'WU23', 'EOY', 999],
  [23, 'MSEN', 'NOW', 999, 23, 'WSEN', 'NOW', 999],
  [40, 'M40',  'NOW', 999, 40, 'W40',  'NOW', 999],
  [45, 'M45',  'NOW', 999, 45, 'W45',  'NOW', 999],
  [50, 'M50',  'NOW', 999, 50, 'W50',  'NOW', 999],
  [55, 'M55',  'NOW', 999, 55, 'W55',  'NOW', 999],
  [60, 'M60',  'NOW', 999, 60, 'W60',  'NOW', 999],
  [65, 'M65',  'NOW', 999, 65, 'W65',  'NOW', 999],
  [70, 'M70',  'NOW', 999, 70, 'W70',  'NOW', 999],
  [75, 'M75',  'NOW', 999, 75, 'W75',  'NOW', 999],
  [80, 'M80',  'NOW', 999, 80, 'W80',  'NOW', 999],
  [999,'none', 'NOW', 999, 999,'none', 'NOW', 999],
];

export const WFRA_CATEGORIES = [
  [-1, '-',    'NOW', 0,    -1, '-',    'NOW', 0],
  [6,  'U10B', 'EOY', 1.5,  6, 'U10G', 'EOY', 1.5],
  [10, 'U12B', 'EOY', 3,   10, 'U12G', 'EOY', 3],
  [12, 'U14B', 'EOY', 5,   12, 'U14G', 'EOY', 5],
  [14, 'U16B', 'EOY', 6,   14, 'U16G', 'EOY', 6],
  [16, 'U18B', 'EOY', 8,   16, 'U18G', 'EOY', 8],
  [18, 'U20B', 'EOY', 10,  18, 'U20G', 'EOY', 10],
  [20, 'MU23', 'EOY', 999, 20, 'WU23', 'EOY', 999],
  [23, 'MSEN', 'NOW', 999, 23, 'WSEN', 'NOW', 999],
  [40, 'M40',  'NOW', 999, 40, 'W40',  'NOW', 999],
  [50, 'M50',  'NOW', 999, 50, 'W50',  'NOW', 999],
  [60, 'M60',  'NOW', 999, 60, 'W60',  'NOW', 999],
  [70, 'M70',  'NOW', 999, 70, 'W70',  'NOW', 999],
  [80, 'M80',  'NOW', 999, 80, 'W80',  'NOW', 999],
  [999,'none', 'NOW', 999, 999,'none', 'NOW', 999],
];

// Default pairs categories
export const DEFAULT_PAIR_CATEGORIES = [
  [18, 'M-PAIR', 'NOW', 999],
  [18, 'F-PAIR', 'NOW', 999],
  [18, 'X-PAIR', 'NOW', 999],
  [18, 'J-PAIR', 'NOW', 999],
  [999,'none',   'NOW', 999],
];

// Entry form dimensions (mm) - from LibreOffice constants
export const ENTRY_FORM = {
  ROW_HEIGHTS:    [8,4,4,8,7,5,7,5,5,5,5,5,5,5,5,5,5,5,4,4,4,4,4,4,4,4,12,4,4],
  COLUMN_WIDTHS:  [6,22,28,18,18,18,18,2,22,25,25],
  FIRST_ROW:      1,
  LAST_ROW:       29,
  MARGIN_ROWS:    2,
};