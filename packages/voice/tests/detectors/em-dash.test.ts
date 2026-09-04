import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['em-dash']});
}

describe('em-dash', function () {
  it('should flag an em dash in prose', function () {
    const source = 'The gate fails closed — a missing judge never auto-approves.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(source.slice(found[0]?.range.start, found[0]?.range.end)).toBe('—');
  });

  it('should tell the writer what to replace it with', function () {
    expect(findings('One — two.')[0]?.explain).toContain('colon');
  });

  it('should not flag an em dash inside a fenced code block', function () {
    const source = ['Prose here.', '', '```ts', 'const dash = "—";', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });

  it('should not flag a hyphen or a double hyphen', function () {
    expect(findings('A well-made thing, built --fast.')).toEqual([]);
  });
});
