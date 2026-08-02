'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  Archive,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { TimelineMessageFooter } from './TimelineMessageFooter';
import { TimelineMessageHeaderNav } from './TimelineMessageHeaderNav';
import {
  BADGE_BASE,
  ICON_SIZE,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_BORDER,
  TIMELINE_ROW_ROOT,
  type TimelineMessageHeaderNavigation,
} from './timelineRowStyles';
import { MessageAttachmentChips } from '../../attachments';
import { ScheduledMessageBadge } from '../../features/scheduled-prompts/components/ScheduledMessageBadge';
import { ScheduledPromptDetailDialog } from '../../features/scheduled-prompts/components/ScheduledPromptDetailDialog';
import type { Message, MessageClassification } from '../../types/message';

function getClassificationBadge(classification: MessageClassification | undefined) {
  if (!classification) return null;
  switch (classification) {
    case 'question':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-info/15 text-chatroom-status-info`,
        label: 'question',
        icon: <HelpCircle size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'new_feature':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-warning/15 text-chatroom-status-warning`,
        label: 'new feature',
        icon: <Sparkles size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'follow_up':
      return {
        className: `${BADGE_BASE} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: 'follow-up',
        icon: <RotateCcw size={ICON_SIZE} className="flex-shrink-0" />,
      };
    default:
      return null;
  }
}

function getTaskStatusBadge(status: Message['taskStatus']) {
  if (!status) return null;
  switch (status) {
    case 'pending':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-success/15 text-chatroom-status-success`,
        label: 'pending',
        icon: <Clock size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'acknowledged':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-success/15 text-chatroom-status-success`,
        label: 'acknowledged',
        icon: <CheckCircle2 size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'in_progress':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-info/15 text-chatroom-status-info`,
        label: 'in progress',
        icon: <Loader2 size={ICON_SIZE} className="flex-shrink-0 animate-spin" />,
      };
    case 'completed':
      return {
        className: `${BADGE_BASE} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: 'done',
        icon: <CheckCircle2 size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'cancelled':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-error/15 text-chatroom-status-error`,
        label: 'cancelled',
        icon: <XCircle size={ICON_SIZE} className="flex-shrink-0" />,
      };
    case 'backlog':
      return {
        className: `${BADGE_BASE} bg-chatroom-text-muted/15 text-chatroom-text-muted`,
        label: 'backlog',
        icon: <Archive size={ICON_SIZE} className="flex-shrink-0" />,
      };
    default:
      return null;
  }
}

function getDisplayText(message: Message): string {
  const text = message.featureTitle || message.content;
  return text.replace(/\n+/g, ' ').trim();
}

interface UserMessageHeaderNavProps {
  queuedBadge: ReactNode;
  statusBadges: ReactNode;
  taskStatusBadgeEl: ReactNode;
  displayText: string;
  isQueued?: boolean;
  headerNavigation: TimelineMessageHeaderNavigation;
}

function UserMessageHeaderNav({
  queuedBadge,
  statusBadges,
  taskStatusBadgeEl,
  displayText,
  isQueued,
  headerNavigation,
}: UserMessageHeaderNavProps) {
  return (
    <div className="flex items-center gap-2 h-8 px-3 min-w-0">
      <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
        {isQueued ? queuedBadge : statusBadges}
      </div>
      <div className="flex-1 flex justify-center min-w-0">
        <TimelineMessageHeaderNav {...headerNavigation} />
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
        <span className="text-xs font-medium text-chatroom-text-primary truncate max-w-[200px]">
          {displayText}
        </span>
        {taskStatusBadgeEl}
      </div>
    </div>
  );
}

interface UserMessageHeaderDefaultProps {
  queuedBadge: ReactNode;
  statusBadges: ReactNode;
  taskStatusBadgeEl: ReactNode;
  displayText: string;
  isQueued?: boolean;
  isAwaitingClassification: boolean;
}

function UserMessageHeaderDefault({
  queuedBadge,
  statusBadges,
  taskStatusBadgeEl,
  displayText,
  isQueued,
  isAwaitingClassification,
}: UserMessageHeaderDefaultProps) {
  return (
    <div className="flex items-center h-8 px-3 min-w-0">
      {isQueued ? (
        queuedBadge
      ) : (
        <div className="flex items-center gap-2 w-full min-w-0">
          {isAwaitingClassification ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="h-4 w-16 bg-chatroom-border animate-pulse flex-shrink-0" />
              <div className="h-4 flex-1 max-w-xs bg-chatroom-border/50 animate-pulse" />
            </div>
          ) : (
            <>
              {statusBadges}
              <span className="flex-1 min-w-0 text-xs font-medium text-chatroom-text-primary truncate">
                {displayText}
              </span>
            </>
          )}
          {taskStatusBadgeEl}
        </div>
      )}
    </div>
  );
}

interface TimelineUserMessageProps {
  message: Message;
  chatroomId: string;
  /** When set, sticky header shows centered prev/current/next jump controls (All tab). */
  headerNavigation?: TimelineMessageHeaderNavigation;
}

export const TimelineUserMessage = memo(function TimelineUserMessage({
  message,
  chatroomId: _chatroomId,
  headerNavigation,
}: TimelineUserMessageProps) {
  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);
  const isTaskFinished = message.taskStatus === 'completed' || message.taskStatus === 'cancelled';
  const isAwaitingClassification = !message.classification && !isTaskFinished;
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
      {classificationBadge && (
        <span className={`${classificationBadge.className} flex-shrink-0`}>
          {classificationBadge.icon}
          {classificationBadge.label}
        </span>
      )}
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

  const taskStatusBadgeEl = taskStatusBadge ? (
    <span className={`${taskStatusBadge.className} flex-shrink-0`}>
      {taskStatusBadge.icon}
      {taskStatusBadge.label}
    </span>
  ) : null;

  const header = headerNavigation ? (
    <UserMessageHeaderNav
      queuedBadge={queuedBadge}
      statusBadges={statusBadges}
      taskStatusBadgeEl={taskStatusBadgeEl}
      displayText={getDisplayText(message)}
      isQueued={message.isQueued}
      headerNavigation={headerNavigation}
    />
  ) : (
    <UserMessageHeaderDefault
      queuedBadge={queuedBadge}
      statusBadges={statusBadges}
      taskStatusBadgeEl={taskStatusBadgeEl}
      displayText={getDisplayText(message)}
      isQueued={message.isQueued}
      isAwaitingClassification={isAwaitingClassification}
    />
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
        {header}
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
