'use strict';

import { state } from '../state.js';
import { getEntriesOnCourse } from '../entries.js';
import { getNumberOfHelpers } from '../helpers.js';
import { getOutstandingSafetyCount, getSortedFinishers } from '../finishers.js';
import { setHTML } from '../ui.js';
import { COURSE, FINISHER } from '../constants.js';

export function renderHome() {
  const ev = state.event;
  setHTML('home-event-name',       ev.name || '(no event loaded)');
  setHTML('home-event-date',       ev.date || '');
  setHTML('home-helper-count',     getNumberOfHelpers());
  setHTML('home-senior-count',     getEntriesOnCourse(COURSE.SENIORS));
  setHTML('home-junior-count',     getEntriesOnCourse(COURSE.JUNIORS));
  setHTML('home-senior-finishers', getSortedFinishers(COURSE.SENIORS).filter(f => f.action === FINISHER.NORMAL).length);
  setHTML('home-junior-finishers', getSortedFinishers(COURSE.JUNIORS).filter(f => f.action === FINISHER.NORMAL).length);
  setHTML('home-safety-count',     getOutstandingSafetyCount());
}