'use strict';

import { state } from '../state.js';
import {
  recordFinisher, updateFinisher, deleteLastFinisher, deleteFinishersFrom,
  deleteFinisher, insertFinisherAbove,
  scanFinishers, processFinishers, getSortedFinishers,
} from '../finishers.js';
import { getEntriesOnCourse, getSortedEntries } from '../entries.js';
import { COURSE, FINISHER } from '../constants.js';
import { normaliseTime, showBusy } from '../utils.js';
import { on, setHTML, showStatus, escHtml, showConfirmDialog, showChoiceDialog } from '../ui.js';

// ---- Module state ----

let editingIdx     = -1;   // index into state.finishers; -1 = adding new
let timeTargetSidx = -1;   // index into state.finishers of the current time-mode target

const SPECIAL_BIBS = {
  'seniors': FINISHER.SENIORS,
  'juniors': FINISHER.JUNIORS,
  'clock':   FINISHER.CLOCK,
  'ignore':  FINISHER.IGNORE,
  'nostart': FINISHER.NO_START,
  'time':    FINISHER.TIME,
  'offset':  FINISHER.OFFSET,
};

const SPECIAL_BIB_LABELS = [
  ['Seniors',  'Record actual start time for seniors race'],
  ['Juniors',  'Record actual start time for juniors race'],
  ['Clock',    'Record clock start — subsequent times relative to this'],
  ['Ignore',   'Mark accidental stopwatch trigger'],
  ['NoStart',  'Times relative to 0, not time of day'],
  ['Time',     'Like Clock but times are time of day'],
  ['Offset',   'Clock started late — offset added to subsequent times'],
];

function updateDatalistFinisherBibs() {
  const dl = document.getElementById('datalist-finisher-bibs');
  if (!dl) return;
  const specials = SPECIAL_BIB_LABELS.map(([v, label]) =>
    `<option value="${v}">${escHtml(label)}</option>`).join('');
  const entries = getSortedEntries().map(e => {
    const label = [e.name, e.category, e.course].filter(Boolean).join(' · ');
    return `<option value="${e.bibNumber}">${escHtml(label)}</option>`;
  }).join('');
  dl.innerHTML = specials + entries;
}

// ---- Mode management ----

function getCurrentMode() {
  return document.getElementById('finisher-mode')?.value || 'bibs';
}

function findNextTimeTarget() {
  const sorted = getSortedFinishers();
  const f = sorted.find(f => !f.time);
  return f ? state.finishers.indexOf(f) : -1;
}

// Update line/bib/prev-time fields to reflect the current time-mode target.
// Also refreshes timeTargetSidx. No side effects (no status messages, no mode switching).
function refreshTimeModeDisplay() {
  document.querySelectorAll('#finishers-tbody .row-timing-target')
    .forEach(r => r.classList.remove('row-timing-target'));

  timeTargetSidx = findNextTimeTarget();
  if (timeTargetSidx < 0) return;
  const f = state.finishers[timeTargetSidx];
  const lineEl = document.getElementById('finisher-line');
  const bibEl  = document.getElementById('finisher-bib');
  const prevEl = document.getElementById('finisher-prev-time');
  if (lineEl) lineEl.value = String(timeTargetSidx);
  if (bibEl)  bibEl.value  = String(f.number || '');
  let prevTime = '';
  for (let i = timeTargetSidx - 1; i >= 0; i--) {
    if (state.finishers[i].time && state.finishers[i].time !== '-') { prevTime = state.finishers[i].time; break; }
  }
  if (prevEl) prevEl.value = prevTime;

  const targetRow = document.querySelector(`#finishers-tbody tr[data-sidx="${timeTargetSidx}"]`);
  if (targetRow) {
    targetRow.classList.add('row-timing-target');
    targetRow.scrollIntoView({ block: 'nearest' });
  }
}

export function applyMode(mode) {
  const isTime = mode === 'time';
  const bibEl      = document.getElementById('finisher-bib');
  const prevField  = document.getElementById('finisher-prev-time')?.closest('.form-field');
  const timeField  = document.getElementById('finisher-time')?.closest('.form-field');
  const radioGroup = document.getElementById('finisher-radio-group');
  const submitBtn  = document.getElementById('btn-submit-finisher');

  // Bib: visible always; read-only and non-focusable in time mode (it shows the target)
  if (bibEl) { bibEl.readOnly = isTime; bibEl.tabIndex = isTime ? -1 : 0; }

  // Prev time and finish time: only visible in time mode
  if (prevField)  prevField.style.display  = isTime ? '' : 'none';
  if (timeField)  timeField.style.display  = isTime ? '' : 'none';

  // Radios: only in bibs mode
  if (radioGroup) radioGroup.style.display = isTime ? 'none' : '';

  if (submitBtn) submitBtn.textContent = isTime ? 'Set Time' : 'Record';

  if (isTime) {
    refreshTimeModeDisplay();
    if (timeTargetSidx < 0) {
      // Nothing to time — revert immediately
      const modeEl = document.getElementById('finisher-mode');
      if (modeEl) modeEl.value = 'bibs';
      applyMode('bibs');
      showStatus('No untimed finishers to assign times to.', true);
    } else {
      setTimeout(() => document.getElementById('finisher-time')?.focus(), 0);
    }
  } else {
    timeTargetSidx = -1;
    document.querySelectorAll('#finishers-tbody .row-timing-target')
      .forEach(r => r.classList.remove('row-timing-target'));
    document.querySelector('#finishers-tbody tr:last-child')?.scrollIntoView({ block: 'nearest' });
    if (bibEl) { bibEl.value = ''; bibEl.readOnly = false; bibEl.tabIndex = 0; }
    setTimeout(() => document.getElementById('finisher-bib')?.focus(), 0);
  }
}

// ---- Render ----

export function renderFinishers() {
  const all     = getSortedFinishers();
  const seniors = getSortedFinishers(COURSE.SENIORS);
  const juniors = getSortedFinishers(COURSE.JUNIORS);

  const maxBib = Math.max(0, ...getSortedEntries().map(e => +e.bibNumber || 0));
  const isValidFinisher = f => f.number >= 1 && f.number <= maxBib && f.action !== FINISHER.ACTION_START;

  const seniorExpected = getEntriesOnCourse(COURSE.SENIORS);
  const juniorExpected = getEntriesOnCourse(COURSE.JUNIORS);

  setHTML('finisher-senior-count', `${seniors.filter(isValidFinisher).length} of ${seniorExpected}`);
  setHTML('finisher-junior-count', `${juniors.filter(isValidFinisher).length} of ${juniorExpected}`);

  updateDatalistFinisherBibs();

  // In bibs mode, line field shows next line number; in time mode it shows the target line
  const lineEl = document.getElementById('finisher-line');
  if (lineEl && getCurrentMode() !== 'time') lineEl.value = String(state.finishers.length);

  if (getCurrentMode() !== 'time') updatePrevTime(all);

  const tbody = document.getElementById('finishers-tbody');
  if (!tbody) return;
  const specialActionValues = new Set(Object.values(SPECIAL_BIBS));
  const startFinishLabel = action => {
    if (action === FINISHER.ACTION_START)  return 'Start';
    if (action === FINISHER.ACTION_FINISH || action === FINISHER.NORMAL) return 'Finish';
    if (specialActionValues.has(action))   return action;
    return '';
  };
  tbody.innerHTML = all.map((f) => {
    const sidx = state.finishers.indexOf(f);
    const numDisplay = f.number > 0 ? f.number : '';
    return `<tr class="${f.error ? 'row-error' : ''}" data-sidx="${sidx}">
      <td>${sidx}</td>
      <td>${startFinishLabel(f.action)}</td>
      <td>${f.time || ''}</td>
      <td>${f.adjustedTime || ''}</td>
      <td>${numDisplay}</td>
      <td>${f.name || ''}</td>
      <td>${f.category || ''}</td>
      <td>${f.number > 0 ? (f.course || '') : ''}</td>
      <td>${f.source === 'manual' ? 'Manual' : f.source ? 'Auto' : ''}</td>
      <td>
        <button class="btn-sm btn-edit btn-edit-finisher" data-sidx="${sidx}">Edit</button>
        <button class="btn-sm btn-insert-above-finisher" data-sidx="${sidx}">Ins ↑</button>
        <button class="btn-sm btn-delete-entry btn-del-finisher" data-sidx="${sidx}">Del</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-edit-finisher').forEach(b =>
    b.addEventListener('click', async () => {
      const sidx = +b.dataset.sidx;
      if (!await showConfirmDialog(`Edit finisher at line ${sidx}?`, 'Edit')) return;
      fillFormForEdit(sidx);
    }));

  tbody.querySelectorAll('.btn-insert-above-finisher').forEach(b =>
    b.addEventListener('click', () => confirmInsertAbove(+b.dataset.sidx)));

  tbody.querySelectorAll('.btn-del-finisher').forEach(b =>
    b.addEventListener('click', () => confirmDeleteFinisher(+b.dataset.sidx)));

  // Keep time-mode display in sync after any render
  if (getCurrentMode() === 'time') refreshTimeModeDisplay();

  if (editingIdx >= 0) {
    document.querySelector(`#finishers-tbody tr[data-sidx="${editingIdx}"]`)?.classList.add('row-editing');
  }
}

function updatePrevTime(finishers) {
  const last = [...finishers].reverse().find(f => f.time && f.time !== '-') ?? null;
  const el = document.getElementById('finisher-prev-time');
  if (el) el.value = last?.time || '';
}

// ---- Form helpers ----

function fillFormForEdit(sidx) {
  // Edit always happens in bibs mode
  const modeEl = document.getElementById('finisher-mode');
  if (modeEl && modeEl.value !== 'bibs') {
    modeEl.value = 'bibs';
    applyMode('bibs');
  }

  const f = state.finishers[sidx];
  if (!f) return;
  editingIdx = sidx;

  const lineEl = document.getElementById('finisher-line');
  const bibEl  = document.getElementById('finisher-bib');
  const timeEl = document.getElementById('finisher-time');
  if (lineEl) lineEl.value = String(sidx);
  if (bibEl)  bibEl.value  = f.number || f.action || '';
  if (timeEl) timeEl.value = f.time || '';

  // Show time field in edit mode so the time can be corrected
  const timeField = timeEl?.closest('.form-field');
  if (timeField) timeField.style.display = '';
  const prevField = document.getElementById('finisher-prev-time')?.closest('.form-field');
  if (prevField) prevField.style.display = '';

  const isStart = f.action === FINISHER.ACTION_START;
  const startRadio  = document.getElementById('finisher-is-start');
  const finishRadio = document.getElementById('finisher-is-finish');
  if (startRadio)  startRadio.checked  = isStart;
  if (finishRadio) finishRadio.checked = !isStart;

  document.getElementById('btn-submit-finisher').textContent = 'Update';
  document.getElementById('btn-cancel-finisher-edit').style.display = '';

  document.getElementById('finisher-bib')?.focus();
  const editRow = document.querySelector(`#finishers-tbody tr[data-sidx="${sidx}"]`);
  editRow?.classList.add('row-editing');
  editRow?.scrollIntoView({ block: 'nearest' });
}

function resetFinisherForm() {
  editingIdx = -1;
  const bibEl  = document.getElementById('finisher-bib');
  const timeEl = document.getElementById('finisher-time');
  if (bibEl)  bibEl.value  = '';
  if (timeEl) timeEl.value = '';
  const finishRadio = document.getElementById('finisher-is-finish');
  if (finishRadio) finishRadio.checked = true;
  document.getElementById('btn-submit-finisher').textContent = 'Record';
  document.getElementById('btn-cancel-finisher-edit').style.display = 'none';
  // Re-apply bibs mode appearance (hides time field, restores bib focus)
  applyMode('bibs');
  renderFinishers();
}

// ---- Time parsing ----

export function parseFinishTime(input, prevTimeStr) {
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
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- Submit ----

async function submitFinisherForm() {
  const bibEl  = document.getElementById('finisher-bib');
  const timeEl = document.getElementById('finisher-time');

  const rawBib  = (bibEl?.value || '').trim();
  const rawTime = (timeEl?.value || '').trim();
  const isStart = document.querySelector('input[name="finisher-event-type"]:checked')?.value === 'start';

  // ---- Time mode ----
  if (getCurrentMode() === 'time') {
    if (timeTargetSidx < 0) { showStatus('No untimed finishers.', true); return; }
    if (!rawTime) { showStatus('Enter a finish time or - to skip.', true); timeEl?.focus(); return; }
    const tf = state.finishers[timeTargetSidx];
    const tfLabel = tf?.number > 0 ? `bib ${tf.number}` : (tf?.action || 'line');
    let parsedTime;
    if (rawTime === '-') {
      parsedTime = '-';
    } else {
      const prevEl = document.getElementById('finisher-prev-time');
      parsedTime = parseFinishTime(rawTime, prevEl?.value || '');
      if (!parsedTime) {
        showStatus('Invalid time — use ss, mm:ss, hh:mm:ss, or - to skip', true);
        timeEl?.focus();
        return;
      }
    }
    showBusy('Setting time…');
    const result = await updateFinisher(timeTargetSidx, { time: parsedTime });
    showBusy('');
    if (result.error) { showStatus(result.error, true); return; }
    showStatus(parsedTime === '-'
      ? `Line ${timeTargetSidx}: ${tfLabel} skipped`
      : `Line ${timeTargetSidx}: ${tfLabel} → ${parsedTime}`);
    renderFinishers(); // also refreshes timeTargetSidx via refreshTimeModeDisplay
    if (timeTargetSidx < 0) {
      document.getElementById('finisher-mode').value = 'bibs';
      applyMode('bibs');
      showStatus('All finishers timed — switched to Bibs mode.');
    } else {
      timeEl.value = '';
      timeEl.focus();
    }
    return;
  }

  // ---- Bibs mode ----
  if (!rawBib) {
    showStatus('Enter a race/bib number or special code.', true);
    bibEl?.focus();
    return;
  }

  let parsedTime = '';
  if (rawTime) {
    const all = state.finishers;
    const prevTime = all.length > 0 ? all[all.length - 1].time : '';
    parsedTime = parseFinishTime(rawTime, prevTime) || '';
    if (!parsedTime) {
      showStatus('Invalid time — use ss, mm:ss, or hh:mm:ss', true);
      timeEl?.focus();
      return;
    }
  }

  // Edit mode
  if (editingIdx >= 0) {
    showBusy('Updating…');
    const specialEdit = SPECIAL_BIBS[rawBib.toLowerCase()];
    const bib    = specialEdit ? 0 : parseInt(rawBib, 10);
    const action = specialEdit
      ? specialEdit
      : (isStart ? FINISHER.ACTION_START : FINISHER.NORMAL);
    const result = await updateFinisher(editingIdx, {
      number: isNaN(bib) ? 0 : bib,
      time:   parsedTime,
      action,
    });
    showBusy('');
    if (result.error) { showStatus(result.error, true); bibEl?.focus(); return; }
    const editLabel = specialEdit ? rawBib : `${isStart ? 'Start' : 'Finish'} bib ${rawBib}`;
    showStatus(`Line ${editingIdx}: ${editLabel} updated`);
    const updatedIdx = editingIdx;
    resetFinisherForm();
    document.querySelector(`#finishers-tbody tr[data-sidx="${updatedIdx}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }

  // Add mode
  const specialAction = SPECIAL_BIBS[rawBib.toLowerCase()];
  showBusy('Recording…');

  let result;
  if (specialAction) {
    result = await recordFinisher(0, parsedTime, null, specialAction);
  } else {
    const bib = parseInt(rawBib, 10);
    if (isNaN(bib) || bib < 0) {
      showBusy('');
      showStatus('Invalid bib number.', true);
      bibEl?.focus();
      return;
    }
    const action = isStart ? FINISHER.ACTION_START : FINISHER.NORMAL;
    result = await recordFinisher(bib, parsedTime, null, action);
  }

  showBusy('');

  if (result.error) {
    showStatus(result.error, true);
    bibEl?.focus();
    return;
  }

  const sfLabel = specialAction ? rawBib : `${isStart ? 'Start' : 'Finish'} bib ${rawBib}`;
  showStatus(`Line ${result.line}: ${sfLabel}`);

  bibEl.value  = '';
  timeEl.value = '';
  const finishRadio = document.getElementById('finisher-is-finish');
  if (finishRadio) finishRadio.checked = true;

  renderFinishers();
  document.querySelector(`#finishers-tbody tr[data-sidx="${result.line}"]`)?.scrollIntoView({ block: 'nearest' });
  bibEl?.focus();
}

// ---- Delete / Insert ----

async function confirmDeleteFinisher(sidx) {
  const f = state.finishers[sidx];
  if (!f) return;
  const choice = await showChoiceDialog(`Delete line ${sidx}?`, [
    { label: 'This line only',       value: 'one', danger: true },
    { label: 'This and all below',   value: 'all', danger: true },
  ]);
  if (!choice) return;
  showBusy('Deleting…');
  let result;
  if (choice === 'one') {
    result = await deleteFinisher(sidx);
    if (!result.error) showStatus(`Line ${sidx} deleted.`);
  } else {
    result = await deleteFinishersFrom(sidx);
    if (!result.error) showStatus(`${result.deleted} finisher(s) removed.`);
  }
  showBusy('');
  if (result.error) { showStatus(result.error, true); return; }
  renderFinishers();
  document.getElementById('finisher-bib')?.focus();
}

async function confirmInsertAbove(sidx) {
  if (sidx < 0 || sidx >= state.finishers.length) return;
  if (!await showConfirmDialog(`Insert blank line above line ${sidx}?`, 'Insert')) return;
  showBusy('Inserting…');
  const result = await insertFinisherAbove(sidx);
  showBusy('');
  if (result.error) { showStatus(result.error, true); return; }
  renderFinishers();
  if (result.newIdx >= 0) fillFormForEdit(result.newIdx);
}

// ---- Undo ----

export async function undoLastFinisher() {
  const result = await deleteLastFinisher();
  if (result.error) showStatus(result.error, true);
  else showStatus('Last finisher removed.');
  renderFinishers();
}

// ---- Scan / Process ----

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

// ---- Wire ----

export function wireFinishers() {
  on('btn-submit-finisher',       'click', submitFinisherForm);
  on('btn-cancel-finisher-edit',  'click', resetFinisherForm);
  on('btn-undo-rapid',            'click', () => undoLastFinisher());
  on('btn-scan-finishers',        'click', runScanFinishers);
  on('btn-process-finishers',     'click', runProcessFinishers);

  // Mode dropdown
  const modeEl = document.getElementById('finisher-mode');
  if (modeEl) modeEl.addEventListener('change', () => applyMode(modeEl.value));

  // Special code auto-fill: when typed text uniquely matches one special code, complete it
  const bibEl = document.getElementById('finisher-bib');
  if (bibEl) {
    const specialNames = SPECIAL_BIB_LABELS.map(([v]) => v); // ['Seniors','Juniors',...]
    bibEl.addEventListener('input', e => {
      if (e.inputType?.startsWith('delete')) return;
      const typed = bibEl.value;
      if (!typed) return;
      const low = typed.toLowerCase();
      const matches = specialNames.filter(n => n.toLowerCase().startsWith(low));
      if (matches.length === 1 && matches[0].toLowerCase() !== low) {
        const pos = typed.length;
        bibEl.value = matches[0];
        bibEl.setSelectionRange(pos, matches[0].length);
      }
    });
  }

  // Tab cycling and Enter submit within form
  const formContainer = document.getElementById('finisher-form-fields');
  if (formContainer) {
    formContainer.addEventListener('keydown', async e => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        await submitFinisherForm();
      } else if (e.key === 'Tab') {
        const focusable = [...formContainer.querySelectorAll(
          'input:not([disabled]), select:not([disabled]), button:not([disabled])'
        )].filter(el => el.offsetParent !== null && el.tabIndex !== -1);
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

  // Initialize to bibs mode
  applyMode('bibs');
}