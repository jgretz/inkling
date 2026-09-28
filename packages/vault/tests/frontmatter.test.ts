import {describe, expect, it} from 'bun:test';
import {frontmatterSpan, parseDoc, serializeDoc} from '../src/frontmatter.ts';

const BOM = '\uFEFF';

const READING_LIST = [
  '---',
  'title: Reading List',
  'kind: note',
  'tags:',
  '  - reference',
  '---',
  '',
  '# Reading List',
].join('\n');

/** The closing fence's line end in `source`, found by hand. */
function closingEnd(source: string): number {
  return source.indexOf('\n---', 1) + '\n---'.length;
}

const SPAN_FIXTURES: {
  name: string;
  source: string;
  span: {from: number; to: number} | undefined;
}[] = [
  {
    name: 'a reading-list document',
    source: READING_LIST,
    span: {from: 0, to: closingEnd(READING_LIST)},
  },
  {name: 'a file with no fence', source: '# Title\n\nSome prose.', span: undefined},
  {name: 'an unterminated block', source: '---\ntitle: X\n\nBody.', span: undefined},
  {
    name: 'a block of malformed yaml',
    source: '---\ntitle: [unclosed\n---\n\nBody.',
    span: undefined,
  },
  {
    name: 'a block holding a yaml scalar',
    source: '---\njust words\n---\n\nBody.',
    span: {from: 0, to: 18},
  },
  {name: 'an empty block', source: '---\n---\nBody.', span: {from: 0, to: 7}},
  {
    name: 'a leading byte-order mark',
    source: `${BOM}---\ntitle: X\n---\nBody.`,
    span: {from: 0, to: 17},
  },
  {
    name: 'a closing fence with trailing spaces',
    source: '---\ntitle: X\n---  \n\nBody.',
    span: {from: 0, to: 18},
  },
  {name: 'a block closed on the last line', source: '---\ntitle: X\n---', span: {from: 0, to: 16}},
  {name: 'a lone fence', source: '---', span: undefined},
];

describe('frontmatterSpan', function () {
  for (const {name, source, span} of SPAN_FIXTURES) {
    it(`should find the block's range when given ${name}`, function () {
      expect(frontmatterSpan(source)).toEqual(span);
    });

    it(`should agree with parseDoc about whether ${name} has a block`, function () {
      const unchanged = parseDoc(source).body === source.replace(/^\uFEFF/, '');
      expect(frontmatterSpan(source) === undefined).toBe(unchanged);
    });
  }
});

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
      'kind: article',
      'tags:',
      '  - craft',
      '---',
      '',
      'Body.',
    ].join('\n');

    const result = parseDoc(source);

    expect(result.frontmatter.title).toBe('On Writing');
    expect(result.frontmatter.kind).toBe('article');
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

  it('should still open a document written before the kinds were narrowed', function () {
    // `essay` was a kind inkling shipped with and no longer recognises. A vault
    // written back then still opens: the value is dropped, the prose is not.
    const source = ['---', 'title: On Writing', 'kind: essay', '---', '', 'Body.'].join('\n');

    const result = parseDoc(source);

    expect(result.frontmatter.kind).toBeUndefined();
    expect(result.frontmatter.title).toBe('On Writing');
    expect(result.body).toBe('Body.');
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
      'kind: article',
      'tags:',
      '  - craft',
      'publication: The Atlantic',
      '---',
      '',
      'Body.',
    ].join('\n');

    const result = parseDoc(serializeDoc(parseDoc(source)));

    expect(result.frontmatter.title).toBe('On Writing');
    expect(result.frontmatter.kind).toBe('article');
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
