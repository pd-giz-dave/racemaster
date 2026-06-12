'use strict';

import {
  getSession, setSession, clearSession,
  isStandalone, setStandalone, isDirty,
  apiLogin, apiCreateAccount, apiListDatasets, apiCreateDataset, apiCopyDataset,
  switchDataset,
} from './storage.js';

// ---- Header button label ----

export function updateDataFileButton() {
  const btn = document.getElementById('btn-select-datafile');
  if (!btn) return;
  const session = getSession();
  if (!session) {
    btn.textContent = isStandalone() ? 'Standalone' : 'Select Data File';
    return;
  }
  // session.dataset = 'owner/name-visibility'
  const fullName = session.dataset.split('/')[1] || session.dataset;
  const name = fullName.replace(/-(?:private|public)$/, '');
  btn.textContent = name;
}

// ---- Helpers ----

function getEl(id) { return document.getElementById(id); }

function showPanel(name) {
  getEl('df-panel-auth').hidden     = (name !== 'auth');
  getEl('df-panel-datasets').hidden = (name !== 'datasets');
}

function setStatus(id, msg, isError = false) {
  const el = getEl(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger, #c0392b)' : 'var(--success, #1a6e3c)';
}

function radioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || 'private';
}

// ---- Modal ----

export function openDataFileModal() {
  return new Promise(resolve => {
    const backdrop = getEl('modal-datafile');
    backdrop.hidden = false;

    let activeToken    = getSession()?.token || null;
    let activeUsername = null;
    // Extract username from stored session dataset path if possible
    if (getSession()) activeUsername = getSession().dataset.split('/')[0] || null;

    let copySource = null; // { owner, fullName, name } of dataset being copied

    if (activeToken) {
      loadDatasets();
    } else {
      showPanel('auth');
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
      showPanel('datasets');
      hideCopyForm();
      hideConnectConfirm();
      setStatus('df-dataset-status', 'Loading…');
      getEl('df-dataset-list').innerHTML = '';
      apiListDatasets(activeToken).then(datasets => {
        setStatus('df-dataset-status', '');
        renderDatasetList(datasets);
      }).catch(() => {
        setStatus('df-dataset-status', 'Could not load datasets.', true);
      });
    }

    function renderDatasetList(datasets) {
      const list = getEl('df-dataset-list');
      if (!datasets.length) {
        list.innerHTML = '<p style="color:var(--muted,#888);margin:0 0 4px;font-size:0.875rem">No datasets yet — create one below.</p>';
        return;
      }
      list.innerHTML = datasets.map(d => {
        const isOwn = d.owner === activeUsername;
        const visBadge = `<span class="df-badge df-badge-${d.visibility}">${d.visibility}</span>`;
        const ownerBadge = isOwn ? '' : `<span class="df-badge df-badge-owner">${d.owner}</span>`;
        const connectBtn = isOwn
          ? `<button class="btn btn-sm btn-primary df-ds-connect" data-owner="${d.owner}" data-fullname="${d.fullName}">Connect</button>`
          : '';
        const copyBtn = `<button class="btn btn-sm btn-secondary df-ds-copy" data-owner="${d.owner}" data-fullname="${d.fullName}" data-name="${d.name}">Copy</button>`;
        return `<div class="df-ds-row">
          <span class="df-ds-name">${d.name}</span>
          ${ownerBadge}${visBadge}
          <span class="df-ds-actions">${connectBtn}${copyBtn}</span>
        </div>`;
      }).join('');

      list.querySelectorAll('.df-ds-connect').forEach(btn => {
        btn.onclick = () => connectDataset(btn.dataset.owner, btn.dataset.fullname);
      });
      list.querySelectorAll('.df-ds-copy').forEach(btn => {
        btn.onclick = () => showCopyForm(btn.dataset.owner, btn.dataset.fullname, btn.dataset.name);
      });
    }

    function connectDataset(owner, fullName) {
      const name = fullName.replace(/-(?:private|public)$/, '');
      if (isDirty()) {
        showConnectConfirm(
          `You have unsaved local data. Push it to "${name}" before connecting, or discard it?`,
          true,
          pushFirst => doConnectDataset(owner, fullName, pushFirst)
        );
      } else {
        showConnectConfirm(
          `Connecting will replace local data with "${name}" from the server.`,
          false,
          () => doConnectDataset(owner, fullName, false)
        );
      }
    }

    function showConnectConfirm(msg, hasPushOption, onConfirm) {
      getEl('df-connect-confirm-msg').textContent = msg;
      const pushBtn    = getEl('df-btn-connect-push');
      const discardBtn = getEl('df-btn-connect-discard');
      if (hasPushOption) {
        pushBtn.hidden = false;
        pushBtn.onclick = () => { hideConnectConfirm(); onConfirm(true); };
        discardBtn.textContent = 'Discard & Connect';
        discardBtn.onclick = () => { hideConnectConfirm(); onConfirm(false); };
      } else {
        pushBtn.hidden = true;
        discardBtn.textContent = 'Connect';
        discardBtn.onclick = () => { hideConnectConfirm(); onConfirm(false); };
      }
      getEl('df-connect-confirm').hidden = false;
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
      activeToken = null;
      activeUsername = null;
      getEl('df-username').value = '';
      getEl('df-password').value = '';
      setStatus('df-auth-status', '');
      setStatus('df-dataset-status', '');
      hideCopyForm();
      showPanel('auth');
    };

    // ---- Dismiss ----

    const canDismiss = () => !!getSession() || isStandalone();

    backdrop.onclick = e => {
      if (e.target !== backdrop) return;
      if (canDismiss()) { closeModal(); resolve(false); }
    };

    getEl('df-btn-close').onclick = () => {
      if (canDismiss()) { closeModal(); resolve(false); }
    };

    function closeModal() {
      backdrop.hidden = true;
      updateDataFileButton();
    }
  });
}