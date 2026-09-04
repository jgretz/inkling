import {describe, expect, it} from 'bun:test';
import {check} from '../../src/check.ts';

function findings(source: string) {
  return check(source, {detectors: ['transition-stacking']});
}

describe('transition-stacking', function () {
  it('should flag three consecutive sentences opening with a connective', function () {
    const source = [
      'However, the panel stays quiet.',
      'Moreover, the editor keeps up.',
      'Furthermore, the preview never lags.',
    ].join(' ');

    const found = findings(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.explain).toContain('cut the connectives');
  });

  it('should raise one finding for the whole run', function () {
    const source = [
      'However, the panel stays quiet.',
      'Moreover, the editor keeps up.',
      'Furthermore, the preview never lags.',
      'Therefore, the writer is left alone.',
    ].join(' ');

    expect(findings(source)).toHaveLength(1);
  });

  it('should not flag two in a row', function () {
    const source =
      'However, the panel stays quiet. Moreover, the editor keeps up. The rest is prose.';

    expect(findings(source)).toEqual([]);
  });

  it('should not flag a run broken by a plain sentence', function () {
    const source = [
      'However, the panel stays quiet.',
      'The editor keeps up.',
      'Moreover, the preview never lags.',
      'Furthermore, nothing else moves.',
    ].join(' ');

    expect(findings(source)).toEqual([]);
  });

  it('should break a run at a heading', function () {
    const source = [
      'However, the panel stays quiet.',
      'Moreover, the editor keeps up.',
      '',
      '## Furthermore, a heading',
      '',
      'Therefore, the writer is left alone.',
    ].join('\n');

    expect(findings(source)).toEqual([]);
  });

  it('should not flag a connective inside a word', function () {
    const source = 'Thusly said the parser. Thusly said the parser. Thusly said the parser.';

    expect(findings(source)).toEqual([]);
  });
});
