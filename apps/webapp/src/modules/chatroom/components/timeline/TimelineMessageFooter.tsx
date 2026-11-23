'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, Copy, Paperclip } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { MessageDownloadMenu } from './MessageDownloadMenu';
import { TimelineSenderAgentChip } from './TimelineMessageIdentity';
import {
  TIMELINE_FOOTER_TIMESTAMP,
  TIMELINE_HANDOFF_DURATION_SLOT,
  TIMELINE_HANDOFF_FOOTER,
  TIMELINE_HANDOFF_FOOTER_AGENT_ROW,
  TIMELINE_HANDOFF_FOOTER_TIME_ROW,
  TIMELINE_HANDOFF_TIMESTAMP,
} from './timelineRowStyles';
import { useAttachments } from '../../attachments';
import { formatHandoffDuration, formatHandoffDurationTitle } from '../../timeline/handoffTiming';
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
  /** Whether the duration is much longer than others in the loaded window (orange). */
  handoffDurationSlow?: boolean;
  /** Collapsed handoff bar: below `sm`, show the time of day instead of the full date. */
  compact?: boolean;
  /** Handoff rows only: timestamp then a fixed 7ch duration slot that renders even when empty. */
  alignDuration?: boolean;
}

/**
 * Timestamp cluster: the timestamp comes first, then the duration. `alignDuration` wraps the
 * duration in TIMELINE_HANDOFF_DURATION_SLOT so the slot is always present and the timestamp
 * column does not move. Without it, the markup is the pre-existing non-handoff markup.
 */
// fallow-ignore-next-line complexity
export const TimelineMessageTimestamp = memo(function TimelineMessageTimestamp({
  creationTime,
  handoffDurationMs,
  handoffDurationSlow,
  compact = false,
  alignDuration = false,
}: TimelineMessageTimestampProps) {
  const timestamp = (
    <span className={alignDuration ? TIMELINE_HANDOFF_TIMESTAMP : TIMELINE_FOOTER_TIMESTAMP}>
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
  );
  const duration =
    handoffDurationMs !== undefined ? (
      <span
        data-testid="timeline-handoff-duration"
        data-duration-tone={handoffDurationSlow ? 'slow' : 'normal'}
        title={formatHandoffDurationTitle(handoffDurationMs, Boolean(handoffDurationSlow))}
        className={cn(
          'text-[10px] font-mono tabular-nums whitespace-nowrap',
          handoffDurationSlow ? 'text-chatroom-status-slow' : 'text-chatroom-text-muted'
        )}
      >
        {formatHandoffDuration(handoffDurationMs)}
      </span>
    ) : null;
  return (
    <>
      {timestamp}
      {alignDuration ? (
        <span
          data-testid="timeline-handoff-duration-slot"
          className={TIMELINE_HANDOFF_DURATION_SLOT}
        >
          {duration}
        </span>
      ) : (
        duration
      )}
    </>
  );
});

/** Copy, attach-as-context and download. Shared by the handoff grid and the default footer. */
function FooterControls({
  className,
  message,
  displayContent,
  markdownContent,
  isAddedToContext,
  onAddToContext,
}: {
  className: string;
  message: Message;
  displayContent?: string;
  markdownContent: string;
  isAddedToContext: boolean;
  onAddToContext: (e: React.MouseEvent) => void;
}) {
  return (
    <div className={className}>
      <CopyMarkdownButton content={markdownContent} />
      <button
        type="button"
        onClick={onAddToContext}
        className="flex items-center justify-center w-6 h-6 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
        title={isAddedToContext ? 'Added to context' : 'Add to context'}
      >
        <Paperclip size={12} />
      </button>
      <MessageDownloadMenu message={message} contentOverride={displayContent} />
    </div>
  );
}

export interface TimelineMessageFooterProps {
  message: Message;
  /** When set, copy/download use this instead of message.content. */
  displayContent?: string;
  /** Elapsed time since the previous message in the timeline. */
  handoffDurationMs?: number;
  /** Whether the duration is much longer than others in the loaded window (orange). */
  handoffDurationSlow?: boolean;
  /** Extra classes merged onto the footer root. */
  className?: string;
}

/**
 * Message footer: copy content, attach-as-context, and creation timestamp.
 * Handoff messages use a 2-row grid: controls | time row, then the agent line across both
 * columns. Every other type keeps the pre-existing flex-wrap footer.
 */
// fallow-ignore-next-line complexity
export const TimelineMessageFooter = memo(function TimelineMessageFooter({
  message,
  displayContent,
  handoffDurationMs,
  handoffDurationSlow,
  className,
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

  if (message.type === 'handoff') {
    return (
      <div
        className={cn(TIMELINE_HANDOFF_FOOTER, className)}
        data-testid="timeline-message-footer"
        data-footer-layout="handoff"
      >
        <FooterControls
          className="flex shrink-0 items-center gap-1"
          message={message}
          displayContent={displayContent}
          markdownContent={markdownContent}
          isAddedToContext={isAddedToContext}
          onAddToContext={handleAddToContext}
        />
        <div data-testid="timeline-footer-time-row" className={TIMELINE_HANDOFF_FOOTER_TIME_ROW}>
          <TimelineMessageTimestamp
            creationTime={message._creationTime}
            handoffDurationMs={handoffDurationMs}
            handoffDurationSlow={handoffDurationSlow}
            alignDuration
          />
        </div>
        <div data-testid="timeline-footer-agent-row" className={TIMELINE_HANDOFF_FOOTER_AGENT_ROW}>
          <TimelineSenderAgentChip
            type={message.type}
            senderAgent={message.senderAgent}
            placement="footer"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap justify-between items-center gap-x-3 gap-y-1 mt-2 pt-1.5',
        className
      )}
      data-testid="timeline-message-footer"
    >
      <FooterControls
        className="flex items-center gap-1"
        message={message}
        displayContent={displayContent}
        markdownContent={markdownContent}
        isAddedToContext={isAddedToContext}
        onAddToContext={handleAddToContext}
      />
      <div className="ml-auto flex items-center gap-1.5">
        <TimelineMessageTimestamp
          creationTime={message._creationTime}
          handoffDurationMs={handoffDurationMs}
          handoffDurationSlow={handoffDurationSlow}
        />
      </div>
    </div>
  );
});
