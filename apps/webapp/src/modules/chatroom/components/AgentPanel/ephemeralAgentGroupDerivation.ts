// Named `...Derivation` rather than `ephemeralAgentGroup` because the sibling
// `EphemeralAgentGroup.tsx` differs only by case: on case-insensitive
// filesystems (macOS) Vite/TypeScript resolve `./EphemeralAgentGroup` to
// `ephemeralAgentGroup.ts` first, so the component would never load.
import type { AgentStatus } from '../../hooks/useAgentStatuses';

/** The three count buckets shown on the group row. */
export type EphemeralCountKind = 'online' | 'offline' | 'errored';

/**
 * Counts cover every ephemeral role, whether it renders outside the group
 * (working/errored) or inside it. `online` and `errored` are disjoint because
 * an errored agent is never online, so `online + offline + errored === total`.
 */
export interface EphemeralGroupCounts {
  online: number;
  offline: number;
  errored: number;
  total: number;
}

export interface EphemeralAgentGroups {
  /** Team-order roles rendered above the group row: statusVariant working or error. */
  outsideRoles: string[];
  /** Team-order roles rendered inside the group: everything else, including roles with no status row. */
  memberRoles: string[];
  /** null while status data is loading; the group row then shows the loading line. */
  counts: EphemeralGroupCounts | null;
}

export const EPHEMERAL_GROUP_LOADING_LABEL = 'Loading statuses…';
export const EPHEMERAL_GROUP_EMPTY_LABEL = 'No agents in group';

/**
 * Splits ephemeral roles into the rows shown above the disclosure group and the
 * rows shown inside it, and derives the row counts.
 *
 * Constraints:
 * - Membership follows `statusVariant` only: `working` and `error` are outside,
 *   every other variant (and every role without a status row) is a member.
 * - Team order is preserved in both lists; status array order is irrelevant.
 * - While statuses load no role is outside and counts are `null`, so the row
 *   never flashes a misleading split or zeroed counts.
 * - `online` uses `AgentStatus.online` (the canonical predicate from
 *   `useAgentStatuses`) rather than re-classifying `statusVariant`.
 */
export function deriveEphemeralAgentGroups(
  ephemeralRoles: readonly string[],
  agentStatuses: readonly AgentStatus[],
  isLoadingStatuses: boolean
): EphemeralAgentGroups {
  if (isLoadingStatuses) {
    return { outsideRoles: [], memberRoles: [...ephemeralRoles], counts: null };
  }
  const statusByRole = new Map(agentStatuses.map((status) => [status.role, status]));
  const outsideRoles: string[] = [];
  const memberRoles: string[] = [];
  let online = 0;
  let errored = 0;
  for (const role of ephemeralRoles) {
    const status = statusByRole.get(role);
    if (status?.online) online += 1;
    if (status?.statusVariant === 'error') errored += 1;
    const isOutside = status?.statusVariant === 'working' || status?.statusVariant === 'error';
    if (isOutside) outsideRoles.push(role);
    else memberRoles.push(role);
  }
  const total = ephemeralRoles.length;
  return {
    outsideRoles,
    memberRoles,
    counts: { online, offline: total - online - errored, errored, total },
  };
}

/**
 * Accessible name for the disclosure toggle. Screen readers announce the count
 * summary and the action the toggle performs.
 */
export function ephemeralGroupAriaLabel(args: {
  expanded: boolean;
  counts: EphemeralGroupCounts | null;
}): string {
  const action = args.expanded ? 'Hide group.' : 'Show group.';
  if (!args.counts) return `Ephemeral agents: statuses loading. ${action}`;
  const { online, offline, errored } = args.counts;
  return `Ephemeral agents: ${online} online, ${offline} offline, ${errored} errored. ${action}`;
}

/**
 * Indicator dot colour for a count. Zero counts are muted so three inactive
 * dots never imply activity; semantic tokens keep light and dark mode correct.
 */
export function getCountIndicatorClass(kind: EphemeralCountKind, value: number): string {
  if (value === 0) return 'bg-chatroom-text-muted/40';
  switch (kind) {
    case 'online':
      return 'bg-chatroom-status-success';
    case 'offline':
      return 'bg-chatroom-text-muted';
    case 'errored':
      return 'bg-chatroom-status-error';
  }
}

/** Count text colour: only a non-zero errored count draws attention. */
export function getCountTextClass(kind: EphemeralCountKind, value: number): string {
  return kind === 'errored' && value > 0
    ? 'text-chatroom-status-error'
    : 'text-chatroom-text-muted';
}
