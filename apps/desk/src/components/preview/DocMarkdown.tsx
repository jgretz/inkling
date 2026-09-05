import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {Components} from 'react-markdown';

/**
 * The override map, re-exported so this file stays the only one in the app that
 * names `react-markdown` at all.
 */
export type {Components};

type DocMarkdownProps = {
  /** The document body, with the frontmatter block already parsed off. */
  body: string;
  /**
   * Per-element overrides. The preview passes none and styles its container
   * with Tailwind; the clipboard passes inline styles, which is the only form
   * of styling a mail client keeps.
   */
  components?: Components;
};

/**
 * The app's one markdown pipeline.
 *
 * Every renderer goes through here, so `remarkGfm` is configured in exactly one
 * place: a plugin added for the preview is on the clipboard the same day, and
 * the two can never drift into disagreeing about what the document says.
 */
export function DocMarkdown({body, components}: DocMarkdownProps) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {body}
    </Markdown>
  );
}
