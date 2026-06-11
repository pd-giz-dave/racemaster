'use strict';

import { state } from '../state.js';
import {
  findEntryByBib, findEntryByDibber, getEntry,
  submitEntry, updateEntry, clearAllEntries, deleteEntryAndRenumber, insertEntryAndRenumber,
  getSortedEntries, exportSITimingCSV,
} from '../entries.js';
import { getNextBibNumber, getNextDibberNumber } from '../data.js';
import { calculateCategory, calculateCourse } from '../categories.js';
import { COURSE } from '../constants.js';
import { iequal, cleanName, capitalise, showBusy } from '../utils.js';
import { usingDibbers } from '../time-utils.js';
import {
  val, fillForm, clearForm, on, setHTML, showStatus, showConfirmDialog,
  populateCategoryDropdown, updateDatalistNames, updateDatalistClubs,
  downloadText, sanitise, escHtml,
} from '../ui.js';
import { renderHome } from './home.js';

// ---- Module state ----

export let editingBib  = 0;
let insertingAtBib = 0;

// ---- Render ----

export function renderEntries() {
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
      <td>
        <button class="btn-sm btn-edit"                 data-bib="${e.bibNumber}">Edit</button>
        <button class="btn-sm btn-insert-above-entry"  data-bib="${e.bibNumber}">Ins ↑</button>
        <button class="btn-sm btn-delete-entry"        data-bib="${e.bibNumber}">Del</button>
      </td>
    </tr>`).join('');

  // Wire row action buttons
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', async () => {
      const bib = +b.dataset.bib;
      const e = getEntry(bib);
      if (!e || !await showConfirmDialog(`Edit bib ${bib} (${e.name})?`, 'Edit')) return;
      fillFormForEdit(bib);
    }));
  tbody.querySelectorAll('.btn-insert-above-entry').forEach(b =>
    b.addEventListener('click', () => confirmInsertBefore(+b.dataset.bib)));
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => deleteEntryAndRenumberHandler(+b.dataset.bib)));

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
    'entry-form-confirm':  false,
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
  document.querySelectorAll('#entries-tbody .row-editing')
    .forEach(r => r.classList.remove('row-editing'));
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

  if (!document.getElementById('entry-form-confirm')?.checked) {
    showStatus('Check the confirmation box before registering.', true);
    document.getElementById('entry-form-confirm')?.focus();
    return;
  }

  // Skip-bib confirmation after checkbox (new entries only)
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
    club:        val('entry-form-club'),
    fraNumber:   val('entry-form-fra'),
    category:    val('entry-form-category'),
    course:      val('entry-form-course'),
    preEntry:    val('entry-form-peno'),
    bibOverride:    +val('entry-form-bib')    || 0,
    dibberOverride: +val('entry-form-dibber') || 0,
  };
  const isEdit   = editingBib > 0;
  const isInsert = insertingAtBib > 0;
  showBusy(isEdit ? 'Updating…' : isInsert ? 'Inserting…' : 'Registering…');
  const result = isEdit
    ? await updateEntry(editingBib, formData)
    : isInsert
      ? await insertEntryAndRenumber(insertingAtBib, formData)
      : await submitEntry(formData);
  showBusy('');
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
  downloadText(csv, `${sanitise(state.event.name)}_SI_Timing.csv`);
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

  // Name field: live typeahead against people database; ↓ opens disambiguation list for duplicate names
  const nameEl = document.getElementById('entry-form-name');
  if (nameEl) {
    const dropdown = document.createElement('ul');
    dropdown.className = 'name-typeahead';
    dropdown.hidden = true;
    const nameWrapper = nameEl.closest('.form-field');
    nameWrapper.style.position = 'relative';
    nameWrapper.appendChild(dropdown);

    let currentMatches = [];

    const normGender = g => {
      const u = (g || '').toUpperCase().trim();
      return u === 'M' || u === 'MALE' ? 'M' : u === 'F' || u === 'FEMALE' ? 'F' : u === 'P' || u === 'PAIR' ? 'P' : '';
    };

    const fillFromPerson = p => {
      fillForm('', {
        'entry-form-gender': normGender(p.gender),
        'entry-form-dob':    p.dob       || '',
        'entry-form-club':   p.club      || '',
        'entry-form-fra':    p.fraNumber || '',
      });
      autoFillCategory();
    };

    const closeDropdown = () => { dropdown.hidden = true; dropdown.innerHTML = ''; };

    const showDropdown = () => {
      if (currentMatches.length < 2) { closeDropdown(); return; }
      dropdown.innerHTML = currentMatches.map((p, i) => {
        const detail = [p.dob, p.club].filter(Boolean).join(' – ');
        return `<li data-i="${i}" tabindex="-1">${escHtml(p.name)}${detail ? ` <span class="text-muted text-sm">(${escHtml(detail)})</span>` : ''}</li>`;
      }).join('');
      dropdown.hidden = false;
      dropdown.querySelectorAll('li').forEach(li =>
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          const p = currentMatches[+li.dataset.i];
          nameEl.value = p.name;
          fillFromPerson(p);
          closeDropdown();
        })
      );
    };

    nameEl.addEventListener('input', () => {
      const typed = nameEl.value.trim();
      if (!typed) {
        currentMatches = [];
        closeDropdown();
        fillForm('', { 'entry-form-gender': '', 'entry-form-dob': '', 'entry-form-club': '', 'entry-form-fra': '' });
        return;
      }
      const low = typed.toLowerCase();
      currentMatches = state.people.filter(p => (p.name || '').toLowerCase().startsWith(low));
      if (currentMatches.length === 1) {
        const s = nameEl.selectionStart;
        nameEl.value = currentMatches[0].name;
        nameEl.setSelectionRange(s, currentMatches[0].name.length);
        fillFromPerson(currentMatches[0]);
      } else if (!currentMatches.length) {
        fillForm('', { 'entry-form-gender': '', 'entry-form-dob': '', 'entry-form-club': '', 'entry-form-fra': '' });
      }
      showDropdown();
    });

    nameEl.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && currentMatches.length > 1) {
        e.preventDefault();
        showDropdown();
        dropdown.querySelector('li')?.focus();
      }
    });

    dropdown.addEventListener('keydown', e => {
      const items = [...dropdown.querySelectorAll('li')];
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx > 0 ? items[idx - 1].focus() : nameEl.focus(); }
      else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault(); e.stopPropagation();
        const p = currentMatches[idx];
        nameEl.value = p.name;
        fillFromPerson(p);
        closeDropdown();
        nameEl.focus();
      }
      else if (e.key === 'Escape') { closeDropdown(); nameEl.focus(); }
    });

    nameEl.addEventListener('change', () => {
      const typed = nameEl.value.trim();
      if (!typed) return;
      const exact = state.people.find(p => iequal(p.name, typed));
      if (exact) fillFromPerson(exact);
    });

    nameEl.addEventListener('blur', () => setTimeout(() => {
      if (dropdown.contains(document.activeElement)) return; // user navigating dropdown
      const typed = nameEl.value.trim();
      if (!typed) {
        fillForm('', { 'entry-form-gender': '', 'entry-form-dob': '', 'entry-form-club': '', 'entry-form-fra': '' });
        currentMatches = [];
      } else if (currentMatches.length === 1) {
        nameEl.value = currentMatches[0].name;
        fillFromPerson(currentMatches[0]);
      }
      closeDropdown();
    }, 150));
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

  // Club field: autofill when typed text becomes unambiguous
  const clubEl = document.getElementById('entry-form-club');
  if (clubEl) {
    clubEl.addEventListener('input', () => {
      const typed = clubEl.value.trim();
      if (!typed) return;
      const low = typed.toLowerCase();
      const clubs = [...new Set(state.people.map(p => p.club).filter(Boolean))];
      const matches = clubs.filter(c => c.toLowerCase().startsWith(low));
      if (matches.length === 1) {
        const s = clubEl.selectionStart;
        clubEl.value = matches[0];
        clubEl.setSelectionRange(s, matches[0].length);
      }
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
      } else if (e.key === 'Tab') {
        const focusable = [...formContainer.querySelectorAll(
          'input:not([disabled]), select:not([disabled]), button:not([disabled])'
        )].filter(el => el.offsetParent !== null);
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