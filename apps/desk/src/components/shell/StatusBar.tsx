type StatusBarProps = {
  /** Something the writer's last action failed at. */
  error?: string;
  /** Something degraded that the writer should know about but need not act on. */
  notice?: string;
};

/**
 * The strip along the bottom of the window. Renders nothing at all when there
 * is nothing to say, so it costs no height in the common case.
 */
export function StatusBar({error, notice}: StatusBarProps) {
  return (
    <>
      {error !== undefined && (
        <div
          role="status"
          className="shrink-0 border-t border-red-900/50 bg-red-950/40 px-4 py-1.5 text-[12px] text-red-300"
        >
          {error}
        </div>
      )}
      {notice !== undefined && (
        <div
          role="status"
          className="shrink-0 border-t border-amber-900/50 bg-amber-950/40 px-4 py-1.5 text-[12px] text-amber-300"
        >
          {notice}
        </div>
      )}
    </>
  );
}
