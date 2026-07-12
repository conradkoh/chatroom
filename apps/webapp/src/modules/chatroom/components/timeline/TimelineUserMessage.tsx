'use client';

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
import { memo } from 'react';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { TimelineMessageFooter } from './TimelineMessageFooter';
import {
  BADGE_BASE,
  ICON_SIZE,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_BORDER,
} from './timelineRowStyles';
import { MessageAttachmentChips } from '../../attachments';
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

interface TimelineUserMessageProps {
  message: Message;
  chatroomId: string;
}

export const TimelineUserMessage = memo(function TimelineUserMessage({
  message,
  chatroomId: _chatroomId,
}: TimelineUserMessageProps) {
  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);
  const isTaskFinished = message.taskStatus === 'completed' || message.taskStatus === 'cancelled';
  const isAwaitingClassification = !message.classification && !isTaskFinished;

  return (
    <div className={`${TIMELINE_ROW_BORDER} bg-transparent`} data-testid="timeline-user-message">
      <div
        className={`w-full bg-chatroom-bg-tertiary border-b-2 border-chatroom-border-strong ${TIMELINE_MESSAGE_HEADER_STICKY}`}
        data-testid="timeline-message-header"
      >
        <div className="flex items-center h-8 px-3 min-w-0">
          {message.isQueued ? (
            <span
              className={`${BADGE_BASE} bg-chatroom-status-warning/15 text-chatroom-status-warning`}
            >
              queued
            </span>
          ) : (
            <div className="flex items-center gap-2 w-full min-w-0">
              {isAwaitingClassification ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="h-4 w-16 bg-chatroom-border animate-pulse flex-shrink-0" />
                  <div className="h-4 flex-1 max-w-xs bg-chatroom-border/50 animate-pulse" />
                </div>
              ) : (
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
                  <span className="flex-1 min-w-0 text-xs font-medium text-chatroom-text-primary truncate">
                    {getDisplayText(message)}
                  </span>
                </>
              )}
              {taskStatusBadge && (
                <span className={`${taskStatusBadge.className} flex-shrink-0`}>
                  {taskStatusBadge.icon}
                  {taskStatusBadge.label}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <TimelineMarkdownBody content={message.content} />
        <div className="mt-2 empty:hidden">
          <MessageAttachmentChips message={message} />
        </div>
        <TimelineMessageFooter message={message} />
      </div>
    </div>
  );
});
