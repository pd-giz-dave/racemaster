'use strict';

import { formatResults, getResultsForCourse, computeAvgTop10, getPrizes } from '../results.js';
import { COURSE } from '../constants.js';
import { getCategoryPriority } from '../categories.js';
import { on, showStatus } from '../ui.js';
import { showBusy } from '../utils.js';

export function renderResults() {
  const seniors = getResultsForCourse(COURSE.SENIORS);
  const juniors = getResultsForCourse(COURSE.JUNIORS);
  renderResultsTable('results-senior-tbody', seniors);
  renderJuniorsTable('results-junior-tbody', juniors);
  const summary = document.getElementById('results-senior-summary');
  if (summary) {
    const avg = computeAvgTop10(COURSE.SENIORS);
    const n   = Math.min(seniors.filter(r => r.position < 9999).length, 10);
    const avgPart = avg ? `Top ${n} average: ${avg}` : '';
    summary.innerHTML = avgPart ? `${avgPart}<span style="margin-left:2em">R = course record</span>` : '';
  }
  renderPrizes();
}

export function renderResultsTable(tbodyId, results) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = results.map(r => {
    const pos     = r.position < 9999 ? r.position : 'DNF';
    const timeStr = (r.time || '') + (r.recordBreaker ? ' R' : '');
    return `<tr>
      <td>${r.course || ''}</td>
      <td>${r.bibNumber || ''}</td>
      <td>${pos}</td>
      <td>${r.inCatPos || ''}</td>
      <td>${r.name || ''}</td>
      <td>${r.club || ''}</td>
      <td>${r.category || ''}</td>
      <td>${timeStr}</td>
      <td style="text-align:right">${r.pctLdrs ? r.pctLdrs + '%' : ''}</td>
      <td>${r.behindTime || ''}</td>
    </tr>`;
  }).join('');
}

export function renderJuniorsTable(tbodyId, results) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  // Group by category, sort categories youngest-first, within each by time
  const groups = new Map();
  for (const r of results) {
    const cat = r.category || '';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(r);
  }
  const sortedCats = [...groups.keys()].sort(
    (a, b) => getCategoryPriority(a) - getCategoryPriority(b)
  );
  for (const cat of sortedCats) {
    groups.get(cat).sort((a, b) => {
      if (a.position >= 9999 && b.position < 9999) return 1;
      if (a.position < 9999 && b.position >= 9999) return -1;
      return a.position - b.position;
    });
  }

  const rows = [];
  sortedCats.forEach((cat, i) => {
    if (i > 0) rows.push(`<tr class="results-cat-separator"><td colspan="7"></td></tr>`);
    for (const r of groups.get(cat)) {
      const timeStr = r.position < 9999 ? (r.time || '') : 'DNF';
      rows.push(`<tr>
        <td>${r.course || ''}</td>
        <td>${r.bibNumber || ''}</td>
        <td>${r.inCatPos || ''}</td>
        <td>${r.name || ''}</td>
        <td>${r.club || ''}</td>
        <td>${r.category || ''}</td>
        <td>${timeStr}</td>
      </tr>`);
    }
  });
  tbody.innerHTML = rows.join('');
}

export function renderPrizes() {
  const tbody = document.getElementById('prizes-tbody');
  if (!tbody) return;

  const prizes = getPrizes();

  const hint = document.getElementById('prizes-hint');
  if (hint) {
    hint.innerHTML = prizes.length
      ? `R = course record<span style="margin-left:2em">J = junior</span><span style="margin-left:2em">* = multi winner</span>`
      : '';
  }

  const overallSections = new Set(['Senior Overall', 'Senior Female Overall', 'Senior Male Overall']);
  let currentSection  = null;
  let currentCategory = null;
  const rows = [];
  for (const p of prizes) {
    if (p.section !== currentSection) {
      currentSection  = p.section;
      currentCategory = null;
      rows.push(`<tr class="results-cat-separator"><td colspan="5" style="padding:0.3em 0.5em;font-weight:bold">${p.section}</td></tr>`);
    } else if (p.category !== currentCategory) {
      rows.push(`<tr class="prizes-cat-sep"><td colspan="5"></td></tr>`);
    }
    currentCategory = p.category;
    const suffix    = p.isJunior ? ' J' : (p.recordBreaker ? ' R' : '');
    const showStar  = p.multiWinner && !overallSections.has(p.section);
    const name      = (showStar ? '* ' : '') + (p.name || '');
    rows.push(`<tr>
      <td>${p.position || ''}</td>
      <td>${p.category || ''}</td>
      <td>${p.inCatPos || ''}</td>
      <td>${(p.time || '') + suffix}</td>
      <td>${name}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('');
}

export async function runFormatResults() {
  showBusy('Formatting results…');
  const { warnings } = await formatResults();
  showBusy('');
  if (warnings.length) showStatus(`Results generated — ${warnings.length} clash(es): ${warnings.join('; ')}`, true);
  else showStatus('Results generated.');
  renderResults();
}

export function wireResults() {
  on('btn-format-results', 'click', runFormatResults);
}