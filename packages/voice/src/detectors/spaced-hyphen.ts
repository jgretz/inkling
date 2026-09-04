import {findingAt, spansMask} from '../prose.ts';
import type {Detector, Finding, Prose} from '../types.ts';

/** Stated once: the registry key and the id every finding carries. */
const ID = 'spaced-hyphen';

/**
 * One or two hyphens with a space or a tab on both sides. A spaced run of three
 * reads as a dash as well, but the corpus contains none, so the rule stops at
 * the two forms the prose it is measured against actually uses.
 */
const SPACED_HYPHEN = /[ \t]-{1,2}[ \t]/g;

/** `2020 - 2024` and `pages 10 - 20` are a range, whatever the character. */
const RANGE_BEFORE = /\d\s?$/;
const RANGE_AFTER = /^\s?\d/;

/** Nothing but whitespace before the hyphen on its line, which is a bullet. */
const BULLET = /^[ \t]*$/;

/**
 * A line carrying no prose at all: a table separator row, with or without its
 * outer pipes, or a `- - -` thematic break. Nothing a writer means as a sentence
 * is made of dashes, pipes, colons and spaces.
 */
const SEPARATOR_LINE = /^[ \t]*[-|:][-|: \t]*$/;

const EXPLAIN =
  'use a colon if the second half explains the first, a comma for an aside, or a full stop. A spaced hyphen keeps the rhythm that produced the dash.';

/** The line containing a reduced-text offset. */
function lineAt(text: string, offset: number): {start: number; end: number} {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const newline = text.indexOf('\n', offset);
  return {start, end: newline === -1 ? text.length : newline};
}

/**
 * A hyphen doing an em dash's job: the ASCII stand-in the rule against em
 * dashes is most often evaded with, and the one that most often survives a
 * sweep because nothing in the file is a dash character.
 *
 * Four things wear the same shape and are left alone: a list bullet, a line with
 * no prose on it, a numeric range, and anything inside code, a link target, a
 * blockquote or frontmatter, which `spansMask` already knows about.
 */
function spacedHyphens(prose: Prose): Finding[] {
  return [...prose.text.matchAll(SPACED_HYPHEN)]
    .map(function (match) {
      // The flanking whitespace triggers the match; the hyphen run is the finding.
      return {start: match.index + 1, end: match.index + match[0].length - 1};
    })
    .filter(function (span) {
      if (spansMask(prose, span.start, span.end)) return false;

      const line = lineAt(prose.text, span.start);
      if (BULLET.test(prose.text.slice(line.start, span.start))) return false;
      if (SEPARATOR_LINE.test(prose.text.slice(line.start, line.end))) return false;

      const before = prose.text.slice(Math.max(0, span.start - 2), span.start);
      const after = prose.text.slice(span.end, span.end + 2);
      return !(RANGE_BEFORE.test(before) && RANGE_AFTER.test(after));
    })
    .map(function (span) {
      return findingAt(prose, ID, span.start, span.end, EXPLAIN);
    });
}

export const spacedHyphen: Detector = {
  id: ID,
  run: spacedHyphens,
};
