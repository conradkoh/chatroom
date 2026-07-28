'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { HandoffActionMarkdownBody } from './HandoffActionMarkdownBody';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { cn } from '@/lib/utils';

export interface HandoffCollapsibleSectionProps {
  id: string;
  label: string;
  body: string;
  isOpen: boolean;
  onToggle: () => void;
  useActionMarkdown?: boolean;
  subsectionCount?: number;
  /** undefined = neutral/legacy styling; true = empty; false = populated */
  isEmpty?: boolean;
}

export const HandoffCollapsibleSection = memo(function HandoffCollapsibleSection({
  id,
  label,
  body,
  isOpen,
  onToggle,
  useActionMarkdown,
  subsectionCount,
  isEmpty,
}: HandoffCollapsibleSectionProps) {
  const displayLabel = subsectionCount !== undefined ? `${label} (${subsectionCount})` : label;
  return (
    <div
      className={cn(
        'border overflow-hidden',
        isEmpty === true && 'border-chatroom-border/50',
        isEmpty === false && 'border-chatroom-border',
        isEmpty === undefined && 'border-chatroom-border'
      )}
      data-testid={`handoff-section-${id}`}
      data-empty={isEmpty === undefined ? undefined : isEmpty}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-1.5 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider',
          isEmpty === undefined && 'text-chatroom-text-muted hover:bg-chatroom-bg-hover',
          isEmpty === false &&
            'bg-chatroom-bg-tertiary text-chatroom-text-secondary hover:bg-chatroom-bg-hover',
          isEmpty === true &&
            'bg-transparent text-chatroom-text-muted/60 hover:bg-chatroom-bg-hover/30'
        )}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {displayLabel}
      </button>
      {isOpen && (
        <div className="px-3 py-2 border-t border-chatroom-border">
          {useActionMarkdown ? (
            <HandoffActionMarkdownBody content={body} />
          ) : (
            <TimelineMarkdownBody content={body} />
          )}
        </div>
      )}
    </div>
  );
});
