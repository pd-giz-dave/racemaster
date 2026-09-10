'use strict';

// All Files tab — small, self-contained, pure rendering (mirrors mobile-files-bib-allocations.js's
// own leaf-module pattern: never calls back into mobile-files.js's renderMobileFiles(), so this
// stays a safe leaf module with no circular-import risk). Unlike the Devices and Bib Allocations
// tabs, this one deliberately does NOT go through filterStaleRaces()/mergePendingIntoRaces() —
// it's the one place every server-stored file (device or bib-allocations) is browsable and
// deletable regardless of age, with a stale one highlighted rather than hidden (see
// isDeviceStale()/isBibAllocationsStale() in mobile-files-shared.js for why that's per-file, not
// per-race, and deliberately allowed to disagree with the other tabs' own staleness filtering).
// Rows are sorted newest-first by their own last-activity date (see flattenAllFiles()'s own doc
// in mobile-files-devices.js) — that order is what a stale row's own "Delete from here" button
// (js/views/mobile-files.js's deleteFromHere()) means by "below it".

import { renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import {
  formatRaceDate, formatDateTime, formatStoredTimestamp, raceNameOf, isDeviceStale, isBibAllocationsStale,
} from '../mobile-files-shared.js';
import { formatCount, flattenAllFiles } from '../mobile-files-devices.js';

// Live-bound (reassigned here, not just mutated) — mobile-files.js's own click-delegation listener
// reads this directly by index, same convention as mobile-files-devices.js's own currentRows. Each
// row also carries its own precomputed `stale` boolean (see below) — mobile-files.js's own
// deleteFromHere() reads it directly rather than recomputing per row.
export let currentAllFilesRows = [];

export function renderAllFilesList(races, isAdminUser) {
  currentAllFilesRows = flattenAllFiles(races).map(r => ({
    ...r,
    stale: r.kind === 'bib-allocations' ? isBibAllocationsStale(r.raceLabel, r.ba) : isDeviceStale(r.raceLabel, r.device),
  }));
  renderTable('mobile-files-all-tbody', tableColumns(TABLES['mobile-files-all'], {
    owner:      isAdminUser ? r => escHtml(r.owner) : undefined,
    // Date suffix dropped from the visible text, same as the Devices/Bib Allocations tabs —
    // redundant with the Race Date column right next to it; full raceLabel stays in the tooltip.
    raceLabel:  r => `<span title="${escHtml(r.raceLabel)}">${escHtml(raceNameOf(r.raceLabel))}</span>`,
    raceDate:   r => formatRaceDate(r.raceDate),
    device:     r => r.kind === 'bib-allocations' ? 'Bib Allocations' : escHtml(r.device.name),
    location:   r => r.kind === 'bib-allocations' ? '' : `<span title="${escHtml(r.location)}">${escHtml(r.location)}</span>`,
    bibs:       r => formatCount(r.bibsVisible),
    time:       r => r.kind === 'bib-allocations' ? '' : formatCount(r.timeVisible),
    lastSeen:   r => r.kind === 'bib-allocations' ? '' : formatDateTime(r.lastSeen),
    lastUpdate: r => r.kind === 'bib-allocations' ? formatDateTime(r.lastUpdate, { seconds: true }) : formatStoredTimestamp(r.lastUpdate),
    // "Delete from here" only offered on an already-stale row — see this file's own top doc for
    // what "below it" means, and mobile-files.js's deleteFromHere() for the actual bulk delete.
    actions:    r => (r.kind === 'bib-allocations' ? `
      <button class="btn-sm" data-action="view">View</button>` : `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="raw">Raw</button>`)
      + `<button class="btn-sm btn-delete" data-action="delete">Delete</button>`
      + (r.stale ? `<button class="btn-sm btn-delete" data-action="delete-from-here">Delete from here</button>` : ''),
  }), currentAllFilesRows, {
    rowAttrs: r => ({ 'data-idx': r.idx, class: r.stale ? 'row-timing-target' : '' }),
  });
}
