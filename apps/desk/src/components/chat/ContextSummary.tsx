import {contextTokens, type AgentContext} from '../../lib/agent.ts';

type ContextSummaryProps = {
  context: AgentContext;
  /** Opens the tab the accounting itself is on. */
  onShow: () => void;
};

/**
 * One line of accounting, on every tab, above the message box.
 *
 * The context is a tab now, and a tab can be looked away from. This is what
 * keeps the promise while it is: the writer composing a turn is told how much
 * of their work is about to leave the machine without having to go and look,
 * and pressing the line takes them to the itemised version.
 */
export function ContextSummary({context, onShow}: ContextSummaryProps) {
  const count = context.references.length;
  const total = contextTokens(context);
  const noun = count === 1 ? 'reference' : 'references';

  return (
    <button
      type="button"
      onClick={onShow}
      // The visible text is a tally; the name says what the tally is of and
      // what pressing it does, neither of which the tally alone tells anyone.
      aria-label={`What the agent can see: ${count.toLocaleString()} ${noun}, about ${total.toLocaleString()} tokens. Show the context tab.`}
      className="mb-1 flex w-full items-center gap-1 px-1 text-left text-[10px] tabular-nums text-ink-600 transition-colors duration-100 hover:text-ink-300"
    >
      {count.toLocaleString()} {noun}, ~{total.toLocaleString()} tokens
    </button>
  );
}
