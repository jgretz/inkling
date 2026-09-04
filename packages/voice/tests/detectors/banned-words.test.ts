import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['banned-words']});
}

describe('banned-words', function () {
  it('should flag a banned word in prose', function () {
    const source = 'We delve into the details of the parser.';

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(source.slice(found[0]?.range.start, found[0]?.range.end)).toBe('delve');
  });

  it('should flag an inflected form', function () {
    expect(findings('Leveraging the cache made it worse.')).toHaveLength(1);
  });

  it('should say what to write instead', function () {
    expect(findings('We utilize the cache.')[0]?.explain).toContain('use');
  });

  it('should not flag a banned word inside an inline code span', function () {
    expect(findings('Call `delve()` before the parse.')).toEqual([]);
  });

  it('should not flag a banned word inside a fenced code block', function () {
    const source = ['```ts', 'function delve() {}', '```'].join('\n');

    expect(findings(source)).toEqual([]);
  });
});

describe('banned-words literal senses', function () {
  it('should flag navigate used figuratively', function () {
    expect(findings('Writers must navigate the tradeoffs alone.')).toHaveLength(1);
  });

  it('should not flag navigate used literally', function () {
    expect(findings('The reader can navigate to the page from the sidebar.')).toEqual([]);
  });

  it('should flag landscape used figuratively', function () {
    expect(findings('The tooling landscape shifted again.')).toHaveLength(1);
  });

  it('should not flag landscape used literally', function () {
    expect(findings('Print the map in landscape orientation.')).toEqual([]);
  });

  it('should flag harness used figuratively', function () {
    expect(findings('We harness the model to draft faster.')).toHaveLength(1);
  });

  it('should not flag a harness that is a thing', function () {
    expect(findings('It runs inside a harness inkling does not own.')).toEqual([]);
  });

  it('should flag unpack used figuratively', function () {
    expect(findings('Let me unpack that claim for you.')).toHaveLength(1);
  });

  it('should not flag unpacking actual boxes', function () {
    expect(findings('She spent the morning unpacking the boxes.')).toEqual([]);
  });
});
