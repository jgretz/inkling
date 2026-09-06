import {memo} from 'react';
import type {ReactNode} from 'react';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Columns from 'lucide-react/dist/esm/icons/columns-2';
import Library from 'lucide-react/dist/esm/icons/library';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import PenLine from 'lucide-react/dist/esm/icons/pen-line';
import Pin from 'lucide-react/dist/esm/icons/pin';
import SpellCheck from 'lucide-react/dist/esm/icons/spell-check';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import type {FrontmatterChoice} from '../../lib/export.ts';
import type {LayoutSettings, ToggleKey} from '../../lib/settings.ts';
import {indicatorLabel, type TurnIndicator} from '../../lib/turn.ts';
import type {SaveState} from '../../lib/workspace-state.ts';
import {DocMenu} from './DocMenu.tsx';

type TitleBarProps = {
  title: string;
  subtitle: string;
  save: SaveState | undefined;
  layout: LayoutSettings;
  onToggle: (key: ToggleKey) => void;
  /** Whose turn it is, or that a write is in flight. See `lib/turn.ts`. */
  turn: TurnIndicator;
  /** Whether a manual pin, rather than the focus rule, put it there. */
  pinned: boolean;
  /** Cycles the pin: unpinned, the writer's turn, the agent's, unpinned. */
  onPin: () => void;
  /** Writes the open document to a file the writer picks. */
  onExport: (choice: FrontmatterChoice) => void;
  /** Puts the open document on the clipboard as HTML and plain text at once. */
  onCopy: () => void;
  /** Keeps the open document as it stands, as its next revision. */
  onSnapshot: () => void;
  /** Opens the panel that reads the kept revisions back. */
  onOpenRevisions: () => void;
  /** Whether there is a document to export, copy or keep a revision of at all. */
  docOpen: boolean;
};

const SAVE_LABEL: Record<SaveState['kind'], string> = {
  clean: 'Saved',
  dirty: 'Unsaved',
  saving: 'Saving…',
  failed: 'Save failed',
};

const TURN_LABEL: Record<TurnIndicator, string> = {
  writer: 'You',
  agent: 'Agent',
  landing: 'Writing…',
};

type ToggleProps = {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
};

const Toggle = memo(function Toggle({active, label, onClick, children}: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`rounded-md p-1.5 transition-colors duration-100 ${
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
});

/**
 * The window's own chrome. `titleBarStyle: Overlay` hides the system bar, so
 * this strip is both the app header and the window's drag region; the left pad
 * clears the traffic lights.
 */
export function TitleBar({
  title,
  subtitle,
  save,
  layout,
  onToggle,
  turn,
  pinned,
  onPin,
  onExport,
  onCopy,
  onSnapshot,
  onOpenRevisions,
  docOpen,
}: TitleBarProps) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-950 pl-20 pr-3"
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[13px] font-medium text-ink-100">{title}</span>
        <span className="truncate text-[11px] text-ink-400">{subtitle}</span>
      </div>

      {save !== undefined && (
        <span
          className={`text-[11px] tabular-nums ${
            save.kind === 'failed' ? 'text-red-400' : 'text-ink-400'
          }`}
          title={save.kind === 'failed' ? save.message : undefined}
        >
          {SAVE_LABEL[save.kind]}
        </span>
      )}

      {/* The whole state is in the accessible name, not only in the icon: the
          three states differ by which of two people may write next, which is
          not a thing a glyph can say on its own. */}
      <button
        type="button"
        onClick={onPin}
        aria-label={indicatorLabel(turn, pinned)}
        title={indicatorLabel(turn, pinned)}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors duration-100 ${
          turn === 'agent' || turn === 'landing'
            ? 'bg-accent-muted/20 text-accent'
            : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
        }`}
      >
        {turn === 'writer' ? <PenLine size={13} aria-hidden /> : <Sparkles size={13} aria-hidden />}
        <span>{TURN_LABEL[turn]}</span>
        {pinned && <Pin size={10} aria-hidden />}
      </button>

      <DocMenu
        onExport={onExport}
        onCopy={onCopy}
        onSnapshot={onSnapshot}
        onOpenRevisions={onOpenRevisions}
        disabled={!docOpen}
      />

      <div className="flex items-center gap-0.5">
        <Toggle
          active={layout.libraryOpen}
          label="Toggle library"
          onClick={function () {
            onToggle('libraryOpen');
          }}
        >
          <Library size={15} />
        </Toggle>
        <Toggle
          active={layout.previewOpen}
          label="Toggle preview"
          onClick={function () {
            onToggle('previewOpen');
          }}
        >
          <BookOpen size={15} />
        </Toggle>
        <Toggle
          active={layout.chatOpen}
          label="Toggle agent"
          onClick={function () {
            onToggle('chatOpen');
          }}
        >
          <MessageSquare size={15} />
        </Toggle>
        <Toggle
          active={layout.marksOn}
          label="Toggle voice marks"
          onClick={function () {
            onToggle('marksOn');
          }}
        >
          <SpellCheck size={15} />
        </Toggle>
        <span className="mx-1 h-4 w-px bg-ink-800" />
        <Columns size={15} className="text-ink-600" aria-hidden />
      </div>
    </header>
  );
}
