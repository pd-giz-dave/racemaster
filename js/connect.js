'use strict';

import { getSession, getUsername, isDirty, getVersion, isConflicted, discardConflict, flushPendingMobileFiles, apiReadDataset, dumpState, overwriteServer } from './storage.js';
import { showConfirmDialog, showStatus } from './ui.js';
import { escHtml } from './utils.js';
import { buildConflictDiff } from './conflict-diff.js';

// Server-connectivity UI: the header's online/offline/login-expired status dot (pingServerNow,
// polled every 30s by startServerPing), the "update available" button for a waiting service
// worker, the offline-precache completeness check, and the save-conflict modal (built from
// conflict-diff.js's buildConflictDiff()) offering Reload vs Overwrite server. Several checks here
// deliberately mirror racemaster-mobile's own ServerStatusRepository/MuleSyncClient logic.

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

// One-off paranoia check, run once per page load (covers both a normal load and the reload
// that follows applying an update) — see sw.js's verifyPrecache for why this can't just be
// trusted to always have worked. Deliberately noisy (a blocking dialog, not a console warning)
// because the alternative is discovering it silently at the registration desk, already offline,
// when it's too late to do anything but hand out an unstyled printout.
export function startPrecacheCheck() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type !== 'PRECACHE_CHECK_RESULT') return;
    const { missing } = e.data;
    if (!missing?.length) return;
    showConfirmDialog(
      `OFFLINE CACHE INCOMPLETE: ${missing.length} file(s) failed to cache for offline use:\n\n` +
      missing.join('\n') +
      `\n\nOffline printing and other offline features may silently fail until this is fixed. ` +
      `Reload now while you still have a connection, and if it recurs, report it.`,
      'OK', true
    );
  });
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'VERIFY_PRECACHE' });
  }
}

export function startConflictWatch() {
  window.addEventListener('racemaster-conflict', async () => {
    updateDataFileButton();
    if (await showConfirmDialog(
      'This dataset has been updated by another session — your changes may not have saved. Show the differences between your copy and the server\'s?',
      'Show differences'
    )) {
      showConflictDetails();
    } else {
      updateDataFileButton();
    }
  });
}

// Shown from startConflictWatch()'s dialog or by clicking "⚠ conflict" in the header (see
// updateDataFileButton() below), so the choice between discarding local edits (Reload) and
// discarding the server's newer copy (Overwrite server) is made with the actual differences in
// view — a stale version counter (e.g. a second tab) often turns out to hide no real change.
function renderConflictModal({ localVersion, remoteVersion, tableDiffs }) {
  const versionLine = `<p style="margin:0 0 12px;font-size:0.875rem">`
    + `Your local copy is version ${localVersion}; the server is at version ${remoteVersion}.</p>`;
  const body = tableDiffs.length ? tableDiffs.map(d => `
      <h3 style="margin:16px 0 4px">${escHtml(d.table)}</h3>
      ${d.onlyLocal.length ? `
        <p style="margin:4px 0;font-weight:600;color:var(--accent)">Only in your local copy (unsynced) — ${d.onlyLocal.length} row(s):</p>
        <pre class="conflict-diff-rows">${escHtml(JSON.stringify(d.onlyLocal, null, 2))}</pre>` : ''}
      ${d.onlyRemote.length ? `
        <p style="margin:4px 0;font-weight:600;color:var(--danger)">Only on the server — ${d.onlyRemote.length} row(s):</p>
        <pre class="conflict-diff-rows">${escHtml(JSON.stringify(d.onlyRemote, null, 2))}</pre>` : ''}
    `).join('')
    : `<p style="color:var(--muted)">The version counter moved, but the data itself matches — it's likely safe to reload.</p>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-box" style="width:720px">
      <div class="modal-header">
        <h2>Conflict details</h2>
        <button class="modal-close-x" id="conflict-modal-close" aria-label="Close" title="Close">&times;</button>
      </div>
      ${versionLine}
      <div class="table-scroll">${body}</div>
      <div class="modal-actions">
        <button class="btn btn-delete" id="conflict-modal-reload" title="Discard your unsynced local changes and load the server's copy">Reload (discard my changes)</button>
        <button class="btn btn-delete" id="conflict-modal-overwrite" title="Replace the server's copy with your local data">Overwrite server</button>
        <button class="btn" id="conflict-modal-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  // A Reload/Overwrite confirm stacked on top handles its own Escape — only that should close.
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.choice-dialog-overlay')) close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('#conflict-modal-close').addEventListener('click', close);
  overlay.querySelector('#conflict-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#conflict-modal-reload').addEventListener('click', async () => {
    if (!await showConfirmDialog(
      'Reload from the server?\n\nYour unsynced local changes (the rows listed as "Only in your local copy") ' +
      'will be permanently discarded, and the app will reload with the server\'s copy. This cannot be undone.',
      'Reload', true, true
    )) return;
    discardConflict();
    location.reload();
  });
  overlay.querySelector('#conflict-modal-overwrite').addEventListener('click', async () => {
    if (!await showConfirmDialog(
      'Overwrite the server with your local copy?\n\nThe server\'s newer changes (the rows listed as "Only on the server") ' +
      'will be permanently lost, for every session using this dataset. Any other open tab or device will hit a ' +
      'conflict on its next save. This cannot be undone.',
      'Overwrite server', true, true
    )) return;
    close();
    if (await overwriteServer()) {
      showStatus('Server copy overwritten with your local data.');
    } else {
      showStatus('Could not overwrite the server copy — check you are online and try again.', true);
    }
    updateDataFileButton();
  });
}

async function showConflictDetails() {
  const session = getSession();
  if (!session) return;
  const [owner, fullName] = session.dataset.split('/');
  let remote;
  try {
    remote = await apiReadDataset(session.token, owner, fullName);
  } catch {
    showStatus('Could not reach the server to compare — try again once back online.', true);
    return;
  }
  renderConflictModal(buildConflictDiff(dumpState(), remote));
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
  // `owner` above is who the open *dataset* belongs to, not who's logged in — the two differ
  // whenever an admin opens someone else's dataset, which otherwise reads as "logged in as
  // <owner>" (easy to misread, since that's the only account name normally shown anywhere in
  // the header). Spelling out the real logged-in username only in that admin-on-someone-else's-
  // dataset case keeps the header unchanged for the common case of viewing your own dataset.
  const username = getUsername();
  const viewingOther = username && username !== owner;
  if (isConflicted()) {
    dsSpan.textContent   = ` ⚠ conflict — reload required`;
    dsSpan.style.color      = '#333';
    dsSpan.style.background = 'var(--header-warn)';
    dsSpan.style.padding    = '2px 6px';
    dsSpan.style.borderRadius = '3px';
    dsSpan.style.cursor      = 'pointer';
    dsSpan.title             = 'Click to see what differs from the server';
    dsSpan.onclick           = showConflictDetails;
  } else {
    dsSpan.textContent      = ` · ${viewingOther ? `${username} viewing ` : ''}${owner} / ${name}  v${version}${dirty ? ' *' : ''}`;
    dsSpan.title             = viewingOther ? `Logged in as ${username} — viewing ${owner}'s dataset` : '';
    dsSpan.style.color      = dirty ? 'var(--header-warn)' : '';
    dsSpan.style.background = '';
    dsSpan.style.padding    = '';
    dsSpan.style.borderRadius = '';
    dsSpan.style.cursor      = '';
    dsSpan.onclick           = null;
  }
}
