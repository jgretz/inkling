import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {StateField, type EditorState} from '@codemirror/state';
import {Decoration, EditorView, WidgetType, type DecorationSet} from '@codemirror/view';
import {frontmatterSpan, parseDoc} from '@inkling/vault';
import {CHIP_SHAPE, TagChips} from '../document/TagChips.tsx';

type Span = {from: number; to: number};

type FrontmatterState = {span: Span | undefined; tags: readonly string[]};

function readFrontmatter(state: EditorState): FrontmatterState {
  const span = frontmatterSpan(state.doc.toString());
  if (span === undefined) return {span, tags: []};
  // The block alone goes to the parser: the body can be long and holds no
  // metadata, and this runs on every keystroke.
  const tags = parseDoc(state.sliceDoc(0, span.to)).frontmatter.tags ?? [];
  return {span, tags};
}

/** Where the document's frontmatter block is, and the tags it holds. */
export const frontmatterField = StateField.define<FrontmatterState>({
  create: readFrontmatter,
  update(value, tr) {
    return tr.docChanged ? readFrontmatter(tr.state) : value;
  },
});

/**
 * Moves the caret onto the block's first line, which opens it for editing.
 * A one-line document has no second line, so the caret goes to 0 instead.
 */
export function enterFrontmatter(view: EditorView): void {
  const {doc} = view.state;
  view.dispatch({selection: {anchor: doc.lines > 1 ? doc.line(2).from : 0}});
  view.focus();
}

class FrontmatterWidget extends WidgetType {
  constructor(readonly tags: readonly string[]) {
    super();
  }

  override eq(other: FrontmatterWidget): boolean {
    return (
      other.tags.length === this.tags.length &&
      other.tags.every((tag, index) => tag === this.tags[index])
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div');
    dom.className = 'cm-live-frontmatter';
    // Static markup rather than a React root: this runs inside EditorPanel's
    // passive effects, where React will not flush a new root synchronously and
    // warns when one is unmounted there.
    dom.innerHTML = renderToStaticMarkup(
      this.tags.length > 0
        ? createElement(TagChips, {tags: this.tags})
        : // A block with no tags still needs something on screen to click into.
          createElement('span', {className: `${CHIP_SHAPE} text-ink-600`}, 'Frontmatter'),
    );
    dom.addEventListener('mousedown', function (event) {
      event.preventDefault();
      enterFrontmatter(view);
    });
    return dom;
  }

  override get estimatedHeight(): number {
    return 32;
  }
}

/**
 * The block folded into its chips, or nothing when the selection reaches into
 * it.
 *
 * The block starts at 0, so a range reaches into it exactly when it starts at
 * or before the block's end. A caret at the end of the closing fence is on the
 * fence's line, so it counts as inside.
 */
export function frontmatterFold(state: EditorState): DecorationSet {
  const {span, tags} = state.field(frontmatterField);
  if (span === undefined) return Decoration.none;
  if (state.selection.ranges.some((range) => range.from <= span.to)) return Decoration.none;
  const fold = Decoration.replace({widget: new FrontmatterWidget(tags), block: true});
  return Decoration.set([fold.range(span.from, span.to)]);
}

/** A block decoration, so it has to come from a field rather than a view plugin. */
export const foldField = StateField.define<DecorationSet>({
  create: frontmatterFold,
  update(fold, tr) {
    return tr.docChanged || tr.selection ? frontmatterFold(tr.state) : fold;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

/** Where a document opens: the start of its body, or 0 when it has no frontmatter. */
export function openingCaret(source: string): number {
  const span = frontmatterSpan(source);
  return span === undefined ? 0 : Math.min(span.to + 1, source.length);
}
