import {describe, expect, it} from 'bun:test';
import {blocksOf, countWords, sentencesOf} from '../src/sentences.ts';

function sentences(text: string): string[] {
  const blocks = blocksOf(text);
  return sentencesOf(text, blocks).map(function (sentence) {
    return text.slice(sentence.start, sentence.end);
  });
}

describe('countWords', function () {
  it('should count anything with a letter or a digit', function () {
    expect(countWords('one two 3 --')).toBe(3);
  });

  it('should return zero for whitespace', function () {
    expect(countWords('   \n  ')).toBe(0);
  });
});

describe('blocksOf', function () {
  it('should split paragraphs on a blank line', function () {
    const blocks = blocksOf('One line.\nStill one.\n\nA second.');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('should make a heading its own block and record its level', function () {
    const blocks = blocksOf('### Third level\nProse right underneath.');

    expect(blocks[0]?.kind).toBe('heading');
    expect(blocks[0]?.level).toBe(3);
    expect(blocks[1]?.kind).toBe('paragraph');
  });

  it('should start a new block at each list item', function () {
    const blocks = blocksOf('- first item\n- second item\n- third item');

    expect(blocks).toHaveLength(3);
  });

  it('should ignore a line holding only a masked region', function () {
    expect(blocksOf('Prose.\n\n \n\nMore prose.')).toHaveLength(2);
  });
});

describe('sentencesOf', function () {
  it('should split on a full stop followed by whitespace', function () {
    expect(sentences('One here. Two there.')).toEqual(['One here.', 'Two there.']);
  });

  it('should keep a closing quote with the sentence it ends', function () {
    expect(sentences('He said "no." She left.')).toEqual(['He said "no."', 'She left.']);
  });

  it('should not split on an abbreviation', function () {
    expect(sentences('Ask Dr. Pinker first.')).toEqual(['Ask Dr. Pinker first.']);
  });

  it('should not split on a lone initial', function () {
    expect(sentences('Read J. R. R. Tolkien again.')).toEqual(['Read J. R. R. Tolkien again.']);
  });

  it('should not split on a decimal point', function () {
    expect(sentences('Roadmap item 1.1 comes first.')).toEqual(['Roadmap item 1.1 comes first.']);
  });

  it('should take the last sentence when it has no terminator', function () {
    expect(sentences('Done. Not done')).toEqual(['Done.', 'Not done']);
  });

  it('should drop a heading’s hashes from its sentence', function () {
    expect(sentences('## What the panels are for')).toEqual(['What the panels are for']);
  });

  it('should count words per sentence', function () {
    const text = 'Three words here. Two words.';

    const counts = sentencesOf(text, blocksOf(text)).map(function (sentence) {
      return sentence.words;
    });

    expect(counts).toEqual([3, 2]);
  });

  it('should tag each sentence with the block it belongs to', function () {
    const text = '# Title\n\nA sentence.';

    const indexes = sentencesOf(text, blocksOf(text)).map(function (sentence) {
      return sentence.blockIndex;
    });

    expect(indexes).toEqual([0, 1]);
  });
});
