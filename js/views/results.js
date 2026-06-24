'use strict';

import { formatResults, getResultsForCourse, computeAvgTop10, getPrizes } from '../results.js';
import { state } from '../state.js';
import { COURSE } from '../constants.js';
import { getCategoryPriority } from '../categories.js';
import { on, showStatus, wireTabBar, showChoiceDialog, showInputDialog, sanitise, renderTable, renderThead } from '../ui.js';
import { TABLES } from '../locale.js';
import { showBusy } from '../utils.js';
import { openPrizeListPreview } from '../forms';
import { downloadCSV } from '../storage.js';
import { publishResultsHTML } from '../forms/results-html.js';

const SENIOR_COLS = (() => {
  const m = TABLES['results-senior'];
  return [
    { ...m[0], render: r => r.course || '' },
    { ...m[1], render: r => r.bibNumber || '' },
    { ...m[2], render: r => r.position < 9999 ? r.position : 'DNF' },
    { ...m[3], render: r => r.inCatPos || '' },
    { ...m[4], render: r => r.name || '' },
    { ...m[5], render: r => r.club || '' },
    { ...m[6], render: r => r.category || '' },
    { ...m[7], render: r => (r.time || '') + (r.recordBreaker ? ' R' : '') },
    { ...m[8], render: r => r.pctLdrs ? r.pctLdrs + '%' : '' },
    { ...m[9], render: r => r.behindTime || '' },
  ];
})();

const HELPERS_COLS = (() => {
  const m = TABLES['results-helpers'];
  return [
    { ...m[0], render: h => h.role || '' },
    { ...m[1], render: h => h.name || '' },
    { ...m[2], render: h => h.club || '' },
    { ...m[3], render: h => h.cat || '' },
    { ...m[4], render: h => h.lastRaced || '' },
  ];
})();

export function renderResults() {
  const seniors = getResultsForCourse(COURSE.SENIORS);
  const juniors = getResultsForCourse(COURSE.JUNIORS);
  renderResultsTable('results-senior-tbody', seniors);
  renderJuniorsTable('results-junior-tbody', juniors);

  const printBtn = document.getElementById('btn-print-prize-list');
  if (printBtn) printBtn.disabled = getPrizes().length === 0;

  const summary = document.getElementById('results-senior-summary');
  if (summary) {
    const avg = computeAvgTop10(COURSE.SENIORS);
    const n   = Math.min(seniors.filter(r => r.position < 9999).length, 10);
    const avgPart = avg ? `Top ${n} average: ${avg}` : '';
    summary.innerHTML = avgPart ? `${avgPart}<span style="margin-left:2em">R = course record</span>` : '';
  }
  renderPrizes();
  renderHelpersReport();
  updateResultsButtons();
}

export function renderResultsTable(tbodyId, results) {
  renderTable(tbodyId, SENIOR_COLS, results);
}

export function renderJuniorsTable(tbodyId, results) {
  renderThead(tbodyId, TABLES['results-junior']);
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

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
  renderThead('prizes-tbody', TABLES.prizes);
  const tbody = document.getElementById('prizes-tbody');
  if (!tbody) return;

  const prizes = getPrizes();

  const hint = document.getElementById('prizes-hint');
  if (hint) hint.innerHTML = prizes.length
    ? `R = course record<span style="margin-left:2em">J = junior</span><span style="margin-left:2em">* = multi winner</span>`
    : '';

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

export function renderHelpersReport() {
  renderTable('results-helpers-tbody', HELPERS_COLS, state.helpersReport);
}

export async function runFormatResults() {
  showBusy('Formatting results…');
  const { warnings } = await formatResults();
  showBusy('');
  if (warnings.length) showStatus(`Results generated — ${warnings.length} clash(es): ${warnings.join('; ')}`, true);
  else showStatus('Results generated.');
  renderResults();
}

async function printPrizeList() {
  const choice = await showChoiceDialog('Select paper size for prize list:', [
    { label: 'A4 (210 mm)',          value: '210' },
    { label: 'Thermal receipt (80 mm)', value: '80'  },
    { label: 'Custom width…',        value: 'custom' },
  ]);
  if (!choice) return;

  let widthMm;
  if (choice === 'custom') {
    const raw = await showInputDialog('Enter paper width in mm:', { defaultValue: '80', placeholder: 'e.g. 80 for thermal, 210 for A4' });
    if (!raw) return;
    widthMm = parseFloat(raw);
    if (!(widthMm > 0)) { showStatus('Invalid paper width.', true); return; }
  } else {
    widthMm = parseFloat(choice);
  }

  openPrizeListPreview(widthMm);
}

function activeResultsTab() {
  return document.querySelector('#results-tab-bar [data-results-tab].active')?.dataset.resultsTab;
}

function updateResultsButtons() {
  const exportBtn  = document.getElementById('btn-export-results-csv');
  const publishBtn = document.getElementById('btn-publish-results');
  const tab = activeResultsTab();
  let disabled;
  if (tab === 'senior') {
    disabled = getResultsForCourse(COURSE.SENIORS).length === 0;
  } else if (tab === 'junior') {
    disabled = getResultsForCourse(COURSE.JUNIORS).length === 0;
  } else {
    disabled = true;
  }
  if (exportBtn)  exportBtn.disabled  = disabled;
  if (publishBtn) publishBtn.disabled = disabled;
}

function exportResultsCSV() {
  const eventName = sanitise(state.event.name || 'event');
  if (activeResultsTab() === 'junior') {
    downloadCSV(`${eventName}-results-juniors.csv`, getResultsForCourse(COURSE.JUNIORS),
      ['course', 'bibNumber', 'inCatPos', 'name', 'club', 'category', 'time']);
  } else {
    downloadCSV(`${eventName}-results-seniors.csv`, getResultsForCourse(COURSE.SENIORS),
      ['course', 'bibNumber', 'position', 'inCatPos', 'name', 'club', 'category', 'time', 'pctLdrs', 'behindTime']);
  }
}

// Last published iframe snippets keyed by type, persisted across dialog closes.
const publishedUrls = {};

function showEmbedCode() {
  const entries = Object.entries(publishedUrls);
  if (!entries.length) return;
  if (entries.length === 1) {
    void showInputDialog('Results URL for your website:', { defaultValue: entries[0][1], clipboard: true });
    return;
  }
  const labels = { combined: 'Single page', juniors: 'Juniors', seniors: 'Seniors', helpers: 'Helpers' };
  showChoiceDialog('Which results URL?', entries.map(([type]) => ({ label: labels[type], value: type })), { vertical: true })
    .then(choice => {
      if (choice) void showInputDialog('Results URL for your website:', { defaultValue: publishedUrls[choice], clipboard: true });
    });
}

async function publishResults() {
  const choice = await showChoiceDialog('Publish results to server', [
    { label: 'Single page (juniors + seniors + helpers)', value: 'combined' },
    { label: 'Juniors only',                              value: 'juniors'  },
    { label: 'Seniors only',                              value: 'seniors'  },
    { label: 'Helpers only',                              value: 'helpers'  },
  ], { vertical: true });
  if (!choice) return;
  showStatus('Publishing…');
  let url;
  try {
    url = await publishResultsHTML(choice);
  } catch (err) {
    showStatus(err.message, true);
    return;
  }
  const full = `${window.location.origin}${url}`;
  publishedUrls[choice] = full;
  document.getElementById('btn-show-embed-code').disabled = false;
  showStatus('Published.');
  await showInputDialog('Results URL — paste into your website CMS:', { defaultValue: full, clipboard: true });
}

export function wireResults() {
  on('btn-format-results',      'click', runFormatResults);
  on('btn-print-prize-list',    'click', printPrizeList);
  on('btn-export-results-csv',  'click', exportResultsCSV);
  on('btn-publish-results',     'click', publishResults);
  on('btn-show-embed-code',     'click', showEmbedCode);
  wireTabBar('results-tab-bar', 'tab-results-', 'data-results-tab');
  document.getElementById('results-tab-bar')?.addEventListener('click', updateResultsButtons);
}