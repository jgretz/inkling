import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {EditorState} from '@codemirror/state';
import type {DecorationSet} from '@codemirror/view';
import type {Finding} from '@inkling/voice';
import {
  decorationsFor,
  explainDom,
  findingsAt,
  setFindings,
  voiceFindings,
} from '../src/components/editor/findings-marks.ts';

// Nothing here renders, but `explainDom` builds the tooltip's DOM, and the
// globals the root preload registers are handed back by the first render suite
// that finishes. A file that wants a `document` asks for one.
autoCleanup();

function finding(start: number, end: number, ruleId = 'em-dash'): Finding {
  return {
    ruleId,
    anchor: {quote: '—', prefix: '', suffix: '', hint: start},
    range: {start, end},
    explain: 'use a colon, a comma or a full stop.',
  };
}

/** A state carrying the findings layer, with a set of findings already in it. */
function stateWith(doc: string, findings: readonly Finding[]): EditorState {
  const empty = EditorState.create({doc, extensions: [voiceFindings()]});
  return empty.update({effects: setFindings.of(findings)}).state;
}

function ranges(set: DecorationSet): {from: number; to: number}[] {
  const found: {from: number; to: number}[] = [];
  const cursor = set.iter();
  while (cursor.value !== null) {
    found.push({from: cursor.from, to: cursor.to});
    cursor.next();
  }
  return found;
}

describe('decorationsFor', function () {
  it('should clamp a range that runs past the end of the document', function () {
    // The window this closes: React holds findings for the draft it last
    // rendered while the view holds what has been typed since.
    expect(ranges(decorationsFor([finding(4, 40)], 10))).toEqual([{from: 4, to: 10}]);
  });

  it('should drop a finding that lies entirely past the end', function () {
    expect(ranges(decorationsFor([finding(20, 25)], 10))).toEqual([]);
  });

  it('should drop a finding that is empty after clamping', function () {
    expect(ranges(decorationsFor([finding(10, 12)], 10))).toEqual([]);
  });

  it('should keep both of two overlapping findings', function () {
    const set = decorationsFor([finding(0, 12), finding(6, 20)], 30);

    expect(ranges(set)).toEqual([
      {from: 0, to: 12},
      {from: 6, to: 20},
    ]);
  });

  it('should sort ranges given out of document order', function () {
    const set = decorationsFor([finding(18, 20), finding(2, 4)], 30);

    expect(ranges(set)).toEqual([
      {from: 2, to: 4},
      {from: 18, to: 20},
    ]);
  });

  it('should produce nothing for no findings', function () {
    expect(ranges(decorationsFor([], 30))).toEqual([]);
  });
});

describe('findingsAt', function () {
  const DOC = 'abcdefghijklmnopqrst';

  it('should return the finding whose mark covers the position', function () {
    const state = stateWith(DOC, [finding(10, 12)]);

    expect(findingsAt(state, 11)).toEqual([finding(10, 12)]);
  });

  it('should return nothing away from every mark', function () {
    const state = stateWith(DOC, [finding(10, 12)]);

    expect(findingsAt(state, 4)).toEqual([]);
  });

  it('should return both of two overlapping findings, in document order', function () {
    const state = stateWith(DOC, [finding(2, 14), finding(8, 16, 'rule-of-three')]);

    expect(
      findingsAt(state, 10).map(function (entry) {
        return entry.ruleId;
      }),
    ).toEqual(['em-dash', 'rule-of-three']);
  });

  it('should follow the text when an edit above it moves it', function () {
    // The window this closes: the writer types, and React has not yet handed
    // back the findings for what they typed. Until it does, the stored finding
    // has to describe the text its mark is still underlining.
    const state = stateWith(DOC, [finding(10, 12)]);
    const edited = state.update({changes: {from: 0, insert: 'xxxxx'}}).state;

    expect(findingsAt(edited, 16)).toHaveLength(1);
    expect(findingsAt(edited, 11)).toEqual([]);
  });

  it('should drop a finding an edit deleted outright', function () {
    const state = stateWith(DOC, [finding(2, 5)]);
    const edited = state.update({changes: {from: 0, to: 8}}).state;

    expect(findingsAt(edited, 0)).toEqual([]);
  });

  it('should throw when the findings layer is not installed', function () {
    // A state with no field is a wiring mistake, not a document with nothing
    // wrong in it, and the two must not look the same.
    expect(function () {
      findingsAt(EditorState.create({doc: DOC}), 4);
    }).toThrow();
  });
});

describe('explainDom', function () {
  it('should render one line per finding, each naming its rule first', function () {
    const dom = explainDom([finding(0, 2), finding(4, 6, 'spaced-hyphen')]);

    expect(
      Array.from(dom.children).map(function (line) {
        return line.textContent;
      }),
    ).toEqual([
      'Em dash use a colon, a comma or a full stop.',
      'Spaced hyphen use a colon, a comma or a full stop.',
    ]);
  });

  it('should fall back to the raw id for a rule with no label', function () {
    const dom = explainDom([finding(0, 2, 'not-a-rule')]);

    expect(dom.textContent).toBe('not-a-rule use a colon, a comma or a full stop.');
  });
});
