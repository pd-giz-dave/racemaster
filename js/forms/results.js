'use strict';

import { state } from '../state.js';
import { COURSE } from '../constants.js';
import { today } from '../utils.js';
import { getResultsForCourse } from '../results.js';

export function generateResultsHTML(course) {
  course = course || COURSE.SENIORS;
  const results = getResultsForCourse(course);
  const event   = state.event;

  let html = `<div class="print-page results-page">`;
  html += `<div class="rs-header">
    <div class="rs-title">${event.name || 'Race'} — Results</div>
    <div class="rs-sub">${course} &nbsp; ${event.date || ''} &nbsp; ${event.distance || '?'} km</div>
  </div>`;
  html += `<table class="results-table">`;
  html += `<thead><tr>
    <th class="col-rpos">Pos</th>
    <th class="col-rtime">Time</th>
    <th class="col-rname">Name</th>
    <th class="col-rclub">Club</th>
    <th class="col-rcat">Cat</th>
    <th class="col-rcpos">In Cat</th>
    <th class="col-rbehind">Behind</th>
  </tr></thead><tbody>`;

  for (const r of results) {
    const isDNF = !r.time || r.time === 'DNF' || r.time === 'DSQ';
    html += `<tr class="rs-row${isDNF ? ' rs-dnf' : ''}${r.prize ? ' rs-prize' : ''}">
      <td>${isDNF ? r.time || 'DNF' : r.position}</td>
      <td>${isDNF ? '' : r.time}</td>
      <td>${r.name || ''}</td>
      <td>${r.club || ''}</td>
      <td>${r.category || ''}</td>
      <td>${isDNF ? '' : r.inCatPos}</td>
      <td>${r.behindTime || ''}</td>
    </tr>`;
  }

  html += `</tbody></table>`;
  html += `<div class="rs-footer">Produced by RaceMaster &nbsp; ${today()}</div>`;
  html += `</div>`;
  return html;
}