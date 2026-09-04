import {useEffect, useRef} from 'react';
import {EditorState, type Extension} from '@codemirror/state';
import {EditorView, drawSelection, highlightActiveLine, keymap} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import type {Finding, Range} from '@inkling/voice';
import {inklingTheme} from './theme.ts';
import {setFindings, voiceFindings} from './findings-marks.ts';

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
};

type EditorPanelProps = {
  /** Identifies the buffer. A change here swaps the document wholesale. */
  path: string;
  source: string;
  onChange: (source: string) => void;
  /** Fires with the selected text, or an empty string when nothing is selected. */
  onSelect: (selection: string) => void;
  onSave: () => void;
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
          handlers.current.onSelect(from === to ? '' : update.state.sliceDoc(from, to));
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
        effects: EditorView.scrollIntoView(from, {y: 'center'}),
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

  return <div ref={host} className="selectable h-full min-w-0 overflow-hidden bg-ink-900" />;
}
