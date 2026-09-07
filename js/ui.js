'use strict';

import { state } from './state.js';
import { getMaleCategories, getFemaleCategories } from './categories.js';
import { normaliseDate, normaliseTime, escHtml } from './utils.js';

// ---- DOM helpers ----

// Pulled in from js/views/mobile-files.js and mobile-files-ble.js's own former duplicates —
// the one bare "just get the element" accessor every other helper below already does inline.
export function getEl(id) { return document.getElementById(id); }

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

    // A choice with `buttons` (instead of a single `value`) renders as one row: a label plus
    // several small inline buttons sharing it — e.g. "<device name>: [Reconnect] [Forget]" —
    // rather than each option getting its own full-width button. `inline: true` on a plain
    // choice instead packs it into the same row as the dialog's own Cancel button, right-aligned
    // alongside it, rather than getting its own full-width row above it — for a single trailing
    // action (e.g. "Pick a different phone…") that reads as a peer of Cancel, not one more item
    // in the list above it. Both are opt-in shapes on top of the plain {label, value, danger}
    // choice below (never assumed) so every other caller of this dialog is unaffected.
    let inlineChoice = null;
    for (const choice of choices) {
      if (choice.buttons) {
        const row = document.createElement('div');
        row.className = 'choice-dialog-row';
        const label = document.createElement('span');
        label.className = 'choice-dialog-row-label';
        label.textContent = choice.label;
        row.appendChild(label);
        for (const { label: btnLabel, value, danger } of choice.buttons) {
          const btn = document.createElement('button');
          btn.className = danger ? 'btn btn-sm btn-delete' : 'btn btn-sm';
          btn.textContent = btnLabel;
          btn.addEventListener('click', () => close(value));
          row.appendChild(btn);
        }
        btns.appendChild(row);
      } else if (choice.inline) {
        inlineChoice = choice; // rendered below, alongside Cancel, not here
      } else {
        const btn = document.createElement('button');
        btn.className = choice.danger ? 'btn btn-delete' : 'btn';
        btn.textContent = choice.label;
        btn.addEventListener('click', () => close(choice.value));
        btns.appendChild(btn);
      }
    }

    const cancel = document.createElement('button');
    cancel.className = 'btn btn-secondary choice-dialog-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(null));

    if (inlineChoice) {
      const inlineBtn = document.createElement('button');
      inlineBtn.className = inlineChoice.danger ? 'btn btn-delete' : 'btn';
      inlineBtn.textContent = inlineChoice.label;
      inlineBtn.addEventListener('click', () => close(inlineChoice.value));
      const row = document.createElement('div');
      row.className = 'choice-dialog-row choice-dialog-row--actions';
      row.append(inlineBtn, cancel);
      btns.appendChild(row);
    } else if (focusCancel) {
      btns.prepend(cancel);
    } else {
      btns.appendChild(cancel);
    }

    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    setTimeout(() => (focusCancel ? cancel : btns.querySelector('button'))?.focus(), 0);
  });
}

export function showInputDialog(message, { defaultValue = '', placeholder = '', clipboard = false, type = 'text', multiline = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'choice-dialog-overlay';

    const box = document.createElement('div');
    box.className = 'choice-dialog-box choice-dialog-box--wide';

    const msg = document.createElement('p');
    msg.className = 'choice-dialog-msg';
    msg.textContent = message;
    box.appendChild(msg);

    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = type;
    else input.rows = 4;
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

    if (!multiline) input.addEventListener('keydown', e => {
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

  let currentMatches   = [];
  let deletingText     = false;
  let pendingGhost      = null;  // raw text typed before an unconfirmed inline auto-complete
  let pendingGhostValue = null;  // the auto-completed value el.value was set to, for that ghost
  el._selectedItem = null; // the specific item explicitly picked — shared with wireNameTypeahead's change handler

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
        pendingGhost = null;
        el._selectedItem = item;
        onSelect(item);
        closeDropdown();
      })
    );
  };

  el.addEventListener('input', () => {
    const raw   = el.value;
    const typed = raw.trim();
    pendingGhost = null;
    el._selectedItem = null; // typing invalidates any prior explicit pick
    if (!typed) { currentMatches = []; deletingText = false; closeDropdown(); onClear(); return; }
    const hasTrailingSpace = raw.endsWith(' ');
    const low = typed.toLowerCase();
    currentMatches = getItems(low);
    const v0 = currentMatches.length === 1 ? getValue(currentMatches[0]) : '';
    if (currentMatches.length === 1 && !deletingText && !hasTrailingSpace && typed.length < v0.length) {
      const s = el.selectionStart;
      el.value = v0;
      el.setSelectionRange(s, v0.length);
      pendingGhost = typed;
      pendingGhostValue = v0;
      onSelect(currentMatches[0]);
    } else if (currentMatches.length === 1 && !hasTrailingSpace) {
      el._selectedItem = currentMatches[0];
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
    else if (e.key === 'Enter') {
      // Enter accepts whatever's showing (e.g. a single-match ghost completion
      // with no dropdown to click) — confirm it so it isn't wrongly reverted
      // as "unconfirmed" the next time this field blurs.
      pendingGhost = null;
      pendingGhostValue = null;
      if (!dropdown.hidden) closeDropdown();
    }
  });

  dropdown.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('li')];
    const idx   = items.indexOf(document.activeElement);
    if      (e.key === 'ArrowDown')           { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp')             { e.preventDefault(); idx > 0 ? items[idx - 1].focus() : el.focus(); }
    else if (e.key === 'Enter' && idx >= 0)   { e.preventDefault(); e.stopPropagation(); const item = currentMatches[idx]; el.value = getValue(item); pendingGhost = null; el._selectedItem = item; onSelect(item); closeDropdown(); el.focus(); }
    else if (e.key === 'Escape')              { e.stopPropagation(); closeDropdown(); el.focus(); }
  });

  if (showOnEmpty) {
    el.addEventListener('click', () => {
      if (el.value.trim() || !dropdown.hidden) return;
      currentMatches = getItems('');
      showDropdown();
    });
  }

  // On leaving the field, only keep an auto-completed value if it's an exact
  // match. A typed value that's merely a *prefix* of an existing item (e.g.
  // typing "Dave Nichols" when "Dave Nicholson" already exists) is a distinct,
  // legitimate new entry — revert any inline auto-complete to what was
  // actually typed and clear whatever got pre-filled from the wrong match,
  // rather than silently keeping someone else's data.
  el.addEventListener('blur', () => setTimeout(() => {
    if (dropdown.contains(document.activeElement)) return;
    if (pendingGhost !== null) {
      // Only revert if the field still holds the ghosted suggestion — if
      // something else (e.g. a form reset) already changed it, leave that
      // value alone rather than clobbering it with stale ghost state.
      if (el.value === pendingGhostValue) { el.value = pendingGhost; onClear(); }
      pendingGhost = null;
      pendingGhostValue = null;
      closeDropdown();
      return;
    }
    const typed = el.value.trim();
    if (!typed) { onClear(); currentMatches = []; closeDropdown(); return; }
    // Already resolved to a specific item (dropdown click, Enter, or an unambiguous
    // typed match) — don't re-derive by name text alone, which would pick whichever
    // duplicate-named item happens to come first and silently swap out the one
    // actually selected (e.g. one of two same-named people, only one with a DOB).
    if (el._selectedItem && getValue(el._selectedItem).toLowerCase() === typed.toLowerCase()) {
      closeDropdown();
      return;
    }
    const exact = getItems(typed.toLowerCase()).find(item => getValue(item).toLowerCase() === typed.toLowerCase());
    if (exact) { el.value = getValue(exact); el._selectedItem = exact; onSelect(exact); }
    else       { onClear(); }
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
  // Exact-match on change (e.g. paste or autofill bypassing the input/dropdown flow above)
  nameEl?.addEventListener('change', () => {
    const typed = nameEl.value.trim();
    if (!typed) return;
    // Already resolved to a specific item above — don't re-derive by name text alone
    // and risk picking a different same-named person (see wireTypeahead's blur handler).
    if (nameEl._selectedItem && (nameEl._selectedItem.name || '').toLowerCase() === typed.toLowerCase()) return;
    const exact = state.people.find(p => (p.name || '').toLowerCase() === typed.toLowerCase());
    if (exact) { nameEl._selectedItem = exact; onSelect(exact); }
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

// A leading run of columns marked `sticky: true` (see TABLES in strings.js) freezes
// against horizontal scroll — .sticky-col in app.css. `wrap: true` caps a free-text
// sticky column's width (a name or race label would otherwise size the column to
// whatever's currently longest, one row at a time, and swallow the rest of a narrow
// phone screen) at applyStickyColumns()'s default, in ui.js — override with `cap: N`
// (px) for a column that should get a narrower one, e.g. a short location code.
function cellAttrs(c) {
  const cls = [c.class, c.sticky && 'sticky-col', c.wrap && 'sticky-col-wrap'].filter(Boolean).join(' ');
  let a = '';
  if (cls) a += ` class="${cls}"`;
  if (c.wrap && c.cap) a += ` data-sticky-cap="${c.cap}"`;
  return a;
}

export function renderThead(tbodyId, columns) {
  const tbody = document.getElementById(tbodyId);
  const thead = tbody?.closest('table')?.querySelector('thead');
  if (!thead) return;
  thead.innerHTML = '<tr>' + columns.map(c => {
    let a = '';
    if (c.title) a += ` title="${c.title}"`;
    if (c.align) a += ` style="text-align:${c.align}"`;
    a += cellAttrs(c);
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
      td += cellAttrs(c);
      return td + `>${c.render ? c.render(r) : ''}</td>`;
    }).join('') + '</tr>';
    return tr;
  }).join('');
  applyStickyColumns(tbodyId);
  return tbody;
}

// .sticky-col-wrap's default cap — see applyStickyColumns() below for why this is
// enforced from JS rather than a CSS max-width. Override per-column with `cap: N` in
// TABLES (strings.js) — see cellAttrs() above.
const STICKY_WRAP_CAP_PX = 140;

// Positions each .sticky-col cell (see cellAttrs() above) with the `left` offset it
// actually needs — the running sum of the *rendered* widths of the sticky columns before
// it — instead of a hardcoded pixel guess. A column is exactly as wide as its content
// needs (header label or its data), the way an ordinary un-frozen table column already
// behaves; sticky columns just need this run each time the table's content changes,
// since CSS alone can't measure a sibling's rendered width. Marking the last one —
// sticky-col-last, for its divider border/shadow — happens here too, since which column
// is last depends on how many are marked sticky.
export function applyStickyColumns(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  const table = tbody?.closest('table');
  const theadRow = table?.tHead?.rows[0];
  if (!theadRow) return;

  const stickyThs = [...theadRow.cells].filter(th => th.classList.contains('sticky-col'));
  if (!stickyThs.length) return;

  // A row whose cell at this index spans multiple columns (colspan > 1 — a "No results"
  // message, a category separator, an inline edit panel taking over the row) isn't part
  // of the normal column grid and must be left alone, not squeezed into one column's width.
  const allRows = [theadRow, ...tbody.rows];
  const cellAt = (r, idx) => { const c = r.cells[idx]; return c && c.colSpan <= 1 ? c : null; };

  // Clear old widths/offsets before measuring — a previous, possibly wider, run (or a
  // previous forced cap) must not inflate this one (e.g. a long race name that got
  // filtered out since last render).
  stickyThs.forEach(th => {
    const idx = th.cellIndex;
    allRows.forEach(r => { const c = cellAt(r, idx); if (c) { c.style.left = ''; c.style.width = ''; } });
  });

  let offset = 0;
  stickyThs.forEach((th, pos) => {
    const idx = th.cellIndex;
    const isLast = pos === stickyThs.length - 1;
    // A free-text column (a name, a race label) needs a cap, or one long value on one
    // row sizes the whole frozen block to match it and — on a narrow phone — leaves
    // nothing readable for the columns after it. table-layout:auto doesn't reliably
    // honour max-width on a <td> as an actual ceiling (verified: a 27-char value still
    // rendered well past a 135px max-width), but explicit width does reliably constrain
    // one — so measure what the column naturally wants first, and only force a width
    // down to the cap if it actually exceeds it. Short content is unaffected — the
    // column still shrinks to fit it, same as any other uncapped sticky column.
    // (A single-line ellipsis-truncated column can't use this trick — white-space:nowrap
    // gives the column an unshrinkable minimum width equal to its longest value's full
    // rendered length, which auto-layout enforces over any explicit width — so every
    // capped sticky column wraps instead, same as this one; `cap` just makes it a
    // narrower wrap for a column that's normally short, like a location code.)
    const cap = th.classList.contains('sticky-col-wrap') ? (+th.dataset.stickyCap || STICKY_WRAP_CAP_PX) : null;
    const naturalWidth = th.getBoundingClientRect().width;
    const width = cap ? Math.min(naturalWidth, cap) : naturalWidth;
    if (cap && naturalWidth > cap) {
      allRows.forEach(r => { const c = cellAt(r, idx); if (c) c.style.width = `${cap}px`; });
    }
    allRows.forEach(r => {
      const cell = cellAt(r, idx);
      if (!cell) return;
      cell.classList.toggle('sticky-col-last', isLast);
      cell.style.left = `${offset}px`;
    });
    offset += width;
  });
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