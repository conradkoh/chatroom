'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { HandoffActionMarkdownBody } from './HandoffActionMarkdownBody';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';

export interface HandoffCollapsibleSectionProps {
  id: string;
  label: string;
  body: string;
  isOpen: boolean;
  onToggle: () => void;
  useActionMarkdown?: boolean;
}

export const HandoffCollapsibleSection = memo(function HandoffCollapsibleSection({
  id,
  label,
  body,
  isOpen,
  onToggle,
  useActionMarkdown,
}: HandoffCollapsibleSectionProps) {
  return (
    <div
      className="border border-chatroom-border overflow-hidden"
      data-testid={`handoff-section-${id}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:bg-chatroom-bg-hover"
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
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
