import {findingAt, spansMask} from '../prose.ts';
import type {Detector, Finding} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'en-dash-parenthetical';

const EN_DASH = /–/g;

/** `2020–2024` and `pages 10–20` are the correct character for a range. */
const RANGE_BEFORE = /\d\s?$/;
const RANGE_AFTER = /^\s?\d/;

const EXPLAIN = 'use a colon, a comma, or a full stop. Keep the en dash for a numeric range.';

/**
 * An en dash standing in for an em dash, which is the same habit wearing a
 * narrower character. Numeric ranges are left alone: that is what it is for.
 */
export const enDashParenthetical: Detector = {
  id: ID,
  run: function (prose): Finding[] {
    return [...prose.text.matchAll(EN_DASH)]
      .filter(function (match) {
        const before = prose.text.slice(Math.max(0, match.index - 2), match.index);
        const after = prose.text.slice(match.index + 1, match.index + 3);
        if (RANGE_BEFORE.test(before) && RANGE_AFTER.test(after)) return false;
        return !spansMask(prose, match.index, match.index + 1);
      })
      .map(function (match) {
        return findingAt(prose, ID, match.index, match.index + 1, EXPLAIN);
      });
  },
};
