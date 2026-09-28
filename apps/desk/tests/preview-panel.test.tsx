import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {render} from '@testing-library/react';
import {TagChips} from '../src/components/document/TagChips.tsx';
import {PreviewPanel} from '../src/components/preview/PreviewPanel.tsx';

autoCleanup();

/** The strip above the prose: the panel's first child, when there is one. */
function chipStrip(container: HTMLElement): Element | null | undefined {
  return container.querySelector('section')?.firstElementChild;
}

describe('PreviewPanel', function () {
  it("should draw the tags as TagChips's own markup when the document has tags", function () {
    const {container} = render(<PreviewPanel source={'---\ntags: [a, b]\n---\n\nBody.'} />);

    expect(chipStrip(container)?.innerHTML).toBe(
      renderToStaticMarkup(<TagChips tags={['a', 'b']} />),
    );
  });

  it('should draw no chip strip when the document has no tags', function () {
    const {container} = render(<PreviewPanel source={'---\ntitle: X\n---\n\nBody.'} />);

    expect(container.querySelector('section')?.children).toHaveLength(1);
    expect(container.querySelector('article')?.textContent).toContain('Body.');
  });
});
