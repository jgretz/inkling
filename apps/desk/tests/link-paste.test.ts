import {describe, expect, it} from 'bun:test';
import {extractLinks, linkPasteSummary} from '../src/lib/link-paste.ts';

/**
 * The paste that made this feature exist, verbatim from the session that found
 * it. Real input, so the assertions below are about what a writer actually
 * pasted rather than about a shape convenient to parse.
 */
const PASTE = `here is a set of links to add as context to this document [93% of Developers Use AI - Productivity Only 10%](https://shiftmag.dev/this-cto-says-93-of-developers-use-ai-but-productivity-is-still-10-8013/)
[The Agentic Platform for Product Engineers](https://www.kasava.dev/blog/ai-as-exoskeleton)
https://jeremyjenkins.me/blog/software-trades/
[We Automated Everything Except Knowing What's Going On](https://eversole.dev/blog/we-automated-everything/)
https://atono.substack.com/p/why-your-team-is-slower-than-last?aid=recmWxnSbaI8mF8mP
...`;

describe('extractLinks', function () {
  it('should find every link in the paste, in the order they appear', function () {
    const {links} = extractLinks(PASTE);

    expect(
      links.map(function (link) {
        return link.url;
      }),
    ).toEqual([
      'https://shiftmag.dev/this-cto-says-93-of-developers-use-ai-but-productivity-is-still-10-8013/',
      'https://www.kasava.dev/blog/ai-as-exoskeleton',
      'https://jeremyjenkins.me/blog/software-trades/',
      'https://eversole.dev/blog/we-automated-everything/',
      'https://atono.substack.com/p/why-your-team-is-slower-than-last?aid=recmWxnSbaI8mF8mP',
    ]);
  });

  it('should keep the titles the writer wrote, exactly as they wrote them', function () {
    const {links} = extractLinks(PASTE);

    const named = links.filter(function (link) {
      return !link.derived;
    });

    expect(
      named.map(function (link) {
        return link.title;
      }),
    ).toEqual([
      '93% of Developers Use AI - Productivity Only 10%',
      'The Agentic Platform for Product Engineers',
      "We Automated Everything Except Knowing What's Going On",
    ]);
  });

  it('should derive an obviously mechanical title for a bare URL', function () {
    const {links} = extractLinks(PASTE);

    const derived = links.filter(function (link) {
      return link.derived;
    });

    expect(derived).toEqual([
      {
        url: 'https://jeremyjenkins.me/blog/software-trades/',
        title: 'jeremyjenkins.me/software-trades',
        derived: true,
      },
      {
        url: 'https://atono.substack.com/p/why-your-team-is-slower-than-last?aid=recmWxnSbaI8mF8mP',
        title: 'atono.substack.com/why-your-team-is-slower-than-last',
        derived: true,
      },
    ]);
  });

  it('should count the one line of the paste that held no link at all', function () {
    const {ignoredLines} = extractLinks(PASTE);

    expect(ignoredLines).toBe(1);
  });

  it('should turn no part of the opening sentence into a reference', function () {
    const {links} = extractLinks(PASTE);

    expect(links).toHaveLength(5);
    expect(
      links.some(function (link) {
        return link.title.includes('here is a set of links');
      }),
    ).toBe(false);
  });

  it('should leave the full stop off a URL that ends a sentence', function () {
    const {links} = extractLinks('See https://example.com/a.');

    expect(links).toEqual([{url: 'https://example.com/a', title: 'example.com/a', derived: true}]);
  });

  it('should keep a query string, which is part of the address', function () {
    const {links} = extractLinks('https://example.com/a?ref=b&utm=c');

    expect(links[0]?.url).toBe('https://example.com/a?ref=b&utm=c');
  });

  it('should attach the same URL once when a paste holds it twice', function () {
    const {links} = extractLinks(
      '[The piece](https://example.com/a)\nhttps://example.com/a\nhttps://example.com/b',
    );

    expect(
      links.map(function (link) {
        return link.url;
      }),
    ).toEqual(['https://example.com/a', 'https://example.com/b']);
    // The writer's own words for it survive the bare repeat below them.
    expect(links[0]?.title).toBe('The piece');
  });

  it('should not count a line as ignored when its only link is a repeat', function () {
    const {ignoredLines} = extractLinks('https://example.com/a\nhttps://example.com/a');

    expect(ignoredLines).toBe(0);
  });

  it('should ignore a markdown link that names something other than the web', function () {
    const {links, ignoredLines} = extractLinks('[local](notes/a.md)');

    expect(links).toEqual([]);
    expect(ignoredLines).toBe(1);
  });

  it('should ignore an address whose scheme is not http or https', function () {
    const {links, ignoredLines} = extractLinks('mailto:someone@example.com\nftp://example.com/a');

    expect(links).toEqual([]);
    expect(ignoredLines).toBe(2);
  });

  it('should ignore a bare host with no scheme rather than guessing one', function () {
    const {links, ignoredLines} = extractLinks('www.example.com is worth reading');

    expect(links).toEqual([]);
    expect(ignoredLines).toBe(1);
  });

  it('should count no ignored lines for a paste that is entirely blank', function () {
    expect(extractLinks('\n\n   \n')).toEqual({links: [], ignoredLines: 0});
  });

  it('should fall back to the host when the address names no path', function () {
    const {links} = extractLinks('https://example.com');

    expect(links[0]?.title).toBe('example.com');
  });

  it('should read a percent-encoded path segment back as the writer would', function () {
    const {links} = extractLinks('https://example.com/notes/on%20endings');

    expect(links[0]?.title).toBe('example.com/on endings');
  });
});

describe('linkPasteSummary', function () {
  it('should name both counts when links landed and links were already there', function () {
    expect(linkPasteSummary({attached: 3, skipped: 2, ignored: 1})).toBe(
      'Attached 3 links. 2 were already there. 1 line had no link.',
    );
  });

  it('should say each count in the singular when it is one', function () {
    expect(linkPasteSummary({attached: 1, skipped: 1, ignored: 1})).toBe(
      'Attached 1 link. 1 was already there. 1 line had no link.',
    );
  });

  it('should leave a zero count out rather than printing it', function () {
    const summary = linkPasteSummary({attached: 4, skipped: 0, ignored: 0});

    expect(summary).toBe('Attached 4 links.');
    expect(summary).not.toContain('0');
  });

  it('should say nothing landed rather than reporting zero attached', function () {
    expect(linkPasteSummary({attached: 0, skipped: 5, ignored: 0})).toBe(
      'Nothing new to attach. 5 were already there.',
    );
  });
});
