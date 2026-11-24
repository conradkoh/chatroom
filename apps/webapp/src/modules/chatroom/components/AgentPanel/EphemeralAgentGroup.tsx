'use client';

import { ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import {
  EPHEMERAL_GROUP_EMPTY_LABEL,
  EPHEMERAL_GROUP_LOADING_LABEL,
  ephemeralGroupAriaLabel,
  getCountIndicatorClass,
  getCountTextClass,
  type EphemeralCountKind,
  type EphemeralGroupCounts,
} from './ephemeralAgentGroupDerivation';

import { cn } from '@/lib/utils';

export interface EphemeralAgentGroupProps {
  total: number;
  counts: EphemeralGroupCounts | null;
  expanded: boolean;
  onToggle: () => void;
  memberCount: number;
  /** Member rows rendered by AgentPanel, in team order. */
  children: ReactNode;
}

/**
 * Disclosure row for collapsed ephemeral agents, with a count summary for every
 * ephemeral role (inside and outside the group) and the member rows body.
 *
 * Constraints:
 * - The toggle is a native `<button>`; Enter and Space activation come from the
 *   browser, so no `role`, `tabIndex`, or key handler is added.
 * - `aria-controls` is only set while the body exists (expanded), so the
 *   attribute never points at a missing element.
 * - Membership is not derived here; AgentPanel passes counts, memberCount and
 *   member rows in team order.
 * - Returns a fragment so the body is a sibling of the toggle wrapper, matching
 *   the sidebar row rhythm.
 */
export function EphemeralAgentGroup({
  total,
  counts,
  expanded,
  onToggle,
  memberCount,
  children,
}: EphemeralAgentGroupProps) {
  const bodyId = useId();

  return (
    <>
      <div className="border-b border-chatroom-border last:border-b-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          aria-label={ephemeralGroupAriaLabel({ expanded, counts })}
          data-testid="ephemeral-agent-group-toggle"
          onClick={onToggle}
          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-chatroom-bg-hover focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-chatroom-accent"
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={cn(
              'mt-0.5 shrink-0 text-chatroom-text-muted transition-transform duration-150',
              expanded && 'rotate-90'
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-chatroom-text-primary">
              Ephemeral ({total})
            </span>
            {counts ? (
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wide tabular-nums">
                <EphemeralCount kind="online" value={counts.online} />
                <EphemeralCount kind="offline" value={counts.offline} />
                <EphemeralCount kind="errored" value={counts.errored} />
              </span>
            ) : (
              <span className="mt-1 block animate-pulse text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                {EPHEMERAL_GROUP_LOADING_LABEL}
              </span>
            )}
          </span>
        </button>
      </div>
      {expanded ? (
        <div id={bodyId} data-testid="ephemeral-agent-group-body">
          {memberCount > 0 ? (
            children
          ) : (
            <div className="border-b border-chatroom-border px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted last:border-b-0">
              {EPHEMERAL_GROUP_EMPTY_LABEL}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

function EphemeralCount({ kind, value }: { kind: EphemeralCountKind; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn('h-2 w-2 shrink-0', getCountIndicatorClass(kind, value))} />
      <span className={getCountTextClass(kind, value)}>
        {value} {kind}
      </span>
    </span>
  );
}
