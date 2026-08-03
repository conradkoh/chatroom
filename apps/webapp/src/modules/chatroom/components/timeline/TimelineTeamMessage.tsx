'use client';

import { ArrowRight, ArrowRightLeft, Sparkles } from 'lucide-react';
import { memo } from 'react';

import { HandoffEnvelopeView } from './HandoffEnvelopeView';
import { HandoffReportView } from './HandoffReportView';
import { PlanningReviewOutcomeView } from './PlanningReviewOutcomeView';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { TimelineMessageHeaderNav } from './TimelineMessageHeaderNav';
import {
  BADGE_BASE,
  formatMachineLabel,
  getSenderClasses,
  ICON_SIZE,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_BORDER,
  TIMELINE_ROW_ROOT,
  type MachineNameEntry,
  type TimelineMessageHeaderNavigation,
} from './timelineRowStyles';
import { MessageAttachmentChips } from '../../attachments';
import { EnhancerMessageDiffSection } from '../../features/enhancers/components/EnhancerMessageDiffSection';
import type { Message } from '../../types/message';
import { hasHandoffEnvelope } from '../../utils/parseHandoffEnvelope';
import { hasHandoffReport } from '../../utils/parseHandoffReport';
import { hasPlanningReviewOutcome } from '../../utils/parsePlanningReviewOutcome';

import { cn } from '@/lib/utils';

function getMessageTypeBadge(type: string) {
  if (type === 'handoff') {
    return {
      className: `${BADGE_BASE} bg-chatroom-status-purple/15 text-chatroom-status-purple`,
      label: 'handoff',
      icon: <ArrowRightLeft size={ICON_SIZE} className="flex-shrink-0" />,
    };
  }
  return null;
}

export interface TimelineTeamMessageProps {
  message: Message;
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  /** When set, shows resolved hostname/alias beside the sender role. */
  machineId?: string;
  /** When set, sticky header shows centered prev/current/next jump controls (All tab). */
  headerNavigation?: TimelineMessageHeaderNavigation;
}

// fallow-ignore-next-line complexity
export const TimelineTeamMessage = memo(function TimelineTeamMessage({
  message,
  chatroomId: _chatroomId,
  machines,
  machineId,
  headerNavigation,
}: TimelineTeamMessageProps) {
  const hasEnhancerOriginal =
    typeof message.enhancerOriginalContent === 'string' &&
    message.enhancerOriginalContent.length > 0;
  const displayContent = message.content;

  const messageTypeBadge = getMessageTypeBadge(message.type);
  const machineLabel = formatMachineLabel(machines, machineId);
  const hasFeatureTitle = message.classification === 'new_feature' && message.featureTitle;

  return (
    <div
      className={`${TIMELINE_ROW_BORDER} bg-transparent ${TIMELINE_ROW_ROOT}`}
      data-testid="timeline-team-message"
    >
      <div
        className={cn(
          headerNavigation
            ? 'grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 px-4 py-1.5 mb-2 w-full'
            : 'flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5 mb-2',
          TIMELINE_MESSAGE_HEADER_STICKY
        )}
        data-testid="timeline-message-header"
      >
        <div className="flex items-center flex-wrap gap-y-1 gap-x-1.5 min-w-0 justify-self-start">
          {messageTypeBadge && (
            <span className={messageTypeBadge.className}>
              {messageTypeBadge.icon}
              {messageTypeBadge.label}
            </span>
          )}
        </div>
        {headerNavigation && <TimelineMessageHeaderNav {...headerNavigation} />}
        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 min-w-0 justify-self-end">
          <span className={getSenderClasses(message.senderRole)}>{message.senderRole}</span>
          {machineLabel && (
            <span className="text-[10px] text-chatroom-text-muted font-medium normal-case">
              ({machineLabel})
            </span>
          )}
          {message.sourcePlatform === 'telegram' && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-chatroom-text-muted bg-chatroom-bg-tertiary rounded">
              Telegram
            </span>
          )}
          {message.targetRole && (
            <>
              <ArrowRight size={10} className="text-chatroom-text-muted flex-shrink-0" />
              <span className={getSenderClasses(message.targetRole)}>{message.targetRole}</span>
            </>
          )}
        </div>
      </div>

      <div className={`px-4 py-3 ${TIMELINE_MESSAGE_BODY}`}>
        {hasFeatureTitle && (
          <div className="mb-2 px-3 py-2 bg-chatroom-status-warning/10 dark:bg-chatroom-status-warning/15 border border-chatroom-status-warning/20 cursor-pointer hover:bg-chatroom-status-warning/20 transition-colors">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-chatroom-status-warning flex-shrink-0" />
              <span className="text-sm font-semibold text-chatroom-text-primary">
                {message.featureTitle}
              </span>
            </div>
          </div>
        )}

        {message.type === 'handoff' && hasPlanningReviewOutcome(displayContent) ? (
          <PlanningReviewOutcomeView content={displayContent} variant="timeline" />
        ) : message.type === 'handoff' && hasHandoffEnvelope(displayContent) ? (
          <HandoffEnvelopeView content={displayContent} variant="timeline" />
        ) : message.type === 'handoff' && hasHandoffReport(displayContent) ? (
          <HandoffReportView content={displayContent} variant="timeline" />
        ) : (
          <TimelineMarkdownBody content={displayContent} />
        )}
        <div className="mt-2 empty:hidden">
          <MessageAttachmentChips message={message} />
        </div>
        <EnhancerMessageDiffSection
          message={message}
          displayContent={displayContent}
          hasEnhancerOriginal={hasEnhancerOriginal}
        />
      </div>
    </div>
  );
});
