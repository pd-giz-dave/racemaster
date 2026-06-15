'use strict';


// Gender constants
export const GENDER = {
  UNKNOWN: 'Unknown',
  FEMALE:  'Female',
  MALE:    'Male',
};

// Course constants
export const COURSE = {
  JUNIORS: 'Juniors',
  SENIORS: 'Seniors',
};

// Timing method constants
export const TIMING = {
  STOPWATCH: 'Stopwatch',
  DIBBERS:   'Dibbers',
  NONE:      'None',
};

// SI Results minimum expected column names
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
  ENTRIES_ID:    'Participant ID',
  ELIGIBILITY:   'Eligibility',
  GENDER_DOB:    'GenderDOB',
};

// FRA category preset data [maleMinAge, maleCat, maleRef, maleMaxDist, femaleMinAge, femaleCat, femaleRef, femaleMaxDist]
export const FRA_CATEGORIES = [
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
];

export const WFRA_CATEGORIES = [
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
];


// Entry form dimensions (mm) - from LibreOffice constants
export const ENTRY_FORM = {
  ROW_HEIGHTS:    [8,4,4,8,7,5,7,5,5,5,5,5,5,5,5,5,5,5,4,4,4,4,4,4,4,4,12,4,4],
  COLUMN_WIDTHS:  [6,22,28,18,18,18,18,2,22,25,25],
  FIRST_ROW:      1,
  LAST_ROW:       29,
  MARGIN_ROWS:    2,
};