'use client';

import { useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';

interface ThinkingBlockProps {
  content: string;
  className?: string;
}

/**
 * Collapsible block that surfaces the model's reasoning (thinking) tokens.
 * Collapsed by default — the user can expand to inspect the chain of thought.
 */
export function ThinkingBlock({ content, className }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn('rounded-lg border border-border overflow-hidden text-sm', className)}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-muted-foreground hover:bg-accent/50 transition-colors text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDownIcon className="shrink-0 h-3.5 w-3.5" />
        ) : (
          <ChevronRightIcon className="shrink-0 h-3.5 w-3.5" />
        )}
        <span className="text-xs font-medium">Thinking</span>
      </button>

      {expanded && (
        <div className="px-3 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}
