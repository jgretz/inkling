import {useMemo} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {parseDoc} from '@inkling/vault';

type PreviewPanelProps = {
  /** The raw editor buffer, frontmatter block included. */
  source: string;
};

/**
 * The rendered half. Reads the live editor buffer rather than the file on disk,
 * so the preview tracks keystrokes with no save in between.
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
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-ink-800 px-8 py-2">
          {frontmatter.tags.map(function (tag) {
            return (
              <span
                key={tag}
                className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-400"
              >
                {tag}
              </span>
            );
          })}
        </div>
      )}

      <div className="selectable flex-1 overflow-y-auto px-8 py-8">
        <article className="prose prose-invert prose-stone mx-auto max-w-[62ch] font-[family-name:var(--font-prose)] prose-headings:font-[family-name:var(--font-prose)] prose-a:text-accent prose-code:font-[family-name:var(--font-mono)]">
          <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
        </article>
      </div>
    </section>
  );
}
