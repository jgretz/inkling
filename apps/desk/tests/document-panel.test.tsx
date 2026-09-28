import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {useState} from 'react';
import {fireEvent, render} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import {undo} from '@codemirror/commands';
import {check, resolveVoice, type Range} from '@inkling/voice';
import {DocumentPanel} from '../src/components/document/DocumentPanel.tsx';
import {useReveal} from '../src/components/document/use-reveal.ts';
import {showMode, type DocMode, type EditMode, type ModeState} from '../src/lib/doc-mode.ts';
import {useFindings} from '../src/lib/use-findings.ts';

autoCleanup();

/**
 * The document panel, wired the way `App.tsx` wires it: a mode state held in state,
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

/**
 * A line after the one the caret starts on, so Live has markers to hide and a
 * test can tell Live from Source by what the editor draws.
 */
const BOLD_LINE = '\n\nSome **bold** words.';

/** The passage the stand-in chat points at: "with an em dash". */
const POINTED: Range = {start: 13, end: 28};

/** A state that keeps the invariant: in an editing mode, or in Read over one. */
function modeState(docMode: DocMode, editMode: EditMode = 'live'): ModeState {
  return docMode === 'read' ? {docMode, editMode} : {docMode, editMode: docMode};
}

function Harness({initial, source = MIXED + BOLD_LINE}: {initial: ModeState; source?: string}) {
  const [mode, setMode] = useState<ModeState>(initial);
  const [draft, setDraft] = useState(source);
  const {kept} = useFindings(draft, EVERY_RULE, NOTHING_DISMISSED);
  const {reveal, show} = useReveal(setMode);

  return (
    <div>
      {(['live', 'source', 'read'] as const).map(function (target) {
        return (
          <button
            key={target}
            type="button"
            onClick={function () {
              setMode(function (current) {
                return showMode(current, target);
              });
            }}
          >
            {target}
          </button>
        );
      })}
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
          mode={mode.docMode}
          editMode={mode.editMode}
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

function mount(initial: ModeState) {
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

/** Whether the editor draws the markdown as Live does, with the bold line's `**` hidden. */
function drawsLive(view: EditorView): boolean {
  const text = view.contentDOM.textContent ?? '';
  if (!text.includes('bold')) throw new Error('the editor does not draw the bold line');
  return !text.includes('**bold**');
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
    const {container, view} = mount(modeState('read'));

    expect(editorHost(view).hidden).toBe(true);
    expect(container.querySelector('article')?.textContent).toContain('with an em dash');
    expect(container.querySelector('section[aria-label="Voice findings"]')).not.toBeNull();
  });

  it('should keep the same editor view across a trip to read and back', function () {
    const {container, getByText, view} = mount(modeState('source'));

    view.dispatch({changes: {from: 0, insert: 'Then. '}});
    expect(view.state.doc.toString()).toBe(`Then. ${MIXED}${BOLD_LINE}`);

    fireEvent.click(getByText('read'));
    fireEvent.click(getByText('source'));

    expect(EditorView.findFromDOM(container as HTMLElement)).toBe(view);
    expect(editorHost(view).hidden).toBe(false);
    undo(view);
    expect(view.state.doc.toString()).toBe(MIXED + BOLD_LINE);
  });

  it('should end in the last editing mode with the finding selected when a finding is picked in read', async function () {
    const {container, view} = mount(modeState('read', 'source'));

    const entry = expand(container as HTMLElement, 'Em dash')[0];
    if (entry === undefined) throw new Error('the expanded group listed no entry');
    fireEvent.click(entry);

    const range = emDash();
    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
    expect(drawsLive(view)).toBe(false);
    expect(selected(view)).toEqual({from: range.start, to: range.end});

    // The focus is deferred by a microtask, so the assertion has to wait one.
    await Promise.resolve();
    expect(view.hasFocus).toBe(true);
  });

  it('should end in the last editing mode with the passage selected when a pointer is followed in read', async function () {
    const {container, getByText, view} = mount(modeState('read', 'live'));

    fireEvent.click(getByText('Point'));

    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
    expect(drawsLive(view)).toBe(true);
    expect(selected(view)).toEqual({from: POINTED.start, to: POINTED.end});
    expect(view.state.sliceDoc(POINTED.start, POINTED.end)).toBe('with an em dash');

    await Promise.resolve();
    expect(view.hasFocus).toBe(true);
  });

  it('should toggle between source and read and back to source on Command-E', function () {
    const {container, view} = mount(modeState('source'));

    fireEvent.keyDown(window, {key: 'e', metaKey: true});
    expect(editorHost(view).hidden).toBe(true);
    expect(container.querySelector('article')).not.toBeNull();

    fireEvent.keyDown(window, {key: 'e', metaKey: true});
    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
    expect(drawsLive(view)).toBe(false);
  });

  it('should return to live from read on Command-E when live was the last editing mode', function () {
    const {getByText, view} = mount(modeState('live'));

    fireEvent.click(getByText('read'));
    fireEvent.keyDown(window, {key: 'e', metaKey: true});

    expect(editorHost(view).hidden).toBe(false);
    expect(drawsLive(view)).toBe(true);
  });

  it('should flip live and source on one view on Command-Shift-E', function () {
    const {container, view} = mount(modeState('live'));
    expect(drawsLive(view)).toBe(true);

    fireEvent.keyDown(window, {key: 'E', metaKey: true, shiftKey: true});
    expect(EditorView.findFromDOM(container as HTMLElement)).toBe(view);
    expect(drawsLive(view)).toBe(false);

    fireEvent.keyDown(window, {key: 'e', metaKey: true, shiftKey: true});
    expect(EditorView.findFromDOM(container as HTMLElement)).toBe(view);
    expect(drawsLive(view)).toBe(true);
  });

  it('should leave read for the other editing mode on Command-Shift-E', function () {
    const {container, view} = mount(modeState('read', 'live'));

    fireEvent.keyDown(window, {key: 'E', metaKey: true, shiftKey: true});

    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
    expect(drawsLive(view)).toBe(false);
  });

  it('should leave the mode alone on Control-E', function () {
    const {container, view} = mount(modeState('source'));

    fireEvent.keyDown(window, {key: 'e', ctrlKey: true});
    fireEvent.keyDown(window, {key: 'E', ctrlKey: true, shiftKey: true});

    expect(editorHost(view).hidden).toBe(false);
    expect(container.querySelector('article')).toBeNull();
    expect(drawsLive(view)).toBe(false);
  });

  it('should take focus out of the editor when the document goes to read', function () {
    const {getByText, view} = mount(modeState('source'));

    view.focus();
    expect(view.hasFocus).toBe(true);

    fireEvent.click(getByText('read'));

    expect(view.hasFocus).toBe(false);
  });
});

describe('the document mode switch', function () {
  function modeGroup(result: ReturnType<typeof mount>): HTMLElement {
    return result.getByRole('group', {name: 'Document mode'});
  }

  function modeButton(result: ReturnType<typeof mount>, label: string): HTMLButtonElement {
    const button = modeGroup(result).querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (button === null) throw new Error(`the switch has no ${label} button`);
    return button;
  }

  function pressedLabels(result: ReturnType<typeof mount>): (string | null)[] {
    return [...modeGroup(result).querySelectorAll('button[aria-pressed="true"]')].map(
      function (button) {
        return button.getAttribute('aria-label');
      },
    );
  }

  it('should list Live, Source and Read in that order', function () {
    const labels = [...modeGroup(mount(modeState('live'))).querySelectorAll('button')].map(
      function (button) {
        return button.getAttribute('aria-label');
      },
    );

    expect(labels).toEqual(['Live', 'Source', 'Read']);
  });

  it('should show the switch in every mode', function () {
    for (const mode of ['live', 'source', 'read'] as const) {
      const result = mount(modeState(mode));
      expect(modeGroup(result)).toBeDefined();
      result.unmount();
    }
  });

  it('should mark exactly the current mode pressed', function () {
    const pressed = (['live', 'source', 'read'] as const).map(function (mode) {
      const result = mount(modeState(mode));
      const labels = pressedLabels(result);
      result.unmount();
      return labels;
    });

    expect(pressed).toEqual([['Live'], ['Source'], ['Read']]);
  });

  it('should show the rendered document when Read is clicked from live', function () {
    const result = mount(modeState('live'));

    fireEvent.click(modeButton(result, 'Read'));

    expect(editorHost(result.view).hidden).toBe(true);
    expect(result.container.querySelector('article')).not.toBeNull();
    expect(pressedLabels(result)).toEqual(['Read']);
  });

  it('should show the editor in source when Source is clicked from read', function () {
    const result = mount(modeState('read', 'live'));

    fireEvent.click(modeButton(result, 'Source'));

    expect(editorHost(result.view).hidden).toBe(false);
    expect(result.container.querySelector('article')).toBeNull();
    expect(drawsLive(result.view)).toBe(false);
  });

  it('should draw live on the same view when Live is clicked from source', function () {
    const result = mount(modeState('source'));
    expect(drawsLive(result.view)).toBe(false);

    fireEvent.click(modeButton(result, 'Live'));

    expect(EditorView.findFromDOM(result.container as HTMLElement)).toBe(result.view);
    expect(drawsLive(result.view)).toBe(true);
  });

  it('should give every button a hover', function () {
    const titles = [...modeGroup(mount(modeState('live'))).querySelectorAll('button')].map(
      function (button) {
        return button.title;
      },
    );

    expect(titles).toEqual([
      'Live (⌘⇧E switches to Source)',
      'Source (⌘⇧E switches to Live)',
      'Read (⌘E toggles)',
    ]);
  });
});
