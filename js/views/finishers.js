'use strict';

import { state } from '../state.js';
import {
  recordFinisher, updateFinisher, deleteLastFinisher, deleteFinishersFrom,
  scanFinishers, processFinishers, getSortedFinishers,
} from '../finishers.js';
import { getEntriesOnCourse, getSortedEntries } from '../entries.js';
import { COURSE, FINISHER } from '../constants.js';
import { normaliseTime, showBusy } from '../utils.js';
import { on, setHTML, showStatus, escHtml, confirm } from '../ui.js';

// ---- Module state ----

let editingIdx = -1;   // index into state.finishers; -1 = adding new

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

  const lineEl = document.getElementById('finisher-line');
  if (lineEl) lineEl.value = all.length;

  updatePrevTime(all);

  const tbody = document.getElementById('finishers-tbody');
  if (!tbody) return;
  const specialActionValues = new Set(Object.values(SPECIAL_BIBS));
  const startFinishLabel = action => {
    if (action === FINISHER.ACTION_START)  return 'Start';
    if (action === FINISHER.ACTION_FINISH || action === FINISHER.NORMAL) return 'Finish';
    if (specialActionValues.has(action))   return action;
    return '';
  };
  tbody.innerHTML = all.map((f, i) => {
    const sidx = state.finishers.indexOf(f);
    const numDisplay = f.number > 0 ? f.number : '';
    return `<tr class="${f.error ? 'row-error' : ''}">
      <td>${f.line !== undefined ? f.line : i}</td>
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
        <button class="btn-sm btn-delete-entry btn-del-finisher" data-sidx="${sidx}">Del from here</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-edit-finisher').forEach(b =>
    b.addEventListener('click', () => {
      const sidx = +b.dataset.sidx;
      if (!confirm(`Edit finisher at line ${state.finishers[sidx]?.line ?? sidx}?`)) return;
      fillFormForEdit(sidx);
    }));

  tbody.querySelectorAll('.btn-del-finisher').forEach(b =>
    b.addEventListener('click', () => confirmDeleteFrom(+b.dataset.sidx)));
}

function updatePrevTime(finishers) {
  const last = finishers.length > 0 ? finishers[finishers.length - 1] : null;
  const el = document.getElementById('finisher-prev-time');
  if (el) el.value = last?.time || '';
}

// ---- Form helpers ----

function fillFormForEdit(sidx) {
  const f = state.finishers[sidx];
  if (!f) return;
  editingIdx = sidx;

  const lineEl = document.getElementById('finisher-line');
  const bibEl  = document.getElementById('finisher-bib');
  const timeEl = document.getElementById('finisher-time');
  if (lineEl) lineEl.value = f.line !== undefined ? f.line : '';
  if (bibEl)  bibEl.value  = f.number || f.action || '';
  if (timeEl) timeEl.value = f.time || '';

  const isStart = f.action === FINISHER.ACTION_START;
  const startRadio  = document.getElementById('finisher-is-start');
  const finishRadio = document.getElementById('finisher-is-finish');
  if (startRadio)  startRadio.checked  = isStart;
  if (finishRadio) finishRadio.checked = !isStart;

  document.getElementById('btn-submit-finisher').textContent = 'Update';
  document.getElementById('btn-cancel-finisher-edit').style.display = '';

  document.getElementById('finisher-bib')?.focus();
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
  renderFinishers();
  document.getElementById('finisher-bib')?.focus();
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
  const lineEl = document.getElementById('finisher-line');

  const rawBib  = (bibEl?.value || '').trim();
  const rawTime = (timeEl?.value || '').trim();
  const isStart = document.querySelector('input[name="finisher-event-type"]:checked')?.value === 'start';
  const lineVal = lineEl?.value !== '' ? +lineEl.value : undefined;

  if (!rawBib) {
    showStatus('Enter a race/bib number or special code.', true);
    bibEl?.focus();
    return;
  }

  let parsedTime = '';
  if (rawTime) {
    const current = getSortedFinishers();
    const prevTime = current.length > 0 ? current[current.length - 1].time : '';
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
      line:   lineVal,
    });
    showBusy('');
    if (result.error) { showStatus(result.error, true); bibEl?.focus(); return; }
    const editLabel = specialEdit ? rawBib : `${isStart ? 'Start' : 'Finish'} bib ${rawBib}`;
    showStatus(`Line ${lineVal !== undefined ? lineVal : editingIdx}: ${editLabel} updated`);
    resetFinisherForm();
    return;
  }

  // Add mode
  const specialAction = SPECIAL_BIBS[rawBib.toLowerCase()];
  showBusy('Recording…');

  let result;
  if (specialAction) {
    result = await recordFinisher(0, parsedTime, null, specialAction, lineVal);
  } else {
    const bib = parseInt(rawBib, 10);
    if (isNaN(bib) || bib < 0) {
      showBusy('');
      showStatus('Invalid bib number.', true);
      bibEl?.focus();
      return;
    }
    const action = isStart ? FINISHER.ACTION_START : FINISHER.NORMAL;
    result = await recordFinisher(bib, parsedTime, null, action, lineVal);
  }

  showBusy('');

  if (result.error) {
    showStatus(result.error, true);
    bibEl?.focus();
    return;
  }

  const sfLabel = specialAction ? rawBib : `${isStart ? 'Start' : 'Finish'} bib ${rawBib}`;
  showStatus(`Line ${lineVal !== undefined ? lineVal : result.position - 1}: ${sfLabel}`);

  bibEl.value  = '';
  timeEl.value = '';
  const finishRadio = document.getElementById('finisher-is-finish');
  if (finishRadio) finishRadio.checked = true;

  renderFinishers();
  bibEl?.focus();
}

// ---- Delete from here ----

async function confirmDeleteFrom(sidx) {
  const f = state.finishers[sidx];
  if (!f) return;
  if (!confirm(`Delete from line ${f.line ?? sidx} onwards?`)) return;
  showBusy('Deleting…');
  const result = await deleteFinishersFrom(sidx);
  showBusy('');
  if (result.error) { showStatus(result.error, true); return; }
  showStatus(`${result.deleted} finisher(s) removed.`);
  renderFinishers();
  document.getElementById('finisher-bib')?.focus();
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
          'input:not([disabled]), button:not([disabled])'
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
}