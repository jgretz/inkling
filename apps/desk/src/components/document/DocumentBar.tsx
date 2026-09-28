import type {ReactNode} from 'react';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Code from 'lucide-react/dist/esm/icons/code';
import Type from 'lucide-react/dist/esm/icons/type';
import {DOC_MODES, type DocMode} from '../../lib/doc-mode.ts';
import {Toggle} from '../shell/Toggle.tsx';

const MODE_BUTTON: Record<DocMode, {label: string; hint: string; Icon: typeof Type}> = {
  live: {label: 'Live', hint: 'Live (⌘⇧E switches to Source)', Icon: Type},
  source: {label: 'Source', hint: 'Source (⌘⇧E switches to Live)', Icon: Code},
  read: {label: 'Read', hint: 'Read (⌘E toggles)', Icon: BookOpen},
};

type DocumentBarProps = {
  mode: DocMode;
  onShow: (mode: DocMode) => void;
  /** The left slot, where the formatting toolbar goes. */
  children?: ReactNode;
};

/**
 * The strip above the document, with the mode switch in its middle.
 *
 * A grid with equal outer tracks rather than a centered flex row, so the switch
 * stays over the middle of the document column whatever the left slot holds.
 */
export function DocumentBar({mode, onShow, children}: DocumentBarProps) {
  return (
    <header className="grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-ink-800 bg-ink-950 px-2">
      <div className="flex min-w-0 items-center gap-0.5">{children}</div>
      <div role="group" aria-label="Document mode" className="flex items-center gap-0.5">
        {DOC_MODES.map(function (m) {
          const {label, hint, Icon} = MODE_BUTTON[m];
          return (
            <Toggle
              key={m}
              active={mode === m}
              label={label}
              hint={hint}
              onClick={function () {
                onShow(m);
              }}
            >
              <Icon size={15} />
            </Toggle>
          );
        })}
      </div>
      <div />
    </header>
  );
}
