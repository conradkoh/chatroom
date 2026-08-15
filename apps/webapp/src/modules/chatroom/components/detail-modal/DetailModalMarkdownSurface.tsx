'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { detailModalMarkdownProseClassNames } from './detailModalMarkdownStyles';

import { cn } from '@/lib/utils';

export interface DetailModalMarkdownSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  proseClassName?: string;
  children?: ReactNode;
}

/** Shared scroll + prose shell for task/backlog detail modal markdown view mode. */
export function DetailModalMarkdownSurface({
  children,
  className,
  interactive,
  proseClassName = detailModalMarkdownProseClassNames,
  ...props
}: DetailModalMarkdownSurfaceProps) {
  return (
    <div
      className={cn(
        'h-full overflow-y-auto overflow-x-hidden p-4 min-w-0',
        proseClassName,
        interactive && 'cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
