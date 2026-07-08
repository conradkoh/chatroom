'use client';

import { memo } from 'react';
import Markdown from 'react-markdown';

import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
import { fullMarkdownComponents } from '../../components/markdown-utils';

const DEFAULT_PROSE_CLASSES =
  'text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={className ?? DEFAULT_PROSE_CLASSES}>
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
        {content}
      </Markdown>
    </div>
  );
});
