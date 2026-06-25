'use strict';

import {
  getSession, setSession, clearSession,
  getUsername, setUsername, getIsAdmin, setIsAdmin,
  setStandalone, isDirty, hasCachedData,
  apiLogin, apiCreateAccount, apiListDatasets, apiCreateDataset, apiCopyDataset, apiChangeVisibility,
  apiDeleteDataset, switchDataset, saveAsDataset, apiListUsers, apiSetUserAdmin, apiDeleteUser,
} from './storage.js';
import { showConfirmDialog } from './ui.js';

// ---- Module-level state ----

let activeToken    = null;
let activeUsername = null;
let isAdminUser    = false;
let copySource     = null;
let _onConnect     = null;

// ---- Header: update check + server status ----

export function startUpdateCheck() {
  function showUpdateButton() {
    const btn = document.getElementById('btn-app-update');
    if (btn) btn.hidden = false;
  }
  if (window._swWaiting) showUpdateButton();
  window.addEventListener('sw-update-ready', showUpdateButton);

  document.getElementById('btn-app-update')?.addEventListener('click', async () => {
    const sw = window._swWaiting;
    if (!sw) return;
    if (!await showConfirmDialog('Apply update and reload now?', 'Update')) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    sw.postMessage({ type: 'SKIP_WAITING' });
  });
}

export function startServerPing() {
  async function ping() {
    const el = document.getElementById('header-server-status');
    if (!el) return;
    try {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8000);
      const res  = await fetch('/api/ping', { cache: 'no-store', signal: abort.signal });
      clearTimeout(timer);
      if (!res.ok) {
        el.textContent    = '● offline';
        el.style.color      = '#333';
        el.style.background = 'var(--header-warn)';
      } else {
        el.textContent    = '● online';
        el.style.color      = 'var(--header-fg-dim)';
        el.style.background = '';
        el.title            = '';
      }
    } catch {
      el.textContent    = '● offline';
      el.style.color      = '#333';
      el.style.background = 'var(--header-warn)';
    }
  }
  async function checkSwUpdate() {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.update();
  }
  ping();
  checkSwUpdate();
  setInterval(() => { ping(); checkSwUpdate(); }, 30_000);
  window.addEventListener('online', ping);
}

export function updateDataFileButton() {
  const dsSpan = document.getElementById('header-dataset-name');
  if (!dsSpan) return;
  const session = getSession();
  if (!session) {
    dsSpan.textContent = '';
    return;
  }
  const [owner, fullName] = session.dataset.split('/');
  const name = (fullName || session.dataset).replace(/-(?:private|public)$/, '');
  dsSpan.textContent = ` · ${owner} / ${name}`;
  dsSpan.style.color = isDirty() ? 'var(--header-warn)' : '';
}

// ---- Helpers ----

function getEl(id) { return document.getElementById(id); }

function showPanel(name, adminUser) {
  getEl('df-panel-auth').hidden        = (name !== 'auth');
  getEl('df-panel-loggedin').hidden    = (name !== 'datasets');
  getEl('df-panels-row').style.display = (name === 'datasets') ? 'flex' : 'none';
  getEl('df-panel-users').hidden       = (name !== 'datasets') || !adminUser;
}

function setStatus(id, msg, isError = false) {
  const el = getEl(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
}

function radioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || 'private';
}

// ---- Dataset list ----

function loadDatasets() {
  showPanel('datasets', isAdminUser);
  hideCopyForm();
  hideConnectConfirm();
  if (getEl('df-save-as-form')) getEl('df-save-as-form').hidden = true;
  const userEl = getEl('df-logged-in-user');
  if (userEl) userEl.textContent = activeUsername ? `Signed in as ${activeUsername}` : '';
  setStatus('df-dataset-status', 'Loading…');
  getEl('df-dataset-list').innerHTML = '';
  apiListDatasets(activeToken).then(datasets => {
    setStatus('df-dataset-status', '');
    renderDatasetList(datasets);
  }).catch(() => {
    setStatus('df-dataset-status', 'Could not load datasets.', true);
  });
  if (isAdminUser) loadUsers();
}

function loadUsers() {
  setStatus('df-user-status', 'Loading…');
  apiListUsers(activeToken).then(users => {
    if (!Array.isArray(users)) throw new Error(users?.error || 'Unexpected response');
    setStatus('df-user-status', '');
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
  }).catch(err => setStatus('df-user-status', err?.message || 'Could not load users.', true));
}

async function setUserAdmin(username, makeAdmin) {
  const label = makeAdmin ? 'Grant admin' : 'Revoke admin';
  const msg   = makeAdmin
    ? `Grant admin rights to "${username}"?`
    : `Revoke admin rights from "${username}"?`;
  if (!await showConfirmDialog(msg, label, true)) return;
  setStatus('df-user-status', makeAdmin ? 'Granting admin…' : 'Revoking admin…');
  apiSetUserAdmin(activeToken, username, makeAdmin).then(result => {
    if (result.error) { setStatus('df-user-status', result.error, true); return; }
    loadUsers();
  }).catch(() => setStatus('df-user-status', 'Server unreachable.', true));
}

async function deleteUser(username) {
  if (!await showConfirmDialog(`Delete user "${username}"? This does not delete their datasets.`, 'Delete', true)) return;
  setStatus('df-user-status', 'Deleting…');
  apiDeleteUser(activeToken, username).then(result => {
    if (result.error) { setStatus('df-user-status', result.error, true); return; }
    setStatus('df-user-status', `"${username}" deleted.`);
    loadUsers();
  }).catch(() => setStatus('df-user-status', 'Server unreachable.', true));
}

function renderDatasetList(datasets) {
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
    return `<tr class="${isOwn ? 'df-row-own' : 'df-row-other'}${isSelected ? ' df-row-selected' : ''}">
      <td>${d.name}</td>
      <td>${d.eventName || muted}</td>
      <td>${d.eventDate || muted}</td>
      <td>${d.owner}${d.orphaned ? ' <span style="color:var(--muted);font-size:0.8em">(orphaned)</span>' : ''}</td>
      <td><span class="df-badge df-badge-${d.visibility}">${d.visibility}</span></td>
      <td style="white-space:nowrap">${connectBtn}${visBtn}${copyBtn}${deleteBtn}</td>
    </tr>`;
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
    setStatus('df-dataset-status', 'Server unreachable.', true);
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
    setStatus('df-dataset-status', 'Server unreachable.', true);
  });
}

function connectDataset(owner, fullName) {
  const name = fullName.replace(/-(?:private|public)$/, '');
  if (isDirty() && hasCachedData()) {
    showConnectConfirm(
      `You have unsaved local data. Push it to "${name}" before connecting, or discard it?`,
      name,
      true,
      pushFirst => doConnectDataset(owner, fullName, pushFirst)
    );
  } else {
    showConnectConfirm(
      `Connecting will replace local data with "${name}" from the server.`,
      name,
      false,
      () => doConnectDataset(owner, fullName, false)
    );
  }
}

function showConnectConfirm(msg, name, hasPushOption, onConfirm) {
  getEl('df-connect-confirm-msg').textContent = msg;
  const pushBtn    = getEl('df-btn-connect-push');
  const discardBtn = getEl('df-btn-connect-discard');
  let focusBtn;
  if (hasPushOption) {
    pushBtn.hidden = false;
    pushBtn.textContent = `Push & Connect: ${name}`;
    pushBtn.onclick = () => { hideConnectConfirm(); onConfirm(true); };
    discardBtn.textContent = 'Discard & Connect';
    discardBtn.onclick = () => { hideConnectConfirm(); onConfirm(false); };
    focusBtn = pushBtn;
  } else {
    pushBtn.hidden = true;
    discardBtn.textContent = `Connect: ${name}`;
    discardBtn.onclick = () => { hideConnectConfirm(); onConfirm(false); };
    focusBtn = discardBtn;
  }
  getEl('df-connect-confirm').hidden = false;
  setTimeout(() => focusBtn.focus(), 0);
}

function hideConnectConfirm() {
  getEl('df-connect-confirm').hidden = true;
}

function doConnectDataset(owner, fullName, pushFirst) {
  setStatus('df-dataset-status', pushFirst ? 'Pushing local changes…' : 'Connecting…');
  switchDataset(activeToken, owner, fullName, { pushFirst }).then(() => {
    updateDataFileButton();
    _onConnect?.();
  }).catch(() => {
    setStatus('df-dataset-status', 'Could not connect to dataset.', true);
  });
}

// ---- Copy form ----

function showCopyForm(owner, fullName, name) {
  copySource = { owner, fullName, name };
  getEl('df-copy-source-label').textContent = `${name} (${owner})`;
  getEl('df-copy-name').value = '';
  const privateRadio = document.querySelector('input[name="df-copy-vis"][value="private"]');
  if (privateRadio) privateRadio.checked = true;
  getEl('df-copy-form').hidden = false;
  getEl('df-copy-name').focus();
}

function hideCopyForm() {
  getEl('df-copy-form').hidden = true;
  copySource = null;
}

// ---- Datafile view: wire once at startup ----

export function wireDatafileView(onConnect) {
  _onConnect = onConnect;

  // Auth panel
  function handleLogin(isCreate) {
    const username = getEl('df-username').value.trim();
    const password = getEl('df-password').value;
    if (!username || !password) {
      setStatus('df-auth-status', 'Enter username and password.', true);
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
      setStatus('df-auth-status', 'Server unreachable.', true);
    });
  }

  getEl('df-btn-login').onclick          = () => handleLogin(false);
  getEl('df-btn-create-account').onclick = () => handleLogin(true);
  getEl('df-password').onkeydown         = e => { if (e.key === 'Enter') handleLogin(false); };

  getEl('df-btn-standalone').onclick = () => {
    clearSession();
    setStandalone(true);
    activeToken    = null;
    activeUsername = null;
    updateDataFileButton();
    _onConnect?.();
  };

  getEl('df-btn-connect-cancel').onclick = hideConnectConfirm;
  getEl('df-btn-cancel-copy').onclick    = hideCopyForm;

  // Copy submit
  getEl('df-btn-do-copy').onclick = () => {
    if (!copySource) return;
    const toName = getEl('df-copy-name').value.trim();
    if (!toName) { setStatus('df-dataset-status', 'Enter a name for the copy.', true); return; }
    if (/public|private/i.test(toName)) {
      setStatus('df-dataset-status', 'Name must not contain "public" or "private".', true); return;
    }
    const visibility = radioValue('df-copy-vis');
    setStatus('df-dataset-status', 'Copying…');
    apiCopyDataset(activeToken, copySource.owner, copySource.fullName, toName, visibility)
      .then(result => {
        if (result.error) { setStatus('df-dataset-status', result.error, true); return; }
        hideCopyForm();
        loadDatasets();
      }).catch(() => {
        setStatus('df-dataset-status', 'Server unreachable.', true);
      });
  };

  getEl('df-copy-name').onkeydown = e => { if (e.key === 'Enter') getEl('df-btn-do-copy').click(); };

  // Save As form
  function showSaveAsForm() {
    getEl('df-save-as-name').value = '';
    const privateRadio = document.querySelector('input[name="df-save-as-vis"][value="private"]');
    if (privateRadio) privateRadio.checked = true;
    getEl('df-save-as-form').hidden = false;
    getEl('df-save-as-name').focus();
  }

  function hideSaveAsForm() {
    getEl('df-save-as-form').hidden = true;
  }

  getEl('df-btn-save-as').onclick        = showSaveAsForm;
  getEl('df-btn-cancel-save-as').onclick = hideSaveAsForm;

  getEl('df-btn-do-save-as').onclick = () => {
    const name = getEl('df-save-as-name').value.trim();
    if (!name) { setStatus('df-dataset-status', 'Enter a name for the new dataset.', true); return; }
    if (/public|private/i.test(name)) {
      setStatus('df-dataset-status', 'Name must not contain "public" or "private".', true); return;
    }
    const visibility = radioValue('df-save-as-vis');
    setStatus('df-dataset-status', 'Saving…');
    saveAsDataset(activeToken, activeUsername, name, visibility)
      .then(result => {
        if (result.error) { setStatus('df-dataset-status', result.error, true); return; }
        hideSaveAsForm();
        setStatus('df-dataset-status', `Saved as "${name}".`);
        loadDatasets();
      }).catch(() => {
        setStatus('df-dataset-status', 'Server unreachable.', true);
      });
  };

  getEl('df-save-as-name').onkeydown = e => { if (e.key === 'Enter') getEl('df-btn-do-save-as').click(); };

  // Create dataset
  getEl('df-btn-create-dataset').onclick = () => {
    if (!activeToken) { showPanel('auth', false); return; }
    const name = getEl('df-new-dataset-name').value.trim();
    if (!name) { setStatus('df-dataset-status', 'Enter a dataset name.', true); return; }
    if (/public|private/i.test(name)) {
      setStatus('df-dataset-status', 'Name must not contain "public" or "private".', true); return;
    }
    const visibility = radioValue('df-new-vis');
    setStatus('df-dataset-status', 'Creating…');
    apiCreateDataset(activeToken, name, visibility).then(result => {
      if (result.error) { setStatus('df-dataset-status', result.error, true); return; }
      switchDataset(activeToken, result.owner, result.fullName).then(() => {
        updateDataFileButton();
        _onConnect?.();
      });
    }).catch(() => {
      setStatus('df-dataset-status', 'Server unreachable.', true);
    });
  };

  getEl('df-new-dataset-name').onkeydown = e => {
    if (e.key === 'Enter') getEl('df-btn-create-dataset').click();
  };

  // Logout: stay on datasets page, show login form
  getEl('df-btn-logout').onclick = () => {
    clearSession();
    activeToken    = null;
    activeUsername = null;
    getEl('df-username').value = '';
    getEl('df-password').value = '';
    showPanel('auth', false);
    updateDataFileButton();
  };
}

// Called each time the user navigates to the datasets view.
export function refreshDatafileView() {
  activeToken    = getSession()?.token || null;
  activeUsername = getSession()?.dataset?.split('/')[0] || getUsername() || null;
  isAdminUser    = getIsAdmin();
  if (activeToken) {
    loadDatasets();
  } else {
    showPanel('auth', false);
    setTimeout(() => getEl('df-username')?.focus(), 0);
  }
}