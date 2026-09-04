import {describe, expect, it} from 'bun:test';
import {parseDoc, serializeDoc} from '../src/frontmatter.ts';

describe('parseDoc', function () {
  it('should return the whole file as body when there is no fence', function () {
    const source = '# Title\n\nSome prose.';

    const result = parseDoc(source);

    expect(result.body).toBe(source);
    expect(result.frontmatter.extra).toEqual({});
  });

  it('should split known keys out of the frontmatter block', function () {
    const source = [
      '---',
      'title: On Writing',
      'kind: essay',
      'tags:',
      '  - craft',
      '---',
      '',
      'Body.',
    ].join('\n');

    const result = parseDoc(source);

    expect(result.frontmatter.title).toBe('On Writing');
    expect(result.frontmatter.kind).toBe('essay');
    expect(result.frontmatter.tags).toEqual(['craft']);
    expect(result.body).toBe('Body.');
  });

  it('should carry unknown keys in extra', function () {
    const source = ['---', 'title: X', 'publication: The Atlantic', '---', '', 'Body.'].join('\n');

    const result = parseDoc(source);

    expect(result.frontmatter.extra).toEqual({publication: 'The Atlantic'});
  });

  it('should drop an unrecognized kind rather than trusting it', function () {
    const source = ['---', 'kind: haiku', '---', '', 'Body.'].join('\n');

    const result = parseDoc(source);

    expect(result.frontmatter.kind).toBeUndefined();
  });

  it('should fall back to the whole file when the block never closes', function () {
    const source = '---\ntitle: X\n\nBody with no closing fence.';

    const result = parseDoc(source);

    expect(result.body).toBe(source);
    expect(result.frontmatter.title).toBeUndefined();
  });

  it('should fall back to the whole file when the block is not valid yaml', function () {
    const source = '---\ntitle: [unclosed\n---\n\nBody.';

    const result = parseDoc(source);

    expect(result.body).toBe(source);
  });
});

describe('serializeDoc', function () {
  it('should omit the block entirely when nothing is set', function () {
    const result = serializeDoc({frontmatter: {extra: {}}, body: '# Title'});

    expect(result).toBe('# Title');
  });

  it('should round-trip known keys and extras', function () {
    const source = [
      '---',
      'title: On Writing',
      'kind: essay',
      'tags:',
      '  - craft',
      'publication: The Atlantic',
      '---',
      '',
      'Body.',
    ].join('\n');

    const result = parseDoc(serializeDoc(parseDoc(source)));

    expect(result.frontmatter.title).toBe('On Writing');
    expect(result.frontmatter.kind).toBe('essay');
    expect(result.frontmatter.tags).toEqual(['craft']);
    expect(result.frontmatter.extra).toEqual({publication: 'The Atlantic'});
    expect(result.body).toBe('Body.');
  });

  it('should not accumulate blank lines across repeated round-trips', function () {
    const once = serializeDoc(parseDoc('---\ntitle: X\n---\n\nBody.'));

    const twice = serializeDoc(parseDoc(once));

    expect(twice).toBe(once);
  });
});
