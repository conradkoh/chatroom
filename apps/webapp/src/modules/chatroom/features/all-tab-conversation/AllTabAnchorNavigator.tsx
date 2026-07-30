'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

const navButtonClass = cn(
  'rounded-none w-9 h-9 shrink-0 flex items-center justify-center',
  'border-2 border-chatroom-border',
  'bg-white dark:bg-chatroom-bg-tertiary',
  'text-chatroom-text-primary',
  'hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong',
  'transition-all duration-100',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'disabled:text-chatroom-text-muted',
  'disabled:bg-chatroom-bg-tertiary dark:disabled:bg-chatroom-bg-secondary'
);

export function AllTabAnchorNavigator({
  contentPreview,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  contentPreview: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-2 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface"
      data-testid="all-tab-anchor-navigator"
    >
      <button
        type="button"
        className={navButtonClass}
        onClick={onPrev}
        disabled={!hasPrev}
        aria-label="Previous user message"
      >
        <ChevronLeft size={20} />
      </button>
      <span className="flex-1 truncate text-xs text-chatroom-text-muted">
        {contentPreview ?? 'No user messages'}
      </span>
      <button
        type="button"
        className={navButtonClass}
        onClick={onNext}
        disabled={!hasNext}
        aria-label="Next user message"
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
