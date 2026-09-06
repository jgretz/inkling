import {describe, expect, it} from 'bun:test';
import {docDeletePrompt, groupDeletePrompt} from '../src/lib/deletion.ts';

describe('docDeletePrompt', function () {
  it('should name the document by its title', function () {
    expect(docDeletePrompt('On Endings')).toContain('"On Endings"');
  });

  // Both halves of what a delete does, because only one of them is obvious.
  it('should say the file goes to the Trash and the stored rows do not', function () {
    const prompt = docDeletePrompt('On Endings');

    expect(prompt).toContain('Trash');
    expect(prompt).toContain('is not kept');
  });
});

describe('groupDeletePrompt', function () {
  it('should read as an empty group rather than counting nothing', function () {
    const prompt = groupDeletePrompt('drafts', 0);

    expect(prompt).toContain('holds no documents');
    expect(prompt).not.toContain('0 documents');
  });

  it('should use the singular for one document', function () {
    const prompt = groupDeletePrompt('drafts', 1);

    expect(prompt).toContain('1 document ');
    expect(prompt).not.toContain('1 documents');
  });

  it('should count the documents that go with the group', function () {
    expect(groupDeletePrompt('drafts', 7)).toContain('7 documents');
  });

  it('should name the group', function () {
    expect(groupDeletePrompt('drafts/2026', 2)).toContain('"drafts/2026"');
  });

  it('should say the stored rows are not kept when the group holds documents', function () {
    expect(groupDeletePrompt('drafts', 2)).toContain('is not kept');
  });
});
