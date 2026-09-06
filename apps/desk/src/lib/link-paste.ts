/**
 * Pulling the links out of a paste, and saying what happened to it afterwards.
 *
 * A writer starting a piece pastes the dozen things they have already read:
 * a sentence of prose, then markdown links and bare URLs one per line, some
 * carrying query strings, and a trailing line that is not a link at all. This
 * module turns that into references and a count of what it ignored.
 *
 * Pure, and it may not name `bridge.ts`, for the reason `references.ts` gives
 * at its top: that file imports `@tauri-apps/api`, which a test with no webview
 * cannot load. Nothing here fetches anything either, which is why a bare URL
 * gets a title derived from its own address rather than the page's.
 */

/** One link found in a paste, ready to be attached. */
export type PastedLink = {
  /** The address, normalised through `URL` so two spellings collapse to one. */
  url: string;
  title: string;
  /**
   * True when nothing in the paste named this link, so the title was made out
   * of the address. Counted by `linkPasteTally` and shown before the write, so
   * a writer sees how many machine-made titles they are about to attach.
   */
  derived: boolean;
};

export type ExtractedLinks = {
  links: PastedLink[];
  /** Non-blank lines that produced no link at all, so nothing vanishes uncounted. */
  ignoredLines: number;
};

/** What the status bar says once the write has landed. */
export type LinkPasteCounts = {
  attached: number;
  skipped: number;
  ignored: number;
};

/**
 * A markdown link, or a bare address.
 *
 * The markdown alternative is first on purpose: `[title](url)` matches as a
 * unit, so the bare-URL branch never re-reads the address inside one and emits
 * it a second time with no title. Its target takes a bracketed run whole, so a
 * Wikipedia address is not cut off at the bracket its own title opened, and
 * stops at `>` so the `[title](<url>)` spelling still hands over the address
 * rather than the angle bracket after it.
 *
 * The bare branch matches brackets and hands the balancing to `trimEnclosing`,
 * because at that point there is no telling a bracket in the address from the
 * one the sentence wrapped it in.
 */
const CANDIDATE =
  /\[([^\]\n]*)\]\(\s*<?((?:[^\s()>]|\([^\s()>]*\))+)>?\s*\)|(https?:\/\/[^\s<>[\]]+)/g;

/** Sentence punctuation that ends a line but is not part of the address. */
const TRAILING = /[.,;:!?'"]+$/;

/** How many times a character appears, for weighing brackets against each other. */
function occurrences(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * The address with whatever the sentence around it left on the end taken off.
 *
 * Brackets are part of plenty of real addresses, Wikipedia's disambiguated
 * titles being the everyday case, so a closing one is dropped only when the
 * address never opened it: that bracket belongs to the prose that wrapped it.
 * Punctuation and brackets interleave, so `(see https://example.com/a.)` needs
 * both taken off in turn until nothing more comes away.
 */
function trimEnclosing(candidate: string): string {
  const punctuated = candidate.replace(TRAILING, '');
  const unbalanced =
    punctuated.endsWith(')') && occurrences(punctuated, ')') > occurrences(punctuated, '(');
  const trimmed = unbalanced ? punctuated.slice(0, -1) : punctuated;
  return trimmed === candidate ? trimmed : trimEnclosing(trimmed);
}

/**
 * The address as `URL` spells it, or nothing at all.
 *
 * The single-argument form is deliberate: `new URL(x, base)` is lenient in bun
 * and resolves nonsense against the base instead of throwing, so a two-argument
 * check would let `notes/a.md` through as a link.
 */
function addressOf(candidate: string): string | undefined {
  const trimmed = trimEnclosing(candidate.trim());
  if (trimmed.length === 0) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * A title made out of the address, for a link nobody named.
 *
 * Host and last path segment, `www.` dropped and the segment percent-decoded.
 * It reads as machine-made, which is the point: without fetching the page there
 * is no real title, and a plausible invented one is worse than an obvious
 * placeholder the writer can see and replace.
 */
function derivedTitle(href: string): string {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === undefined) return host;
  return `${host}/${decode(last)}`;
}

/** A percent-encoded segment as it was written, or as it stands if it will not decode. */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Every link in a paste, in the order it appears, and how many lines held none.
 *
 * The first spelling of an address wins: the same URL twice in one paste is one
 * reference, and a markdown title earlier in the paste is not thrown away by a
 * bare repeat of the same address later.
 */
export function extractLinks(text: string): ExtractedLinks {
  const links: PastedLink[] = [];
  const seen = new Set<string>();
  let ignoredLines = 0;

  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    let found = 0;

    for (const match of line.matchAll(CANDIDATE)) {
      const [, markdownTitle, markdownUrl, bareUrl] = match;
      const url = addressOf(markdownUrl ?? bareUrl ?? '');
      if (url === undefined) continue;
      found += 1;
      if (seen.has(url)) continue;
      seen.add(url);

      const named = markdownTitle?.trim() ?? '';
      links.push(
        named.length > 0
          ? {url, title: named, derived: false}
          : {url, title: derivedTitle(url), derived: true},
      );
    }

    if (found === 0) ignoredLines += 1;
  }

  return {links, ignoredLines};
}

/** `1 link` or `2 links`, so a count never reads as a template that leaked. */
function links(count: number): string {
  return count === 1 ? '1 link' : `${count} links`;
}

/**
 * What the field says about a paste while it is still the writer's to edit.
 *
 * The derived count is why `derived` is on the type at all: a title made out of
 * an address is not the page's own, and the writer should be able to tell how
 * many of those they are about to attach before they attach them, while adding
 * a markdown title is still a matter of typing one. Nothing is said when there
 * are none, which is the paste that needs no explaining.
 */
export function linkPasteTally(found: readonly PastedLink[]): string {
  const derived = found.filter(function (link) {
    return link.derived;
  }).length;
  const counted = `${links(found.length)} found`;
  if (derived === 0) return counted;
  return `${counted}, ${derived === 1 ? '1 title' : `${derived} titles`} derived`;
}

/**
 * What happened, in one line for the status bar's `info` channel.
 *
 * A zero is left out rather than printed: "0 were already there" is noise on
 * the common paste. Nothing attached at all is its own sentence, because
 * "Attached 0 links" reads like a failure the writer has to interpret.
 */
export function linkPasteSummary({attached, skipped, ignored}: LinkPasteCounts): string {
  const clauses: string[] = [];
  clauses.push(attached === 0 ? 'Nothing new to attach.' : `Attached ${links(attached)}.`);
  if (skipped > 0) {
    clauses.push(skipped === 1 ? '1 was already there.' : `${skipped} were already there.`);
  }
  if (ignored > 0) {
    clauses.push(ignored === 1 ? '1 line had no link.' : `${ignored} lines had no link.`);
  }
  return clauses.join(' ');
}
