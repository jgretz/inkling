import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['spaced-hyphen']});
}

describe('spaced-hyphen', function () {
  it('should flag a hyphen doing an em dash job', function () {
    const source = 'The gate fails closed - a missing judge never auto-approves.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(source.slice(found[0]?.range.start, found[0]?.range.end)).toBe('-');
  });

  it('should flag the ASCII stand-in', function () {
    const source = 'The gate fails closed -- a missing judge never auto-approves.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(source.slice(found[0]?.range.start, found[0]?.range.end)).toBe('--');
  });

  it('should push toward punctuation rather than a substitution', function () {
    const explain = findings('The gate fails closed - it never auto-approves.')[0]?.explain ?? '';

    expect(explain).toContain('colon');
    expect(explain).toContain('comma');
    expect(explain).toContain('full stop');
  });

  it('should not flag a nested list bullet', function () {
    expect(findings('Panels:\n\n- preview\n  - the rendered markdown\n')).toEqual([]);
  });

  it('should not flag a top-level list bullet', function () {
    expect(findings('Panels:\n\n- the rendered markdown\n- the raw source\n')).toEqual([]);
  });

  it('should not flag a table separator row', function () {
    expect(findings('| What | Command |\n| --- | --- |\n| Test | bun test |\n')).toEqual([]);
  });

  it('should not flag an aligned table separator row', function () {
    expect(findings('| What | Command |\n| :-- | --: |\n| Test | bun test |\n')).toEqual([]);
  });

  /**
   * The two-dash form is the one that reaches the guard at all: a three-dash
   * run has no whitespace between its own hyphens, so the pattern never matches
   * `| --- |` in the first place.
   */
  it('should not flag a two-dash table separator row', function () {
    expect(findings('| What | Command |\n| -- | -- |\n| Test | bun test |\n')).toEqual([]);
  });

  it('should not flag a separator row written without its outer pipes', function () {
    expect(findings('What | Command\n-- | --\nTest | bun test\n')).toEqual([]);
  });

  it('should not flag a numeric range', function () {
    expect(findings('The archive covers 2020 - 2024.')).toEqual([]);
  });

  it('should not flag a page range', function () {
    expect(findings('The argument runs over pages 10 - 20.')).toEqual([]);
  });

  it('should not flag a hyphen inside a fenced code block', function () {
    const source = ['```sh', 'bun test - -watch', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });

  it('should not flag a hyphen inside an inline code span', function () {
    expect(findings('Pass `bun test - -watch` to the runner.')).toEqual([]);
  });

  it('should not flag a frontmatter list item', function () {
    const source = ['---', 'tags:', '  - voice', '  - prose', '---', '', 'The draft is fine.'].join(
      '\n',
    );

    expect(findings(source)).toEqual([]);
  });
});
