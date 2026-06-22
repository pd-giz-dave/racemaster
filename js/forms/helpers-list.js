'use strict';

import { state } from '../state.js';
import { escHtml } from '../ui.js';
import { openPrintPreview } from './preview.js';

const PAGE_CSS = '@page { size: A4 portrait; margin: 0; }';

const INFO_LINE = 'This information is required so points can be awarded to the person in the appropriate category';

const COLUMNS = ['Full Name', 'Club', 'Gender', 'Date of Birth', 'Role'];

function generateHelpersListHTML() {
  const org   = escHtml(state.event.organisation || '');
  const name  = escHtml(state.event.name || '');
  const date  = escHtml(state.event.date || '');

  const cols = COLUMNS.map(c => `<div class="hl-col-hdr">${c}</div>`).join('');
  const rows = Array.from({ length: 25 }, () =>
    `<div class="hl-row">${COLUMNS.map(() => '<div class="hl-cell"></div>').join('')}</div>`
  ).join('');

  return `
<div class="hl-page">
  <div class="hl-title-row">
    <span class="hl-org">${org}</span>
    <span class="hl-heading">Helpers List</span>
  </div>
  <div class="hl-event-box">
    <span class="hl-event-name">${name}</span>
    <span class="hl-event-date">${date}</span>
  </div>
  <div class="hl-info">${INFO_LINE}</div>
  <div class="hl-grid">
    <div class="hl-col-hdrs">${cols}</div>
    ${rows}
  </div>
</div>`;
}

export function openHelpersListPreview() {
  openPrintPreview(generateHelpersListHTML(), 'Helpers List', 'js/forms/helpers-list.css', PAGE_CSS);
}