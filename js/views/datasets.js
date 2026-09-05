'use strict';

import { state, loadAll } from '../state.js';
import {
  getSession, setSession, clearSession, clearCredentials,
  getUsername, setUsername, getIsAdmin, setIsAdmin,
  setStandalone, isDirty, hasCachedData,
  apiLogin, apiCreateAccount, apiListDatasets, apiCreateDataset, apiCopyDataset, apiChangeVisibility,
  apiDeleteDataset, switchDataset, saveAsDataset, apiListUsers, apiCreateUser, apiSetUserAdmin, apiDeleteUser,
  dumpState, restoreState,
} from '../storage.js';
import { showConfirmDialog, showStatus, pickFile, downloadText, sanitise } from '../ui.js';
import { showBusy, escHtml } from '../utils.js';
import { updateDataFileButton, pingServerNow } from '../connect.js';
import { renderAll, showView } from '../app.js';
import { isServerHidden, setServerHidden } from '../server-hide.js';

let activeToken    = null;
let activeUsername = null;
let isAdminUser    = false;
let _onConnect     = null;
let lastKnownDatasets = []; // last successfully-fetched list — see loadDatasets()'s catch branch
let knownUsernames = []; // last successfully-fetched usernames (admin only) — populates the
                          // copy form's "as user" dropdown, see loadUsers() and renderInlineRow()

// The one dataset row currently showing inline Connect/Copy UI instead of its normal action
// buttons — rendered as an extra <tr> right after that row (see renderDatasetList()) rather
// than a fixed div below the whole list, so it's never out of view on a long list. Only one at
// a time: opening Connect/Copy on a different row replaces whatever was open.
// { type: 'connect'|'copy', owner, fullName, name, status: 'confirming'|'busy'|'error',
//   hasPushOption?, busyLabel?, error?, nameValue?, visValue?, ownerValue? }
let pendingRow = null;
let currentDatasets = []; // last list renderDatasetList() drew, so pendingRow changes alone
                          // can redraw without a server refetch
function rerenderDatasetList() { renderDatasetList(currentDatasets); }

// True once handleLogin() has succeeded but before a dataset has been picked or created —
// setSession() (which persists the token) only ever happens as part of connecting to a
// dataset, so up to that point activeToken is only held here in memory. Leaving this view
// without connecting to anything means the login never actually took effect (equivalent to
// "Continue without signing in") — see app.js's confirmLeaveDatafile(), which warns the user
// before navigating away while this is true.
export function hasUnconfirmedLogin() {
  return !!activeToken && !getSession();
}

function getEl(id) { return document.getElementById(id); }

// Blocks paste/copy/cut on a "confirm password" field — the primary password field it's
// confirming stays pasteable (e.g. from a password manager), but this one has to be retyped by
// hand, so a copy-paste of the same (possibly mistyped) value can't sail through both fields
// unnoticed and defeat the whole point of asking twice.
function blockClipboard(el) {
  if (!el) return;
  ['paste', 'copy', 'cut'].forEach(evt => el.addEventListener(evt, e => e.preventDefault()));
}

// Every password field on this view shares this eyeball-toggle markup (see index.html's
// .btn-toggle-password buttons, each carrying data-target="<input id>") — wired generically here
// rather than once per field, so a newly added password field just needs the markup, no new JS.
function togglePasswordVisibility(btn) {
  const input = getEl(btn.dataset.target);
  if (!input) return;
  const willShow = input.type === 'password';
  input.type = willShow ? 'text' : 'password';
  // SVG elements don't reflect the .hidden property back to the attribute the way
  // HTMLElement does, so toggle the attribute directly rather than the property.
  btn.querySelector('.icon-eye').toggleAttribute('hidden', willShow);
  btn.querySelector('.icon-eye-off').toggleAttribute('hidden', !willShow);
  btn.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
}

// Reset every password field back to masked, regardless of whether it was peeked at —
// covers logging in, logging out back to the form, and freshly entering the view.
function resetPasswordVisibility() {
  document.querySelectorAll('.btn-toggle-password').forEach(btn => {
    const input = getEl(btn.dataset.target);
    if (input) input.type = 'password';
    btn.querySelector('.icon-eye')?.toggleAttribute('hidden', false);
    btn.querySelector('.icon-eye-off')?.toggleAttribute('hidden', true);
    btn.setAttribute('aria-label', 'Show password');
  });
}

function updateServerHiddenButton() {
  const btn = getEl('btn-toggle-server-hidden');
  if (!btn) return;
  btn.textContent = isServerHidden() ? 'Unhide Server' : 'Hide Server';
}

function showPanel(name, adminUser) {
  getEl('df-panel-auth').hidden        = (name !== 'auth');
  getEl('df-panel-loggedin').hidden    = (name !== 'datasets');
  getEl('df-panels-row').style.display = (name === 'datasets') ? 'flex' : 'none';
  getEl('df-panel-users').hidden       = (name !== 'datasets') || !adminUser;
  resetPasswordVisibility();
}

function setStatus(id, msg, isError = false) {
  const el = getEl(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  // Mirrors showStatus()'s own 10s auto-clear (js/ui.js) — without this a message here (unlike
  // the shared status bar/title) never disappeared on its own, so an old one could still be
  // sitting here, inconsistently, well after a newer status had already replaced it elsewhere.
  setTimeout(() => {
    if (el.textContent === msg) { el.textContent = ''; el.style.color = ''; }
  }, 10000);
}

// Every server-unreachable catch on this page used to only write to its own local inline
// span, unlike every other page (e.g. mobile-files.js), which surfaces the same failure through
// the shared showStatus() — the global status bar every other page trains the eye to check, with
// consistent styling and auto-clear. This writes to both, so an offline error here looks and
// behaves the same as anywhere else in the app.
function reportError(id, msg) {
  setStatus(id, msg, true);
  showStatus(msg, true);
}

function radioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || 'private';
}

// Same character restriction as account creation (see handleLogin()'s isCreate check) — also
// catches "public"/"private" appearing anywhere in the name, since those are reserved as the
// visibility suffix server-side and wouldn't be ruled out by the character check alone (both
// words are themselves just letters). Returns an error message, or '' if the name is valid.
function validateDatasetName(name) {
  if (!/^[a-zA-Z0-9-]+$/.test(name)) return 'Name can only contain letters, numbers and hyphens (a-z, A-Z, 0-9, -).';
  if (/public|private/i.test(name)) return 'Name must not contain "public" or "private".';
  return '';
}

// ---- Dataset list ----

function loadDatasets() {
  showPanel('datasets', isAdminUser);
  pendingRow = null;
  const userEl = getEl('df-logged-in-user');
  if (userEl) userEl.textContent = activeUsername ? `Signed in as ${activeUsername}` : '';
  setStatus('df-dataset-status', 'Loading…');
  apiListDatasets(activeToken).then(datasets => {
    lastKnownDatasets = datasets;
    setStatus('df-dataset-status', '');
    renderDatasetList(datasets);
  }).catch(() => {
    // Server unreachable (e.g. hidden for testing, or a transient blip out in the field) —
    // keep showing the last known list rather than wiping it down to empty.
    reportError('df-dataset-status', 'Server unreachable — showing the last known list.');
    renderDatasetList(lastKnownDatasets);
  });
  if (isAdminUser) loadUsers();
}

function loadUsers() {
  setStatus('df-user-status', 'Loading…');
  apiListUsers(activeToken).then(users => {
    if (!Array.isArray(users)) throw new Error(users?.error || 'Unexpected response');
    setStatus('df-user-status', '');
    knownUsernames = users.map(u => u.username);
    const list = getEl('df-user-list');
    if (!list) return;
    list.innerHTML = users.map(u => {
      const isSelf   = u.username === activeUsername;
      const enc      = encodeURIComponent(u.username);
      const badge    = u.isAdmin ? ' <span style="font-size:0.7rem;background:var(--accent);color:#fff;border-radius:4px;padding:0 4px">admin</span>' : '';
      const adminBtn = isSelf ? '' : u.isAdmin
        ? `<button class="btn btn-sm btn-secondary df-user-unadmin" data-username="${enc}" style="flex-shrink:0">Revoke admin</button>`
        : `<button class="btn btn-sm btn-secondary df-user-admin" data-username="${enc}" style="flex-shrink:0">Grant admin</button>`;
      const delBtn   = isSelf ? '' : `<button class="btn btn-sm btn-danger df-user-delete" data-username="${enc}" style="flex-shrink:0">Del</button>`;
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="flex:1;font-size:0.875rem">${u.username}${badge}</span>${adminBtn}${delBtn}
      </div>`;
    }).join('');
    list.querySelectorAll('.df-user-admin').forEach(btn => {
      btn.onclick = () => setUserAdmin(decodeURIComponent(btn.dataset.username), true);
    });
    list.querySelectorAll('.df-user-unadmin').forEach(btn => {
      btn.onclick = () => setUserAdmin(decodeURIComponent(btn.dataset.username), false);
    });
    list.querySelectorAll('.df-user-delete').forEach(btn => {
      btn.onclick = () => deleteUser(decodeURIComponent(btn.dataset.username));
    });
  }).catch(() => reportError('df-user-status', 'Server unreachable — could not load users.'));
}

async function setUserAdmin(username, makeAdmin) {
  const label = makeAdmin ? 'Grant admin' : 'Revoke admin';
  const msg   = makeAdmin ? `Grant admin rights to "${username}"?` : `Revoke admin rights from "${username}"?`;
  if (!await showConfirmDialog(msg, label, true)) return;
  setStatus('df-user-status', makeAdmin ? 'Granting admin…' : 'Revoking admin…');
  apiSetUserAdmin(activeToken, username, makeAdmin).then(result => {
    if (result.error) { setStatus('df-user-status', result.error, true); return; }
    loadUsers();
  }).catch(() => reportError('df-user-status', 'Server unreachable — cannot change admin rights right now, try again once back online.'));
}

async function deleteUser(username) {
  if (!await showConfirmDialog(`Delete user "${username}"? This does not delete their datasets.`, 'Delete', true)) return;
  setStatus('df-user-status', 'Deleting…');
  apiDeleteUser(activeToken, username).then(result => {
    if (result.error) { setStatus('df-user-status', result.error, true); return; }
    setStatus('df-user-status', `"${username}" deleted.`);
    loadUsers();
  }).catch(() => reportError('df-user-status', 'Server unreachable — cannot delete this user right now, try again once back online.'));
}

// Builds the extra <tr> shown right after a row matching pendingRow — the confirm/busy/error
// states for both Connect and Copy, replacing what used to be two separate fixed divs below
// the whole list. colspan matches the 6 columns in the table below.
function renderInlineRow() {
  const p = pendingRow;
  if (p.status === 'busy') {
    const label = p.type === 'connect' ? (p.busyLabel || 'Connecting…') : 'Copying…';
    return `<tr class="df-inline-row"><td colspan="6">
      <div style="background:var(--panel-alt);padding:10px;border-radius:6px">
        <p style="margin:0;font-size:0.875rem;color:var(--muted)">${escHtml(label)}</p>
      </div>
    </td></tr>`;
  }
  // Connect has no editable fields to correct — a rejected connect (rare: only the "genuinely
  // unexpected" catch in doConnectDataset()) just gets a bare error + Cancel. Copy is different:
  // its error is usually the entered name failing a constraint (taken, or invalid), so that case
  // falls through to the same form below with the error banner added on top, rather than
  // discarding what the user typed and making them start the whole form over.
  if (p.status === 'error' && p.type === 'connect') {
    return `<tr class="df-inline-row"><td colspan="6">
      <div style="background:var(--panel-alt);padding:10px;border-radius:6px">
        <p style="margin:0 0 8px;font-size:0.875rem;color:var(--danger)">${escHtml(p.error)}</p>
        <div class="btn-row"><button class="btn btn-secondary df-inline-cancel">Cancel</button></div>
      </div>
    </td></tr>`;
  }
  // status === 'confirming' (or 'error' for copy — see above)
  if (p.type === 'connect') {
    const buttons = p.hasPushOption
      ? `<button class="btn btn-primary df-inline-connect-push">Push &amp; Connect</button>
         <button class="btn btn-secondary df-inline-connect-discard">Discard &amp; Connect</button>`
      : `<button class="btn btn-secondary df-inline-connect-discard">Connect: ${escHtml(p.name)}</button>`;
    const msg = p.hasPushOption
      ? `You have unsaved local data. Push it to "${escHtml(p.name)}" before connecting, or discard it?`
      : `Connecting will replace local data with "${escHtml(p.name)}" from the server.`;
    return `<tr class="df-inline-row"><td colspan="6">
      <div style="background:var(--panel-alt);padding:10px;border-radius:6px">
        <p style="margin:0 0 8px;font-size:0.875rem">${msg}</p>
        <div class="btn-row">${buttons}<button class="btn btn-secondary df-inline-cancel">Cancel</button></div>
      </div>
    </td></tr>`;
  }
  // p.type === 'copy'
  // Only an admin gets to redirect the copy to someone else's folder — everyone else always
  // copies into their own, so the field is hidden rather than shown-but-locked for them. Options
  // come from knownUsernames (populated by loadUsers(), same admin-only fetch that fills the
  // Users panel) rather than free text, so a copy can't be misdirected by a typo into creating
  // an orphaned dataset under a nonexistent username.
  const selectedOwner = p.ownerValue ?? activeUsername ?? '';
  const ownerOptions = (knownUsernames.length ? knownUsernames : [activeUsername].filter(Boolean))
    .map(u => `<option value="${escHtml(u)}" ${u === selectedOwner ? 'selected' : ''}>${escHtml(u)}</option>`)
    .join('');
  const ownerField = isAdminUser
    ? `<select class="df-inline-copy-owner" aria-label="Copy to user" style="flex:1;min-width:100px">${ownerOptions}</select>`
    : '';
  const errorBanner = p.status === 'error'
    ? `<p style="margin:0 0 8px;font-size:0.875rem;color:var(--danger)">${escHtml(p.error)}</p>`
    : '';
  return `<tr class="df-inline-row"><td colspan="6">
    <div style="background:var(--panel-alt);padding:10px;border-radius:6px">
      ${errorBanner}
      <p style="margin:0 0 6px;font-size:0.875rem">Copy <strong>${escHtml(p.name)} (${escHtml(p.owner)})</strong> to:</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="df-inline-copy-name" type="text" placeholder="new-name" aria-label="New dataset name" value="${escHtml(p.nameValue || '')}" style="flex:1;min-width:100px">
        ${isAdminUser ? '<span style="font-size:0.875rem;color:var(--muted)">as user</span>' : ''}
        ${ownerField}
        <label style="white-space:nowrap;font-size:0.875rem"><input type="radio" name="df-inline-copy-vis" value="private" ${p.visValue !== 'public' ? 'checked' : ''}> Private</label>
        <label style="white-space:nowrap;font-size:0.875rem"><input type="radio" name="df-inline-copy-vis" value="public" ${p.visValue === 'public' ? 'checked' : ''}> Public</label>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-primary df-inline-copy-submit">Copy</button>
        <button class="btn btn-secondary df-inline-cancel">Cancel</button>
      </div>
    </div>
  </td></tr>`;
}

function renderDatasetList(datasets) {
  currentDatasets = datasets;
  const list = getEl('df-dataset-list');
  if (!datasets.length) {
    list.innerHTML = '<p style="color:var(--muted);margin:0 0 4px;font-size:0.875rem">No datasets yet — create one below.</p>';
    return;
  }
  const currentDataset = getSession()?.dataset;
  const rows = datasets.map(d => {
    const isOwn      = d.owner === activeUsername;
    const canManage  = isOwn || isAdminUser;
    const isSelected = currentDataset === `${d.owner}/${d.fullName}`;
    const isPending  = pendingRow && pendingRow.owner === d.owner && pendingRow.fullName === d.fullName;
    const newVis     = d.visibility === 'private' ? 'public' : 'private';
    const connectBtn = isSelected
      ? `<button class="btn btn-sm df-ds-disconnect df-badge df-badge-connected" data-owner="${d.owner}" data-fullname="${d.fullName}" title="Disconnect from this dataset">Connected ✕</button>`
      : canManage
        ? `<button class="btn btn-sm btn-primary df-ds-connect" data-owner="${d.owner}" data-fullname="${d.fullName}">Connect</button>`
        : '';
    const visBtn    = canManage
      ? `<button class="btn btn-sm btn-secondary df-ds-vis" data-owner="${d.owner}" data-fullname="${d.fullName}" data-newvis="${newVis}">→ ${newVis}</button>`
      : '';
    const copyBtn   = `<button class="btn btn-sm btn-secondary df-ds-copy" data-owner="${d.owner}" data-fullname="${d.fullName}" data-name="${d.name}">Copy</button>`;
    const deleteBtn = canManage
      ? `<button class="btn btn-sm btn-danger df-ds-delete" data-owner="${d.owner}" data-fullname="${d.fullName}" data-name="${d.name}">Delete</button>`
      : '';
    const muted = '<span style="color:var(--muted)">—</span>';
    const row = `<tr class="${isOwn ? 'df-row-own' : 'df-row-other'}${isSelected ? ' df-row-selected' : ''}${isPending ? ' row-editing' : ''}">
      <td>${d.name}</td>
      <td>${d.eventName || muted}</td>
      <td>${d.eventDate || muted}</td>
      <td>${d.owner}${d.orphaned ? ' <span style="color:var(--muted);font-size:0.8em">(orphaned)</span>' : ''}</td>
      <td><span class="df-badge df-badge-${d.visibility}">${d.visibility}</span></td>
      <td style="white-space:nowrap">${connectBtn}${visBtn}${copyBtn}${deleteBtn}</td>
    </tr>`;
    return isPending ? row + renderInlineRow() : row;
  }).join('');
  list.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Dataset</th><th>Event</th><th>Date</th><th>Owner</th><th>Visibility</th><th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  list.querySelectorAll('.df-ds-disconnect').forEach(btn => {
    btn.onclick = () => disconnectDataset();
  });
  list.querySelectorAll('.df-ds-connect').forEach(btn => {
    btn.onclick = () => connectDataset(btn.dataset.owner, btn.dataset.fullname);
  });
  list.querySelectorAll('.df-ds-vis').forEach(btn => {
    btn.onclick = () => changeVisibility(btn.dataset.owner, btn.dataset.fullname, btn.dataset.newvis);
  });
  list.querySelectorAll('.df-ds-copy').forEach(btn => {
    btn.onclick = () => showCopyForm(btn.dataset.owner, btn.dataset.fullname, btn.dataset.name);
  });
  list.querySelectorAll('.df-ds-delete').forEach(btn => {
    btn.onclick = () => deleteDataset(btn.dataset.owner, btn.dataset.fullname, btn.dataset.name);
  });

  // Inline Connect/Copy row buttons — only one pendingRow at a time, so a plain querySelector
  // (rather than querySelectorAll) is enough.
  list.querySelector('.df-inline-connect-push')?.addEventListener('click', () => confirmConnect(true));
  list.querySelector('.df-inline-connect-discard')?.addEventListener('click', () => confirmConnect(false));
  list.querySelector('.df-inline-cancel')?.addEventListener('click', () => { pendingRow = null; rerenderDatasetList(); });
  list.querySelector('.df-inline-copy-submit')?.addEventListener('click', submitInlineCopy);
  list.querySelector('.df-inline-copy-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitInlineCopy(); });
  list.querySelector('.df-inline-copy-owner')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitInlineCopy(); });
}

function disconnectDataset() {
  clearSession();
  updateDataFileButton();
  loadDatasets();
}

async function deleteDataset(owner, fullName, name) {
  if (!await showConfirmDialog(`Permanently delete "${name}"? This cannot be undone — all data in this dataset will be lost.`, 'Delete', true)) return;
  setStatus('df-dataset-status', 'Deleting…');
  apiDeleteDataset(activeToken, owner, fullName).then(result => {
    if (result.error) { setStatus('df-dataset-status', result.error, true); return; }
    const session = getSession();
    if (session && session.dataset === `${owner}/${fullName}`) {
      clearSession();
      setStandalone(true);
      updateDataFileButton();
    }
    setStatus('df-dataset-status', `"${name}" deleted.`);
    loadDatasets();
  }).catch(() => {
    reportError('df-dataset-status', 'Server unreachable — cannot delete right now, try again once back online.');
  });
}

function changeVisibility(owner, fullName, newVisibility) {
  setStatus('df-dataset-status', `Changing to ${newVisibility}…`);
  apiChangeVisibility(activeToken, owner, fullName, newVisibility).then(result => {
    if (result.error) { setStatus('df-dataset-status', result.error, true); return; }
    const session = getSession();
    if (session && session.dataset === `${owner}/${fullName}`) {
      setSession(activeToken, `${owner}/${result.fullName}`);
      updateDataFileButton();
    }
    setStatus('df-dataset-status', '');
    loadDatasets();
  }).catch(() => {
    reportError('df-dataset-status', 'Server unreachable — cannot change visibility right now, try again once back online.');
  });
}

function connectDataset(owner, fullName) {
  const name = fullName.replace(/-(?:private|public)$/, '');
  const hasPushOption = isDirty() && hasCachedData();
  pendingRow = { type: 'connect', owner, fullName, name, hasPushOption, status: 'confirming' };
  rerenderDatasetList();
}

// Called from the inline row's Push&Connect/Discard&Connect/Connect button.
function confirmConnect(pushFirst) {
  const { owner, fullName } = pendingRow;
  pendingRow = { ...pendingRow, status: 'busy', busyLabel: pushFirst ? 'Pushing local changes…' : 'Connecting…' };
  rerenderDatasetList();
  doConnectDataset(owner, fullName, pushFirst);
}

function doConnectDataset(owner, fullName, pushFirst) {
  switchDataset(activeToken, owner, fullName, { pushFirst }).then(() => {
    updateDataFileButton();
    // switchDataset()/restoreDirectory() degrade to the local cache rather than hard-failing
    // when the server can't be reached — deliberately, so Connect still works offline with
    // whatever was last synced. Either way this navigates away via _onConnect() (app.js's
    // connectAndLoad(), which shows its own reachedServer-aware message on the Home page it
    // lands on — see that fix), so there's nothing left to show here regardless of whether
    // the server was actually reached.
    pendingRow = null;
    _onConnect?.();
  }).catch(() => {
    // The common "server unreachable" case is already handled above via reachedServer===false
    // (restoreDirectory() catches that itself and resolves, it never rejects for it) — this
    // catch only fires for something genuinely unexpected, so it's a rare path in practice.
    // Still worth keeping inline rather than the below-the-fold df-dataset-status, on the same
    // "never make the operator scroll to see what happened" principle as everything else here.
    pendingRow = { ...pendingRow, status: 'error', error: 'Server unreachable — cannot connect right now, try again once back online.' };
    rerenderDatasetList();
  });
}

// ---- Copy form ----

function showCopyForm(owner, fullName, name) {
  pendingRow = { type: 'copy', owner, fullName, name, status: 'confirming' };
  rerenderDatasetList();
}

function submitInlineCopy() {
  const list       = getEl('df-dataset-list');
  const toName     = list.querySelector('.df-inline-copy-name')?.value.trim() || '';
  const visibility = radioValue('df-inline-copy-vis');
  // Only present for admins (see renderInlineRow()) — everyone else copies into their own
  // folder, which the server already defaults to when toOwner is omitted.
  const toOwner    = isAdminUser ? (list.querySelector('.df-inline-copy-owner')?.value.trim() || '') : undefined;
  if (!toName) {
    pendingRow = { ...pendingRow, status: 'error', error: 'Enter a name for the copy.', nameValue: toName, visValue: visibility, ownerValue: toOwner };
    rerenderDatasetList();
    return;
  }
  const nameError = validateDatasetName(toName);
  if (nameError) {
    pendingRow = { ...pendingRow, status: 'error', error: nameError, nameValue: toName, visValue: visibility, ownerValue: toOwner };
    rerenderDatasetList();
    return;
  }
  if (isAdminUser && !toOwner) {
    pendingRow = { ...pendingRow, status: 'error', error: 'Enter the username to copy this dataset to.', nameValue: toName, visValue: visibility, ownerValue: toOwner };
    rerenderDatasetList();
    return;
  }
  const { owner, fullName } = pendingRow;
  pendingRow = { ...pendingRow, status: 'busy', nameValue: toName, visValue: visibility, ownerValue: toOwner };
  rerenderDatasetList();
  apiCopyDataset(activeToken, owner, fullName, toName, visibility, toOwner)
    .then(result => {
      if (result.error) {
        pendingRow = { ...pendingRow, status: 'error', error: result.error };
        rerenderDatasetList();
        return;
      }
      pendingRow = null;
      loadDatasets();
    }).catch(() => {
      pendingRow = { ...pendingRow, status: 'error', error: 'Server unreachable — cannot copy right now, try again once back online.' };
      rerenderDatasetList();
    });
}

// ---- State export / import ----

function exportState() {
  const data = dumpState();
  const name = sanitise(state.event.name || 'racemaster');
  downloadText(JSON.stringify(data, null, 2), `racemaster-${name}_state.json`);
  showStatus('State exported.');
}

async function importState() {
  const text = await pickFile('.json');
  if (!text) return;
  let data;
  try { data = JSON.parse(text); }
  catch { showStatus('Not a valid JSON file.', true); return; }
  if (!await showConfirmDialog('Import will replace ALL current data. This cannot be undone. Continue?', 'Import', true)) return;
  showBusy('Importing…');
  await restoreState(data);
  await loadAll();
  showBusy('');
  renderAll();
  showView('home');
  showStatus('State imported successfully.');
}

// ---- Wire and render ----

export function wireDatasets(onConnect) {
  _onConnect = onConnect;

  getEl('btn-export-state').onclick = exportState;
  getEl('btn-import-state').onclick = importState;

  getEl('btn-toggle-server-hidden').onclick = () => {
    const hidden = !isServerHidden();
    setServerHidden(hidden);
    updateServerHiddenButton();
    showStatus(hidden
      ? 'Server hidden — every server request will now fail as if genuinely unreachable.'
      : 'Server unhidden — back to normal.');
    // The header status dot otherwise only re-checks on its own 30s timer — force an
    // immediate re-check so toggling this gives instant feedback instead of a stale banner.
    pingServerNow();
    // Same for the dataset list on this page — refresh it too rather than leaving it
    // showing whatever it last happened to load.
    if (activeToken) loadDatasets();
  };

  function handleLogin(isCreate) {
    const username = getEl('df-username').value.trim();
    const password = getEl('df-password').value;
    if (!username || !password) {
      setStatus('df-auth-status', 'Enter username and password.', true);
      return;
    }
    if (isCreate && !/^[a-zA-Z0-9-]+$/.test(username)) {
      setStatus('df-auth-status', 'Username can only contain letters, numbers and hyphens (a-z, A-Z, 0-9, -).', true);
      return;
    }
    // Confirm-password is only meaningful (and only checked) when creating an account — Sign
    // In ignores whatever's sitting in that field.
    if (isCreate && password !== getEl('df-confirm-password').value) {
      setStatus('df-auth-status', 'Passwords do not match.', true);
      return;
    }
    setStatus('df-auth-status', isCreate ? 'Creating account…' : 'Signing in…');
    const call = isCreate ? apiCreateAccount(username, password) : apiLogin(username, password);
    call.then(result => {
      if (result.error) {
        setStatus('df-auth-status', result.error, true);
      } else {
        setStandalone(false);
        activeToken    = result.token;
        activeUsername = result.username;
        setUsername(result.username);
        setIsAdmin(!!result.isAdmin);
        isAdminUser = !!result.isAdmin;
        updateDataFileButton();
        loadDatasets();
      }
    }).catch(() => {
      reportError('df-auth-status', `Server unreachable — cannot ${isCreate ? 'create an account' : 'sign in'} right now, try again once back online.`);
    });
  }

  getEl('df-btn-login').onclick          = () => handleLogin(false);
  getEl('df-btn-create-account').onclick = () => handleLogin(true);
  getEl('df-password').onkeydown         = e => { if (e.key === 'Enter') handleLogin(false); };
  getEl('df-confirm-password').onkeydown = e => { if (e.key === 'Enter') handleLogin(true); };
  blockClipboard(getEl('df-confirm-password'));

  document.querySelectorAll('.btn-toggle-password').forEach(btn => {
    btn.onclick = () => togglePasswordVisibility(btn);
  });

  getEl('df-btn-standalone').onclick = () => {
    clearSession();
    clearCredentials();
    setStandalone(true);
    activeToken    = null;
    activeUsername = null;
    resetPasswordVisibility();
    updateDataFileButton();
    _onConnect?.();
  };

  function resetVisRadio(name) {
    const privateRadio = document.querySelector(`input[name="${name}"][value="private"]`);
    if (privateRadio) privateRadio.checked = true;
  }

  getEl('df-btn-do-save-as').onclick = () => {
    const nameInput = getEl('df-save-as-name');
    const name = nameInput.value.trim();
    if (!name) { setStatus('df-newdataset-status', 'Enter a name for the new dataset.', true); return; }
    const nameError = validateDatasetName(name);
    if (nameError) { setStatus('df-newdataset-status', nameError, true); return; }
    const visibility = radioValue('df-save-as-vis');
    setStatus('df-newdataset-status', 'Saving…');
    saveAsDataset(activeToken, activeUsername, name, visibility)
      .then(result => {
        if (result.error) { setStatus('df-newdataset-status', result.error, true); return; }
        nameInput.value = '';
        resetVisRadio('df-save-as-vis');
        setStatus('df-newdataset-status', `Saved as "${name}".`);
        loadDatasets();
      }).catch(() => {
        reportError('df-newdataset-status', 'Server unreachable — cannot save right now, try again once back online.');
      });
  };

  getEl('df-save-as-name').onkeydown = e => { if (e.key === 'Enter') getEl('df-btn-do-save-as').click(); };

  getEl('df-btn-create-dataset').onclick = () => {
    if (!activeToken) { showPanel('auth', false); return; }
    const nameInput = getEl('df-new-dataset-name');
    const name = nameInput.value.trim();
    if (!name) { setStatus('df-newdataset-status', 'Enter a dataset name.', true); return; }
    const nameError = validateDatasetName(name);
    if (nameError) { setStatus('df-newdataset-status', nameError, true); return; }
    const visibility = radioValue('df-new-vis');
    setStatus('df-newdataset-status', 'Creating…');
    apiCreateDataset(activeToken, name, visibility).then(result => {
      if (result.error) { setStatus('df-newdataset-status', result.error, true); return; }
      nameInput.value = '';
      resetVisRadio('df-new-vis');
      switchDataset(activeToken, result.owner, result.fullName).then(() => {
        updateDataFileButton();
        _onConnect?.();
      });
    }).catch(() => {
      reportError('df-newdataset-status', 'Server unreachable — cannot create right now, try again once back online.');
    });
  };

  getEl('df-new-dataset-name').onkeydown = e => {
    if (e.key === 'Enter') getEl('df-btn-create-dataset').click();
  };

  blockClipboard(getEl('df-new-user-password-confirm'));

  getEl('df-btn-add-user').onclick = () => {
    const nameInput     = getEl('df-new-user-name');
    const passwordInput = getEl('df-new-user-password');
    const confirmInput  = getEl('df-new-user-password-confirm');
    const username = nameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) { setStatus('df-user-status', 'Enter a username and password.', true); return; }
    if (!/^[a-zA-Z0-9-]+$/.test(username)) {
      setStatus('df-user-status', 'Username can only contain letters, numbers and hyphens (a-z, A-Z, 0-9, -).', true);
      return;
    }
    if (password !== confirmInput.value) { setStatus('df-user-status', 'Passwords do not match.', true); return; }
    setStatus('df-user-status', 'Adding user…');
    apiCreateUser(activeToken, username, password).then(result => {
      if (result.error) { setStatus('df-user-status', result.error, true); return; }
      nameInput.value = '';
      passwordInput.value = '';
      confirmInput.value = '';
      setStatus('df-user-status', `"${username}" added.`);
      loadUsers();
    }).catch(() => reportError('df-user-status', 'Server unreachable — cannot add this user right now, try again once back online.'));
  };

  getEl('df-new-user-password-confirm').onkeydown = e => { if (e.key === 'Enter') getEl('df-btn-add-user').click(); };

  getEl('df-btn-logout').onclick = () => {
    clearSession();
    clearCredentials();
    activeToken    = null;
    activeUsername = null;
    getEl('df-username').value = '';
    getEl('df-password').value = '';
    getEl('df-confirm-password').value = '';
    showPanel('auth', false);
    updateDataFileButton();
  };
}

export function renderDatasets() {
  updateServerHiddenButton();
  activeToken    = getSession()?.token || null;
  activeUsername = getUsername() || null;
  isAdminUser    = getIsAdmin();
  if (activeToken) {
    loadDatasets();
  } else {
    showPanel('auth', false);
    setTimeout(() => getEl('df-username')?.focus(), 0);
  }
}