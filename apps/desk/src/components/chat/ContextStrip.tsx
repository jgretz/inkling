import {useCallback, useState} from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import X from 'lucide-react/dist/esm/icons/x';
import {groupName, type DocSummary, type GroupPath} from '@inkling/vault';
import {contextTokens, estimateTokens, type AgentContext} from '../../lib/agent.ts';
import type {ContextReference} from '../../lib/references.ts';
import type {AttachRequest} from '../../lib/use-references.ts';
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

/** One word on why a chip carries nothing, when it carries nothing. */
type ChipState = 'missing' | 'off';

type ChipProps = {
  label: string;
  tokens: number;
  /** The group an inherited reference came from. */
  from?: string;
  state?: ChipState;
  action?: {label: string; kind: 'remove' | 'restore'; onClick: () => void};
};

/**
 * One thing the turn will carry, with what it costs.
 *
 * The token count is last in the chip's text on purpose: it is the number the
 * header claims to total, and a reader (or a test) parsing the chip should find
 * it in the same place on every one of them.
 */
function Chip({label, tokens, from, state, action}: ChipProps) {
  const Icon = action?.kind === 'restore' ? RotateCcw : X;

  return (
    <li
      className={`inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-ink-800 py-0.5 pl-2 pr-1.5 text-[10px] ${
        state === undefined ? 'text-ink-300' : 'text-ink-500'
      }`}
    >
      <span className="truncate">{label}</span>
      {from !== undefined && <span className="shrink-0 text-ink-600">from {from}</span>}
      {state !== undefined && <span className="shrink-0 text-voice-mark-strong">{state}</span>}
      <span className="tabular-nums text-ink-600">{tokens.toLocaleString()}</span>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          className="rounded-full p-0.5 text-ink-600 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-200"
        >
          <Icon size={10} aria-hidden />
        </button>
      )}
    </li>
  );
}

/** Why a reference carries nothing, when it carries nothing. */
function stateOf(entry: ContextReference): ChipState | undefined {
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
): NonNullable<ChipProps['action']> {
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
 * What the agent will be sent, shown above the composer.
 *
 * This is the app's honesty surface: the writer should never have to guess
 * which of their documents is about to leave the machine, so everything in the
 * turn's context appears here with its own token cost. That includes what a
 * group above the document attached, which the chip names, and what this
 * document turned off, which stays visible at zero rather than disappearing.
 */
export function ContextStrip({context, references}: ContextStripProps) {
  const [picking, setPicking] = useState(false);
  const total = contextTokens(context);
  const empty =
    context.doc === undefined && context.selection === undefined && context.references.length === 0;

  const openPicker = useCallback(function () {
    setPicking(true);
  }, []);
  const closePicker = useCallback(function () {
    setPicking(false);
  }, []);

  const handleAttach = useCallback(
    function (request: AttachRequest) {
      references.onAttach(request);
      setPicking(false);
    },
    [references],
  );

  return (
    <div className="shrink-0 border-t border-ink-800 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-ink-600">Context</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-ink-600">
            ~{total.toLocaleString()} tokens
          </span>
          {references.canAttach && !picking && (
            <button
              type="button"
              onClick={openPicker}
              aria-label="Attach a reference"
              className="rounded p-0.5 text-ink-600 transition-colors duration-100 hover:bg-ink-800 hover:text-ink-200"
            >
              <Plus size={12} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {picking && (
        <ReferencePicker
          docs={references.docs}
          group={references.group}
          onSubmit={handleAttach}
          onCancel={closePicker}
        />
      )}

      {empty ? (
        <p className="text-[11px] text-ink-600">Nothing attached</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {context.doc !== undefined && (
            <Chip label={context.doc.title} tokens={estimateTokens(context.doc.source)} />
          )}
          {context.selection !== undefined && (
            <Chip label="Selection" tokens={estimateTokens(context.selection)} />
          )}
          {context.references.map(function (entry) {
            return (
              <Chip
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
