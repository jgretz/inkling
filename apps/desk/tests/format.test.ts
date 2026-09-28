import {describe, expect, it} from 'bun:test';
import {EditorState, type Transaction} from '@codemirror/state';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {history, undo} from '@codemirror/commands';
import {
  activeFormats,
  FORMAT_COMMANDS,
  FORMAT_NAMES,
  sameFormats,
  type FormatName,
} from '../src/components/editor/format.ts';

function stateOf(doc: string, anchor: number, head = anchor, withHistory = false) {
  return EditorState.create({
    doc,
    selection: {anchor, head},
    extensions: [
      markdown({base: markdownLanguage, codeLanguages: []}),
      ...(withHistory ? [history()] : []),
    ],
  });
}

/** `doc` with the caret at `|`, which is removed. */
function caretAt(marked: string): EditorState {
  const at = marked.indexOf('|');
  return stateOf(marked.slice(0, at) + marked.slice(at + 1), at);
}

function active(state: EditorState): FormatName[] {
  return [...activeFormats(state)].sort();
}

describe('activeFormats', function () {
  it('should report bold and italic inside ***x***', function () {
    expect(active(caretAt('A ***x|*** b'))).toEqual(['bold', 'italic']);
  });

  it('should report link inside a link', function () {
    expect(active(caretAt('See [do|cs](https://example.com).'))).toEqual(['link']);
  });

  it('should report h2 on an h2 line', function () {
    expect(active(caretAt('## Ti|tle'))).toEqual(['h2']);
  });

  it('should report task and not bullet on a task line', function () {
    expect(active(caretAt('- [ ] Buy mi|lk'))).toEqual(['task']);
  });

  it('should report bullet and not task on a bullet line', function () {
    expect(active(caretAt('- Buy mi|lk'))).toEqual(['bullet']);
  });

  it('should report nothing on plain text', function () {
    expect(active(caretAt('Just so|me prose.'))).toEqual([]);
  });
});

describe('sameFormats', function () {
  it('should compare two sets by their members', function () {
    expect(sameFormats(new Set(['bold', 'h1']), new Set(['h1', 'bold']))).toBe(true);
    expect(sameFormats(new Set(['bold']), new Set(['bold', 'h1']))).toBe(false);
    expect(sameFormats(new Set(['bold']), new Set(['italic']))).toBe(false);
  });
});

/**
 * Plain, formatted and mixed states, each with the caret on a word so every
 * command has something to act on.
 */
const FIXTURES = [
  'Just so|me prose.',
  'A **bo|ld** word.',
  'A _ital|ic_ word.',
  'A ~~stru|ck~~ word.',
  'A `co|de` word.',
  'A ***bo|th*** word.',
  'See [do|cs](https://example.com).',
  '# Ti|tle',
  '## Ti|tle',
  '### Ti|tle',
  '- Buy mi|lk',
  '1. Buy mi|lk',
  '- [ ] Buy mi|lk',
  '> A quo|te',
  '> - A quoted li|st',
];

const INLINE_MARKS: readonly FormatName[] = ['bold', 'italic', 'strikethrough', 'code'];

/**
 * Whether going from `before` to `after` took `name` away, judged without asking
 * `activeFormats` about `before`.
 */
function removed(name: FormatName, before: EditorState, after: EditorState): boolean {
  // A link is never removed: running it inside one selects the URL and edits
  // nothing.
  if (name === 'link') return after.doc.eq(before.doc);
  // Only unwrapping deletes. Read off the tree instead, a mark wrapped inside
  // inline code would look removed, because code spans hold no emphasis.
  if (INLINE_MARKS.includes(name)) return after.doc.length < before.doc.length;
  return !activeFormats(after).has(name);
}

describe('every format', function () {
  for (const name of FORMAT_NAMES) {
    it(`should be active exactly when running ${name} would remove it`, function () {
      for (const fixture of FIXTURES) {
        const before = caretAt(fixture);
        const spec = FORMAT_COMMANDS[name](before);
        if (spec === null) throw new Error(`${name} did nothing on ${fixture}`);
        const after = before.update(spec).state;

        const removes = removed(name, before, after);

        expect({fixture, active: activeFormats(before).has(name)}).toEqual({
          fixture,
          active: removes,
        });
      }
    });
  }
});

describe('the undo history', function () {
  /** A state with history, stepped by typing, formatting and undoing, all inside one tick. */
  function session(doc: string, caret: number) {
    let state = stateOf(doc, caret, caret, true);
    return {
      get doc() {
        return state.doc.toString();
      },
      type(text: string) {
        const at = state.selection.main.head;
        state = state.update({
          changes: {from: at, insert: text},
          selection: {anchor: at + text.length},
          userEvent: 'input.type',
        }).state;
      },
      format(name: FormatName) {
        const spec = FORMAT_COMMANDS[name](state);
        if (spec === null) throw new Error(`${name} did nothing`);
        state = state.update(spec).state;
      },
      undo() {
        undo({
          state,
          dispatch(tr: Transaction) {
            state = tr.state;
          },
        });
      },
    };
  }

  it('should undo a format and the typing before it as two steps when they come together', function () {
    const writer = session('A word', 6);

    writer.type('s');
    writer.format('bold');
    expect(writer.doc).toBe('A **words**');

    writer.undo();
    expect(writer.doc).toBe('A words');
    writer.undo();
    expect(writer.doc).toBe('A word');
  });

  it('should undo typing and the format before it as two steps when they come together', function () {
    const writer = session('A word', 6);

    writer.format('bold');
    writer.type('s');
    expect(writer.doc).toBe('A **words**');

    writer.undo();
    expect(writer.doc).toBe('A **word**');
    writer.undo();
    expect(writer.doc).toBe('A word');
  });
});
