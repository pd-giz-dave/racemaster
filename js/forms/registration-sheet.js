'use strict';

import { state } from '../state.js';
import { getSortedEntries, getEntriesForCourse } from '../entries.js';

function entryFormHeader(event, course, page, pages) {
  const courseName = course || 'All Courses';
  const pageInfo   = pages > 1 ? ` (page ${page} of ${pages})` : '';
  return `
    <div class="ef-header">
      <div class="ef-title">${event.name || 'Race'} — Entry Form</div>
      <div class="ef-subtitle">${event.date || ''} &nbsp; ${courseName}${pageInfo}</div>
      <div class="ef-dist">Distance: ${event.distance || '?'} km &nbsp; Start: ${event.startTime || ''}</div>
    </div>`;
}

function entryFormTableHeader() {
  return `<thead><tr>
    <th class="col-pos">No</th>
    <th class="col-bib">Bib</th>
    <th class="col-name">Name</th>
    <th class="col-club">Club</th>
    <th class="col-cat">Cat</th>
    <th class="col-dib">Dibber</th>
    <th class="col-fra">FRA</th>
    <th class="col-sig">Signature</th>
  </tr></thead>`;
}

function entryFormRow(pos, e) {
  return `<tr class="ef-row">
    <td class="col-pos">${pos}</td>
    <td class="col-bib">${e.bibNumber || ''}</td>
    <td class="col-name">${e.name || ''}</td>
    <td class="col-club">${e.club || ''}</td>
    <td class="col-cat">${e.category || ''}</td>
    <td class="col-dib">${e.dibberNumber || ''}</td>
    <td class="col-fra">${e.fraNumber || ''}</td>
    <td class="col-sig"></td>
  </tr>`;
}

function entryFormFooter() {
  return `<div class="ef-footer">
    <span>Officials use only — do not remove from race HQ</span>
  </div>`;
}

export function generateRegistrationSheetHTML(entriesPerPage = 20, course) {
  const event = state.event;
  const entries = course ? getEntriesForCourse(course) : getSortedEntries();

  const totalSlots = Math.max(entries.length + 2, entriesPerPage);
  const pages = Math.ceil(totalSlots / entriesPerPage);
  let html = '';

  for (let p = 0; p < pages; p++) {
    const start = p * entriesPerPage;
    const end   = Math.min(start + entriesPerPage, totalSlots);
    html += `<div class="print-page entry-form-page">`;
    html += entryFormHeader(event, course, p + 1, pages);
    html += `<table class="entry-form-table">`;
    html += entryFormTableHeader();
    for (let i = start; i < end; i++) {
      const e = entries[i] || {};
      html += entryFormRow(i + 1, e);
    }
    html += `</table>`;
    html += entryFormFooter();
    html += `</div>`;
  }

  return html;
}