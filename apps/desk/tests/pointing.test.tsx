import {autoCleanup, drainReactScheduler} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {useCallback, useMemo, useRef, useState} from 'react';
import {act, fireEvent, render} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import type {DocPath} from '@inkling/vault';
import {emptyContext, type AgentContext, type AgentTransport} from '../src/lib/agent.ts';
import type {Conversation} from '../src/lib/conversations.ts';
import {resolvePointer, type Pointer} from '../src/lib/pointer.ts';
import {ChatPanel} from '../src/components/chat/ChatPanel.tsx';
import {EditorPanel, type Reveal} from '../src/components/editor/EditorPanel.tsx';

autoCleanup();

/**
 * Pointing, end to end: a reply names a passage and the editor shows it.
 *
 * A harness rather than `App` itself, mirroring `editor-findings.test.tsx`: what
 * is under test is the two panels wired to one another the way `App.tsx` wires
 * them, and `App` also owns a vault, a settings file and a Tauri bridge that
 * none of this depends on. What the harness does reproduce exactly is the path a
 * pointer takes: resolved against the draft as it stands now, revealed with the
 * counter incremented, painted because the reveal asked for the paint.
 *
 * The cases that edit the document after a reveal print a caught CodeMirror
 * error to stderr: "Calls to EditorView.update are not allowed while an update
 * is in progress". It is happy-dom, not inkling. happy-dom fires
 * `selectionchange` synchronously while the DOM selection is being written,
 * where a browser queues it as a task, so CodeMirror's own selection observer
 * re-enters its update. happy-dom swallows the throw, the assertions below are
 * unaffected, and nothing in the app runs against happy-dom.
 */

const OPENING = 'A short opening line.';
const BODY = 'The ending is rather good.';
const DRAFT = `${OPENING}\n\n${BODY}`;

const NO_FINDINGS = Object.freeze([]);

const CONVERSATION: Conversation = {
  id: 1,
  docPath: 'drafts/a.md' as DocPath,
  title: 'On endings',
  sessionId: null,
  resumeSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function noop() {}

/** A write that resolves having done nothing, for the controls this suite ignores. */
function noWrite(): Promise<void> {
  return Promise.resolve();
}

function noFlush(): Promise<void> {
  return Promise.resolve();
}

/** A transport that points at the next quote in the list, one per turn. */
function pointingAt(quotes: readonly string[]): AgentTransport {
  let turn = 0;
  return {
    name: 'test',
    async *send() {
      const quote = quotes[Math.min(turn, quotes.length - 1)] ?? '';
      turn += 1;
      yield {kind: 'text', text: 'There it is.'};
      yield {kind: 'reply', reply: {kind: 'point', text: 'There it is.', quote}};
    },
  };
}

type HarnessProps = {
  quotes: readonly string[];
  /** The writer's own edits, so a reveal can be shown to make none. */
  onChange?: (source: string) => void;
  onSave?: () => void;
};

function Harness({quotes, onChange = noop, onSave = noop}: HarnessProps) {
  const [source, setSource] = useState(DRAFT);
  const [selection, setSelection] = useState<Pointer | undefined>(undefined);
  const [reveal, setReveal] = useState<Reveal | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // The draft as it stands when a reference is clicked, held the way `App.tsx`
  // holds it: depending on the value itself would rebuild the handler on every
  // keystroke.
  const draft = useRef(source);
  draft.current = source;

  const transport = useMemo(
    function () {
      return pointingAt(quotes);
    },
    [quotes],
  );

  const context: AgentContext = useMemo(
    function () {
      return {
        ...emptyContext(),
        doc: {path: 'drafts/a.md' as DocPath, title: 'A draft', source},
        selection,
      };
    },
    [source, selection],
  );

  const handleChange = useCallback(
    function (next: string) {
      setSource(next);
      onChange(next);
    },
    [onChange],
  );

  // `App.handlePoint`, to the line: the same resolver, the same sentence, the
  // same incremented counter. A second implementation here would be a harness
  // testing itself.
  const handlePoint = useCallback(function (pointer: Pointer) {
    const found = resolvePointer(draft.current, pointer);
    if (!found.ok) {
      setError(found.reason);
      return;
    }
    setError(undefined);
    setReveal(function (current) {
      return {range: found.range, seq: (current?.seq ?? 0) + 1, mark: true};
    });
  }, []);

  return (
    <div>
      <EditorPanel
        path="drafts/a.md"
        source={source}
        onChange={handleChange}
        onSelect={setSelection}
        onSave={onSave}
        onFocus={noop}
        findings={NO_FINDINGS}
        marksOn
        reveal={reveal}
      />
      <ChatPanel
        transport={transport}
        context={context}
        references={{
          docs: [],
          group: undefined,
          canAttach: false,
          onAttach: noop,
          onAttachMany: noWrite,
          onDetach: noop,
          onSuppress: noop,
          onRestore: noop,
        }}
        initial={[]}
        conversations={{
          all: [CONVERSATION],
          activeId: 1,
          onSelect: noop,
          onCreate: noop,
          onDelete: noop,
        }}
        mode="writer"
        onFlush={noFlush}
        onAccept={noop}
        onLand={noop}
        onPoint={handlePoint}
        onFocus={noop}
        composerHeight={96}
        onResizeComposer={noop}
      />
      {error !== undefined && <p>{error}</p>}
    </div>
  );
}

function open(props: Partial<HarnessProps> = {}) {
  const quotes = props.quotes ?? ['rather good'];
  const view = render(<Harness {...props} quotes={quotes} />);
  const editor = EditorView.findFromDOM(view.container as HTMLElement);
  if (editor === null) throw new Error('the editor view did not mount');
  return {view, editor};
}

/** Types a message and presses send, letting the turn run as far as it can. */
async function ask(view: ReturnType<typeof render>): Promise<void> {
  await act(async function () {
    fireEvent.change(view.getByLabelText('Message the agent'), {target: {value: 'Which bit?'}});
  });
  await act(async function () {
    fireEvent.click(view.getByLabelText('Send message'));
    await drainReactScheduler();
  });
}

function references(view: ReturnType<typeof render>): HTMLElement[] {
  return view.getAllByLabelText(/^Show the passage the agent pointed at/);
}

/** Clicks a reference and lets the reveal settle, focus microtask included. */
async function pick(view: ReturnType<typeof render>, at = 0): Promise<void> {
  const button = references(view)[at];
  if (button === undefined) throw new Error(`there is no reference at ${at}`);
  await act(async function () {
    fireEvent.click(button);
    await drainReactScheduler();
  });
}

function painted(view: ReturnType<typeof render>): string[] {
  return [...view.container.querySelectorAll<HTMLElement>('.cm-agent-point')].map(function (span) {
    return span.textContent ?? '';
  });
}

function selected(editor: EditorView): string {
  const {from, to} = editor.state.selection.main;
  return editor.state.sliceDoc(from, to);
}

/** An edit somewhere above the passage, made the way the writer would make one. */
async function rewriteTheOpening(editor: EditorView): Promise<void> {
  await act(async function () {
    editor.dispatch({
      changes: {
        from: 0,
        to: OPENING.length,
        insert: 'An opening line that is considerably longer than the one it replaced.',
      },
    });
    await drainReactScheduler();
  });
}

describe('revealing a passage a reply pointed at', function () {
  // The whole reason a pointer is an anchor: every offset below the rewrite has
  // moved, and the passage is still found. Asserted against the text at the new
  // offsets, never against the old numbers.
  it('should still find the passage after the paragraph above it is rewritten', async function () {
    const {view, editor} = open();
    await ask(view);
    await rewriteTheOpening(editor);

    await pick(view);

    expect(selected(editor)).toBe('rather good');
    expect(editor.state.selection.main.from).not.toBe(DRAFT.indexOf('rather good'));
  });

  it('should paint the passage it revealed', async function () {
    const {view} = open();
    await ask(view);

    await pick(view);

    expect(painted(view)).toEqual(['rather good']);
  });

  // Per the `seq` contract: the editor honours one reveal per counter value, so
  // a second pick of the same reference has to move the caret back again.
  it('should reveal again when the same reference is picked twice', async function () {
    const {view, editor} = open();
    await ask(view);
    await pick(view);

    await act(async function () {
      editor.dispatch({selection: {anchor: 0}});
    });
    await pick(view);

    expect(selected(editor)).toBe('rather good');
  });

  it('should change neither the document nor anything on disk', async function () {
    const edits: string[] = [];
    let saves = 0;
    const {view, editor} = open({
      onChange(source: string) {
        edits.push(source);
      },
      onSave() {
        saves += 1;
      },
    });
    await ask(view);

    await pick(view);

    expect(editor.state.doc.toString()).toBe(DRAFT);
    expect(edits).toEqual([]);
    expect(saves).toBe(0);
  });
});

describe('a passage the writer has since deleted', function () {
  /** Cuts the pointed-at words out from under the reference. */
  async function deleteTheBody(editor: EditorView): Promise<void> {
    await act(async function () {
      editor.dispatch({
        changes: {from: OPENING.length, to: DRAFT.length, insert: '\n\nThe ending works now.'},
      });
      await drainReactScheduler();
    });
  }

  it('should say the passage has gone and move nothing', async function () {
    const {view, editor} = open();
    await ask(view);
    await deleteTheBody(editor);
    await act(async function () {
      editor.dispatch({selection: {anchor: 0}});
    });

    await pick(view);

    expect(view.getByText('not in the document any more', {exact: false})).toBeDefined();
    expect(editor.state.selection.main.from).toBe(0);
    expect(painted(view)).toEqual([]);
  });
});

describe('the highlight', function () {
  it('should come off when the writer presses Escape in the editor', async function () {
    const {view, editor} = open();
    await ask(view);
    await pick(view);
    expect(painted(view)).toEqual(['rather good']);

    await act(async function () {
      fireEvent.keyDown(editor.contentDOM, {key: 'Escape'});
    });

    expect(painted(view)).toEqual([]);
  });

  // A writer who has started typing has stopped reading the answer.
  it('should come off as soon as the writer types', async function () {
    const {view, editor} = open();
    await ask(view);
    await pick(view);

    await act(async function () {
      editor.dispatch({changes: {from: 0, insert: 'Well. '}});
      await drainReactScheduler();
    });

    expect(painted(view)).toEqual([]);
  });

  // One at a time, so the writer is never looking at two answers to the question
  // of which passage was meant.
  it('should move to the second passage rather than joining the first', async function () {
    const {view} = open({quotes: ['rather good', 'A short opening line.']});
    await ask(view);
    await ask(view);

    await pick(view, 0);
    await pick(view, 1);

    expect(painted(view)).toEqual(['A short opening line.']);
  });
});
