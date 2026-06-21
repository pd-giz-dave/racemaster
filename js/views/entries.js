'use strict';

import { state } from '../state.js';
import {
  findEntryByBib, findEntryByDibber, getEntry,
  submitEntry, updateEntry, clearAllEntries, deleteEntryAndRenumber, insertEntryAndRenumber,
  getSortedEntries, exportSITimingCSV, isEntryBanned,
} from '../entries.js';

import { getNextBibNumber, getNextDibberNumber, normaliseGender } from '../data.js';
import { calculateCategory, calculateCourse } from '../categories.js';
import { COURSE } from '../constants.js';
import { cleanName, capitalise, showBusy, normaliseClub } from '../utils.js';
import { usingDibbers } from '../time-utils.js';
import {
  val, fillForm, clearForm, on, setHTML, showStatus, showConfirmDialog, escHtml,
  populateCategoryDropdown, updateDatalistNames, updateDatalistClubs,
  downloadText, sanitise, wireFormFocusTrap, clearRowEditing, wireNameTypeahead,
  renderTable,
} from '../ui.js';
import { TABLES } from '../locale.js';
import { renderHome } from './home.js';

const ENTRY_COLS = (() => {
  const m = TABLES.entries;
  return [
    { ...m[0], render: e => e.bibNumber },
    { ...m[1], render: e => escHtml(e.name || '') + (isEntryBanned(e) ? ' (banned)' : '') },
    { ...m[2], render: e => escHtml(e.club || '') },
    { ...m[3], render: e => e.dob || '' },
    { ...m[4], render: e => e.category || '' },
    { ...m[5], render: e => e.course || '' },
    { ...m[6], render: e => e.dibberNumber || '' },
    { ...m[7], render: e => e.preEntry || '' },
    { ...m[8], render: () => `
      <button class="btn-sm btn-edit" data-action="edit">Edit</button>
      <button class="btn-sm btn-insert-above-entry" data-action="ins">Ins ↑</button>
      <button class="btn-sm btn-delete-entry" data-action="del">Del</button>` },
  ];
})();

// ---- Module state ----

export let editingBib  = 0;
let insertingAtBib = 0;
let overrideBan    = false;

// ---- Render ----

export function renderEntries() {
  const entries = getSortedEntries();
  renderTable('entries-tbody', ENTRY_COLS, entries, {
    rowAttrs: e => ({
      'data-bib': e.bibNumber,
      class: isEntryBanned(e) ? 'row-banned' : '',
    }),
  });

  const juniorCount  = entries.filter(e => e.course === COURSE.JUNIORS).length;
  const seniorCount  = entries.length - juniorCount;
  setHTML('entry-senior-count', seniorCount);
  setHTML('entry-junior-count', juniorCount);
  populateCategoryDropdown('entry-form-category', '');
  populateCategoryDropdown('entry-edit-category', '');
  updateDatalistNames();
  updateDatalistClubs();

  const bibEl = document.getElementById('entry-form-bib');
  if (bibEl && document.activeElement !== bibEl && !editingBib) bibEl.value = getNextBibNumber();
  const dibEl = document.getElementById('entry-form-dibber');
  if (dibEl && document.activeElement !== dibEl && !editingBib) updateDibberField();

  const activeBib = editingBib || insertingAtBib;
  if (activeBib) {
    document.querySelector(`#entries-tbody tr[data-bib="${activeBib}"]`)?.classList.add('row-editing');
  }
}

// ---- Entry form helpers ----

export function autoFillCategory() {
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

export function updateDibberField() {
  const dibEl = document.getElementById('entry-form-dibber');
  if (!dibEl || document.activeElement === dibEl || editingBib) return;
  const course = val('entry-form-course') || COURSE.SENIORS;
  dibEl.value = usingDibbers(course) ? (getNextDibberNumber() || '') : '';
}

export function isEntryFormDirty() {
  const container = document.getElementById('entry-form-fields');
  if (!container) return false;
  return [...container.querySelectorAll('input:not([type="checkbox"]):not(#entry-form-bib), select')]
    .some(el => el.value.trim() !== '');
}

export function fillFormForEdit(bib) {
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
  });
  document.getElementById('entry-form-bib')?.removeAttribute('tabindex');
  document.getElementById('entry-form-dibber')?.removeAttribute('tabindex');
  document.getElementById('btn-submit-entry').textContent = 'Update';
  document.getElementById('btn-cancel-edit').style.display = '';
  document.getElementById('entry-form-peno')?.focus();
  const editRow = document.querySelector(`#entries-tbody tr[data-bib="${bib}"]`);
  editRow?.classList.add('row-editing');
  editRow?.scrollIntoView({ block: 'nearest' });
}

export function resetEntryForm() {
  editingBib = 0;
  insertingAtBib = 0;
  clearRowEditing('entries-tbody');
  clearForm('entry-form-fields');
  const bibEl = document.getElementById('entry-form-bib');
  if (bibEl) { bibEl.value = getNextBibNumber(); bibEl.setAttribute('tabindex', '-1'); }
  const dibEl = document.getElementById('entry-form-dibber');
  if (dibEl) dibEl.setAttribute('tabindex', '-1');
  updateDibberField();
  document.getElementById('btn-submit-entry').textContent = 'Register';
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (cancelBtn) { cancelBtn.style.display = 'none'; cancelBtn.textContent = 'Cancel Edit'; }
}


// ---- Insert before row ----

function fillFormForInsert(bib) {
  const freeDibber = state.entries.find(e => +e.bibNumber === bib)?.dibberNumber || '';
  insertingAtBib = bib;
  clearForm('entry-form-fields');
  const bibEl = document.getElementById('entry-form-bib');
  if (bibEl) { bibEl.value = bib; bibEl.setAttribute('tabindex', '-1'); }
  const dibEl = document.getElementById('entry-form-dibber');
  if (dibEl) { dibEl.value = freeDibber; dibEl.setAttribute('tabindex', '-1'); }
  document.getElementById('btn-submit-entry').textContent = 'Insert';
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (cancelBtn) { cancelBtn.style.display = ''; cancelBtn.textContent = 'Cancel Insert'; }
  document.getElementById('entry-form-peno')?.focus();
  document.querySelector(`#entries-tbody tr[data-bib="${bib}"]`)?.classList.add('row-editing');
}

async function confirmInsertBefore(bib) {
  const count = getSortedEntries().filter(e => +e.bibNumber >= bib).length;
  if (!await showConfirmDialog(
    `Insert a new entry before bib ${bib}?\n${count} entr${count === 1 ? 'y' : 'ies'} will be renumbered.`,
    'Insert & Renumber')) return;
  renderEntries();
  fillFormForInsert(bib);
  showStatus(`Fill in the form for bib ${bib} and submit to confirm.`);
}

// ---- Delete from row ----

async function deleteEntryAndRenumberHandler(bib) {
  const e = getEntry(bib);
  if (!e) return;
  if (!await showConfirmDialog(
    `Delete bib ${bib} (${e.name}) and renumber all subsequent entries?`,
    'Delete & Renumber', true)) return;
  showBusy('Deleting…');
  const result = await deleteEntryAndRenumber(bib);
  showBusy('');
  if (result.error) { showStatus(result.error, true); return; }
  showStatus(`Bib ${bib} deleted; subsequent entries renumbered.`);
  renderEntries();
  renderHome();
  document.getElementById('entry-form-peno')?.focus();
}

// ---- Main submit ----

export async function submitEntryForm() {
  // Existing-bib / existing-dibber checks — may redirect to edit mode before anything else
  if (!editingBib && !insertingAtBib) {
    const typedBib = +val('entry-form-bib') || 0;
    if (typedBib > 0 && findEntryByBib(typedBib) >= 0) {
      if (await showConfirmDialog(`Bib ${typedBib} is already registered. Edit that entry?`, 'Edit')) {
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
        if (await showConfirmDialog(`Dibber ${typedDibber} is already assigned to bib ${clashBib}. Edit that entry?`, 'Edit')) {
          fillFormForEdit(clashBib);
        } else {
          document.getElementById('entry-form-dibber').value = getNextDibberNumber() || '';
        }
        return;
      }
    }
  }

  // Skip-bib confirmation (new entries only)
  if (!editingBib && !insertingAtBib) {
    const typedBib = +val('entry-form-bib') || 0;
    const next = getNextBibNumber();
    if (typedBib > next && !await showConfirmDialog(`Bib ${typedBib} skips ${typedBib - next} number(s). Confirm?`, 'Confirm')) {
      document.getElementById('entry-form-bib').value = next;
      return;
    }
  }

  const formData = {
    name:        val('entry-form-name'),
    gender:      val('entry-form-gender'),
    dob:         val('entry-form-dob'),
    club:        normaliseClub(val('entry-form-club')),
    fraNumber:   val('entry-form-fra'),
    category:    val('entry-form-category'),
    course:      val('entry-form-course'),
    preEntry:    val('entry-form-peno'),
    bibOverride:    +val('entry-form-bib')    || 0,
    dibberOverride: +val('entry-form-dibber') || 0,
    overrideBan,
  };
  overrideBan = false;
  const isEdit   = editingBib > 0;
  const isInsert = insertingAtBib > 0;
  showBusy(isEdit ? 'Updating…' : isInsert ? 'Inserting…' : 'Registering…');
  const result = isEdit
    ? await updateEntry(editingBib, formData)
    : isInsert
      ? await insertEntryAndRenumber(insertingAtBib, formData)
      : await submitEntry(formData);
  showBusy('');
  if (result.bannedWarning) {
    const name = formData.name || '';
    const ok = await showConfirmDialog(
      `${name} is banned until ${result.bannedWarning}.\n\nThey may enter but will be excluded from results and the Race Organiser must be informed.\n\nContinue?`,
      'Enter anyway',
      true,
    );
    if (!ok) return;
    overrideBan = true;
    return submitEntryForm();
  }
  if (result.error) {
    showStatus(result.error, true);
    focusEntryErrorField(result.error);
  } else {
    const bib = isEdit ? editingBib : result.bibNumber;
    showStatus(isEdit ? `Bib ${bib} updated.` : isInsert ? `Bib ${bib} inserted; subsequent entries renumbered.` : `Bib ${bib} registered.`);
    resetEntryForm();
    document.getElementById('entry-form-peno')?.focus();
    renderEntries();
    document.querySelector(`#entries-tbody tr[data-bib="${bib}"]`)?.scrollIntoView({ block: 'nearest' });
    renderHome();
  }
}

// ---- SI Timing export ----

async function runExportSITiming() {
  const { formatCSV } = await import('../csv.js');
  const { SI_TIMING_COL_NAMES } = await import('../constants.js');
  const rows = exportSITimingCSV(getSortedEntries());
  const csv  = formatCSV(rows, Object.values(SI_TIMING_COL_NAMES));
  downloadText(csv, `${sanitise(state.event.name)}_registrations.csv`);
  showStatus('SI timing file downloaded.');
}

function focusEntryErrorField(error) {
  let id = 'entry-form-name';
  if      (/gender/i.test(error))    id = 'entry-form-gender';
  else if (/birth|dob/i.test(error)) id = 'entry-form-dob';
  else if (/\bbib\b/i.test(error))   id = 'entry-form-bib';
  else if (/dibber/i.test(error))    id = 'entry-form-dibber';
  document.getElementById(id)?.focus();
}

// ---- Wire ----

export function wireEntries() {
  on('btn-submit-entry', 'click', submitEntryForm);

  on('btn-cancel-edit', 'click', () => {
    resetEntryForm();
    document.getElementById('entry-form-peno')?.focus();
  });

  on('btn-reset-entry', 'click', () => {
    resetEntryForm();
    document.getElementById('entry-form-peno')?.focus();
  });

  // SI Timing export
  on('btn-export-entries-si', 'click', runExportSITiming);

  on('btn-clear-all-entries', 'click', async () => {
    const n = getSortedEntries().length;
    if (!n) return;
    if (!await showConfirmDialog(`Clear all ${n} entries? This cannot be undone.`, 'Clear All', true)) return;
    if (!await showConfirmDialog(`Delete all ${n} entries permanently?`, 'Yes, delete all', true, true)) return;
    await clearAllEntries();
    resetEntryForm();
    renderEntries();
    renderHome();
    showStatus('All entries cleared.');
  });

  // Pre-entry number field: redirect to name on first letter, else lookup pre-entry
  const penoEl = document.getElementById('entry-form-peno');
  if (penoEl) {
    penoEl.addEventListener('keydown', e => {
      // If nothing typed yet and a letter key is pressed, jump to name field with that char
      if (penoEl.value === '' && e.key.length === 1 && /[a-zA-Z]/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const nameField = document.getElementById('entry-form-name');
        if (nameField) {
          nameField.value = e.key;
          nameField.focus();
          nameField.dispatchEvent(new Event('input'));
        }
      }
    });
    penoEl.addEventListener('input', () => {
      const num = penoEl.value.trim();
      const pe = (num && /^\d+$/.test(num))
        ? state.preEntries.find(p => String(p.participantNumber).trim() === num)
        : null;
      if (!pe) {
        fillForm('', {
          'entry-form-name': '', 'entry-form-gender': '',
          'entry-form-dob':  '', 'entry-form-club':   '', 'entry-form-fra': '',
        });
        return;
      }
      const name = cleanName(`${pe.firstName || ''} ${pe.lastName || ''}`.trim());
      const gender = normaliseGender(pe.gender);
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

  // Name field: live typeahead against people database; ↓ opens disambiguation list for duplicate names
  const entryFields = { 'entry-form-gender': '', 'entry-form-dob': '', 'entry-form-club': '', 'entry-form-fra': '' };
  const fillEntryFromPerson = p => {
    fillForm('', {
      'entry-form-gender': normaliseGender(p.gender),
      'entry-form-dob':    p.dob       || '',
      'entry-form-club':   p.club      || '',
      'entry-form-fra':    p.fraNumber || '',
    });
    autoFillCategory();
  };
  wireNameTypeahead(document.getElementById('entry-form-name'), {
    onSelect:  fillEntryFromPerson,
    onClear:   () => fillForm('', entryFields),
  });

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

  // Club field: autofill when typed text becomes unambiguous
  const clubEl = document.getElementById('entry-form-club');
  if (clubEl) {
    let clubDeleting = false;
    clubEl.addEventListener('keydown', e => { clubDeleting = (e.key === 'Backspace' || e.key === 'Delete'); });
    clubEl.addEventListener('input', () => {
      const raw   = clubEl.value;
      const typed = raw.trim();
      if (!typed) { clubDeleting = false; return; }
      const low = typed.toLowerCase();
      const clubs = [...new Set(state.people.map(p => p.club).filter(Boolean))];
      const matches = clubs.filter(c => c.toLowerCase().startsWith(low));
      if (matches.length === 1 && !clubDeleting && !raw.endsWith(' ') && typed.length < matches[0].length) {
        const s = clubEl.selectionStart;
        clubEl.value = matches[0];
        clubEl.setSelectionRange(s, matches[0].length);
      }
      clubDeleting = false;
    });
  }

  // Category auto-fill in entry form
  on('entry-form-dob',    'change', autoFillCategory);
  on('entry-form-gender', 'change', autoFillCategory);
  on('entry-form-course', 'change', updateDibberField);

  // Entry form keyboard handling: Enter=submit, Esc=home if clean, Tab=wrap focus
  wireFormFocusTrap('entry-form-fields', submitEntryForm);

  document.getElementById('entries-tbody')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const bib = +btn.closest('[data-bib]')?.dataset.bib;
    switch (btn.dataset.action) {
      case 'edit': {
        const entry = getEntry(bib);
        if (!entry || !await showConfirmDialog(`Edit bib ${bib} (${entry.name})?`, 'Edit')) return;
        fillFormForEdit(bib);
        break;
      }
      case 'ins':
        confirmInsertBefore(bib);
        break;
      case 'del':
        deleteEntryAndRenumberHandler(bib);
        break;
    }
  });
}