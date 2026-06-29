'use strict';

import { state } from '../state.js';
import { today } from '../utils.js';
import { formatResults } from '../results.js';
import { openPopup } from './preview.js';

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const OVERALL_SECTIONS = new Set(['Senior Overall', 'Senior Female Overall', 'Senior Male Overall']);

export function buildPrizeRowsHTML(prizes) {
  const rows = [];
  let currentSection = null, currentCategory = null;
  for (const p of prizes) {
    if (p.section !== currentSection) {
      currentSection = p.section; currentCategory = null;
      rows.push(`<tr class="prize-section-row"><td colspan="5">${esc(p.section)}</td></tr>`);
    } else if (p.category !== currentCategory) {
      rows.push(`<tr class="prize-cat-sep"><td colspan="5"></td></tr>`);
    }
    currentCategory = p.category;
    const suffix   = p.isJunior ? ' J' : (p.recordBreaker ? ' R' : '');
    const showStar = p.multiWinner && !OVERALL_SECTIONS.has(p.section);
    const name     = (showStar ? '* ' : '') + esc(p.name || '');
    rows.push(`<tr>
      <td>${p.position || ''}</td>
      <td>${esc(p.category || '')}</td>
      <td>${p.inCatPos || ''}</td>
      <td>${esc(p.time || '') + suffix}</td>
      <td class="prize-name-cell">${name}</td>
    </tr>`);
  }
  return rows.join('');
}

function buildPrizeListHTML(isNarrow) {
  const c         = isNarrow ? 'pln' : 'pl';
  const pageClass = isNarrow ? 'prize-list-narrow' : 'prize-list-page';
  const tblClass  = isNarrow ? 'pln-table' : 'prize-table';
  const { prizes: allPrizes } = formatResults();
  const event      = state.event;

  let html = `<div class="${isNarrow ? pageClass : `print-page ${pageClass}`}">`;
  html += `<div class="${c}-header">
    <div class="${c}-title">${event.name || 'Race'} — Prize List</div>
    <div class="${c}-date">${event.date || ''}</div>
  </div>`;

  if (!allPrizes.length) {
    html += `<p>No prizes generated yet.</p>`;
  } else {
    html += `<p class="${c}-hint">R = course record &nbsp; J = junior &nbsp; * = multi winner</p>`;
    html += `<table class="${tblClass}"><thead><tr>
      <th>Pos</th><th>Cat</th><th>CP</th><th>Time</th><th>Name</th>
    </tr></thead><tbody>`;
    html += buildPrizeRowsHTML(allPrizes);
    html += `</tbody></table>`;
  }

  html += `<div class="${c}-footer">${today()}</div>`;
  html += `</div>`;
  return html;
}

export function generatePrizeListHTML()        { return buildPrizeListHTML(false); }

export function openPrizeListPreview(widthMm) {
  const isNarrow  = widthMm < 120;
  const narrowCSS = isNarrow
    ? `@page { size: ${widthMm}mm auto; margin: 0; }
       .prize-list-narrow { width: ${widthMm}mm; padding: 3mm 3mm 3mm 1mm; box-sizing: border-box; }`
    : `@page { size: ${widthMm}mm auto; margin: 0; }
       .print-page { width: ${widthMm}mm; padding: 8mm; box-sizing: border-box; min-height: auto; }`;
  openPopup({
    title:    'Prize List',
    cssLinks: isNarrow ? ['js/forms/prize-list.css'] : ['css/print.css', 'js/forms/prize-list.css'],
    inlineCSS: narrowCSS,
    html: buildPrizeListHTML(isNarrow),
  });
}