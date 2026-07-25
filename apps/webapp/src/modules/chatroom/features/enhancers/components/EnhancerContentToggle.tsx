'use client';

import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

interface EnhancerContentToggleProps {
  showOriginal: boolean;
  onToggle: () => void;
}

export function EnhancerContentToggle({ showOriginal, onToggle }: EnhancerContentToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'flex items-center justify-center w-6 h-6 shrink-0 rounded-none',
        'hover:bg-chatroom-bg-hover transition-colors',
        showOriginal ? 'text-chatroom-text-muted' : 'text-chatroom-accent'
      )}
      title={showOriginal ? 'Show enhanced version' : 'Show original version'}
      aria-label={showOriginal ? 'Show enhanced version' : 'Show original version'}
      aria-pressed={showOriginal}
      data-testid="enhancer-content-toggle"
    >
      <Sparkles size={12} />
    </button>
  );
}
