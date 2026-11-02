'use client';

import { ArrowRight, ArrowRightLeft, ChevronRight, Info } from 'lucide-react';
import { memo, useCallback, useId, useMemo, useState } from 'react';

import { TimelineMessageFooter, TimelineMessageTimestamp } from './TimelineMessageFooter';
import { TimelineMessageHeaderNav } from './TimelineMessageHeaderNav';
import {
  BADGE_BASE,
  getSenderClasses,
  ICON_SIZE,
  TIMELINE_HANDOFF_CHEVRON,
  TIMELINE_HANDOFF_CHIPS,
  TIMELINE_HANDOFF_META,
  TIMELINE_HANDOFF_PREVIEW_TEXT,
  TIMELINE_HANDOFF_TOGGLE,
  TIMELINE_HANDOFF_TOGGLE_LABEL,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_BORDER,
  TIMELINE_ROW_ROOT,
  type TimelineMessageHeaderNavigation,
} from './timelineRowStyles';
import { TimelineTeamMessageBody } from './TimelineTeamMessageBody';
import { MessageAttachmentChips } from '../../attachments';
import { getHandoffPreviewText } from '../../timeline/handoffPreview';
import type { Message } from '../../types/message';

import { cn } from '@/lib/utils';

/** Body spacing differs for a collapsible row, whose summary bar sits above it. */
function getHandoffBodyClassName(collapsible: boolean | undefined): string {
  return cn('px-4', collapsible ? 'pt-1 pb-3' : 'py-3', TIMELINE_MESSAGE_BODY);
}

/** Collapsed-only preview text; expanded rows never pay for it. */
function getCollapsedPreview(collapsed: boolean, content: string): string {
  return collapsed ? getHandoffPreviewText(content) : '';
}

/**
 * Aria/title wiring for the toggle. Collapsed it is a labelled disclosure; expanded
 * the visible "Collapse" text is the accessible name, so the attributes are dropped.
 */
function getHandoffToggleAria(collapsed: boolean, preview: string, previewId: string) {
  if (!collapsed) return {};
  return {
    'aria-label': 'Show full handoff',
    'aria-describedby': preview ? previewId : undefined,
    title: 'Show full handoff',
  };
}

/** Collapsed bar content: the preview (or label) plus the compact timestamp. */
function HandoffToggleSummary({
  preview,
  previewId,
  creationTime,
  handoffDurationMs,
}: {
  preview: string;
  previewId: string;
  creationTime: number;
  handoffDurationMs?: number;
}) {
  return (
    <>
      {preview ? (
        <span
          id={previewId}
          data-testid="timeline-handoff-preview"
          className={TIMELINE_HANDOFF_PREVIEW_TEXT}
        >
          {preview}
        </span>
      ) : (
        <span className={TIMELINE_HANDOFF_TOGGLE_LABEL}>Show full handoff</span>
      )}
      <span className={TIMELINE_HANDOFF_META}>
        <TimelineMessageTimestamp
          creationTime={creationTime}
          handoffDurationMs={handoffDurationMs}
          compact
        />
      </span>
    </>
  );
}

/**
 * The single expand/collapse control, rendered as the collapsed row's summary bar
 * and as the expanded row's "Collapse" bar. It is one persistent `<button>` in the
 * same slot in both states, so the focused element survives the state change.
 */
function TimelineHandoffToggle({
  collapsed,
  controls,
  preview,
  previewId,
  creationTime,
  handoffDurationMs,
  onToggle,
}: {
  collapsed: boolean;
  /** id of the body container; referenced by aria-controls in both states. */
  controls: string;
  /** getHandoffPreviewText output while collapsed; '' when expanded or no visible text. */
  preview: string;
  previewId: string;
  creationTime: number;
  handoffDurationMs?: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="timeline-handoff-toggle"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      aria-expanded={!collapsed}
      aria-controls={controls}
      {...getHandoffToggleAria(collapsed, preview, previewId)}
      onClick={onToggle}
      className={TIMELINE_HANDOFF_TOGGLE}
    >
      <ChevronRight
        size={14}
        aria-hidden="true"
        className={cn(TIMELINE_HANDOFF_CHEVRON, !collapsed && 'rotate-90')}
      />
      {collapsed ? (
        <HandoffToggleSummary
          preview={preview}
          previewId={previewId}
          creationTime={creationTime}
          handoffDurationMs={handoffDurationMs}
        />
      ) : (
        <span className={TIMELINE_HANDOFF_TOGGLE_LABEL}>Collapse</span>
      )}
    </button>
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
 * `flush` drops the bottom margin so a collapsible row's summary bar sits directly
 * under the header.
 */
// Faithful extraction of the pre-existing header markup; the branch count is
// layout-only (badge, nav, source tag, target role).
// fallow-ignore-next-line complexity
const TimelineTeamMessageHeader = memo(function TimelineTeamMessageHeader({
  message,
  headerNavigation,
  flush = false,
}: {
  message: Message;
  headerNavigation?: TimelineMessageHeaderNavigation;
  flush?: boolean;
}) {
  const messageTypeBadge = getMessageTypeBadge(message.type);

  return (
    <div
      className={cn(
        headerNavigation
          ? 'grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 px-4 py-1.5 w-full'
          : 'flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5',
        !flush && 'mb-2',
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
  /** When set, sticky header shows centered prev/current/next jump controls (conversation feed). */
  headerNavigation?: TimelineMessageHeaderNavigation;
  /** Historical duration from the origin task start through this handoff. */
  handoffDurationMs?: number;
  /**
   * When true the row starts collapsed: a summary bar with a 2-line plain-text
   * preview instead of the full markdown body. Used for agent-to-agent traffic in
   * the conversation feed.
   */
  collapsible?: boolean;
}

export const TimelineTeamMessage = memo(function TimelineTeamMessage({
  message,
  chatroomId: _chatroomId,
  headerNavigation,
  handoffDurationMs,
  collapsible,
}: TimelineTeamMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const isCollapsed = Boolean(collapsible) && !expanded;
  const bodyId = useId();
  const previewId = useId();
  // Only collapsed rows pay for the preview; expanded rows render markdown.
  const preview = useMemo(
    () => getCollapsedPreview(isCollapsed, message.content),
    [isCollapsed, message.content]
  );

  // Flipping state only: scrolling here would run before React commits the shorter
  // row and could jump every ancestor scroll container.
  const handleToggle = useCallback(() => setExpanded((value) => !value), []);

  return (
    <div
      className={`${TIMELINE_ROW_BORDER} bg-transparent ${TIMELINE_ROW_ROOT}`}
      data-testid="timeline-team-message"
      data-message-type={message.type}
    >
      <TimelineTeamMessageHeader
        message={message}
        headerNavigation={headerNavigation}
        flush={collapsible}
      />

      {collapsible && (
        <TimelineHandoffToggle
          collapsed={isCollapsed}
          controls={bodyId}
          preview={preview}
          previewId={previewId}
          creationTime={message._creationTime}
          handoffDurationMs={handoffDurationMs}
          onToggle={handleToggle}
        />
      )}

      {isCollapsed ? (
        <>
          <div id={bodyId} hidden />
          <div className={cn(TIMELINE_HANDOFF_CHIPS, 'pr-4 pb-2 empty:hidden')}>
            <MessageAttachmentChips message={message} />
          </div>
        </>
      ) : (
        <div className={getHandoffBodyClassName(collapsible)}>
          <div id={bodyId}>
            <TimelineTeamMessageBody message={message} />
          </div>
          <div className="mt-2 empty:hidden">
            <MessageAttachmentChips message={message} />
          </div>
          <TimelineMessageFooter
            message={message}
            displayContent={message.content}
            handoffDurationMs={handoffDurationMs}
          />
        </div>
      )}
    </div>
  );
});
