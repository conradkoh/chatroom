'use client';

import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { Message } from '../../types/message';
import {
  compactMarkdownComponents,
  contextSummaryProseClassNames,
} from '../markdown-utils';

import { TIMELINE_ROW_BORDER } from './timelineRowStyles';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

interface TimelineContextMessageProps {
  message: Message;
}

/**
 * Context boundary row — bordered card, not sticky.
 */
export const TimelineContextMessage = memo(function TimelineContextMessage({
  message,
}: TimelineContextMessageProps) {
  return (
    <div
      className={`px-4 py-3 ${TIMELINE_ROW_BORDER} bg-chatroom-bg-primary`}
      data-testid="timeline-context"
    >
      <div className="rounded-md border border-chatroom-status-info/30 bg-chatroom-status-info/5 dark:bg-chatroom-status-info/10 px-3 py-2.5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={12} className="flex-shrink-0 text-chatroom-status-info" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info">
            New Context
          </span>
        </div>
        <div className={`${contextSummaryProseClassNames} line-clamp-4`}>
          <Markdown remarkPlugins={REMARK_PLUGINS} components={compactMarkdownComponents}>
            {message.content}
          </Markdown>
        </div>
      </div>
    </div>
  );
});
