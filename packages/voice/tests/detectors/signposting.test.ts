import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['signposting']});
}

describe('signposting', function () {
  it('should flag an announcement of what comes next', function () {
    const source = "Let's dive into how the reducer handles a stale result.";

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('delete');
  });

  it('should flag a backward reference', function () {
    expect(findings('As mentioned earlier, the anchor survives an edit.')).toHaveLength(1);
  });

  it('should not flag a plain past-tense sentence about diving', function () {
    expect(findings('The team dove into the details and came back tired.')).toEqual([]);
  });

  it('should not flag as we saw without a backward pointer', function () {
    expect(findings('As we saw the token expire, the daemon retried.')).toEqual([]);
  });

  it('should not flag inside a blockquote', function () {
    expect(findings("> Let's dive into the details.")).toEqual([]);
  });
});
