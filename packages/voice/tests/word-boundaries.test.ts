import {describe, expect, it} from 'bun:test';
import {check} from '../src/check.ts';
import {DETECTORS} from '../src/registry.ts';

/**
 * A finding is a highlight in the editor, so a span that starts or ends inside
 * a word is visibly wrong however right the rule was to fire. `rule-of-three`
 * shipped one: the engine failed its clause guard at the `W` of `When`, slid
 * one character, and reported a span beginning at `hen`. The general form is
 * cheap to catch, so this sweeps every registered detector rather than the one
 * that failed.
 */
const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

type Fixture = {
  id: string;
  source: string;
};

/**
 * One fixture per registered detector, each written so its own rule fires.
 *
 * `curly-quotes` uses the double-quote form on purpose: a typographic
 * apostrophe is itself a word character by the class above, so `It’s` would
 * read as a split word when the rule is in fact doing exactly its job.
 */
const FIXTURES: readonly Fixture[] = [
  {id: 'em-dash', source: 'The gate fails closed — a missing judge never auto-approves.'},
  {
    id: 'en-dash-parenthetical',
    source: 'Switching runtimes – which is rare – starts from an empty store.',
  },
  {id: 'spaced-hyphen', source: 'The gate fails closed - a missing judge never auto-approves.'},
  {id: 'curly-quotes', source: 'He said “no” and left the draft where it was.'},
  {
    id: 'negative-parallelism',
    source: "The daemon is fine. It's not a scheduler, but a queue with a worker on the end.",
  },
  {id: 'not-only-but', source: 'The checker is not only fast but also free.'},
  {id: 'no-x-no-y-just-z', source: 'No server, no daemon, just files on disk.'},
  {id: 'title-case-heading', source: '## How To Ship A Draft'},
  {id: 'bold-term-colon', source: '- **Preview**: tracks the editor keystroke by keystroke.'},
  {id: 'banned-words', source: 'We delve into the details of the parser.'},
  {
    id: 'banned-openers',
    source: "The draft is fine. In today's tooling, a writer has too many choices.",
  },
  {id: 'throat-clearing', source: 'It is worth noting that the preview never lags the editor.'},
  {id: 'signposting', source: "Let's dive into how the reducer handles a stale result."},
  {
    id: 'rule-of-three',
    source: [
      'Sometimes they’re career-oriented, sometimes about immediate tasks, and sometimes they’re a therapy session.',
      'When it does, I communicate early and appreciate the same.',
      'The vault holds drafts, references and notes.',
      'The editor tracks the caret, the selection and the scroll.',
    ].join(' '),
  },
  {
    id: 'transition-stacking',
    source: [
      'However, the panel stays quiet.',
      'Moreover, the editor keeps up.',
      'Furthermore, the preview never lags.',
    ].join(' '),
  },
  {
    id: 'sentence-length-uniformity',
    source: [
      'The preview tracks the editor closely.',
      'The editor holds the markdown source.',
      'The agent reads whatever it is given.',
      'The library sits behind a hinge.',
    ].join(' '),
  },
];

describe('finding word boundaries', function () {
  it('should carry one fixture for every registered detector, in registry order', function () {
    const ids = DETECTORS.map(function (detector) {
      return detector.id;
    });

    expect(
      FIXTURES.map(function (fixture) {
        return fixture.id;
      }),
    ).toEqual(ids);
  });

  FIXTURES.forEach(function (fixture) {
    it(`should fire ${fixture.id} on its own fixture`, function () {
      expect(check(fixture.source, {detectors: [fixture.id]}).length).toBeGreaterThan(0);
    });

    it(`should not start or end a ${fixture.id} finding inside a word`, function () {
      const split = check(fixture.source, {detectors: [fixture.id]})
        .filter(function (finding) {
          const {start, end} = finding.range;
          const startsInside = isWord(fixture.source[start - 1]) && isWord(fixture.source[start]);
          const endsInside = isWord(fixture.source[end - 1]) && isWord(fixture.source[end]);
          return startsInside || endsInside;
        })
        .map(function (finding) {
          return finding.anchor.quote;
        });

      expect(split).toEqual([]);
    });
  });
});
