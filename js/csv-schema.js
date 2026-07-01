'use strict';

// ----------------------------------------------------------------
// CSV format definitions for all internally-managed data files.
// fields:  derived from schema.js factory functions — field order
//          matches factory parameter order; add fields there, not here.
// aliases: accepted column names on import (first entry = canonical)
// Excludes SI Timing formats — those are in si-schema.js.
// ----------------------------------------------------------------

import { createDibber, createPerson, createRole, createCategory } from './schema.js';

export const CSV = {
  dibbers: {
    fields:  Object.keys(createDibber()),
    aliases: {
      shortCode: ['shortCode', 'Short Code', 'Number'],
      longCode:  ['longCode',  'Long Code',  'Code'],
      owner:     ['owner',     'Owner'],
      lost:      ['lost',      'Lost'],
      notes:     ['notes',     'Notes'],
    },
  },

  people: {
    fields:  Object.keys(createPerson()),
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
    fields:  Object.keys(createRole()),
    aliases: {
      role:        ['role',        'Role'],
      description: ['description', 'Description'],
    },
  },

  categories: {
    // widths must stay parallel to fields — one entry per column
    fields:  Object.keys(createCategory()),
    widths:  ['52px', '60px', '60px', '46px', '52px'],
  },

  results: {
    seniors: ['position', 'bibNumber', 'inCatPos', 'name', 'club', 'category', 'time', 'pctLdrs', 'behindTime'],
    juniors: ['bibNumber', 'inCatPos', 'name', 'club', 'category', 'time'],
    pairs:   ['position', 'bibNumber', 'inCatPos', 'name', 'partnerName', 'club', 'category', 'time'],
  },
};