'use client';

import { ArrowRight, ArrowRightLeft, Info } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { TimelineMessageFooter } from './TimelineMessageFooter';
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
import { TimelineTeamMessageBody } from './TimelineTeamMessageBody';
import { MessageAttachmentChips } from '../../attachments';
import { getHandoffPreviewText } from '../../timeline/handoffPreview';
import type { Message } from '../../types/message';

import { cn } from '@/lib/utils';

/** Collapsed handoff body: plain-text preview plus an expand control. */
function TimelineHandoffPreview({ content, onExpand }: { content: string; onExpand: () => void }) {
  const preview = useMemo(() => getHandoffPreviewText(content), [content]);

  return (
    <div data-testid="timeline-handoff-preview">
      <p className="line-clamp-2 text-sm text-chatroom-text-muted">{preview}</p>
      <button
        type="button"
        aria-expanded="false"
        onClick={onExpand}
        className="mt-1 text-xs font-medium text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
      >
        Show full handoff
      </button>
    </div>
  );
}

function getMessageTypeBadge(type: string) {
  if (type === 'handoff') {
    return {
      className: `${BADGE_BASE} bg-chatroom-status-purple/15 text-chatroom-status-purple`,
      label: 'handoff',
      icon: <ArrowRightLeft size={ICON_SIZE} className="flex-shrink-0" />,
    };
  }
  if (type === 'notice') {
    return {
      className: `${BADGE_BASE} bg-chatroom-status-info/15 text-chatroom-status-info`,
      label: 'notice',
      icon: <Info size={ICON_SIZE} className="flex-shrink-0" aria-hidden="true" />,
    };
  }
  return null;
}

/**
 * The single header row shared by expanded and collapsed states. Keeping one
 * component guarantees identical nav, identity attributes, and layout in both.
 */
// Faithful extraction of the pre-existing header markup; the branch count is
// layout-only (badge, nav, machine label, source tag, target role).
// fallow-ignore-next-line complexity
const TimelineTeamMessageHeader = memo(function TimelineTeamMessageHeader({
  message,
  machines,
  machineId,
  headerNavigation,
}: {
  message: Message;
  machines?: Map<string, MachineNameEntry>;
  machineId?: string;
  headerNavigation?: TimelineMessageHeaderNavigation;
}) {
  const messageTypeBadge = getMessageTypeBadge(message.type);
  const machineLabel = formatMachineLabel(machines, machineId);

  return (
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
  );
});

export interface TimelineTeamMessageProps {
  message: Message;
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  /** When set, shows resolved hostname/alias beside the sender role. */
  machineId?: string;
  /** When set, sticky header shows centered prev/current/next jump controls (All tab). */
  headerNavigation?: TimelineMessageHeaderNavigation;
  /** Historical duration from the origin task start through this handoff. */
  handoffDurationMs?: number;
  /**
   * When true the row starts collapsed: a 2-line plain-text preview instead of
   * the full markdown body. Used for agent-to-agent traffic in the All tab.
   */
  collapsible?: boolean;
}

export const TimelineTeamMessage = memo(function TimelineTeamMessage({
  message,
  chatroomId: _chatroomId,
  machines,
  machineId,
  headerNavigation,
  handoffDurationMs,
  collapsible = false,
}: TimelineTeamMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const isCollapsed = collapsible && !expanded;
  // Keep the original content for generic copy/download behavior; the visual
  // render path additionally unwraps the handoff presentation fence.
  const originalContent = message.content;

  return (
    <div
      className={`${TIMELINE_ROW_BORDER} bg-transparent ${TIMELINE_ROW_ROOT}`}
      data-testid="timeline-team-message"
      data-message-type={message.type}
    >
      <TimelineTeamMessageHeader
        message={message}
        machines={machines}
        machineId={machineId}
        headerNavigation={headerNavigation}
      />

      <div className={`px-4 py-3 ${TIMELINE_MESSAGE_BODY}`}>
        {isCollapsed ? (
          <TimelineHandoffPreview content={originalContent} onExpand={() => setExpanded(true)} />
        ) : (
          <>
            <TimelineTeamMessageBody message={message} />
            {collapsible && (
              <button
                type="button"
                aria-expanded="true"
                onClick={() => setExpanded(false)}
                className="mt-2 text-xs font-medium text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              >
                Collapse
              </button>
            )}
          </>
        )}
        <div className="mt-2 empty:hidden">
          <MessageAttachmentChips message={message} />
        </div>
        <TimelineMessageFooter
          message={message}
          displayContent={originalContent}
          handoffDurationMs={handoffDurationMs}
        />
      </div>
    </div>
  );
});
