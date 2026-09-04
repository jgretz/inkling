import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {useCallback, useState} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import {check, type Finding} from '@inkling/voice';
import {EditorPanel, type Reveal} from '../src/components/editor/EditorPanel.tsx';
import {FindingsStrip} from '../src/components/findings/FindingsStrip.tsx';
import {useFindings} from '../src/lib/use-findings.ts';

autoCleanup();

const MIXED = 'A sentence — with an em dash and a hyphen - too.';
const CLEAN = 'Plain prose with nothing wrong in it at all.';

/**
 * The editor and the strip, wired the way `App.tsx` wires them.
 *
 * A harness rather than `App` itself: `App` owns a vault, a settings file and a
 * Tauri bridge, none of which this behaviour depends on. What it does mirror
 * exactly is the arrangement under test, the pick callback and the wrapper the
 * editor sits in, so the layout assertion below means something.
 */
function Harness({
  source,
  marksOn = true,
  path = 'drafts/a.md',
}: {
  source: string;
  marksOn?: boolean;
  path?: string;
}) {
  const findings = useFindings(source);
  const [reveal, setReveal] = useState<Reveal | undefined>(undefined);

  const handlePick = useCallback(function (finding: Finding) {
    setReveal(function (current) {
      return {range: finding.range, seq: (current?.seq ?? 0) + 1};
    });
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <EditorPanel
          path={path}
          source={source}
          onChange={function () {}}
          onSelect={function () {}}
          onSave={function () {}}
          findings={findings}
          marksOn={marksOn}
          reveal={reveal}
        />
      </div>
      <FindingsStrip findings={findings} onPick={handlePick} />
    </div>
  );
}

function marks(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.cm-voice-finding')];
}

/** The fixture's finding for a rule, which is what the assertions compare to. */
function flagged(ruleId: string): Finding {
  const finding = check(MIXED).find(function (candidate) {
    return candidate.ruleId === ruleId;
  });
  if (finding === undefined) throw new Error(`the fixture produced no ${ruleId} finding`);
  return finding;
}

/** Expand the group with this label and hand back the entry buttons inside it. */
function expand(container: HTMLElement, label: string): HTMLElement[] {
  const header = [...container.querySelectorAll<HTMLElement>('button[aria-expanded]')].find(
    function (candidate) {
      return candidate.textContent?.startsWith(label) === true;
    },
  );
  if (header === undefined) throw new Error(`no group is labelled ${label}`);

  fireEvent.click(header);

  return [...(header.closest('li')?.querySelectorAll<HTMLElement>('ul button') ?? [])];
}

describe('findings in the editor', function () {
  it('should underline each finding once, with the flagged text inside it', function () {
    const {container} = render(<Harness source={MIXED} />);

    expect(
      marks(container).map(function (span) {
        return span.textContent;
      }),
    ).toEqual(['—', '-']);
  });

  it('should give the marks no accessibility attributes of their own', function () {
    // Deliberate. The span wraps prose that is already in the document, so a
    // screen reader reads it unchanged and no keystroke announces anything. The
    // strip is where the rule and the explain are readable.
    const {container} = render(<Harness source={MIXED} />);

    marks(container).forEach(function (span) {
      expect(span.getAttribute('title')).toBeNull();
      expect(span.getAttribute('aria-label')).toBeNull();
      expect(span.getAttribute('role')).toBeNull();
    });
  });

  it('should draw no marks when they are toggled off, and still list them', function () {
    const {container, getByText} = render(<Harness source={MIXED} marksOn={false} />);

    expect(marks(container)).toHaveLength(0);
    expect(getByText('2 findings in 2 rules')).toBeDefined();
    expect(getByText('Em dash')).toBeDefined();
    expect(getByText('Spaced hyphen')).toBeDefined();
  });

  it('should move the editor selection onto the finding a strip entry names', function () {
    const {container} = render(<Harness source={MIXED} />);
    const view = EditorView.findFromDOM(container as HTMLElement);
    if (view === null) throw new Error('the editor view did not mount');

    const entry = expand(container, 'Spaced hyphen')[0];
    if (entry === undefined) throw new Error('the expanded group listed no entry');
    fireEvent.click(entry);

    const expected = flagged('spaced-hyphen').range;
    expect({from: view.state.selection.main.from, to: view.state.selection.main.to}).toEqual({
      from: expected.start,
      to: expected.end,
    });
  });

  it('should leave the caret in the editor, ready to fix what was picked', async function () {
    // The focus is deferred by a microtask, so the assertion has to wait one.
    const {container} = render(<Harness source={MIXED} />);
    const view = EditorView.findFromDOM(container as HTMLElement);
    if (view === null) throw new Error('the editor view did not mount');

    const entry = expand(container, 'Spaced hyphen')[0];
    if (entry === undefined) throw new Error('the expanded group listed no entry');
    fireEvent.click(entry);
    await Promise.resolve();

    expect(view.hasFocus).toBe(true);
  });

  it('should move again when the same entry is picked twice', function () {
    // What the `seq` counter buys: the editor keys its reveal on the counter,
    // so a pick that did not increment it would be the same request and the
    // second click would leave the caret where the writer moved it.
    const {container} = render(<Harness source={MIXED} />);
    const view = EditorView.findFromDOM(container as HTMLElement);
    if (view === null) throw new Error('the editor view did not mount');

    const entry = expand(container, 'Em dash')[0];
    if (entry === undefined) throw new Error('the expanded group listed no entry');

    fireEvent.click(entry);
    view.dispatch({selection: {anchor: 0}});
    fireEvent.click(entry);

    expect(view.state.selection.main.from).toBe(flagged('em-dash').range.start);
  });

  it('should mark a newly opened document that happens to hold the same text', function () {
    // Two documents with identical text share one memoised findings array, so
    // the effect that dispatches them never fires for the second. The view
    // created for it is decorated on the way up instead.
    const {container, rerender} = render(<Harness source={MIXED} path="drafts/a.md" />);

    rerender(<Harness source={MIXED} path="drafts/b.md" />);

    expect(marks(container)).toHaveLength(2);
  });

  it('should cost no marks, no strip and no layout for a clean document', function () {
    const clean = render(<Harness source={CLEAN} />);
    const marked = render(<Harness source={MIXED} />);

    expect(marks(clean.container)).toHaveLength(0);
    expect(clean.container.querySelector('section[aria-label="Voice findings"]')).toBeNull();

    // The strip is a sibling of the editor or it is nothing at all. Not an
    // empty wrapper, not a border, not a row saying the document is clean:
    // one child where there is nothing to say, two where there is.
    expect(clean.container.firstElementChild?.children.length).toBe(1);
    expect(marked.container.firstElementChild?.children.length).toBe(2);
  });
});
