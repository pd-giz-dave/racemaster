'use strict';

import { state } from './state.js';
import { COURSE } from './constants.js';
import { today, ordinal } from './utils.js';
import { getSortedEntries, getEntriesForCourse } from './entries.js';
import { getResultsForCourse, getPrizes } from './results.js';


/**
 * Generate entry form HTML for printing.
 * entriesPerPage: how many entry slots per A4 page (default 20)
 * course: COURSE.SENIORS or COURSE.JUNIORS (or undefined for all)
 */
export function generateEntryFormHTML(entriesPerPage = 20, course) {
  const event = state.event;
  const entries = course
    ? getEntriesForCourse(course)
    : getSortedEntries();

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

/**
 * Generate a finish sheet for a given course.
 * Lines: number of finish position lines to print.
 */
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

/**
 * Generate bib number matrix — grid of bib numbers for quick lookup.
 * Shows which bib → which person.
 */
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

/**
 * Generate results slip HTML.
 */
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

/**
 * Generate prize list HTML.
 */
export function generatePrizeListHTML() {
  const prizes = getPrizes();
  const event  = state.event;

  let html = `<div class="print-page prize-list-page">`;
  html += `<div class="pl-header">
    <div class="pl-title">${event.name || 'Race'} — Prize List</div>
    <div class="pl-date">${event.date || ''}</div>
  </div>`;

  if (!prizes.length) {
    html += `<p>No prizes generated yet.</p>`;
  } else {
    html += `<table class="prize-table"><thead><tr>
      <th>Category</th><th>Position</th><th>Name</th><th>Time</th>
    </tr></thead><tbody>`;

    let lastCat = '';
    for (const p of prizes) {
      const catChanged = p.category !== lastCat;
      lastCat = p.category;
      html += `<tr class="pl-row${catChanged ? ' pl-cat-start' : ''}">
        <td class="pl-cat">${catChanged ? p.category : ''}</td>
        <td class="pl-pos">${ordinal(p.inCatPos)}</td>
        <td class="pl-name">${p.name || ''}</td>
        <td class="pl-time">${p.time || ''}</td>
      </tr>`;
    }

    html += `</tbody></table>`;
  }

  html += `<div class="pl-footer">${today()}</div>`;
  html += `</div>`;
  return html;
}

/**
 * Generate a junior entry form (A5 landscape).
 */
export function generateJuniorEntryFormHTML() {
  return generateEntryFormHTML(15, COURSE.JUNIORS);
}

/**
 * Open print preview in a new window with the given HTML and print CSS applied.
 */
export function openPrintPreview(contentHTML, title = 'Print Preview') {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <link rel="stylesheet" href="css/print.css">
</head>
<body class="print-preview">
${contentHTML}
<script>
  window.addEventListener('load', () => window.print());
<\/script>
</body>
</html>`);
  win.document.close();
}

/**
 * Generate a compact prize list for narrow paper (thermal receipt printers etc.).
 * Same columns and structure as the prizes tab view, just shrunk to fit narrow paper.
 */
function generateNarrowPrizeListHTML() {
  const prizes = getPrizes();
  const event  = state.event;

  let html = `<div class="print-page prize-list-narrow">`;
  html += `<div class="pln-header">
    <div class="pln-title">${event.name || 'Race'} — Prize List</div>
    <div class="pln-date">${event.date || ''}</div>
  </div>`;

  if (!prizes.length) {
    html += `<p style="text-align:center">No prizes generated yet.</p>`;
  } else {
    html += `<p class="pln-hint">R = course record &nbsp; J = junior &nbsp; * = multi winner</p>`;
    html += `<table class="pln-table"><thead><tr>
      <th>Pos</th><th>Cat</th><th>In Cat</th><th>Time</th><th>Name</th>
    </tr></thead><tbody>`;

    const overallSections = new Set(['Senior Overall', 'Senior Female Overall', 'Senior Male Overall']);
    let currentSection  = null;
    let currentCategory = null;
    for (const p of prizes) {
      if (p.section !== currentSection) {
        currentSection  = p.section;
        currentCategory = null;
        html += `<tr class="pln-section-row"><td colspan="5">${p.section}</td></tr>`;
      } else if (p.category !== currentCategory) {
        html += `<tr class="pln-cat-sep"><td colspan="5"></td></tr>`;
      }
      currentCategory = p.category;
      const suffix   = p.isJunior ? ' J' : (p.recordBreaker ? ' R' : '');
      const showStar = p.multiWinner && !overallSections.has(p.section);
      const name     = (showStar ? '* ' : '') + (p.name || '');
      html += `<tr>
        <td>${p.position || ''}</td>
        <td>${p.category || ''}</td>
        <td>${p.inCatPos || ''}</td>
        <td>${(p.time || '') + suffix}</td>
        <td class="pln-name-cell">${name}</td>
      </tr>`;
    }

    html += `</tbody></table>`;
  }

  html += `<div class="pln-footer">${today()}</div>`;
  html += `</div>`;
  return html;
}

/**
 * Open a prize list print preview sized to the given paper width (mm).
 * widthMm < 120 uses a compact receipt layout; otherwise uses the standard A4 layout.
 */
export function openPrizeListPreview(widthMm) {
  const isNarrow  = widthMm < 120;
  const marginMm  = isNarrow ? 3 : 8;
  const contentMm = widthMm - 2 * marginMm;

  const contentHTML = isNarrow ? generateNarrowPrizeListHTML() : generatePrizeListHTML();

  const overrideCSS = `
    @page { size: ${widthMm}mm auto; margin: ${marginMm}mm; }
    .print-page { width: ${contentMm}mm; min-height: auto;${isNarrow ? ' padding: 0;' : ''} }
  `;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Prize List</title>
  <link rel="stylesheet" href="css/print.css">
  <style>${overrideCSS}</style>
</head>
<body class="print-preview">
${contentHTML}
<script>
  window.addEventListener('load', () => window.print());
<\/script>
</body>
</html>`);
  win.document.close();
}