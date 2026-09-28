import {autoCleanup} from './setup.ts';
import {afterEach, describe, expect, it} from 'bun:test';
import {fireEvent} from '@testing-library/react';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {history, undo} from '@codemirror/commands';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {createAnchor, type Finding} from '@inkling/voice';
import {setFindings, voiceFindings} from '../src/components/editor/findings-marks.ts';
import {liveMarks} from '../src/components/editor/live-marks.ts';
import {toggleTask} from '../src/components/editor/live-widgets.ts';

autoCleanup();

const DOC = 'Elsewhere.\n- [ ] Write it\n- [x] Done';
const OPEN_MARKER = DOC.indexOf('[ ]');
const DONE_MARKER = DOC.indexOf('[x]');

const open: EditorView[] = [];

afterEach(function () {
  while (open.length > 0) open.pop()?.destroy();
});

function editor(doc = DOC, anchor = 0): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: {anchor},
      extensions: [
        history(),
        markdown({base: markdownLanguage, codeLanguages: []}),
        liveMarks(),
        voiceFindings(),
      ],
    }),
    parent: document.body,
  });
  open.push(view);
  return view;
}

function lineText(view: EditorView, number: number): string {
  return view.state.doc.line(number).text;
}

describe('toggleTask', function () {
  it('should write [x] into the source when an unchecked box is toggled', function () {
    const view = editor();

    expect(toggleTask(view, OPEN_MARKER)).toBe(true);
    expect(lineText(view, 2)).toBe('- [x] Write it');
  });

  it('should restore [ ] when the toggle is undone', function () {
    const view = editor();

    toggleTask(view, OPEN_MARKER);
    undo(view);

    expect(view.state.doc.toString()).toBe(DOC);
  });

  it('should write [ ] when a checked box is toggled', function () {
    const view = editor();

    expect(toggleTask(view, DONE_MARKER)).toBe(true);
    expect(lineText(view, 3)).toBe('- [ ] Done');
  });

  it('should write [ ] when a box checked with a capital X is toggled', function () {
    const doc = 'Elsewhere.\n- [X] Done';
    const view = editor(doc);

    expect(toggleTask(view, doc.indexOf('[X]'))).toBe(true);
    expect(lineText(view, 2)).toBe('- [ ] Done');
  });

  it('should refuse to toggle when the position is not a task marker', function () {
    const view = editor();

    expect(toggleTask(view, DOC.indexOf('Write'))).toBe(false);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it('should refuse to toggle when a marker is written in running prose', function () {
    const doc = 'A [x] in a sentence.';
    const view = editor(doc, doc.length);

    expect(toggleTask(view, doc.indexOf('[x]'))).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe('the task checkbox', function () {
  it('should toggle through the checkbox when it receives a mousedown', function () {
    const view = editor();
    const box = view.contentDOM.querySelector<HTMLInputElement>('.cm-live-task');
    if (box === null) throw new Error('no checkbox was drawn');

    expect(box.checked).toBe(false);
    fireEvent.mouseDown(box);

    expect(lineText(view, 2)).toBe('- [x] Write it');
    expect(view.state.selection.main.head).toBe(0);
    expect(view.contentDOM.querySelector<HTMLInputElement>('.cm-live-task')?.checked).toBe(true);
  });

  it('should keep a finding underlined when it lies in a task item', function () {
    const view = editor();
    const start = DOC.indexOf('Write it');
    const end = start + 'Write it'.length;
    const finding: Finding = {
      ruleId: 'em-dash',
      anchor: createAnchor(DOC, start, end),
      range: {start, end},
      explain: 'A finding.',
    };

    view.dispatch({effects: setFindings.of([finding])});

    const underline = view.contentDOM.querySelector('.cm-voice-finding');
    expect(underline?.textContent).toBe('Write it');
    expect(underline?.closest('.cm-line')?.querySelector('.cm-live-task')).not.toBeNull();
  });
});

describe('the rule and the quote', function () {
  it('should draw a rule widget for a thematic break off the caret line', function () {
    const doc = 'Elsewhere.\n\n***\n\nAfter.';
    const view = editor(doc);

    expect(view.contentDOM.querySelector('.cm-live-rule')).not.toBeNull();

    view.dispatch({selection: {anchor: doc.indexOf('***') + 1}});

    expect(view.contentDOM.querySelector('.cm-live-rule')).toBeNull();
    expect(view.contentDOM.textContent).toContain('***');
  });

  it("should keep a blockquote line's quote class when the caret is on it", function () {
    const doc = 'Elsewhere.\n\n> Quoted.';
    const view = editor(doc, doc.length);

    expect(view.contentDOM.querySelector('.cm-line.cm-live-quote')?.textContent).toBe('> Quoted.');
  });

  it('should give a list line a hanging indent when the caret is on it', function () {
    const doc = 'Elsewhere.\n\n- An item';
    const view = editor(doc, doc.length);
    const line = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')].find(
      (candidate) => candidate.textContent === '- An item',
    );

    expect(line?.getAttribute('style')).toContain('padding-left: 2ch');
    expect(line?.getAttribute('style')).toContain('text-indent: -2ch');
  });
});
