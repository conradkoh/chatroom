'use client';

import { ArrowRight, ArrowRightLeft, Info, ListChecks } from 'lucide-react';

import {
  BADGE_BASE,
  getSenderClasses,
  ICON_SIZE,
  TIMELINE_AGENT_DOT,
  TIMELINE_AGENT_HARNESS,
  TIMELINE_AGENT_LINE,
  TIMELINE_AGENT_MODEL,
  TIMELINE_AGENT_PLACEMENT,
  type SenderAgentPlacement,
} from './timelineRowStyles';
import { getSenderAgentLabel, getSenderAgentTitle } from '../../timeline/senderAgentLabel';
import type { SenderAgentSnapshot } from '../../types/message';

import { cn } from '@/lib/utils';

/** Type badge for handoff, notice and plan messages. Every other message type renders nothing. */
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
  if (type === 'plan') {
    return (
      <span className={`${BADGE_BASE} bg-chatroom-status-success/15 text-chatroom-status-success`}>
        <ListChecks size={ICON_SIZE} className="flex-shrink-0" aria-hidden="true" />
        plan
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
 * Harness · model agent line for handoff messages. Renders nothing unless the type is `handoff`
 * and the snapshot normalizes to a usable harness; no placeholder text for legacy rows.
 * Each segment has its own budget from TIMELINE_AGENT_PLACEMENT; the model takes the remainder.
 */
export function TimelineSenderAgentLine({
  type,
  senderAgent,
  placement,
}: {
  type: string;
  senderAgent: SenderAgentSnapshot | undefined;
  placement: SenderAgentPlacement;
}) {
  const label = getSenderAgentLabel(type, senderAgent);
  if (!label) return null;
  const budget = TIMELINE_AGENT_PLACEMENT[placement];
  return (
    <span
      data-testid="timeline-sender-agent"
      data-placement={placement}
      title={getSenderAgentTitle(label)}
      className={cn(TIMELINE_AGENT_LINE, budget.line)}
    >
      <span
        data-testid="timeline-sender-agent-harness"
        className={cn(TIMELINE_AGENT_HARNESS, budget.harness)}
      >
        {label.harness}
      </span>
      {label.model !== undefined && (
        <>
          <span aria-hidden="true" className={TIMELINE_AGENT_DOT}>
            ·
          </span>
          <span
            data-testid="timeline-sender-agent-model"
            className={cn(TIMELINE_AGENT_MODEL, budget.model)}
          >
            {label.model}
          </span>
        </>
      )}
    </span>
  );
}
