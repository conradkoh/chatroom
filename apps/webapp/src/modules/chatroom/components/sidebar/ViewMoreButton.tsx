interface ViewMoreButtonProps {
  count: number;
  onClick: () => void;
  /** Replaces the default "View More (n more items)" text (e.g. a capped list). */
  label?: string;
}

export function ViewMoreButton({ count, onClick, label }: ViewMoreButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-full p-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors text-center"
    >
      {label ?? `View More (${count} more items)`}
    </button>
  );
}
