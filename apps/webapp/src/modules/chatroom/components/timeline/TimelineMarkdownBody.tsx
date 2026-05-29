'use client';

import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { fullMarkdownComponents, messageFeedProseClassNames } from '../markdown-utils';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

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
      <Markdown remarkPlugins={REMARK_PLUGINS} components={fullMarkdownComponents}>
        {content}
      </Markdown>
    </div>
  );
});
