'use strict';

import { state, saveCategories, saveCustomCategories, applyCustomCategories } from '../state.js';
import { CSV } from '../csv-schema.js';
import { builtinFRARows, builtinWFRARows } from '../categories.js';
import { createCategory } from '../schema.js';
import { parseCSV, formatCSV } from '../csv.js';
import { on, escHtml, showStatus, showConfirmDialog, wireTabBar, renderThead, pickFile, downloadText } from '../ui.js';
import { TABLES } from '../strings.js';
import { normaliseTime } from '../utils.js';

const FIELDS = CSV.categories.fields;
const WIDTHS = CSV.categories.widths;

// ---- Render ----

export function renderCategories() {
  renderCategoryTable();
  renderReadonlyTable('fra-categories-tbody', builtinFRARows());
  renderReadonlyTable('wfra-categories-tbody', builtinWFRARows());
  activateSchemeTab();
}

function activateSchemeTab() {
  const scheme = (state.event.categories || 'FRA').toLowerCase();
  const label = { fra: 'FRA', wfra: 'WFRA', custom: 'Custom' }[scheme] ?? scheme.toUpperCase();
  const bar = document.getElementById('cat-tab-bar');
  if (!bar) return;
  bar.querySelectorAll('[data-cat-tab]').forEach(btn => {
    btn.classList.toggle('cat-active-scheme', btn.dataset.catTab === scheme);
  });
  bar.querySelector(`[data-cat-tab="${scheme}"]`)?.click();
  const info = document.getElementById('cat-scheme-info');
  if (info) info.textContent = `Active scheme for this event: ${label} — the tab marked "active" shows the categories in use.`;
}

export function renderCategoryTable() {
  const tbody = document.getElementById('custom-categories-tbody');
  if (!tbody) return;
  renderThead('custom-categories-tbody', TABLES.categories);
  tbody.innerHTML = state.customCategories.map((c, i) => `
    <tr id="custom-cat-row-${i}">
      ${FIELDS.map(f => `<td>${escHtml(String(c[f] ?? ''))}</td>`).join('')}
      <td>
        <button class="btn-sm btn-edit"         data-idx="${i}">Edit</button>
        <button class="btn-sm btn-delete-entry" data-idx="${i}">Del</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editCategoryRow(+b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => deleteCategoryRow(+b.dataset.idx)));
}

function renderReadonlyTable(tbodyId, rows) {
  const cols = TABLES.categories.filter(c => c.id !== 'actions');
  renderThead(tbodyId, cols);
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = rows.map(c =>
    `<tr>${FIELDS.map(f => `<td>${escHtml(String(c[f] ?? ''))}</td>`).join('')}</tr>`
  ).join('');
}

// ---- Edit / Save / Delete ----

export function editCategoryRow(idx) {
  const c = state.customCategories[idx];
  if (!c) return;
  const row = document.getElementById(`custom-cat-row-${idx}`);
  if (!row) return;
  row.innerHTML = FIELDS.map((f, i) =>
    `<td><input id="custom-cat-${idx}-${f}" type="text" value="${escHtml(String(c[f] ?? ''))}" style="width:${WIDTHS[i]}"></td>`
  ).join('') + `<td>
    <button class="btn-sm btn-save">Save</button>
    <button class="btn-sm btn-secondary">Cancel</button>
  </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => saveCategoryRow(idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderCategoryTable());
  document.getElementById(`custom-cat-${idx}-minAge`)?.focus();
}

export async function saveCategoryRow(idx) {
  const c = state.customCategories[idx];
  if (!c) return;
  for (const f of FIELDS) {
    const v = document.getElementById(`custom-cat-${idx}-${f}`)?.value.trim() ?? '';
    c[f] = f.includes('Age') || f.includes('Dist') ? (+v === +v ? +v : c[f])
         : f.includes('Start') ? (normaliseTime(v) || '')
         : v;
  }
  await afterCustomChange();
  showStatus(`Category row ${idx + 1} saved.`);
  renderCategoryTable();
}

export async function deleteCategoryRow(idx) {
  const arr = state.customCategories;
  if (!await showConfirmDialog(`Delete category row ${idx + 1} (${arr[idx]?.maleCat || ''})?`, 'Delete', true)) return;
  arr.splice(idx, 1);
  await afterCustomChange();
  showStatus('Category row deleted.');
  renderCategoryTable();
}

export function showAddCategoryRow() {
  const tbody = document.getElementById('custom-categories-tbody');
  if (!tbody || document.getElementById('custom-cat-row-new')) return;
  const tr = document.createElement('tr');
  tr.id = 'custom-cat-row-new';
  tr.innerHTML = FIELDS.map((f, i) =>
    `<td><input id="custom-cat-new-${f}" type="text" value="" style="width:${WIDTHS[i]}"></td>`
  ).join('') + `<td>
    <button class="btn-sm btn-save">Save</button>
    <button class="btn-sm btn-secondary">Cancel</button>
  </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-save').addEventListener('click', () => saveNewCategoryRow());
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  tr.querySelector('input')?.focus();
}

export async function saveNewCategoryRow() {
  const row = {};
  for (const f of FIELDS) {
    const v = document.getElementById(`custom-cat-new-${f}`)?.value.trim() || '';
    row[f] = f.includes('Age') || f.includes('Dist') ? +v || 0
           : f.includes('Start') ? (normaliseTime(v) || '')
           : v;
  }
  state.customCategories.push(row);
  await afterCustomChange();
  showStatus('Category row added.');
  renderCategoryTable();
}

// ---- Load presets / CSV ----

async function loadPreset(rows, label) {
  if (!await showConfirmDialog(`Replace all custom categories with the ${label} preset? This cannot be undone.`, 'Load', true)) return;
  state.customCategories = rows;
  await afterCustomChange();
  showStatus(`${label} preset loaded into custom categories.`);
  renderCategoryTable();
}

async function importCategoriesCSV() {
  const text = await pickFile('.csv');
  if (!text) return;
  const rows = parseCSV(text);
  if (!rows.length) { showStatus('CSV is empty.', true); return; }
  if (!('minAge' in rows[0]) && !('maleCat' in rows[0])) {
    showStatus('CSV missing required columns — expected minAge, maleCat, femaleCat, ref, maxDist.', true);
    return;
  }
  state.customCategories = rows.map(r => createCategory({
    minAge:    r.minAge    ?? '',
    maleCat:   r.maleCat   ?? '',
    femaleCat: r.femaleCat ?? '',
    ref:       r.ref       ?? '',
    maxDist:   r.maxDist   ?? '',
  }));
  await afterCustomChange();
  showStatus(`Imported ${state.customCategories.length} rows.`);
  renderCategoryTable();
}

function exportCategoriesCSV() {
  if (!state.customCategories.length) { showStatus('No custom categories to export.', true); return; }
  downloadText(formatCSV(state.customCategories, FIELDS), 'custom_categories.csv');
}

async function clearAllCategories() {
  if (!await showConfirmDialog('Delete all custom categories? This cannot be undone.', 'Clear All', true)) return;
  state.customCategories = [];
  await afterCustomChange();
  showStatus('Custom categories cleared.');
  renderCategoryTable();
}

// ---- Helpers ----

async function afterCustomChange() {
  await saveCustomCategories();
  if ((state.event.categories || 'FRA') === 'Custom') {
    applyCustomCategories();
    await saveCategories();
  }
}

// ---- Wire ----

export function wireCategories() {
  on('btn-add-category',          'click', () => showAddCategoryRow());
  on('btn-load-fra-preset',       'click', () => loadPreset(builtinFRARows(),  'FRA'));
  on('btn-load-wfra-preset',      'click', () => loadPreset(builtinWFRARows(), 'WFRA'));
  on('btn-import-categories-csv', 'click', importCategoriesCSV);
  on('btn-export-categories-csv', 'click', exportCategoriesCSV);
  on('btn-clear-categories',      'click', clearAllCategories);

  wireTabBar('cat-tab-bar', 'cat-tab-', 'data-cat-tab');
}