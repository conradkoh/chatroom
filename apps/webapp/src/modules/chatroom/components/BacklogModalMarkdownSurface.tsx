'use client';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { backlogModalMarkdownProseClassNames } from './markdown-utils';
export interface BacklogModalMarkdownSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  proseClassName?: string;
  children?: ReactNode;
}
export function BacklogModalMarkdownSurface({ children, className, interactive, proseClassName = backlogModalMarkdownProseClassNames, ...props }: BacklogModalMarkdownSurfaceProps) {
  return <div className={cn('h-full overflow-y-auto overflow-x-hidden p-4 min-w-0', proseClassName, interactive && 'cursor-pointer', className)} {...props}>{children}</div>;
}
