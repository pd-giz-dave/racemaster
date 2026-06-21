'use strict';

import {
  openBlankEntryFormPreview, openPreFilledEntryFormPreview, generateRegistrationSheetHTML,
  openFinishSheetPreview, generateNumberMatrixHTML,
  generateResultsHTML, generatePrizeListHTML,
  openPrintPreview,
} from '../forms';
import { state } from '../state.js';
import { on } from '../ui.js';
import { COURSE } from '../constants.js';

export function renderForms() {
  // Static — buttons wired in wireForms
}

export function wireForms() {
  on('btn-print-entry-form',       'click', () => openBlankEntryFormPreview(2));
  on('btn-print-pre-entry-forms',  'click', () => openPreFilledEntryFormPreview());
  on('btn-print-reg-sheet',        'click', () => openPrintPreview(generateRegistrationSheetHTML(20, COURSE.SENIORS), 'Senior Registration Sheet',  'js/forms/registration-sheet.css'));
  on('btn-print-junior-reg-sheet', 'click', () => openPrintPreview(generateRegistrationSheetHTML(15, COURSE.JUNIORS), 'Junior Registration Sheet', 'js/forms/registration-sheet.css'));
  on('btn-print-finish-senior',    'click', () => openFinishSheetPreview(state.event.entryLimit,       'Senior Finish Sheet'));
  on('btn-print-finish-junior',    'click', () => openFinishSheetPreview(state.event.juniorEntryLimit, 'Junior Finish Sheet'));
  on('btn-print-number-matrix',    'click', () => openPrintPreview(generateNumberMatrixHTML(), 'Number Matrix',                                    'js/forms/number-matrix.css'));
  on('btn-print-results-senior',   'click', () => openPrintPreview(generateResultsHTML(COURSE.SENIORS), 'Results (Seniors)',                       'js/forms/results.css'));
  on('btn-print-results-junior',   'click', () => openPrintPreview(generateResultsHTML(COURSE.JUNIORS), 'Results (Juniors)',                       'js/forms/results.css'));
  on('btn-print-prizes',           'click', () => openPrintPreview(generatePrizeListHTML(), 'Prize List',                                          'js/forms/prize-list.css'));
}