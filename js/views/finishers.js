'use strict';

import { state } from '../state.js';
import {
  recordFinisher, updateFinisher, deleteFinishersFrom, clearAllFinishers,
  deleteFinisher, insertFinisherAbove,
  getSortedFinishers, buildSplitNumbers,
  getAllSpecials, lineLabel, getPrevTime, parseFinishTime,
} from '../finishers.js';
import { getEntry, getEntriesOnCourse, getSortedEntries, isEntryBanned } from '../entries.js';
import { COURSE } from '../constants.js';
import { timeToSeconds, showBusy } from '../utils.js';
import { on, setHTML, showStatus, escHtml, showConfirmDialog, showChoiceDialog, wireFormFocusTrap, renderTable } from '../ui.js';
import { TABLES } from '../locale.js';

const FINISHER_COLS = (() => {
  const m = TABLES.finishers;
  return [
    { ...m[0], render: r => r.lineDisplay },
    { ...m[1], render: r => r.eventLabel },
    { ...m[2], render: r => r.f.time || '' },
    { ...m[3], render: r => r.numDisplay },
    { ...m[4], render: r => r.nameDisplay },
    { ...m[5], render: r => r.entry?.category || '' },
    { ...m[6], render: r => r.f.number > 0 ? (r.entry?.course || '') : '' },
    { ...m[7], render: () => `
      <button class="btn-sm btn-edit btn-edit-finisher" data-action="edit">Edit</button>
      <button class="btn-sm btn-insert-above-finisher" data-action="ins">Ins ↑</button>
      <button class="btn-sm btn-delete-entry btn-del-finisher" data-action="del">Del</button>` },
  ];
})();

// ---- Module state ----

let editingIdx     = -1;   // index into state.finishers; -1 = adding new
let timeTargetSidx = -1;   // index into state.finishers of the current time-mode target
let editIsInsert   = false; // true when edit was opened via Ins↑; cancel should remove the line

function updateDatalistFinisherBibs() {
  const dl = document.getElementById('datalist-finisher-bibs');
  if (!dl) return;
  const doneBibs = new Set(
    state.finishers
      .filter(f => f.action === 'Finish' || f.action === 'DNF')
      .map(f => +f.number)
      .filter(n => n > 0)
  );
  const specials = getAllSpecials().map(([v, label]) =>
    `<option value="${v}">${escHtml(label)}</option>`).join('');
  const entries = getSortedEntries()
    .filter(e => !doneBibs.has(+e.bibNumber))
    .map(e => {
      const label = [e.name, e.category, e.course].filter(Boolean).join(' · ');
      return `<option value="${e.bibNumber}">${escHtml(label)}</option>`;
    }).join('');
  dl.innerHTML = specials + entries;
}

function nextLineLabel() {
  if (state.finishers.length === 0) return '0';
  const sidx = state.finishers.length;
  const isRetire = document.querySelector('input[name="finisher-event-type"]:checked')?.value === 'retire';
  if (isRetire) return `[${sidx}]`;
  const nextSplit = state.finishers.filter(f => f.splitNumber !== null).length + 1;
  return String(nextSplit);
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
  if (lineEl) lineEl.value = lineLabel(timeTargetSidx);
  if (bibEl)  bibEl.value  = f.number > 0 ? String(f.number) : (f.action || '');
  if (prevEl) prevEl.value = getPrevTime(timeTargetSidx);

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
    if (bibEl) { bibEl.value = state.finishers.length === 0 && editingIdx < 0 ? 'Clock' : ''; bibEl.readOnly = false; bibEl.tabIndex = 0; }
    const lineEl = document.getElementById('finisher-line');
    if (lineEl) lineEl.value = nextLineLabel();
    setTimeout(() => document.getElementById('finisher-bib')?.focus(), 0);
  }
}

// ---- Render ----

export function renderFinishers() {
  buildSplitNumbers();

  const all     = getSortedFinishers();
  const seniors = getSortedFinishers(COURSE.SENIORS);
  const juniors = getSortedFinishers(COURSE.JUNIORS);

  const maxBib = Math.max(0, ...getSortedEntries().map(e => +e.bibNumber || 0));
  const isValidFinisher = f => f.number >= 1 && f.number <= maxBib && f.action !== 'Start';

  const seniorExpected = getEntriesOnCourse(COURSE.SENIORS);
  const juniorExpected = getEntriesOnCourse(COURSE.JUNIORS);

  setHTML('finisher-senior-count', `${seniors.filter(isValidFinisher).length} of ${seniorExpected}`);
  setHTML('finisher-junior-count', `${juniors.filter(isValidFinisher).length} of ${juniorExpected}`);

  updateDatalistFinisherBibs();

  // In bibs mode, line field shows next line number; in time mode it shows the target line
  const lineEl = document.getElementById('finisher-line');
  if (lineEl && getCurrentMode() !== 'time') lineEl.value = nextLineLabel();

  if (getCurrentMode() !== 'time') updatePrevTime();

  const eventLabel = f => {
    if (f.action === 'Start' ) return 'Start';
    if (f.action === 'DNF'   ) return 'Retiree';
    if (f.action === 'Finish') return 'Finish';
    if (f.action === 'Clock') {
      if (!f.time) return 'Clock';
      return +f.time.split(':')[0] > 0 ? 'Clock tod' : 'Clock +offset';
    }
    return f.action || '';
  };

  const rows = all.map(f => {
    const sidx      = state.finishers.indexOf(f);
    const numDisplay  = f.number > 0 ? f.number : '';
    const lineDisplay = f.splitNumber !== null ? f.splitNumber : `[${sidx}]`;
    const entry     = f.number > 0 ? getEntry(+f.number) : null;
    const hasError  = f.number > 0 && !entry;
    const banned    = !hasError && entry && isEntryBanned(entry);
    const specialInfo = f.number <= 0
      ? getAllSpecials().find(([v]) => v.toLowerCase() === (f.action || '').toLowerCase())
      : null;
    const nameDisplay = specialInfo
      ? specialInfo[1]
      : escHtml((entry?.name || '') + (banned ? ' (banned)' : ''));
    return { f, sidx, numDisplay, lineDisplay, hasError, banned, nameDisplay, entry, eventLabel: eventLabel(f) };
  });

  renderTable('finishers-tbody', FINISHER_COLS, rows, {
    rowAttrs: r => ({
      'data-sidx': r.sidx,
      class: r.hasError ? 'row-error' : r.banned ? 'row-banned' : '',
    }),
  });

  // Keep time-mode display in sync after any render
  if (getCurrentMode() === 'time') refreshTimeModeDisplay();

  if (editingIdx >= 0) {
    document.querySelector(`#finishers-tbody tr[data-sidx="${editingIdx}"]`)?.classList.add('row-editing');
  }
}

function updatePrevTime() {
  const el = document.getElementById('finisher-prev-time');
  if (el) el.value = getPrevTime(editingIdx >= 0 ? editingIdx : state.finishers.length);
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
  if (lineEl) lineEl.value = lineLabel(sidx);
  if (bibEl)  bibEl.value  = f.number > 0 ? String(f.number)
    : (f.action && f.action !== 'Finish' && f.action !== 'DNF') ? f.action : '';
  if (timeEl) timeEl.value = f.time || '';

  // Show time field in edit mode so the time can be corrected
  const timeField = timeEl?.closest('.form-field');
  if (timeField) timeField.style.display = '';
  const prevField = document.getElementById('finisher-prev-time')?.closest('.form-field');
  if (prevField) prevField.style.display = '';
  const prevEl = document.getElementById('finisher-prev-time');
  if (prevEl) prevEl.value = getPrevTime(sidx);

  const isStart  = f.action === 'Start';
  const isRetire = f.action === 'DNF';
  const startRadio  = document.getElementById('finisher-is-start');
  const finishRadio = document.getElementById('finisher-is-finish');
  const retireRadio = document.getElementById('finisher-is-retire');
  if (startRadio)  startRadio.checked  = isStart;
  if (retireRadio) retireRadio.checked = isRetire;
  if (finishRadio) finishRadio.checked = !isStart && !isRetire;

  document.getElementById('btn-submit-finisher').textContent = 'Update';
  document.getElementById('btn-cancel-finisher-edit').style.display = '';

  document.getElementById('finisher-bib')?.focus();
  const editRow = document.querySelector(`#finishers-tbody tr[data-sidx="${sidx}"]`);
  editRow?.classList.add('row-editing');
  editRow?.scrollIntoView({ block: 'nearest' });
}

function resetFinisherForm() {
  editIsInsert = false;
  editingIdx = -1;
  const bibEl  = document.getElementById('finisher-bib');
  const timeEl = document.getElementById('finisher-time');
  if (bibEl)  bibEl.value  = '';
  if (timeEl) timeEl.value = '';
  const finishRadio = document.getElementById('finisher-is-finish');
  if (finishRadio) finishRadio.checked = true;
  const retireRadio = document.getElementById('finisher-is-retire');
  if (retireRadio) retireRadio.checked = false;
  document.getElementById('btn-submit-finisher').textContent = 'Record';
  document.getElementById('btn-cancel-finisher-edit').style.display = 'none';
  // Re-apply bibs mode appearance (hides time field, restores bib focus)
  applyMode('bibs');
  renderFinishers();
}

// ---- Submit ----

async function submitFinisherForm() {
  const bibEl  = document.getElementById('finisher-bib');
  const timeEl = document.getElementById('finisher-time');

  const rawBib  = (bibEl?.value || '').trim();
  const rawTime = (timeEl?.value || '').trim();
  const radioValue = document.querySelector('input[name="finisher-event-type"]:checked')?.value;
  const isStart  = radioValue === 'start';
  const isRetire = radioValue === 'retire';

  // ---- Time mode ----
  if (getCurrentMode() === 'time') {
    if (timeTargetSidx < 0) { showStatus('No untimed finishers.', true); return; }
    if (!rawTime) { showStatus('Enter a clock time or - to skip.', true); timeEl?.focus(); return; }
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
      const prevTime = getPrevTime(timeTargetSidx);
      if (prevTime && timeToSeconds(parsedTime) < timeToSeconds(prevTime)) {
        showStatus(`Time cannot go backwards (previous: ${prevTime})`, true);
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

  // Determine special action early — Clock records use zero context for time parsing
  const specialAction = getAllSpecials().find(([v]) => v.toLowerCase() === rawBib.toLowerCase())?.[0] ?? null;

  let parsedTime = '';
  if (rawTime) {
    if (rawTime === '-') {
      parsedTime = '-';
    } else {
      // Clock encodes its mode via part count (ss=offset, mm:ss=offset, hh:mm:ss=tod); don't inherit h:m context
      const prevTime = specialAction === 'Clock'
        ? ''
        : getPrevTime(editingIdx >= 0 ? editingIdx : state.finishers.length);
      parsedTime = parseFinishTime(rawTime, prevTime) || '';
      if (!parsedTime) {
        showStatus('Invalid time — use ss, mm:ss, hh:mm:ss or - to skip', true);
        timeEl?.focus();
        return;
      }
      if (specialAction !== 'Clock' && prevTime && timeToSeconds(parsedTime) < timeToSeconds(prevTime)) {
        showStatus(`Time cannot go backwards (previous: ${prevTime})`, true);
        timeEl?.focus();
        return;
      }
    }
  }

  if (!parsedTime) {
    if (isRetire || specialAction === 'Ignore') parsedTime = '-';
    else if (specialAction === 'Clock') parsedTime = '0';
  }

  // Edit mode
  if (editingIdx >= 0) {
    showBusy('Updating…');
    const bib    = specialAction ? 0 : parseInt(rawBib, 10);
    const action = specialAction
      ? specialAction
      : isStart  ? 'Start'
      : isRetire ? 'DNF'
      : 'Finish';
    const result = await updateFinisher(editingIdx, {
      number: isNaN(bib) ? 0 : bib,
      time:   parsedTime,
      action,
    });
    showBusy('');
    if (result.error) { showStatus(result.error, true); bibEl?.focus(); return; }
    const editLabel = specialAction ? rawBib
      : isStart  ? `Start bib ${rawBib}`
      : isRetire ? `Retiree bib ${rawBib}`
      : `Finish bib ${rawBib}`;
    showStatus(`Line ${editingIdx}: ${editLabel} updated`);
    const updatedIdx = editingIdx;
    resetFinisherForm();
    document.querySelector(`#finishers-tbody tr[data-sidx="${updatedIdx}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }

  // Add mode
  showBusy('Recording…');

  let result;
  if (specialAction) {
    result = await recordFinisher(0, parsedTime, specialAction);
  } else {
    const bib = parseInt(rawBib, 10);
    if (isNaN(bib) || bib < 0) {
      showBusy('');
      showStatus('Invalid bib number.', true);
      bibEl?.focus();
      return;
    }
    const action = isStart  ? 'Start'
                 : isRetire ? 'DNF'
                 : 'Finish';
    result = await recordFinisher(bib, parsedTime, action);
  }

  showBusy('');

  if (result.error) {
    showStatus(result.error, true);
    bibEl?.focus();
    return;
  }

  const sfLabel = specialAction ? rawBib
    : isStart  ? `Start bib ${rawBib}`
    : isRetire ? `Retiree bib ${rawBib}`
    : `Finish bib ${rawBib}`;
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
  editIsInsert = true;
  renderFinishers();
  if (result.newIdx >= 0) fillFormForEdit(result.newIdx);
}

// ---- Wire ----

export function wireFinishers() {
  on('btn-submit-finisher',      'click', submitFinisherForm);
  on('btn-cancel-finisher-edit', 'click', async () => {
    const wasInsert = editIsInsert;
    const removeIdx = editingIdx;
    resetFinisherForm(); // clears editIsInsert and editingIdx
    if (wasInsert && removeIdx >= 0) {
      showBusy('Removing…');
      await deleteFinisher(removeIdx);
      showBusy('');
      renderFinishers();
    }
  });

  on('btn-clear-all-finishers', 'click', async () => {
    const n = state.finishers.length;
    if (!n) return;
    if (!await showConfirmDialog(`Clear all ${n} finishers? This cannot be undone.`, 'Clear All', true)) return;
    if (!await showConfirmDialog(`Delete all ${n} finishers permanently?`, 'Yes, delete all', true, true)) return;
    await clearAllFinishers();
    resetFinisherForm();
    renderFinishers();
    showStatus('All finishers cleared.');
  });

  // Mode dropdown
  const modeEl = document.getElementById('finisher-mode');
  if (modeEl) modeEl.addEventListener('change', () => applyMode(modeEl.value));

  // Special code auto-fill: when typed text uniquely matches one special code, complete it
  const bibEl = document.getElementById('finisher-bib');
  if (bibEl) {
    bibEl.addEventListener('input', e => {
      if (e.inputType?.startsWith('delete')) return;
      const typed = bibEl.value;
      if (!typed) return;
      const low = typed.toLowerCase();
      const matches = getAllSpecials().map(([v]) => v).filter(n => n.toLowerCase().startsWith(low));
      if (matches.length === 1 && matches[0].toLowerCase() !== low) {
        const pos = typed.length;
        bibEl.value = matches[0];
        bibEl.setSelectionRange(pos, matches[0].length);
      }
    });
  }

  // Tab cycling and Enter submit within form
  wireFormFocusTrap('finisher-form-fields', submitFinisherForm);

  // Keep line field in sync with action radio selection when in add mode
  document.querySelectorAll('input[name="finisher-event-type"]').forEach(r => {
    r.addEventListener('change', () => {
      if (editingIdx >= 0 || getCurrentMode() === 'time') return;
      const lineEl = document.getElementById('finisher-line');
      if (lineEl) lineEl.value = nextLineLabel();
    });
  });

  // Initialize to bibs mode
  applyMode('bibs');

  document.getElementById('finishers-tbody')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const sidx = +btn.closest('[data-sidx]')?.dataset.sidx;
    switch (btn.dataset.action) {
      case 'edit':
        if (!await showConfirmDialog(`Edit finisher at line ${sidx}?`, 'Edit')) return;
        fillFormForEdit(sidx);
        break;
      case 'ins':
        confirmInsertAbove(sidx);
        break;
      case 'del':
        confirmDeleteFinisher(sidx);
        break;
    }
  });
}