'use strict';

import { getSession, isDirty, getVersion, isConflicted } from './storage.js';
import { showConfirmDialog } from './ui.js';

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

export function startConflictWatch() {
  window.addEventListener('racemaster-conflict', async () => {
    updateDataFileButton();
    if (await showConfirmDialog(
      'This dataset has been updated by another session — your changes may not have saved. Reload now to get the latest data?',
      'Reload'
    )) {
      location.reload();
    } else {
      updateDataFileButton();
    }
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
  const name    = (fullName || session.dataset).replace(/-(?:private|public)$/, '');
  const version = getVersion();
  const dirty   = isDirty();
  if (isConflicted()) {
    dsSpan.textContent   = ` ⚠ conflict — reload required`;
    dsSpan.style.color      = '#333';
    dsSpan.style.background = 'var(--header-warn)';
    dsSpan.style.padding    = '2px 6px';
    dsSpan.style.borderRadius = '3px';
  } else {
    dsSpan.textContent      = ` · ${owner} / ${name}  v${version}${dirty ? ' *' : ''}`;
    dsSpan.style.color      = dirty ? 'var(--header-warn)' : '';
    dsSpan.style.background = '';
    dsSpan.style.padding    = '';
    dsSpan.style.borderRadius = '';
  }
}
