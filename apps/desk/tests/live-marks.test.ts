import {describe, expect, it} from 'bun:test';
import {EditorSelection, EditorState} from '@codemirror/state';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {liveMarkup} from '../src/components/editor/live-marks.ts';

/** The first line the caret sits on in every "untouched" case below. */
const ELSEWHERE = 'Elsewhere.\n';

function stateOf(doc: string, selection: EditorSelection | {anchor: number; head?: number}) {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({base: markdownLanguage, codeLanguages: []}),
    ],
  });
}

/** The document as Live draws it: the text with every hidden range deleted. */
function rendered(state: EditorState): string {
  const {hidden} = liveMarkup(state);
  let text = state.doc.toString();
  for (const {from, to} of [...hidden].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, from) + text.slice(to);
  }
  return text;
}

/** `line` as the second line of a document, the caret on the first. */
function untouched(line: string) {
  return stateOf(ELSEWHERE + line, {anchor: 0});
}

/** `line` as the second line, the caret inside it. */
function caretOn(line: string) {
  return stateOf(ELSEWHERE + line, {anchor: ELSEWHERE.length + 1});
}

/** `line` as the second line, a selection running into it from the first. */
function selectedInto(line: string) {
  return stateOf(ELSEWHERE + line, {anchor: 2, head: ELSEWHERE.length + 1});
}

const MARKERS: {name: string; line: string; shown: string}[] = [
  {name: 'an ATX heading', line: '## A heading', shown: 'A heading'},
  {name: 'emphasis with *', line: 'Some *leaning* words', shown: 'Some leaning words'},
  {name: 'emphasis with _', line: 'Some _leaning_ words', shown: 'Some leaning words'},
  {name: 'strong with **', line: 'Some **bold** words', shown: 'Some bold words'},
  {name: 'strong with __', line: 'Some __bold__ words', shown: 'Some bold words'},
  {name: 'strikethrough', line: 'Some ~~struck~~ words', shown: 'Some struck words'},
  {name: 'inline code', line: 'Some `code` words', shown: 'Some code words'},
  {
    name: 'a link',
    line: 'See [the site](https://example.com "Title") now',
    shown: 'See the site now',
  },
];

describe('liveMarkup', function () {
  for (const {name, line, shown} of MARKERS) {
    it(`should hide the markers of ${name} when the selection is on another line`, function () {
      expect(rendered(untouched(line))).toBe(ELSEWHERE + shown);
    });

    it(`should show the markers of ${name} when the caret is on its line`, function () {
      const state = caretOn(line);
      expect(liveMarkup(state).hidden).toEqual([]);
      expect(rendered(state)).toBe(ELSEWHERE + line);
    });

    it(`should show the markers of ${name} when a selection spans into its line`, function () {
      expect(rendered(selectedInto(line))).toBe(ELSEWHERE + line);
    });
  }

  it('should keep only the untouched line hidden when the caret is on the other', function () {
    const doc = 'One **bold** line\nTwo **bold** line';
    const state = stateOf(doc, {anchor: 1});

    expect(rendered(state)).toBe('One **bold** line\nTwo bold line');
  });

  it('should hide the closing hashes and the space before them when a heading has them', function () {
    expect(rendered(untouched('## Closed ##'))).toBe(ELSEWHERE + 'Closed');
  });

  it('should keep the heading line class when the caret is on the heading', function () {
    const untouchedHeadings = liveMarkup(untouched('# Title')).headings;
    const touchedHeadings = liveMarkup(caretOn('# Title')).headings;

    expect(untouchedHeadings).toEqual([{from: ELSEWHERE.length, level: 1}]);
    expect(touchedHeadings).toEqual(untouchedHeadings);
  });

  it('should give every heading level its own line class', function () {
    const doc = '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six';
    const levels = liveMarkup(stateOf(doc, {anchor: 0})).headings.map((h) => h.level);

    expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('should put the heading line class at the start of the line when the heading is quoted', function () {
    const state = untouched('> ## Quoted');

    expect(liveMarkup(state).headings).toEqual([{from: ELSEWHERE.length, level: 2}]);
    expect(rendered(state)).toBe(ELSEWHERE + '> Quoted');
  });

  it('should mark the link text whether or not the caret is on its line', function () {
    const line = 'See [the site](https://example.com) now';
    const text = {from: ELSEWHERE.length + 5, to: ELSEWHERE.length + 13};

    expect(liveMarkup(untouched(line)).links).toEqual([text]);
    expect(liveMarkup(caretOn(line)).links).toEqual([text]);
  });

  it('should leave an image raw when the selection is on another line', function () {
    const line = 'An ![alt text](picture.png) here';
    expect(rendered(untouched(line))).toBe(ELSEWHERE + line);
    expect(liveMarkup(untouched(line)).links).toEqual([]);
  });

  it('should leave a reference link raw when the selection is on another line', function () {
    const doc = ELSEWHERE + 'A [reference][ref] link\n\n[ref]: https://example.com';
    const state = stateOf(doc, {anchor: 0});
    expect(rendered(state)).toBe(doc);
    expect(liveMarkup(state).links).toEqual([]);
  });

  it('should leave an autolink raw when the selection is on another line', function () {
    const line = 'Go to <https://example.com> now';
    expect(rendered(untouched(line))).toBe(ELSEWHERE + line);
  });

  const SPLIT_LINKS: {name: string; link: string}[] = [
    {name: 'its url', link: '[a](\nhttps://example.com)'},
    {name: 'its title', link: '[a](u "multi\nline")'},
    {name: 'its text', link: '[two\nlines](https://example.com)'},
  ];

  for (const {name, link} of SPLIT_LINKS) {
    it(`should leave the whole link raw when ${name} is written across a newline`, function () {
      const doc = ELSEWHERE + link + '\n\nEnd.';
      const state = stateOf(doc, {anchor: doc.length});

      expect(rendered(state)).toBe(doc);
      expect(liveMarkup(state).links).toEqual([]);
    });
  }

  it('should leave a fenced code block raw when the selection is on another line', function () {
    const doc = ELSEWHERE + '```\n**not bold**\n```';
    expect(rendered(stateOf(doc, {anchor: 0}))).toBe(doc);
  });

  it('should un-hide each line a cursor sits on when there are several cursors', function () {
    const doc = 'A **one**\nB **two**\nC **three**';
    const selection = EditorSelection.create([
      EditorSelection.cursor(1),
      EditorSelection.cursor(doc.indexOf('C') + 1),
    ]);

    expect(rendered(stateOf(doc, selection))).toBe('A **one**\nB two\nC **three**');
  });

  it('should un-hide every line between the ends of a selection when it spans three lines', function () {
    const doc = 'A **one**\nB **two**\nC **three**\nD **four**';
    const state = stateOf(doc, {anchor: 1, head: doc.indexOf('C') + 1});

    expect(rendered(state)).toBe('A **one**\nB **two**\nC **three**\nD four');
  });
});
