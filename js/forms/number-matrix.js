'use strict';

import { state } from '../state.js';
import { openPrintPreview } from './preview.js';

const PAGE_CSS = '@page { size: A4 portrait; margin: 0; }';
const DIGITS   = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const GROUPS   = 4;

function generateNumberMatrixHTML() {
  const firstBib = +state.event.firstBibNumber || 1;
  const start    = Math.floor(firstBib / 100) * 100;

  let groups = '';
  for (let g = 0; g < GROUPS; g++) {
    const groupStart = start + g * 100;

    const hdr2 = `<div class="nm-sp"></div><div class="nm-sp"></div>` +
      DIGITS.map(d => `<div class="nm-dlbl">${d}</div>`).join('');

    let rows = '';
    for (let r = 0; r < 10; r++) {
      const rowStart = groupStart + r * 10;
      const prefix   = String(Math.floor(rowStart / 10)).padStart(2, '0');
      const boxes    = DIGITS.map(c => {
        const n   = rowStart + c;
        const num = String(n).padStart(3, '0');
        if (n < firstBib) {
          return `<div class="nm-box"><svg class="nm-x" viewBox="0 0 10 10" preserveAspectRatio="none"><line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/></svg><span>${num}</span></div>`;
        }
        return `<div class="nm-box">${num}</div>`;
      }).join('');
      rows += `<div class="nm-row"><div class="nm-rpfx">${prefix}</div>${boxes}</div>`;
    }

    groups += `
      <div class="nm-group">
        <div class="nm-hdr1">Last Digit</div>
        <div class="nm-hdr2">${hdr2}</div>
        <div class="nm-data">
          <div class="nm-vlbl">First Two Digits</div>
          <div class="nm-rows">${rows}</div>
        </div>
      </div>`;
  }

  return `<div class="nm-page">${groups}</div>`;
}

export function openNumberMatrixPreview() {
  openPrintPreview(generateNumberMatrixHTML(), 'Number Matrix', 'js/forms/number-matrix.css', PAGE_CSS);
}