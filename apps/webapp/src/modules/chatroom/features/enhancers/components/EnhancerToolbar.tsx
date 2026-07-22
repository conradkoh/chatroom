'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EnhancerToolbarProps {
  isActive: boolean;
  disabled?: boolean;
  onOpenConfig: () => void;
}

export function EnhancerToolbar({ isActive, disabled, onOpenConfig }: EnhancerToolbarProps) {
  return (
    <div
      className="flex items-center gap-1 px-2 pt-1.5 pb-0.5 border-b border-chatroom-border/50"
      data-testid="enhancer-toolbar"
    >
      <button
        type="button"
        onClick={onOpenConfig}
        disabled={disabled}
        title={isActive ? 'Enhancer active — click to configure' : 'Configure enhancer'}
        aria-label={isActive ? 'Enhancer active' : 'Configure enhancer'}
        aria-pressed={isActive}
        className={cn(
          'p-1.5 rounded-none transition-colors',
          isActive
            ? 'text-chatroom-accent bg-chatroom-accent/10'
            : 'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
        )}
      >
        <Sparkles size={16} />
      </button>
    </div>
  );
}
