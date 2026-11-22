'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ArrowRight } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { TimelineMessageFooter } from './TimelineMessageFooter';
import {
  BADGE_BASE,
  getSenderClasses,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_BORDER,
  TIMELINE_ROW_ROOT,
} from './timelineRowStyles';
import { MessageAttachmentChips } from '../../attachments';
import { ScheduledMessageBadge } from '../../features/scheduled-prompts/components/ScheduledMessageBadge';
import { ScheduledPromptDetailDialog } from '../../features/scheduled-prompts/components/ScheduledPromptDetailDialog';
import type { Message } from '../../types/message';

interface UserMessageHeaderProps {
  queuedBadge: ReactNode;
  statusBadges: ReactNode;
  routeEl: ReactNode;
  isQueued?: boolean;
}

function UserMessageHeader({
  queuedBadge,
  statusBadges,
  routeEl,
  isQueued,
}: UserMessageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 h-8 px-3 min-w-0">
      <div className="flex items-center gap-2 min-w-0">{isQueued ? queuedBadge : statusBadges}</div>
      {routeEl}
    </div>
  );
}

interface TimelineUserMessageProps {
  message: Message;
  chatroomId: string;
}

export const TimelineUserMessage = memo(function TimelineUserMessage({
  message,
  chatroomId: _chatroomId,
}: TimelineUserMessageProps) {
  const showScheduledBadge =
    message.sourcePlatform === 'scheduled' || message.scheduledPromptId != null;
  const [detailOpen, setDetailOpen] = useState(false);

  const queuedBadge = (
    <span className={`${BADGE_BASE} bg-chatroom-status-warning/15 text-chatroom-status-warning`}>
      queued
    </span>
  );

  const statusBadges = (
    <>
      {message.sourcePlatform === 'telegram' && (
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-chatroom-text-muted bg-chatroom-bg-hover rounded flex-shrink-0">
          Telegram
        </span>
      )}
      {showScheduledBadge && (
        <ScheduledMessageBadge
          scheduledPromptId={message.scheduledPromptId}
          onClick={message.scheduledPromptId ? () => setDetailOpen(true) : undefined}
        />
      )}
    </>
  );

  // Route identity (sender → target) is always shown, independent of delivery
  // state, so queued and normal rows keep an identical, stable header layout.
  const routeEl = (
    <div className="flex items-center gap-x-1.5 min-w-0" data-testid="timeline-message-route">
      <span className={getSenderClasses(message.senderRole)}>{message.senderRole}</span>
      {message.targetRole && (
        <>
          <ArrowRight size={10} className="text-chatroom-text-muted flex-shrink-0" />
          <span className={getSenderClasses(message.targetRole)}>{message.targetRole}</span>
        </>
      )}
    </div>
  );

  return (
    <div
      className={`${TIMELINE_ROW_BORDER} bg-transparent ${TIMELINE_ROW_ROOT}`}
      data-testid="timeline-user-message"
    >
      <div
        className={`w-full bg-chatroom-bg-tertiary border-b-2 border-chatroom-border-strong ${TIMELINE_MESSAGE_HEADER_STICKY}`}
        data-testid="timeline-message-header"
      >
        <UserMessageHeader
          queuedBadge={queuedBadge}
          statusBadges={statusBadges}
          routeEl={routeEl}
          isQueued={message.isQueued}
        />
      </div>

      <div className={`px-4 py-3 ${TIMELINE_MESSAGE_BODY}`}>
        <TimelineMarkdownBody content={message.content} />
        <div className="mt-2 empty:hidden">
          <MessageAttachmentChips message={message} />
        </div>
        <TimelineMessageFooter message={message} />
      </div>

      {detailOpen && message.scheduledPromptId && (
        <ScheduledPromptDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          scheduledPromptId={message.scheduledPromptId as Id<'chatroom_scheduledPrompts'>}
        />
      )}
    </div>
  );
});
