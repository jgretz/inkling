import {useEffect, type ComponentProps} from 'react';
import {isToggleReadKey, toggleRead, type DocMode} from '../../lib/doc-mode.ts';
import {EditorPanel} from '../editor/EditorPanel.tsx';
import {FindingsStrip} from '../findings/FindingsStrip.tsx';
import {PreviewPanel} from '../preview/PreviewPanel.tsx';
import type {ModeUpdate} from './use-reveal.ts';

type DocumentPanelProps = Omit<ComponentProps<typeof EditorPanel>, 'hidden'> &
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
 * Command-E is heard on the window rather than in the editor, because it has to
 * work from the chat and with nothing focused, and in Read the editor cannot
 * hear anything. The panel is mounted exactly when a document is open, which is
 * exactly when the key means something.
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
        if (!isToggleReadKey(event)) return;
        event.preventDefault();
        onMode(toggleRead);
      }
      window.addEventListener('keydown', handleKey);
      return function () {
        window.removeEventListener('keydown', handleKey);
      };
    },
    [onMode],
  );

  return (
    <>
      <div className="min-h-0 flex-1">
        <EditorPanel {...editor} findings={findings} hidden={mode === 'read'} />
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
