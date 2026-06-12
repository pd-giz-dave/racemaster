'use strict';

import { state } from '../state.js';
import { getEntriesOnCourse } from '../entries.js';
import { getNumberOfHelpers } from '../helpers.js';
import { getSortedFinishers, getOutstandingCount } from '../finishers.js';
import { setHTML } from '../ui.js';
import { COURSE } from '../constants.js';

function eventDetails(ev) {
  const rows = [];
  const row = (label, value) => rows.push(`<tr><td class="home-ev-label">${label}</td><td>${value}</td></tr>`);

  if (ev.date)          row('Date',             ev.date);
  if (ev.distance)      row('Distance',        `${ev.distance} km`);
  if (ev.categories)    row('Categories',       ev.categories);
  if (ev.timingMethod && ev.timingMethod !== 'None')
                        row('Senior timing',    ev.timingMethod);

  const hasJuniors = ev.juniorLimit && ev.juniorLimit !== 'None';
  if (hasJuniors) {
    row('Junior limit',   ev.juniorLimit);
    if (ev.juniorTimingMethod && ev.juniorTimingMethod !== 'None')
                        row('Junior timing',    ev.juniorTimingMethod);
  }

  if (!rows.length) return '';
  return `<table class="home-ev-table"><tbody>${rows.join('')}</tbody></table>`;
}

export function renderHome() {
  const ev = state.event;
  setHTML('home-view-title',       ev.name ? `${ev.name} Summary` : 'Event Summary');
  setHTML('home-event-details',    eventDetails(ev));
  setHTML('home-helper-count',     getNumberOfHelpers());
  setHTML('home-senior-count',     getEntriesOnCourse(COURSE.SENIORS));
  setHTML('home-junior-count',     getEntriesOnCourse(COURSE.JUNIORS));
  setHTML('home-senior-finishers', getSortedFinishers(COURSE.SENIORS).filter(f => f.action === 'Finish' || f.action === 'DNF').length);
  setHTML('home-junior-finishers', getSortedFinishers(COURSE.JUNIORS).filter(f => f.action === 'Finish' || f.action === 'DNF').length);
  setHTML('home-senior-outstanding', getOutstandingCount(COURSE.SENIORS));
  setHTML('home-junior-outstanding', getOutstandingCount(COURSE.JUNIORS));
}