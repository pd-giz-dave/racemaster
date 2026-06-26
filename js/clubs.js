'use strict';

import { state } from './state.js';
import { findSimilarPairs } from './utils.js';

export function getClubs() {
  const map = new Map();
  for (const p of state.people) {
    const club = (p.club || '').trim();
    const entry = map.get(club) || { count: 0, lastSeen: '' };
    entry.count++;
    if (p.lastSeen && p.lastSeen > entry.lastSeen) entry.lastSeen = p.lastSeen;
    map.set(club, entry);
  }
  const named = [...map.entries()].filter(([n]) => n).sort((a, b) => a[0].localeCompare(b[0]));
  const blank = map.has('') ? [['', map.get('')]] : [];
  return [...blank, ...named];
}

export function findDuplicateClubPairs() {
  const clubs = getClubs().filter(([n]) => n);
  return findSimilarPairs(clubs, ([name]) => name)
    .map(({ a, b, exact }) => ({ a: clubs[a], b: clubs[b], exact }));
}