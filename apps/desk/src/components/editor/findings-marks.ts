import {StateEffect, StateField, type Extension} from '@codemirror/state';
import {Decoration, EditorView, hoverTooltip, type DecorationSet} from '@codemirror/view';
import type {Finding} from '@inkling/voice';
import {ruleLabel} from '../../lib/voice-rules.ts';

/** Replaces every mark in the view. React dispatches this; nothing else does. */
export const setFindings = StateEffect.define<readonly Finding[]>();

/**
 * The mark itself: one underline, and no attributes at all.
 *
 * No `title`, no `aria-label`, no `role`, and no `aria-live` anywhere near it.
 * The span wraps text that is already in the document, so a screen reader keeps
 * reading the prose exactly as it did before and nothing announces on a
 * keystroke. The explain reaches the mouse through the hover tooltip below and
 * the keyboard through the findings strip, which is a list of real buttons.
 */
const mark = Decoration.mark({class: 'cm-voice-finding'});

/** A finding's range, clamped into a document of `docLength`. */
function clamp(finding: Finding, docLength: number): {from: number; to: number} {
  return {
    from: Math.max(0, Math.min(finding.range.start, docLength)),
    to: Math.max(0, Math.min(finding.range.end, docLength)),
  };
}

/**
 * Decorations for a set of findings, clamped to a document of `docLength`.
 *
 * The clamp is not defensive decoration. React holds the findings for the draft
 * it last rendered while the view holds whatever the writer has typed since, so
 * there is a real window in which a range runs past the end of the document, and
 * an out-of-range decoration throws inside CodeMirror rather than being ignored.
 * Anything empty after clamping is dropped, and `Decoration.set(_, true)` sorts,
 * because the corpus genuinely contains overlapping findings.
 */
export function decorationsFor(findings: readonly Finding[], docLength: number): DecorationSet {
  const ranges = findings.flatMap(function (finding) {
    const {from, to} = clamp(finding, docLength);
    if (to <= from) return [];
    return [mark.range(from, to)];
  });

  return Decoration.set(ranges, true);
}

type FindingsState = {
  findings: readonly Finding[];
  decorations: DecorationSet;
};

/**
 * What the view knows about findings: the set React last handed it, and the
 * decorations drawn from it.
 *
 * Both live in one field because they have to agree. The decorations map through
 * every edit so a mark tracks the text it flagged between two React renders; the
 * findings are kept beside them because a decoration carries no payload and the
 * tooltip needs the explain lines.
 */
const findingsField = StateField.define<FindingsState>({
  create() {
    return {findings: [], decorations: Decoration.none};
  },
  update(state, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFindings)) {
        return {
          findings: effect.value,
          decorations: decorationsFor(effect.value, tr.state.doc.length),
        };
      }
    }
    if (!tr.docChanged) return state;
    return {findings: state.findings, decorations: state.decorations.map(tr.changes)};
  },
  provide(field) {
    return EditorView.decorations.from(field, function (state) {
      return state.decorations;
    });
  },
});

/**
 * The explain line for every finding under the pointer, one per line.
 *
 * The mouse only. A tooltip that followed the caret would be on screen most of
 * the time a writer types: five of the findings in the example vault span 211 to
 * 330 characters. The keyboard reads the same text in the strip instead.
 */
const explainTooltip = hoverTooltip(function (view, pos) {
  const docLength = view.state.doc.length;
  const covering = view.state.field(findingsField).findings.filter(function (finding) {
    const {from, to} = clamp(finding, docLength);
    return to > from && pos >= from && pos <= to;
  });

  const first = covering[0];
  if (first === undefined) return null;

  const {from, to} = clamp(first, docLength);
  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-voice-tooltip';
      covering.forEach(function (finding) {
        const line = document.createElement('div');
        const label = document.createElement('span');
        label.className = 'cm-voice-tooltip-rule';
        label.textContent = ruleLabel(finding.ruleId);
        line.append(label, ` ${finding.explain}`);
        dom.append(line);
      });
      return {dom};
    },
  };
});

/** The whole findings layer: the marks, and the mouse's way to the explain. */
export function voiceFindings(): Extension {
  return [findingsField, explainTooltip];
}
