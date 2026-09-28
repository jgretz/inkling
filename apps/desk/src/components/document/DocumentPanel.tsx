import {useCallback, useEffect, useRef, useState, type ComponentProps} from 'react';
import {
  isToggleEditKey,
  isToggleReadKey,
  showMode,
  toggleEditMode,
  toggleRead,
  type DocMode,
} from '../../lib/doc-mode.ts';
import {EditorPanel, type EditorHandle} from '../editor/EditorPanel.tsx';
import type {FormatName} from '../editor/format.ts';
import {FindingsStrip} from '../findings/FindingsStrip.tsx';
import {PreviewPanel} from '../preview/PreviewPanel.tsx';
import {DocumentBar} from './DocumentBar.tsx';
import {FormatToolbar} from './FormatToolbar.tsx';
import type {ModeUpdate} from './use-reveal.ts';

const NO_FORMATS: ReadonlySet<FormatName> = Object.freeze(new Set<FormatName>());

type DocumentPanelProps = Omit<
  ComponentProps<typeof EditorPanel>,
  'hidden' | 'ref' | 'onActiveFormats'
> &
  ComponentProps<typeof FindingsStrip> & {
    mode: DocMode;
    onMode: ModeUpdate;
  };

/**
 * One document, in whichever mode the writer picked, with its findings below.
 *
 * The editor stays mounted in every mode and is only hidden in Read, so the
 * view is never rebuilt by a switch: the document, its undo history, its caret
 * and its marks are all where they were on the way back.
 *
 * The mode switch sits on top in every mode, Read included, so the way back to
 * editing is always one click in the same place.
 *
 * Command-E (Read and back) and Command-Shift-E (Live and Source) are heard on
 * the window rather than in the editor, because they have to work from the chat
 * and with nothing focused, and in Read the editor cannot hear anything. The
 * panel is mounted exactly when a document is open, which is exactly when the
 * keys mean something.
 */
export function DocumentPanel({
  mode,
  onMode,
  findings,
  onPick,
  suppressed,
  onDismiss,
  onRestore,
  ...editor
}: DocumentPanelProps) {
  useEffect(
    function () {
      function handleKey(event: KeyboardEvent) {
        const update = isToggleReadKey(event)
          ? toggleRead
          : isToggleEditKey(event)
            ? toggleEditMode
            : undefined;
        if (update === undefined) return;
        event.preventDefault();
        onMode(update);
      }
      window.addEventListener('keydown', handleKey);
      return function () {
        window.removeEventListener('keydown', handleKey);
      };
    },
    [onMode],
  );

  const handle = useRef<EditorHandle>(null);
  const [active, setActive] = useState(NO_FORMATS);
  const format = useCallback(function (name: FormatName) {
    handle.current?.format(name);
  }, []);

  const show = useCallback(
    function (target: DocMode) {
      onMode(function (state) {
        return showMode(state, target);
      });
    },
    [onMode],
  );

  return (
    <>
      <DocumentBar mode={mode} onShow={show}>
        {mode !== 'read' && <FormatToolbar active={active} onFormat={format} />}
      </DocumentBar>
      <div className="min-h-0 flex-1">
        <EditorPanel
          {...editor}
          ref={handle}
          onActiveFormats={setActive}
          findings={findings}
          hidden={mode === 'read'}
        />
        {mode === 'read' && <PreviewPanel source={editor.source} />}
      </div>
      <FindingsStrip
        findings={findings}
        onPick={onPick}
        suppressed={suppressed}
        onDismiss={onDismiss}
        onRestore={onRestore}
      />
    </>
  );
}
