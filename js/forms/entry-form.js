'use strict';

import { state } from '../state.js';
import { escHtml } from '../ui.js';
import { calculateCategory } from '../categories.js';
import { openPopup } from './preview.js';

const DECLS = [
  'I accept the hazards inherent in fell running and acknowledge that I am entering and running this race at my own risk.',
  'I confirm that I am aware of the rules imposed on me by the Race Organiser and that I will comply with them.',
  'I confirm that I have read and will comply with the FRA "Requirements for Runners".',
  'I acknowledge and agree that I am responsible for determining whether I have the skills, equipment and fitness to participate in this event.',
  'I accept that neither the Race Organiser nor the Fell Runners Association shall be liable to me for any injury, loss or damage of any nature to me or my property arising out of my participation in this race (other than in respect of death or personal injury as a result of their negligence).',
  'I consent to publication of my name, club, category, race number, finishing time and position in pre-entry and results lists.',
  'I accept that the Race Organiser reserves the right to refuse a race entry for any reason.',
];

const CUT_GUIDE  = `<div class="bef-cut"><span class="bef-cut-label">&#9986; cut here</span></div>`;
const EMPTY_HALF = `<div class="bef-half"></div>`;

function chk(filled) { return filled ? '&#9632;' : '&#9633;'; }

function entryFormHalf(org, entry = {}) {
  const isMale     = (entry.gender || '').toLowerCase().startsWith('m');
  const isFemale   = (entry.gender || '').toLowerCase().startsWith('f');
  const juniorBase = (entry.category || '').replace(/[BGbg]$/, '').toUpperCase();

  const juniorCats = ['U10','U12','U14','U16','U18','U20']
    .map(c => `<span class="bef-check bef-check-lg">${chk(juniorBase === c)}&thinsp;${c}</span>`)
    .join('');

  const field = (val) => escHtml(val || '');
  const addr  = field(entry.address).replace(/\n/g, '<br>');

  return `
  <div class="bef-half">
    <div class="bef-header">
      <div class="bef-org">${org}</div>
      <div class="bef-title-block">Entry Form</div>
      <div class="bef-event-box">
        <div class="bef-event-label">Event</div>
        <div class="bef-event-field">${escHtml(entry.eventName || '')}</div>
      </div>
    </div>
    <div class="bef-refs-row">
      <div class="bef-refs">
        <div class="bef-ref"><div class="bef-ref-label">Entry Num</div><div class="bef-ref-box">${field(entry.entryNo)}</div></div>
        <div class="bef-ref"><div class="bef-ref-label">Race/Bib Num</div><div class="bef-ref-box"></div></div>
        <div class="bef-ref"><div class="bef-ref-label">Dibber Num</div><div class="bef-ref-box"></div></div>
      </div>
      <div class="bef-junior-cats">
        <div class="bef-junior-label">Juniors category (age on 31st Dec)</div>
        <div class="bef-junior-checks">${juniorCats}</div>
      </div>
    </div>
    <div class="bef-hint">Please fill in at least the <strong><u>bold underlined</u></strong> items and please write clearly.</div>
    <div class="bef-row bef-row-key">
      <span class="bef-lbl bef-lbl-req bef-lbl-key">Full Name (block capitals):</span>
      <span class="bef-line bef-flex bef-line-key bef-name-field">${field(entry.name)}</span>
    </div>
    <div class="bef-dob-gender bef-row-key">
      <div class="bef-half-cell">
        <span class="bef-lbl bef-lbl-req bef-lbl-key">Date of Birth (DD/MM/YY):</span>
        <span class="bef-line bef-flex bef-line-key">${field(entry.dob)}</span>
      </div>
      <div class="bef-half-cell">
        <span class="bef-lbl bef-lbl-req bef-lbl-key">Gender:</span>
        <span class="bef-check bef-check-key bef-gender-gap">${chk(isMale)}&thinsp;Male/Open</span>
        <span class="bef-check bef-check-key bef-gender-gap">${chk(isFemale)}&thinsp;Female/Ladies</span>
      </div>
    </div>
    <div class="bef-row">
      <span class="bef-lbl">Club:</span>
      <span class="bef-line bef-club-line">${field(entry.club)}</span>
      <span class="bef-lbl">FRA/WFRA No:</span>
      <span class="bef-line bef-fra-line">${field(entry.fraNumber)}</span>
      <span class="bef-lbl">Car Reg:</span>
      <span class="bef-line bef-flex">${field(entry.carReg)}</span>
    </div>
    <div class="bef-addr-phone">
      <div class="bef-addr-field">
        <span class="bef-field-label">Address</span>${addr}
      </div>
      <div class="bef-phone-col">
        <div class="bef-row"><span class="bef-lbl">Your Phone:</span><span class="bef-line bef-flex">${field(entry.phone)}</span></div>
        <div class="bef-row"><span class="bef-lbl bef-lbl-2line">Emergency<br>Contact:</span><span class="bef-line bef-flex">${field(entry.emergencyContact)}</span></div>
        <div class="bef-row"><span class="bef-lbl">Their Phone:</span><span class="bef-line bef-flex">${field(entry.emergencyPhone)}</span></div>
      </div>
    </div>
    <div class="bef-row">
      <div class="bef-half-cell"><span class="bef-lbl">Email:</span><span class="bef-line bef-flex">${field(entry.email)}</span></div>
      <div class="bef-half-cell"><span class="bef-lbl">Medical Conditions:</span><span class="bef-line bef-flex">${field(entry.medicalConds)}</span></div>
    </div>
    <div class="bef-important">Important: Read rules below. If you sign this form you are agreeing to all rules. Parent/Guardian must sign for juniors.</div>
    <div class="bef-declarations">
      ${DECLS.map(d => `<div class="bef-decl">&#9658; ${d}</div>`).join('')}
    </div>
    <div class="bef-sign-row">
      <span class="bef-lbl">Signed:</span>
      <span class="bef-sign-line bef-sign-signed"></span>
      <span class="bef-lbl bef-sign-date-lbl">Date:</span>
      <span class="bef-sign-line bef-sign-date"></span>
    </div>
  </div>`;
}

function pagesFromHalves(halves) {
  const org = escHtml(state.event.organisation || 'WFRA/FRA FELL RACES');
  let html = '';
  for (let i = 0; i < halves.length; i += 2) {
    const top = entryFormHalf(org, halves[i]);
    const bot = i + 1 < halves.length ? entryFormHalf(org, halves[i + 1]) : EMPTY_HALF;
    html += `<div class="blank-entry-page">${top}${CUT_GUIDE}${bot}</div>`;
  }
  return html;
}

export function generateBlankEntryFormHTML(count = 2) {
  return pagesFromHalves(Array.from({ length: count }, () => ({ entryNo: 'XXXX' })));
}

export function generateEntryFormHTML(entries = []) {
  return pagesFromHalves(entries);
}

function preEntryToFormData(pe) {
  const cat = calculateCategory(pe.dob || '', pe.gender || '') || pe.category || '';
  const fra = pe.fraNumber
    ? (pe.fraNumber.toUpperCase().startsWith('F-') ? pe.fraNumber : 'F-' + pe.fraNumber)
    : '';
  const address = [pe.address1, pe.address2, pe.town, pe.county, pe.postcode, pe.country]
    .map(s => (s || '').trim()).filter(Boolean).join(', ');
  return {
    eventName:        state.event.name   || '',
    entryNo:          pe.participantNumber || '',
    name:             `${pe.firstName || ''} ${pe.lastName || ''}`.trim(),
    dob:              pe.dob             || '',
    gender:           pe.gender          || '',
    category:         cat,
    club:             pe.club            || '',
    fraNumber:        fra,
    carReg:           pe.carReg          || '',
    address,
    phone:            pe.mobile || pe.telephone || '',
    emergencyContact: pe.contactName     || '',
    emergencyPhone:   pe.contactTelephone || '',
    email:            pe.email           || '',
    medicalConds:     pe.medical         || '',
  };
}

export function generatePreFilledEntryFormHTML() {
  const sorted = [...state.preEntries].sort((a, b) => {
    const ll = (a.lastName  || '').toLowerCase().localeCompare((b.lastName  || '').toLowerCase());
    if (ll !== 0) return ll;
    return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
  });
  // Guillotine layout: top halves = first half of alphabet, bottom halves = second half.
  // After cutting the stack in one go, top pile + bottom pile = A–Z in order.
  const halfCount   = Math.ceil(sorted.length / 2);
  const interleaved = [];
  for (let i = 0; i < halfCount; i++) {
    interleaved.push(preEntryToFormData(sorted[i]));
    if (i + halfCount < sorted.length) interleaved.push(preEntryToFormData(sorted[i + halfCount]));
  }
  return pagesFromHalves(interleaved);
}

const ENTRY_FORM_POPUP = {
  title:    'Entry Forms',
  cssLinks: ['css/print.css', 'js/forms/entry-form.css'],
  inlineCSS: `
    @page { size: A4 portrait; margin: 0; }
    body.print-preview { padding: 0; }
  `,
};

export function openBlankEntryFormPreview(count = 2) {
  openPopup({ ...ENTRY_FORM_POPUP, html: generateBlankEntryFormHTML(count) });
}

export function openPreFilledEntryFormPreview() {
  if (!state.preEntries.length) {
    alert('No pre-entries loaded — import a CSV file on the Pre-Entries page first.');
    return;
  }
  openPopup({ ...ENTRY_FORM_POPUP, html: generatePreFilledEntryFormHTML() });
}