import {ABBREVIATIONS} from './words.ts';
import type {ProseBlock, Sentence} from './types.ts';

/** An ATX heading, with up to three spaces of leading indent as CommonMark allows. */
const HEADING = /^ {0,3}(#{1,6})[ \t]+/;

/** A bullet or ordered list marker, which starts a block of its own. */
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * A sentence terminator: run-on punctuation plus any closing quotes or
 * brackets, followed by whitespace or the end of the block.
 */
const TERMINATOR = /[.!?]+["'’”)\]]*(?=\s|$)/g;

/** The word a terminator would end, used to tell `Dr.` from a full stop. */
const TRAILING_WORD = /([A-Za-z][A-Za-z.]*)$/;

/** Anything with a letter or a digit in it counts as a word. */
const WORD = /[\p{L}\p{N}]/u;

function isAbbreviation(before: string): boolean {
  const word = before.match(TRAILING_WORD)?.[1];
  if (word === undefined) return false;
  // A lone initial: `J. R. R. Tolkien` is one sentence, not four.
  if (/^[A-Z]\.$/.test(word)) return true;
  return ABBREVIATIONS.includes(word.toLowerCase());
}

/** Words in a slice of text, on the same counting rule everywhere. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(function (token) {
    return WORD.test(token);
  }).length;
}

/**
 * Splits reduced text into paragraphs and headings.
 *
 * Line-based rather than a real block parser, because the statistical detectors
 * only need to know which sentences sit together. A list item starts a block of
 * its own, so a four-item bullet list is four blocks and never reads as one
 * metronomic paragraph.
 */
export function blocksOf(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let open: {start: number; end: number} | undefined;

  function close(): void {
    if (open !== undefined) blocks.push({kind: 'paragraph', level: 0, ...open});
    open = undefined;
  }

  let offset = 0;
  for (const line of text.split('\n')) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1;

    if (line.trim().length === 0) {
      close();
      continue;
    }

    const heading = line.match(HEADING);
    if (heading !== null) {
      close();
      blocks.push({kind: 'heading', level: heading[1]?.length ?? 1, start, end});
      continue;
    }

    if (LIST_ITEM.test(line)) close();
    if (open === undefined) open = {start, end};
    else open.end = end;
  }

  close();
  return blocks;
}

/** Where a block's own text begins: a heading's hashes are markup, not a word. */
export function contentStart(text: string, block: ProseBlock): number {
  if (block.kind !== 'heading') return block.start;
  const marker = text.slice(block.start, block.end).match(HEADING);
  return block.start + (marker?.[0]?.length ?? 0);
}

/** Sentence spans inside one block, as offsets into the whole reduced text. */
function splitBlock(text: string, block: ProseBlock, blockIndex: number): Sentence[] {
  const offset = contentStart(text, block);
  const body = text.slice(offset, block.end);

  const sentences: Sentence[] = [];
  let start = 0;

  function take(end: number): void {
    const slice = body.slice(start, end);
    if (!WORD.test(slice)) return;
    sentences.push({
      start: offset + start + (slice.length - slice.trimStart().length),
      end: offset + start + slice.trimEnd().length,
      blockIndex,
      words: countWords(slice),
    });
  }

  for (const match of body.matchAll(TERMINATOR)) {
    if (isAbbreviation(body.slice(0, match.index + 1))) continue;
    const end = match.index + match[0].length;
    take(end);
    start = end;
  }

  take(body.length);
  return sentences;
}

/** Every sentence in the document, in order, tagged with its block. */
export function sentencesOf(text: string, blocks: ProseBlock[]): Sentence[] {
  return blocks.flatMap(function (block, index) {
    return splitBlock(text, block, index);
  });
}
