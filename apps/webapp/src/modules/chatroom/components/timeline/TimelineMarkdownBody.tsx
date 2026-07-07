'use client';

import { memo } from 'react';
import Markdown from 'react-markdown';

import { chatroomRemarkPlugins } from '../chatroomRemarkPlugins';
import { fullMarkdownComponents, messageFeedProseClassNames } from '../markdown-utils';

interface TimelineMarkdownBodyProps {
  content: string;
  className?: string;
}

/** Compact feed markdown body shared by user and team timeline rows. */
export const TimelineMarkdownBody = memo(function TimelineMarkdownBody({
  content,
  className = messageFeedProseClassNames,
}: TimelineMarkdownBodyProps) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={fullMarkdownComponents}>
        {content}
      </Markdown>
    </div>
  );
});
