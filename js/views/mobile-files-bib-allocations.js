'use strict';

// Bib Allocations tab — small, self-contained, pure rendering. The "Send to Phone" click
// handler wired here only sets local UI state and shows a status toast; it never calls back
// into mobile-files.js's renderMobileFiles(), so — like mobile-files-devices.js — this stays a
// safe leaf module with no circular-import risk.

import { getIsAdmin } from '../storage.js';
import { showStatus, renderTable, tableColumns } from '../ui.js';
import { escHtml } from '../utils.js';
import { TABLES } from '../strings.js';
import { formatRaceDate } from '../mobile-files-shared.js';

// One row per race that has a bib-allocations.json (see js/bib-allocations.js) — races with
// none yet (nothing pushed, or none of this user's races have an event/entries set up) are
// simply omitted, same convention mobile-files-devices.js's flattenDevices() uses for a race
// with no devices.
let currentBibAllocRows = [];

// Race last actioned via "Send to Phone" — kept keyed (not just an index) so it survives a
// full re-render (Refresh, tab revisit) in the same slot, same idea as rowKey() for the
// Devices tab's own selection tracking. In-memory only; resets on page reload.
let lastSentKey = null;
function bibAllocKey(r) { return `${r.owner} ${r.raceLabel}`; }

// bib-allocations.json's contents (see js/bib-allocations.js) — the web app's own bib/name/
// course export for this race, not anything pulled from a phone.
function showBibAllocationsModal(owner, raceLabel, ba) {
  const sorted = [...ba.entries].sort((a, b) => a.bibNumber - b.bibNumber);
  const rows = sorted.map(e => `<tr><td>${e.bibNumber}</td><td>${escHtml(e.name)}</td><td>${escHtml(e.course)}</td></tr>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:520px">
      <h2>Bib Allocations — ${escHtml(raceLabel)}${getIsAdmin() ? ` (${escHtml(owner)})` : ''}</h2>
      <p style="margin:0 0 12px;font-size:0.875rem">Generated ${escHtml(ba.generatedAt || '')}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Bib</th><th>Name</th><th>Course</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" style="color:var(--muted)">No bib allocations.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="mobile-file-modal-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#mobile-file-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

export function renderBibAllocationsList(races, isAdminUser) {
  currentBibAllocRows = races
    .filter(r => r.bibAllocations)
    .map((r, idx) => ({ idx, owner: r.owner, raceLabel: r.raceLabel, raceDate: r.raceDate, ba: r.bibAllocations }));
  renderTable('bib-allocations-tbody', tableColumns(TABLES['bib-allocations'], {
    owner:       isAdminUser ? r => escHtml(r.owner) : undefined,
    raceLabel:   r => escHtml(r.raceLabel),
    raceDate:    r => formatRaceDate(r.raceDate),
    bibCount:    r => String(r.ba.entries.length),
    generatedAt: r => escHtml(r.ba.generatedAt || ''),
    actions:     () => `
      <button class="btn-sm" data-action="view">View</button>
      <button class="btn-sm" data-action="send">Send to Phone</button>`,
  }), currentBibAllocRows, {
    rowAttrs: r => ({ 'data-idx': r.idx, class: bibAllocKey(r) === lastSentKey ? 'row-editing' : '' }),
  });
}

export function wireBibAllocationsTab() {
  document.getElementById('bib-allocations-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const r = currentBibAllocRows[+btn.closest('[data-idx]')?.dataset.idx];
    if (!r) return;
    if (btn.dataset.action === 'view') showBibAllocationsModal(r.owner, r.raceLabel, r.ba);
    else if (btn.dataset.action === 'send') {
      lastSentKey = bibAllocKey(r);
      showStatus(`Send to phone: "bib-allocations.json" (${r.raceLabel}) — not yet implemented.`);
      // Immediate feedback rather than waiting for the next full re-render — same pattern the
      // Devices tab's own selection checkbox uses (see mobile-files.js's own change listener).
      document.querySelectorAll('#bib-allocations-tbody tr.row-editing').forEach(tr => tr.classList.remove('row-editing'));
      btn.closest('tr')?.classList.add('row-editing');
    }
  });
}
