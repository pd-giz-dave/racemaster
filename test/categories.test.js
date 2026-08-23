'use strict';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/state.js';
import {
  getMaleCategories, getFemaleCategories, calculateCategory, maxAgeFromCategory,
  toMaleCategory, seniorAllowed, categoryFromDistance, genderFromCategory,
  getCategoryPriority, derivePairGender, calculatePairCategory, calculateCourse,
  applyFRAPreset, applyWFRAPreset, builtinFRARows, builtinWFRARows,
  FRA_CATEGORIES, WFRA_CATEGORIES,
} from '../js/categories.js';

beforeEach(() => {
  state.categories = builtinFRARows();
  state.event = { date: '15/06/2026', juniorLimit: '' };
});

describe('categories.js:getMaleCategories / getFemaleCategories', () => {
  it('lists the male/female category names from state', () => {
    assert.equal(getMaleCategories()[0], 'U10B');
    assert.equal(getFemaleCategories()[0], 'U10G');
    assert.equal(getMaleCategories().length, FRA_CATEGORIES.length);
  });
});

describe('categories.js:calculateCategory', () => {
  it('uses EOY (end-of-year) age for junior bands', () => {
    assert.equal(calculateCategory('01/01/2016', 'Male'), 'U12B');   // eoyAge 10
    assert.equal(calculateCategory('01/01/2016', 'Female'), 'U12G');
  });

  it('uses NOW (actual) age once past the EOY/NOW boundary', () => {
    assert.equal(calculateCategory('01/01/1984', 'Male'), 'M40'); // birthday already passed this year
  });

  it('does not count a birthday that has not happened yet this year', () => {
    // eoyAge would be 40 (M40), but the birthday is 31 Dec — hasn't happened by the 15 Jun
    // race date, so actual (NOW) age is still 39 -> stays in the MSEN band.
    assert.equal(calculateCategory('31/12/1986', 'Male'), 'MSEN');
  });

  it('the EOY -> NOW transition edge case (eoyAge exactly matches the first NOW band) stays in the last EOY band', () => {
    // Documents existing behavior at the MU23(EOY)->MSEN(NOW) boundary: an EOY age of
    // exactly 23 does not (yet) get promoted to MSEN.
    assert.equal(calculateCategory('01/01/2003', 'Male'), 'MU23');
  });

  it('returns the oldest band for someone past the last threshold', () => {
    assert.equal(calculateCategory('01/01/1946', 'Male'), 'M80');
  });

  it('returns empty string when the date or race date is unparseable', () => {
    assert.equal(calculateCategory('not a date', 'Male'), '');
    state.event.date = '';
    assert.equal(calculateCategory('01/01/1990', 'Male'), '');
  });
});

describe('categories.js:maxAgeFromCategory', () => {
  it('returns the next band\'s minAge (exclusive upper bound)', () => {
    assert.equal(maxAgeFromCategory('M40'), 45);
  });

  it('returns 0 for the last (open-ended) band or an unknown category', () => {
    assert.equal(maxAgeFromCategory('M80'), 0);
    assert.equal(maxAgeFromCategory('ZZZZ'), 0);
  });
});

describe('categories.js:toMaleCategory', () => {
  it('converts a female senior category to its male equivalent', () => {
    assert.equal(toMaleCategory('W40'), 'M40');
  });

  it('converts a junior female category to male', () => {
    assert.equal(toMaleCategory('U12G'), 'U12B');
  });

  it('passes a male category through unchanged', () => {
    assert.equal(toMaleCategory('M40'), 'M40');
  });

  it('truncate strips the gender letter/prefix instead of substituting it', () => {
    assert.equal(toMaleCategory('W40', true), '40');
    assert.equal(toMaleCategory('U12G', true), 'U12');
  });

  it('returns empty string for empty input', () => {
    assert.equal(toMaleCategory(''), '');
  });
});

describe('categories.js:seniorAllowed', () => {
  it('allows everything when there is no junior limit', () => {
    assert.equal(seniorAllowed('U16B'), true);
  });

  it('disallows a category at or below the junior limit', () => {
    state.event.juniorLimit = 'U18B';
    assert.equal(seniorAllowed('U16B'), false);
  });

  it('allows a category above the junior limit', () => {
    state.event.juniorLimit = 'U18B';
    assert.equal(seniorAllowed('U20B'), true);
    assert.equal(seniorAllowed('MSEN'), true);
  });
});

describe('categories.js:categoryFromDistance', () => {
  it('returns the highest junior band excluded at a short distance', () => {
    assert.equal(categoryFromDistance(4), 'U12'); // between U12's 3 miles and U14's 5
  });

  it('returns the highest excluded band even at a long distance (only truly open-ended bands allow everything)', () => {
    assert.equal(categoryFromDistance(100), 'U20'); // U20's 10-mile cap is still under 100
  });
});

describe('categories.js:genderFromCategory', () => {
  it('identifies male and female categories', () => {
    assert.equal(genderFromCategory('W40'), 'Female');
    assert.equal(genderFromCategory('M40'), 'Male');
  });

  it('returns empty string for an unknown category', () => {
    assert.equal(genderFromCategory('ZZZZ'), '');
  });
});

describe('categories.js:getCategoryPriority', () => {
  it('increases with age band, matching either gender column', () => {
    assert.ok(getCategoryPriority('U10B') < getCategoryPriority('U12G'));
    assert.equal(getCategoryPriority('M40'), getCategoryPriority('W40'));
  });

  it('returns a very high number for an unknown category (sorts last)', () => {
    assert.equal(getCategoryPriority('ZZZZ'), 999999);
  });
});

describe('categories.js:derivePairGender', () => {
  it('both female -> Female, both male -> Male, mixed -> Mixed', () => {
    assert.equal(derivePairGender('Female', 'Female'), 'Female');
    assert.equal(derivePairGender('Male', 'Male'), 'Male');
    assert.equal(derivePairGender('Male', 'Female'), 'Mixed');
  });
});

describe('categories.js:calculatePairCategory', () => {
  it('uses the younger person\'s category when either is a junior', () => {
    const r = calculatePairCategory('01/01/2016', 'Male', '01/01/1984', 'Male');
    assert.equal(r.category, 'U12B');
    assert.equal(r.pairGender, 'Male');
  });

  it('uses the older person\'s category when both are senior', () => {
    const r = calculatePairCategory('01/01/1984', 'Male', '01/01/1946', 'Female');
    assert.equal(r.category, 'W80');
    assert.equal(r.pairGender, 'Mixed');
  });

  it('a same-age-band senior tie goes to the first competitor', () => {
    const r = calculatePairCategory('01/01/1984', 'Male', '31/12/1986', 'Female');
    assert.equal(r.category, 'M40');
    assert.equal(r.pairGender, 'Mixed');
  });
});

describe('categories.js:calculateCourse', () => {
  it('is Seniors for a category above the (absent) junior limit', () => {
    assert.equal(calculateCourse('U16B'), 'Seniors');
    assert.equal(calculateCourse('MSEN'), 'Seniors');
  });

  it('falls back to computing the category from DOB when none is given', () => {
    assert.equal(calculateCourse(null, '01/01/1984'), 'Seniors');
  });
});

describe('categories.js:applyFRAPreset / applyWFRAPreset / builtinFRARows / builtinWFRARows', () => {
  it('builtinFRARows/builtinWFRARows convert the raw tuples into row objects', () => {
    const rows = builtinFRARows();
    assert.equal(rows.length, FRA_CATEGORIES.length);
    assert.deepEqual(rows[0], { minAge: 6, maleCat: 'U10B', femaleCat: 'U10G', ref: 'EOY', maxDist: 1.5 });

    const wrows = builtinWFRARows();
    assert.equal(wrows.length, WFRA_CATEGORIES.length);
  });

  it('applyFRAPreset/applyWFRAPreset replace state.categories', () => {
    state.categories = [];
    applyFRAPreset();
    assert.equal(state.categories.length, FRA_CATEGORIES.length);

    applyWFRAPreset();
    assert.equal(state.categories.length, WFRA_CATEGORIES.length);
  });
});
