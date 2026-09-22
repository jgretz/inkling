import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['automatic-interpretation']});
}

describe('automatic-interpretation', function () {
  it('should flag a participle grading the clause before it', function () {
    const source = 'The team shipped on time, highlighting its commitment to quality.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(source.slice(found[0]?.range.start, found[0]?.range.end)).toBe('highlighting');
  });

  it('should flag the multi-word participle', function () {
    const source = 'The parser landed in March, paving the way for the editor.';

    expect(findings(source)[0]?.anchor.quote).toBe('paving the way for');
  });

  it('should flag a relative clause doing the same job', function () {
    const source = 'Revenue doubled, which speaks to the strength of the product.';

    expect(findings(source)[0]?.anchor.quote).toBe('which speaks to');
  });

  it('should not flag a participle with no comma in front of it', function () {
    expect(findings('A mirror reflecting the light hung in the hall.')).toEqual([]);
  });

  it('should not flag a participle opening a sentence', function () {
    expect(findings('Highlighting a passage sends it to the agent.')).toEqual([]);
  });

  it('should not flag inside a fenced code block', function () {
    const source = ['```ts', '// shipped, highlighting the fix', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });
});
