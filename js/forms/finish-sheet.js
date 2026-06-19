'use strict';

import { state } from '../state.js';
import { COURSE } from '../constants.js';

export function generateFinishSheetHTML(course, lines = 60) {
  course = course || COURSE.SENIORS;
  const event = state.event;
  const pages = Math.ceil(lines / 30);
  let html = '';

  for (let p = 0; p < pages; p++) {
    const startPos = p * 30 + 1;
    const endPos   = Math.min(startPos + 29, lines);
    html += `<div class="print-page finish-sheet-page">`;
    html += `<div class="fs-header">
      <div class="fs-title">${event.name || 'Race'} — Finish Sheet</div>
      <div class="fs-sub">${course} &nbsp; ${event.date || ''}</div>
    </div>`;
    html += `<table class="finish-sheet-table">`;
    html += `<thead><tr>
      <th class="col-fpos">Pos</th>
      <th class="col-ftime">Time</th>
      <th class="col-fbib">Bib No</th>
      <th class="col-fname">Name (office use)</th>
    </tr></thead>`;
    for (let pos = startPos; pos <= endPos; pos++) {
      html += `<tr class="fs-row">
        <td class="col-fpos">${pos}</td>
        <td class="col-ftime"></td>
        <td class="col-fbib"></td>
        <td class="col-fname"></td>
      </tr>`;
    }
    html += `</table>`;
    html += `<div class="fs-footer">Timekeeper signature: __________________________ &nbsp; Date: ${event.date || ''}</div>`;
    html += `</div>`;
  }

  return html;
}