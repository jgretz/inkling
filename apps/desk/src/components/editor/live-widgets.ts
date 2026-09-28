import {isolateHistory} from '@codemirror/commands';
import {syntaxTree} from '@codemirror/language';
import {EditorView, WidgetType} from '@codemirror/view';

const TASK_MARKER = /^\[[ xX]\]$/;

/** A GFM task marker, drawn as the checkbox it stands for. */
export class TaskBox extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  override eq(other: TaskBox): boolean {
    return other.checked === this.checked;
  }

  override toDOM(): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-live-task';
    box.checked = this.checked;
    // The keyboard's route is the marker itself: move onto the line and edit it.
    box.tabIndex = -1;
    box.setAttribute('aria-label', this.checked ? 'Done' : 'Not done');
    return box;
  }

  /** Hands the box's events to the view, so `taskClicks` below sees them. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/** A thematic break, drawn as a rule. */
export class RuleWidget extends WidgetType {
  override eq(other: RuleWidget): boolean {
    return other instanceof RuleWidget;
  }

  override toDOM(): HTMLElement {
    const rule = document.createElement('span');
    rule.className = 'cm-live-rule';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
  }
}

/**
 * Flips the task marker starting at `markerFrom` between `[ ]` and `[x]`, as its
 * own undo step. `false`, with the document untouched, when no task marker
 * starts there.
 */
export function toggleTask(view: EditorView, markerFrom: number): boolean {
  const {state} = view;
  const marker = state.sliceDoc(markerFrom, markerFrom + 3);
  if (!TASK_MARKER.test(marker)) return false;
  // A `[x]` written in running prose is text, not a task.
  const node = syntaxTree(state).resolveInner(markerFrom, 1);
  if (node.name !== 'TaskMarker' || node.from !== markerFrom) return false;

  view.dispatch({
    changes: {from: markerFrom + 1, to: markerFrom + 2, insert: marker[1] === ' ' ? 'x' : ' '},
    annotations: isolateHistory.of('full'),
  });
  return true;
}

function taskBoxAt(event: Event): Element | null {
  return event.target instanceof Element ? event.target.closest('.cm-live-task') : null;
}

/**
 * A press on a checkbox toggles its marker and leaves the selection where it
 * was, so the line stays drawn with the box rather than opening to its markdown.
 * The click that follows is cancelled too, or the browser would flip the box a
 * second time on its own.
 */
export const taskClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const box = taskBoxAt(event);
    if (box === null) return false;
    event.preventDefault();
    toggleTask(view, view.posAtDOM(box));
    return true;
  },
  click(event) {
    if (taskBoxAt(event) === null) return false;
    event.preventDefault();
    return true;
  },
});
