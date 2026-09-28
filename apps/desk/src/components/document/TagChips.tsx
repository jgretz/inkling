/** A chip's shape without its text treatment, for a chip that is not a tag. */
export const CHIP_SHAPE = 'rounded-full bg-ink-800 px-2 py-0.5 text-[10px] tracking-wide';

/**
 * A document's tags as chips. Read shows them above the prose and Live shows
 * them in place of the frontmatter block, so the two cannot drift apart.
 */
export function TagChips({tags}: {tags: readonly string[]}) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map(function (tag) {
        return (
          <span key={tag} className={`${CHIP_SHAPE} uppercase text-ink-400`}>
            {tag}
          </span>
        );
      })}
    </div>
  );
}
