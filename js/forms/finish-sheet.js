'use strict';

import { openPrintPreview } from './preview.js';

const BOXES = 15;
const PAGE_CSS = '@page { size: A4 portrait; margin: 0; }';
const LABEL1 = 'Bib Number (or clock, juniors, seniors, ignore)';
const LABEL2 = 'Event (blank or a time)';

const hf = `
  <div class="fs-hf">
    <span class="fs-label">${LABEL1}</span>
    <span class="fs-label">${LABEL2}</span>
  </div>`;

function generateFinishSheetHTML(limit) {
  const total = +limit || 200;
  const pages = Math.ceil((total + 1) / BOXES);
  let html = '';

  for (let p = 0; p < pages; p++) {
    const start = p * BOXES;
    let col1 = '', col2 = '';

    for (let i = 0; i < BOXES; i++) {
      const n = start + i;
      const label = (p === 0 && i === 0)
        ? `<span>${n}</span><span class="fs-clock">CLOCK</span>`
        : n;
      col1 += `<div class="fs-box">${label}</div>`;
      col2 += `<div class="fs-box">${n}</div>`;
    }

    html += `
      <div class="finish-sheet-page">
        ${hf}
        <div class="fs-cols">
          <div class="fs-col">${col1}</div>
          <div class="fs-col">${col2}</div>
        </div>
        ${hf}
      </div>`;
  }

  return html;
}

export function openFinishSheetPreview(limit, title) {
  openPrintPreview(generateFinishSheetHTML(limit), title, 'js/forms/finish-sheet.css', PAGE_CSS);
}