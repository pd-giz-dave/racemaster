'use strict';

import { state } from '../state.js';
import {
  recordFinisher, deleteLastFinisher, updateFinisher,
  scanFinishers, processFinishers, getSortedFinishers,
} from '../finishers.js';
import { COURSE, FINISHER } from '../constants.js';
import { iequal, normaliseTime, showBusy } from '../utils.js';
import { on, setHTML, showStatus } from '../ui.js';

// ---- Module state ----

export let finisherCourse = COURSE.SENIORS;
export let finisherPass   = 1;
export let pass2Idx       = 0;

// ---- Render ----

export function renderFinishers() {
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

export function setFinisherCourse(course) {
  finisherCourse = course;
  const isSr = !iequal(course, COURSE.JUNIORS);
  document.getElementById('fcourse-senior')?.classList.toggle('active', isSr);
  document.getElementById('fcourse-junior')?.classList.toggle('active', !isSr);
  if (finisherPass === 2) initPass2();
  renderFinishers();
  document.getElementById(finisherPass === 1 ? 'finish-bib-rapid' : 'finish-time-rapid')?.focus();
}

export function setFinisherPass(pass) {
  finisherPass = pass;
  document.getElementById('finisher-pass1').hidden = pass !== 1;
  document.getElementById('finisher-pass2').hidden = pass !== 2;
  document.getElementById('fpass-1')?.classList.toggle('active', pass === 1);
  document.getElementById('fpass-2')?.classList.toggle('active', pass === 2);
  if (pass === 2) initPass2();
  else document.getElementById('finish-bib-rapid')?.focus();
  renderFinishers();
}

export function initPass2() {
  const finishers = getSortedFinishers(finisherCourse);
  pass2Idx = finishers.findIndex(f => !f.time);
  if (pass2Idx < 0) pass2Idx = Math.max(0, finishers.length - 1);
  renderPass2();
  const timeEl = document.getElementById('finish-time-rapid');
  if (timeEl) { timeEl.value = finishers[pass2Idx]?.time || ''; timeEl.focus(); timeEl.select(); }
}

export function renderPass2() {
  const finishers = getSortedFinishers(finisherCourse);
  const f    = finishers[pass2Idx];
  const prev = pass2Idx > 0 ? finishers[pass2Idx - 1] : null;
  setHTML('pass2-pos',     f ? (f.position || pass2Idx + 1) : '—');
  setHTML('pass2-bib',     f ? (f.number || '?') : '—');
  setHTML('pass2-name',    f ? (f.name || '') : '');
  setHTML('pass2-inherit', prev?.time ? `prev: ${prev.time}` : '');
}

export async function pass2AdvanceFinisher(inputValue) {
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
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export async function undoLastFinisher(course) {
  const result = await deleteLastFinisher(course || finisherCourse);
  if (result.error) showStatus(result.error, true);
  else {
    showStatus('Last finisher removed.');
    if (finisherPass === 2) initPass2();
  }
  renderFinishers();
}

export async function runScanFinishers() {
  showBusy('Scanning…');
  const errors = await scanFinishers();
  showBusy('');
  showStatus(errors.length ? `${errors.length} errors found` : 'Scan OK — no errors', errors.length > 0);
  renderFinishers();
}

export async function runProcessFinishers() {
  showBusy('Processing…');
  await processFinishers();
  showBusy('');
  showStatus('Finishers processed.');
  renderFinishers();
}

// ---- Wire ----

export function wireFinishers() {
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
}