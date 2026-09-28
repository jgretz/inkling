import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {useState} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import {undo} from '@codemirror/commands';
import {check, resolveVoice, type Range} from '@inkling/voice';
import {DocumentPanel} from '../src/components/document/DocumentPanel.tsx';
import {useReveal} from '../src/components/document/use-reveal.ts';
import type {DocMode} from '../src/lib/doc-mode.ts';
import {useFindings} from '../src/lib/use-findings.ts';

autoCleanup();

/**
 * The document panel, wired the way `App.tsx` wires it: a mode held in state,
 * findings from the real hook, and every reveal through the real `useReveal`.
 *
 * A harness rather than `App` itself, which owns a vault, a settings file and a
 * Tauri bridge that none of this depends on. The `Point` button stands in for
 * the chat, which reaches the panel only through `show(range, true)`.
 *
 * Cases that write the DOM selection print happy-dom's caught "Calls to
 * EditorView.update are not allowed while an update is in progress" to stderr.
 * `pointing.test.tsx` explains why that is happy-dom and not inkling.
 */

const EVERY_RULE = resolveVoice([]);
const NOTHING_DISMISSED = Object.freeze([]);

const MIXED = 'A sentence — with an em dash and a hyphen - too.';

/** The passage the stand-in chat points at: "with an em dash". */
const POINTED: Range = {start: 13, end: 28};

function Harness({initial, source = MIXED}: {initial: DocMode; source?: string}) {
  const [mode, setMode] = useState<DocMode>(initial);
  const [draft, setDraft] = useState(source);
  const {kept} = useFindings(draft, EVERY_RULE, NOTHING_DISMISSED);
  const {reveal, show} = useReveal(setMode);

  return (
    <div>
      <button
        type="button"
        onClick={function () {
          setMode('source');
        }}
      >
        Source
      </button>
      <button
        type="button"
        onClick={function () {
          setMode('read');
        }}
      >
        Read
      </button>
      <button
        type="button"
        onClick={function () {
          show(POINTED, true);
        }}
      >
        Point
      </button>
      <div className="flex flex-1 flex-col">
        <DocumentPanel
          mode={mode}
          onMode={setMode}
          path="drafts/a.md"
          source={draft}
          onChange={setDraft}
          onSelect={function () {}}
          onSave={function () {}}
          onFocus={function () {}}
          findings={kept}
          marksOn
          reveal={reveal}
          onPick={function (finding) {
            show(finding.range);
          }}
        />
      </div>
    </div>
  );
}

function mount(initial: DocMode) {
  const result = render(<Harness initial={initial} />);
  const view = EditorView.findFromDOM(result.container as HTMLElement);
  if (view === null) throw new Error('the editor view did not mount');
  return {...result, view};
}

/** The element the editor is mounted in, which is what `hidden` is set on. */
function editorHost(view: EditorView): HTMLElement {
  const host = view.dom.parentElement;
  if (host === null) throw new Error('the editor has no host');
  return host;
}

function selected(view: EditorView): {from: number; to: number} {
  const {from, to} = view.state.selection.main;
  return {from, to};
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

function emDash(): Range {
  const finding = check(MIXED).find(function (candidate) {
    return candidate.ruleId === 'em-dash';
  });
  if (finding === undefined) throw new Error('the fixture produced no em-dash finding');
  return finding.range;
}

describe('the document panel', function () {
  it('should show the rendered document and hide the editor when in read', function () {
    const {container, view} = mount('read');

    expect(editorHost(view).hidden).toBe(true);
    expect(container.querySelector('article')?.textContent).toContain('with an em dash');
    expect(container.querySelector('section[aria-label="Voice findings"]')).not.toBeNull();
  });

  it('should keep the same editor view across a trip to read and back', function () {
    const {container, getByText, view} = mount('source');

    view.dispatch({changes: {from: 0, insert: 'Then. '}});
    expect(view.state.doc.toString()).toBe(`Then. ${MIXED}`);

    fireEvent.click(getByText('Read'));
    fireEvent.click(getByText('Source'));

    expect(EditorView.findFromDOM(container as HTMLElement)).toBe(view);
    expect(editorHost(view).hidden).toBe(false);
    undo(view);
    expect(view.state.doc.toString()).toBe(MIXED);
  });

  it('should end in source with the finding selected when a finding is picked in read', async function () {
    const {container, view} = mount('read');

    const entry = expand(container as HTMLElement, 'Em dash')[0];
    if (entry === undefined) throw new Error('the expanded group listed no entry');
    fireEvent.click(entry);

    const range = emDash();
    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
    expect(selected(view)).toEqual({from: range.start, to: range.end});

    // The focus is deferred by a microtask, so the assertion has to wait one.
    await Promise.resolve();
    expect(view.hasFocus).toBe(true);
  });

  it('should end in source with the passage selected when a pointer is followed in read', async function () {
    const {container, getByText, view} = mount('read');

    fireEvent.click(getByText('Point'));

    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
    expect(selected(view)).toEqual({from: POINTED.start, to: POINTED.end});
    expect(view.state.sliceDoc(POINTED.start, POINTED.end)).toBe('with an em dash');

    await Promise.resolve();
    expect(view.hasFocus).toBe(true);
  });

  it('should toggle between source and read on Command-E', function () {
    const {container, view} = mount('source');

    fireEvent.keyDown(window, {key: 'e', metaKey: true});
    expect(editorHost(view).hidden).toBe(true);
    expect(container.querySelector('article')).not.toBeNull();

    fireEvent.keyDown(window, {key: 'e', metaKey: true});
    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
  });

  it('should leave the mode alone on Control-E', function () {
    const {container, view} = mount('source');

    fireEvent.keyDown(window, {key: 'e', ctrlKey: true});

    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
  });

  it('should take focus out of the editor when the document goes to read', function () {
    const {getByText, view} = mount('source');

    view.focus();
    expect(view.hasFocus).toBe(true);

    fireEvent.click(getByText('Read'));

    expect(view.hasFocus).toBe(false);
  });
});
