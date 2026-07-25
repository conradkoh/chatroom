'use client';

import { memo } from 'react';

import type { EnhancerUnifiedDiffLine } from '../types/enhancerDiff';

import { cn } from '@/lib/utils';

interface EnhancerUnifiedDiffViewProps {
  lines: EnhancerUnifiedDiffLine[];
}

const lineClassByType: Record<EnhancerUnifiedDiffLine['type'], string> = {
  addition: 'bg-green-500/10 text-green-700 dark:text-green-400',
  deletion: 'bg-red-500/10 text-red-700 dark:text-red-400',
  unchanged: 'text-chatroom-text-primary',
};

const prefixByType: Record<EnhancerUnifiedDiffLine['type'], string> = {
  addition: '+',
  deletion: '-',
  unchanged: ' ',
};

const UnifiedDiffRow = memo(function UnifiedDiffRow({ line }: { line: EnhancerUnifiedDiffLine }) {
  return (
    <div className={cn('flex font-mono text-[11px] leading-5', lineClassByType[line.type])}>
      <span className="w-4 shrink-0 select-none text-chatroom-text-muted">
        {prefixByType[line.type]}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words px-2">
        {line.content || ' '}
      </span>
    </div>
  );
});

export const EnhancerUnifiedDiffView = memo(function EnhancerUnifiedDiffView({
  lines,
}: EnhancerUnifiedDiffViewProps) {
  return (
    <div
      className="h-full min-h-0 flex-1 overflow-auto border border-chatroom-border bg-chatroom-bg-primary"
      data-testid="enhancer-unified-diff-view"
    >
      {lines.map((line, index) => (
        <UnifiedDiffRow key={`${line.type}-${index}`} line={line} />
      ))}
    </div>
  );
});
