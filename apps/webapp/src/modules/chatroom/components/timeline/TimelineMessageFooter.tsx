'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, Copy, Paperclip } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { MessageDownloadMenu } from './MessageDownloadMenu';
import { useAttachments } from '../../attachments';
import { formatHandoffDuration } from '../../timeline/handoffTiming';
import type { Message } from '../../types/message';
import {
  formatTimeOfDay,
  formatTimestamp,
  formatTimestampFull,
} from '../../utils/chatroomTimestamp';

import { cn } from '@/lib/utils';

/** Small copy-to-clipboard button with brief check-mark feedback. */

const CopyMarkdownButton = memo(function CopyMarkdownButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => {
          setCopied(false);
          copyTimeoutRef.current = null;
        }, 2000);
      });
    },
    [content]
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center justify-center w-6 h-6 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
      title="Copy as markdown"
    >
      {copied ? <Check size={12} className="text-chatroom-status-success" /> : <Copy size={12} />}
    </button>
  );
});

export interface TimelineMessageTimestampProps {
  creationTime: number;
  handoffDurationMs?: number;
  /** Collapsed handoff bar: below `sm`, hide the duration and show the time of day only. */
  compact?: boolean;
}

/**
 * The footer's timestamp cluster, also rendered inside the collapsed handoff bar.
 * `compact` keeps the same markup but swaps the full date for the time of day
 * below `sm`, where the summary bar has no room for the date.
 */
const TimelineMessageTimestamp = memo(function TimelineMessageTimestamp({
  creationTime,
  handoffDurationMs,
  compact = false,
}: TimelineMessageTimestampProps) {
  return (
    <>
      {handoffDurationMs !== undefined && (
        <span
          data-testid="timeline-handoff-duration"
          title={`Time since task started: ${formatHandoffDuration(handoffDurationMs)}`}
          className={cn(
            'text-[10px] font-mono tabular-nums text-chatroom-text-muted',
            compact && 'hidden sm:inline'
          )}
        >
          {formatHandoffDuration(handoffDurationMs)}
        </span>
      )}
      <span className="text-[10px] font-mono font-bold tabular-nums text-chatroom-text-muted">
        <span title={formatTimestampFull(creationTime)}>
          {compact ? (
            <>
              <span className="hidden sm:inline">{formatTimestamp(creationTime)}</span>
              <span className="sm:hidden">{formatTimeOfDay(creationTime)}</span>
            </>
          ) : (
            formatTimestamp(creationTime)
          )}
        </span>
      </span>
    </>
  );
});

export interface TimelineMessageFooterProps {
  message: Message;
  /** When set, copy/download use this instead of message.content. */
  displayContent?: string;
  /** Historical duration from the origin task start through this handoff. */
  handoffDurationMs?: number;
}

/**
 * Message footer: copy content, attach-as-context, and creation timestamp.
 * Matches pre-revamp MessageFeed footer UX; timestamp always in footer (not header).
 */
// fallow-ignore-next-line complexity
export const TimelineMessageFooter = memo(function TimelineMessageFooter({
  message,
  displayContent,
  handoffDurationMs,
}: TimelineMessageFooterProps) {
  const markdownContent = displayContent ?? message.content;
  const { add: addAttachment, isAttached } = useAttachments();
  const isAddedToContext = isAttached('message', message._id);

  const handleAddToContext = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      addAttachment({
        type: 'message',
        id: message._id as Id<'chatroom_messages'>,
        content: markdownContent,
        senderRole: message.senderRole,
      });
    },
    [addAttachment, message._id, markdownContent, message.senderRole]
  );

  return (
    <div
      className="flex justify-between items-center mt-2 pt-1.5"
      data-testid="timeline-message-footer"
    >
      <div className="flex items-center gap-1">
        <CopyMarkdownButton content={markdownContent} />
        <button
          type="button"
          onClick={handleAddToContext}
          className="flex items-center justify-center w-6 h-6 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
          title={isAddedToContext ? 'Added to context' : 'Add to context'}
        >
          <Paperclip size={12} />
        </button>
        <MessageDownloadMenu message={message} contentOverride={displayContent} />
      </div>
      <div className="flex items-center gap-1.5">
        <TimelineMessageTimestamp
          creationTime={message._creationTime}
          handoffDurationMs={handoffDurationMs}
        />
      </div>
    </div>
  );
});
