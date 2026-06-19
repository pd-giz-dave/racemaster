'use strict';

function openPopup({ title, cssLinks = [], inlineCSS = null, html }) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return null; }

  const doc  = win.document;
  const head = doc.head;

  const base = doc.createElement('base');
  base.href = location.origin + '/';
  head.appendChild(base);

  doc.title = title;

  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.appendChild(meta);

  const cssLoaded = cssLinks.map(href => new Promise(resolve => {
    const link = doc.createElement('link');
    link.rel  = 'stylesheet';
    link.href = href;
    link.addEventListener('load',  resolve);
    link.addEventListener('error', resolve);
    head.appendChild(link);
  }));

  if (inlineCSS) {
    const style = doc.createElement('style');
    style.textContent = inlineCSS;
    head.appendChild(style);
  }

  doc.body.className = 'print-preview';
  doc.body.innerHTML = html;

  Promise.all(cssLoaded).then(() => win.print());

  return win;
}

export { openPopup };

export function openPrintPreview(contentHTML, title = 'Print Preview', formCss = null) {
  const cssLinks = ['css/print.css'];
  if (formCss) cssLinks.push(formCss);
  openPopup({ title, cssLinks, html: contentHTML });
}