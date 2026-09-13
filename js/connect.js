'use strict';

import { getSession, isDirty, getVersion, isConflicted, discardConflict, flushPendingMobileFiles } from './storage.js';
import { showConfirmDialog } from './ui.js';

export function startUpdateCheck() {
  function showUpdateButton() {
    const btn = document.getElementById('btn-app-update');
    if (btn) btn.hidden = false;
    // The button itself lives at the scrollable end of the header, so on a narrow
    // phone it can be scrolled out of reach — flag the always-visible title too.
    const title = document.getElementById('app-title-text');
    if (title) {
      title.classList.add('app-title-update-ready');
      title.title = 'An update is ready — scroll the title bar right for the Update available button';
    }
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
      discardConflict(); // confirmed: discard unsynced local edits, pull the server's copy
      location.reload();
    } else {
      updateDataFileButton();
    }
  });
}

// Whether the header status dot currently reads "login expired" — a saved session token that
// the server itself no longer accepts (e.g. its own sessions.txt got rebuilt out from under an
// already-logged-in browser — the exact field scenario racemaster-mobile's own
// ServerStatus.UNAUTHORIZED was added for). Exported so the Datasets page can show its own
// re-login prompt (see js/views/datasets.js's updateReloginBanner()) without duplicating this
// check itself — reacts to the 'racemaster-login-expired' event below rather than polling this
// getter, but reads it directly too for the page's own initial render.
let loginExpired = false;
export function isLoginExpired() { return loginExpired; }

function setLoginExpired(expired) {
  if (expired === loginExpired) return;
  loginExpired = expired;
  window.dispatchEvent(new CustomEvent('racemaster-login-expired', { detail: { expired } }));
}

// Cheap authenticated probe for whether [token] is still accepted — mirrors
// racemaster-mobile's own MuleSyncClient.checkAuth almost exactly, including reusing
// GET /api/mobile/status for the same reason it does there: it needs nothing more than a valid
// bearer token to succeed, costs the server one fs.statSync per already-stored device file (see
// that route's own doc in server/routes/mobile.js), and its response body is never read here,
// only the status code. Returns null ("inconclusive", not "rejected") for anything other than a
// clean 2xx or a clean 401/403 — this runs immediately after /api/ping just succeeded, so a
// transient failure on this specific request must never be misread as "logged out" the same way
// interpretServerStatus's own doc on the mobile side explains.
async function checkAuthStillValid(token) {
  try {
    const res = await fetch('/api/mobile/status', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    return null;
  } catch {
    return null;
  }
}

function renderOffline(el) {
  el.textContent    = '● offline';
  el.style.color      = '#333';
  el.style.background = 'var(--header-warn)';
  el.title             = '';
}

function renderOnline(el) {
  el.textContent    = '● online';
  el.style.color      = 'var(--header-fg-dim)';
  el.style.background = '';
  el.title             = '';
}

function renderLoginExpired(el) {
  el.textContent    = '● login expired';
  el.style.color      = '#333';
  el.style.background = 'var(--header-warn)';
  el.title             = 'Your saved login is no longer accepted by the server — sign in again on the Datasets page.';
}

// Pure decision behind the header dot's "login expired" vs "online" split (only reached once
// /api/ping has already confirmed the server itself is reachable — see pingServerNow) — mirrors
// racemaster-mobile's own interpretServerStatus (ServerStatusRepository.kt) almost exactly: only
// a definite rejection ([authOk] === false) downgrades to 'login-expired'; true (accepted) or
// null (inconclusive — no session to check at all, or a transient hiccup on this one request) is
// treated as 'online' either way, since neither is actual evidence the saved login stopped
// working. Exported and pulled out as its own function so this decision is directly testable
// without a real fetch.
export function interpretAuthCheck(authOk) {
  return authOk === false ? 'login-expired' : 'online';
}

// Checks /api/ping (reachability) and, whenever there's a saved session, also whether its own
// token is still accepted (see checkAuthStillValid above) — updates the header status dot with
// whichever of offline/login-expired/online actually applies, and (via setLoginExpired) lets the
// Datasets page react to a login-expired transition without polling for it itself. Exported on
// its own (not just wired into the interval below) so anything that already knows the server's
// reachability — or a session — just changed (the Datasets page's "Hide Server" testing toggle,
// a fresh sign-in, a re-login, a log-out) can force an immediate re-check instead of leaving the
// banner showing stale state for up to the next 30s tick.
export async function pingServerNow() {
  const el = document.getElementById('header-server-status');
  if (!el) return;
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    const res  = await fetch('/api/ping', { cache: 'no-store', signal: abort.signal });
    clearTimeout(timer);
    if (!res.ok) {
      renderOffline(el);
      // Unreachable — we genuinely don't know whether auth is also broken right now, so the
      // login-expired flag is left exactly as it was rather than guessed at either way; the
      // very next successful ping re-checks it properly.
      return;
    }
    const session = getSession();
    const authOk = session ? await checkAuthStillValid(session.token) : null;
    if (interpretAuthCheck(authOk) === 'login-expired') {
      renderLoginExpired(el);
      setLoginExpired(true);
    } else {
      renderOnline(el);
      setLoginExpired(false);
      // Reachable and (as far as we can tell) still logged in — flush anything a Bluetooth pull
      // queued locally while we (or the phones) were offline. Fire-and-forget:
      // flushPendingMobileFiles() handles its own errors and a slow/failed flush shouldn't hold
      // up this status-dot update.
      flushPendingMobileFiles();
    }
  } catch {
    renderOffline(el);
  }
}

export function startServerPing() {
  async function checkSwUpdate() {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.update();
  }
  pingServerNow();
  checkSwUpdate();
  setInterval(() => { pingServerNow(); checkSwUpdate(); }, 30_000);
  window.addEventListener('online', pingServerNow);
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
