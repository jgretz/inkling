import {useEffect, useRef} from 'react';
import {EditorState, type Extension} from '@codemirror/state';
import {EditorView, drawSelection, highlightActiveLine, keymap} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import type {Finding, Range} from '@inkling/voice';
import {pointerAt, type Pointer} from '../../lib/pointer.ts';
import {inklingTheme} from './theme.ts';
import {setFindings, voiceFindings} from './findings-marks.ts';
import {agentPoint, clearPoint, setPoint} from './point-mark.ts';

/**
 * A request to show a range.
 *
 * `seq` is what makes it a request rather than a position, and the editor reads
 * it: one reveal is honoured per counter value. Honouring one takes the caret
 * and the scroll position away from wherever the writer left them, so a
 * re-render that hands the same request back must not do that twice, while
 * picking the same finding twice must move twice even though the range is
 * identical. Callers increment on every pick.
 */
export type Reveal = {
  range: Range;
  seq: number;
  /**
   * Whether honouring this request also paints the passage.
   *
   * A pointer asks for the paint, because the writer clicked something in the
   * chat and needs to see which words it meant. A finding does not: the strip
   * entry they clicked already names it, and the underline is already there.
   */
  mark?: boolean;
};

type EditorPanelProps = {
  /** Identifies the buffer. A change here swaps the document wholesale. */
  path: string;
  source: string;
  onChange: (source: string) => void;
  /**
   * Fires with the selected passage, or `undefined` when nothing is selected.
   *
   * A pointer rather than the text alone, so the turn that carries it can show
   * the writer the same passage again later.
   */
  onSelect: (selection: Pointer | undefined) => void;
  onSave: () => void;
  /**
   * Fires when focus lands anywhere in the editor, which is what puts the
   * document back in the writer's hands. Read off the host element, so the
   * panel never has to know which of the view's own nodes took it.
   */
  onFocus: () => void;
  findings: readonly Finding[];
  /** Whether findings are underlined. The strip lists them either way. */
  marksOn: boolean;
  reveal: Reveal | undefined;
};

/**
 * The raw markdown editor.
 *
 * CodeMirror owns its own DOM, so React's job here is only to create the view
 * once per document and push external changes in. Three rules keep the two
 * models from fighting: the update listener ignores changes CodeMirror did not
 * originate from the user; the effect that syncs `source` in compares against
 * the current document before dispatching, so a round trip through the parent
 * does not reset the cursor; and findings arrive as a dispatched effect, never
 * by re-creating the view, so marking a document cannot cost the writer their
 * cursor, their scroll position or their undo history.
 */
export function EditorPanel({
  path,
  source,
  onChange,
  onSelect,
  onSave,
  onFocus,
  findings,
  marksOn,
  reveal,
}: EditorPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Callbacks live in refs so the view is built once per document rather than
  // torn down whenever the parent re-renders with new function identities.
  const handlers = useRef({onChange, onSelect, onSave});
  handlers.current = {onChange, onSelect, onSave};

  // Same reason, and one more: a new view has to be decorated at creation. The
  // effect below fires only when `findings` changes identity, which it does not
  // when two documents happen to hold identical text.
  const marks = useRef({findings, marksOn});
  marks.current = {findings, marksOn};

  useEffect(
    function () {
      const parent = host.current;
      if (parent === null) return;

      const listener = EditorView.updateListener.of(function (update) {
        if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const {from, to} = update.state.selection.main;
          // The document is read only when there is a selection to anchor: a
          // caret move is the common case and costs nothing.
          handlers.current.onSelect(
            from === to ? undefined : pointerAt(update.state.doc.toString(), from, to),
          );
        }
      });

      const saveKey = keymap.of([
        {
          key: 'Mod-s',
          run() {
            handlers.current.onSave();
            return true;
          },
        },
      ]);

      const extensions: Extension[] = [
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown({base: markdownLanguage, codeLanguages: []}),
        inklingTheme,
        voiceFindings(),
        // Before the default keymap, so its Escape binding is offered the key
        // first and declines it whenever no passage is painted.
        agentPoint(),
        listener,
        saveKey,
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ];

      const instance = new EditorView({
        state: EditorState.create({doc: source, extensions}),
        parent,
      });
      view.current = instance;
      instance.dispatch({
        effects: setFindings.of(marks.current.marksOn ? marks.current.findings : []),
      });

      return function () {
        instance.destroy();
        view.current = null;
      };
    },
    // `source` is read only to seed the initial document; the sync effect below
    // owns every change after that, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path],
  );

  useEffect(
    function () {
      const instance = view.current;
      if (instance === null) return;
      const current = instance.state.doc.toString();
      if (current === source) return;
      instance.dispatch({changes: {from: 0, to: current.length, insert: source}});
    },
    [source],
  );

  // Declared after the `source` sync above so the document is already current
  // when the findings computed from it arrive.
  useEffect(
    function () {
      const instance = view.current;
      if (instance === null) return;
      instance.dispatch({effects: setFindings.of(marksOn ? findings : [])});
    },
    [findings, marksOn],
  );

  useEffect(
    function () {
      const instance = view.current;
      if (instance === null || reveal === undefined) return;
      const length = instance.state.doc.length;
      const from = Math.max(0, Math.min(reveal.range.start, length));
      const to = Math.max(from, Math.min(reveal.range.end, length));
      instance.dispatch({
        selection: {anchor: from, head: to},
        effects: [
          EditorView.scrollIntoView(from, {y: 'center'}),
          // One highlight at a time: a reveal that wants none says so rather
          // than leaving the previous pointer's paint behind it.
          reveal.mark === true ? setPoint.of({start: from, end: to}) : clearPoint.of(null),
        ],
      });

      // Focus after the update cycle rather than inside it. `focus()` makes
      // CodeMirror write the DOM selection, and doing that while the dispatch
      // above is still measuring re-enters its own update. The guard is for the
      // document being closed in between.
      queueMicrotask(function () {
        if (view.current === instance) instance.focus();
      });
    },
    // The counter, not the request object. Honouring a reveal takes the caret,
    // so the editor moves once per pick and never because a re-render happened
    // to hand back an equal request. `seq` increases on every pick by contract,
    // so `reveal.range` above cannot be read from a request this already ran.
    [reveal?.seq],
  );

  // React delegates focus at the tree's root, so focus landing on a node
  // CodeMirror created reaches this handler without the panel needing a
  // CodeMirror focus API of its own.
  return (
    <div
      ref={host}
      onFocusCapture={onFocus}
      className="selectable h-full min-w-0 overflow-hidden bg-ink-900"
    />
  );
}
