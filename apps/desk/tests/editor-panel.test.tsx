import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {act, fireEvent, render} from '@testing-library/react';
import {undo} from '@codemirror/commands';
import {EditorView} from '@codemirror/view';
import {EditorPanel} from '../src/components/editor/EditorPanel.tsx';

autoCleanup();

/**
 * Which physical modifier CodeMirror's `Mod-s` resolves to here.
 *
 * CodeMirror reads `navigator.platform` once, at import time. Static imports run
 * before `autoCleanup()`'s `beforeAll`, so what it read is Bun's own navigator,
 * which reports `MacIntel` on a Mac, and not happy-dom's, which reports
 * `X11; Darwin arm64` and would have made it Ctrl. Reading it here, at this
 * file's module scope, is reading it at the same moment CodeMirror did.
 */
const MOD: 'metaKey' | 'ctrlKey' = /Mac/.test(globalThis.navigator?.platform ?? '')
  ? 'metaKey'
  : 'ctrlKey';

/**
 * The editor's behaviour from before findings existed, which this task changes
 * the inside of.
 *
 * `EditorPanel` had no test at all until now, so nothing would have caught a
 * regression in the two rules its comment block already named: the update
 * listener that reports what the writer typed, and the sync effect that pushes
 * an external change in without resetting the cursor. Everything here drives the
 * real view rather than a stand-in.
 */

type PanelProps = {
  source: string;
  onChange?: (source: string) => void;
  onSave?: () => void;
  onFocus?: () => void;
};

function panel(props: PanelProps) {
  return (
    <EditorPanel
      path="drafts/a.md"
      source={props.source}
      onChange={props.onChange ?? function () {}}
      onSelect={function () {}}
      onSave={props.onSave ?? function () {}}
      onFocus={props.onFocus ?? function () {}}
      findings={[]}
      marksOn
      reveal={undefined}
    />
  );
}

function mount(props: PanelProps) {
  const result = render(panel(props));
  const view = EditorView.findFromDOM(result.container as HTMLElement);
  if (view === null) throw new Error('the editor view did not mount');
  return {...result, view};
}

describe('EditorPanel', function () {
  it('should call onChange with the new text when the document changes', function () {
    const onChange = mock(function (_source: string) {});
    const {view} = mount({source: 'First line.', onChange});

    act(function () {
      view.dispatch({changes: {from: 11, insert: ' Second.'}});
    });

    expect(onChange).toHaveBeenCalledWith('First line. Second.');
  });

  it('should call onSave when Mod-s is pressed', function () {
    const onSave = mock(function () {});
    const {view} = mount({source: 'First line.', onSave});

    // The binding under test is one binding; only which physical key reaches it
    // differs by platform. See `MOD` above for why that is decided here.
    act(function () {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          keyCode: 83,
          [MOD]: true,
          bubbles: true,
        }),
      );
    });

    expect(onSave).toHaveBeenCalled();
  });

  it('should push an external source change into the view', function () {
    const {view, rerender} = mount({source: 'First line.'});

    act(function () {
      rerender(panel({source: 'Changed on disk.'}));
    });

    expect(view.state.doc.toString()).toBe('Changed on disk.');
  });

  it('should leave the cursor alone when the source comes back unchanged', function () {
    // A round trip through the parent must not dispatch: a whole-document
    // replace would collapse the selection to the start of the file.
    const {view, rerender} = mount({source: 'First line.'});

    act(function () {
      view.dispatch({selection: {anchor: 6}});
    });
    act(function () {
      rerender(panel({source: 'First line.'}));
    });

    expect(view.state.selection.main.anchor).toBe(6);
  });

  // Focus landing anywhere in the editor is what puts the document back in the
  // writer's hands, and it is read off the host rather than out of CodeMirror.
  it('should report focus landing in the editor', function () {
    const onFocus = mock(function () {});
    const {view} = mount({source: 'First line.', onFocus});

    act(function () {
      fireEvent.focus(view.contentDOM);
    });

    expect(onFocus).toHaveBeenCalled();
  });

  // An accepted proposal reaches the editor as a changed `source` prop, and the
  // sync effect replaces the whole document to apply it. One dispatched
  // transaction is one history event, so Command-Z is the escape hatch it looks
  // like rather than a partial undo through a rewrite.
  it('should make an accepted edit arriving as a new source one undo step', function () {
    const {view, rerender} = mount({source: 'The ending is rather good.'});

    act(function () {
      rerender(panel({source: 'The ending is good.'}));
    });
    expect(view.state.doc.toString()).toBe('The ending is good.');

    act(function () {
      undo(view);
    });

    expect(view.state.doc.toString()).toBe('The ending is rather good.');
  });
});
