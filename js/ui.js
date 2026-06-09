'use strict';

import { state } from './state.js';
import { getMaleCategories, getFemaleCategories, getPairCategories } from './categories.js';
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

export function showConfirmDialog(message, confirmLabel = 'Confirm', danger = false) {
  return showChoiceDialog(message, [{ label: confirmLabel, value: true, danger }])
    .then(v => v === true);
}

export function showChoiceDialog(message, choices) {
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
    btns.appendChild(cancel);

    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    setTimeout(() => btns.querySelector('button')?.focus(), 0);
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
  const clubs = [...new Set(state.clubs.map(c => c.name).filter(Boolean))].sort();
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
    ...getPairCategories().map(c => ({ value: c, label: c })),
  ];
  // Deduplicate
  const seen = new Set();
  const opts = all.filter(o => { if (seen.has(o.value)) return false; seen.add(o.value); return true; });
  el.innerHTML = `<option value="">— select —</option>` +
    opts.map(o => `<option value="${o.value}"${o.value === currentVal ? ' selected' : ''}>${o.label}</option>`).join('');
}