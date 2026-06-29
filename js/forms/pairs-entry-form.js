'use strict';

import { state } from '../state.js';
import { escHtml, showStatus } from '../ui.js';
import { calculateCategory } from '../categories.js';
import { openPopup } from './preview.js';

const PAIRS_DECLS = [
  'We accept the hazards inherent in fell running and acknowledge that we are entering and running this race at our own risk.',
  'We confirm that we are aware of the rules imposed on us by the Race Organiser and that we will comply with them.',
  'We confirm that we have read and will comply with the FRA "Requirements for Runners".',
  'We acknowledge and agree that we are each responsible for determining whether we have the skills, equipment and fitness to participate in this event.',
  'We accept that neither the Race Organiser nor the Fell Runners Association shall be liable to us for any injury, loss or damage of any nature to us or our property arising out of our participation in this race (other than in respect of death or personal injury as a result of their negligence).',
  'We consent to publication of our names, club, category, race number, finishing time and position in pre-entry and results lists.',
  'We agree to run as a pair throughout the race, remaining within sight and sound of each other at all times, and to finish together.',
];

const CUT_GUIDE  = `<div class="pef-cut"><span class="pef-cut-label">&#9986; cut here</span></div>`;
const EMPTY_HALF = `<div class="pef-half"></div>`;

function chk(filled) { return filled ? '&#9632;' : '&#9633;'; }

function runnerSection(num, runner, isSecond) {
  const isMale   = (runner.gender || '').toLowerCase().startsWith('m');
  const isFemale = (runner.gender || '').toLowerCase().startsWith('f');
  const cls = isSecond ? 'pef-runner-section pef-runner-second' : 'pef-runner-section';
  return `<div class="${cls}">
    <div class="pef-runner-label">${num === 1 ? 'PRIMARY ENTRANT (solo or pair)' : 'PARTNER (or blank if solo)'}</div>
    <div class="pef-row pef-row-key">
      <span class="pef-lbl pef-lbl-req pef-lbl-key">Full Name (block capitals):</span>
      <span class="pef-line pef-flex pef-line-key pef-name-field">${escHtml(runner.name || '')}</span>
    </div>
    <div class="pef-dob-gender pef-row-key">
      <div class="pef-half-cell">
        <span class="pef-lbl pef-lbl-req pef-lbl-key">Date of Birth (DD/MM/YY):</span>
        <span class="pef-line pef-flex pef-line-key">${escHtml(runner.dob || '')}</span>
      </div>
      <div class="pef-half-cell">
        <span class="pef-lbl pef-lbl-req pef-lbl-key">Gender:</span>
        <span class="pef-check pef-check-key pef-gender-gap">${chk(isMale)}&thinsp;Male/Open</span>
        <span class="pef-check pef-check-key pef-gender-gap">${chk(isFemale)}&thinsp;Female/Ladies</span>
      </div>
    </div>
    <div class="pef-row">
      <span class="pef-lbl">Club:</span>
      <span class="pef-line pef-club-line">${escHtml(runner.club || '')}</span>
      <span class="pef-lbl">FRA/WFRA No:</span>
      <span class="pef-line pef-flex">${escHtml(runner.fraNumber || '')}</span>
    </div>
  </div>`;
}

function pairsEntryFormHalf(org, entry = {}) {
  const juniorBase = (entry.category || '').replace(/[BGbg]$/, '').toUpperCase();
  const juniorCats = ['U10','U12','U14','U16','U18','U20']
    .map(c => `<span class="pef-check pef-check-lg">${chk(juniorBase === c)}&thinsp;${c}</span>`)
    .join('');

  const r1 = { name: entry.name || '', dob: entry.dob || '', gender: entry.gender || '', club: entry.club || '', fraNumber: entry.fraNumber || '' };
  const r2 = { name: '', dob: '', gender: '', club: '', fraNumber: '' };

  return `<div class="pef-half">
    <div class="pef-header">
      <div class="pef-org">${org}</div>
      <div class="pef-title-block">Pairs Entry Form</div>
      <div class="pef-event-box">
        <div class="pef-event-label">Event</div>
        <div class="pef-event-field">${escHtml(entry.eventName || '')}</div>
      </div>
    </div>
    <div class="pef-refs-row">
      <div class="pef-refs">
        <div class="pef-ref"><div class="pef-ref-label">Entry Num</div><div class="pef-ref-box">${escHtml(entry.entryNo || '')}</div></div>
        <div class="pef-ref"><div class="pef-ref-label">Race/Bib Num</div><div class="pef-ref-box"></div></div>
        <div class="pef-ref"><div class="pef-ref-label">Dibber Num</div><div class="pef-ref-box"></div></div>
      </div>
      <div class="pef-junior-cats">
        <div class="pef-junior-label">Junior pair category (age on 31st Dec)</div>
        <div class="pef-junior-checks">${juniorCats}</div>
      </div>
    </div>
    <div class="pef-hint">Please fill in at least the <strong><u>bold underlined</u></strong> items. Write clearly. Both runners must sign below.</div>
    ${runnerSection(1, r1, false)}
    <div class="pef-row">
      <span class="pef-lbl pef-lbl-req">Contact Phone (for use only in connection with this event):</span>
      <span class="pef-line pef-flex">${escHtml(entry.phone || '')}</span>
    </div>
    ${runnerSection(2, r2, true)}
    <div class="pef-important">Important: Read rules below. If you sign this form you are agreeing to all rules. Parent/Guardian must sign for junior runners.</div>
    <div class="pef-declarations">
      ${PAIRS_DECLS.map(d => `<div class="pef-decl">&#9658; ${d}</div>`).join('')}
    </div>
    <div class="pef-sign-row">
      <span class="pef-lbl">Signed (Primary):</span>
      <span class="pef-sign-line pef-sign-signed"></span>
      <span class="pef-lbl pef-sign-date-lbl">Date:</span>
      <span class="pef-sign-line pef-sign-date"></span>
    </div>
    <div class="pef-sign-row">
      <span class="pef-lbl">Signed (Partner):</span>
      <span class="pef-sign-line pef-sign-signed"></span>
      <span class="pef-lbl pef-sign-date-lbl">Date:</span>
      <span class="pef-sign-line pef-sign-date"></span>
    </div>
  </div>`;
}

function pagesFromHalves(halves) {
  const org = escHtml(state.event.organisation || 'WFRA/FRA FELL RACES');
  let html = '';
  for (let i = 0; i < halves.length; i += 2) {
    const top = pairsEntryFormHalf(org, halves[i]);
    const bot = i + 1 < halves.length ? pairsEntryFormHalf(org, halves[i + 1]) : EMPTY_HALF;
    html += `<div class="pairs-entry-page">${top}${CUT_GUIDE}${bot}</div>`;
  }
  return html;
}

function pairsPreEntryToFormData(pe) {
  const cat = calculateCategory(pe.dob || '', pe.gender || '') || pe.category || '';
  const fra = pe.fraNumber
    ? (pe.fraNumber.toUpperCase().startsWith('F-') ? pe.fraNumber : 'F-' + pe.fraNumber)
    : '';
  return {
    entryNo:  pe.participantNumber || '',
    name:     `${pe.firstName || ''} ${pe.lastName || ''}`.trim(),
    dob:      pe.dob     || '',
    gender:   pe.gender  || '',
    category: cat,
    club:     pe.club    || '',
    fraNumber: fra,
    phone:    pe.mobile || pe.telephone || '',
  };
}

export function generatePreFilledPairsEntryFormHTML() {
  const sorted = [...state.preEntries].sort((a, b) => {
    const ll = (a.lastName  || '').toLowerCase().localeCompare((b.lastName  || '').toLowerCase());
    if (ll !== 0) return ll;
    return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
  });
  const halfCount   = Math.ceil(sorted.length / 2);
  const interleaved = [];
  for (let i = 0; i < halfCount; i++) {
    interleaved.push(pairsPreEntryToFormData(sorted[i]));
    if (i + halfCount < sorted.length) interleaved.push(pairsPreEntryToFormData(sorted[i + halfCount]));
  }
  return pagesFromHalves(interleaved);
}

export function generateBlankPairsEntryFormHTML(count = 2) {
  return pagesFromHalves(Array.from({ length: count }, () => ({ entryNo: 'XXXX' })));
}

const PAIRS_ENTRY_FORM_POPUP = {
  title:    'Pairs Entry Forms',
  cssLinks: ['css/print.css', 'js/forms/pairs-entry-form.css'],
  inlineCSS: `
    @page { size: A4 portrait; margin: 0; }
    body.print-preview { padding: 0; }
  `,
};

export function openBlankPairsEntryFormPreview(count = 2) {
  openPopup({ ...PAIRS_ENTRY_FORM_POPUP, html: generateBlankPairsEntryFormHTML(count) });
}

export function openPreFilledPairsEntryFormPreview() {
  if (!state.preEntries.length) {
    showStatus('No pre-entries loaded — import a CSV file on the Pre-Entries page first.', true);
    return;
  }
  openPopup({ ...PAIRS_ENTRY_FORM_POPUP, html: generatePreFilledPairsEntryFormHTML() });
}