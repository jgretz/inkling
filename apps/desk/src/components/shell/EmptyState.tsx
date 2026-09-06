type EmptyStateProps = {
  title: string;
  detail: string;
  action?: {label: string; onClick: () => void};
};

/** The one placeholder in the app: no vault, or no document open. */
export function EmptyState({title, detail, action}: EmptyStateProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-ink-900 px-8 text-center">
      <h2 className="font-[family-name:var(--font-prose)] text-lg text-ink-200">{title}</h2>
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-400">{detail}</p>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-ink-950 transition-opacity duration-100 hover:opacity-90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
