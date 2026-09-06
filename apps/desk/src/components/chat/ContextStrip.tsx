import {useCallback, useState} from 'react';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import Plus from 'lucide-react/dist/esm/icons/plus';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import X from 'lucide-react/dist/esm/icons/x';
import {groupName, type DocSummary, type GroupPath} from '@inkling/vault';
import {contextTokens, estimateTokens, type AgentContext} from '../../lib/agent.ts';
import type {ContextReference} from '../../lib/references.ts';
import type {AttachRequest, BulkAttachRequest} from '../../lib/use-references.ts';
import {LinkPasteField} from './LinkPasteField.tsx';
import {ReferencePicker} from './ReferencePicker.tsx';

/** Everything the strip needs to change what the next turn will carry. */
export type ReferenceControls = {
  /** Every document in the vault, which is what the picker offers. */
  docs: readonly DocSummary[];
  /** The open document's nearest group, when it is in one. */
  group: GroupPath | undefined;
  /** False when there is no vault database, which is where a reference lives. */
  canAttach: boolean;
  onAttach: (request: AttachRequest) => void;
  /** A whole paste at once. Resolves when the write landed, so the field can clear. */
  onAttachMany: (request: BulkAttachRequest) => Promise<unknown>;
  /** Deletes a reference the open document owns. */
  onDetach: (entry: ContextReference) => void;
  /** Turns an inherited reference off for the open document only. */
  onSuppress: (entry: ContextReference) => void;
  onRestore: (entry: ContextReference) => void;
};

type ContextStripProps = {
  context: AgentContext;
  references: ReferenceControls;
};

/** Which way of attaching the writer opened. Neither is a mode; both close on cancel. */
type Gesture = 'reference' | 'paste';

/** One word on why an entry carries nothing, when it carries nothing. */
type EntryState = 'missing' | 'off';

type EntryRowProps = {
  label: string;
  tokens: number;
  /** The group an inherited reference came from. */
  from?: string;
  state?: EntryState;
  action?: {label: string; kind: 'remove' | 'restore'; onClick: () => void};
};

/**
 * One thing the turn will carry, with what it costs.
 *
 * A full-width row rather than a pill: the tab is as tall as the panel now, so
 * a title has room to wrap and be read whole, where a pill on a wrapped line
 * could only truncate it and leave four references sharing one visible prefix.
 *
 * The token count is last in the row's text on purpose: it is the number the
 * header claims to total, and a reader (or a test) parsing the row should find
 * it in the same place on every one of them.
 */
function EntryRow({label, tokens, from, state, action}: EntryRowProps) {
  const Icon = action?.kind === 'restore' ? RotateCcw : X;

  return (
    <li
      className={`flex items-baseline gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-ink-900 ${
        state === undefined ? 'text-ink-300' : 'text-ink-500'
      }`}
    >
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
      {from !== undefined && <span className="shrink-0 text-[10px] text-ink-600">from {from}</span>}
      {state !== undefined && (
        <span className="shrink-0 text-[10px] text-voice-mark-strong">{state}</span>
      )}
      <span className="shrink-0 tabular-nums text-[10px] text-ink-600">
        {tokens.toLocaleString()}
      </span>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          className="shrink-0 self-center rounded-full p-0.5 text-ink-600 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-200"
        >
          <Icon size={10} aria-hidden />
        </button>
      )}
    </li>
  );
}

/** Why a reference carries nothing, when it carries nothing. */
function stateOf(entry: ContextReference): EntryState | undefined {
  if (entry.suppressedBy !== undefined) return 'off';
  if (entry.missing) return 'missing';
  return undefined;
}

/**
 * What the writer would be undoing, said out loud.
 *
 * An inherited reference is never deleted from here: the group owns it and
 * other documents are reading it, so this turns it off for the open document
 * and says which group it is still attached to. Detaching is only ever the
 * document's own.
 */
function actionFor(
  entry: ContextReference,
  controls: ReferenceControls,
): NonNullable<EntryRowProps['action']> {
  if (entry.origin.level === 'document') {
    return {
      label: `Detach ${entry.title} from this document`,
      kind: 'remove',
      onClick: function () {
        controls.onDetach(entry);
      },
    };
  }
  const group = groupName(entry.origin.group);
  if (entry.suppressedBy !== undefined) {
    return {
      label: `Restore ${entry.title}, inherited from ${group}`,
      kind: 'restore',
      onClick: function () {
        controls.onRestore(entry);
      },
    };
  }
  return {
    label: `Turn off ${entry.title}, inherited from ${group}`,
    kind: 'remove',
    onClick: function () {
      controls.onSuppress(entry);
    },
  };
}

/**
 * What the agent will be sent, on a tab of its own.
 *
 * This is the app's honesty surface: the writer should never have to guess
 * which of their documents is about to leave the machine, so everything in the
 * turn's context appears here with its own token cost. That includes what a
 * group above the document attached, which the row names, and what this
 * document turned off, which stays visible at zero rather than disappearing.
 *
 * It fills the height it is given: the header and the attach forms stay put and
 * only the entries scroll, so the total is readable however long the list gets.
 * The always-visible summary above the composer is what carries the same
 * promise back to the writer while they are on the other tab.
 */
export function ContextStrip({context, references}: ContextStripProps) {
  /** Which gesture is open, if either. Two buttons, one form at a time. */
  const [open, setOpen] = useState<Gesture | undefined>(undefined);
  const total = contextTokens(context);
  const empty =
    context.doc === undefined && context.selection === undefined && context.references.length === 0;

  const openPicker = useCallback(function () {
    setOpen('reference');
  }, []);
  const openPaste = useCallback(function () {
    setOpen('paste');
  }, []);
  const close = useCallback(function () {
    setOpen(undefined);
  }, []);

  const handleAttach = useCallback(
    function (request: AttachRequest) {
      references.onAttach(request);
      setOpen(undefined);
    },
    [references],
  );

  return (
    <div className="flex h-full min-w-0 flex-col px-3 py-2">
      <div className="mb-1.5 flex shrink-0 items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-ink-600">Context</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-ink-600">
            ~{total.toLocaleString()} tokens
          </span>
          {references.canAttach && open === undefined && (
            <>
              <button
                type="button"
                onClick={openPicker}
                aria-label="Attach a reference"
                className="rounded p-0.5 text-ink-600 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200"
              >
                <Plus size={12} aria-hidden />
              </button>
              <button
                type="button"
                onClick={openPaste}
                aria-label="Paste a set of links"
                className="rounded p-0.5 text-ink-600 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200"
              >
                <ClipboardList size={12} aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>

      {/* The form stays where it was opened while the list scrolls under it.
          The paste field is left open after a write, unlike the picker: a paste
          that landed clears the textarea itself, and the writer often has a
          second set to add. */}
      {open !== undefined && (
        <div className="shrink-0">
          {open === 'reference' ? (
            <ReferencePicker
              docs={references.docs}
              group={references.group}
              onSubmit={handleAttach}
              onCancel={close}
            />
          ) : (
            <LinkPasteField
              group={references.group}
              onSubmit={references.onAttachMany}
              onCancel={close}
            />
          )}
        </div>
      )}

      {empty ? (
        <p className="shrink-0 text-[11px] text-ink-600">Nothing attached</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {context.doc !== undefined && (
            <EntryRow label={context.doc.title} tokens={estimateTokens(context.doc.source)} />
          )}
          {context.selection !== undefined && (
            <EntryRow label="Selection" tokens={estimateTokens(context.selection.quote)} />
          )}
          {context.references.map(function (entry) {
            return (
              <EntryRow
                key={entry.id}
                label={entry.title}
                tokens={entry.tokens}
                from={entry.origin.level === 'group' ? groupName(entry.origin.group) : undefined}
                state={stateOf(entry)}
                action={actionFor(entry, references)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
