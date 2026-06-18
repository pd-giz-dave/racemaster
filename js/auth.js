'use strict';

import {
  getSession, setSession, clearSession,
  getUsername, setUsername, getIsAdmin, setIsAdmin,
  isStandalone, setStandalone, isDirty, hasCachedData,
  apiLogin, apiCreateAccount, apiListDatasets, apiCreateDataset, apiCopyDataset, apiChangeVisibility,
  apiDeleteDataset, switchDataset, saveAsDataset, apiListUsers, apiSetUserAdmin, apiDeleteUser,
} from './storage.js';
import { showConfirmDialog } from './ui.js';

// ---- Header button label + server status ----

export function startServerPing() {
  async function ping() {
    const el = document.getElementById('header-server-status');
    if (!el) return;
    try {
      const res = await fetch('/api/ping', { cache: 'no-store' });
      el.textContent = res.ok ? '● reachable' : '● unreachable';
      el.style.color  = res.ok ? 'var(--header-fg-dim)' : 'var(--header-warn)';
    } catch {
      el.textContent = '● unreachable';
      el.style.color  = 'var(--header-warn)';
    }
  }
  ping();
  setInterval(ping, 30_000);
}

export function updateDataFileButton() {
  const btn      = document.getElementById('btn-select-datafile');
  const userSpan = document.getElementById('header-username');
  if (!btn) return;
  const session   = getSession();
  const loggedIn  = getUsername();
  if (!session) {
    btn.textContent = isStandalone() ? 'Standalone' : 'Select Data File';
    btn.style.color = 'var(--header-fg)';
    if (userSpan) userSpan.textContent = loggedIn ? `Logged in as ${loggedIn}${getIsAdmin() ? ' (admin)' : ''}` : 'Not logged in';
    return;
  }
  // session.dataset = 'owner/name-visibility'
  const [owner, fullName] = session.dataset.split('/');
  const name     = (fullName || session.dataset).replace(/-(?:private|public)$/, '');
  const ownerStr = owner === loggedIn ? `${owner} (you)` : owner;
  btn.textContent = `Selected: ${name}` + (owner ? ` · Owned by ${ownerStr}` : '');
  if (userSpan) userSpan.textContent = loggedIn ? `Logged in as ${loggedIn}${getIsAdmin() ? ' (admin)' : ''}` : 'Not logged in';
  btn.style.color = isDirty() ? 'var(--header-warn)' : 'var(--header-fg)';
}

// ---- Helpers ----

function getEl(id) { return document.getElementById(id); }

function showPanel(name, adminUser) {
  getEl('df-panel-auth').hidden  = (name !== 'auth');
  getEl('df-panels-row').hidden  = (name !== 'datasets');
  getEl('df-panel-users').hidden = (name !== 'datasets') || !adminUser;
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

// ---- Modal ----

export function openDataFileModal() {
  return new Promise(resolve => {
    const view = getEl('view-datafile');
    document.querySelectorAll('.view').forEach(v => { v.hidden = v !== view; });

    let activeToken    = getSession()?.token || null;
    let activeUsername = null;
    let isAdminUser    = getIsAdmin();
    // Extract username from stored session dataset path if possible
    if (getSession()) activeUsername = getSession().dataset.split('/')[0] || null;

    let copySource = null; // { owner, fullName, name } of dataset being copied

    if (activeToken) {
      loadDatasets();
    } else {
      showPanel('auth', false);
      setTimeout(() => getEl('df-username').focus(), 0);
    }

    // ---- Auth panel ----

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
      closeModal();
      resolve(true);
    };

    // ---- Datasets panel ----

    getEl('df-btn-connect-cancel').onclick = hideConnectConfirm;

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
      const rows = datasets.map(d => {
        const isOwn = d.owner === activeUsername;
        const canManage = isOwn || isAdminUser;
        const newVis = d.visibility === 'private' ? 'public' : 'private';
        const connectBtn = canManage
          ? `<button class="btn btn-sm btn-primary df-ds-connect" data-owner="${d.owner}" data-fullname="${d.fullName}">Connect</button>`
          : '';
        const visBtn = canManage
          ? `<button class="btn btn-sm btn-secondary df-ds-vis" data-owner="${d.owner}" data-fullname="${d.fullName}" data-newvis="${newVis}">→ ${newVis}</button>`
          : '';
        const copyBtn = `<button class="btn btn-sm btn-secondary df-ds-copy" data-owner="${d.owner}" data-fullname="${d.fullName}" data-name="${d.name}">Copy</button>`;
        const deleteBtn = canManage
          ? `<button class="btn btn-sm btn-danger df-ds-delete" data-owner="${d.owner}" data-fullname="${d.fullName}" data-name="${d.name}">Delete</button>`
          : '';
        const muted = '<span style="color:var(--muted)">—</span>';
        return `<tr class="${isOwn ? 'df-row-own' : 'df-row-other'}">
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

    async function deleteDataset(owner, fullName, name) {
      if (!await showConfirmDialog(`Permanently delete "${name}"? This cannot be undone — all data in this dataset will be lost.`, 'Delete', true)) return;
      setStatus('df-dataset-status', 'Deleting…');
      apiDeleteDataset(activeToken, owner, fullName).then(result => {
        if (result.error) { setStatus('df-dataset-status', result.error, true); return; }
        // If the deleted dataset was the active one, revert to standalone
        const session = getSession();
        if (session && session.dataset === `${owner}/${fullName}`) {
          clearSession();
          setStandalone(true);
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
        // If the active dataset was just renamed, update the session
        const session = getSession();
        if (session && session.dataset === `${owner}/${fullName}`) {
          setSession(activeToken, `${owner}/${result.fullName}`);
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
        closeModal();
        resolve(true);
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

    getEl('df-btn-cancel-copy').onclick = hideCopyForm;

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

    // ---- Save As form ----

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

    getEl('df-btn-save-as').onclick = showSaveAsForm;
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

    // ---- Create form ----

    getEl('df-btn-create-dataset').onclick = () => {
      if (!activeToken) { showPanel('auth'); return; }
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
          closeModal();
          resolve(true);
        });
      }).catch(() => {
        setStatus('df-dataset-status', 'Server unreachable.', true);
      });
    };

    getEl('df-new-dataset-name').onkeydown = e => {
      if (e.key === 'Enter') getEl('df-btn-create-dataset').click();
    };

    // ---- Logout ----

    getEl('df-btn-logout').onclick = () => {
      clearSession();
      setStandalone(true);
      getEl('df-username').value = '';
      getEl('df-password').value = '';
      closeModal();
      resolve(true);
    };

    // ---- Dismiss ----

    function closeModal() {
      document.removeEventListener('keydown', onEsc);
      view.hidden = true;
      updateDataFileButton();
    }

    function onEsc(e) {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      closeModal();
      resolve(false);
    }
    document.addEventListener('keydown', onEsc);
  });
}