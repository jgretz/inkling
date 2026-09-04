import {useEffect, useRef} from 'react';
import {EditorState, type Extension} from '@codemirror/state';
import {EditorView, drawSelection, highlightActiveLine, keymap} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap} from '@codemirror/commands';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {inklingTheme} from './theme.ts';

type EditorPanelProps = {
  /** Identifies the buffer. A change here swaps the document wholesale. */
  path: string;
  source: string;
  onChange: (source: string) => void;
  /** Fires with the selected text, or an empty string when nothing is selected. */
  onSelect: (selection: string) => void;
  onSave: () => void;
};

/**
 * The raw markdown editor.
 *
 * CodeMirror owns its own DOM, so React's job here is only to create the view
 * once per document and push external changes in. Two rules keep the two models
 * from fighting: the update listener ignores changes CodeMirror did not
 * originate from the user, and the effect that syncs `source` in compares
 * against the current document before dispatching, so a round trip through the
 * parent does not reset the cursor.
 */
export function EditorPanel({path, source, onChange, onSelect, onSave}: EditorPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Callbacks live in refs so the view is built once per document rather than
  // torn down whenever the parent re-renders with new function identities.
  const handlers = useRef({onChange, onSelect, onSave});
  handlers.current = {onChange, onSelect, onSave};

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
        listener,
        saveKey,
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ];

      const instance = new EditorView({
        state: EditorState.create({doc: source, extensions}),
        parent,
      });
      view.current = instance;

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

  return <div ref={host} className="selectable h-full min-w-0 overflow-hidden bg-ink-900" />;
}
