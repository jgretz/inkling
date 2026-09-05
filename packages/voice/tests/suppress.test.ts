import {describe, expect, it} from 'bun:test';
import {check} from '../src/check.ts';
import {applySuppressions, type Suppression} from '../src/suppress.ts';
import type {Finding} from '../src/types.ts';

/** Two em dashes in two paragraphs, told apart only by what surrounds them. */
const ORIGINAL = `First paragraph has an em dash — right here.

Second paragraph has an em dash — right here too. And a sentence after it.`;

/**
 * The same second em dash, after the paragraph above it was rewritten to a
 * different length and the sentence after it was replaced. Every offset below
 * the first paragraph has moved.
 */
const EDITED = `A rewritten opening paragraph, rather longer than the one it replaced, which still has an em dash — right here.

Second paragraph has an em dash — right here too. A replacement sentence.`;

function emDashes(source: string): Finding[] {
  return check(source, {detectors: ['em-dash']});
}

/** The nth finding, or a failure naming the fixture rather than a type error. */
function at(findings: readonly Finding[], index: number): Finding {
  const finding = findings[index];
  if (finding === undefined) throw new Error(`the fixture raised no finding at ${index}`);
  return finding;
}

function dismiss(finding: Finding): Suppression {
  return {ruleId: finding.ruleId, anchor: finding.anchor};
}

/** The findings out of a suppressed pair, when the assertion is about position. */
function silenced(entries: ReadonlyArray<{finding: Finding}>): Finding[] {
  return entries.map(function (entry) {
    return entry.finding;
  });
}

/** Where each finding starts, which is what identifies one in these fixtures. */
function starts(findings: readonly Finding[]): number[] {
  return findings.map(function (finding) {
    return finding.range.start;
  });
}

describe('applySuppressions', function () {
  it('should keep every finding when nothing was dismissed', function () {
    const findings = emDashes(ORIGINAL);

    const {kept, suppressed} = applySuppressions(ORIGINAL, findings, []);

    expect(kept).toEqual(findings);
    expect(suppressed).toEqual([]);
  });

  it('should suppress only the finding that was dismissed', function () {
    const findings = emDashes(ORIGINAL);

    const {kept, suppressed} = applySuppressions(ORIGINAL, findings, [dismiss(at(findings, 1))]);

    expect(kept).toEqual([at(findings, 0)]);
    expect(suppressed).toEqual([{finding: at(findings, 1), by: dismiss(at(findings, 1))}]);
  });

  it('should still suppress the same em dash when the paragraph above it is rewritten', function () {
    const dismissed = at(emDashes(ORIGINAL), 1);
    const after = emDashes(EDITED);

    const {kept, suppressed} = applySuppressions(EDITED, after, [dismiss(dismissed)]);

    // Asserted first: without a move, the test would pass on offsets alone and
    // prove nothing about the anchor.
    expect(at(after, 1).range.start).not.toBe(dismissed.range.start);
    expect(starts(silenced(suppressed))).toEqual([at(after, 1).range.start]);
    expect(starts(kept)).toEqual([at(after, 0).range.start]);
  });

  it('should suppress nothing when the quoted text is gone for good', function () {
    const before = 'Tuesday — the meeting day.\n\nSheep, counted — one at a time.';
    const dismissed = at(emDashes(before), 1);
    // The dismissed em dash is gone. The one in the first line, which nobody
    // dismissed, is not.
    const after = 'Tuesday — the meeting day.\n\nSheep, counted, one at a time.';

    const {kept, suppressed} = applySuppressions(after, emDashes(after), [dismiss(dismissed)]);

    // Without the context floor this passes to the surviving em dash instead:
    // `resolveAnchor` answers "where is this quote now", and a lone candidate
    // wins however little of its neighbourhood agrees.
    expect(starts(kept)).toEqual([at(emDashes(after), 0).range.start]);
    expect(suppressed).toEqual([]);
  });

  it('should suppress nothing when the quote survives nowhere in the document', function () {
    const dismissed = at(emDashes(ORIGINAL), 1);
    const after = 'First paragraph, rewritten.\n\nSecond paragraph, rewritten.';

    const {kept, suppressed} = applySuppressions(after, emDashes(after), [dismiss(dismissed)]);

    expect(kept).toEqual([]);
    expect(suppressed).toEqual([]);
  });

  it('should not let a dismissal cross to another rule at the same span', function () {
    const findings = emDashes(ORIGINAL);

    const {kept, suppressed} = applySuppressions(ORIGINAL, findings, [
      {ruleId: 'curly-quotes', anchor: at(findings, 1).anchor},
    ]);

    expect(kept).toEqual(findings);
    expect(suppressed).toEqual([]);
  });

  it('should hand back the dismissal that silenced each finding', function () {
    const findings = emDashes(ORIGINAL);
    // What the app stores: the row's id travels with the dismissal so a
    // restore knows which row to delete.
    const stored = {id: 7, ...dismiss(at(findings, 1))};

    const {suppressed} = applySuppressions(ORIGINAL, findings, [stored]);

    expect(suppressed[0]?.by.id).toBe(7);
  });

  it('should keep the surviving findings in the order they arrived', function () {
    const source = 'One — two — three — four.';
    const findings = emDashes(source);

    const {kept} = applySuppressions(source, findings, [dismiss(at(findings, 1))]);

    expect(starts(kept)).toEqual([at(findings, 0).range.start, at(findings, 2).range.start]);
  });
});
