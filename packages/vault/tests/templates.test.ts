import {describe, expect, it} from 'bun:test';
import {parseDoc, serializeDoc} from '../src/frontmatter.ts';
import {summarize} from '../src/summary.ts';
import {TEMPLATE_DIR, templateFor, templatePathFor} from '../src/templates.ts';
import {DOC_KINDS, type DocKind, type DocPath} from '../src/types.ts';

const CREATED = '2026-01-01T00:00:00.000Z';
const MTIME = '2026-02-02T00:00:00.000Z';

/** The convention keys each kind writes empty for the writer to fill in. */
const CONVENTIONS: Record<DocKind, string[]> = {
  article: ['publication'],
  email: ['to', 'subject'],
  proposal: ['client', 'status'],
  note: [],
};

describe('DOC_KINDS', function () {
  it('should be the four kinds inkling is built for, in order', function () {
    expect(DOC_KINDS).toEqual(['article', 'email', 'proposal', 'note']);
  });
});

describe('templatePathFor', function () {
  it('should name the override each kind is read from', function () {
    expect(templatePathFor('proposal')).toBe('templates/proposal.md' as DocPath);
    expect(TEMPLATE_DIR).toBe('templates');
  });
});

describe('templateFor', function () {
  DOC_KINDS.forEach(function (kind) {
    describe(kind, function () {
      it('should carry the title, the kind and the created date it was given', function () {
        const {frontmatter} = parseDoc(templateFor(kind, 'A Title', CREATED));

        expect(frontmatter.title).toBe('A Title');
        expect(frontmatter.kind).toBe(kind);
        expect(frontmatter.createdAt).toBe(CREATED);
      });

      it('should hold exactly this kind’s convention keys, each empty', function () {
        const {frontmatter} = parseDoc(templateFor(kind, 'A Title', CREATED));

        expect(Object.keys(frontmatter.extra)).toEqual(CONVENTIONS[kind]);
        expect(Object.values(frontmatter.extra)).toEqual(
          CONVENTIONS[kind].map(function () {
            return '';
          }),
        );
      });

      it('should not write an updatedAt the app never refreshes', function () {
        const {frontmatter} = parseDoc(templateFor(kind, 'A Title', CREATED));

        expect(frontmatter.updatedAt).toBeUndefined();
      });

      it('should survive a save without the file churning', function () {
        const template = templateFor(kind, 'A Title', CREATED);

        expect(serializeDoc(parseDoc(template))).toBe(template);
      });

      it('should summarize as the kind and title it was created with', function () {
        const summary = summarize(
          'drafts/x.md' as DocPath,
          templateFor(kind, 'A Title', CREATED),
          MTIME,
        );

        expect(summary.kind).toBe(kind);
        expect(summary.title).toBe('A Title');
      });

      it('should put the title in the body rather than leave the token there', function () {
        const {body} = parseDoc(templateFor(kind, 'A Title', CREATED));

        expect(body).toContain('# A Title');
        expect(body).not.toContain('{{title}}');
      });
    });
  });

  it('should take its body and extra keys from an override', function () {
    const override = ['---', 'section: Opinion', '---', '', '# {{title}}', '', 'Dear reader,'].join(
      '\n',
    );

    const {frontmatter, body} = parseDoc(templateFor('article', 'A Title', CREATED, override));

    expect(frontmatter.extra).toEqual({section: 'Opinion'});
    expect(body).toBe('# A Title\n\nDear reader,');
  });

  it('should still own the title, kind and created date when an override names them', function () {
    const override = [
      '---',
      'title: Whatever The Override Says',
      'kind: note',
      'createdAt: 1999-01-01T00:00:00.000Z',
      '---',
      '',
      'Body.',
    ].join('\n');

    const {frontmatter} = parseDoc(templateFor('proposal', 'A Title', CREATED, override));

    expect(frontmatter.title).toBe('A Title');
    expect(frontmatter.kind).toBe('proposal');
    expect(frontmatter.createdAt).toBe(CREATED);
  });

  it('should drop the built-in conventions when an override supplies its own', function () {
    const override = ['---', 'section: Opinion', '---', '', '# {{title}}'].join('\n');

    const {frontmatter} = parseDoc(templateFor('proposal', 'A Title', CREATED, override));

    expect(frontmatter.extra['client']).toBeUndefined();
    expect(frontmatter.extra['status']).toBeUndefined();
  });

  it('should accept an override that is plain markdown with no frontmatter', function () {
    const {frontmatter, body} = parseDoc(
      templateFor('note', 'A Title', CREATED, '# {{title}}\n\nJust prose.'),
    );

    expect(frontmatter.extra).toEqual({});
    expect(body).toBe('# A Title\n\nJust prose.');
  });
});
