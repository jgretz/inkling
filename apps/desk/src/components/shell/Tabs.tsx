import {useCallback, useRef} from 'react';
import type {KeyboardEvent} from 'react';

/** One tab: what it is called, and what happened behind it while it was away. */
export type TabEntry<Id extends string = string> = {
  id: Id;
  label: string;
  /**
   * Something that arrived behind this tab, said out loud.
   *
   * It extends the tab's accessible name rather than only drawing a dot,
   * because a dot is not something a screen reader can be told about.
   */
  note?: string;
};

type TabsProps<Id extends string> = {
  tabs: readonly TabEntry<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  /** The tablist's accessible name. */
  label: string;
  /** A `useId()` from the caller, so two panels on screen cannot collide. */
  idPrefix: string;
};

/** The id of a tab, which its panel points back at with `aria-labelledby`. */
export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/** The id of a tab's panel, which the tab points at with `aria-controls`. */
export function panelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

/** Which way each arrow key moves along the list. */
const STEP: Record<string, number> = {ArrowLeft: -1, ArrowRight: 1};

/**
 * A tab set, with the keyboard contract a tab set is supposed to have.
 *
 * Roving `tabIndex`: only the selected tab is in the page's tab order, and the
 * arrows move within the set. Tabbing through a panel should pass the whole
 * set once, not once per tab.
 *
 * Selection and focus move together, which is what makes the arrows readable:
 * the writer is moving between panels, not shopping for one to press.
 */
export function Tabs<Id extends string>({
  tabs,
  selected,
  onSelect,
  label,
  idPrefix,
}: TabsProps<Id>) {
  const buttons = useRef(new Map<Id, HTMLButtonElement>());

  const handleKey = useCallback(
    function (event: KeyboardEvent<HTMLDivElement>) {
      const step = STEP[event.key];
      if (step === undefined) return;
      const at = tabs.findIndex(function (entry) {
        return entry.id === selected;
      });
      if (at === -1) return;
      // Wrapping, rather than stopping at the ends: two tabs make either arrow
      // the same gesture, and a set that stopped would answer half of them.
      const next = tabs[(at + step + tabs.length) % tabs.length];
      if (next === undefined) return;
      event.preventDefault();
      onSelect(next.id);
      buttons.current.get(next.id)?.focus();
    },
    [tabs, selected, onSelect],
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKey}
      className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-3"
    >
      {tabs.map(function (entry) {
        const active = entry.id === selected;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={tabId(idPrefix, entry.id)}
            // Only the selected tab claims a panel. A caller that mounts one
            // panel at a time has nothing for the others to point at, and an
            // `aria-controls` naming an element that is not there is a promise
            // to a screen reader that cannot be kept.
            aria-controls={active ? panelId(idPrefix, entry.id) : undefined}
            aria-selected={active}
            aria-label={entry.note === undefined ? undefined : `${entry.label}, ${entry.note}`}
            tabIndex={active ? 0 : -1}
            ref={function (node) {
              if (node === null) buttons.current.delete(entry.id);
              else buttons.current.set(entry.id, node);
            }}
            onClick={function () {
              onSelect(entry.id);
            }}
            className={`-mb-px flex items-center gap-1.5 border-b px-1.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors duration-100 ${
              active
                ? 'border-accent text-ink-200'
                : 'border-transparent text-ink-500 hover:text-ink-300'
            }`}
          >
            {entry.label}
            {entry.note !== undefined && (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
