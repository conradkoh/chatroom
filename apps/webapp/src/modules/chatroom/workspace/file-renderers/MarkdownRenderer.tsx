'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { memo } from 'react';

// Stable plugin array — avoids creating a new reference each render
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className ?? 'prose prose-sm dark:prose-invert max-w-none text-chatroom-text-primary'}>
      <Markdown remarkPlugins={REMARK_PLUGINS}>{content}</Markdown>
    </div>
  );
});
