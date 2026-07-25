'use client';

import { Columns2, Rows3 } from 'lucide-react';

import type { EnhancerDiffViewMode } from '../types/enhancerDiff';

import { cn } from '@/lib/utils';

interface EnhancerDiffViewModeToggleProps {
  viewMode: EnhancerDiffViewMode;
  onViewModeChange: (mode: EnhancerDiffViewMode) => void;
}

const TOGGLE_BUTTON_CLASS =
  'flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors';

export function EnhancerDiffViewModeToggle({
  viewMode,
  onViewModeChange,
}: EnhancerDiffViewModeToggleProps) {
  return (
    <div
      className="inline-flex border border-chatroom-border"
      role="group"
      aria-label="Diff view mode"
      data-testid="enhancer-diff-view-mode-toggle"
    >
      <button
        type="button"
        className={cn(
          TOGGLE_BUTTON_CLASS,
          viewMode === 'split'
            ? 'bg-chatroom-bg-hover text-chatroom-text-primary'
            : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary'
        )}
        aria-pressed={viewMode === 'split'}
        data-testid="enhancer-diff-view-split"
        onClick={() => onViewModeChange('split')}
      >
        <Columns2 size={12} />
        Split
      </button>
      <button
        type="button"
        className={cn(
          TOGGLE_BUTTON_CLASS,
          'border-l border-chatroom-border',
          viewMode === 'unified'
            ? 'bg-chatroom-bg-hover text-chatroom-text-primary'
            : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary'
        )}
        aria-pressed={viewMode === 'unified'}
        data-testid="enhancer-diff-view-unified"
        onClick={() => onViewModeChange('unified')}
      >
        <Rows3 size={12} />
        Unified
      </button>
    </div>
  );
}
