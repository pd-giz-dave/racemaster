'use strict';

import { state, loadAll, saveEvent, saveEntries, saveHelpers, saveFinishers, saveSafety, saveResults, savePrizes, EVENT_FIELDS } from './state.js';
import { openDirectory, restoreDirectory, hasFSA } from './storage.js';
import { COURSE, FINISHER, GENDER, FILE } from './constants.js';
import { today, normaliseDate, normaliseTime, iequal, showBusy, cleanName } from './utils.js';
import { calculateCategory, calculateCourse, getCategoriesForGender, getMaleCategories, getFemaleCategories, getPairCategories, applyFRAPreset, applyWFRAPreset } from './categories.js';
import { addPerson, addClub, sortPeople, sortClubs, getNextBibNumber, checkPeopleDuplicates } from './data.js';
import { getNumberOfEntries, findEntryByBib, getEntry, submitEntry, updateEntry, deleteEntry, retireEntry, getSortedEntries, loadPreEntries, getEntriesOnCourse } from './entries.js';
import { submitHelper, deleteHelper, getSortedHelpers, getRoles } from './helpers.js';
import { recordFinisher, deleteLastFinisher, scanFinishers, processFinishers, buildSafetyList, updateSafetyStatus, getOutstandingSafetyCount, getSortedFinishers, buildFinishNumbersMap } from './finishers.js';
import { importSIEntries, verifySIEntries, clearSIEntries, getSortedPreEntries, getPreEntryCount } from './si-entries.js';
import { importSIResults, verifySIResults, formatSIResults, exportSITimingCSV } from './si-results.js';
import { formatResults, buildPrizes, getResultsForCourse, getPrizes } from './results.js';
import { generateEntryFormHTML, generateFinishSheetHTML, generateNumberMatrixHTML, generateResultsHTML, generatePrizeListHTML, generateJuniorEntryFormHTML, openPrintPreview } from './forms.js';
import { adjustStartTime, validateFinishTime } from './time-utils.js';
import { mergeSIEntries } from './data.js';
import { saveCategories } from './state.js';
import { parseSICSV } from './csv.js';

// ============================================================
// Application bootstrap and UI wiring
// ============================================================

let currentView = 'home';

export async function init() {
  showBusy('Loading…');
  try {
    // Try to restore persisted directory handle
    const restored = await restoreDirectory();
    if (restored) {
      await loadAll();
      showStatus('Data loaded from ' + (state.event.name || 'event'));
    } else {
      showStatus('No data directory selected — click "Open Data Folder"');
    }
  } catch (e) {
    showStatus('Error loading data: ' + e.message, true);
  }

  wireNav();
  wireEvents();
  renderAll();
  showBusy('');
  showView('home');
}

// ---- Navigation ----

function wireNav() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      showView(el.dataset.view);
    });
  });
}

export function showView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.view').forEach(v => {
    v.hidden = v.id !== `view-${viewName}`;
  });
  document.querySelectorAll('[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName);
  });
  renderView(viewName);
}

// ---- Render dispatcher ----

function renderAll() {
  renderHome();
}

function renderView(v) {
  switch (v) {
    case 'home':         renderHome();         break;
    case 'event':        renderEvent();        break;
    case 'entries':      renderEntries();      break;
    case 'helpers':      renderHelpers();      break;
    case 'finishers':    renderFinishers();    break;
    case 'results':      renderResults();      break;
    case 'pre-entries':  renderPreEntries();   break;
    case 'safety':       renderSafety();       break;
    case 'people':       renderPeople();       break;
    case 'categories':   renderCategories();   break;
    case 'forms':        renderForms();        break;
    case 'si-results':   renderSIResults();    break;
  }
}

// ---- Home view ----

function renderHome() {
  const ev = state.event;
  setHTML('home-event-name',    ev.name || '(no event loaded)');
  setHTML('home-event-date',    ev.date || '');
  setHTML('home-entry-count',   getNumberOfEntries());
  setHTML('home-senior-count',  getEntriesOnCourse(COURSE.SENIORS));
  setHTML('home-junior-count',  getEntriesOnCourse(COURSE.JUNIORS));
  setHTML('home-safety-count',  getOutstandingSafetyCount());
}

// ---- Event settings view ----

function renderEvent() {
  const ev = state.event;
  fillForm('event-form', {
    'ev-name':            ev.name,
    'ev-date':            ev.date,
    'ev-distance':        ev.distance,
    'ev-start-time':      ev.startTime,
    'ev-first-bib':       ev.firstBibNumber,
    'ev-entry-limit':     ev.entryLimit,
    'ev-timing-method':   ev.timingMethod,
    'ev-junior-limit':    ev.juniorLimit,
    'ev-junior-timing':   ev.juniorTimingMethod,
    'ev-junior-limit-n':  ev.juniorEntryLimit,
    'ev-prize-overall':   ev.prizeDepthOverall,
    'ev-prize-per-cat':   ev.prizeDepthPerCategory,
    'ev-male-record':     ev.maleRecord,
    'ev-female-record':   ev.femaleRecord,
    'ev-sw-offset':       ev.stopwatchOffsetTime,
    'ev-sw-late':         ev.stopwatchLateStart,
    'ev-sw-start':        ev.stopwatchStartOffset,
    'ev-sw-jstart':       ev.juniorStopwatchStartOffset,
  });
}

// ---- Entries view ----

function renderEntries() {
  const entries = getSortedEntries();
  const tbody = document.getElementById('entries-tbody');
  if (!tbody) return;

  tbody.innerHTML = entries.map(e => `
    <tr data-bib="${e.bibNumber}">
      <td>${e.bibNumber}</td>
      <td>${e.name || ''}</td>
      <td>${e.club || ''}</td>
      <td>${e.gender || ''}</td>
      <td>${e.dob || ''}</td>
      <td>${e.category || ''}</td>
      <td>${e.course || ''}</td>
      <td>${e.dibberNumber || ''}</td>
      <td>${e.fraNumber || ''}</td>
      <td>${e.startTime || ''}</td>
      <td>${e.retired === 'Y' ? 'DNF' : ''}</td>
      <td>
        <button class="btn-sm btn-edit" data-bib="${e.bibNumber}">Edit</button>
        <button class="btn-sm btn-retire" data-bib="${e.bibNumber}">${e.retired === 'Y' ? 'Unretire' : 'Retire'}</button>
        <button class="btn-sm btn-delete-entry" data-bib="${e.bibNumber}">Del</button>
      </td>
    </tr>`).join('');

  // Wire row action buttons
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => openEntryEdit(+b.dataset.bib)));
  tbody.querySelectorAll('.btn-retire').forEach(b =>
    b.addEventListener('click', () => toggleRetire(+b.dataset.bib)));
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => confirmDeleteEntry(+b.dataset.bib)));

  setHTML('entry-count-display', `${entries.length} entries`);
  populateCategoryDropdown('entry-form-category', '');
  populateCategoryDropdown('entry-edit-category', '');
}

// ---- Helpers view ----

function renderHelpers() {
  const helpers = getSortedHelpers();
  const tbody = document.getElementById('helpers-tbody');
  if (!tbody) return;
  tbody.innerHTML = helpers.map(h => `
    <tr>
      <td>${h.number}</td>
      <td>${h.name || ''}</td>
      <td>${h.club || ''}</td>
      <td>${h.role || ''}</td>
      <td><button class="btn-sm btn-del-helper" data-num="${h.number}">Del</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-del-helper').forEach(b =>
    b.addEventListener('click', () => confirmDeleteHelper(+b.dataset.num)));
  setHTML('helper-count-display', `${helpers.length} helpers`);
}

// ---- Finishers view ----

function renderFinishers() {
  const seniors  = getSortedFinishers(COURSE.SENIORS);
  const juniors  = getSortedFinishers(COURSE.JUNIORS);

  renderFinisherTable('finishers-senior-tbody', seniors);
  renderFinisherTable('finishers-junior-tbody', juniors);
  setHTML('finisher-senior-count', seniors.length);
  setHTML('finisher-junior-count', juniors.length);
}

function renderFinisherTable(tbodyId, finishers) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = finishers.map((f, i) => `
    <tr class="${f.error ? 'row-error' : ''}">
      <td>${f.position || i+1}</td>
      <td>${f.time || ''}</td>
      <td>${f.adjustedTime || ''}</td>
      <td>${f.number || ''}</td>
      <td>${f.name || ''}</td>
      <td>${f.category || ''}</td>
      <td class="error-cell">${f.error || ''}</td>
    </tr>`).join('');
}

// ---- Results view ----

function renderResults() {
  const seniors = getResultsForCourse(COURSE.SENIORS);
  const juniors = getResultsForCourse(COURSE.JUNIORS);
  renderResultsTable('results-senior-tbody', seniors);
  renderResultsTable('results-junior-tbody', juniors);
}

function renderResultsTable(tbodyId, results) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = results.map(r => `
    <tr class="${r.prize ? 'row-prize' : ''}">
      <td>${r.position < 9999 ? r.position : 'DNF'}</td>
      <td>${r.time || ''}</td>
      <td>${r.name || ''}</td>
      <td>${r.club || ''}</td>
      <td>${r.category || ''}</td>
      <td>${r.inCatPos || ''}</td>
      <td>${r.behindTime || ''}</td>
      <td>${r.prize ? '★' : ''}</td>
    </tr>`).join('');
}

// ---- Pre-entries view ----

function renderPreEntries() {
  const preEntries = getSortedPreEntries();
  const tbody = document.getElementById('pre-entries-tbody');
  if (!tbody) return;
  tbody.innerHTML = preEntries.map(pe => {
    const name = cleanName(`${pe.firstName||''} ${pe.lastName||''}`.trim());
    return `<tr>
      <td>${pe.participantNumber || ''}</td>
      <td>${name}</td>
      <td>${pe.gender || ''}</td>
      <td>${pe.dob || ''}</td>
      <td>${pe.club || ''}</td>
      <td>${pe.category || ''}</td>
      <td>${pe.fraNumber || ''}</td>
    </tr>`;
  }).join('');
  setHTML('pre-entry-count', `${preEntries.length} pre-entries`);
}

// ---- Safety view ----

function renderSafety() {
  const tbody = document.getElementById('safety-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.safety.map(s => `
    <tr class="${s.status ? 'row-safe' : 'row-outstanding'}">
      <td>${s.number}</td>
      <td>${s.name || ''}</td>
      <td>${s.course || ''}</td>
      <td>${s.category || ''}</td>
      <td>${s.status || ''}</td>
      <td>${s.reason || ''}</td>
      <td>
        <button class="btn-sm btn-safe" data-bib="${s.number}">Safe</button>
        <button class="btn-sm btn-withdraw" data-bib="${s.number}">Withdrew</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-safe').forEach(b =>
    b.addEventListener('click', () => markSafe(+b.dataset.bib, 'Safe')));
  tbody.querySelectorAll('.btn-withdraw').forEach(b =>
    b.addEventListener('click', () => markSafe(+b.dataset.bib, 'Withdrew')));
  setHTML('safety-outstanding', getOutstandingSafetyCount() + ' outstanding');
}

// ---- People view ----

function renderPeople() {
  const tbody = document.getElementById('people-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.people.map((p, i) => `
    <tr>
      <td>${p.name || ''}</td>
      <td>${p.gender || ''}</td>
      <td>${p.dob || ''}</td>
      <td>${p.club || ''}</td>
      <td>${p.fraNumber || ''}</td>
      <td>${p.lastSeen || ''}</td>
      <td>${p.seenTotal || 0}</td>
    </tr>`).join('');
  setHTML('people-count', `${state.people.length} people`);
}

// ---- Categories view ----

function renderCategories() {
  const tbody = document.getElementById('categories-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.categories.map((c, i) => `
    <tr>
      <td>${c.maleMinAge}</td>
      <td>${c.maleCat}</td>
      <td>${c.maleRef}</td>
      <td>${c.maleMaxDist}</td>
      <td>${c.femaleMinAge}</td>
      <td>${c.femaleCat}</td>
      <td>${c.femaleRef}</td>
      <td>${c.femaleMaxDist}</td>
      <td>${c.pairCat}</td>
    </tr>`).join('');
}

// ---- SI Results view ----

function renderSIResults() {
  const tbody = document.getElementById('si-results-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.siResults.map(r => {
    const keys = Object.keys(r);
    return `<tr>${keys.map(k => `<td>${r[k] || ''}</td>`).join('')}</tr>`;
  }).join('');
  setHTML('si-results-count', `${state.siResults.length} SI results`);
}

// ---- Forms view ----

function renderForms() {
  // Static — buttons wired in wireEvents
}

// ---- Event wiring ----

function wireEvents() {
  // Directory open
  on('btn-open-dir', 'click', openDir);

  // Event form save
  on('btn-save-event', 'click', saveEventForm);

  // Category presets
  on('btn-apply-fra',  'click', applyCatPreset('FRA'));
  on('btn-apply-wfra', 'click', applyCatPreset('WFRA'));

  // Entry form submit
  on('btn-submit-entry', 'click', submitEntryForm);

  // Helper form submit
  on('btn-submit-helper', 'click', submitHelperForm);

  // Finisher form submit
  on('btn-record-finish-senior', 'click', () => recordFinishFromForm(COURSE.SENIORS));
  on('btn-record-finish-junior', 'click', () => recordFinishFromForm(COURSE.JUNIORS));
  on('btn-undo-senior', 'click', () => undoLastFinisher(COURSE.SENIORS));
  on('btn-undo-junior', 'click', () => undoLastFinisher(COURSE.JUNIORS));
  on('btn-scan-finishers',   'click', runScanFinishers);
  on('btn-process-finishers','click', runProcessFinishers);

  // Results
  on('btn-format-results', 'click', runFormatResults);
  on('btn-build-prizes',   'click', runBuildPrizes);

  // Safety
  on('btn-build-safety', 'click', runBuildSafety);

  // Pre-entries
  on('btn-import-si-entries', 'click', importSIEntriesFromFile);
  on('btn-verify-pre-entries','click', runVerifyPreEntries);
  on('btn-merge-pre-entries', 'click', runMergePreEntries);
  on('btn-load-pre-to-entries','click', runLoadPreEntries);
  on('btn-clear-pre-entries', 'click', runClearPreEntries);

  // SI Results
  on('btn-import-si-results', 'click', importSIResultsFromFile);
  on('btn-verify-si-results', 'click', runVerifySIResults);
  on('btn-format-si-results-senior', 'click', () => runFormatSIResults(COURSE.SENIORS));
  on('btn-format-si-results-junior', 'click', () => runFormatSIResults(COURSE.JUNIORS));

  // SI Timing export
  on('btn-export-si-timing', 'click', runExportSITiming);

  // Print forms
  on('btn-print-entry-form',   'click', () => openPrintPreview(generateEntryFormHTML(), 'Entry Form'));
  on('btn-print-junior-form',  'click', () => openPrintPreview(generateJuniorEntryFormHTML(), 'Junior Entry Form'));
  on('btn-print-finish-senior','click', () => openPrintPreview(generateFinishSheetHTML(COURSE.SENIORS), 'Finish Sheet (Seniors)'));
  on('btn-print-finish-junior','click', () => openPrintPreview(generateFinishSheetHTML(COURSE.JUNIORS), 'Finish Sheet (Juniors)'));
  on('btn-print-number-matrix','click', () => openPrintPreview(generateNumberMatrixHTML(), 'Number Matrix'));
  on('btn-print-results-senior','click',() => openPrintPreview(generateResultsHTML(COURSE.SENIORS), 'Results (Seniors)'));
  on('btn-print-results-junior','click',() => openPrintPreview(generateResultsHTML(COURSE.JUNIORS), 'Results (Juniors)'));
  on('btn-print-prizes',       'click', () => openPrintPreview(generatePrizeListHTML(), 'Prize List'));

  // Category auto-fill in entry form
  on('entry-form-dob',    'change', autoFillCategory);
  on('entry-form-gender', 'change', autoFillCategory);

  // Category edit modal close
  on('btn-close-entry-edit', 'click', closeEntryEdit);
  on('btn-save-entry-edit',  'click', saveEntryEdit);

  // Start time adjuster
  on('btn-adjust-start', 'click', runAdjustStart);
}

// ---- Action handlers ----

async function openDir() {
  showBusy('Opening folder…');
  try {
    await openDirectory();
    await loadAll();
    renderAll();
    showStatus('Data loaded.');
  } catch (e) {
    if (e.name !== 'AbortError') showStatus('Error: ' + e.message, true);
  }
  showBusy('');
}

async function saveEventForm() {
  const ev = state.event;
  ev.name             = val('ev-name');
  ev.date             = val('ev-date');
  ev.distance         = +val('ev-distance') || 0;
  ev.startTime        = val('ev-start-time');
  ev.firstBibNumber   = +val('ev-first-bib') || 1;
  ev.entryLimit       = +val('ev-entry-limit') || 200;
  ev.timingMethod     = val('ev-timing-method');
  ev.juniorLimit      = val('ev-junior-limit');
  ev.juniorTimingMethod = val('ev-junior-timing');
  ev.juniorEntryLimit = +val('ev-junior-limit-n') || 0;
  ev.prizeDepthOverall    = +val('ev-prize-overall') || 3;
  ev.prizeDepthPerCategory= +val('ev-prize-per-cat') || 3;
  ev.maleRecord       = val('ev-male-record');
  ev.femaleRecord     = val('ev-female-record');
  ev.stopwatchOffsetTime = val('ev-sw-offset');
  ev.stopwatchLateStart  = document.getElementById('ev-sw-late')?.checked || false;
  ev.stopwatchStartOffset= val('ev-sw-start');
  ev.juniorStopwatchStartOffset = val('ev-sw-jstart');

  await saveEvent();
  showStatus('Event saved.');
  renderHome();
}

function applyCatPreset(preset) {
  return async () => {
    if (preset === 'FRA') applyFRAPreset();
    else applyWFRAPreset();
    await saveCategories();
    renderCategories();
    showStatus(`${preset} categories applied.`);
  };
}

async function submitEntryForm() {
  const formData = {
    name:      val('entry-form-name'),
    gender:    val('entry-form-gender'),
    dob:       val('entry-form-dob'),
    club:      val('entry-form-club'),
    fraNumber: val('entry-form-fra'),
    category:  val('entry-form-category'),
    course:    val('entry-form-course'),
    preEntry:  val('entry-form-preentry'),
  };
  showBusy('Registering…');
  const result = await submitEntry(formData);
  showBusy('');
  if (result.error) {
    showStatus(result.error, true);
  } else {
    showStatus(`Bib ${result.bibNumber} registered.`);
    clearForm('entry-form-fields');
    renderEntries();
    renderHome();
  }
}

async function submitHelperForm() {
  const formData = {
    name:   val('helper-form-name'),
    gender: val('helper-form-gender'),
    dob:    val('helper-form-dob'),
    club:   val('helper-form-club'),
    role:   val('helper-form-role'),
  };
  showBusy('Adding helper…');
  const result = await submitHelper(formData);
  showBusy('');
  if (result.error) {
    showStatus(result.error, true);
  } else {
    showStatus(`Helper ${result.number} added.`);
    clearForm('helper-form-fields');
    renderHelpers();
  }
}

async function recordFinishFromForm(course) {
  const inputId  = course === COURSE.JUNIORS ? 'finish-bib-junior' : 'finish-bib-senior';
  const timeId   = course === COURSE.JUNIORS ? 'finish-time-junior': 'finish-time-senior';
  const actionId = course === COURSE.JUNIORS ? 'finish-action-junior':'finish-action-senior';

  const bib    = +val(inputId) || 0;
  const time   = val(timeId);
  const action = val(actionId) || FINISHER.NORMAL;

  const result = await recordFinisher(bib, time, course, action);
  if (result.error) showStatus(result.error, true);
  else showStatus(`Position ${result.position} recorded.`);

  // Clear bib input, advance focus
  const bibEl = document.getElementById(inputId);
  if (bibEl) { bibEl.value = ''; bibEl.focus(); }

  renderFinishers();
}

async function undoLastFinisher(course) {
  const result = await deleteLastFinisher(course);
  if (result.error) showStatus(result.error, true);
  else showStatus('Last finisher removed.');
  renderFinishers();
}

async function runScanFinishers() {
  showBusy('Scanning…');
  const errors = await scanFinishers();
  showBusy('');
  showStatus(errors.length ? `${errors.length} errors found` : 'Scan OK — no errors', errors.length > 0);
  renderFinishers();
}

async function runProcessFinishers() {
  showBusy('Processing…');
  await processFinishers();
  showBusy('');
  showStatus('Finishers processed.');
  renderFinishers();
}

async function runFormatResults() {
  showBusy('Formatting results…');
  await formatResults();
  showBusy('');
  showStatus('Results generated.');
  renderResults();
}

async function runBuildPrizes() {
  showBusy('Building prizes…');
  await buildPrizes();
  showBusy('');
  showStatus('Prize list generated.');
  renderResults();
}

async function runBuildSafety() {
  showBusy('Building safety list…');
  const list = await buildSafetyList();
  showBusy('');
  showStatus(`${list.length} outstanding on safety list.`);
  renderSafety();
}

async function markSafe(bib, status) {
  await updateSafetyStatus(bib, status, '');
  renderSafety();
  renderHome();
}

async function importSIEntriesFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  showBusy('Importing…');
  const result = await importSIEntries(text);
  showBusy('');
  if (result.errors.length) showStatus(result.errors.join('; '), true);
  else showStatus(`${result.added} added, ${result.updated} updated.`);
  renderPreEntries();
}

async function runVerifyPreEntries() {
  const issues = verifySIEntries();
  if (!issues.length) showStatus('Pre-entries OK — no issues found.');
  else showStatus(`${issues.length} issue(s): ` + issues.map(i => i.name + ': ' + i.issue).join('; '), true);
}

async function runMergePreEntries() {
  showBusy('Merging…');
  const result = await mergeSIEntries();
  showBusy('');
  showStatus(`People: +${result.peopleAdded}, Clubs: +${result.clubsAdded}`);
  renderPeople();
}

async function runLoadPreEntries() {
  showBusy('Loading pre-entries…');
  const result = await loadPreEntries();
  showBusy('');
  if (result.errors.length) showStatus(result.errors.join('; '), true);
  else showStatus(`${result.added} entries added, ${result.updated} updated.`);
  renderEntries();
  renderHome();
}

async function runClearPreEntries() {
  if (!confirm('Clear all pre-entries?')) return;
  await clearSIEntries();
  showStatus('Pre-entries cleared.');
  renderPreEntries();
}

async function importSIResultsFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  showBusy('Importing SI results…');
  const result = await importSIResults(text);
  showBusy('');
  if (result.errors.length) showStatus(result.errors.join('; '), true);
  else showStatus(`${result.imported} SI results imported.`);
  renderSIResults();
}

async function runVerifySIResults() {
  const issues = verifySIResults();
  if (!issues.length) showStatus('SI results OK — no issues found.');
  else showStatus(`${issues.length} issue(s): ` + issues.map(i => i.issue).join('; '), true);
}

async function runFormatSIResults(course) {
  showBusy('Formatting SI results…');
  const result = await formatSIResults(course);
  showBusy('');
  if (result.errors.length) showStatus(result.errors.join('; '), true);
  else showStatus(`${result.added} SI finishers merged for ${course}.`);
  renderFinishers();
}

async function runExportSITiming() {
  const { formatCSV } = await import('./csv.js');
  const { SI_TIMING_COL_NAMES } = await import('./constants.js');
  const rows = exportSITimingCSV(getSortedEntries());
  const csv  = formatCSV(rows, SI_TIMING_COL_NAMES);
  downloadText(csv, `${sanitise(state.event.name)}_SI_Timing.csv`);
  showStatus('SI timing file downloaded.');
}

function runAdjustStart() {
  const courseOrBib = val('adjust-start-course');
  const clockTime   = val('adjust-start-time');
  const result = adjustStartTime(courseOrBib, clockTime);
  if (result.error) showStatus(result.error, true);
  else {
    setHTML('adjust-start-result', result.startTime);
    showStatus(`Adjusted start time: ${result.startTime}`);
  }
}

function autoFillCategory() {
  const dob    = val('entry-form-dob');
  const gender = val('entry-form-gender');
  if (!dob || !gender) return;
  const cat = calculateCategory(dob, gender);
  if (cat) {
    const catEl = document.getElementById('entry-form-category');
    if (catEl) catEl.value = cat;
    const courseEl = document.getElementById('entry-form-course');
    if (courseEl) courseEl.value = calculateCourse(cat, dob);
  }
}

// ---- Entry edit modal ----

let editingBib = 0;

function openEntryEdit(bib) {
  editingBib = bib;
  const e = getEntry(bib);
  if (!e) return;
  fillForm('entry-edit-form', {
    'entry-edit-name':     e.name,
    'entry-edit-gender':   e.gender,
    'entry-edit-dob':      e.dob,
    'entry-edit-club':     e.club,
    'entry-edit-fra':      e.fraNumber,
    'entry-edit-category': e.category,
    'entry-edit-course':   e.course,
    'entry-edit-starttime':e.startTime,
    'entry-edit-dibber':   e.dibberNumber,
  });
  const modal = document.getElementById('entry-edit-modal');
  if (modal) modal.hidden = false;
}

function closeEntryEdit() {
  const modal = document.getElementById('entry-edit-modal');
  if (modal) modal.hidden = true;
}

async function saveEntryEdit() {
  const formData = {
    name:       val('entry-edit-name'),
    gender:     val('entry-edit-gender'),
    dob:        val('entry-edit-dob'),
    club:       val('entry-edit-club'),
    fraNumber:  val('entry-edit-fra'),
    category:   val('entry-edit-category'),
    course:     val('entry-edit-course'),
    startTime:  val('entry-edit-starttime'),
    dibberNumber: val('entry-edit-dibber'),
  };
  const result = await updateEntry(editingBib, formData);
  if (result.error) showStatus(result.error, true);
  else { showStatus(`Bib ${editingBib} updated.`); closeEntryEdit(); renderEntries(); }
}

async function toggleRetire(bib) {
  const e = getEntry(bib);
  if (!e) return;
  if (e.retired === 'Y') {
    const { unretireEntry } = await import('./entries.js');
    await unretireEntry(bib);
  } else {
    await retireEntry(bib);
  }
  renderEntries();
}

async function confirmDeleteEntry(bib) {
  if (!confirm(`Delete bib ${bib}?`)) return;
  const result = await deleteEntry(bib);
  if (result.error) showStatus(result.error, true);
  else { showStatus(`Bib ${bib} deleted.`); renderEntries(); renderHome(); }
}

async function confirmDeleteHelper(num) {
  if (!confirm(`Delete helper ${num}?`)) return;
  const result = await deleteHelper(num);
  if (result.error) showStatus(result.error, true);
  else { showStatus(`Helper ${num} deleted.`); renderHelpers(); }
}

// ---- Utility DOM helpers ----

function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

function val(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  return el.value || '';
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function fillForm(formId, data) {
  for (const [id, value] of Object.entries(data)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value !== undefined ? value : '';
  }
}

function clearForm(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('input,select,textarea').forEach(el => {
    if (el.type === 'checkbox') el.checked = false;
    else el.value = '';
  });
}

function populateCategoryDropdown(selectId, currentVal) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const all = [
    ...getMaleCategories().map(c => ({ value: c, label: c })),
    ...getFemaleCategories().map(c => ({ value: c, label: c })),
    ...getPairCategories().map(c => ({ value: c, label: c })),
  ];
  // Deduplicate
  const seen = new Set();
  const opts = all.filter(o => { if (seen.has(o.value)) return false; seen.add(o.value); return true; });
  el.innerHTML = `<option value="">— select —</option>` +
    opts.map(o => `<option value="${o.value}"${o.value === currentVal ? ' selected' : ''}>${o.label}</option>`).join('');
}

function showStatus(msg, isError = false) {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'status-error' : 'status-ok';
  // Auto-clear after 5s
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}

function confirm(msg) {
  return window.confirm(msg);
}

async function pickFile(accept = '*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      if (!input.files.length) { resolve(null); return; }
      const text = await input.files[0].text();
      resolve(text);
    };
    input.click();
  });
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function sanitise(name) {
  return (name || 'race').replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Boot
document.addEventListener('DOMContentLoaded', init);