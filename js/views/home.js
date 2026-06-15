'use strict';

import { state } from '../state.js';
import { getEntriesOnCourse } from '../entries.js';
import { getNumberOfHelpers } from '../helpers.js';
import { getSortedFinishers, getOutstandingCount } from '../finishers.js';
import { getLastBibNumber, getLastDibberNumber } from '../data.js';
import { setHTML } from '../ui.js';
import { COURSE } from '../constants.js';

function eventDetails(ev) {
  const rows = [];
  const row = (label, value) => rows.push(`<tr><td class="home-ev-label">${label}</td><td>${value}</td></tr>`);
  const gap = () => rows.push(`<tr><td colspan="2" style="height:8px"></td></tr>`);

  if (ev.date)                        row('Date',                 ev.date);
  if (ev.distance)                    row('Distance',             `${ev.distance} km`);
  if (ev.startTime)                   row('Start time',           ev.startTime);
  if (ev.firstBibNumber)              row('First bib',            ev.firstBibNumber);
  if (ev.categories)                  row('Categories',           ev.categories);
  if (ev.entryLimit)                  row('Entry limit',          ev.entryLimit);
  if (ev.timingMethod && ev.timingMethod !== 'None')
                                      row('Senior timing',        ev.timingMethod);
  if (ev.prizeDepthOverall)           row('Overall prizes',       ev.prizeDepthOverall);
  if (ev.prizeDepthPerCategory)       row('Category prizes',      ev.prizeDepthPerCategory);
  if (ev.maleRecord || ev.femaleRecord) gap();
  if (ev.maleRecord)                  row('Male record',          ev.maleRecord);
  if (ev.femaleRecord)                row('Female record',        ev.femaleRecord);
  gap();

  const hasJuniors = ev.juniorLimit && ev.juniorLimit !== 'None';
  if (hasJuniors) {
    row('Junior limit',                                           ev.juniorLimit);
    if (ev.juniorStartTime)           row('Junior start',        ev.juniorStartTime);
    if (+ev.juniorEntryLimit > 0)     row('Junior entry limit',  ev.juniorEntryLimit);
    if (ev.juniorTimingMethod && ev.juniorTimingMethod !== 'None')
                                      row('Junior timing',       ev.juniorTimingMethod);
    if (ev.juniorPrizeDepthPerCategory) row('Junior prizes',     ev.juniorPrizeDepthPerCategory);
  }

  if (!rows.length) return '';
  return `<table class="home-ev-table"><tbody>${rows.join('')}</tbody></table>`;
}

function eventStatistics() {
  const preImported    = state.preEntries.length;
  const preRegistered  = state.entries.filter(e => e.preEntry).length;
  const lastBib        = getLastBibNumber();
  const lastDibber     = getLastDibberNumber();
  const siCount        = state.siResults.length;
  const helpers        = getNumberOfHelpers();
  const seniorEntries  = getEntriesOnCourse(COURSE.SENIORS);
  const juniorEntries  = getEntriesOnCourse(COURSE.JUNIORS);
  const seniorFinish   = getSortedFinishers(COURSE.SENIORS).filter(f => f.action === 'Finish' || f.action === 'DNF').length;
  const juniorFinish   = getSortedFinishers(COURSE.JUNIORS).filter(f => f.action === 'Finish' || f.action === 'DNF').length;
  const seniorOut      = getOutstandingCount(COURSE.SENIORS);
  const juniorOut      = getOutstandingCount(COURSE.JUNIORS);

  const rows = [];
  const row = (label, value, color) => {
    const s = color ? ` style="color:${color};font-weight:600"` : '';
    rows.push(`<tr><td class="home-ev-label"${s}>${label}</td><td${s}>${value}</td></tr>`);
  };

  row('Senior entries', seniorEntries);
  if (juniorEntries > 0) row('Junior entries', juniorEntries);
  row('Senior finishers', seniorFinish);
  if (juniorEntries > 0) row('Junior finishers', juniorFinish);
  row('Seniors outstanding', seniorOut, seniorOut > 0 ? 'var(--danger)' : 'var(--accent)');
  if (juniorEntries > 0) row('Juniors outstanding', juniorOut, juniorOut > 0 ? 'var(--danger)' : 'var(--accent)');
  row('Helpers registered', helpers);
  if (preImported > 0) {
    row('Pre-entries imported', preImported);
    row('Pre-entry no-shows', preImported - preRegistered);
  }
  row('Last bib allocated', lastBib || '—');
  if (lastDibber > 0) row('Last dibber allocated', lastDibber);
  if (siCount > 0)    row('SI results imported', siCount);

  // Category breakdown — sort active categories by maleMinAge ascending
  const entryCatMap = {};
  for (const e of state.entries) {
    if (e.category) {
      const k = e.category.toUpperCase();
      entryCatMap[k] = (entryCatMap[k] || 0) + 1;
    }
  }

  const catRows = [...state.categories]
    .filter(r => r.maleCat && r.maleCat !== '-' && r.maleCat.toLowerCase() !== 'none')
    .sort((a, b) => (+a.maleMinAge || 0) - (+b.maleMinAge || 0))
    .filter(r => {
      const m = entryCatMap[(r.maleCat   || '').toUpperCase()] || 0;
      const f = entryCatMap[(r.femaleCat || '').toUpperCase()] || 0;
      return m > 0 || f > 0;
    });

  let catSection = '';
  if (catRows.length > 0) {
    const header = `<tr><th>Male</th><th class="num">#</th><th>Female</th><th class="num">#</th></tr>`;
    const trs = catRows.map(r => {
      const m = entryCatMap[(r.maleCat   || '').toUpperCase()] || 0;
      const f = entryCatMap[(r.femaleCat || '').toUpperCase()] || 0;
      return `<tr>
        <td>${r.maleCat}</td><td class="num">${m || '—'}</td>
        <td>${r.femaleCat || '—'}</td><td class="num">${f || '—'}</td>
      </tr>`;
    }).join('');
    catSection = `<p class="home-stats-section">Entries by category</p>
      <table class="home-stats-table"><thead>${header}</thead><tbody>${trs}</tbody></table>`;
  }

  if (!rows.length && !catSection) return '';
  return `<table class="home-ev-table"><tbody>${rows.join('')}</tbody></table>${catSection}`;
}

export function renderHome() {
  const ev = state.event;
  setHTML('home-view-title',       ev.name ? `${ev.name} Summary` : 'Event Summary');
  setHTML('home-event-details',    eventDetails(ev));
  setHTML('home-statistics', eventStatistics());
}