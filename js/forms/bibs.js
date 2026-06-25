'use strict';

import { openPopup } from './preview.js';
import { showStatus } from '../ui.js';

function bibSVG(n) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 148.5" style="display:block;width:210mm;height:148.5mm">` +
    `<text x="105" y="115" text-anchor="middle" ` +
    `font-family="'Arial Black',Impact,Arial,sans-serif" font-weight="900" ` +
    `font-size="110" textLength="180" lengthAdjust="spacingAndGlyphs" ` +
    `fill="black">${n}</text></svg>`;
}

function buildHTML(first, count) {
  // Guillotine layout: guillotine the A4 stack to get two A5 stacks; put top
  // pile on bottom pile and the numbers run in order.
  const half = Math.ceil(count / 2);
  let html = '';
  for (let i = 0; i < half; i++) {
    const top    = first + i;
    const bottom = first + i + half;
    const btm    = bottom < first + count ? bibSVG(bottom) : '';
    html += `<div class="bp"><div class="bh">${bibSVG(top)}</div><div class="bh bb">${btm}</div></div>`;
  }
  return html;
}

const CSS = `
  @page { size: A4 portrait; margin: 0; }
  body  { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
  .bp   { width: 210mm; height: 297mm; break-after: page; page-break-after: always; }
  .bp:last-child { break-after: avoid; page-break-after: avoid; }
  .bh   { width: 210mm; height: 148.5mm; display: flex; align-items: center;
          justify-content: center; overflow: hidden; box-sizing: border-box; }
  .bb   { border-top: 1px dashed #999; position: relative; }
  .bb::before {
    content: '✂   cut here   ✂';
    position: absolute; top: -0.6em; left: 50%; transform: translateX(-50%);
    background: #fff; padding: 0 6mm; font-size: 8pt; color: #999;
    white-space: nowrap; line-height: 1;
  }
`;

export function openBibsPreview() {
  const first = +document.getElementById('bib-first').value || 101;
  const count = +document.getElementById('bib-count').value || 899;
  if (first < 1 || count < 1 || first + count - 1 > 999) {
    showStatus(`Bib numbers must be 1–999 (range ${first}–${first + count - 1} is out of range).`, true);
    return;
  }
  openPopup({ title: 'Race Bibs', inlineCSS: CSS, html: buildHTML(first, count) });
}