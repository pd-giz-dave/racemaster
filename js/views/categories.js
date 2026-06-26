'use strict';

import { state, saveCategories, saveFraPreset, saveWfraPreset } from '../state.js';
import { CSV } from '../csv-schema.js';
import { resetFRAPreset, resetWFRAPreset } from '../categories.js';
import { on, escHtml, showStatus, showConfirmDialog, wireTabBar } from '../ui.js';
import { normaliseTime } from '../utils.js';

// Config for each of the three category tables
const CAT_TABLE = {
  active: { tbodyId: 'categories-tbody', getArr: () => state.categories, saveFn: saveCategories, label: 'category',   fields: CSV.categories.fields, widths: CSV.categories.widths, femaleSepIdx: 4 },
  fra:    { tbodyId: 'fra-preset-tbody', getArr: () => state.fraPreset,  saveFn: saveFraPreset,  label: 'FRA preset', fields: CSV.categories.fields, widths: CSV.categories.widths, femaleSepIdx: 4 },
  wfra:   { tbodyId: 'wfra-preset-tbody',getArr: () => state.wfraPreset, saveFn: saveWfraPreset, label: 'WFRA preset',fields: CSV.categories.fields, widths: CSV.categories.widths, femaleSepIdx: 4 },
};

// ---- Render ----

export function renderCategories() {
  renderCategoryTable('active');
  renderCategoryTable('fra');
  renderCategoryTable('wfra');
}

export function renderCategoryTable(key) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const arr = cfg.getArr();
  const tbody = document.getElementById(cfg.tbodyId);
  if (!tbody) return;
  tbody.innerHTML = arr.map((c, i) => `
    <tr id="${key}-cat-row-${i}">
      ${cfg.fields.map((f, i) => `<td${i === cfg.femaleSepIdx ? ' class="col-sep"' : ''}>${c[f] ?? ''}</td>`).join('')}
      <td class="col-sep">
        <button class="btn-sm btn-edit"         data-key="${key}" data-idx="${i}">Edit</button>
        <button class="btn-sm btn-delete-entry" data-key="${key}" data-idx="${i}">Del</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => editCategoryRow(b.dataset.key, +b.dataset.idx)));
  tbody.querySelectorAll('.btn-delete-entry').forEach(b =>
    b.addEventListener('click', () => deleteCategoryRow(b.dataset.key, +b.dataset.idx)));
}

export function editCategoryRow(key, idx) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const c = cfg.getArr()[idx];
  if (!c) return;
  const row = document.getElementById(`${key}-cat-row-${idx}`);
  if (!row) return;
  row.innerHTML = cfg.fields.map((f, i) =>
    `<td${i === cfg.femaleSepIdx ? ' class="col-sep"' : ''}><input id="${key}-cat-${idx}-${f}" type="text" value="${escHtml(String(c[f] ?? ''))}" style="width:${cfg.widths[i]}"></td>`
  ).join('') + `<td class="col-sep">
    <button class="btn-sm btn-save">Save</button>
    <button class="btn-sm btn-secondary">Cancel</button>
  </td>`;
  row.querySelector('.btn-save').addEventListener('click', () => saveCategoryRow(key, idx));
  row.querySelector('.btn-secondary').addEventListener('click', () => renderCategoryTable(key));
  document.getElementById(`${key}-cat-${idx}-maleMinAge`)?.focus();
}

export async function saveCategoryRow(key, idx) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const c = cfg.getArr()[idx];
  if (!c) return;
  for (const f of cfg.fields) {
    const v = document.getElementById(`${key}-cat-${idx}-${f}`)?.value.trim() ?? '';
    c[f] = f.includes('Age') || f.includes('Dist') ? (+v === +v ? +v : c[f])
         : f.includes('Start') ? (normaliseTime(v) || '')
         : v;
  }
  await cfg.saveFn();
  showStatus(`${cfg.label} row ${idx + 1} saved.`);
  renderCategoryTable(key);
}

export async function deleteCategoryRow(key, idx) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const arr = cfg.getArr();
  if (!await showConfirmDialog(`Delete ${cfg.label} row ${idx + 1} (${arr[idx]?.maleCat || ''})?`, 'Delete', true)) return;
  arr.splice(idx, 1);
  await cfg.saveFn();
  showStatus(`${cfg.label} row deleted.`);
  renderCategoryTable(key);
}

export function showAddCategoryRow(key) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const tbody = document.getElementById(cfg.tbodyId);
  if (!tbody || document.getElementById(`${key}-cat-row-new`)) return;
  const tr = document.createElement('tr');
  tr.id = `${key}-cat-row-new`;
  tr.innerHTML = cfg.fields.map((f, i) =>
    `<td${i === cfg.femaleSepIdx ? ' class="col-sep"' : ''}><input id="${key}-cat-new-${f}" type="text" value="" style="width:${cfg.widths[i]}"></td>`
  ).join('') + `<td class="col-sep">
    <button class="btn-sm btn-save">Save</button>
    <button class="btn-sm btn-secondary">Cancel</button>
  </td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btn-save').addEventListener('click', () => saveNewCategoryRow(key));
  tr.querySelector('.btn-secondary').addEventListener('click', () => tr.remove());
  tr.querySelector('input')?.focus();
}

export async function saveNewCategoryRow(key) {
  const cfg = CAT_TABLE[key];
  if (!cfg) return;
  const row = {};
  for (const f of cfg.fields) {
    const v = document.getElementById(`${key}-cat-new-${f}`)?.value.trim() || '';
    row[f] = f.includes('Age') || f.includes('Dist') ? +v || 0
           : f.includes('Start') ? (normaliseTime(v) || '')
           : v;
  }
  cfg.getArr().push(row);
  await cfg.saveFn();
  showStatus(`${cfg.label} row added.`);
  renderCategoryTable(key);
}

// ---- Wire ----

export function wireCategories() {
  on('btn-add-category',  'click', () => showAddCategoryRow('active'));
  on('btn-add-fra-row',   'click', () => showAddCategoryRow('fra'));
  on('btn-add-wfra-row',  'click', () => showAddCategoryRow('wfra'));

  on('btn-reset-fra', 'click', async () => {
    if (!await showConfirmDialog('Reset FRA preset to built-in defaults? Any customisations will be lost.', 'Reset', true)) return;
    resetFRAPreset();
    await saveFraPreset();
    showStatus('FRA preset reset to built-in defaults.');
    renderCategoryTable('fra');
  });
  on('btn-reset-wfra', 'click', async () => {
    if (!await showConfirmDialog('Reset WFRA preset to built-in defaults? Any customisations will be lost.', 'Reset', true)) return;
    resetWFRAPreset();
    await saveWfraPreset();
    showStatus('WFRA preset reset to built-in defaults.');
    renderCategoryTable('wfra');
  });

  wireTabBar('cat-tab-bar', 'cat-tab-', 'data-cat-tab');
}