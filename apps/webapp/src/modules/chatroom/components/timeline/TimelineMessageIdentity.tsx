'use client';

import { ArrowRight, ArrowRightLeft, Info } from 'lucide-react';

import {
  BADGE_BASE,
  getSenderClasses,
  ICON_SIZE,
  TIMELINE_SENDER_AGENT_CHIP,
  TIMELINE_SENDER_AGENT_CHIP_DIALOG,
  TIMELINE_SENDER_AGENT_CHIP_ROW,
} from './timelineRowStyles';
import { getSenderAgentLabel, getSenderAgentTitle } from '../../timeline/senderAgentLabel';
import type { SenderAgentSnapshot } from '../../types/message';

import { cn } from '@/lib/utils';

/** Placement-specific width cap. A lookup keeps the chip's own branch count at the minimum. */
const SENDER_AGENT_PLACEMENT_CLASS = {
  row: TIMELINE_SENDER_AGENT_CHIP_ROW,
  dialog: TIMELINE_SENDER_AGENT_CHIP_DIALOG,
} as const;

/** Type badge for handoff and notice messages. Every other message type renders nothing. */
export function TimelineMessageTypeBadge({ type }: { type: string }) {
  if (type === 'handoff') {
    return (
      <span className={`${BADGE_BASE} bg-chatroom-status-purple/15 text-chatroom-status-purple`}>
        <ArrowRightLeft size={ICON_SIZE} className="flex-shrink-0" />
        handoff
      </span>
    );
  }
  if (type === 'notice') {
    return (
      <span className={`${BADGE_BASE} bg-chatroom-status-info/15 text-chatroom-status-info`}>
        <Info size={ICON_SIZE} className="flex-shrink-0" aria-hidden="true" />
        notice
      </span>
    );
  }
  return null;
}

/**
 * Sender → target route. Renders the sender and Telegram tag as direct children so they
 * wrap as separate items, and the arrow with the target role as one unbreakable group.
 * The caller's flex wrapper owns layout.
 */
export function TimelineMessageRoute({
  senderRole,
  targetRole,
  sourcePlatform,
}: {
  senderRole: string;
  targetRole?: string;
  sourcePlatform?: string;
}) {
  return (
    <>
      <span className={getSenderClasses(senderRole)}>{senderRole}</span>
      {sourcePlatform === 'telegram' && (
        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-chatroom-text-muted bg-chatroom-bg-tertiary rounded">
          Telegram
        </span>
      )}
      {targetRole && (
        <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
          <ArrowRight size={10} className="text-chatroom-text-muted flex-shrink-0" />
          <span className={getSenderClasses(targetRole)}>{targetRole}</span>
        </span>
      )}
    </>
  );
}

/**
 * Harness · model chip for handoff messages. Renders nothing unless the type is `handoff`
 * and the snapshot normalizes to a usable harness; no placeholder text for legacy rows.
 */
export function TimelineSenderAgentChip({
  type,
  senderAgent,
  placement,
}: {
  type: string;
  senderAgent: SenderAgentSnapshot | undefined;
  placement: 'row' | 'dialog';
}) {
  const label = getSenderAgentLabel(type, senderAgent);
  if (!label) return null;
  return (
    <span
      data-testid="timeline-sender-agent"
      title={getSenderAgentTitle(label)}
      className={cn(TIMELINE_SENDER_AGENT_CHIP, SENDER_AGENT_PLACEMENT_CLASS[placement])}
    >
      <span className="shrink-0">{label.harness}</span>
      {label.model !== undefined && (
        <>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="truncate min-w-0">{label.model}</span>
        </>
      )}
    </span>
  );
}
