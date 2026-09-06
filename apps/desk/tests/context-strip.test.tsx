import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {act, fireEvent, render} from '@testing-library/react';
import type {DocPath, DocSummary, GroupPath} from '@inkling/vault';
import {estimateTokens, type AgentContext} from '../src/lib/agent.ts';
import {pointerAt} from '../src/lib/pointer.ts';
import type {ContextReference} from '../src/lib/references.ts';
import {ContextStrip, type ReferenceControls} from '../src/components/chat/ContextStrip.tsx';

autoCleanup();

function noop() {}

/** A write that resolves having done nothing, for the cases that ignore it. */
function noWrite(): Promise<void> {
  return Promise.resolve();
}

const STYLE = 'x'.repeat(120);
const TONE = 'y'.repeat(40);

/** An assembled entry, as `assembleReferences` hands one to the strip. */
function entry(overrides: Partial<ContextReference> = {}): ContextReference {
  const source = overrides.source ?? STYLE;
  return {
    id: 1,
    kind: 'doc',
    title: 'The style guide',
    source,
    target: 'notes/style.md',
    origin: {level: 'document'},
    missing: false,
    suppressedBy: undefined,
    tokens: estimateTokens(source),
    ...overrides,
  };
}

/** An entry a group above the open document attached. */
function inherited(overrides: Partial<ContextReference> = {}): ContextReference {
  return entry({
    id: 2,
    title: 'House tone',
    source: TONE,
    target: 'notes/tone.md',
    origin: {level: 'group', group: 'drafts' as GroupPath},
    tokens: estimateTokens(TONE),
    ...overrides,
  });
}

function doc(path: string, title: string): DocSummary {
  return {
    path: path as DocPath,
    title,
    kind: undefined,
    tags: [],
    updatedAt: '2026-09-04T12:00:00.000Z',
    words: 100,
  };
}

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    doc: {path: 'drafts/piece.md' as DocPath, title: 'The piece', source: 'p'.repeat(200)},
    selection: pointerAt('s'.repeat(40), 0, 40),
    references: [],
    ...overrides,
  };
}

function strip(overrides: Partial<AgentContext> = {}, controls: Partial<ReferenceControls> = {}) {
  return render(
    <ContextStrip
      context={context(overrides)}
      references={{
        docs: [doc('notes/style.md', 'The style guide')],
        group: 'drafts' as GroupPath,
        canAttach: true,
        onAttach: noop,
        onAttachMany: noWrite,
        onDetach: noop,
        onSuppress: noop,
        onRestore: noop,
        ...controls,
      }}
    />,
  );
}

/** The number the header claims, read out of what the writer actually sees. */
function headerTotal(view: ReturnType<typeof strip>): number {
  const found = /~([\d,]+) tokens/.exec(view.container.textContent ?? '');
  if (found?.[1] === undefined) throw new Error('the strip printed no total');
  return Number(found[1].replace(/,/g, ''));
}

/**
 * Every chip's own number, parsed off the end of its text.
 *
 * Parsing the rendered text is the point of these assertions: calling
 * `contextTokens` again would prove nothing about what the writer reads.
 */
function chipTotals(view: ReturnType<typeof strip>): number[] {
  return view.getAllByRole('listitem').map(function (chip) {
    const found = /([\d,]+)\s*$/.exec(chip.textContent ?? '');
    if (found?.[1] === undefined) throw new Error(`no token count on ${chip.textContent}`);
    return Number(found[1].replace(/,/g, ''));
  });
}

describe('ContextStrip', function () {
  it('should say nothing is attached when the turn would carry nothing', function () {
    const view = strip({doc: undefined, selection: undefined, references: []});

    expect(view.getByText('Nothing attached')).toBeDefined();
    expect(headerTotal(view)).toBe(0);
  });

  it('should total exactly what its chips add up to', function () {
    const view = strip({references: [entry(), inherited()]});

    const chips = chipTotals(view);

    // The document, the selection, and one chip per reference.
    expect(chips).toHaveLength(4);
    expect(headerTotal(view)).toBe(
      chips.reduce(function (sum, tokens) {
        return sum + tokens;
      }, 0),
    );
    expect(headerTotal(view)).toBe(50 + 10 + 30 + 10);
  });

  /**
   * The entries are full-width rows now rather than one line of pills, so the
   * group, the state and the remove control all sit beside the title. The count
   * still comes last in the row's text, which is what lets a reader find it in
   * the same place on every one of them.
   */
  it('should keep the token count last whatever else the row carries', function () {
    const view = strip({
      references: [entry(), inherited({source: '', suppressedBy: 7, tokens: 0})],
    });

    expect(chipTotals(view)).toEqual([50, 10, 30, 0]);
  });

  it('should name the group an inherited reference came from', function () {
    const view = strip({references: [inherited()]});

    const chip = view.getByText('House tone').closest('li');

    expect(chip?.textContent).toContain('drafts');
  });

  it('should say which group it is turning off, not "this document"', function () {
    const view = strip({references: [inherited()]});

    const control = view.getByLabelText(/House tone/);

    expect(control.getAttribute('aria-label')).toContain('drafts');
    expect(control.getAttribute('aria-label')).not.toContain('this document');
  });

  it('should say "this document" on a reference the document owns', function () {
    const view = strip({references: [entry()]});

    expect(view.getByLabelText('Detach The style guide from this document')).toBeDefined();
  });

  it('should render a reference whose file is gone as broken and free', function () {
    const view = strip({
      doc: undefined,
      selection: undefined,
      references: [entry({source: '', missing: true, tokens: 0})],
    });

    expect(view.getByText('missing')).toBeDefined();
    expect(chipTotals(view)).toEqual([0]);
    expect(headerTotal(view)).toBe(0);
  });

  it('should keep a turned-off reference on screen at no cost', function () {
    const view = strip({
      doc: undefined,
      selection: undefined,
      references: [inherited({source: '', suppressedBy: 7, tokens: 0})],
    });

    expect(view.getByText('off')).toBeDefined();
    expect(headerTotal(view)).toBe(0);
    expect(view.getByLabelText('Restore House tone, inherited from drafts')).toBeDefined();
  });

  it('should detach a reference the document owns rather than turning it off', function () {
    const onDetach = mock(noop);
    const onSuppress = mock(noop);
    const view = strip({references: [entry()]}, {onDetach, onSuppress});

    fireEvent.click(view.getByLabelText('Detach The style guide from this document'));

    expect(onDetach).toHaveBeenCalledTimes(1);
    expect(onSuppress).toHaveBeenCalledTimes(0);
  });

  /** The group owns it and other documents are reading it, so it is not deleted. */
  it('should turn an inherited reference off rather than detaching it', function () {
    const onDetach = mock(noop);
    const onSuppress = mock(noop);
    const view = strip({references: [inherited()]}, {onDetach, onSuppress});

    fireEvent.click(view.getByLabelText('Turn off House tone, inherited from drafts'));

    expect(onSuppress).toHaveBeenCalledTimes(1);
    expect(onDetach).toHaveBeenCalledTimes(0);
  });

  it('should restore a turned-off reference from its own chip', function () {
    const onRestore = mock(noop);
    const view = strip(
      {references: [inherited({source: '', suppressedBy: 7, tokens: 0})]},
      {onRestore},
    );

    fireEvent.click(view.getByLabelText('Restore House tone, inherited from drafts'));

    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('should offer no way to attach when there is nowhere to store one', function () {
    const view = strip({}, {canAttach: false});

    expect(view.queryByLabelText('Attach a reference')).toBeNull();
    expect(view.queryByLabelText('Paste a set of links')).toBeNull();
  });

  /** A whole paste is its own gesture, so it has its own button beside the plus. */
  it('should open the paste field from its own button', function () {
    const view = strip();

    fireEvent.click(view.getByLabelText('Paste a set of links'));

    expect(view.getByLabelText('Links to attach')).toBeDefined();
    expect(view.queryByLabelText('Kind of reference')).toBeNull();
  });

  it('should open the single-link picker without the paste field', function () {
    const view = strip();

    fireEvent.click(view.getByLabelText('Attach a reference'));

    expect(view.getByLabelText('Kind of reference')).toBeDefined();
    expect(view.queryByLabelText('Links to attach')).toBeNull();
  });

  it('should hand a whole paste to the bulk write rather than the single one', async function () {
    const onAttach = mock(noop);
    const onAttachMany = mock(noWrite);
    const view = strip({}, {onAttach, onAttachMany});

    fireEvent.click(view.getByLabelText('Paste a set of links'));
    fireEvent.change(view.getByLabelText('Links to attach'), {
      target: {value: '[The piece](https://example.com/a)\nhttps://example.com/b\nnot a link'},
    });
    fireEvent.click(view.getByText('Attach'));
    await act(async function () {
      await Promise.resolve();
    });

    expect(onAttach).toHaveBeenCalledTimes(0);
    expect(onAttachMany).toHaveBeenCalledWith({
      level: 'document',
      links: [
        {url: 'https://example.com/a', title: 'The piece', derived: false},
        {url: 'https://example.com/b', title: 'example.com/b', derived: true},
      ],
      ignoredLines: 1,
    });
  });

  it('should attach a web link at the level the picker names', function () {
    const onAttach = mock(noop);
    const view = strip({}, {onAttach});

    fireEvent.click(view.getByLabelText('Attach a reference'));
    fireEvent.change(view.getByLabelText('Kind of reference'), {target: {value: 'link'}});
    fireEvent.change(view.getByLabelText('Address'), {target: {value: 'https://example.com'}});
    fireEvent.change(view.getByLabelText('Attach to'), {target: {value: 'group'}});
    fireEvent.click(view.getByText('Attach'));

    expect(onAttach).toHaveBeenCalledWith({
      level: 'group',
      kind: 'link',
      title: 'https://example.com',
      targetPath: undefined,
      url: 'https://example.com',
    });
  });

  it('should attach a vault document under the title it already has', function () {
    const onAttach = mock(noop);
    const view = strip({}, {onAttach});

    fireEvent.click(view.getByLabelText('Attach a reference'));
    fireEvent.change(view.getByLabelText('Document to attach'), {
      target: {value: 'notes/style.md'},
    });
    fireEvent.click(view.getByText('Attach'));

    expect(onAttach).toHaveBeenCalledWith({
      level: 'document',
      kind: 'doc',
      title: 'The style guide',
      targetPath: 'notes/style.md',
      url: undefined,
    });
  });

  /**
   * A note names no target here: `useReferences` writes its markdown body
   * first and only then knows the path the row points at.
   */
  it('should attach a note as a title alone', function () {
    const onAttach = mock(noop);
    const view = strip({}, {onAttach});

    fireEvent.click(view.getByLabelText('Attach a reference'));
    fireEvent.change(view.getByLabelText('Kind of reference'), {target: {value: 'note'}});
    fireEvent.change(view.getByLabelText('Note title'), {target: {value: 'On endings'}});
    fireEvent.click(view.getByText('Attach'));

    expect(onAttach).toHaveBeenCalledWith({
      level: 'document',
      kind: 'note',
      title: 'On endings',
      targetPath: undefined,
      url: undefined,
    });
  });

  it('should refuse to attach a note until it has a title to name its file', function () {
    const view = strip({}, {onAttach: noop});

    fireEvent.click(view.getByLabelText('Attach a reference'));
    fireEvent.change(view.getByLabelText('Kind of reference'), {target: {value: 'note'}});
    fireEvent.change(view.getByLabelText('Note title'), {target: {value: '   '}});

    expect(view.getByText('Attach').hasAttribute('disabled')).toBe(true);
  });

  it('should refuse to attach a document until one is chosen', function () {
    const view = strip({}, {onAttach: noop});

    fireEvent.click(view.getByLabelText('Attach a reference'));

    expect(view.getByText('Attach').hasAttribute('disabled')).toBe(true);
  });

  it('should offer no group level for a document at the vault root', function () {
    const view = strip({}, {group: undefined});

    fireEvent.click(view.getByLabelText('Attach a reference'));

    expect(view.getByLabelText('Attach to').hasAttribute('disabled')).toBe(true);
  });
});
