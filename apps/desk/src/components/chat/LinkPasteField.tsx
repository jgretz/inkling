import {useCallback, useMemo, useState} from 'react';
import type {ChangeEvent, FormEvent} from 'react';
import {groupName, type GroupPath} from '@inkling/vault';
import {extractLinks, linkPasteTally} from '../../lib/link-paste.ts';
import type {BulkAttachRequest} from '../../lib/use-references.ts';

type LinkPasteFieldProps = {
  /** The open document's nearest group, when it is in one. */
  group: GroupPath | undefined;
  /** Resolves when the write landed, which is the only thing that clears the field. */
  onSubmit: (request: BulkAttachRequest) => Promise<unknown>;
  onCancel: () => void;
};

const FIELD =
  'w-full rounded bg-ink-850 px-1.5 py-1 text-[11px] text-ink-100 placeholder:text-ink-600 focus:outline-none focus:ring-1 focus:ring-accent-muted';

const BUTTON = 'rounded px-2 py-1 text-[11px] transition-colors duration-100 disabled:opacity-30';

const PLACEHOLDER = 'Paste links, one per line. Markdown links keep their titles.';

/**
 * Everything a writer has already read, attached in one gesture.
 *
 * Beside the picker rather than inside it: this is another kind of gesture, not
 * another kind of reference, and attaching a single link should never route
 * through a textarea. What lands is decided here and only here, by the pure
 * extractor; nothing in this file parses anything itself.
 *
 * The field is cleared by the write resolving, never by the submit. A refused
 * paste leaves the writer's text exactly where they can try it again, which is
 * the difference between a retry and a re-paste from wherever it came from.
 */
export function LinkPasteField({group, onSubmit, onCancel}: LinkPasteFieldProps) {
  const [text, setText] = useState('');
  const [level, setLevel] = useState<'document' | 'group'>('document');
  const [attaching, setAttaching] = useState(false);

  const found = useMemo(
    function () {
      return extractLinks(text);
    },
    [text],
  );

  const handleText = useCallback(function (event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value);
  }, []);

  const handleLevel = useCallback(function (event: ChangeEvent<HTMLSelectElement>) {
    setLevel(event.target.value as 'document' | 'group');
  }, []);

  const handleSubmit = useCallback(
    function (event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (found.links.length === 0 || attaching) return;
      setAttaching(true);
      onSubmit({level, links: found.links, ignoredLines: found.ignoredLines})
        .then(function () {
          setText('');
        })
        .catch(function () {
          // Said in the status bar by whoever owns the write. Swallowed here on
          // purpose: this field's only job on a failure is to keep the paste.
        })
        .finally(function () {
          setAttaching(false);
        });
    },
    [attaching, found, level, onSubmit],
  );

  return (
    <form onSubmit={handleSubmit} className="mb-1.5 space-y-1 rounded bg-ink-900 p-1.5">
      <textarea
        aria-label="Links to attach"
        value={text}
        onChange={handleText}
        placeholder={PLACEHOLDER}
        rows={5}
        className={`${FIELD} resize-none`}
      />

      <select
        aria-label="Attach to"
        value={level}
        onChange={handleLevel}
        className={FIELD}
        disabled={group === undefined}
      >
        <option value="document">This document</option>
        {group !== undefined && <option value="group">Everything in {groupName(group)}</option>}
      </select>

      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-ink-600">{linkPasteTally(found.links)}</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onCancel}
            className={`${BUTTON} text-ink-400 hover:bg-ink-800`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={found.links.length === 0 || attaching}
            className={`${BUTTON} bg-accent text-ink-950 hover:opacity-90`}
          >
            Attach
          </button>
        </div>
      </div>
    </form>
  );
}
