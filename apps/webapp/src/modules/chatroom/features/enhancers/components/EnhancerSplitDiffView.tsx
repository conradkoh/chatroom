'use client';

import { memo } from 'react';

import type { EnhancerSplitDiffLine, EnhancerSplitDiffPane } from '../types/enhancerDiff';

import { cn } from '@/lib/utils';

interface EnhancerSplitDiffViewProps {
  before: EnhancerSplitDiffPane;
  after: EnhancerSplitDiffPane;
}

const lineClassByType: Record<EnhancerSplitDiffLine['type'], string> = {
  addition: 'bg-green-500/10 text-green-700 dark:text-green-400',
  deletion: 'bg-red-500/10 text-red-700 dark:text-red-400',
  unchanged: 'text-chatroom-text-primary',
  empty: 'bg-chatroom-bg-tertiary/40',
};

const SplitDiffRow = memo(function SplitDiffRow({ line }: { line: EnhancerSplitDiffLine }) {
  return (
    <div className={cn('flex font-mono text-[11px] leading-5', lineClassByType[line.type])}>
      <span className="w-8 shrink-0 select-none border-r border-chatroom-border/50 px-1 text-right text-[10px] text-chatroom-text-muted">
        {line.lineNumber ?? ''}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words px-2">
        {line.type === 'empty' ? '\u00a0' : line.content || ' '}
      </span>
    </div>
  );
});

const SplitDiffPane = memo(function SplitDiffPane({ pane }: { pane: EnhancerSplitDiffPane }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border border-chatroom-border bg-chatroom-bg-primary sm:min-h-0">
      <div className="border-b border-chatroom-border bg-chatroom-bg-tertiary px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
        {pane.label}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {pane.lines.map((line, index) => (
          <SplitDiffRow key={`${pane.label}-${index}`} line={line} />
        ))}
      </div>
    </div>
  );
});

export const EnhancerSplitDiffView = memo(function EnhancerSplitDiffView({
  before,
  after,
}: EnhancerSplitDiffViewProps) {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 sm:flex-row"
      data-testid="enhancer-split-diff-view"
    >
      <SplitDiffPane pane={before} />
      <SplitDiffPane pane={after} />
    </div>
  );
});
