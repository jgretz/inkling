import {describe, expect, it} from 'bun:test';
import {EditorSelection, EditorState, type TransactionSpec} from '@codemirror/state';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {
  INLINE,
  toggleInline,
  toggleLink,
  type InlineKind,
} from '../src/components/editor/format-inline.ts';

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

function apply(state: EditorState, spec: TransactionSpec): EditorState {
  return state.update(spec).state;
}

/** The document with `|` at the caret, or `[` and `]` around the selection. */
function shown(state: EditorState): string {
  const {from, to} = state.selection.main;
  const doc = state.doc.toString();
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}[${doc.slice(from, to)}]${doc.slice(to)}`;
}

const KINDS: InlineKind[] = ['bold', 'italic', 'strikethrough', 'code'];

describe('toggleInline', function () {
  for (const kind of KINDS) {
    const d = INLINE[kind].delim;

    describe(kind, function () {
      it('should wrap the selection and keep the same text selected when a word is selected', function () {
        const state = stateOf('A word here.', {anchor: 2, head: 6});

        const after = apply(state, toggleInline(state, kind));

        expect(shown(after)).toBe(`A ${d}[word]${d} here.`);
      });

      it('should unwrap the construct when the caret is inside it', function () {
        const doc = `A ${d}word${d} here.`;
        const state = stateOf(doc, {anchor: doc.indexOf('word') + 2});

        const after = apply(state, toggleInline(state, kind));

        expect(shown(after)).toBe('A wo|rd here.');
      });

      it("should unwrap the construct when the selection covers the construct's text", function () {
        const doc = `A ${d}word${d} here.`;
        const start = doc.indexOf('word');
        const state = stateOf(doc, {anchor: start, head: start + 4});

        const after = apply(state, toggleInline(state, kind));

        expect(shown(after)).toBe('A [word] here.');
      });

      it("should wrap the word and keep the caret's offset in it when the caret is empty on a word", function () {
        const state = stateOf('A word here.', {anchor: 4});

        const after = apply(state, toggleInline(state, kind));

        expect(shown(after)).toBe(`A ${d}wo|rd${d} here.`);
      });

      it('should insert the pair with the caret between when the caret is on no word', function () {
        const state = stateOf('A  here.', {anchor: 2});

        const after = apply(state, toggleInline(state, kind));

        expect(shown(after)).toBe(`A ${d}|${d} here.`);
      });

      it('should remove an empty pair when the caret is between it', function () {
        const doc = `A ${d}${d} here.`;
        const state = stateOf(doc, {anchor: 2 + d.length});

        const after = apply(state, toggleInline(state, kind));

        expect(shown(after)).toBe('A | here.');
      });

      it('should wrap only the trimmed text when the selection ends in whitespace', function () {
        const state = stateOf('A word here.', {anchor: 2, head: 7});

        const after = apply(state, toggleInline(state, kind));

        expect(shown(after)).toBe(`A ${d}[word]${d} here.`);
      });
    });
  }

  it('should remove only the strong marks when bold is toggled inside ***x***', function () {
    const state = stateOf('A ***x*** b', {anchor: 5});

    const after = apply(state, toggleInline(state, 'bold'));

    expect(after.doc.toString()).toBe('A *x* b');
  });

  it('should keep a backwards selection backwards when wrapping', function () {
    const state = stateOf('A word here.', {anchor: 6, head: 2});

    const after = apply(state, toggleInline(state, 'bold'));

    expect(after.selection.main.anchor).toBe(8);
    expect(after.selection.main.head).toBe(4);
  });
});

describe('toggleLink', function () {
  it('should make the selection the link text with the caret between the parentheses when text is selected', function () {
    const state = stateOf('See the docs now.', {anchor: 4, head: 12});

    const after = apply(state, toggleLink(state));

    expect(shown(after)).toBe('See [the docs](|) now.');
  });

  it('should make the word the link text with the caret between the parentheses when the caret is on a word', function () {
    const state = stateOf('See docs now.', {anchor: 5});

    const after = apply(state, toggleLink(state));

    expect(shown(after)).toBe('See [docs](|) now.');
  });

  it('should insert an empty link with the caret in the brackets when the caret is on no word', function () {
    const state = stateOf('See  now.', {anchor: 4});

    const after = apply(state, toggleLink(state));

    expect(shown(after)).toBe('See [|]() now.');
  });

  it('should select the URL and leave the text unchanged when the caret is inside a link', function () {
    const doc = 'See [docs](https://example.com) now.';
    const state = stateOf(doc, {anchor: 6});

    const after = apply(state, toggleLink(state));

    expect(after.doc.toString()).toBe(doc);
    expect(shown(after)).toBe('See [docs]([https://example.com]) now.');
  });

  it('should put the caret between the parentheses when the link inside has no URL', function () {
    const doc = 'See [docs]() now.';
    const state = stateOf(doc, {anchor: 6});

    const after = apply(state, toggleLink(state));

    expect(after.doc.toString()).toBe(doc);
    expect(shown(after)).toBe('See [docs](|) now.');
  });

  it('should format both selection ranges in one transaction when there are two', function () {
    const state = stateOf(
      'one two three',
      EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(10)]),
    );

    const after = apply(state, toggleLink(state));

    expect(after.doc.toString()).toBe('[one]() two [three]()');
    expect(
      after.selection.ranges.map(function (range) {
        return range.head;
      }),
    ).toEqual([6, 20]);
  });
});
