import {createAnchor} from './anchor.ts';
import {blocksOf, sentencesOf} from './sentences.ts';
import type {Finding, Prose, ProseSegment, Range, Sentence} from './types.ts';

/** An opening or closing fence, and its marker run so the two must match. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A blockquote line. The whole run of them is masked, markers included. */
const QUOTE_LINE = /^ {0,3}>/;

/** A link reference definition, which is a target with a label, not prose. */
const REFERENCE = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S+/;

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** An inline code span, kept to one line so a stray backtick cannot run away. */
const INLINE_CODE = /(`+)[^\n]*?\1/g;

/** A link or image: group one is the visible text, group two is the target. */
const LINK = /(!?\[[^\]\n]*\])(\([^)\n]*\)|\[[^\]\n]*\])/g;

const AUTOLINK = /<(?:https?:\/\/|mailto:)[^>\n\s]*>/g;

const BARE_URL = /https?:\/\/[^\s)>\]]+/g;

const FRONTMATTER_FENCE = '---';

/** Ranges sorted by start, with every overlap folded into one. */
function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges]
    .filter(function (range) {
      return range.end > range.start;
    })
    .sort(function (a, b) {
      return a.start - b.start;
    });

  return sorted.reduce<Range[]>(function (merged, range) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      return merged;
    }
    merged.push({...range});
    return merged;
  }, []);
}

/** The frontmatter block, fences included, when the file opens with one. */
function frontmatterMask(source: string): Range[] {
  if (!source.startsWith(FRONTMATTER_FENCE)) return [];

  const lines = source.split('\n');
  const closing = lines.findIndex(function (line, index) {
    return index > 0 && line.trimEnd() === FRONTMATTER_FENCE;
  });
  if (closing === -1) return [];

  const end = lines.slice(0, closing + 1).join('\n').length;
  return [{start: 0, end}];
}

/**
 * Masks that own whole lines: fenced code, blockquotes and reference
 * definitions, found by scanning lines rather than with a regular expression,
 * because a fence's closing marker has to match its opening one.
 */
function lineMasks(source: string): Range[] {
  const masks: Range[] = [];
  let fence: {marker: string; start: number} | undefined;
  let quote: Range | undefined;
  let offset = 0;

  for (const line of source.split('\n')) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1;

    if (fence !== undefined) {
      const marker = line.match(FENCE)?.[1];
      if (
        marker !== undefined &&
        marker[0] === fence.marker[0] &&
        marker.length >= fence.marker.length
      ) {
        masks.push({start: fence.start, end});
        fence = undefined;
      }
      continue;
    }

    if (QUOTE_LINE.test(line)) {
      quote = quote === undefined ? {start, end} : {start: quote.start, end};
      continue;
    }
    if (quote !== undefined) {
      masks.push(quote);
      quote = undefined;
    }

    const opening = line.match(FENCE);
    if (opening !== null) {
      fence = {marker: opening[1] ?? '', start};
      continue;
    }

    if (REFERENCE.test(line)) masks.push({start, end});
  }

  // An unterminated fence or a quote at the end of the file still masks its tail.
  if (fence !== undefined) masks.push({start: fence.start, end: source.length});
  if (quote !== undefined) masks.push(quote);

  return masks;
}

/** Every match of `pattern`, as the range it should mask. */
function matchMasks(
  source: string,
  pattern: RegExp,
  offset: (match: RegExpExecArray) => number,
): Range[] {
  return [...source.matchAll(pattern)].map(function (match) {
    return {start: match.index + offset(match), end: match.index + match[0].length};
  });
}

/** Masks the whole match. */
function whole(): number {
  return 0;
}

/**
 * Splits a document into the text detectors read and the map back to the
 * original.
 *
 * Masking rather than stripping is the whole point: every masked region becomes
 * exactly one space, so a match's offsets can always be walked back to the
 * characters the writer is actually looking at. A detector that stripped would
 * have to guess.
 *
 * Not masked: heading hashes, emphasis markers and list bullets, because two
 * detectors read them. Also not masked: four-space indented code blocks. Telling
 * one from a list continuation needs a real block parser, and inkling's own
 * prose uses fences.
 */
export function extract(source: string): Prose {
  const blocks = merge([
    ...frontmatterMask(source),
    ...lineMasks(source),
    ...matchMasks(source, HTML_COMMENT, whole),
  ]);

  const insideBlock = function (range: Range): boolean {
    return blocks.some(function (block) {
      return range.start < block.end && range.end > block.start;
    });
  };

  const inline = [
    ...matchMasks(source, INLINE_CODE, whole),
    ...matchMasks(source, LINK, function (match) {
      return match[1]?.length ?? 0;
    }),
    ...matchMasks(source, AUTOLINK, whole),
    ...matchMasks(source, BARE_URL, whole),
  ].filter(function (range) {
    // Already covered, and a pattern that only half-overlaps a fence has paired
    // a marker inside it with one outside, which is not a span at all.
    return !insideBlock(range);
  });

  const masks = merge([...blocks, ...inline]);

  const segments: ProseSegment[] = [];
  let text = '';
  let cursor = 0;

  function keep(end: number): void {
    if (end <= cursor) return;
    segments.push({
      reducedStart: text.length,
      reducedEnd: text.length + (end - cursor),
      sourceStart: cursor,
      sourceEnd: end,
      masked: false,
    });
    text += source.slice(cursor, end);
    cursor = end;
  }

  for (const mask of masks) {
    keep(mask.start);
    segments.push({
      reducedStart: text.length,
      reducedEnd: text.length + 1,
      sourceStart: mask.start,
      sourceEnd: mask.end,
      masked: true,
    });
    text += ' ';
    cursor = mask.end;
  }
  keep(source.length);

  const proseBlocks = blocksOf(text);
  return {source, text, segments, blocks: proseBlocks, sentences: sentencesOf(text, proseBlocks)};
}

/**
 * Maps a reduced-text offset back to the original source.
 *
 * Positions are between characters, so this works for both ends of a range: an
 * offset at the boundary of two segments lands on the boundary of the same two
 * runs of source, because the segments partition it.
 */
export function toSourceOffset(prose: Prose, offset: number): number {
  const segment = prose.segments.find(function (candidate) {
    return offset >= candidate.reducedStart && offset < candidate.reducedEnd;
  });
  if (segment === undefined) return prose.source.length;
  if (segment.masked) return segment.sourceStart;
  return segment.sourceStart + (offset - segment.reducedStart);
}

/**
 * Whether a reduced-text span crosses something that was masked out.
 *
 * A masked region is one space, so a regular expression can match straight
 * across a code fence and produce a span that reads as prose but is not. Every
 * detector checks this before raising a finding.
 */
export function spansMask(prose: Prose, start: number, end: number): boolean {
  return prose.segments.some(function (segment) {
    return segment.masked && segment.reducedStart < end && segment.reducedEnd > start;
  });
}

/** The sentence containing a reduced-text offset, when there is one. */
export function sentenceAt(prose: Prose, offset: number): Sentence | undefined {
  return prose.sentences.find(function (sentence) {
    return offset >= sentence.start && offset < sentence.end;
  });
}

/**
 * Builds a finding from reduced-text offsets, so no detector has to know that
 * the text it matched against is not the text the writer sees.
 */
export function findingAt(
  prose: Prose,
  ruleId: string,
  start: number,
  end: number,
  explain: string,
): Finding {
  const range = {start: toSourceOffset(prose, start), end: toSourceOffset(prose, end)};
  return {ruleId, anchor: createAnchor(prose.source, range.start, range.end), range, explain};
}
