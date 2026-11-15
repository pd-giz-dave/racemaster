'use strict';

// Device-local "Lock zoom" setting (Datasets page) — stops an accidental brush across the
// keyboard or touchpad zooming the page mid-event. Blocks Ctrl/Cmd +/- , Ctrl + mouse wheel
// (which is also what a touchpad pinch arrives as) and touchscreen pinch. Ctrl+0 (reset to
// 100%) is deliberately left working, so a zoom that still gets through (e.g. from the browser
// menu) can always be undone. Can't block the browser's own menu or the OS magnifier.

const LOCK_KEY = 'racemaster-zoom-locked';
const ZOOM_KEYS = new Set(['+', '=', '-', '_']);
const ZOOM_CODES = new Set(['NumpadAdd', 'NumpadSubtract']);
let installed = false;

export function isZoomLocked() {
  return localStorage.getItem(LOCK_KEY) === 'true';
}

export function setZoomLocked(locked) {
  if (locked) localStorage.setItem(LOCK_KEY, 'true');
  else localStorage.removeItem(LOCK_KEY);
  applyTouchAction();
}

function applyTouchAction() {
  document.documentElement.style.touchAction = isZoomLocked() ? 'pan-x pan-y' : '';
}

export function installZoomLock() {
  if (installed) return;
  installed = true;
  applyTouchAction();
  window.addEventListener('keydown', e => {
    if (!isZoomLocked() || !(e.ctrlKey || e.metaKey)) return;
    if (ZOOM_KEYS.has(e.key) || ZOOM_CODES.has(e.code)) e.preventDefault();
  }, { capture: true });
  window.addEventListener('wheel', e => {
    if (isZoomLocked() && e.ctrlKey) e.preventDefault();
  }, { passive: false, capture: true });
}
