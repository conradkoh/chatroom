'use client';

import { ArrowRight, ArrowRightLeft, Sparkles } from 'lucide-react';
import { memo, useState } from 'react';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import {
  BADGE_BASE,
  formatMachineLabel,
  getSenderClasses,
  ICON_SIZE,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_BORDER,
  type MachineNameEntry,
} from './timelineRowStyles';
import { MessageAttachmentChips } from '../../attachments';
import { EnhancerContentToggle } from '../../features/enhancers/components/EnhancerContentToggle';
import { EnhancerMessageDiffSection } from '../../features/enhancers/components/EnhancerMessageDiffSection';
import type { Message } from '../../types/message';

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
}

// fallow-ignore-next-line complexity
export const TimelineTeamMessage = memo(function TimelineTeamMessage({
  message,
  chatroomId: _chatroomId,
  machines,
  machineId,
}: TimelineTeamMessageProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const hasEnhancerOriginal =
    typeof message.enhancerOriginalContent === 'string' &&
    message.enhancerOriginalContent.length > 0;
  const displayContent =
    showOriginal && hasEnhancerOriginal
      ? (message.enhancerOriginalContent ?? message.content)
      : message.content;

  const messageTypeBadge = getMessageTypeBadge(message.type);
  const machineLabel = formatMachineLabel(machines, machineId);
  const hasFeatureTitle = message.classification === 'new_feature' && message.featureTitle;

  return (
    <div
      className={`px-4 py-3 ${TIMELINE_ROW_BORDER} bg-transparent`}
      data-testid="timeline-team-message"
    >
      <div
        className={`flex flex-wrap justify-between items-center gap-y-1 gap-x-2 -mx-4 px-4 py-1.5 mb-2 ${TIMELINE_MESSAGE_HEADER_STICKY}`}
        data-testid="timeline-message-header"
      >
        <div className="flex items-center flex-wrap gap-y-1 gap-x-1.5">
          {messageTypeBadge && (
            <span className={messageTypeBadge.className}>
              {messageTypeBadge.icon}
              {messageTypeBadge.label}
            </span>
          )}
          {hasEnhancerOriginal && (
            <EnhancerContentToggle
              showOriginal={showOriginal}
              onToggle={() => setShowOriginal((v) => !v)}
            />
          )}
        </div>
        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1">
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

      <TimelineMarkdownBody content={displayContent} />
      <div className="mt-2 empty:hidden">
        <MessageAttachmentChips message={message} />
      </div>
      <EnhancerMessageDiffSection
        message={message}
        displayContent={displayContent}
        hasEnhancerOriginal={hasEnhancerOriginal}
      />
    </div>
  );
});
