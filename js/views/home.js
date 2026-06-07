'use strict';

import { state } from '../state.js';
import { getNumberOfEntries, getEntriesOnCourse } from '../entries.js';
import { getOutstandingSafetyCount } from '../finishers.js';
import { setHTML } from '../ui.js';
import { COURSE } from '../constants.js';

export function renderHome() {
  const ev = state.event;
  setHTML('home-event-name',    ev.name || '(no event loaded)');
  setHTML('home-event-date',    ev.date || '');
  setHTML('home-entry-count',   getNumberOfEntries());
  setHTML('home-senior-count',  getEntriesOnCourse(COURSE.SENIORS));
  setHTML('home-junior-count',  getEntriesOnCourse(COURSE.JUNIORS));
  setHTML('home-safety-count',  getOutstandingSafetyCount());
}