import X from 'lucide-react/dist/esm/icons/x';
import type {DocPath} from '@inkling/vault';
import {contextTokens, estimateTokens, type AgentContext} from '../../lib/agent.ts';

type ContextStripProps = {
  context: AgentContext;
  onUnpin: (path: DocPath) => void;
};

type ChipProps = {
  label: string;
  tokens: number;
  onRemove?: () => void;
};

function Chip({label, tokens, onRemove}: ChipProps) {
  return (
    <span className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-ink-800 py-0.5 pl-2 pr-1.5 text-[10px] text-ink-300">
      <span className="truncate">{label}</span>
      <span className="tabular-nums text-ink-600">{tokens.toLocaleString()}</span>
      {onRemove !== undefined && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} from context`}
          className="rounded-full p-0.5 text-ink-600 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-200"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

/**
 * What the agent will be sent, shown above the composer.
 *
 * This is the app's honesty surface: the writer should never have to guess
 * which of their documents is about to leave the machine, so everything in the
 * turn's context appears here with its own token cost.
 */
export function ContextStrip({context, onUnpin}: ContextStripProps) {
  const total = contextTokens(context);
  const empty =
    context.doc === undefined && context.selection === undefined && context.pinned.length === 0;

  return (
    <div className="shrink-0 border-t border-ink-800 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-ink-600">Context</span>
        <span className="text-[10px] tabular-nums text-ink-600">
          ~{total.toLocaleString()} tokens
        </span>
      </div>

      {empty ? (
        <p className="text-[11px] text-ink-600">Nothing attached</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {context.doc !== undefined && (
            <Chip label={context.doc.title} tokens={estimateTokens(context.doc.source)} />
          )}
          {context.selection !== undefined && (
            <Chip label="Selection" tokens={estimateTokens(context.selection)} />
          )}
          {context.pinned.map(function (entry) {
            return (
              <Chip
                key={entry.path}
                label={entry.title}
                tokens={estimateTokens(entry.source)}
                onRemove={function () {
                  onUnpin(entry.path);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
