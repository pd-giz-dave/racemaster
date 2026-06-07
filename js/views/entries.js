'use strict';

import { state } from '../state.js';
import {
  findEntryByBib, findEntryByDibber, getEntry,
  submitEntry, updateEntry, deleteEntriesFrom,
  getSortedEntries,
} from '../entries.js';
import { getNextBibNumber, getNextDibberNumber } from '../data.js';
import { calculateCategory, calculateCourse } from '../categories.js';
import { COURSE } from '../constants.js';
import { iequal, cleanName, capitalise, showBusy } from '../utils.js';
import { usingDibbers } from '../time-utils.js';
import { exportSITimingCSV } from '../si-results.js';
import {
  val, fillForm, clearForm, on, setHTML, showStatus, confirm,
  populateCategoryDropdown, updateDatalistNames, updateDatalistClubs,
  downloadText, sanitise, escHtml,
} from '../ui.js';
import { renderHome } from './home.js';

// ---- Module state ----

export let editingBib = 0;

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
      <td>${e.startTime || ''}</td>
      <td>${e.retired === 'Y' ? 'DNF' : ''}</td>
      <td>
        <button class="btn-sm btn-edit"         data-bib="${e.bibNumber}">Edit</button>
        <button class="btn-sm btn-delete-entry" data-bib="${e.bibNumber}">Del from here</button>
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
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => deleteFromEntry(+b.dataset.bib)));

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
  document.getElementById('entry-form-name')?.focus();
}

export function resetEntryForm() {
  editingBib = 0;
  clearForm('entry-form-fields');
  const bibEl = document.getElementById('entry-form-bib');
  if (bibEl) { bibEl.value = getNextBibNumber(); bibEl.setAttribute('tabindex', '-1'); }
  const dibEl = document.getElementById('entry-form-dibber');
  if (dibEl) dibEl.setAttribute('tabindex', '-1');
  updateDibberField();
  document.getElementById('btn-submit-entry').textContent = 'Register';
  document.getElementById('btn-cancel-edit').style.display = 'none';
}


// ---- Delete from row ----

async function deleteFromEntry(bib) {
  const entries = getSortedEntries();
  const count = entries.filter(e => +e.bibNumber >= bib).length;
  if (!confirm(`Delete ${count} entr${count === 1 ? 'y' : 'ies'} from bib ${bib} onwards?`)) return;
  showBusy('Deleting…');
  const removed = await deleteEntriesFrom(bib);
  showBusy('');
  showStatus(`${removed} entr${removed === 1 ? 'y' : 'ies'} deleted.`);
  renderEntries();
  renderHome();
}

// ---- Main submit ----

export async function submitEntryForm() {
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

// ---- SI Timing export ----

async function runExportSITiming() {
  const { formatCSV } = await import('../csv.js');
  const { SI_TIMING_COL_NAMES } = await import('../constants.js');
  const rows = exportSITimingCSV(getSortedEntries());
  const csv  = formatCSV(rows, Object.values(SI_TIMING_COL_NAMES));
  downloadText(csv, `${sanitise(state.event.name)}_SI_Timing.csv`);
  showStatus('SI timing file downloaded.');
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
      if (currentMatches.length) {
        fillFromPerson(currentMatches[0]);
      } else {
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
      } else if (currentMatches.length > 0) {
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
        if (!isEntryFormDirty()) {
          window.dispatchEvent(new CustomEvent('rm:navigate', { detail: 'home' }));
        }
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
}