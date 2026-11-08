'use strict';

import { TOOLTIPS, HELP, PAGES } from './strings.js';

export function wireTooltips() {
  for (const [id, tip] of Object.entries(TOOLTIPS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.title = tip;
    // A tooltip keyed to a form control should also show over its own label, not just the bare
    // control itself — easy to miss on a small radio/checkbox hit target. Covers both an
    // explicit <label for="id"> and the id'd element being nested inside an unlabelled
    // wrapping <label> (the Mobile Files "mf-option" rows, the Race Mode radios).
    const explicitLabel = document.querySelector(`label[for="${id}"]`);
    if (explicitLabel) explicitLabel.title = tip;
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) wrappingLabel.title = tip;
  }
}

export function wireViewHelp() {
  for (const [viewId, html] of Object.entries(HELP)) {
    const view = document.getElementById(viewId);
    if (!view) continue;
    const header = view.querySelector('.view-header');
    if (!header) continue;

    const panel = document.createElement('div');
    panel.className = 'view-help';
    panel.hidden = true;
    panel.innerHTML = html;
    header.insertAdjacentElement('afterend', panel);

    const btn = document.createElement('button');
    btn.className = 'btn-help';
    btn.textContent = '?';
    btn.title = 'Help';
    btn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      btn.classList.toggle('active', !panel.hidden);
    });
    header.prepend(btn);
  }
}

export function wireStaticPages() {
  for (const [key, html] of Object.entries(PAGES)) {
    const view = document.getElementById(`view-${key}`);
    if (!view) continue;
    const card = document.createElement('div');
    card.className = 'card page-content';
    card.innerHTML = html;
    view.appendChild(card);
  }
  makeWhatsNewCollapsible();
}

// PAGES['whats-new'] (strings.js) is a flat run of "<h3>version</h3><ul>...</ul>" pairs, newest
// first. Wraps each pair in a <details> so older versions collapse out of the way — only the
// first (newest) one starts open, since that's the "what changed since you last looked" entry
// most people actually want.
function makeWhatsNewCollapsible() {
  const container = document.querySelector('#view-whats-new .page-content');
  if (!container) return;
  [...container.querySelectorAll(':scope > h3')].forEach((h3, i) => {
    const details = document.createElement('details');
    if (i === 0) details.open = true;
    const summary = document.createElement('summary');
    summary.innerHTML = h3.innerHTML;
    details.appendChild(summary);
    h3.replaceWith(details);
    let sib = details.nextSibling;
    while (sib && !(sib.nodeType === 1 && sib.tagName === 'H3')) {
      const next = sib.nextSibling;
      details.appendChild(sib);
      sib = next;
    }
  });
}