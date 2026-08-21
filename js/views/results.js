'use strict';

import { formatResults, computeAvgTop10, getSplitsRows } from '../results.js';
import { getCategoryProgress } from '../safety.js';
import { autoUpdateProgress } from './mobile-files.js';
import { state, saveEvent } from '../state.js';
import { on, showStatus, wireTabBar, showChoiceDialog, showInputDialog, sanitise, renderThead, renderTable, tableColumns, escHtml } from '../ui.js';
import { TABLES } from '../strings.js';
import { openPrizeListPreview } from '../forms';
import { downloadCSV } from '../storage.js';
import { CSV } from '../csv-schema.js';
import { publishResultsHTML, makePublishedUrl, buildSeniorsBodyHTML, buildJuniorsBodyHTML, buildPairsBodyHTML, buildHelpersBodyHTML, buildSplitsColumns, buildSplitsBodyHTML } from '../forms/results-html.js';
import { buildPrizeRowsHTML } from '../forms/prize-list.js';

let _seniors      = [];
let _juniors      = [];
let _prizes       = [];
let _pairsResults = [];
let _splitsRows   = [];
let _maxSplits    = 0;
let _cpNumbers    = [];

export async function renderResults() {
  // Silently re-runs Mobile Files' own Update Progress using whatever file selection was last
  // used for this event, but only when there's proof something genuinely changed since (see
  // autoUpdateProgress()'s own doc in mobile-files.js) — a no-op, no-network-call in the common
  // case (nothing new), so this doesn't turn opening this page into a background stall.
  await autoUpdateProgress();

  const { warnings, seniors, juniors, prizes, pairsResults, helpersReport } = formatResults();
  _seniors      = seniors;
  _juniors      = juniors;
  _prizes       = prizes;
  _pairsResults = pairsResults;

  renderResultsTable('results-senior-tbody', seniors);
  renderJuniorsTable('results-junior-tbody', juniors);
  renderProgressTable();

  // Pairs tab — visible only when there are pair entries
  const pairsBtn = document.getElementById('results-tab-pairs-btn');
  if (pairsBtn) pairsBtn.hidden = pairsResults.length === 0;
  renderThead('results-pairs-tbody', TABLES['results-pairs']);
  const pairsTbody = document.getElementById('results-pairs-tbody');
  if (pairsTbody) pairsTbody.innerHTML = buildPairsBodyHTML(pairsResults);

  // Splits tab — visible when SI results carry split times, or mobile checkpoint data exists
  const { maxSplits, cpNumbers, rows: splitsRows } = getSplitsRows(seniors, juniors);
  _splitsRows = splitsRows;
  _maxSplits  = maxSplits;
  _cpNumbers  = cpNumbers;
  renderSplitsTable(splitsRows, maxSplits, cpNumbers);

  const printBtn = document.getElementById('btn-print-prize-list');
  if (printBtn) printBtn.disabled = prizes.length === 0;

  const summary = document.getElementById('results-senior-summary');
  if (summary) {
    const avg = computeAvgTop10(seniors);
    const n   = Math.min(seniors.filter(r => r.position < 9999).length, 10);
    const avgPart = avg ? `Top ${n} average: ${avg} = 100% — %Ldrs shows each finisher's time relative to this average` : '';
    const recordPart = seniors.some(r => r.recordBreaker) ? 'R = course record' : '';
    summary.innerHTML = [avgPart, recordPart].filter(Boolean).join('<br>');
  }
  renderPrizes(prizes);
  renderHelpersReport(helpersReport);
  updateResultsButtons();
  return warnings;
}

function renderProgressTable() {
  renderTable('results-progress-tbody', tableColumns(TABLES['results-progress'], {
    category:    r => escHtml(r.category),
    entries:     r => String(r.entries),
    finished:    r => r.finished    ? String(r.finished)    : '',
    outstanding: r => r.outstanding ? String(r.outstanding) : '',
  }), getCategoryProgress());
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

function renderSplitsTable(rows, maxSplits, cpNumbers = []) {
  const splitsBtn = document.getElementById('results-tab-splits-btn');
  if (splitsBtn) splitsBtn.hidden = maxSplits === 0 && cpNumbers.length === 0;
  if (!maxSplits && !cpNumbers.length) return;

  renderThead('results-splits-tbody', buildSplitsColumns(maxSplits, cpNumbers));
  const tbody = document.getElementById('results-splits-tbody');
  if (tbody) tbody.innerHTML = buildSplitsBodyHTML(rows, maxSplits, cpNumbers);
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
  else if (tab === 'splits') exportDisabled = _splitsRows.length === 0;
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
  } else if (tab === 'splits') {
    // Split count varies by event (however many controls the SI course had, or how many
    // mobile checkpoints were used), so the column list is built here rather than in the
    // static CSV_SCHEMA — one cumulative/delta pair per SI control, one plain time per mobile
    // checkpoint (no leg-delta concept), flattened out of each row's splits/cpTimes.
    const fields = ['position', 'bibNumber', 'name', 'category'];
    for (let i = 1; i <= _maxSplits; i++) fields.push(`split${i}Cumulative`, `split${i}Delta`);
    for (const n of _cpNumbers) fields.push(`cp${n}Time`);
    fields.push('finishCumulative', 'finishDelta');
    const rows = _splitsRows.map(r => {
      const flat = { position: r.position, bibNumber: r.bibNumber, name: r.name, category: r.category };
      r.splits.forEach((s, i) => {
        flat[`split${i + 1}Cumulative`] = s.cumulative;
        flat[`split${i + 1}Delta`]      = s.delta;
      });
      for (const n of _cpNumbers) flat[`cp${n}Time`] = r.cpTimes?.[n] || '';
      flat.finishCumulative = r.finishTime.cumulative;
      flat.finishDelta      = r.finishTime.delta;
      return flat;
    });
    downloadCSV(`${eventName}-results-splits.csv`, rows, fields);
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
  const notes = await showInputDialog(
    'Notes to appear as a paragraph before the results on the published page (optional):',
    { defaultValue: state.event.notes || '', multiline: true, placeholder: 'e.g. course changes, sponsor thanks, weather notes…' }
  );
  if (notes === null) return;
  if (notes !== (state.event.notes || '')) {
    state.event.notes = notes;
    await saveEvent();
  }

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