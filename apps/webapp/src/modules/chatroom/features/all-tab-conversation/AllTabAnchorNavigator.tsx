'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';

const navButtonClass = cn(
  'rounded-none shrink-0 flex items-center gap-1 h-9 px-2.5',
  'bg-chatroom-accent text-chatroom-text-on-accent',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'disabled:bg-chatroom-bg-tertiary disabled:text-chatroom-text-muted',
  'dark:disabled:bg-chatroom-bg-secondary dark:disabled:text-chatroom-text-muted'
);

const navLabelClass = 'text-[10px] font-bold uppercase tracking-wide leading-none';

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
        <ArrowLeft size={14} strokeWidth={2.5} />
        <span className={navLabelClass}>Prev</span>
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
        <span className={navLabelClass}>Next</span>
        <ArrowRight size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}
