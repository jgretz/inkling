import {autoCleanup} from './setup.ts';
import {afterEach, describe, expect, it} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {fireEvent} from '@testing-library/react';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {TagChips} from '../src/components/document/TagChips.tsx';
import {frontmatterFold, openingCaret} from '../src/components/editor/frontmatter-fold.ts';
import {liveMarks} from '../src/components/editor/live-marks.ts';

autoCleanup();

const DOC = '---\ntitle: A draft\ntags:\n  - a\n  - b\n---\nThe body.\n\nMore body.';
const SPAN_END = DOC.indexOf('\nThe body.');
const BODY = SPAN_END + 1;

function stateOf(doc: string, anchor: number): EditorState {
  return EditorState.create({
    doc,
    selection: {anchor},
    extensions: [markdown({base: markdownLanguage, codeLanguages: []}), liveMarks()],
  });
}

const open: EditorView[] = [];

afterEach(function () {
  while (open.length > 0) open.pop()?.destroy();
});

function editor(doc = DOC, anchor = BODY): EditorView {
  const view = new EditorView({state: stateOf(doc, anchor), parent: document.body});
  open.push(view);
  return view;
}

function fold(view: EditorView): HTMLElement | null {
  return view.contentDOM.querySelector<HTMLElement>('.cm-live-frontmatter');
}

describe('frontmatterFold', function () {
  const INSIDE: {name: string; anchor: number}[] = [
    {name: 'at 0', anchor: 0},
    {name: 'on a yaml line', anchor: DOC.indexOf('title')},
    {name: "at the closing fence's end", anchor: SPAN_END},
  ];

  for (const {name, anchor} of INSIDE) {
    it(`should leave the block open when the caret is ${name}`, function () {
      expect(frontmatterFold(stateOf(DOC, anchor)).size).toBe(0);
    });
  }

  it('should fold the whole block when the caret is on the first body line', function () {
    const decorations = frontmatterFold(stateOf(DOC, BODY));
    const folds: {from: number; to: number; block: unknown}[] = [];
    decorations.between(0, DOC.length, function (from, to, decoration) {
      folds.push({from, to, block: decoration.spec.block});
    });

    expect(folds).toEqual([{from: 0, to: SPAN_END, block: true}]);
  });

  it('should leave the block open when a second selection range reaches into it', function () {
    const state = EditorState.create({
      doc: DOC,
      selection: {anchor: BODY, head: 2},
      extensions: [markdown({base: markdownLanguage, codeLanguages: []}), liveMarks()],
    });

    expect(frontmatterFold(state).size).toBe(0);
  });

  it('should fold nothing when the document has no frontmatter', function () {
    const doc = 'Just prose.\n\n---\n\nMore.';
    expect(frontmatterFold(stateOf(doc, doc.length)).size).toBe(0);
  });

  it('should fold nothing when the frontmatter is not valid yaml', function () {
    const doc = '---\ntitle: [unclosed\n---\n\nBody.';
    expect(frontmatterFold(stateOf(doc, doc.length)).size).toBe(0);
  });
});

describe('openingCaret', function () {
  it('should put the caret at the body start when the document has frontmatter', function () {
    expect(openingCaret(DOC)).toBe(BODY);
  });

  it('should put the caret at 0 when the document has no frontmatter', function () {
    expect(openingCaret('Just prose.')).toBe(0);
  });

  it('should stay inside the document when the block is all there is', function () {
    const doc = '---\ntitle: X\n---';
    expect(openingCaret(doc)).toBe(doc.length);
  });
});

describe('the frontmatter fold in a view', function () {
  it("should draw the block as TagChips's own markup when the caret is in the body", function () {
    const view = editor();

    expect(fold(view)?.innerHTML).toBe(renderToStaticMarkup(<TagChips tags={['a', 'b']} />));
    expect(view.contentDOM.textContent).not.toContain('title: A draft');
  });

  it('should draw a label to click when the block has no tags', function () {
    const doc = '---\ntitle: X\n---\nBody.';
    const view = editor(doc, doc.length);

    expect(fold(view)?.textContent).toBe('Frontmatter');
  });

  it('should open the block for editing when the fold receives a mousedown', function () {
    const view = editor();
    const widget = fold(view);
    if (widget === null) throw new Error('the fold was not drawn');

    fireEvent.mouseDown(widget);

    expect(view.state.selection.main.head).toBeLessThanOrEqual(SPAN_END);
    expect(fold(view)).toBeNull();
    expect(view.contentDOM.textContent).toContain('title: A draft');
  });

  it('should re-fold with the edited tag when the caret leaves the block', function () {
    const view = editor();
    const tagB = DOC.indexOf('  - b') + 4;

    view.dispatch({selection: {anchor: tagB}});
    view.dispatch({changes: {from: tagB, to: tagB + 1, insert: 'c'}});
    view.dispatch({selection: {anchor: view.state.doc.length}});

    expect(fold(view)?.innerHTML).toBe(renderToStaticMarkup(<TagChips tags={['a', 'c']} />));
  });
});
