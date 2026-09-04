import type {BannedWord, PhraseRule} from './types.ts';

/**
 * Words a full stop can end without ending a sentence. Lone capital initials
 * are handled separately, so `J. R. R. Tolkien` needs no entry here.
 */
export const ABBREVIATIONS: readonly string[] = [
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'st.',
  'mt.',
  'jr.',
  'sr.',
  'vs.',
  'etc.',
  'e.g.',
  'i.e.',
  'cf.',
  'al.',
  'fig.',
  // `no.` for `number` is deliberately absent: a sentence ending in `no.` is
  // far commoner than one numbering something, and this list is a guard against
  // splitting, so a wrong entry silently joins two sentences.
  'vol.',
  'ch.',
  'pp.',
  'approx.',
  'inc.',
  'ltd.',
  'co.',
  'ave.',
  'a.m.',
  'p.m.',
];

/**
 * Words that arrive with a model rather than with a thought. `word` is regular
 * expression source for the word and its inflections; the detector adds the
 * boundaries.
 *
 * `literalContext` is tested against the sentence around a hit and suppresses
 * it. Four of these words have an ordinary literal sense the checker has no
 * business flagging, and a rule that cries wolf on `unpack the boxes` is a rule
 * a writer switches off.
 */
export const BANNED_WORDS: readonly BannedWord[] = [
  {
    word: 'delv(?:e|es|ed|ing)',
    explain: 'say what you are actually doing: look at, read, take apart.',
  },
  {
    word: 'leverag(?:e|es|ed|ing)',
    explain: 'use `use`, or name the thing you are using it for.',
  },
  {word: 'utiliz(?:e|es|ed|ing)', explain: 'use `use`.'},
  {word: 'robust', explain: 'name the property: fast, tested, hard to break.'},
  {word: 'seamless(?:ly)?', explain: 'say what the writer never has to do, and cut the adjective.'},
  {word: 'crucial(?:ly)?', explain: 'if it matters, show why; if it does not, cut the word.'},
  {word: 'pivotal', explain: 'say what turned on it.'},
  {word: 'myriad', explain: 'give the number, or say `many`.'},
  {word: 'plethora', explain: 'give the number, or say `too many`.'},
  {word: 'tapestry', explain: 'drop the metaphor and name the thing.'},
  {word: 'testament', explain: 'say what it proves, in the active voice.'},
  {word: 'realm', explain: 'name the field, the file, or the room.'},
  {
    // `navigation` is left out: as a noun it is almost always a menu.
    word: 'navigat(?:e|es|ed|ing)',
    explain: 'say what the reader actually does: choose, learn, get through.',
    literalContext:
      /\bnavigat\w*\s+(?:to\s+|through\s+|around\s+|by\s+|between\s+)?(?:the\s+|a\s+|this\s+|its\s+)?(?:menu|menus|sidebar|site|website|page|pages|app|city|street|streets|river|harbour|harbor|coast|map|maps|ship|boat|stars?|channel)\b/i,
  },
  {
    word: 'landscapes?',
    explain: 'name the market, the tooling, or the set of options.',
    literalContext:
      /\b(?:landscapes?\s+(?:orientation|mode|photograph\w*|paint\w*|garden\w*|architect\w*)|(?:rolling|flat|frozen|desert|mountain|coastal|open|winter)\s+landscapes?)\b/i,
  },
  {
    word: 'harness(?:es|ed|ing)?',
    explain: 'say `use`, or name what you do with it.',
    // A determiner in front of it makes it the object, not the verb: a climbing
    // harness, or a test harness.
    literalContext:
      /\b(?:(?:a|an|the|this|that|its|our|their|climbing|safety|dog|horse|chest|leather|full-body)\s+harness(?:es)?|harness(?:es)?\s+(?:clip|clips|strap|straps|buckle|and\s+rope))\b/i,
  },
  {
    word: 'unpack(?:s|ed|ing)?',
    explain: 'say `explain`, `take apart`, or just do it.',
    literalContext:
      /\bunpack\w*\s+(?:the\s+|a\s+|my\s+|his\s+|her\s+|their\s+|our\s+)?(?:bag|bags|box|boxes|suitcase|suitcases|luggage|groceries|crate|crates|van|shopping)\b/i,
  },
  {word: 'showcas(?:e|es|ed|ing)', explain: 'say `show`.'},
  {word: 'underscor(?:e|es|ed|ing)', explain: 'say what it shows, or cut the sentence.'},
  {word: 'foster(?:s|ed|ing)?', explain: 'name the thing you did that caused it.'},
  {word: 'elevat(?:e|es|ed|ing)', explain: 'say `improve`, and say by how much.'},
  {word: 'embark(?:s|ed|ing)?', explain: 'say `start`.'},
  {word: 'meticulous(?:ly)?', explain: 'show the care rather than claiming it.'},
  {word: 'intricate(?:ly)?', explain: 'say `complicated`, and say what makes it so.'},
  {word: 'vibrant', explain: 'describe what you can see instead.'},
  {word: 'bustling', explain: 'describe what you can see instead.'},
  {word: 'transformative', explain: 'say what changed.'},
  {word: 'holistic(?:ally)?', explain: 'name the parts you mean.'},
  {word: 'multifaceted', explain: 'name the facets, or cut the word.'},
  {word: 'game.?chang(?:er|ing)', explain: 'say what it changed.'},
  {word: 'cutting.edge', explain: 'say how new it is, or drop the claim.'},
  {word: 'state.of.the.art', explain: 'say what it beats.'},
  {word: 'resonat(?:e|es|ed|ing)', explain: 'say who agreed, and with what.'},
  {word: 'paradigm', explain: 'name the idea it replaced.'},
];

/**
 * Scene-setting openings. Tested against the start of a sentence, because the
 * same words mid-sentence are usually doing real work.
 */
export const BANNED_OPENERS: readonly PhraseRule[] = [
  {
    pattern: /^in today'?s\b/i,
    explain: 'start with the point. The reader already lives in today.',
  },
  {
    pattern: /^in (?:the|a) (?:world|age|era|realm) of\b/i,
    explain: 'start with the point, not the establishing shot.',
  },
  {pattern: /^in a world where\b/i, explain: 'start with the point, not the premise.'},
  {pattern: /^when it comes to\b/i, explain: 'delete the phrase and start with the subject.'},
  {pattern: /^at the end of the day\b/i, explain: 'delete it. The sentence stands without it.'},
  {pattern: /^in conclusion\b/i, explain: 'delete it. The reader can see this is the end.'},
  {pattern: /^in summary\b/i, explain: 'delete it, or cut the summary and keep the argument.'},
  {pattern: /^to sum up\b/i, explain: 'delete it, or cut the summary and keep the argument.'},
  {pattern: /^whether you'?re an? \b/i, explain: 'pick one reader and write to them.'},
  {
    pattern: /^imagine (?:a\b|an\b|for a moment)/i,
    explain: 'give the example rather than asking for one.',
  },
  {pattern: /^picture this\b/i, explain: 'give the example rather than announcing it.'},
];

/** Filler that can be deleted with the sentence left intact. */
export const THROAT_CLEARING: readonly PhraseRule[] = [
  {
    pattern: /\bit(?:'s| is| was) (?:worth|important) (?:noting|to note|to mention) that\b/gi,
    explain: 'delete the phrase and keep what follows it.',
  },
  {
    pattern: /\bit should be (?:noted|mentioned) that\b/gi,
    explain: 'delete the phrase and keep what follows it.',
  },
  {pattern: /\bneedless to say\b/gi, explain: 'delete it, or delete the sentence.'},
  {pattern: /\bthat said,/gi, explain: 'delete it and let the contrast do the work.'},
  {
    pattern: /\bthe (?:truth is|fact of the matter is)\b/gi,
    explain: 'delete the phrase and state the truth.',
  },
  {pattern: /\bhere'?s the thing\b/gi, explain: 'delete it and say the thing.'},
  {pattern: /\bi would argue that\b/gi, explain: 'delete it. You are the one writing.'},
  {pattern: /\bin many ways\b/gi, explain: 'name the ways, or delete the phrase.'},
  {pattern: /\bat its core\b/gi, explain: 'delete the phrase and make the claim.'},
  {pattern: /\bmore often than not\b/gi, explain: 'say `usually`, or give the proportion.'},
];

/** Telling the reader what the piece is about to do, instead of doing it. */
export const SIGNPOSTING: readonly PhraseRule[] = [
  {
    pattern: /\blet'?s (?:dive|explore|take a (?:closer )?look|examine|begin by|start by)\b/gi,
    explain: 'delete the announcement and start.',
  },
  {
    pattern: /\bin this (?:section|article|post|essay|piece|chapter),? (?:we|i)(?:'ll| will)?\b/gi,
    explain: 'delete the announcement and start.',
  },
  {
    pattern: /\bas (?:mentioned|noted|discussed|we saw) (?:earlier|above|previously)\b/gi,
    explain: 'delete it. If the reader needs it again, say it again in full.',
  },
  {pattern: /\bas we(?:'ll| will) see\b/gi, explain: 'delete it and let them see.'},
  {
    pattern: /\bbefore we (?:dive|begin|get|go) \w+/gi,
    explain: 'delete the preamble and put the caveat where it bites.',
  },
  {
    pattern: /\bin the (?:next|following) (?:section|chapter|part)\b/gi,
    explain: 'delete the forward reference, or link to it.',
  },
  {pattern: /\bnow,? let'?s\b/gi, explain: 'delete the transition and continue.'},
  {pattern: /\bwithout further ado\b/gi, explain: 'delete it.'},
];

/**
 * A false contrast on a predicate, and the two-sentence version of the same
 * move. The negation has to sit on the predicate itself, either after a copula
 * (`is not`, `it's not`) or behind an explicit intensifier (`not just`, `not
 * merely`, `not simply`): a bare `not ... , but` after a modal is ordinary
 * concession, and `We will not always agree, but I commit to listening` is a
 * sentence meaning what it says. Kept out of the `not only` detector by a
 * lookahead, so a sentence never gets flagged twice for the same words.
 */
export const NEGATIVE_PARALLELISM: readonly PhraseRule[] = [
  {
    pattern:
      /(?:\b(?:is|are|was|were|be|been)|\b\p{L}+['’](?:s|re))[ \t]+not(?! only)\b[ \t]+[^,.;:!?\n]{2,60},[ \t]*but\b|\bnot[ \t]+(?:just|merely|simply)[ \t]+[^,.;:!?\n]{2,60},[ \t]*but\b/giu,
    explain: 'delete the negation and keep the positive half.',
  },
  {
    pattern:
      /\b(?:it|this|that)(?:'s| is| was) not[ \t]+[^.!?\n]{2,60}[.!?][ \t]+(?:it|this|that)(?:'s| is| was)\b/gi,
    explain: 'delete the first sentence and keep the second.',
  },
];

/** Sentence openers that stack into a template when three arrive in a row. */
export const FORMAL_CONNECTIVES: readonly string[] = [
  'however',
  'moreover',
  'furthermore',
  'additionally',
  'therefore',
  'consequently',
  'nevertheless',
  'nonetheless',
  'thus',
  'hence',
  'indeed',
  'ultimately',
  'similarly',
  'likewise',
  'conversely',
  'subsequently',
  'importantly',
  'notably',
  'crucially',
  'in addition',
  'in contrast',
  'on the other hand',
];

/**
 * Words Title Case capitalises but a proper noun does not contain. A heading is
 * only flagged when one of these is capitalised somewhere after its first word,
 * which is what keeps `New York Times` and `The Sense of Style` quiet.
 */
export const TITLE_CASE_COMMON_WORDS: readonly string[] = [
  'a',
  'an',
  'and',
  'or',
  'but',
  'nor',
  'for',
  'so',
  'yet',
  'of',
  'in',
  'on',
  'at',
  'to',
  'from',
  'with',
  'without',
  'into',
  'onto',
  'about',
  'above',
  'over',
  'under',
  'after',
  'before',
  'between',
  'through',
  'during',
  'against',
  'among',
  'as',
  'by',
  'than',
  'then',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'we',
  'our',
  'us',
  'you',
  'your',
  'they',
  'their',
  'them',
  'he',
  'his',
  'she',
  'her',
  'my',
  'me',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'am',
  'do',
  'does',
  'did',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'have',
  'has',
  'had',
  'not',
  'no',
  'all',
  'any',
  'each',
  'every',
  'more',
  'most',
  'much',
  'many',
  'some',
  'such',
  'very',
  'how',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'if',
  'because',
  'while',
  'until',
  'since',
];
