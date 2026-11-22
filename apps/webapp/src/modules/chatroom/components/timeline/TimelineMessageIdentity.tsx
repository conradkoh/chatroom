'use client';

import { ArrowRight, ArrowRightLeft, Info } from 'lucide-react';

import { BADGE_BASE, getSenderClasses, ICON_SIZE } from './timelineRowStyles';

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
