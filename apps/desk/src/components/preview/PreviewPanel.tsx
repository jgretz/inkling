import {useMemo} from 'react';
import {parseDoc} from '@inkling/vault';
import {TagChips} from '../document/TagChips.tsx';
import {DocMarkdown} from './DocMarkdown.tsx';

type PreviewPanelProps = {
  /** The raw editor buffer, frontmatter block included. */
  source: string;
};

/**
 * The Read view. Reads the live editor buffer rather than the file on disk, so
 * it shows the latest keystroke with no save in between.
 *
 * The frontmatter block is parsed off before rendering: it is metadata, and
 * showing it as a horizontal rule followed by stray text is worse than hiding
 * it. What it holds surfaces in the header strip instead.
 */
export function PreviewPanel({source}: PreviewPanelProps) {
  const {frontmatter, body} = useMemo(
    function () {
      return parseDoc(source);
    },
    [source],
  );

  return (
    <section className="flex h-full min-w-0 flex-col bg-ink-900">
      {frontmatter.tags !== undefined && frontmatter.tags.length > 0 && (
        <div className="shrink-0 border-b border-ink-800 px-8 py-2">
          <TagChips tags={frontmatter.tags} />
        </div>
      )}

      <div className="selectable flex-1 overflow-y-auto px-8 py-8">
        <article className="prose prose-invert prose-stone mx-auto max-w-[62ch] font-[family-name:var(--font-prose)] prose-headings:font-[family-name:var(--font-prose)] prose-a:text-accent prose-code:font-[family-name:var(--font-mono)]">
          <DocMarkdown body={body} />
        </article>
      </div>
    </section>
  );
}
