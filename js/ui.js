'use strict';

import { state } from './state.js';
import { getMaleCategories, getFemaleCategories } from './categories.js';
import { normaliseDate, normaliseTime } from './utils.js';

// ---- DOM helpers ----

export function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

export function val(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  return el.value || '';
}

export function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function fillForm(formId, data) {
  for (const [id, value] of Object.entries(data)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value !== undefined ? value : '';
  }
}

export function clearForm(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('input,select,textarea').forEach(el => {
    if (el.type === 'checkbox') el.checked = false;
    else el.value = '';
  });
}

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function updateBannerEventName(name) {
  const el = document.getElementById('home-event-name-header');
  if (el) el.textContent = name || '';
}

export function showStatus(msg, isError = false) {
  const cls = isError ? 'status-error' : 'status-ok';

  const bar = document.getElementById('status-message');
  if (bar) {
    bar.textContent = msg;
    bar.className = cls;
    setTimeout(() => { if (bar.textContent === msg) bar.textContent = ''; }, 10000);
  }

  const inlineEls = document.querySelectorAll('.view-status-msg');
  for (const el of inlineEls) {
    el.textContent = msg;
    el.className = `entry-status view-status-msg ${cls}`;
    el.hidden = !msg;
    setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.hidden = true; } }, 10000);
  }
}

export function showConfirmDialog(message, confirmLabel = 'Confirm', danger = false, focusCancel = false) {
  return showChoiceDialog(message, [{ label: confirmLabel, value: true, danger }], { focusCancel })
    .then(v => v === true);
}

export function showChoiceDialog(message, choices, { focusCancel = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'choice-dialog-overlay';

    const box = document.createElement('div');
    box.className = 'choice-dialog-box';

    const msg = document.createElement('p');
    msg.className = 'choice-dialog-msg';
    msg.textContent = message;
    box.appendChild(msg);

    const btns = document.createElement('div');
    btns.className = 'choice-dialog-btns';

    const close = value => {
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };

    for (const { label, value, danger } of choices) {
      const btn = document.createElement('button');
      btn.className = danger ? 'btn btn-delete' : 'btn';
      btn.textContent = label;
      btn.addEventListener('click', () => close(value));
      btns.appendChild(btn);
    }

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(null));
    if (focusCancel) btns.prepend(cancel); else btns.appendChild(cancel);

    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    setTimeout(() => (focusCancel ? cancel : btns.querySelector('button'))?.focus(), 0);
  });
}

export async function pickFile(accept = '*') {
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

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function sanitise(name) {
  return (name || 'race').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function updateDatalistNames() {
  const dl = document.getElementById('datalist-names');
  if (!dl) return;
  const names = [...new Set(state.people.map(p => p.name).filter(Boolean))].sort();
  dl.innerHTML = names.map(n => `<option value="${escHtml(n)}">`).join('');
}

export function updateDatalistClubs() {
  const dl = document.getElementById('datalist-clubs');
  if (!dl) return;
  const clubs = [...new Set(state.people.map(p => p.club).filter(Boolean))].sort();
  dl.innerHTML = clubs.map(c => `<option value="${escHtml(c)}">`).join('');
}

export function updateDatalistRoles() {
  const dl = document.getElementById('datalist-roles');
  if (!dl) return;
  const roles = [...new Set(state.roles.map(r => r.role).filter(Boolean))].sort();
  dl.innerHTML = roles.map(r => `<option value="${escHtml(r)}">`).join('');
}

// Normalise date/time inputs on blur — delegated so it covers dynamically created inputs too
document.addEventListener('focusout', e => {
  const el = e.target;
  const type = el.dataset?.normalise;
  if (!type || el.tagName !== 'INPUT') return;
  const raw = el.value.trim();
  if (!raw) return;
  if (type === 'date') { const n = normaliseDate(raw); if (n) el.value = n; }
  if (type === 'time') { const n = normaliseTime(raw); if (n) el.value = n; }
});

export function populateCategoryDropdown(selectId, currentVal) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const all = [
    ...getMaleCategories().map(c => ({ value: c, label: c })),
    ...getFemaleCategories().map(c => ({ value: c, label: c })),
  ];
  // Deduplicate
  const seen = new Set();
  const opts = all.filter(o => { if (seen.has(o.value)) return false; seen.add(o.value); return true; });
  el.innerHTML = `<option value="">— select —</option>` +
    opts.map(o => `<option value="${o.value}"${o.value === currentVal ? ' selected' : ''}>${o.label}</option>`).join('');
}

export function wireNameTypeahead(nameEl, { onSelect, onClear }) {
  if (!nameEl) return;
  const dropdown = document.createElement('ul');
  dropdown.className = 'name-typeahead';
  dropdown.hidden = true;
  const nameWrapper = nameEl.closest('.form-field');
  nameWrapper.style.position = 'relative';
  nameWrapper.appendChild(dropdown);

  let currentMatches = [];
  let deletingText   = false;

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
        onSelect(p);
        closeDropdown();
      })
    );
  };

  nameEl.addEventListener('input', () => {
    const raw   = nameEl.value;
    const typed = raw.trim();
    if (!typed) {
      currentMatches = [];
      deletingText   = false;
      closeDropdown();
      onClear();
      return;
    }
    const hasTrailingSpace = raw.endsWith(' ');
    const low = typed.toLowerCase();
    currentMatches = state.people.filter(p => (p.name || '').toLowerCase().startsWith(low));
    if (currentMatches.length === 1 && !deletingText && !hasTrailingSpace && typed.length < currentMatches[0].name.length) {
      const s = nameEl.selectionStart;
      nameEl.value = currentMatches[0].name;
      nameEl.setSelectionRange(s, currentMatches[0].name.length);
      onSelect(currentMatches[0]);
    } else if (currentMatches.length === 1 && !hasTrailingSpace) {
      onSelect(currentMatches[0]);
    } else if (!currentMatches.length) {
      onClear();
    }
    deletingText = false;
    showDropdown();
  });

  nameEl.addEventListener('keydown', e => {
    deletingText = (e.key === 'Backspace' || e.key === 'Delete');
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
      onSelect(p);
      closeDropdown();
      nameEl.focus();
    }
    else if (e.key === 'Escape') { closeDropdown(); nameEl.focus(); }
  });

  nameEl.addEventListener('change', () => {
    const typed = nameEl.value.trim();
    if (!typed) return;
    const exact = state.people.find(p => (p.name || '').toLowerCase() === typed.toLowerCase());
    if (exact) onSelect(exact);
  });

  nameEl.addEventListener('blur', () => setTimeout(() => {
    if (dropdown.contains(document.activeElement)) return;
    const typed = nameEl.value.trim();
    if (!typed) { onClear(); currentMatches = []; }
    else if (currentMatches.length === 1) { nameEl.value = currentMatches[0].name; onSelect(currentMatches[0]); }
    closeDropdown();
  }, 150));
}

export function clearRowEditing(tbodyId) {
  document.querySelectorAll(`#${tbodyId} .row-editing`).forEach(r => r.classList.remove('row-editing'));
}

export function wireFormFocusTrap(containerId, onEnter) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      await onEnter();
    } else if (e.key === 'Tab') {
      const focusable = [...container.querySelectorAll(
        'input:not([disabled]), select:not([disabled]), button:not([disabled])'
      )].filter(el => el.offsetParent !== null && el.tabIndex !== -1);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });
}

export function wireTabBar(tabBarId, panelIdPrefix, dataAttr) {
  const bar = document.getElementById(tabBarId);
  if (!bar) return;
  bar.querySelectorAll(`[${dataAttr}]`).forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = bar.closest('.view') || document;
      view.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`${panelIdPrefix}${btn.getAttribute(dataAttr)}`)?.classList.add('active');
    });
  });
}