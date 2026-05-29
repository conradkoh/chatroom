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

import type { Message, MessageClassification } from '../../types/message';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import {
  BADGE_BASE,
  getSenderClasses,
  ICON_SIZE,
  TIMELINE_ROW_BORDER,
} from './timelineRowStyles';

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

interface TimelineUserMessageProps {
  message: Message;
}

export const TimelineUserMessage = memo(function TimelineUserMessage({
  message,
}: TimelineUserMessageProps) {
  const classificationBadge = getClassificationBadge(message.classification);
  const taskStatusBadge = getTaskStatusBadge(message.taskStatus);
  const hasFeatureTitle = message.classification === 'new_feature' && message.featureTitle;

  return (
    <div
      className={`px-4 py-3 ${TIMELINE_ROW_BORDER} bg-chatroom-bg-primary`}
      data-testid="timeline-user-message"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2 pb-1.5 border-b border-chatroom-border">
        <span className={getSenderClasses('user')}>user</span>
        {classificationBadge && (
          <span className={classificationBadge.className}>
            {classificationBadge.icon}
            {classificationBadge.label}
          </span>
        )}
        {taskStatusBadge && (
          <span className={taskStatusBadge.className}>
            {taskStatusBadge.icon}
            {taskStatusBadge.label}
          </span>
        )}
        {message.sourcePlatform === 'telegram' && (
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-chatroom-text-muted bg-chatroom-bg-tertiary rounded">
            Telegram
          </span>
        )}
        {message.isQueued && (
          <span
            className={`${BADGE_BASE} bg-chatroom-status-warning/15 text-chatroom-status-warning`}
          >
            queued
          </span>
        )}
      </div>

      {hasFeatureTitle && (
        <div className="mb-2 px-3 py-2 bg-chatroom-status-warning/10 dark:bg-chatroom-status-warning/15 border border-chatroom-status-warning/20">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-chatroom-status-warning flex-shrink-0" />
            <span className="text-sm font-semibold text-chatroom-text-primary">
              {message.featureTitle}
            </span>
          </div>
        </div>
      )}

      <TimelineMarkdownBody content={message.content} />
    </div>
  );
});
