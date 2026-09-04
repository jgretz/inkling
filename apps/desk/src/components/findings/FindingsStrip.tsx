import {useCallback, useMemo, useState} from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type {Finding} from '@inkling/voice';
import {groupFindings, snippet, type RuleGroup} from '../../lib/voice-rules.ts';

type FindingsStripProps = {
  findings: readonly Finding[];
  onPick: (finding: Finding) => void;
};

type GroupProps = {
  group: RuleGroup;
  open: boolean;
  onToggle: (ruleId: string) => void;
  onPick: (finding: Finding) => void;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function Group({group, open, onToggle, onPick}: GroupProps) {
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={function () {
          onToggle(group.ruleId);
        }}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] text-ink-300 transition-colors duration-100 hover:bg-ink-900"
      >
        <Chevron size={12} className="shrink-0 text-ink-600" aria-hidden />
        <span className="truncate">{group.label}</span>
        <span className="tabular-nums text-ink-600">{group.findings.length}</span>
      </button>

      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-ink-800/60">
          {group.findings.map(function (finding) {
            const {before, quote, after} = snippet(finding.anchor);
            return (
              <li key={`${finding.ruleId}:${finding.range.start}:${finding.range.end}`}>
                <button
                  type="button"
                  onClick={function () {
                    onPick(finding);
                  }}
                  className="block w-full px-3 py-1.5 pl-[1.9rem] text-left transition-colors duration-100 hover:bg-ink-900"
                >
                  <span className="block truncate font-mono text-[11px] text-ink-400">
                    {before}
                    <span className="text-ink-100 underline decoration-[var(--color-voice-mark-strong)] underline-offset-2">
                      {quote}
                    </span>
                    {after}
                  </span>
                  <span className="block truncate text-[11px] text-ink-600">{finding.explain}</span>
                </button>
              </li>
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
 * No `aria-live`: this is a region to read or tab into, not an announcer, and
 * its contents change on every keystroke.
 */
export function FindingsStrip({findings, onPick}: FindingsStripProps) {
  const [openRules, setOpenRules] = useState<readonly string[]>([]);

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

  if (findings.length === 0) return null;

  return (
    <section
      aria-label="Voice findings"
      className="shrink-0 border-t border-ink-800 bg-ink-950 text-ink-300"
    >
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-600">
        {plural(findings.length, 'finding')} in {plural(groups.length, 'rule')}
      </p>

      <ul className="max-h-64 overflow-y-auto border-t border-ink-800/60">
        {groups.map(function (group) {
          return (
            <Group
              key={group.ruleId}
              group={group}
              open={openRules.includes(group.ruleId)}
              onToggle={toggle}
              onPick={onPick}
            />
          );
        })}
      </ul>
    </section>
  );
}
