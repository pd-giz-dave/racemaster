'use strict';

import { state } from '../state.js';
import { escHtml, setHTML } from '../ui.js';

function getClubs() {
  const map = new Map();
  for (const p of state.people) {
    const club = (p.club || '').trim();
    if (!club) continue;
    const entry = map.get(club) || { count: 0, lastSeen: '' };
    entry.count++;
    if (p.lastSeen && p.lastSeen > entry.lastSeen) entry.lastSeen = p.lastSeen;
    map.set(club, entry);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function renderClubs() {
  const tbody = document.getElementById('clubs-tbody');
  if (!tbody) return;
  const clubs = getClubs();
  tbody.innerHTML = clubs.map(([name, d]) => `
    <tr>
      <td>${escHtml(name)}</td>
      <td>${d.count}</td>
      <td>${d.lastSeen || ''}</td>
    </tr>`).join('');
  setHTML('clubs-count', `${clubs.length} clubs`);
}

export function wireClubs() {}