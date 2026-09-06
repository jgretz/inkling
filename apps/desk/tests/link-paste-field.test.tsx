import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {act, fireEvent, render} from '@testing-library/react';
import type {GroupPath} from '@inkling/vault';
import type {BulkAttachRequest} from '../src/lib/use-references.ts';
import {LinkPasteField} from '../src/components/chat/LinkPasteField.tsx';

autoCleanup();

function noop() {}

/** The paste that made this feature exist, verbatim from the session that found it. */
const PASTE = `here is a set of links to add as context to this document [93% of Developers Use AI - Productivity Only 10%](https://shiftmag.dev/this-cto-says-93-of-developers-use-ai-but-productivity-is-still-10-8013/)
[The Agentic Platform for Product Engineers](https://www.kasava.dev/blog/ai-as-exoskeleton)
https://jeremyjenkins.me/blog/software-trades/
[We Automated Everything Except Knowing What's Going On](https://eversole.dev/blog/we-automated-everything/)
https://atono.substack.com/p/why-your-team-is-slower-than-last?aid=recmWxnSbaI8mF8mP
...`;

/** A write that lands, recording what the field handed it. */
function landing() {
  return mock(function (_request: BulkAttachRequest): Promise<void> {
    return Promise.resolve();
  });
}

type Overrides = {
  onSubmit?: (request: BulkAttachRequest) => Promise<unknown>;
  /** Passed through as given, so a root document's absent group is testable. */
  group?: GroupPath | undefined;
};

function field(overrides: Overrides = {}) {
  const group = 'group' in overrides ? overrides.group : ('drafts' as GroupPath);
  return render(
    <LinkPasteField group={group} onSubmit={overrides.onSubmit ?? landing()} onCancel={noop} />,
  );
}

function paste(view: ReturnType<typeof field>, text: string): void {
  fireEvent.change(view.getByLabelText('Links to attach'), {target: {value: text}});
}

function pasted(view: ReturnType<typeof field>): string {
  return (view.getByLabelText('Links to attach') as HTMLTextAreaElement).value;
}

/** Let the submit's promise settle before asserting on what the field did next. */
async function settle(): Promise<void> {
  await act(async function () {
    await Promise.resolve();
  });
}

describe('LinkPasteField', function () {
  it('should hand over every link in the paste and the line that held none', async function () {
    const onSubmit = landing();
    const view = field({onSubmit});

    paste(view, PASTE);
    fireEvent.click(view.getByText('Attach'));
    await settle();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const request = onSubmit.mock.calls[0]?.[0];
    expect(request?.links).toHaveLength(5);
    expect(request?.ignoredLines).toBe(1);
    expect(request?.level).toBe('document');
  });

  it('should carry the titles the writer wrote through untouched', async function () {
    const onSubmit = landing();
    const view = field({onSubmit});

    paste(view, PASTE);
    fireEvent.click(view.getByText('Attach'));
    await settle();

    const links = onSubmit.mock.calls[0]?.[0].links;
    expect(links?.[0]?.title).toBe('93% of Developers Use AI - Productivity Only 10%');
    expect(links?.[2]?.derived).toBe(true);
  });

  it('should clear the paste once the write has landed', async function () {
    const view = field();

    paste(view, PASTE);
    fireEvent.click(view.getByText('Attach'));
    await settle();

    expect(pasted(view)).toBe('');
  });

  /** A refused write must not cost the writer the paste they made. */
  it('should keep the paste when the write is refused', async function () {
    const view = field({
      onSubmit: function () {
        return Promise.reject(new Error('no vault database is open'));
      },
    });

    paste(view, PASTE);
    fireEvent.click(view.getByText('Attach'));
    await settle();

    expect(pasted(view)).toBe(PASTE);
  });

  it('should refuse to attach prose with no link in it', function () {
    const view = field();

    paste(view, 'here is a set of links to add as context to this document');

    expect(view.getByText('Attach').hasAttribute('disabled')).toBe(true);
  });

  it('should refuse to attach an empty field', function () {
    const view = field();

    expect(view.getByText('Attach').hasAttribute('disabled')).toBe(true);
  });

  it('should say how many links it found before anything is written', function () {
    const view = field();

    paste(view, PASTE);

    expect(view.getByText('5 links found')).toBeDefined();
  });

  it('should attach at the group level when the writer picks it', async function () {
    const onSubmit = landing();
    const view = field({onSubmit});

    paste(view, 'https://example.com/a');
    fireEvent.change(view.getByLabelText('Attach to'), {target: {value: 'group'}});
    fireEvent.click(view.getByText('Attach'));
    await settle();

    expect(onSubmit.mock.calls[0]?.[0].level).toBe('group');
  });

  it('should offer no group level for a document at the vault root', function () {
    const view = field({group: undefined});

    expect(view.getByLabelText('Attach to').hasAttribute('disabled')).toBe(true);
    expect(view.queryByText(/Everything in/)).toBeNull();
  });
});
