'use strict';

// ----------------------------------------------------------------
// CSV format definitions for all internally-managed data files.
// fields:  column order for export (matches schema.js field names)
// aliases: accepted column names on import (first entry = canonical)
// Excludes SI Timing formats — those are in si-entries.js / si-results.js.
// ----------------------------------------------------------------

export const CSV = {
  dibbers: {
    fields:  ['shortCode', 'longCode', 'owner', 'lost', 'notes'],
    aliases: {
      shortCode: ['shortCode', 'Short Code', 'Number'],
      longCode:  ['longCode',  'Long Code',  'Code'],
      owner:     ['owner',     'Owner'],
      lost:      ['lost',      'Lost'],
      notes:     ['notes',     'Notes'],
    },
  },

  people: {
    fields:  ['name', 'gender', 'dob', 'club', 'fraNumber', 'lastSeen', 'seenTotal', 'lastHelped', 'helpedTotal', 'banned'],
    aliases: {
      name:        ['name',        'Name'],
      gender:      ['gender',      'Gender'],
      dob:         ['dob',         'Date of Birth', 'DOB'],
      club:        ['club',        'Club'],
      fraNumber:   ['fraNumber',   'FRA Number',    'FRANumber'],
      lastSeen:    ['lastSeen',    'Last Seen'],
      seenTotal:   ['seenTotal',   'Seen Total'],
      lastHelped:  ['lastHelped',  'Last Helped'],
      helpedTotal: ['helpedTotal', 'Helped Total'],
      banned:      ['banned',      'Banned Until',  'Banned'],
    },
  },

  roles: {
    fields:  ['role', 'description'],
    aliases: {
      role:        ['role',        'Role'],
      description: ['description', 'Description'],
    },
  },

  categories: {
    // widths must stay parallel to fields — one entry per column
    fields:  ['maleMinAge', 'maleCat', 'maleRef', 'maleMaxDist', 'femaleMinAge', 'femaleCat', 'femaleRef', 'femaleMaxDist'],
    widths:  ['46px',       '60px',    '46px',    '52px',        '46px',         '60px',      '46px',      '52px'],
  },

  results: {
    seniors: ['course', 'bibNumber', 'position', 'inCatPos', 'name', 'club', 'category', 'time', 'pctLdrs', 'behindTime'],
    juniors: ['course', 'bibNumber', 'inCatPos', 'name', 'club', 'category', 'time'],
  },
};