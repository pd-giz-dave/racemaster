'use strict';

// ====================================================
// Constants translated from LibreOffice Basic Main.xml
// ====================================================

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
  JUNIORS_PREFIX: 'J',  // ToDo: drop this
};

// Timing method constants
export const TIMING = {
  STOPWATCH:        'Stopwatch',
  DIBBERS:          'Dibbers',
  NONE:             'None',
  DIBBERS_PREFIX:   'D', // ToDo: drop this
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