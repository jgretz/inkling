import {describe, expect, it} from 'bun:test';
import type {DecorationSet} from '@codemirror/view';
import type {Finding} from '@inkling/voice';
import {decorationsFor} from '../src/components/editor/findings-marks.ts';

function finding(start: number, end: number): Finding {
  return {
    ruleId: 'em-dash',
    anchor: {quote: '—', prefix: '', suffix: '', hint: start},
    range: {start, end},
    explain: 'use a colon, a comma or a full stop.',
  };
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
