'use client';

import {
  getWorkQueuePreviewSegments,
  formatWorkQueuePreviewPlainText,
} from '../../utils/getWorkQueuePreviewSegments';
import { cn } from '@/lib/utils';

export interface WorkQueuePreviewTextProps {
  content: string;
  lines?: 2 | 3;
  className?: string;
}

export function WorkQueuePreviewText({ content, lines = 2, className }: WorkQueuePreviewTextProps) {
  const segments = getWorkQueuePreviewSegments(content);
  const plainText = formatWorkQueuePreviewPlainText(segments);
  if (!plainText) return null;
  const clampClass = lines === 2 ? 'line-clamp-2' : 'line-clamp-3';
  return (
    <p className={cn('text-xs text-chatroom-text-primary break-words', clampClass, className)}>
      {segments.map((seg, i) => (
        <span key={i} className={seg.bold ? 'font-semibold' : undefined}>
          {seg.text}
        </span>
      ))}
    </p>
  );
}
