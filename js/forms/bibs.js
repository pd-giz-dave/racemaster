'use strict';

import { openPopup } from './preview.js';
import { showStatus } from '../ui.js';

// Margin keeps the printer in its normal (fast) mode: a 0mm @page margin
// requests borderless printing, which many inkjets (e.g. Canon Pixma/TS
// series) only support via a slow, high-quality mode — tens of seconds per
// page instead of a couple. The margin sits at the outer page edges only,
// so the guillotine cut between the two stacked bibs still falls exactly
// on the physical half-page line.
const PAGE_W    = 210;
const PAGE_H    = 297;
const MARGIN    = 5;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const CONTENT_H = (PAGE_H - 2 * MARGIN) / 2;
const FONT_SIZE = CONTENT_H * (110 / 148.5);
const TEXT_Y    = CONTENT_H * (115 / 148.5);
const TEXT_LEN  = CONTENT_W * (180 / 210);

function bibSVG(n) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CONTENT_W} ${CONTENT_H}" style="display:block;width:${CONTENT_W}mm;height:${CONTENT_H}mm">` +
    `<text x="${CONTENT_W / 2}" y="${TEXT_Y}" text-anchor="middle" ` +
    `font-family="'Arial Black',Impact,Arial,sans-serif" font-weight="900" ` +
    `font-size="${FONT_SIZE}" textLength="${TEXT_LEN}" lengthAdjust="spacingAndGlyphs" ` +
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
  @page { size: A4 portrait; margin: ${MARGIN}mm; }
  body  { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
  .bp   { width: ${CONTENT_W}mm; height: ${CONTENT_H * 2}mm; break-after: page; page-break-after: always; }
  .bp:last-child { break-after: avoid; page-break-after: avoid; }
  .bh   { width: ${CONTENT_W}mm; height: ${CONTENT_H}mm; display: flex; align-items: center;
          justify-content: center; overflow: hidden; box-sizing: border-box; }
  .bb   { border-top: 1px dashed #999; position: relative; overflow: visible; }
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