'use client';

import { getWorkQueuePreviewText } from '../../utils/getWorkQueuePreviewText';
import { cn } from '@/lib/utils';

export interface WorkQueuePreviewTextProps {
  content: string;
  lines?: 2 | 3;
  className?: string;
}

export function WorkQueuePreviewText({ content, lines = 2, className }: WorkQueuePreviewTextProps) {
  const text = getWorkQueuePreviewText(content);
  const clampClass = lines === 2 ? 'line-clamp-2' : 'line-clamp-3';
  if (!text) return null;
  return (
    <p
      className={cn(
        'text-xs text-chatroom-text-primary break-words whitespace-pre-wrap',
        clampClass,
        className
      )}
    >
      {text}
    </p>
  );
}
