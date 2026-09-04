/**
 * The voice checker is a pure pipeline: source text in, findings out. Every
 * type here describes a position in text, so they are all plain data and none
 * of them knows about an editor, a file or a document.
 */

/**
 * A finding's position, recorded the way web annotations record one: by the
 * text that was flagged plus enough of its neighbours to find it again.
 *
 * Never a line number. A writer editing the paragraph above would move every
 * line number below it, and a suppression keyed on one would silently point at
 * the wrong sentence.
 */
export type Anchor = {
  /** The flagged text itself. */
  quote: string;
  /** Characters immediately before the quote, for disambiguation. */
  prefix: string;
  /** Characters immediately after the quote, for disambiguation. */
  suffix: string;
  /** Where the quote was when the anchor was made. Only ever a tie-breaker. */
  hint: number;
};

/** A half-open span of a document, in original-source offsets. */
export type Range = {
  start: number;
  end: number;
};

/**
 * One thing a detector noticed.
 *
 * `range` indexes the original source, so a caller can decorate the editor
 * without resolving the anchor first; `anchor` is what survives an edit made
 * elsewhere in the document. There is no severity: these are all judgment
 * calls, and a level would imply an ordering the checker cannot justify.
 */
export type Finding = {
  ruleId: string;
  anchor: Anchor;
  range: Range;
  /** What to do about it, in the imperative. Never a restatement of the rule. */
  explain: string;
};

/**
 * A run of source that either survived into the reduced text or was masked out
 * of it. Masked segments occupy exactly one space in the reduced text however
 * long they were in the source, which is what makes the mapping one-way and
 * cheap.
 */
export type ProseSegment = {
  reducedStart: number;
  reducedEnd: number;
  sourceStart: number;
  sourceEnd: number;
  masked: boolean;
};

/** A paragraph or a heading, in reduced-text offsets. */
export type ProseBlock = {
  kind: 'paragraph' | 'heading';
  /** Heading depth, 1 to 6. Zero for a paragraph. */
  level: number;
  start: number;
  end: number;
};

/** One sentence, in reduced-text offsets, with the block that contains it. */
export type Sentence = {
  start: number;
  end: number;
  /** Index into `Prose.blocks`. */
  blockIndex: number;
  /** Word count, which is what the statistical detectors actually read. */
  words: number;
};

/**
 * A document prepared for detection: the original source, the reduced text
 * detectors match against, and everything needed to get back from one to the
 * other. Built once per `check` so sixteen detectors do not each re-parse.
 */
export type Prose = {
  source: string;
  /** The source with code, links, quotes and frontmatter masked to spaces. */
  text: string;
  segments: ProseSegment[];
  blocks: ProseBlock[];
  sentences: Sentence[];
};

/**
 * One entry in the banned-word table. `word` is regular-expression source for
 * the word and its inflections, without boundaries: the detector adds those, so
 * the table stays readable.
 */
export type BannedWord = {
  word: string;
  explain: string;
  /** Matches the surrounding sentence when the word is being used literally. */
  literalContext?: RegExp;
};

/** One entry in a phrase table: what to match, and what to do about it. */
export type PhraseRule = {
  pattern: RegExp;
  explain: string;
};

/** One rule. Registered as data; `run` is pure over the prepared prose. */
export type Detector = {
  id: string;
  run: (prose: Prose) => Finding[];
};

/** The only lever on `check`. Everything else is 1.3's problem. */
export type CheckOptions = {
  /** Detector ids to run. Defaults to `DEFAULT_DETECTORS`. */
  detectors?: readonly string[];
};
