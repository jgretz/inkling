import {autoCleanup} from './setup.ts';
import {afterEach, describe, expect, it} from 'bun:test';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import type {DecorationSet} from '@codemirror/view';
import {
  agentPoint,
  clearPoint,
  dismissPoint,
  pointDecoration,
  setPoint,
} from '../src/components/editor/point-mark.ts';

// The field is read through a live view, because what the writer is owed is a
// painted span in the document rather than a decoration set in a state.
autoCleanup();

const DOC = 'The ending is rather good, and the opening is not.';

const open: EditorView[] = [];

afterEach(function () {
  while (open.length > 0) open.pop()?.destroy();
});

function editor(doc = DOC): EditorView {
  const view = new EditorView({
    state: EditorState.create({doc, extensions: [agentPoint()]}),
    parent: document.body,
  });
  open.push(view);
  return view;
}

/** The painted passages, as the writer would see them. */
function painted(view: EditorView): string[] {
  return [...view.dom.querySelectorAll<HTMLElement>('.cm-agent-point')].map(function (span) {
    return span.textContent ?? '';
  });
}

function ranges(set: DecorationSet): {from: number; to: number}[] {
  const found: {from: number; to: number}[] = [];
  const cursor = set.iter();
  while (cursor.value !== null) {
    found.push({from: cursor.from, to: cursor.to});
    cursor.next();
  }
  return found;
}

describe('pointDecoration', function () {
  it('should paint the one range it was given', function () {
    expect(ranges(pointDecoration({start: 4, end: 8}, 20))).toEqual([{from: 4, to: 8}]);
  });

  // The same window `decorationsFor` clamps for: React holds the draft it last
  // rendered while the view holds whatever has been typed since, and an
  // out-of-range decoration throws inside CodeMirror rather than being ignored.
  it('should clamp a range that runs past the end of the document', function () {
    expect(ranges(pointDecoration({start: 4, end: 40}, 10))).toEqual([{from: 4, to: 10}]);
  });

  it('should paint nothing for a range entirely past the end', function () {
    expect(ranges(pointDecoration({start: 20, end: 25}, 10))).toEqual([]);
  });

  it('should paint nothing for a range that is empty after clamping', function () {
    expect(ranges(pointDecoration({start: 10, end: 12}, 10))).toEqual([]);
  });
});

describe('the pointing layer', function () {
  it('should paint nothing until a passage is pointed at', function () {
    expect(painted(editor())).toEqual([]);
  });

  it('should paint the passage a reveal pointed at', function () {
    const view = editor();

    view.dispatch({effects: setPoint.of({start: 14, end: 25})});

    expect(painted(view)).toEqual(['rather good']);
  });

  // One highlight at a time. Two would be two answers to "which passage did you
  // mean", and the writer asked about one.
  it('should replace the first passage when a second is pointed at', function () {
    const view = editor();
    view.dispatch({effects: setPoint.of({start: 14, end: 25})});

    view.dispatch({effects: setPoint.of({start: 31, end: 42})});

    expect(painted(view)).toEqual(['the opening']);
  });

  it('should take the paint off when a reveal asks for none', function () {
    const view = editor();
    view.dispatch({effects: setPoint.of({start: 14, end: 25})});

    view.dispatch({effects: clearPoint.of(null)});

    expect(painted(view)).toEqual([]);
  });

  // A writer who has started typing has stopped reading the answer, and a
  // highlight they typed through is no longer about anything they asked.
  it('should take the paint off as soon as the writer types', function () {
    const view = editor();
    view.dispatch({effects: setPoint.of({start: 14, end: 25})});

    view.dispatch({changes: {from: 0, insert: 'Well. '}});

    expect(painted(view)).toEqual([]);
  });

  it('should keep the paint through a caret move', function () {
    const view = editor();
    view.dispatch({effects: setPoint.of({start: 14, end: 25})});

    view.dispatch({selection: {anchor: 0}});

    expect(painted(view)).toEqual(['rather good']);
  });
});

describe('dismissPoint', function () {
  it('should take the paint off and claim the key', function () {
    const view = editor();
    view.dispatch({effects: setPoint.of({start: 14, end: 25})});

    expect(dismissPoint(view)).toBe(true);
    expect(painted(view)).toEqual([]);
  });

  // Escape already means several things in an editor. This one claims it only
  // while there is a highlight to dismiss, and lets the default binding have it
  // otherwise.
  it('should leave the key alone when nothing is painted', function () {
    expect(dismissPoint(editor())).toBe(false);
  });
});
