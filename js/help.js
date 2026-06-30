'use strict';

import { TOOLTIPS, HELP, PAGES } from './strings.js';

export function wireTooltips() {
  for (const [id, tip] of Object.entries(TOOLTIPS)) {
    const el = document.getElementById(id);
    if (el) el.title = tip;
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
}