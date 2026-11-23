'use client';

import { XIcon } from 'lucide-react';
import { memo, useRef, type RefObject } from 'react';

import { TimelineFileAttachments } from './TimelineFileAttachments';
import { TimelineMessageFooter } from './TimelineMessageFooter';
import { TimelineMessageRoute, TimelineMessageTypeBadge } from './TimelineMessageIdentity';
import { TimelineTeamMessageBody } from './TimelineTeamMessageBody';
import { MessageAttachmentChips } from '../../attachments';
import { formatHandoffDurationTitle } from '../../timeline/handoffTiming';
import { getSenderAgentLabel } from '../../timeline/senderAgentLabel';
import type { Message } from '../../types/message';
import { formatTimestampFull } from '../../utils/chatroomTimestamp';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogScrollBody,
  DialogTitle,
} from '@/components/ui/dialog';

export interface TimelineHandoffDetailsDialogProps {
  message: Message;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The summary bar button; focus returns here on close. */
  finalFocusRef: RefObject<HTMLElement | null>;
  /** Same value the row receives from TimelineEvent. */
  handoffDurationMs?: number;
  handoffDurationSlow?: boolean;
}

/** Accessible dialog name, e.g. "Full handoff from builder to planner". */
function getDialogName(message: Message): string {
  const target = message.targetRole ? ` to ${message.targetRole}` : '';
  return `Full ${message.type} from ${message.senderRole}${target}`;
}

/**
 * Accessible description: timestamp, optional elapsed time, optional sender agent.
 * With no snapshot and no duration this is exactly `Sent <timestamp>`.
 */
function getDialogDescription(
  message: Message,
  handoffDurationMs?: number,
  handoffDurationSlow?: boolean
): string {
  const parts = [`Sent ${formatTimestampFull(message._creationTime)}`];
  if (handoffDurationMs !== undefined) {
    parts.push(formatHandoffDurationTitle(handoffDurationMs, Boolean(handoffDurationSlow)));
  }
  const agent = getSenderAgentLabel(message.type, message.senderAgent);
  if (agent) {
    parts.push(
      `Sent by ${message.senderRole} using ${agent.harness}${
        agent.model !== undefined ? `, model ${agent.model}` : ''
      }.`
    );
  }
  return parts.join('. ');
}

/**
 * Full details of a collapsible handoff or plan row, rendered in a modal dialog.
 *
 * The row owns `open` and mounts this only after the first open, so the markdown
 * body is parsed only when a reader asks for it. The dialog is a flex column with a
 * scrolling body between a pinned header and footer, so a tall handoff never pushes
 * the footer off screen. `!` overrides beat DialogContent's industrial `grid p-6
 * gap-4 max-w-*`; overflow stays on DialogScrollBody (DialogContent strips it).
 * `motion-reduce:*` must be important because the industrial `data-open:animate-in`
 * selector outranks an unimportant variant.
 */
export const TimelineHandoffDetailsDialog = memo(function TimelineHandoffDetailsDialog({
  message,
  open,
  onOpenChange,
  finalFocusRef,
  handoffDurationMs,
  handoffDurationSlow,
}: TimelineHandoffDetailsDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const description = getDialogDescription(message, handoffDurationMs, handoffDurationSlow);
  const isPlan = message.type === 'plan';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="timeline-handoff-dialog"
        showCloseButton={false}
        initialFocus={bodyRef}
        finalFocus={finalFocusRef}
        className="flex! flex-col min-h-0 gap-0! p-0! max-w-[calc(100%-1rem)]! sm:max-w-3xl! max-h-[85dvh] sm:max-h-[80vh] motion-reduce:animate-none! motion-reduce:duration-0!"
      >
        <div
          data-testid="timeline-handoff-dialog-header"
          className="flex shrink-0 items-start justify-between gap-3 border-b border-chatroom-border px-4 py-2"
        >
          <div
            aria-hidden="true"
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 py-1.5"
          >
            <TimelineMessageTypeBadge type={message.type} />
            <TimelineMessageRoute
              senderRole={message.senderRole}
              targetRole={message.targetRole}
              sourcePlatform={message.sourcePlatform}
            />
          </div>
          <DialogTitle className="sr-only">{getDialogName(message)}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
          <DialogClose
            aria-label="Close"
            data-testid="timeline-handoff-dialog-close"
            className="flex size-8 shrink-0 items-center justify-center rounded-none text-chatroom-text-muted transition-colors hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chatroom-accent"
          >
            <XIcon size={16} aria-hidden="true" />
          </DialogClose>
        </div>

        <DialogScrollBody
          ref={bodyRef}
          tabIndex={0}
          role="region"
          aria-label={isPlan ? 'Plan content' : 'Handoff content'}
          data-testid="timeline-handoff-dialog-body"
          className="px-4 py-3 overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chatroom-accent"
        >
          {!isPlan && message.content.trim() === '' ? (
            <p
              data-testid="timeline-handoff-dialog-empty"
              className="text-sm italic text-chatroom-text-muted"
            >
              No text content in this handoff.
            </p>
          ) : (
            <div className="min-w-0">
              <TimelineTeamMessageBody message={message} />
            </div>
          )}
          <div className="mt-3 empty:hidden">
            <MessageAttachmentChips message={message} />
          </div>
          <TimelineFileAttachments files={message.attachedFiles} showMedia className="mt-3" />
        </DialogScrollBody>

        <div className="shrink-0 border-t border-chatroom-border bg-chatroom-bg-primary px-4 py-2">
          <TimelineMessageFooter
            message={message}
            displayContent={message.content}
            handoffDurationMs={handoffDurationMs}
            handoffDurationSlow={handoffDurationSlow}
            className="mt-0 pt-0"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
});
