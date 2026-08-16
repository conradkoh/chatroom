'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { markdownComponents } from './markdown-components';
import type { MarkdownViewerProps } from '../types';

import { cn } from '@/lib/utils';

export function MarkdownViewer({ markdown, className }: MarkdownViewerProps) {
  return (
    <article className={cn('mdx-content w-full', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
