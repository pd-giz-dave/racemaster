(function () {
  'use strict';

  // ---- Search ----
  // Filters rows across all tables. If any row in a collapsed section matches,
  // that section is opened so the match is visible.

  const searchInput = document.getElementById('re-search');
  if (searchInput) {
    searchInput.addEventListener('input', applySearch);
  }

  function applySearch() {
    const q = (searchInput?.value ?? '').trim().toLowerCase();
    document.querySelectorAll('details.re-section-details').forEach(details => {
      let sectionHasMatch = false;
      details.querySelectorAll('tbody tr').forEach(tr => {
        if (tr.classList.contains('results-cat-separator')) return;
        const match = q === '' || tr.textContent.toLowerCase().includes(q);
        tr.hidden = !match;
        if (match) sectionHasMatch = true;
      });
      // Open collapsed sections when they contain a search match.
      if (q !== '' && sectionHasMatch) details.open = true;
    });
  }

  // ---- Sort ----
  // Click once: sort ascending. Click again: descending. Click again: restore original order.
  // DNF / empty cells always sort to the bottom regardless of direction.

  const origOrder = new WeakMap(); // table → original tr[]
  const sortState = new WeakMap(); // table → { col, dir }

  function cellText(tr, idx) {
    return (tr.cells[idx]?.textContent ?? '').trim();
  }

  function compareValues(a, b) {
    const aEmpty = !a || a === 'DNF';
    const bEmpty = !b || b === 'DNF';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  }

  function setIndicators(table, colIdx, dir) {
    table.querySelectorAll('thead th').forEach((th, i) => {
      th.dataset.sort = i === colIdx ? dir : '';
    });
  }

  document.querySelectorAll('.re-sortable thead th').forEach(th => {
    th.addEventListener('click', () => {
      const table = th.closest('table');
      const tbody = table.querySelector('tbody');
      const colIdx = th.cellIndex;

      // Save original DOM order on first interaction with this table.
      if (!origOrder.has(table)) {
        origOrder.set(table, [...tbody.querySelectorAll('tr')]);
      }

      const state = sortState.get(table) ?? {};
      let dir;
      if (state.col !== colIdx) {
        dir = 'asc';
      } else if (state.dir === 'asc') {
        dir = 'desc';
      } else {
        // Third click — restore original order.
        origOrder.get(table).forEach(tr => tbody.appendChild(tr));
        sortState.delete(table);
        setIndicators(table, -1, '');
        applySearch();
        return;
      }

      sortState.set(table, { col: colIdx, dir });

      const all  = origOrder.get(table);
      const seps = all.filter(tr => tr.classList.contains('results-cat-separator'));
      const rows = all.filter(tr => !tr.classList.contains('results-cat-separator'));

      rows.sort((a, b) => {
        const cmp = compareValues(cellText(a, colIdx), cellText(b, colIdx));
        return dir === 'asc' ? cmp : -cmp;
      });

      // Data rows in sorted order; separator rows hidden at end (meaningless out of group order).
      rows.forEach(tr => tbody.appendChild(tr));
      seps.forEach(tr => { tr.hidden = true; tbody.appendChild(tr); });

      setIndicators(table, colIdx, dir);
      applySearch();
    });
  });
})();