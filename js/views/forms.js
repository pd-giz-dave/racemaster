'use strict';

import {
  openBlankEntryFormPreview, openPreFilledEntryFormPreview,
  openBlankPairsEntryFormPreview, openPreFilledPairsEntryFormPreview,
  openHelpersListPreview, openFinishSheetPreview, openNumberMatrixPreview, openBibsPreview,
} from '../forms';
import { state } from '../state.js';
import { on } from '../ui.js';

// Renders the Forms (print) screen — thin button-wiring only; every actual form layout/preview
// (blank/pre-filled entry forms, pairs forms, helpers list, finish sheets, number matrix, bibs)
// lives in the forms/ directory and is just invoked here on click.

export function renderForms() {
  // Static — buttons wired in wireForms
}

export function wireForms() {
  on('btn-print-entry-form',        'click', () => openBlankEntryFormPreview(2));
  on('btn-print-pre-entry-forms',   'click', () => openPreFilledEntryFormPreview());
  on('btn-print-pairs-entry-forms',          'click', () => openBlankPairsEntryFormPreview(2));
  on('btn-print-pre-entry-pairs-entry-forms','click', () => openPreFilledPairsEntryFormPreview());
  on('btn-print-helpers-list',    'click', () => openHelpersListPreview());
  on('btn-print-finish-senior',   'click', () => openFinishSheetPreview(state.event.entryLimit,       'Senior Finish Sheet'));
  on('btn-print-finish-junior',   'click', () => openFinishSheetPreview(state.event.juniorEntryLimit, 'Junior Finish Sheet'));
  on('btn-print-number-matrix',   'click', () => openNumberMatrixPreview());
  on('btn-print-bibs',            'click', () => openBibsPreview());
}