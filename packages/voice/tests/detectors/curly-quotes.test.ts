import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['curly-quotes']});
}

describe('curly-quotes', function () {
  it('should flag typographic double quotes', function () {
    expect(findings('He said “no” and left.')).toHaveLength(2);
  });

  it('should flag a typographic apostrophe', function () {
    expect(findings('It’s the source file, not the render.')).toHaveLength(1);
  });

  it('should not flag straight quotes', function () {
    expect(findings('He said "no" and it\'s fine.')).toEqual([]);
  });

  it('should not flag a curly quote inside inline code', function () {
    expect(findings('Compare with `“”` in the fixture.')).toEqual([]);
  });
});
