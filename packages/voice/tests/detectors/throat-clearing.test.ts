import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['throat-clearing']});
}

describe('throat-clearing', function () {
  it('should flag a hedge before the point', function () {
    const source = 'It is worth noting that the preview never lags the editor.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('delete');
  });

  it('should flag filler mid-paragraph', function () {
    expect(findings('The panel is quiet. That said, the agent can still write.')).toHaveLength(1);
  });

  it('should not flag worth used in an ordinary sentence', function () {
    expect(findings('The note is worth keeping, and so is the draft.')).toEqual([]);
  });

  it('should not flag inside a fenced code block', function () {
    const source = ['```', 'It is worth noting that this is a fixture.', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });
});
