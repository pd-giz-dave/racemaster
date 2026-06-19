'use strict';

import {
  openBlankEntryFormPreview, generateRegistrationSheetHTML,
  generateFinishSheetHTML, generateNumberMatrixHTML,
  generateResultsHTML, generatePrizeListHTML,
  openPrintPreview,
} from '../forms';
import { on } from '../ui.js';
import { COURSE } from '../constants.js';

export function renderForms() {
  // Static — buttons wired in wireForms
}

export function wireForms() {
  on('btn-print-entry-form',       'click', () => openBlankEntryFormPreview(2));
  on('btn-print-reg-sheet',        'click', () => openPrintPreview(generateRegistrationSheetHTML(20, COURSE.SENIORS), 'Senior Registration Sheet',  'js/forms/registration-sheet.css'));
  on('btn-print-junior-reg-sheet', 'click', () => openPrintPreview(generateRegistrationSheetHTML(15, COURSE.JUNIORS), 'Junior Registration Sheet', 'js/forms/registration-sheet.css'));
  on('btn-print-finish-senior',    'click', () => openPrintPreview(generateFinishSheetHTML(COURSE.SENIORS), 'Finish Sheet (Seniors)',               'js/forms/finish-sheet.css'));
  on('btn-print-finish-junior',    'click', () => openPrintPreview(generateFinishSheetHTML(COURSE.JUNIORS), 'Finish Sheet (Juniors)',               'js/forms/finish-sheet.css'));
  on('btn-print-number-matrix',    'click', () => openPrintPreview(generateNumberMatrixHTML(), 'Number Matrix',                                    'js/forms/number-matrix.css'));
  on('btn-print-results-senior',   'click', () => openPrintPreview(generateResultsHTML(COURSE.SENIORS), 'Results (Seniors)',                       'js/forms/results.css'));
  on('btn-print-results-junior',   'click', () => openPrintPreview(generateResultsHTML(COURSE.JUNIORS), 'Results (Juniors)',                       'js/forms/results.css'));
  on('btn-print-prizes',           'click', () => openPrintPreview(generatePrizeListHTML(), 'Prize List',                                          'js/forms/prize-list.css'));
}