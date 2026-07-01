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

export function notImplemented() {
  return showConfirmDialog('Feature not yet implemented', 'OK');
}

export function showChoiceDialog(message, choices, { focusCancel = false, vertical = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'choice-dialog-overlay';

    const box = document.createElement('div');
    box.className = vertical ? 'choice-dialog-box choice-dialog-box--wide' : 'choice-dialog-box';

    const msg = document.createElement('p');
    msg.className = 'choice-dialog-msg';
    msg.textContent = message;
    box.appendChild(msg);

    const btns = document.createElement('div');
    btns.className = vertical ? 'choice-dialog-btns choice-dialog-btns--vertical' : 'choice-dialog-btns';

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
    cancel.className = 'btn btn-secondary choice-dialog-cancel';
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

export function showInputDialog(message, { defaultValue = '', placeholder = '', clipboard = false, type = 'text' } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'choice-dialog-overlay';

    const box = document.createElement('div');
    box.className = 'choice-dialog-box choice-dialog-box--wide';

    const msg = document.createElement('p');
    msg.className = 'choice-dialog-msg';
    msg.textContent = message;
    box.appendChild(msg);

    const input = document.createElement('input');
    input.type = type;
    input.className = 'input-dialog-field';
    input.value = defaultValue;
    input.placeholder = placeholder;
    box.appendChild(input);

    const btns = document.createElement('div');
    btns.className = 'choice-dialog-btns';

    const close = value => {
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };

    if (clipboard) {
      const copy = document.createElement('button');
      copy.className = 'btn';
      copy.textContent = 'Copy to Clipboard';
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(input.value).catch(() => {});
        copy.textContent = 'Copied!';
        setTimeout(() => { copy.textContent = 'Copy to Clipboard'; }, 1500);
      });
      btns.appendChild(copy);
    }

    const ok = document.createElement('button');
    ok.className = 'btn';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => close(input.value));
    btns.appendChild(ok);

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-secondary choice-dialog-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(null));
    btns.appendChild(cancel);

    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') close(input.value);
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    setTimeout(() => input.focus(), 0);
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
  dl.innerHTML = `<option value="(no club)">` + clubs.map(c => `<option value="${escHtml(c)}">`).join('');
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
  el.innerHTML = `<option value="">— auto —</option>` +
    opts.map(o => `<option value="${o.value}"${o.value === currentVal ? ' selected' : ''}>${o.label}</option>`).join('');
}

/**
 * Generic typeahead for any input element.
 * getItems(lowerTyped) → array of items matching the typed string
 * getValue(item) → string value to put in the input
 * renderItem(item) → HTML string for the dropdown row
 * onSelect(item) → called when an item is chosen (optional)
 * onClear() → called when the field is emptied (optional)
 */
export function wireTypeahead(el, { getItems, getValue, renderItem, onSelect = () => {}, onClear = () => {}, showOnEmpty = false }) {
  if (!el) return;
  const dropdown = document.createElement('ul');
  dropdown.className = 'name-typeahead';
  dropdown.hidden = true;
  const wrapper = el.closest('.form-field') || el.parentElement;
  wrapper.style.position = 'relative';
  wrapper.appendChild(dropdown);

  let currentMatches = [];
  let deletingText   = false;

  const closeDropdown = () => { dropdown.hidden = true; dropdown.innerHTML = ''; };

  const showDropdown = () => {
    if (currentMatches.length < 2) { closeDropdown(); return; }
    dropdown.innerHTML = currentMatches.map((item, i) =>
      `<li data-i="${i}" tabindex="-1">${renderItem(item)}</li>`
    ).join('');
    dropdown.hidden = false;
    dropdown.querySelectorAll('li').forEach(li =>
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        const item = currentMatches[+li.dataset.i];
        el.value = getValue(item);
        onSelect(item);
        closeDropdown();
      })
    );
  };

  el.addEventListener('input', () => {
    const raw   = el.value;
    const typed = raw.trim();
    if (!typed) { currentMatches = []; deletingText = false; closeDropdown(); onClear(); return; }
    const hasTrailingSpace = raw.endsWith(' ');
    const low = typed.toLowerCase();
    currentMatches = getItems(low);
    const v0 = currentMatches.length === 1 ? getValue(currentMatches[0]) : '';
    if (currentMatches.length === 1 && !deletingText && !hasTrailingSpace && typed.length < v0.length) {
      const s = el.selectionStart;
      el.value = v0;
      el.setSelectionRange(s, v0.length);
      onSelect(currentMatches[0]);
    } else if (currentMatches.length === 1 && !hasTrailingSpace) {
      onSelect(currentMatches[0]);
    } else if (!currentMatches.length) {
      onClear();
    }
    deletingText = false;
    showDropdown();
  });

  el.addEventListener('keydown', e => {
    deletingText = (e.key === 'Backspace' || e.key === 'Delete');
    if (e.key === 'ArrowDown') {
      if (showOnEmpty && !el.value.trim() && !currentMatches.length) currentMatches = getItems('');
      if (currentMatches.length > 1) { e.preventDefault(); showDropdown(); dropdown.querySelector('li')?.focus(); }
    }
    else if (e.key === 'Escape' && !dropdown.hidden) { e.stopPropagation(); closeDropdown(); }
    else if (e.key === 'Enter' && !dropdown.hidden) { closeDropdown(); }
  });

  dropdown.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('li')];
    const idx   = items.indexOf(document.activeElement);
    if      (e.key === 'ArrowDown')           { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp')             { e.preventDefault(); idx > 0 ? items[idx - 1].focus() : el.focus(); }
    else if (e.key === 'Enter' && idx >= 0)   { e.preventDefault(); e.stopPropagation(); const item = currentMatches[idx]; el.value = getValue(item); onSelect(item); closeDropdown(); el.focus(); }
    else if (e.key === 'Escape')              { e.stopPropagation(); closeDropdown(); el.focus(); }
  });

  if (showOnEmpty) {
    el.addEventListener('click', () => {
      if (el.value.trim() || !dropdown.hidden) return;
      currentMatches = getItems('');
      showDropdown();
    });
  }

  el.addEventListener('blur', () => setTimeout(() => {
    if (dropdown.contains(document.activeElement)) return;
    const typed = el.value.trim();
    if (!typed) { onClear(); currentMatches = []; }
    else if (currentMatches.length === 1) { el.value = getValue(currentMatches[0]); onSelect(currentMatches[0]); }
    closeDropdown();
  }, 150));
}

export function wireNameTypeahead(nameEl, { onSelect, onClear }) {
  wireTypeahead(nameEl, {
    getItems:   low => state.people.filter(p => (p.name || '').toLowerCase().startsWith(low)),
    getValue:   p   => p.name,
    renderItem: p   => {
      const detail = [p.dob, p.club].filter(Boolean).join(' – ');
      return `${escHtml(p.name)}${detail ? ` <span class="text-muted text-sm">(${escHtml(detail)})</span>` : ''}`;
    },
    onSelect,
    onClear,
  });
  // Exact-match on change (e.g. paste or autofill)
  nameEl?.addEventListener('change', () => {
    const typed = nameEl.value.trim();
    if (!typed) return;
    const exact = state.people.find(p => (p.name || '').toLowerCase() === typed.toLowerCase());
    if (exact) onSelect(exact);
  });
}

export function wireClubTypeahead(el) {
  wireTypeahead(el, {
    getItems:   low => [...new Set(state.people.map(p => p.club).filter(Boolean))].filter(c => c.toLowerCase().startsWith(low)),
    getValue:   c   => c,
    renderItem: c   => escHtml(c),
  });
}

export function wireRoleTypeahead(el, { onSelect = () => {} } = {}) {
  wireTypeahead(el, {
    getItems:    low => state.roles.filter(r => (r.role || '').toLowerCase().startsWith(low)),
    getValue:    r   => r.role,
    renderItem:  r   => `${escHtml(r.role)}${r.description ? ` <span class="text-muted text-sm">(${escHtml(r.description)})</span>` : ''}`,
    onSelect,
    showOnEmpty: true,
  });
}

export function clearRowEditing(tbodyId) {
  document.querySelectorAll(`#${tbodyId} .row-editing`).forEach(r => r.classList.remove('row-editing'));
}

export function tableColumns(defs, renders) {
  return defs.flatMap(col => {
    const render = renders[col.id];
    return render ? [{ ...col, render }] : [];
  });
}

export function renderThead(tbodyId, columns) {
  const tbody = document.getElementById(tbodyId);
  const thead = tbody?.closest('table')?.querySelector('thead');
  if (!thead) return;
  thead.innerHTML = '<tr>' + columns.map(c => {
    let a = '';
    if (c.title) a += ` title="${c.title}"`;
    if (c.align) a += ` style="text-align:${c.align}"`;
    if (c.class) a += ` class="${c.class}"`;
    return `<th${a}>${c.label}</th>`;
  }).join('') + '</tr>';
}

export function renderTable(tbodyId, columns, rows, { rowAttrs } = {}) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  renderThead(tbodyId, columns);
  tbody.innerHTML = rows.map(r => {
    let tr = '<tr';
    if (rowAttrs) {
      for (const [k, v] of Object.entries(rowAttrs(r))) {
        if (v !== '' && v != null) tr += ` ${k}="${v}"`;
      }
    }
    tr += '>' + columns.map(c => {
      let td = '<td';
      if (c.align) td += ` style="text-align:${c.align}"`;
      return td + `>${c.render ? c.render(r) : ''}</td>`;
    }).join('') + '</tr>';
    return tr;
  }).join('');
  return tbody;
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