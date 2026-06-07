'use strict';

import {
  generateEntryFormHTML, generateFinishSheetHTML, generateNumberMatrixHTML,
  generateResultsHTML, generatePrizeListHTML, generateJuniorEntryFormHTML,
  openPrintPreview,
} from '../forms.js';
import { on } from '../ui.js';
import { COURSE } from '../constants.js';

export function renderForms() {
  // Static — buttons wired in wireForms
}

export function wireForms() {
  on('btn-print-entry-form',    'click', () => openPrintPreview(generateEntryFormHTML(), 'Entry Form'));
  on('btn-print-junior-form',   'click', () => openPrintPreview(generateJuniorEntryFormHTML(), 'Junior Entry Form'));
  on('btn-print-finish-senior', 'click', () => openPrintPreview(generateFinishSheetHTML(COURSE.SENIORS), 'Finish Sheet (Seniors)'));
  on('btn-print-finish-junior', 'click', () => openPrintPreview(generateFinishSheetHTML(COURSE.JUNIORS), 'Finish Sheet (Juniors)'));
  on('btn-print-number-matrix', 'click', () => openPrintPreview(generateNumberMatrixHTML(), 'Number Matrix'));
  on('btn-print-results-senior','click', () => openPrintPreview(generateResultsHTML(COURSE.SENIORS), 'Results (Seniors)'));
  on('btn-print-results-junior','click', () => openPrintPreview(generateResultsHTML(COURSE.JUNIORS), 'Results (Juniors)'));
  on('btn-print-prizes',        'click', () => openPrintPreview(generatePrizeListHTML(), 'Prize List'));
}