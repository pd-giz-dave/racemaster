'use strict';

import { formatResults, computeAvgTop10 } from '../results.js';
import { state } from '../state.js';
import { on, showStatus, wireTabBar, showChoiceDialog, showInputDialog, sanitise, renderThead } from '../ui.js';
import { TABLES } from '../strings.js';
import { openPrizeListPreview } from '../forms';
import { downloadCSV } from '../storage.js';
import { CSV } from '../csv-schema.js';
import { publishResultsHTML, makePublishedUrl, buildSeniorsBodyHTML, buildJuniorsBodyHTML, buildPairsBodyHTML, buildHelpersBodyHTML } from '../forms/results-html.js';
import { buildPrizeRowsHTML } from '../forms/prize-list.js';

let _seniors      = [];
let _juniors      = [];
let _prizes       = [];
let _pairsResults = [];

export function renderResults() {
  const { warnings, seniors, juniors, prizes, pairsResults, helpersReport } = formatResults();
  _seniors      = seniors;
  _juniors      = juniors;
  _prizes       = prizes;
  _pairsResults = pairsResults;

  renderResultsTable('results-senior-tbody', seniors);
  renderJuniorsTable('results-junior-tbody', juniors);

  // Pairs tab — visible only when there are pair entries
  const pairsBtn = document.getElementById('results-tab-pairs-btn');
  if (pairsBtn) pairsBtn.hidden = pairsResults.length === 0;
  renderThead('results-pairs-tbody', TABLES['results-pairs']);
  const pairsTbody = document.getElementById('results-pairs-tbody');
  if (pairsTbody) pairsTbody.innerHTML = buildPairsBodyHTML(pairsResults);

  const printBtn = document.getElementById('btn-print-prize-list');
  if (printBtn) printBtn.disabled = prizes.length === 0;

  const summary = document.getElementById('results-senior-summary');
  if (summary) {
    const avg = computeAvgTop10(seniors);
    const n   = Math.min(seniors.filter(r => r.position < 9999).length, 10);
    const avgPart = avg ? `Top ${n} average: ${avg}` : '';
    summary.innerHTML = avgPart ? `${avgPart}<span style="margin-left:2em">R = course record</span>` : '';
  }
  renderPrizes(prizes);
  renderHelpersReport(helpersReport);
  updateResultsButtons();
  return warnings;
}

export function renderResultsTable(tbodyId, results) {
  renderThead(tbodyId, TABLES['results-senior']);
  const tbody = document.getElementById(tbodyId);
  if (tbody) tbody.innerHTML = buildSeniorsBodyHTML(results);
}

export function renderJuniorsTable(tbodyId, results) {
  renderThead(tbodyId, TABLES['results-junior']);
  const tbody = document.getElementById(tbodyId);
  if (tbody) tbody.innerHTML = buildJuniorsBodyHTML(results);
}

export function renderPrizes(prizes, tbodyId = 'prizes-tbody') {
  renderThead(tbodyId, TABLES.prizes);
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const hint = document.getElementById('prizes-hint');
  if (hint) hint.innerHTML = prizes.length
    ? `R = course record<span style="margin-left:2em">J = junior</span><span style="margin-left:2em">* = multi winner</span>`
    : '';
  tbody.innerHTML = buildPrizeRowsHTML(prizes);
}

export function renderHelpersReport(helpersReport) {
  renderThead('results-helpers-tbody', TABLES['results-helpers']);
  const tbody = document.getElementById('results-helpers-tbody');
  if (tbody) tbody.innerHTML = buildHelpersBodyHTML(helpersReport);
}

async function printPrizeList() {
  const choice = await showChoiceDialog('Select paper size for prize list:', [
    { label: 'A4 (210 mm)',             value: '210'    },
    { label: 'Thermal receipt (80 mm)', value: '80'     },
    { label: 'Custom width…',           value: 'custom' },
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

  const seniors = _seniors;
  const juniors = _juniors;

  let exportDisabled;
  if (tab === 'senior')      exportDisabled = seniors.length === 0;
  else if (tab === 'junior') exportDisabled = juniors.length === 0;
  else if (tab === 'pairs')  exportDisabled = _pairsResults.length === 0;
  else                       exportDisabled = true;

  const hasAnyResults = seniors.length > 0 || juniors.length > 0;

  if (exportBtn)  exportBtn.disabled  = exportDisabled;
  if (publishBtn) publishBtn.disabled = !hasAnyResults;
  void updateShowPublishedButton();
}

function exportResultsCSV() {
  const eventName = sanitise(state.event.name || 'event');
  const tab = activeResultsTab();
  if (tab === 'junior') {
    downloadCSV(`${eventName}-results-juniors.csv`, _juniors, CSV.results.juniors);
  } else if (tab === 'pairs') {
    const rows = _pairsResults.map(r => {
      const c2   = r.partner?.club;
      const club = c2 && c2 !== r.club ? `${r.club || ''} / ${c2}` : (r.club || '');
      const pg   = r.pairGender || '';
      return { ...r, partnerName: r.partner?.name || '', club, category: pg ? `${r.category || ''} ${pg}`.trim() : (r.category || '') };
    });
    downloadCSV(`${eventName}-results-pairs.csv`, rows, CSV.results.pairs);
  } else {
    downloadCSV(`${eventName}-results-seniors.csv`, _seniors, CSV.results.seniors);
  }
}

async function updateShowPublishedButton() {
  const btn   = document.getElementById('btn-show-embed-code');
  const field = document.getElementById('published-url-field');
  const wrap  = field?.closest('.published-url-wrap');
  const full  = `${window.location.origin}${makePublishedUrl()}`;
  try {
    const res = await fetch(makePublishedUrl(), { method: 'HEAD' });
    const ok  = res.ok;
    if (btn)  btn.disabled = !ok;
    if (field) field.value = ok ? full : '';
    if (wrap)  wrap.hidden = !ok;
  } catch {
    if (btn)  btn.disabled = true;
    if (field) field.value = '';
    if (wrap)  wrap.hidden = true;
  }
}

function showPublished() {
  window.open(`${window.location.origin}${makePublishedUrl()}`, '_blank');
  showStatus('Opened in new tab.');
}

async function publishResults() {
  showStatus('Publishing…');
  try {
    await publishResultsHTML();
  } catch (err) {
    showStatus(err.message, true);
    return;
  }
  const full = `${window.location.origin}${makePublishedUrl()}`;
  window.open(full, '_blank');
  showStatus('Published — opened in new tab.');
  void updateShowPublishedButton();
}

export function wireResults() {
  on('btn-print-prize-list',    'click', printPrizeList);
  on('btn-export-results-csv',  'click', exportResultsCSV);
  on('btn-publish-results',     'click', publishResults);
  on('btn-show-embed-code',     'click', showPublished);
  document.getElementById('published-url-field')?.addEventListener('click', async () => {
    const field = document.getElementById('published-url-field');
    if (!field?.value) return;
    try {
      await navigator.clipboard.writeText(field.value);
      showStatus('URL copied to clipboard.');
    } catch {
      field.select();
    }
  });
  wireTabBar('results-tab-bar', 'tab-results-', 'data-results-tab');
  document.getElementById('results-tab-bar')?.addEventListener('click', updateResultsButtons);
}