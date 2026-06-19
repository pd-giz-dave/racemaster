'use strict';

import { state } from '../state.js';
import { getSortedEntries } from '../entries.js';

export function generateNumberMatrixHTML() {
  const entries = getSortedEntries();
  if (!entries.length) return '<p>No entries</p>';

  const cols = 5;
  const rows = Math.ceil(entries.length / cols);
  const event = state.event;

  let html = `<div class="print-page number-matrix-page">`;
  html += `<div class="nm-header">
    <div class="nm-title">${event.name || 'Race'} — Number Matrix</div>
    <div class="nm-date">${event.date || ''}</div>
  </div>`;
  html += `<table class="number-matrix-table"><tbody>`;

  for (let r = 0; r < rows; r++) {
    html += `<tr>`;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < entries.length) {
        const e = entries[idx];
        html += `<td class="nm-cell">
          <span class="nm-bib">${e.bibNumber}</span>
          <span class="nm-name">${e.name || ''}</span>
          <span class="nm-cat">${e.category || ''}</span>
        </td>`;
      } else {
        html += `<td class="nm-cell nm-empty"></td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
}