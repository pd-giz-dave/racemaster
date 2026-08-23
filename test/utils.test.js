'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseTime, normaliseDate, timeToSeconds, secondsToTime, isValidRaceTime, parseDate,
  today, capitalise, cleanName, normaliseClub, findSimilarPairs, ciEq, sortBy, toISODate,
  fromISODate, normaliseGender,
} from '../js/utils.js';

// utils.js's showBusy() touches `document` (DOM wiring) — deliberately not covered here.

describe('utils.js:normaliseTime', () => {
  it('accepts H:M:S with any separator and no leading zeros', () => {
    assert.equal(normaliseTime('1.5.3'), '01:05:03');
    assert.equal(normaliseTime('5-30'), '00:05:30');
    assert.equal(normaliseTime('1 05 30'), '01:05:30');
  });

  it('treats a single number as seconds', () => {
    assert.equal(normaliseTime('45'), '00:00:45');
  });

  it('rejects out-of-range components', () => {
    assert.equal(normaliseTime('25:00:00'), '');
    assert.equal(normaliseTime('00:60:00'), '');
    assert.equal(normaliseTime('00:00:60'), '');
  });

  it('rejects garbage input', () => {
    assert.equal(normaliseTime(''), '');
    assert.equal(normaliseTime(null), '');
    assert.equal(normaliseTime('abc'), '');
    assert.equal(normaliseTime('1:2:3:4'), '');
  });
});

describe('utils.js:normaliseDate', () => {
  it('parses ISO-like YYYY-MM-DD to DD/MM/YYYY', () => {
    assert.equal(normaliseDate('2026-01-05'), '05/01/2026');
  });

  it('parses DD-MM-YYYY with any separator', () => {
    assert.equal(normaliseDate('1/1/1990'), '01/01/1990');
    assert.equal(normaliseDate('01-01-1990'), '01/01/1990');
  });

  it('expands a 2-digit year using the century-rollover rule', () => {
    const thisYear = new Date().getFullYear();
    // A 2-digit year that would land in the future rolls back to 1900s.
    const futureYY = String((thisYear + 5) % 100).padStart(2, '0');
    const result = normaliseDate(`1/1/${futureYY}`);
    assert.ok(result.endsWith(`19${futureYY}`));
  });

  it('expands a single-digit year to 200Y', () => {
    assert.equal(normaliseDate('8/7/6'), '08/07/2006');
  });

  it('rejects an invalid calendar date (e.g. 31 Feb)', () => {
    assert.equal(normaliseDate('31/02/2000'), '');
  });

  it('rejects garbage input', () => {
    assert.equal(normaliseDate(''), '');
    assert.equal(normaliseDate('not a date'), '');
  });
});

describe('utils.js:timeToSeconds / secondsToTime', () => {
  it('round-trips a valid time', () => {
    assert.equal(timeToSeconds('01:02:03'), 3723);
    assert.equal(secondsToTime(3723), '01:02:03');
  });

  it('timeToSeconds returns 0 for invalid input', () => {
    assert.equal(timeToSeconds(''), 0);
    assert.equal(timeToSeconds('garbage'), 0);
  });

  it('secondsToTime clamps to a single day', () => {
    assert.equal(secondsToTime(-5), '00:00:00');
    assert.equal(secondsToTime(999999), '23:59:59');
  });
});

describe('utils.js:isValidRaceTime', () => {
  it('is true only for a normalisable time', () => {
    assert.equal(isValidRaceTime('01:02:03'), true);
    assert.equal(isValidRaceTime('DNF'), false);
    assert.equal(isValidRaceTime(''), false);
  });
});

describe('utils.js:parseDate', () => {
  it('parses a DD/MM/YYYY string into a local midnight Date', () => {
    const dt = parseDate('05/01/2026');
    assert.equal(dt.getFullYear(), 2026);
    assert.equal(dt.getMonth(), 0);
    assert.equal(dt.getDate(), 5);
    assert.equal(dt.getHours(), 0);
  });

  it('returns null for an unparseable date', () => {
    assert.equal(parseDate('nonsense'), null);
  });
});

describe('utils.js:today', () => {
  it('formats as DD/MM/YYYY matching the current date', () => {
    const now = new Date();
    const expected = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    assert.equal(today(), expected);
  });
});

describe('utils.js:capitalise', () => {
  it('capitalises each word', () => {
    assert.equal(capitalise('dave nicholson'), 'Dave Nicholson');
    assert.equal(capitalise("o'brien-smith"), "O'Brien-Smith");
  });

  it('handles empty/null input', () => {
    assert.equal(capitalise(''), '');
    assert.equal(capitalise(null), '');
  });
});

describe('utils.js:cleanName', () => {
  it('collapses double spaces and trims', () => {
    assert.equal(cleanName('  Dave   Nicholson  '), 'Dave Nicholson');
  });
});

describe('utils.js:normaliseClub', () => {
  it('blanks out the literal "(no club)" placeholder', () => {
    assert.equal(normaliseClub('(no club)'), '');
    assert.equal(normaliseClub('(No Club)'), '');
  });

  it('trims and passes through a real club name', () => {
    assert.equal(normaliseClub('  Dark Peak Fell Runners  '), 'Dark Peak Fell Runners');
  });
});

describe('utils.js:normaliseGender', () => {
  it('normalises M/F and Male/Female (case-insensitive) to the canonical labels', () => {
    assert.equal(normaliseGender('m'), 'Male');
    assert.equal(normaliseGender('MALE'), 'Male');
    assert.equal(normaliseGender('f'), 'Female');
    assert.equal(normaliseGender('Female'), 'Female');
  });

  it('returns empty string for anything else', () => {
    assert.equal(normaliseGender('X'), '');
    assert.equal(normaliseGender(''), '');
  });
});

describe('utils.js:ciEq', () => {
  it('compares case-insensitively', () => {
    assert.equal(ciEq('Dave', 'dave'), true);
    assert.equal(ciEq('Dave', 'David'), false);
  });

  it('treats missing values as empty strings', () => {
    assert.equal(ciEq(null, undefined), true);
  });
});

describe('utils.js:sortBy', () => {
  it('sorts by a single field, case-insensitively', () => {
    const arr = [{ name: 'bob' }, { name: 'Alice' }, { name: 'carol' }];
    assert.deepEqual(sortBy(arr, 'name').map(r => r.name), ['Alice', 'bob', 'carol']);
  });

  it('breaks ties using subsequent fields', () => {
    const arr = [{ a: 'x', b: '2' }, { a: 'x', b: '1' }];
    assert.deepEqual(sortBy(arr, 'a', 'b').map(r => r.b), ['1', '2']);
  });

  it('does not mutate the original array', () => {
    const arr = [{ name: 'b' }, { name: 'a' }];
    sortBy(arr, 'name');
    assert.deepEqual(arr.map(r => r.name), ['b', 'a']);
  });
});

describe('utils.js:toISODate / fromISODate', () => {
  it('round-trips DD/MM/YYYY <-> YYYY-MM-DD', () => {
    assert.equal(toISODate('05/01/2026'), '2026-01-05');
    assert.equal(fromISODate('2026-01-05'), '05/01/2026');
  });

  it('return empty string for empty input', () => {
    assert.equal(toISODate(''), '');
    assert.equal(fromISODate(''), '');
  });
});

describe('utils.js:findSimilarPairs', () => {
  it('flags an exact case-insensitive match', () => {
    const items = ['Dave Nicholson', 'dave nicholson'];
    const pairs = findSimilarPairs(items, x => x);
    assert.deepEqual(pairs, [{ a: 0, b: 1, exact: true }]);
  });

  it('flags a near match (edit distance <= 2) for longer names only', () => {
    const items = ['Dave Nicholson', 'Dave Nichols0n']; // one char swapped
    const pairs = findSimilarPairs(items, x => x);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].exact, false);
  });

  it('does not flag unrelated names', () => {
    const items = ['Dave Nicholson', 'John Smith'];
    assert.deepEqual(findSimilarPairs(items, x => x), []);
  });

  it('ignores items with an empty key', () => {
    const items = ['', 'Dave Nicholson'];
    assert.deepEqual(findSimilarPairs(items, x => x), []);
  });
});
