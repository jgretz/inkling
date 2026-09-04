import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['bold-term-colon']});
}

describe('bold-term-colon', function () {
  it('should flag a bold term with a trailing colon in a list', function () {
    const source = '- **Preview**: tracks the editor keystroke by keystroke.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('sentence');
  });

  it('should flag the colon inside the emphasis', function () {
    expect(findings('**Preview:** tracks the editor.')).toHaveLength(1);
  });

  it('should not flag a bold lead-in ending in a full stop', function () {
    expect(
      findings('**Files are the source of truth.** A vault is the writer’s own directory.'),
    ).toEqual([]);
  });

  it('should not flag bold used inside a sentence', function () {
    expect(findings('The **preview** tracks the editor: closely.')).toEqual([]);
  });

  it('should not flag inside a fenced code block', function () {
    const source = ['```md', '- **Preview**: tracks the editor.', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });
});
