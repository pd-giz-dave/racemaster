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

// Inlined rather than loaded via a <link> to an external .css file: a <link> fetch can fail
// silently offline (e.g. on a device that never picked up a service-worker update), printing
// the ticket with none of its type sizing — see ToDo.MD. Inlining removes that dependency
// entirely, matching the reliable pattern already used by js/forms/bibs.js.
const SLIP_CSS = `
  /* Handicap Start Slip — narrow / thermal receipt (8cm printer)
     All colours forced to black; thermal printers don't render greys well. */
  .hss-slip {
    font-size: 9pt;
    color: #000;
    font-family: Verdana, Geneva, sans-serif;
    font-weight: 700;
  }

  .hss-header {
    text-align: center;
    border-bottom: 0.5mm solid #000;
    margin-bottom: 1.5mm;
    padding-bottom: 1mm;
  }

  .hss-title { font-size: 11pt; font-weight: bold; color: #000; }
  .hss-date  { font-size: 8pt;  color: #000; margin-top: 0.3mm; }

  .hss-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 0.3mm dotted #000;
    padding: 1mm 0;
  }

  /* Flex items default to min-width:auto, so a long value (a long name, or the big start-time
     figure) could force the row wider than the slip instead of yielding to the label — exactly
     what was overflowing the printed page's right edge. Mirror prize-list.css's own narrow-print
     cells: the label never shrinks, the value does, with ellipsis if it still doesn't fit. */
  .hss-lbl { font-size: 8pt; flex-shrink: 0; }
  .hss-val {
    font-size: 10pt;
    text-align: right;
    min-width: 0;
    margin-left: 2mm;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .hss-bib { font-size: 14pt; }

  .hss-row-big {
    border-top: 0.5mm solid #000;
    border-bottom: 0.5mm solid #000;
    margin-top: 1.5mm;
    padding: 1.5mm 0;
  }
  .hss-row-big .hss-lbl { font-size: 9pt; }
  .hss-start-time { font-size: 20pt; }

  .hss-footer {
    margin-top: 2mm;
    font-size: 9pt;
    text-align: center;
    text-transform: uppercase;
  }
`;

const WIDTH_MM = 80;

// The thermal printer has a real ~3mm unprintable margin on the physical right edge of the
// paper. .hss-val's values are right-aligned (unlike the prize list's left-aligned table, which
// never puts ink that close to the edge and so never hit this), so they need an actual buffer
// past that unprintable zone, not just padding equal to it — 3mm of padding alone put the
// right-aligned text exactly on the boundary, with nothing to absorb any overshoot.
const RIGHT_EDGE_MM = 6;

// Printed via a hidden iframe (not preview.js's openPopup, which opens a visible new window) —
// during live registration there's no time for a popup to flash up and be dismissed, so this
// goes straight to print() with nothing for the registration desk to interact with beyond
// whatever the browser's own print dialog itself requires. See ToDo.MD/plan notes: a fully
// silent, no-dialog print needs the browser launched with a silent-printing flag (e.g. Chrome's
// --kiosk-printing) — that's a one-time race-day browser/OS setup, not something this code can do.
// (A right-edge print-margin bug was once chased by switching this to openPopup() instead —
// see ToDo.MD; that made things worse, a leftover window needing a manual close, and didn't even
// fix the margin. Reverted — the actual fix was RIGHT_EDGE_MM above, not the print mechanism.)
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

  const style = doc.createElement('style');
  style.textContent = `
    ${SLIP_CSS}
    @page { size: ${WIDTH_MM}mm auto; margin: 0; }
    .hss-slip { width: ${WIDTH_MM}mm; padding: 3mm ${RIGHT_EDGE_MM}mm 3mm 1mm; box-sizing: border-box; }
  `;
  head.appendChild(style);

  doc.body.className = 'print-preview';
  doc.body.innerHTML = buildStartSlipHTML(entry);

  iframe.contentWindow.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 5000); // fallback in case afterprint doesn't fire
  iframe.contentWindow.print();
}
