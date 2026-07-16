'use strict';

// ============================================================
// Same-dataset multi-tab warning.
//
// localStorage (and therefore the whole offline cache in storage.js) is
// shared by every tab/window on this browser. Opening the same dataset
// twice does NOT give you two independent copies — it gives two
// uncoordinated writers to one shared local cache, each holding its own
// stale in-memory snapshot. Whichever tab writes a table last silently
// overwrites what the other tab wrote (or cleared).
//
// This module can't prevent that (both tabs need to stay usable — e.g.
// entries on one device, finishers on another is a legitimate pattern),
// but it warns the user the moment another tab/window has the same
// dataset open, so the confusing-clobbering scenario doesn't happen
// without anyone noticing.
// ============================================================

const CHANNEL_NAME = 'racemaster-presence';
const HEARTBEAT_MS = 5000;
const STALE_MS      = 15000;

const tabId = Math.random().toString(36).slice(2);

let channel = null;
let heartbeatTimer = null;
let dataset = null;
const peers = new Map(); // tabId -> lastSeen ms

function updateBanner() {
  const now = Date.now();
  for (const [id, ts] of peers) if (now - ts > STALE_MS) peers.delete(id);

  const el = document.getElementById('header-multitab-warning');
  if (!el) return;
  const visible = peers.size > 0;
  el.hidden = !visible;
  if (visible) {
    el.textContent      = ' ⚠ also open in another tab';
    el.style.color      = '#333';
    el.style.background = 'var(--header-warn)';
    el.style.padding    = '2px 6px';
    el.style.borderRadius = '3px';
  }
}

function send(type) {
  try { channel?.postMessage({ type, tabId, dataset }); } catch { /* channel closed */ }
}

/** Start (or restart, on dataset switch) watching for other tabs on the same dataset. */
export function startPresenceWatch(currentDataset) {
  if (channel) { send('bye'); channel.close(); channel = null; }
  clearInterval(heartbeatTimer);
  peers.clear();
  updateBanner();

  dataset = currentDataset;
  if (!dataset || typeof BroadcastChannel === 'undefined') return;

  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e) => {
    const msg = e.data;
    if (!msg || msg.tabId === tabId || msg.dataset !== dataset) return;
    if (msg.type === 'bye') { peers.delete(msg.tabId); updateBanner(); return; }
    peers.set(msg.tabId, Date.now());
    updateBanner();
    if (msg.type === 'hello') send('heartbeat'); // let the newcomer see us right away
  };

  send('hello');
  heartbeatTimer = setInterval(() => send('heartbeat'), HEARTBEAT_MS);
  window.addEventListener('beforeunload', () => send('bye'));
}