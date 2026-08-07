'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';

const navButtonClass = cn(
  'rounded-none shrink-0 flex items-center gap-1 h-7 md:h-9 px-2 md:px-2.5',
  'bg-chatroom-accent text-chatroom-text-on-accent',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'disabled:bg-chatroom-bg-tertiary disabled:text-chatroom-text-muted',
  'dark:disabled:bg-chatroom-bg-secondary dark:disabled:text-chatroom-text-muted'
);

const navLabelClass = 'text-[10px] font-bold uppercase tracking-wide leading-none';

export function AllTabAnchorNavigator({
  hasPrev,
  hasNext,
  isOnLatestAnchor,
  isLoading = false,
  onPrev,
  onNext,
  onJumpToLatest,
}: {
  hasPrev: boolean;
  hasNext: boolean;
  isOnLatestAnchor: boolean;
  isLoading?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onJumpToLatest: () => void;
}) {
  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-1 md:py-2 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface"
      data-testid="all-tab-anchor-navigator"
    >
      <button
        type="button"
        className={navButtonClass}
        onClick={onPrev}
        disabled={isLoading || !hasPrev}
        aria-label="Previous user message"
      >
        <ArrowLeft className="h-3.5 w-3.5 md:h-3.5 md:w-3.5" strokeWidth={2.5} />
        <span className={navLabelClass}>Prev</span>
      </button>
      <button
        type="button"
        className={cn(
          'flex-1 min-w-0 rounded-none h-7 md:h-9 px-2 text-[10px] md:text-xs font-bold uppercase tracking-wide leading-none',
          isOnLatestAnchor
            ? 'bg-chatroom-bg-tertiary text-chatroom-text-muted cursor-not-allowed opacity-50 dark:bg-chatroom-bg-secondary'
            : 'bg-chatroom-accent text-chatroom-text-on-accent hover:bg-chatroom-accent/90'
        )}
        onClick={onJumpToLatest}
        disabled={isLoading || isOnLatestAnchor}
        aria-label="Jump to latest"
      >
        Jump to latest
      </button>
      <button
        type="button"
        className={navButtonClass}
        onClick={onNext}
        disabled={isLoading || !hasNext}
        aria-label="Next user message"
      >
        <span className={navLabelClass}>Next</span>
        <ArrowRight className="h-3.5 w-3.5 md:h-3.5 md:w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
