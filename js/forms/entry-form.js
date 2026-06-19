'use strict';

import { state } from '../state.js';
import { escHtml } from '../ui.js';
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

function blankEntryFormHalf(org) {
  const juniorCats = ['U10','U12','U14','U16','U18','U20']
    .map(c => `<span class="bef-check bef-check-lg">&#9633;&thinsp;${c}</span>`).join('');
  return `
  <div class="bef-half">
    <div class="bef-header">
      <div class="bef-org">${org}</div>
      <div class="bef-title-block">Entry Form</div>
      <div class="bef-event-box">
        <div class="bef-event-label">Event</div>
        <div class="bef-event-field"></div>
      </div>
    </div>
    <div class="bef-refs-row">
      <div class="bef-refs">
        <div class="bef-ref"><div class="bef-ref-label">Entry No</div><div class="bef-ref-box"></div></div>
        <div class="bef-ref"><div class="bef-ref-label">Race No</div><div class="bef-ref-box"></div></div>
        <div class="bef-ref"><div class="bef-ref-label">Dibber No</div><div class="bef-ref-box"></div></div>
      </div>
      <div class="bef-junior-cats">
        <div class="bef-junior-label">Juniors category (age on 31st Dec)</div>
        <div class="bef-junior-checks">${juniorCats}</div>
      </div>
    </div>
    <div class="bef-hint">Please fill in at least the <strong><u>bold underlined</u></strong> items and please write clearly.</div>
    <div class="bef-row bef-row-key">
      <span class="bef-lbl bef-lbl-req bef-lbl-key">Full Name (block capitals):</span><span class="bef-line bef-flex bef-line-key"></span>
    </div>
    <div class="bef-dob-gender bef-row-key">
      <div class="bef-half-cell">
        <span class="bef-lbl bef-lbl-req bef-lbl-key">Date of Birth (DD/MM/YY):</span><span class="bef-line bef-flex bef-line-key"></span>
      </div>
      <div class="bef-half-cell">
        <span class="bef-lbl bef-lbl-req bef-lbl-key">Gender:</span>
        <span class="bef-check bef-check-key" style="margin-left:5mm">&#9633;&thinsp;Male/Open</span>
        <span class="bef-check bef-check-key" style="margin-left:5mm">&#9633;&thinsp;Female/Ladies</span>
      </div>
    </div>
    <div class="bef-row">
      <span class="bef-lbl">Club:</span><span class="bef-line" style="width:70mm"></span>
      <span class="bef-lbl">FRA/WFRA No:</span><span class="bef-line" style="width:24mm"></span>
      <span class="bef-lbl">Car Reg:</span><span class="bef-line bef-flex"></span>
    </div>
    <div class="bef-addr-phone">
      <div class="bef-addr-field">
        <div class="bef-field-label">Address</div>
      </div>
      <div class="bef-phone-col">
        <div class="bef-row"><span class="bef-lbl">Your Phone:</span><span class="bef-line bef-flex"></span></div>
        <div class="bef-row"><span class="bef-lbl">Emergency Contact:</span><span class="bef-line bef-flex"></span></div>
        <div class="bef-row"><span class="bef-lbl">Their Phone:</span><span class="bef-line bef-flex"></span></div>
      </div>
    </div>
    <div class="bef-row">
      <div class="bef-half-cell"><span class="bef-lbl">Email:</span><span class="bef-line bef-flex"></span></div>
      <div class="bef-half-cell"><span class="bef-lbl">Medical Conds:</span><span class="bef-line bef-flex"></span></div>
    </div>
    <div class="bef-important">Important: Read rules below. If you sign this form you are agreeing to all rules. Parent/Guardian must sign for juniors.</div>
    <div class="bef-declarations">
      ${DECLS.map(d => `<div class="bef-decl">&#9658; ${d}</div>`).join('')}
    </div>
    <div class="bef-sign-row">
      <span class="bef-lbl">Signed:</span><span class="bef-sign-line" style="flex:2"></span>
      <span class="bef-lbl" style="margin-left:4mm">Date:</span><span class="bef-sign-line" style="flex:1"></span>
    </div>
  </div>`;
}

export function generateBlankEntryFormHTML(count = 2) {
  const org = escHtml(state.event.organisation || 'WFRA/FRA FELL RACES');
  const formHtml = blankEntryFormHalf(org);
  const emptyHtml = `<div class="bef-half"></div>`;
  const cutGuide = `<div class="bef-cut"><span class="bef-cut-label">&#9986; cut here</span></div>`;
  let html = '';
  for (let p = 0; p < Math.ceil(count / 2); p++) {
    const hasB = p * 2 + 1 < count;
    html += `<div class="blank-entry-page">${formHtml}${cutGuide}${hasB ? formHtml : emptyHtml}</div>`;
  }
  return html;
}

export function openBlankEntryFormPreview(count = 2) {
  openPopup({
    title:    'Entry Forms',
    cssLinks: ['css/print.css', 'js/forms/entry-form.css'],
    inlineCSS: `
      @page { size: A4 portrait; margin: 5mm 5mm 5mm 10mm; }
      @page :first { margin: 5mm 5mm 5mm 10mm; }
      body.print-preview { padding: 0; }
    `,
    html: generateBlankEntryFormHTML(count),
  });
}