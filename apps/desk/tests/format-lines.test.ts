import {describe, expect, it} from 'bun:test';
import {EditorState} from '@codemirror/state';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {
  linesCarry,
  parseLine,
  toggleLines,
  type LineFormat,
} from '../src/components/editor/format-lines.ts';

function stateOf(doc: string, anchor: number, head = anchor) {
  return EditorState.create({
    doc,
    selection: {anchor, head},
    extensions: [markdown({base: markdownLanguage, codeLanguages: []})],
  });
}

/** The whole document selected. */
function all(doc: string) {
  return stateOf(doc, 0, doc.length);
}

function toggled(state: EditorState, format: LineFormat): EditorState {
  const spec = toggleLines(state, format);
  if (spec === null) throw new Error(`${format} had no line to apply to`);
  return state.update(spec).state;
}

describe('parseLine', function () {
  it('should read a task marker as a task and never as a bullet', function () {
    expect(parseLine('- [ ] Buy milk').format).toBe('task');
    expect(parseLine('- Buy milk').format).toBe('bullet');
  });

  it('should find the marker after a quote prefix and an indent', function () {
    const parsed = parseLine('>   1. Item');

    expect(parsed.quote).toBe(2);
    expect(parsed.marker).toEqual({from: 4, to: 7});
    expect(parsed.format).toBe('numbered');
  });
});

describe('toggleLines', function () {
  it('should add the prefix to every touched line and remove it when all carry it', function () {
    const doc = 'One\nTwo\nThree';

    const added = toggled(all(doc), 'bullet');
    expect(added.doc.toString()).toBe('- One\n- Two\n- Three');

    const removed = toggled(added, 'bullet');
    expect(removed.doc.toString()).toBe(doc);
  });

  it('should add the prefix to every line when only some carry it', function () {
    const state = all('- One\nTwo\n- Three');

    expect(linesCarry(state, 'bullet')).toBe(false);
    expect(toggled(state, 'bullet').doc.toString()).toBe('- One\n- Two\n- Three');
  });

  it('should replace the markers and number them in order when bullets become numbered', function () {
    const after = toggled(all('- One\n* Two\n- Three'), 'numbered');

    expect(after.doc.toString()).toBe('1. One\n2. Two\n3. Three');
  });

  it('should drop the checkbox when a task becomes a bullet', function () {
    const after = toggled(stateOf('- [x] Done', 8), 'bullet');

    expect(after.doc.toString()).toBe('- Done');
  });

  it('should replace the level when an h1 becomes an h3', function () {
    const after = toggled(stateOf('# Title', 3), 'h3');

    expect(after.doc.toString()).toBe('### Title');
  });

  it('should remove the heading when h2 is toggled on an h2 line', function () {
    const after = toggled(stateOf('## Title', 4), 'h2');

    expect(after.doc.toString()).toBe('Title');
  });

  it('should replace a list marker when a heading is set', function () {
    const after = toggled(stateOf('- Item', 3), 'h1');

    expect(after.doc.toString()).toBe('# Item');
  });

  it('should skip blank lines when a list is set over several lines', function () {
    const after = toggled(all('One\n\nTwo'), 'bullet');

    expect(after.doc.toString()).toBe('- One\n\n- Two');
  });

  it('should give a single empty line a bullet with the caret after it', function () {
    const after = toggled(stateOf('One\n\nTwo', 4), 'bullet');

    expect(after.doc.toString()).toBe('One\n- \nTwo');
    expect(after.selection.main.head).toBe(6);
  });

  it('should quote the blank lines inside the selection and remove the quote again', function () {
    const doc = 'One\n\nTwo';

    const quoted = toggled(all(doc), 'quote');
    expect(quoted.doc.toString()).toBe('> One\n>\n> Two');

    const unquoted = toggled(quoted, 'quote');
    expect(unquoted.doc.toString()).toBe(doc);
  });

  it('should leave the next line alone when the selection ends at its column 0', function () {
    const state = stateOf('One\nTwo\nThree', 0, 8);

    const after = toggled(state, 'h2');

    expect(after.doc.toString()).toBe('## One\n## Two\nThree');
  });

  it('should keep the caret on the same text when the prefix changes', function () {
    const doc = '- Item here';
    const state = stateOf(doc, doc.indexOf('here'));

    const numbered = toggled(state, 'numbered');
    expect(numbered.doc.sliceString(numbered.selection.main.head)).toBe('here');

    const task = toggled(numbered, 'task');
    expect(task.doc.sliceString(task.selection.main.head)).toBe('here');

    const plain = toggled(task, 'task');
    expect(plain.doc.toString()).toBe('Item here');
    expect(plain.doc.sliceString(plain.selection.main.head)).toBe('here');
  });

  it('should land the caret after a new prefix when it sat at the line start', function () {
    const after = toggled(stateOf('Item', 0), 'quote');

    expect(after.doc.toString()).toBe('> Item');
    expect(after.selection.main.head).toBe(2);
  });
});
