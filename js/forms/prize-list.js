'use strict';

import { state } from '../state.js';
import { today } from '../utils.js';
import { getPrizes } from '../results.js';
import { openPopup } from './preview.js';

const OVERALL_SECTIONS = new Set(['Senior Overall', 'Senior Female Overall', 'Senior Male Overall']);

function buildPrizeListHTML(isNarrow) {
  const c         = isNarrow ? 'pln' : 'pl';
  const pageClass = isNarrow ? 'prize-list-narrow' : 'prize-list-page';
  const tblClass  = isNarrow ? 'pln-table' : 'prize-table';
  const prizes    = getPrizes();
  const event     = state.event;

  let html = `<div class="print-page ${pageClass}">`;
  html += `<div class="${c}-header">
    <div class="${c}-title">${event.name || 'Race'} — Prize List</div>
    <div class="${c}-date">${event.date || ''}</div>
  </div>`;

  if (!prizes.length) {
    html += `<p>No prizes generated yet.</p>`;
  } else {
    html += `<p class="${c}-hint">R = course record &nbsp; J = junior &nbsp; * = multi winner</p>`;
    html += `<table class="${tblClass}"><thead><tr>
      <th>Pos</th><th>Cat</th><th>In Cat</th><th>Time</th><th>Name</th>
    </tr></thead><tbody>`;

    let currentSection  = null;
    let currentCategory = null;
    for (const p of prizes) {
      if (p.section !== currentSection) {
        currentSection  = p.section;
        currentCategory = null;
        html += `<tr class="${c}-section-row"><td colspan="5">${p.section}</td></tr>`;
      } else if (p.category !== currentCategory) {
        html += `<tr class="${c}-cat-sep"><td colspan="5"></td></tr>`;
      }
      currentCategory = p.category;
      const suffix   = p.isJunior ? ' J' : (p.recordBreaker ? ' R' : '');
      const showStar = p.multiWinner && !OVERALL_SECTIONS.has(p.section);
      const name     = (showStar ? '* ' : '') + (p.name || '');
      html += `<tr>
        <td>${p.position || ''}</td>
        <td>${p.category || ''}</td>
        <td>${p.inCatPos || ''}</td>
        <td>${(p.time || '') + suffix}</td>
        <td class="${c}-name-cell">${name}</td>
      </tr>`;
    }

    html += `</tbody></table>`;
  }

  html += `<div class="${c}-footer">${today()}</div>`;
  html += `</div>`;
  return html;
}

export function generatePrizeListHTML()        { return buildPrizeListHTML(false); }
function        generateNarrowPrizeListHTML()  { return buildPrizeListHTML(true);  }

export function openPrizeListPreview(widthMm) {
  const isNarrow  = widthMm < 120;
  const marginMm  = isNarrow ? 3 : 8;
  const contentMm = widthMm - 2 * marginMm;
  openPopup({
    title:    'Prize List',
    cssLinks: ['css/print.css', 'js/forms/prize-list.css'],
    inlineCSS: `
      @page { size: ${widthMm}mm auto; margin: ${marginMm}mm; }
      .print-page { width: ${contentMm}mm; min-height: auto;${isNarrow ? ' padding: 0;' : ''} }
    `,
    html: isNarrow ? generateNarrowPrizeListHTML() : generatePrizeListHTML(),
  });
}