'use client';

import { Maximize2 } from 'lucide-react';
import { memo, useCallback, useId, useMemo, useRef, useState, type RefObject } from 'react';

import { TimelineFileAttachments } from './TimelineFileAttachments';
import { TimelineHandoffDetailsDialog } from './TimelineHandoffDetailsDialog';
import { TimelineMessageFooter, TimelineMessageTimestamp } from './TimelineMessageFooter';
import {
  TimelineMessageRoute,
  TimelineMessageTypeBadge,
  TimelineSenderAgentChip,
} from './TimelineMessageIdentity';
import {
  TIMELINE_HANDOFF_CHIPS,
  TIMELINE_HANDOFF_META,
  TIMELINE_HANDOFF_META_TIME_ROW,
  TIMELINE_HANDOFF_OPEN_ICON,
  TIMELINE_HANDOFF_PREVIEW_TEXT,
  TIMELINE_HANDOFF_TRIGGER,
  TIMELINE_HANDOFF_TRIGGER_LABEL,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_BORDER,
  TIMELINE_ROW_ROOT,
} from './timelineRowStyles';
import { TimelineTeamMessageBody } from './TimelineTeamMessageBody';
import { MessageAttachmentChips } from '../../attachments';
import { getHandoffPreviewText } from '../../timeline/handoffPreview';
import type { Message, SenderAgentSnapshot } from '../../types/message';

import { cn } from '@/lib/utils';

/** Collapsed bar content: the preview (or the empty label) plus the two-line meta column. */
function HandoffTriggerSummary({
  preview,
  previewId,
  type,
  senderAgent,
  creationTime,
  handoffDurationMs,
  handoffDurationSlow,
}: {
  preview: string;
  previewId: string;
  type: string;
  senderAgent: SenderAgentSnapshot | undefined;
  creationTime: number;
  handoffDurationMs?: number;
  /** Whether the duration is much longer than others in the loaded window (orange). */
  handoffDurationSlow?: boolean;
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
        <span className={TIMELINE_HANDOFF_TRIGGER_LABEL}>Show full handoff</span>
      )}
      <span data-testid="timeline-handoff-meta" className={TIMELINE_HANDOFF_META}>
        <span className={TIMELINE_HANDOFF_META_TIME_ROW}>
          <TimelineMessageTimestamp
            creationTime={creationTime}
            handoffDurationMs={handoffDurationMs}
            handoffDurationSlow={handoffDurationSlow}
            compact
            alignDuration={type === 'handoff'}
          />
        </span>
        <TimelineSenderAgentChip type={type} senderAgent={senderAgent} placement="bar" />
      </span>
    </>
  );
}

/**
 * Summary bar of a collapsible row. A single full-width button that opens the details
 * dialog. It never changes the row height: the full content is shown only in the dialog.
 */
function TimelineHandoffTrigger({
  buttonRef,
  preview,
  previewId,
  type,
  senderAgent,
  creationTime,
  handoffDurationMs,
  handoffDurationSlow,
  onOpen,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  /** getHandoffPreviewText output; '' when the content has no visible text. */
  preview: string;
  previewId: string;
  type: string;
  senderAgent: SenderAgentSnapshot | undefined;
  creationTime: number;
  handoffDurationMs?: number;
  handoffDurationSlow?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="timeline-handoff-trigger"
      aria-haspopup="dialog"
      aria-label="Show full handoff"
      title="Show full handoff"
      aria-describedby={preview ? previewId : undefined}
      onClick={onOpen}
      className={TIMELINE_HANDOFF_TRIGGER}
    >
      <Maximize2 size={14} aria-hidden="true" className={TIMELINE_HANDOFF_OPEN_ICON} />
      <HandoffTriggerSummary
        preview={preview}
        previewId={previewId}
        type={type}
        senderAgent={senderAgent}
        creationTime={creationTime}
        handoffDurationMs={handoffDurationMs}
        handoffDurationSlow={handoffDurationSlow}
      />
    </button>
  );
}

/**
 * The single header row shared by collapsible and eager rows. Keeping one
 * component guarantees identical identity attributes and layout in both.
 * `flush` drops the bottom margin so a collapsible row's summary bar sits directly
 * under the header.
 */
const TimelineTeamMessageHeader = memo(function TimelineTeamMessageHeader({
  message,
  flush = false,
}: {
  message: Message;
  flush?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5',
        !flush && 'mb-2',
        TIMELINE_MESSAGE_HEADER_STICKY
      )}
      data-testid="timeline-message-header"
      data-timeline-row-header
    >
      <div className="flex items-center flex-wrap gap-y-1 gap-x-1.5 min-w-0 empty:hidden">
        <TimelineMessageTypeBadge type={message.type} />
      </div>
      <div
        className="ml-auto flex items-center justify-end flex-wrap gap-x-1.5 gap-y-1 min-w-0"
        data-testid="timeline-message-header-route"
      >
        <TimelineMessageRoute
          senderRole={message.senderRole}
          targetRole={message.targetRole}
          sourcePlatform={message.sourcePlatform}
        />
      </div>
    </div>
  );
});

export interface TimelineTeamMessageProps {
  message: Message;
  chatroomId: string;
  /** Elapsed time since the previous message in the timeline. */
  handoffDurationMs?: number;
  /** Whether the duration is much longer than others in the loaded window (orange). */
  handoffDurationSlow?: boolean;
  /**
   * When true the row is a summary bar that opens a details dialog, with a 2-line
   * plain-text preview. Used for agent-to-agent traffic in the conversation feed.
   * Eager rows (user involved) leave it unset and render in full inline.
   */
  collapsible?: boolean;
}

export const TimelineTeamMessage = memo(function TimelineTeamMessage({
  message,
  chatroomId: _chatroomId,
  handoffDurationMs,
  handoffDurationSlow,
  collapsible,
}: TimelineTeamMessageProps) {
  const previewId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Mount the dialog on first open and keep it mounted, so the markdown body is
  // parsed only for rows whose details were actually read.
  const [detailsMounted, setDetailsMounted] = useState(false);
  // Only collapsible rows pay for the preview.
  const preview = useMemo(
    () => (collapsible ? getHandoffPreviewText(message.content) : ''),
    [collapsible, message.content]
  );

  // State flips only. Do not add scrollTo/scrollIntoView or scroll-controller calls here.
  const handleOpenDetails = useCallback(() => {
    setDetailsMounted(true);
    setDetailsOpen(true);
  }, []);

  return (
    <div
      className={`${TIMELINE_ROW_BORDER} bg-transparent ${TIMELINE_ROW_ROOT}`}
      data-testid="timeline-team-message"
      data-message-type={message.type}
      data-timeline-row
    >
      <TimelineTeamMessageHeader message={message} flush={collapsible} />

      {collapsible ? (
        <>
          <TimelineHandoffTrigger
            buttonRef={triggerRef}
            preview={preview}
            previewId={previewId}
            type={message.type}
            senderAgent={message.senderAgent}
            creationTime={message._creationTime}
            handoffDurationMs={handoffDurationMs}
            handoffDurationSlow={handoffDurationSlow}
            onOpen={handleOpenDetails}
          />
          <div
            className={cn(TIMELINE_HANDOFF_CHIPS, 'flex flex-col gap-1.5 pr-4 pb-2 empty:hidden')}
          >
            <MessageAttachmentChips message={message} />
            <TimelineFileAttachments files={message.attachedFiles} showMedia={false} />
          </div>
          {detailsMounted && (
            <TimelineHandoffDetailsDialog
              message={message}
              open={detailsOpen}
              onOpenChange={setDetailsOpen}
              finalFocusRef={triggerRef}
              handoffDurationMs={handoffDurationMs}
              handoffDurationSlow={handoffDurationSlow}
            />
          )}
        </>
      ) : (
        <div className={cn('px-4 py-3', TIMELINE_MESSAGE_BODY)}>
          <TimelineTeamMessageBody message={message} />
          <div className="mt-2 empty:hidden">
            <MessageAttachmentChips message={message} />
          </div>
          <TimelineFileAttachments files={message.attachedFiles} showMedia className="mt-2" />
          <TimelineMessageFooter
            message={message}
            displayContent={message.content}
            handoffDurationMs={handoffDurationMs}
            handoffDurationSlow={handoffDurationSlow}
          />
        </div>
      )}
    </div>
  );
});
