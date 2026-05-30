'use client';

import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import type { Message } from '../../types/message';
import { compactMarkdownComponents } from '../markdown-utils';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

interface TimelineContextMessageProps {
  message: Message;
}

/**
 * Context boundary row — horizontal-line divider (non-sticky, visual only).
 */
export const TimelineContextMessage = memo(function TimelineContextMessage({
  message,
}: TimelineContextMessageProps) {
  return (
    <div
      className="bg-chatroom-bg-primary border-b-2 border-chatroom-border px-4 py-3"
      data-testid="timeline-context"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-chatroom-status-info/30" />
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info bg-chatroom-status-info/10 border border-chatroom-status-info/30 min-w-0 overflow-hidden">
          <Sparkles size={10} className="flex-shrink-0" />
          <span className="flex-shrink-0">New Context</span>
          <span className="text-chatroom-status-info/50 flex-shrink-0">—</span>
          <span className="normal-case font-medium tracking-normal flex-1 min-w-0 truncate text-chatroom-text-secondary [&_*]:inline">
            <Markdown remarkPlugins={REMARK_PLUGINS} components={compactMarkdownComponents}>
              {message.content}
            </Markdown>
          </span>
        </div>
        <div className="flex-1 h-px bg-chatroom-status-info/30" />
      </div>
    </div>
  );
});
