import {StateEffect, StateField, type Extension} from '@codemirror/state';
import {Decoration, EditorView, keymap, type DecorationSet} from '@codemirror/view';
import type {Range} from '@inkling/voice';

/** Paints a passage somebody pointed at. React dispatches this; nothing else does. */
export const setPoint = StateEffect.define<Range>();

/** Takes the paint off again. Dispatched by a reveal that asked for no mark. */
export const clearPoint = StateEffect.define<null>();

/**
 * The mark itself: a background tint, and no attributes at all.
 *
 * A tint rather than an underline, because a voice finding is already underlined
 * and two underlines in one line of prose say nothing to a reader trying to tell
 * them apart. No `title`, no `aria-label`, no `role`, for the reason
 * `findings-marks.ts` gives: the span wraps text that is already in the document,
 * and the reveal has already put the caret on it.
 */
const mark = Decoration.mark({class: 'cm-agent-point'});

/**
 * The decoration for one pointed-at range, clamped to a document of `docLength`.
 *
 * Clamped the way `decorationsFor` is, and for the same reason: React holds the
 * draft it last rendered while the view holds whatever the writer has typed
 * since, and an out-of-range decoration throws inside CodeMirror rather than
 * being ignored. An empty range after clamping paints nothing.
 */
export function pointDecoration(range: Range, docLength: number): DecorationSet {
  const from = Math.max(0, Math.min(range.start, docLength));
  const to = Math.max(0, Math.min(range.end, docLength));
  if (to <= from) return Decoration.none;
  return Decoration.set([mark.range(from, to)]);
}

/**
 * The one passage currently painted, if any.
 *
 * One at a time by construction: a second pointer replaces the first rather than
 * accumulating, so the writer is never looking at two answers to "which passage
 * did you mean". Any edit clears it, because a highlight the writer has typed
 * through has stopped being about what they asked to see.
 */
const pointField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(current, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPoint)) return pointDecoration(effect.value, tr.state.doc.length);
      if (effect.is(clearPoint)) return Decoration.none;
    }
    if (tr.docChanged) return Decoration.none;
    return current;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/**
 * Takes the highlight off, and says whether there was one to take off.
 *
 * The return value is the whole point of it as a key binding: Escape in an
 * editor already means several things, so this claims the key only while a
 * passage is painted and lets the default binding have it otherwise.
 */
export function dismissPoint(view: EditorView): boolean {
  if (view.state.field(pointField).size === 0) return false;
  view.dispatch({effects: clearPoint.of(null)});
  return true;
}

/** The whole pointing layer: the mark, and the writer's way to dismiss it. */
export function agentPoint(): Extension {
  return [pointField, keymap.of([{key: 'Escape', run: dismissPoint}])];
}
