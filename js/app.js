'use strict';

import { state, loadAll, saveEvent, saveEntries, saveHelpers, saveFinishers, saveSafety, saveResults, savePrizes, saveDibbers, EVENT_FIELDS } from './state.js';
import { openDirectory, restoreDirectory, hasFSA } from './storage.js';
import { COURSE, FINISHER, GENDER, FILE } from './constants.js';
import { today, normaliseDate, normaliseTime, iequal, showBusy, cleanName, capitalise } from './utils.js';
import { calculateCategory, calculateCourse, getCategoriesForGender, getMaleCategories, getFemaleCategories, getPairCategories, applyFRAPreset, applyWFRAPreset, resetFRAPreset, resetWFRAPreset } from './categories.js';
import { addPerson, addClub, sortPeople, sortClubs, getNextBibNumber, getNextDibberNumber, checkPeopleDuplicates } from './data.js';
import { getNumberOfEntries, findEntryByBib, findEntryByDibber, getEntry, submitEntry, updateEntry, deleteEntry, deleteEntriesFrom, retireEntry, getSortedEntries, loadPreEntries, getEntriesOnCourse } from './entries.js';
import { submitHelper, deleteHelper, getSortedHelpers, getRoles } from './helpers.js';
import { recordFinisher, deleteLastFinisher, updateFinisher, scanFinishers, processFinishers, buildSafetyList, updateSafetyStatus, getOutstandingSafetyCount, getSortedFinishers, buildFinishNumbersMap } from './finishers.js';
import { importSIEntries, verifySIEntries, clearSIEntries, getSortedPreEntries, getPreEntryCount } from './si-entries.js';
import { importSIResults, verifySIResults, formatSIResults, exportSITimingCSV } from './si-results.js';
import { formatResults, buildPrizes, getResultsForCourse, getPrizes } from './results.js';
import { generateEntryFormHTML, generateFinishSheetHTML, generateNumberMatrixHTML, generateResultsHTML, generatePrizeListHTML, generateJuniorEntryFormHTML, openPrintPreview } from './forms.js';
import { validateFinishTime, usingDibbers } from './time-utils.js';
import { mergeSIEntries } from './data.js';
import { saveCategories, saveFraPreset, saveWfraPreset } from './state.js';
import { parseSICSV } from './csv.js';

// ============================================================
// Application bootstrap and UI wiring
// ============================================================

let currentView = 'home';
let finisherCourse = COURSE.SENIORS;
let finisherPass   = 1;
let pass2Idx       = 0;

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
  updateDatalistNames();
  updateDatalistClubs();
}

function renderView(v) {
  switch (v) {
    case 'home':         renderHome();         break;
    case 'event':        renderEvent();        break;
    case 'entries':
      renderEntries();
      setTimeout(() => document.getElementById('entry-form-peno')?.focus(), 0);
      break;
    case 'helpers':      renderHelpers();      break;
    case 'finishers':
      if (finisherPass === 2) initPass2();
      renderFinishers();
      setTimeout(() => document.getElementById(finisherPass === 1 ? 'finish-bib-rapid' : 'finish-time-rapid')?.focus(), 0);
      break;
    case 'results':      renderResults();      break;
    case 'pre-entries':  renderPreEntries();   break;
    case 'safety':       renderSafety();       break;
    case 'people':       renderPeople();       break;
    case 'clubs':        renderClubs();        break;
    case 'dibbers':      renderDibbers();      break;
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
    'ev-name':               ev.name,
    'ev-date':               ev.date,
    'ev-distance':           ev.distance,
    'ev-start-time':         ev.startTime,
    'ev-categories':         ev.categories || 'FRA',
    'ev-first-bib':          ev.firstBibNumber,
    'ev-entry-limit':        ev.entryLimit,
    'ev-timing-method':      ev.timingMethod,
    'ev-junior-limit':       ev.juniorLimit,
    'ev-junior-timing':      ev.juniorTimingMethod,
    'ev-junior-limit-n':     ev.juniorEntryLimit,
    'ev-junior-start-time':  ev.juniorStartTime,
    'ev-prize-overall':      ev.prizeDepthOverall,
    'ev-prize-per-cat':      ev.prizeDepthPerCategory,
    'ev-male-record':        ev.maleRecord,
    'ev-female-record':      ev.femaleRecord,
    'ev-clear-previous':     false,
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
      <td>${e.preEntry || ''}</td>
      <td>${e.startTime || ''}</td>
      <td>${e.retired === 'Y' ? 'DNF' : ''}</td>
      <td>
        <button class="btn-sm btn-edit" data-bib="${e.bibNumber}">Edit</button>
      </td>
    </tr>`).join('');

  // Wire row action buttons
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => {
      const bib = +b.dataset.bib;
      const e = getEntry(bib);
      if (!e || !confirm(`Edit bib ${bib} (${e.name})?`)) return;
      fillFormForEdit(bib);
    }));

  setHTML('entry-count-display', `${entries.length} entries`);
  populateCategoryDropdown('entry-form-category', '');
  populateCategoryDropdown('entry-edit-category', '');
  updateDatalistNames();
  updateDatalistClubs();

  const bibEl = document.getElementById('entry-form-bib');
  if (bibEl && document.activeElement !== bibEl && !editingBib) bibEl.value = getNextBibNumber();
  const dibEl = document.getElementById('entry-form-dibber');
  if (dibEl && document.activeElement !== dibEl && !editingBib) updateDibberField();
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
  updateDatalistClubs();
}

// ---- Finishers view ----

function renderFinishers() {
  const seniors = getSortedFinishers(COURSE.SENIORS);
  const juniors = getSortedFinishers(COURSE.JUNIORS);
  const current = iequal(finisherCourse, COURSE.JUNIORS) ? juniors : seniors;

  setHTML('finisher-senior-count', seniors.length);
  setHTML('finisher-junior-count', juniors.length);
  setHTML('rapid-next-pos', current.length + 1);

  const tbody = document.getElementById('finishers-tbody');
  if (!tbody) return;
  tbody.innerHTML = current.map((f, i) => {
    const hilite = finisherPass === 2 && i === pass2Idx ? ' row-current' : '';
    return `<tr class="${f.error ? 'row-error' : ''}${hilite}">
      <td>${f.position || i+1}</td>
      <td>${f.time || ''}</td>
      <td>${f.adjustedTime || ''}</td>
      <td>${f.number || ''}</td>
      <td>${f.name || ''}</td>
      <td>${f.category || ''}</td>
      <td class="error-cell">${f.error || ''}</td>
    </tr>`;
  }).join('');

  if (finisherPass === 2) renderPass2();
}

function setFinisherCourse(course) {
  finisherCourse = course;
  const isSr = !iequal(course, COURSE.JUNIORS);
  document.getElementById('fcourse-senior')?.classList.toggle('active', isSr);
  document.getElementById('fcourse-junior')?.classList.toggle('active', !isSr);
  if (finisherPass === 2) initPass2();
  renderFinishers();
  document.getElementById(finisherPass === 1 ? 'finish-bib-rapid' : 'finish-time-rapid')?.focus();
}

function setFinisherPass(pass) {
  finisherPass = pass;
  document.getElementById('finisher-pass1').hidden = pass !== 1;
  document.getElementById('finisher-pass2').hidden = pass !== 2;
  document.getElementById('fpass-1')?.classList.toggle('active', pass === 1);
  document.getElementById('fpass-2')?.classList.toggle('active', pass === 2);
  if (pass === 2) initPass2();
  else document.getElementById('finish-bib-rapid')?.focus();
  renderFinishers();
}

function initPass2() {
  const finishers = getSortedFinishers(finisherCourse);
  pass2Idx = finishers.findIndex(f => !f.time);
  if (pass2Idx < 0) pass2Idx = Math.max(0, finishers.length - 1);
  renderPass2();
  const timeEl = document.getElementById('finish-time-rapid');
  if (timeEl) { timeEl.value = finishers[pass2Idx]?.time || ''; timeEl.focus(); timeEl.select(); }
}

function renderPass2() {
  const finishers = getSortedFinishers(finisherCourse);
  const f    = finishers[pass2Idx];
  const prev = pass2Idx > 0 ? finishers[pass2Idx - 1] : null;
  setHTML('pass2-pos',     f ? (f.position || pass2Idx + 1) : '—');
  setHTML('pass2-bib',     f ? (f.number || '?') : '—');
  setHTML('pass2-name',    f ? (f.name || '') : '');
  setHTML('pass2-inherit', prev?.time ? `prev: ${prev.time}` : '');
}

async function pass2AdvanceFinisher(inputValue) {
  const finishers = getSortedFinishers(finisherCourse);
  if (!finishers.length || pass2Idx >= finishers.length) { showStatus('No finishers to time.', true); return; }

  const f    = finishers[pass2Idx];
  const prev = pass2Idx > 0 ? finishers[pass2Idx - 1] : null;

  if (inputValue.trim()) {
    const parsedTime = parseFinishTime(inputValue.trim(), prev?.time);
    if (!parsedTime) { showStatus('Invalid time — use ss, mm:ss, or hh:mm:ss', true); return; }
    const stateIdx = state.finishers.indexOf(f);
    if (stateIdx >= 0) await updateFinisher(stateIdx, { time: parsedTime });
    showStatus(`Pos ${f.position || pass2Idx + 1}: ${parsedTime}`);
  }

  if (pass2Idx < finishers.length - 1) pass2Idx++;
  else showStatus('All finishers timed!');

  const timeEl = document.getElementById('finish-time-rapid');
  if (timeEl) timeEl.value = '';
  renderFinishers();
  document.getElementById('finish-time-rapid')?.focus();
}

function parseFinishTime(input, prevTimeStr) {
  const parts = input.split(/\D+/).filter(Boolean);
  if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let ih = 0, im = 0;
  if (prevTimeStr) {
    const norm = normaliseTime(prevTimeStr);
    if (norm) { const [ph, pm] = norm.split(':').map(Number); ih = ph; im = pm; }
  }
  let h, m, s;
  if (nums.length === 1)      { h = ih; m = im; s = nums[0]; }
  else if (nums.length === 2) { h = ih; m = nums[0]; s = nums[1]; }
  else                        { [h, m, s] = nums; }
  if (s > 59 || m > 59 || h > 23) return null;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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

// ---- Clubs view ----

function renderClubs() {
  const tbody = document.getElementById('clubs-tbody');
  if (!tbody) return;
  const sorted = [...state.clubs].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  tbody.innerHTML = sorted.map(c => `
    <tr>
      <td>${c.name || ''}</td>
      <td>${c.lastSeen || ''}</td>
      <td>${c.seenTotal || 0}</td>
    </tr>`).join('');
  setHTML('clubs-count', `${sorted.length} clubs`);
}

// ---- Dibbers view ----

function renderDibbers() {
  const tbody = document.getElementById('dibbers-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.dibbers.map((d, i) => `
    <tr id="dibber-row-${i}">
      <td>${d.shortCode || ''}</td>
      <td>${d.longCode  || ''}</td>
      <td>${d.availability || ''}</td>
      <td>${escHtml(d.notes || '')}</td>
      <td>
        <button class="btn-sm btn-edit"         data-idx="${i}">Edit</button>
        <button class="btn-sm btn-delete-entry" data-idx="${i}">Del from here</button>
      </td>
    </tr>`).join('');
  setHTML('dibbers-count', `${state.dibbers.length} dibbers`);
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editDibberRow(+b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => deleteDibbersFrom(+b.dataset.idx)));
}

function editDibberRow(idx) {
  const d = state.dibbers[idx];
  if (!d) return;
  const row = document.getElementById(`dibber-row-${idx}`);
  if (!row) return;
  row.innerHTML = `
    <td>${d.shortCode || ''}</td>
    <td><input id="dib-long-${idx}"  type="text" value="${escHtml(String(d.longCode || ''))}"    style="width:90px"></td>
    <td><input id="dib-avail-${idx}" type="text" value="${escHtml(d.availability || '')}"        style="width:80px"></td>
    <td><input id="dib-notes-${idx}" type="text" value="${escHtml(d.notes || '')}"               style="width:160px"></td>
    <td>
      <button class="btn-sm btn-safe"      data-idx="${idx}">Save</button>
      <button class="btn-sm btn-secondary" data-idx="${idx}">Cancel</button>
    </td>`;
  row.querySelector('.btn-safe').addEventListener('click', () => saveDibberRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderDibbers());
  document.getElementById(`dib-long-${idx}`)?.focus();
}

async function saveDibberRow(idx) {
  const d = state.dibbers[idx];
  if (!d) return;
  const longVal = document.getElementById(`dib-long-${idx}`)?.value.trim();
  if (longVal !== '' && !isNaN(+longVal)) {
    const clash = state.dibbers.findIndex(x => +x.longCode === +longVal);
    if (clash >= 0 && clash !== idx) {
      showStatus(`Long code ${longVal} already used by dibber ${state.dibbers[clash].shortCode}.`, true);
      return;
    }
    d.longCode = +longVal;
  }
  d.availability = document.getElementById(`dib-avail-${idx}`)?.value.trim() || '';
  d.notes        = document.getElementById(`dib-notes-${idx}`)?.value.trim() || '';
  await saveDibbers();
  showStatus(`Dibber ${d.shortCode} updated.`);
  renderDibbers();
}

function showAddDibberRow() {
  const tbody = document.getElementById('dibbers-tbody');
  if (!tbody) return;
  if (document.getElementById('dibber-row-new')) return; // already open
  const nextShort = state.dibbers.length
    ? Math.max(...state.dibbers.map(d => +d.shortCode)) + 1
    : 1;
  const tr = document.createElement('tr');
  tr.id = 'dibber-row-new';
  tr.innerHTML = `
    <td><input id="dib-new-short" type="text" value="${nextShort}" style="width:60px"></td>
    <td><input id="dib-new-long"  type="text" value=""             style="width:90px"></td>
    <td><input id="dib-new-avail" type="text" value=""             style="width:80px"></td>
    <td><input id="dib-new-notes" type="text" value=""             style="width:160px"></td>
    <td>
      <button class="btn-sm btn-safe">Save</button>
      <button class="btn-sm btn-secondary">Cancel</button>
    </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-safe').addEventListener('click', saveNewDibberRow);
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  setTimeout(() => {
    const shortInput = tr.querySelector('input');
    if (shortInput) {
      shortInput.scrollIntoView({ block: 'center' });
      shortInput.focus();
      shortInput.select();
    }
  }, 50);
}

async function saveNewDibberRow() {
  const short = document.getElementById('dib-new-short')?.value.trim();
  const long  = document.getElementById('dib-new-long')?.value.trim();
  if (!short || isNaN(+short)) { showStatus('Short code is required.', true); return; }
  if (!long  || isNaN(+long))  { showStatus('Long code is required.',  true); return; }
  if (state.dibbers.find(d => +d.shortCode === +short)) {
    showStatus(`Short code ${short} already exists.`, true); return;
  }
  if (state.dibbers.find(d => +d.longCode === +long)) {
    showStatus(`Long code ${long} already exists.`, true); return;
  }
  const avail = document.getElementById('dib-new-avail')?.value.trim() || '';
  const notes = document.getElementById('dib-new-notes')?.value.trim() || '';
  state.dibbers.push({ shortCode: +short, longCode: +long, availability: avail, notes });
  state.dibbers.sort((a, b) => +a.shortCode - +b.shortCode);
  await saveDibbers();
  showStatus(`Dibber ${short} added.`);
  renderDibbers();
}

async function deleteDibbersFrom(idx) {
  const from = state.dibbers[idx];
  if (!from) return;
  const count = state.dibbers.length - idx;
  if (!confirm(`Delete ${count} dibber${count === 1 ? '' : 's'} from short code ${from.shortCode} onwards?`)) return;
  state.dibbers.splice(idx);
  await saveDibbers();
  showStatus(`${count} dibber${count === 1 ? '' : 's'} deleted.`);
  renderDibbers();
}

// ---- Categories view ----

const CAT_EDIT_FIELDS = [
  'maleMinAge','maleCat','maleRef','maleMaxDist',
  'femaleMinAge','femaleCat','femaleRef','femaleMaxDist',
  'pairMinAge','pairCat','pairRef','pairMaxDist',
];
const CAT_EDIT_WIDTHS = ['46px','60px','46px','52px','46px','60px','46px','52px','46px','60px','46px','52px'];

// Config for each of the three category tables
const CAT_TABLE = {
  active: { tbodyId: 'categories-tbody', getArr: () => state.categories, saveFn: saveCategories,  label: 'category' },
  fra:    { tbodyId: 'fra-preset-tbody', getArr: () => state.fraPreset,  saveFn: saveFraPreset,   label: 'FRA preset' },
  wfra:   { tbodyId: 'wfra-preset-tbody',getArr: () => state.wfraPreset, saveFn: saveWfraPreset,  label: 'WFRA preset' },
};

function renderCategories() {
  renderCategoryTable('active');
  renderCategoryTable('fra');
  renderCategoryTable('wfra');
}

function renderCategoryTable(key) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const arr = cfg.getArr();
  const tbody = document.getElementById(cfg.tbodyId);
  if (!tbody) return;
  tbody.innerHTML = arr.map((c, i) => `
    <tr id="${key}-cat-row-${i}">
      ${CAT_EDIT_FIELDS.map(f => `<td>${c[f] ?? ''}</td>`).join('')}
      <td>
        <button class="btn-sm btn-edit"         data-key="${key}" data-idx="${i}">Edit</button>
        <button class="btn-sm btn-delete-entry" data-key="${key}" data-idx="${i}">Del</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editCategoryRow(b.dataset.key, +b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => deleteCategoryRow(b.dataset.key, +b.dataset.idx)));
}

function editCategoryRow(key, idx) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const c = cfg.getArr()[idx];
  if (!c) return;
  const row = document.getElementById(`${key}-cat-row-${idx}`);
  if (!row) return;
  row.innerHTML = CAT_EDIT_FIELDS.map((f, i) =>
    `<td><input id="${key}-cat-${idx}-${f}" type="text" value="${escHtml(String(c[f] ?? ''))}" style="width:${CAT_EDIT_WIDTHS[i]}"></td>`
  ).join('') + `<td>
    <button class="btn-sm btn-safe">Save</button>
    <button class="btn-sm btn-secondary">Cancel</button>
  </td>`;
  row.querySelector('.btn-safe').addEventListener('click', () => saveCategoryRow(key, idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderCategoryTable(key));
  document.getElementById(`${key}-cat-${idx}-maleMinAge`)?.focus();
}

async function saveCategoryRow(key, idx) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const c = cfg.getArr()[idx];
  if (!c) return;
  for (const f of CAT_EDIT_FIELDS) {
    const v = document.getElementById(`${key}-cat-${idx}-${f}`)?.value.trim() ?? '';
    c[f] = (f.includes('Age') || f.includes('Dist')) ? (+v === +v ? +v : c[f]) : v;
  }
  await cfg.saveFn();
  showStatus(`${cfg.label} row ${idx + 1} saved.`);
  renderCategoryTable(key);
}

async function deleteCategoryRow(key, idx) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const arr = cfg.getArr();
  if (!confirm(`Delete ${cfg.label} row ${idx + 1} (${arr[idx]?.maleCat || ''})?`)) return;
  arr.splice(idx, 1);
  await cfg.saveFn();
  showStatus(`${cfg.label} row deleted.`);
  renderCategoryTable(key);
}

function showAddCategoryRow(key) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const tbody = document.getElementById(cfg.tbodyId);
  if (!tbody || document.getElementById(`${key}-cat-row-new`)) return;
  const tr = document.createElement('tr');
  tr.id = `${key}-cat-row-new`;
  tr.innerHTML = CAT_EDIT_FIELDS.map((f, i) =>
    `<td><input id="${key}-cat-new-${f}" type="text" value="" style="width:${CAT_EDIT_WIDTHS[i]}"></td>`
  ).join('') + `<td>
    <button class="btn-sm btn-safe">Save</button>
    <button class="btn-sm btn-secondary">Cancel</button>
  </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-safe').addEventListener('click', () => saveNewCategoryRow(key));
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  tr.querySelector('input')?.focus();
}

async function saveNewCategoryRow(key) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const row = {};
  for (const f of CAT_EDIT_FIELDS) {
    const v = document.getElementById(`${key}-cat-new-${f}`)?.value.trim() || '';
    row[f] = (f.includes('Age') || f.includes('Dist')) ? +v || 0 : v;
  }
  cfg.getArr().push(row);
  await cfg.saveFn();
  showStatus(`${cfg.label} row added.`);
  renderCategoryTable(key);
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

  // Finisher course / pass selection
  on('fcourse-senior', 'click', () => setFinisherCourse(COURSE.SENIORS));
  on('fcourse-junior', 'click', () => setFinisherCourse(COURSE.JUNIORS));
  on('fpass-1', 'click', () => setFinisherPass(1));
  on('fpass-2', 'click', () => setFinisherPass(2));
  on('btn-undo-rapid',        'click', () => undoLastFinisher());
  on('btn-scan-finishers',    'click', runScanFinishers);
  on('btn-process-finishers', 'click', runProcessFinishers);

  // Pass 1: bib entry keyboard handler
  const bibInput = document.getElementById('finish-bib-rapid');
  if (bibInput) {
    bibInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const bib = parseInt(bibInput.value, 10);
        if (bib > 0) {
          const result = await recordFinisher(bib, '', finisherCourse, FINISHER.NORMAL);
          if (result.error) showStatus(result.error, true);
          else showStatus(`Pos ${result.position}: Bib ${bib}`);
          bibInput.value = '';
          renderFinishers();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        await undoLastFinisher();
      }
    });
  }

  // Pass 2: time entry keyboard handler
  const timeInput = document.getElementById('finish-time-rapid');
  if (timeInput) {
    timeInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await pass2AdvanceFinisher(timeInput.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (pass2Idx > 0) {
          pass2Idx--;
          timeInput.value = getSortedFinishers(finisherCourse)[pass2Idx]?.time || '';
          renderFinishers();
          timeInput.focus();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const fs = getSortedFinishers(finisherCourse);
        if (pass2Idx < fs.length - 1) {
          pass2Idx++;
          timeInput.value = fs[pass2Idx]?.time || '';
          renderFinishers();
          timeInput.focus();
        }
      }
    });
  }

  // Results
  on('btn-format-results', 'click', runFormatResults);
  on('btn-build-prizes',   'click', runBuildPrizes);

  // Safety
  on('btn-build-safety', 'click', runBuildSafety);

  // Pre-entries
  on('btn-import-si-entries',  'click', importSIEntriesFromFile);
  on('btn-load-pre-to-entries','click', runLoadPreEntries);
  on('btn-clear-pre-entries', 'click', runClearPreEntries);

  // SI Results
  on('btn-import-si-results', 'click', importSIResultsFromFile);
  on('btn-verify-si-results', 'click', runVerifySIResults);
  on('btn-format-si-results-senior', 'click', () => runFormatSIResults(COURSE.SENIORS));
  on('btn-format-si-results-junior', 'click', () => runFormatSIResults(COURSE.JUNIORS));

  on('btn-import-dibbers', 'click', importDibbersFromFile);
  on('btn-add-dibber',    'click', showAddDibberRow);

  // Category tabs
  document.querySelectorAll('#cat-tab-bar [data-cat-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cat-tab-bar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('#view-categories .tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`cat-tab-${btn.dataset.catTab}`)?.classList.add('active');
    });
  });

  on('btn-add-category',  'click', () => showAddCategoryRow('active'));
  on('btn-add-fra-row',   'click', () => showAddCategoryRow('fra'));
  on('btn-add-wfra-row',  'click', () => showAddCategoryRow('wfra'));

  on('btn-reset-fra', 'click', async () => {
    if (!confirm('Reset FRA preset to built-in defaults? Any customisations will be lost.')) return;
    resetFRAPreset();
    await saveFraPreset();
    showStatus('FRA preset reset to built-in defaults.');
    renderCategoryTable('fra');
  });
  on('btn-reset-wfra', 'click', async () => {
    if (!confirm('Reset WFRA preset to built-in defaults? Any customisations will be lost.')) return;
    resetWFRAPreset();
    await saveWfraPreset();
    showStatus('WFRA preset reset to built-in defaults.');
    renderCategoryTable('wfra');
  });

  // SI Timing export (entries view + SI results view)
  on('btn-export-si-timing',    'click', runExportSITiming);
  on('btn-export-entries-si',   'click', runExportSITiming);

  // Print forms
  on('btn-print-entry-form',   'click', () => openPrintPreview(generateEntryFormHTML(), 'Entry Form'));
  on('btn-print-junior-form',  'click', () => openPrintPreview(generateJuniorEntryFormHTML(), 'Junior Entry Form'));
  on('btn-print-finish-senior','click', () => openPrintPreview(generateFinishSheetHTML(COURSE.SENIORS), 'Finish Sheet (Seniors)'));
  on('btn-print-finish-junior','click', () => openPrintPreview(generateFinishSheetHTML(COURSE.JUNIORS), 'Finish Sheet (Juniors)'));
  on('btn-print-number-matrix','click', () => openPrintPreview(generateNumberMatrixHTML(), 'Number Matrix'));
  on('btn-print-results-senior','click',() => openPrintPreview(generateResultsHTML(COURSE.SENIORS), 'Results (Seniors)'));
  on('btn-print-results-junior','click',() => openPrintPreview(generateResultsHTML(COURSE.JUNIORS), 'Results (Juniors)'));
  on('btn-print-prizes',       'click', () => openPrintPreview(generatePrizeListHTML(), 'Prize List'));

  // Pre-entry number field: redirect to name on first letter, else lookup pre-entry
  const penoEl = document.getElementById('entry-form-peno');
  if (penoEl) {
    penoEl.addEventListener('keydown', e => {
      // If nothing typed yet and a letter key is pressed, jump to name field with that char
      if (penoEl.value === '' && e.key.length === 1 && /[a-zA-Z]/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const nameField = document.getElementById('entry-form-name');
        if (nameField) { nameField.value = e.key; nameField.focus(); }
      }
    });
    penoEl.addEventListener('change', () => {
      const num = penoEl.value.trim();
      if (!num || !/^\d+$/.test(num)) return;
      const pe = state.preEntries.find(p => String(p.participantNumber).trim() === num);
      if (!pe) return;
      const name = cleanName(`${pe.firstName || ''} ${pe.lastName || ''}`.trim());
      const g = (pe.gender || '').toUpperCase().trim();
      const gender = (g === 'M' || g === 'MALE')   ? 'M'
                   : (g === 'F' || g === 'FEMALE') ? 'F'
                   : (g === 'P' || g === 'PAIR')   ? 'P'
                   : '';
      fillForm('', {
        'entry-form-name':     name,
        'entry-form-gender':   gender,
        'entry-form-dob':      pe.dob        || '',
        'entry-form-club':     pe.club       || '',
        'entry-form-fra':      pe.fraNumber  || '',
      });
      autoFillCategory();
    });
  }

  // Auto-populate entry form from people database when a name is selected
  const nameEl = document.getElementById('entry-form-name');
  if (nameEl) {
    const populateFromPeople = () => {
      const name = nameEl.value.trim();
      const person = name ? state.people.find(p => iequal(p.name, name)) : null;
      if (!person) return;
      // People may store gender as full word ('Male','Female','Pair') or single char (M/F/P)
      const g = (person.gender || '').toUpperCase().trim();
      const gender = (g === 'M' || g === 'MALE')   ? 'M'
                   : (g === 'F' || g === 'FEMALE') ? 'F'
                   : (g === 'P' || g === 'PAIR')   ? 'P'
                   : '';
      fillForm('', {
        'entry-form-gender': gender,
        'entry-form-dob':    person.dob       || '',
        'entry-form-club':   person.club      || '',
        'entry-form-fra':    person.fraNumber || '',
      });
      autoFillCategory();
    };
    nameEl.addEventListener('change', populateFromPeople);
    nameEl.addEventListener('input',  populateFromPeople);
  }

  // Auto-capitalise name and club fields as the user types
  for (const id of ['entry-form-name', 'entry-form-club']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input', () => {
      const s = el.selectionStart, e = el.selectionEnd;
      el.value = capitalise(el.value);
      el.setSelectionRange(s, e);
    });
  }

  // Category auto-fill in entry form
  on('entry-form-dob',    'change', autoFillCategory);
  on('entry-form-gender', 'change', autoFillCategory);
  on('entry-form-course', 'change', updateDibberField);

  // Entry form keyboard handling: Enter=submit, Esc=home if clean, Tab=wrap focus
  const formContainer = document.getElementById('entry-form-fields');
  if (formContainer) {
    formContainer.addEventListener('keydown', async e => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        await submitEntryForm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (!isEntryFormDirty()) showView('home');
      } else if (e.key === 'Tab') {
        const focusable = [...formContainer.querySelectorAll(
          'input:not([disabled]), select:not([disabled]), button:not([disabled])'
        )];
        if (!focusable.length) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });
  }

  on('btn-cancel-edit', 'click', () => {
    resetEntryForm();
    document.getElementById('entry-form-peno')?.focus();
  });

  on('btn-reset-entry', 'click', () => {
    resetEntryForm();
    document.getElementById('entry-form-peno')?.focus();
  });

  on('btn-clear-from', 'click', async () => {
    const fromBib = +document.getElementById('entry-form-bib')?.value;
    if (!fromBib || fromBib <= 0) { showStatus('Enter a bib number first.', true); return; }
    const affected = getSortedEntries().filter(e => +e.bibNumber >= fromBib).length;
    if (!affected) { showStatus(`No entries from bib ${fromBib} onwards.`, true); return; }
    if (!confirm(`Delete ${affected} entr${affected === 1 ? 'y' : 'ies'} from bib ${fromBib} onwards?`)) return;
    showBusy('Deleting…');
    const removed = await deleteEntriesFrom(fromBib);
    showBusy('');
    showStatus(`${removed} entr${removed === 1 ? 'y' : 'ies'} deleted.`);
    resetEntryForm();
    renderEntries();
    renderHome();
  });

  // Category edit modal close
  on('btn-close-entry-edit', 'click', closeEntryEdit);
  on('btn-save-entry-edit',  'click', saveEntryEdit);

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
  const newName       = val('ev-name');
  const newCategories = val('ev-categories');
  const doClear       = document.getElementById('ev-clear-previous')?.checked || false;
  const oldCategories = ev.categories || 'FRA';

  // Build confirmation message
  const lines = [`Save settings for "${newName || '(unnamed event)'}"?`];

  if (newCategories !== oldCategories) {
    lines.push(`\nCategories will change from ${oldCategories} to ${newCategories} — active categories will be updated.`);
  }

  if (doClear) {
    const counts = [
      ['Entries',     state.entries.length],
      ['Pre-entries', state.preEntries.length],
      ['Finishers',   state.finishers.length],
      ['Results',     state.results.length],
      ['Prizes',      state.prizes.length],
      ['Helpers',     state.helpers.length],
    ].filter(([, n]) => n > 0);
    if (counts.length) {
      lines.push('\nThe following will be permanently cleared:');
      counts.forEach(([label, n]) => lines.push(`  • ${label}: ${n}`));
      lines.push('\nThis cannot be undone.');
    }
  }

  if (!confirm(lines.join('\n'))) return;

  // Apply fields
  ev.name                       = newName;
  ev.categories                 = newCategories;
  ev.date                       = val('ev-date');
  ev.distance                   = +val('ev-distance') || 0;
  ev.startTime                  = val('ev-start-time');
  ev.juniorStartTime            = val('ev-junior-start-time');
  ev.firstBibNumber             = +val('ev-first-bib') || 1;
  ev.entryLimit                 = +val('ev-entry-limit') || 200;
  ev.timingMethod               = val('ev-timing-method');
  ev.juniorLimit                = val('ev-junior-limit');
  ev.juniorTimingMethod         = val('ev-junior-timing');
  ev.juniorEntryLimit           = +val('ev-junior-limit-n') || 0;
  ev.prizeDepthOverall          = +val('ev-prize-overall') || 3;
  ev.prizeDepthPerCategory      = +val('ev-prize-per-cat') || 3;
  ev.maleRecord                 = val('ev-male-record');
  ev.femaleRecord               = val('ev-female-record');

  showBusy('Saving…');

  // Apply category preset if changed
  if (newCategories !== oldCategories) {
    if (newCategories === 'WFRA') applyWFRAPreset();
    else applyFRAPreset();
    await saveCategories();
  }

  // Clear previous race data if requested
  if (doClear) {
    state.entries   = [];  state.finishers = [];
    state.results   = [];  state.prizes    = [];
    state.helpers   = [];  state.finishNumbersMap = {};
    await Promise.all([
      saveEntries(), saveHelpers(), saveFinishers(),
      saveResults(), savePrizes(), clearSIEntries(),
    ]);
    document.getElementById('ev-clear-previous').checked = false;
  }

  await saveEvent();
  showBusy('');
  showStatus('Event saved' + (doClear ? ' — race data cleared.' : '.'));
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
  // Existing-bib / existing-dibber checks — may redirect to edit mode before anything else
  if (!editingBib) {
    const typedBib = +val('entry-form-bib') || 0;
    if (typedBib > 0 && findEntryByBib(typedBib) >= 0) {
      if (confirm(`Bib ${typedBib} is already registered. Edit that entry?`)) {
        fillFormForEdit(typedBib);
      } else {
        document.getElementById('entry-form-bib').value = getNextBibNumber();
      }
      return;
    }
    const typedDibber = +val('entry-form-dibber') || 0;
    if (typedDibber > 0) {
      const dibberEntryIdx = findEntryByDibber(typedDibber);
      if (dibberEntryIdx >= 0) {
        const clashBib = state.entries[dibberEntryIdx].bibNumber;
        if (confirm(`Dibber ${typedDibber} is already assigned to bib ${clashBib}. Edit that entry?`)) {
          fillFormForEdit(clashBib);
        } else {
          document.getElementById('entry-form-dibber').value = getNextDibberNumber() || '';
        }
        return;
      }
    }
  }

  if (!document.getElementById('entry-form-confirm')?.checked) {
    showStatus('Check the confirmation box before registering.', true);
    document.getElementById('entry-form-confirm')?.focus();
    return;
  }

  // Skip-bib confirmation after checkbox (new entries only)
  if (!editingBib) {
    const typedBib = +val('entry-form-bib') || 0;
    const next = getNextBibNumber();
    if (typedBib > next && !confirm(`Bib ${typedBib} skips ${typedBib - next} number(s). Confirm?`)) {
      document.getElementById('entry-form-bib').value = next;
      return;
    }
  }

  const formData = {
    name:        val('entry-form-name'),
    gender:      val('entry-form-gender'),
    dob:         val('entry-form-dob'),
    club:        val('entry-form-club'),
    fraNumber:   val('entry-form-fra'),
    category:    val('entry-form-category'),
    course:      val('entry-form-course'),
    preEntry:    val('entry-form-peno'),
    bibOverride:    +val('entry-form-bib')    || 0,
    dibberOverride: +val('entry-form-dibber') || 0,
  };
  const isEdit = editingBib > 0;
  showBusy(isEdit ? 'Updating…' : 'Registering…');
  const result = isEdit
    ? await updateEntry(editingBib, formData)
    : await submitEntry(formData);
  showBusy('');
  if (result.error) {
    showStatus(result.error, true);
  } else {
    const bib = isEdit ? editingBib : result.bibNumber;
    showStatus(isEdit ? `Bib ${bib} updated.` : `Bib ${bib} registered.`);
    resetEntryForm();
    document.getElementById('entry-form-peno')?.focus();
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

async function undoLastFinisher(course) {
  const result = await deleteLastFinisher(course || finisherCourse);
  if (result.error) showStatus(result.error, true);
  else {
    showStatus('Last finisher removed.');
    if (finisherPass === 2) initPass2();
  }
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

async function importDibbersFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) { showStatus('Empty file.', true); return; }
  const dataLines = lines[0].toLowerCase().includes('number') ? lines.slice(1) : lines;
  let added = 0, updated = 0;
  for (const line of dataLines) {
    const [short, long] = line.split(',').map(s => s.trim());
    if (!short || !long || isNaN(+short) || isNaN(+long)) continue;
    const existing = state.dibbers.findIndex(d => +d.shortCode === +short);
    if (existing >= 0) {
      state.dibbers[existing].longCode = +long;
      updated++;
    } else {
      state.dibbers.push({ shortCode: +short, longCode: +long, availability: '', notes: '' });
      added++;
    }
  }
  if (!added && !updated) { showStatus('No valid dibber rows found.', true); return; }
  state.dibbers.sort((a, b) => +a.shortCode - +b.shortCode);
  await saveDibbers();
  showStatus(`Dibbers: ${added} added, ${updated} updated.`);
  renderDibbers();
}

async function importSIEntriesFromFile() {
  const text = await pickFile('.csv,.txt');
  if (!text) return;
  showBusy('Importing…');
  const result = await importSIEntries(text);
  showBusy('');
  if (result.errors.length) {
    showStatus(result.errors.join('; '), true);
    renderPreEntries();
    return;
  }

  // Auto-verify
  const issues = verifySIEntries();
  if (issues.length) {
    showStatus(
      `${result.added} added, ${result.updated} updated — ${issues.length} issue(s): ` +
      issues.map(i => i.name ? `${i.name}: ${i.issue}` : i.issue).join('; '),
      true
    );
    renderPreEntries();
    return;
  }

  // Verify passed — auto-merge into people/clubs
  showBusy('Merging…');
  const merged = await mergeSIEntries();
  showBusy('');
  showStatus(
    `${result.added} added, ${result.updated} updated — merged: +${merged.peopleAdded} people, +${merged.clubsAdded} clubs.`
  );
  renderPreEntries();
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
  const csv  = formatCSV(rows, Object.values(SI_TIMING_COL_NAMES));
  downloadText(csv, `${sanitise(state.event.name)}_SI_Timing.csv`);
  showStatus('SI timing file downloaded.');
}


function updateDibberField() {
  const dibEl = document.getElementById('entry-form-dibber');
  if (!dibEl || document.activeElement === dibEl || editingBib) return;
  const course = val('entry-form-course') || COURSE.SENIORS;
  dibEl.value = usingDibbers(course) ? (getNextDibberNumber() || '') : '';
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

// ---- Entry edit (inline form) ----

let editingBib = 0;

function fillFormForEdit(bib) {
  const e = getEntry(bib);
  if (!e) return;
  editingBib = bib;
  fillForm('', {
    'entry-form-peno':     '',
    'entry-form-bib':      e.bibNumber,
    'entry-form-dibber':   e.dibberNumber || '',
    'entry-form-name':     e.name      || '',
    'entry-form-gender':   e.gender    || '',
    'entry-form-dob':      e.dob       || '',
    'entry-form-club':     e.club      || '',
    'entry-form-fra':      e.fraNumber || '',
    'entry-form-category': e.category  || '',
    'entry-form-course':   e.course    || '',
    'entry-form-confirm':  false,
  });
  document.getElementById('btn-submit-entry').textContent = 'Update';
  document.getElementById('btn-cancel-edit').style.display = '';
  document.getElementById('entry-form-name')?.focus();
}

function resetEntryForm() {
  editingBib = 0;
  clearForm('entry-form-fields');
  const bibEl = document.getElementById('entry-form-bib');
  if (bibEl) bibEl.value = getNextBibNumber();
  updateDibberField();
  document.getElementById('btn-submit-entry').textContent = 'Register';
  document.getElementById('btn-cancel-edit').style.display = 'none';
}

function openEntryEdit(bib) {
  const e = getEntry(bib);
  if (!e) return;
  editingBib = bib;
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

function isEntryFormDirty() {
  const container = document.getElementById('entry-form-fields');
  if (!container) return false;
  return [...container.querySelectorAll('input:not([type="checkbox"]):not(#entry-form-bib), select')]
    .some(el => el.value.trim() !== '');
}

function updateDatalistNames() {
  const dl = document.getElementById('datalist-names');
  if (!dl) return;
  const names = [...new Set(state.people.map(p => p.name).filter(Boolean))].sort();
  dl.innerHTML = names.map(n => `<option value="${escHtml(n)}">`).join('');
}

function updateDatalistClubs() {
  const dl = document.getElementById('datalist-clubs');
  if (!dl) return;
  const clubs = [...new Set(state.clubs.map(c => c.name).filter(Boolean))].sort();
  dl.innerHTML = clubs.map(c => `<option value="${escHtml(c)}">`).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  const cls = isError ? 'status-error' : 'status-ok';

  const bar = document.getElementById('status-message');
  if (bar) {
    bar.textContent = msg;
    bar.className = cls;
    setTimeout(() => { if (bar.textContent === msg) bar.textContent = ''; }, 10000);
  }

  const inlineEls = ['entry-status-msg', 'pre-entry-status-msg']
    .map(id => document.getElementById(id)).filter(Boolean);
  for (const el of inlineEls) {
    el.textContent = msg;
    el.className = `entry-status ${cls}`;
    el.hidden = !msg;
    setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.hidden = true; } }, 10000);
  }
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