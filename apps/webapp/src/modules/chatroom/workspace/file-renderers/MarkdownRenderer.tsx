'use client';

import { memo } from 'react';
import Markdown from 'react-markdown';

import { chatroomRemarkPlugins } from '../../components/chatroomRemarkPlugins';
import { fullMarkdownComponents, proseClassNames } from '../../components/markdown-utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={className ?? proseClassNames}>
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
        {content}
      </Markdown>
    </div>
  );
});
