import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {act, render} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import {EditorPanel} from '../src/components/editor/EditorPanel.tsx';

autoCleanup();

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
};

function panel(props: PanelProps) {
  return (
    <EditorPanel
      path="drafts/a.md"
      source={props.source}
      onChange={props.onChange ?? function () {}}
      onSelect={function () {}}
      onSave={props.onSave ?? function () {}}
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

    // Ctrl rather than Cmd: CodeMirror resolves `Mod` off the platform it
    // detects, and happy-dom's navigator is not a Mac. The binding under test is
    // the same one; only which physical key reaches it differs.
    act(function () {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          keyCode: 83,
          ctrlKey: true,
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
});
