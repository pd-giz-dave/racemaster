'use strict';

import { state } from '../state.js';
import { escHtml, timeToSeconds, secondsToTime } from '../utils.js';

const SECONDS_PER_DAY = 86400;

/**
 * A runner's start offset depends only on their own predicted time and the event's target
 * time — never on any other entrant — so this can be computed and printed the moment a single
 * entry is saved, with no "generate all starts" batch step.
 *
 * Returns the start clock time: the offset (handicapTargetTime − predictedTime) added to
 * event.startTime, as a time-of-day, for a human to read against a clock/watch at the start line.
 */
export function computeHandicapStart(entry) {
  const offsetSecs = timeToSeconds(state.event.handicapTargetTime) - timeToSeconds(entry.predictedTime);
  const clockSecs  = (timeToSeconds(state.event.startTime) + offsetSecs + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  return secondsToTime(clockSecs);
}

export function buildStartSlipHTML(entry) {
  const startClockTime = computeHandicapStart(entry);
  const event = state.event;

  return `
    <div class="hss-slip">
      <div class="hss-header">
        <div class="hss-title">${escHtml(event.name || 'Handicap Race')}</div>
        <div class="hss-date">${escHtml(event.date || '')}</div>
      </div>
      <div class="hss-row"><span class="hss-lbl">Bib</span><span class="hss-val hss-bib">${escHtml(entry.bibNumber)}</span></div>
      <div class="hss-row"><span class="hss-lbl">Name</span><span class="hss-val">${escHtml(entry.name)}</span></div>
      <div class="hss-row"><span class="hss-lbl">Predicted</span><span class="hss-val">${escHtml(entry.predictedTime)}</span></div>
      <div class="hss-row hss-row-big"><span class="hss-lbl">START TIME</span><span class="hss-val hss-start-time">${escHtml(startClockTime)}</span></div>
      <div class="hss-footer">No watches permitted.</div>
    </div>
  `;
}

const WIDTH_MM = 80;

// Printed via a hidden iframe (not preview.js's openPopup, which opens a visible new window) —
// during live registration there's no time for a popup to flash up and be dismissed, so this
// goes straight to print() with nothing for the registration desk to interact with beyond
// whatever the browser's own print dialog itself requires. See ToDo.MD/plan notes: a fully
// silent, no-dialog print needs the browser launched with a silent-printing flag (e.g. Chrome's
// --kiosk-printing) — that's a one-time race-day browser/OS setup, not something this code can do.
export function openStartSlipPreview(entry) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const cleanup = () => iframe.remove();

  const doc  = iframe.contentDocument;
  const head = doc.head;

  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.appendChild(meta);

  const link = doc.createElement('link');
  link.rel  = 'stylesheet';
  link.href = location.origin + '/js/forms/handicap-start-slip.css';
  const cssLoaded = new Promise(resolve => {
    link.addEventListener('load',  resolve);
    link.addEventListener('error', resolve);
  });
  head.appendChild(link);

  const style = doc.createElement('style');
  style.textContent = `
    @page { size: ${WIDTH_MM}mm auto; margin: 0; }
    .hss-slip { width: ${WIDTH_MM}mm; padding: 3mm 3mm 3mm 1mm; box-sizing: border-box; }
  `;
  head.appendChild(style);

  doc.body.className = 'print-preview';
  doc.body.innerHTML = buildStartSlipHTML(entry);

  cssLoaded.then(() => {
    iframe.contentWindow.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 5000); // fallback in case afterprint doesn't fire
    iframe.contentWindow.print();
  });
}
