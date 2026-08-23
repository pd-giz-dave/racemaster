'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseCSV, formatCSV, parseSICSV } from '../js/csv.js';

describe('csv.js:parseCSV', () => {
  it('parses a simple header + rows CSV into objects', () => {
    const rows = parseCSV('name,club\nDave,Dark Peak\nJohn,Pennine');
    assert.deepEqual(rows, [
      { name: 'Dave', club: 'Dark Peak' },
      { name: 'John', club: 'Pennine' },
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const rows = parseCSV('name,note\n"Smith, John","He said ""hi"""');
    assert.deepEqual(rows, [{ name: 'Smith, John', note: 'He said "hi"' }]);
  });

  it('handles an embedded newline inside a quoted field', () => {
    const rows = parseCSV('name,note\n"Dave","line1\nline2"');
    assert.deepEqual(rows, [{ name: 'Dave', note: 'line1\nline2' }]);
  });

  it('skips blank lines', () => {
    const rows = parseCSV('name\nDave\n\nJohn');
    assert.deepEqual(rows, [{ name: 'Dave' }, { name: 'John' }]);
  });

  it('fills missing trailing columns with empty string', () => {
    const rows = parseCSV('name,club\nDave');
    assert.deepEqual(rows, [{ name: 'Dave', club: '' }]);
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(parseCSV(''), []);
  });
});

describe('csv.js:formatCSV', () => {
  it('formats rows using the given field order, with CRLF line endings', () => {
    const csv = formatCSV([{ name: 'Dave', club: 'Dark Peak' }], ['name', 'club']);
    assert.equal(csv, 'name,club\r\nDave,Dark Peak\r\n');
  });

  it('quotes fields containing a comma, quote, or newline', () => {
    const csv = formatCSV([{ name: 'Smith, John', note: 'has "quotes"' }], ['name', 'note']);
    assert.equal(csv, 'name,note\r\n"Smith, John","has ""quotes"""\r\n');
  });

  it('defaults column order to the first row\'s own keys when no fields array is given', () => {
    const csv = formatCSV([{ b: '2', a: '1' }]);
    assert.equal(csv, 'b,a\r\n2,1\r\n');
  });

  it('treats null/undefined values as empty string', () => {
    const csv = formatCSV([{ name: 'Dave', club: null }], ['name', 'club']);
    assert.equal(csv, 'name,club\r\nDave,\r\n');
  });

  it('returns empty string for no rows', () => {
    assert.equal(formatCSV([], ['name']), '');
    assert.equal(formatCSV(null, ['name']), '');
  });

  it('round-trips through parseCSV', () => {
    const original = [{ name: 'Smith, John', note: 'line1\nline2' }];
    const parsed = parseCSV(formatCSV(original, ['name', 'note']));
    assert.deepEqual(parsed, original);
  });
});

describe('csv.js:parseSICSV', () => {
  it('trims headers and strips a leading * prefix', () => {
    const { headers } = parseSICSV(' *Name ,Club\nDave,Dark Peak');
    assert.deepEqual(headers, ['Name', 'Club']);
  });

  it('trims row values (unlike parseCSV, which preserves them verbatim)', () => {
    const { rows } = parseSICSV('Name,Club\n Dave , Dark Peak ');
    assert.deepEqual(rows, [{ Name: 'Dave', Club: 'Dark Peak' }]);
  });

  it('deduplicates repeated header names as Name, Name_2, Name_3...', () => {
    const { headers, rows } = parseSICSV('Club,Club,Club\nA,B,C');
    assert.deepEqual(headers, ['Club', 'Club_2', 'Club_3']);
    assert.deepEqual(rows, [{ Club: 'A', Club_2: 'B', Club_3: 'C' }]);
  });

  it('returns empty headers/rows for empty input', () => {
    assert.deepEqual(parseSICSV(''), { headers: [], rows: [] });
  });
});
