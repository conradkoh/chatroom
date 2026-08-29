interface ViewMoreButtonProps {
  count: number;
  onClick: () => void;
}

export function ViewMoreButton({ count, onClick }: ViewMoreButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-full p-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors text-center"
    >
      View More ({count} more items)
    </button>
  );
}
