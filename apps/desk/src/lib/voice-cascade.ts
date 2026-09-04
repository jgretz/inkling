import {parseDoc, type DocPath} from '@inkling/vault';
import {parseRuleSet, type VoiceRuleSet} from '@inkling/voice';

/**
 * The cascade of voice rule sets that governs one document.
 *
 * A rule set is a plain markdown file the writer edits, named `voice.md`,
 * sitting in the directory it governs. It is visible in the library and opens
 * in inkling's own editor precisely because it is not hidden: `list_docs` skips
 * dotted files, so `.voice.md` would be a file the app could never show.
 *
 * Groups are directories, so the cascade is read straight out of the
 * document's path: the vault root first, then each ancestor directory, then the
 * document's own `voice:` frontmatter key. The last level to mention a rule or
 * a threshold wins it.
 *
 * No filesystem read happens here. The vault scan already loaded every
 * document's body into `workspace.sources`, so every level is a map lookup.
 */

/** The one filename a rule set may have, at every level of the cascade. */
export const RULE_SET_FILE = 'voice.md';

/** The document frontmatter key that carries a document's own rule set. */
const DOCUMENT_KEY = 'voice';

/**
 * Every directory that contains the document, the vault root first.
 *
 * The root is the empty string, which is what makes the join below produce a
 * bare `voice.md` for it.
 */
function ancestorDirs(docPath: string): string[] {
  const segments = docPath.split('/').filter(Boolean);
  const dirs = segments.slice(0, -1);

  return dirs.reduce<string[]>(
    function (paths, segment) {
      const parent = paths[paths.length - 1] ?? '';
      return [...paths, parent === '' ? segment : `${parent}/${segment}`];
    },
    [''],
  );
}

/** Where a document's rule sets live, root first, nearest last. */
export function ruleSetPathsFor(docPath: DocPath): DocPath[] {
  return ancestorDirs(docPath).map(function (dir) {
    return (dir === '' ? RULE_SET_FILE : `${dir}/${RULE_SET_FILE}`) as DocPath;
  });
}

/** Names the file a problem came from, since a cascade spans several. */
function attribute(path: string, problems: readonly string[]): string[] {
  return problems.map(function (problem) {
    return `${path}: ${problem}`;
  });
}

/**
 * Reads the cascade for a document, root first and the document itself last.
 *
 * The document level comes from the **live draft** rather than from `sources`,
 * which holds what was on disk at the last vault scan: a writer who turns a
 * rule off in their frontmatter should see it take effect as they type, not at
 * the next save.
 *
 * A document that is itself a `voice.md` has its own frontmatter applied twice,
 * once as its directory's rule set and once as its own. That is idempotent
 * under last-wins, so it is not special-cased.
 */
export function cascadeFor(
  docPath: DocPath,
  draft: string,
  sources: ReadonlyMap<DocPath, string>,
): {sets: VoiceRuleSet[]; problems: string[]} {
  const levels = ruleSetPathsFor(docPath).flatMap(function (path) {
    const source = sources.get(path);
    if (source === undefined) return [];
    const {frontmatter, body} = parseDoc(source);
    const parsed = parseRuleSet(frontmatter.extra, body);
    return [{path: path as string, ...parsed}];
  });

  const own = parseRuleSet(parseDoc(draft).frontmatter.extra[DOCUMENT_KEY], '');

  return {
    sets: [
      ...levels.map(function (level) {
        return level.ruleSet;
      }),
      own.ruleSet,
    ],
    problems: [
      ...levels.flatMap(function (level) {
        return attribute(level.path, level.problems);
      }),
      ...attribute(docPath, own.problems),
    ],
  };
}

/**
 * What to tell the writer when a rule set does not say what they think it says.
 *
 * A broken rule set is reported rather than swallowed: its whole purpose is to
 * change what the checker does, and one that silently does nothing is worse
 * than no rule set at all. Only the first problem is shown, because the status
 * bar is one line and fixing the first usually fixes the rest.
 */
export function voiceNotice(problems: readonly string[]): string | undefined {
  const first = problems[0];
  if (first === undefined) return undefined;
  const rest = problems.length - 1;

  return `Voice rules: ${first}${rest > 0 ? ` (and ${rest} more)` : ''}`;
}
