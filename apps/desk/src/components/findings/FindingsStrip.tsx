import {useCallback, useMemo, useState} from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import X from 'lucide-react/dist/esm/icons/x';
import type {Finding} from '@inkling/voice';
import {groupFindings, ruleLabel, snippet, type RuleGroup} from '../../lib/voice-rules.ts';

/**
 * A dismissed finding, with whatever identifies the dismissal to the caller.
 *
 * Structural rather than the app's own `Dismissal`: the strip needs nothing
 * from a stored row but the handle it hands back to `onRestore`.
 */
export type DismissedFinding = {
  finding: Finding;
  by: {id: number};
};

type FindingsStripProps = {
  findings: readonly Finding[];
  onPick: (finding: Finding) => void;
  /** Findings the writer dismissed, listed in a trailing group. */
  suppressed?: ReadonlyArray<DismissedFinding>;
  /** Omitted by a caller with nowhere to store a dismissal; the row then has no button. */
  onDismiss?: (finding: Finding) => void;
  onRestore?: (entry: DismissedFinding) => void;
};

const ROW_BUTTON =
  'block w-full px-3 py-1.5 pl-[1.9rem] text-left transition-colors duration-100 hover:bg-ink-900';

const ACTION_BUTTON =
  'shrink-0 px-2 text-ink-600 transition-colors duration-100 hover:bg-ink-900 hover:text-ink-200';

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

type GroupHeaderProps = {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
};

function GroupHeader({label, count, open, onToggle}: GroupHeaderProps) {
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] text-ink-300 transition-colors duration-100 hover:bg-ink-900"
    >
      <Chevron size={12} className="shrink-0 text-ink-600" aria-hidden />
      <span className="truncate">{label}</span>
      <span className="tabular-nums text-ink-600">{count}</span>
    </button>
  );
}

type EntryProps = {
  finding: Finding;
  /** The second line of the row: what to do about it, or which rule raised it. */
  detail: string;
  onPick: (finding: Finding) => void;
  action?: {kind: 'dismiss' | 'restore'; onClick: () => void};
};

/**
 * One finding, as a button that reveals it plus at most one action.
 *
 * The action's label names the rule as well as the verb, because the row's own
 * text is the flagged quote and a screen reader reaching a bare "Dismiss" would
 * have nothing to attach it to.
 */
function Entry({finding, detail, onPick, action}: EntryProps) {
  const {before, quote, after} = snippet(finding.anchor);
  const label = ruleLabel(finding.ruleId);
  const Icon = action?.kind === 'restore' ? RotateCcw : X;

  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={function () {
          onPick(finding);
        }}
        className={`min-w-0 flex-1 ${ROW_BUTTON}`}
      >
        <span className="block truncate font-mono text-[11px] text-ink-400">
          {before}
          <span className="text-ink-100 underline decoration-[var(--color-voice-mark-strong)] underline-offset-2">
            {quote}
          </span>
          {after}
        </span>
        <span className="block truncate text-[11px] text-ink-600">{detail}</span>
      </button>

      {action !== undefined && (
        <button
          type="button"
          aria-label={action.kind === 'dismiss' ? `Dismiss this ${label}` : `Restore this ${label}`}
          onClick={action.onClick}
          className={`self-stretch ${ACTION_BUTTON}`}
        >
          <Icon size={12} aria-hidden />
        </button>
      )}
    </li>
  );
}

type GroupProps = {
  group: RuleGroup;
  open: boolean;
  onToggle: (ruleId: string) => void;
  onPick: (finding: Finding) => void;
  onDismiss?: (finding: Finding) => void;
};

function Group({group, open, onToggle, onPick, onDismiss}: GroupProps) {
  return (
    <li>
      <GroupHeader
        label={group.label}
        count={group.findings.length}
        open={open}
        onToggle={function () {
          onToggle(group.ruleId);
        }}
      />

      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-ink-800/60">
          {group.findings.map(function (finding) {
            return (
              <Entry
                key={`${finding.ruleId}:${finding.range.start}:${finding.range.end}`}
                finding={finding}
                detail={finding.explain}
                onPick={onPick}
                action={
                  onDismiss === undefined
                    ? undefined
                    : {
                        kind: 'dismiss',
                        onClick: function () {
                          onDismiss(finding);
                        },
                      }
                }
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

type DismissedGroupProps = {
  entries: ReadonlyArray<DismissedFinding>;
  open: boolean;
  onToggle: () => void;
  onPick: (finding: Finding) => void;
  onRestore?: (entry: DismissedFinding) => void;
};

/**
 * The findings the writer silenced, in one trailing group rather than one per
 * rule.
 *
 * Without it, a dismissal is invisible and deleting `.inkling/` is the only way
 * back. Each row names its rule on its second line, since the grouping that
 * would otherwise say so is gone.
 */
function DismissedGroup({entries, open, onToggle, onPick, onRestore}: DismissedGroupProps) {
  return (
    <li>
      <GroupHeader label="Dismissed" count={entries.length} open={open} onToggle={onToggle} />

      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-ink-800/60">
          {entries.map(function (entry) {
            return (
              <Entry
                key={entry.by.id}
                finding={entry.finding}
                detail={ruleLabel(entry.finding.ruleId)}
                onPick={onPick}
                action={
                  onRestore === undefined
                    ? undefined
                    : {
                        kind: 'restore',
                        onClick: function () {
                          onRestore(entry);
                        },
                      }
                }
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * Every voice finding in the open document, grouped by rule.
 *
 * This is the accessible surface and the keyboard surface. The marks in the
 * editor are an underline with no attributes on it, so this list of real buttons
 * is where the rule, the flagged text and the explain are actually readable, and
 * where a keyboard reaches them.
 *
 * Groups start collapsed and there is no empty state. At the density the example
 * vault reaches, 57 findings across 4 rules, an expanded strip is 57 rows and
 * the per-rule counts are the summary a writer reads first. A clean document
 * renders nothing at all rather than an encouraging message, so it costs no
 * layout.
 *
 * A document with nothing left to show but dismissals still renders, because a
 * dismissal the writer cannot see is one they cannot undo.
 *
 * No `aria-live`: this is a region to read or tab into, not an announcer, and
 * its contents change on every keystroke.
 */
export function FindingsStrip({
  findings,
  onPick,
  suppressed = [],
  onDismiss,
  onRestore,
}: FindingsStripProps) {
  const [openRules, setOpenRules] = useState<readonly string[]>([]);
  // Its own flag rather than a sentinel in `openRules`, which holds rule ids:
  // the dismissed group answers to no rule and would collide with one named
  // after it.
  const [dismissedOpen, setDismissedOpen] = useState(false);

  const groups = useMemo(
    function () {
      return groupFindings(findings);
    },
    [findings],
  );

  const toggle = useCallback(function (ruleId: string) {
    setOpenRules(function (current) {
      return current.includes(ruleId)
        ? current.filter(function (entry) {
            return entry !== ruleId;
          })
        : [...current, ruleId];
    });
  }, []);

  const toggleDismissed = useCallback(function () {
    setDismissedOpen(function (open) {
      return !open;
    });
  }, []);

  if (findings.length === 0 && suppressed.length === 0) return null;

  return (
    <section
      aria-label="Voice findings"
      className="shrink-0 border-t border-ink-800 bg-ink-950 text-ink-300"
    >
      {findings.length > 0 && (
        <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-600">
          {plural(findings.length, 'finding')} in {plural(groups.length, 'rule')}
        </p>
      )}

      <ul className="max-h-64 overflow-y-auto border-t border-ink-800/60">
        {groups.map(function (group) {
          return (
            <Group
              key={group.ruleId}
              group={group}
              open={openRules.includes(group.ruleId)}
              onToggle={toggle}
              onPick={onPick}
              onDismiss={onDismiss}
            />
          );
        })}

        {suppressed.length > 0 && (
          <DismissedGroup
            entries={suppressed}
            open={dismissedOpen}
            onToggle={toggleDismissed}
            onPick={onPick}
            onRestore={onRestore}
          />
        )}
      </ul>
    </section>
  );
}
