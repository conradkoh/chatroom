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
  /** Team-order roles rendered below the group row: statusVariant working or error. */
  outsideRoles: string[];
  /** Team-order roles rendered inside the group: everything else, including roles with no status row. */
  memberRoles: string[];
  /** null while status data is loading; the group row then shows the loading line. */
  counts: EphemeralGroupCounts | null;
}

export const EPHEMERAL_GROUP_LOADING_LABEL = 'Loading statuses…';
export const EPHEMERAL_GROUP_EMPTY_LABEL = 'No agents in group';

/** Status variants that render below the group row instead of inside it. */
const OUTSIDE_VARIANTS: ReadonlySet<AgentStatus['statusVariant']> = new Set(['working', 'error']);

/**
 * Splits ephemeral roles into the rows shown below the disclosure group and the
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
  const statusOf = (role: string): AgentStatus | undefined => statusByRole.get(role);
  const isOutside = (role: string): boolean => {
    const variant = statusOf(role)?.statusVariant;
    return variant !== undefined && OUTSIDE_VARIANTS.has(variant);
  };
  const statuses = ephemeralRoles.map(statusOf);
  const online = statuses.filter((status) => status?.online === true).length;
  const errored = statuses.filter((status) => status?.statusVariant === 'error').length;
  const total = ephemeralRoles.length;
  return {
    outsideRoles: ephemeralRoles.filter(isOutside),
    memberRoles: ephemeralRoles.filter((role) => !isOutside(role)),
    counts: { online, offline: total - online - errored, errored, total },
  };
}

/** Visible title of the disclosure row and the start of its accessible name. */
export function ephemeralGroupTitle(total: number): string {
  return `Ephemeral (${total})`;
}

/**
 * Accessible name for the disclosure toggle. It begins with the visible title so
 * label-in-name holds (voice control users can speak the visible text), then
 * states the counts in words and the action the toggle performs.
 */
export function ephemeralGroupAriaLabel(args: {
  expanded: boolean;
  total: number;
  counts: EphemeralGroupCounts | null;
}): string {
  const title = ephemeralGroupTitle(args.total);
  const action = args.expanded ? 'Hide group.' : 'Show group.';
  if (!args.counts) return `${title}: statuses loading. ${action}`;
  const { online, offline, errored } = args.counts;
  return `${title}: ${online} online, ${offline} offline, ${errored} errored. ${action}`;
}

/**
 * Indicator dot colour for a count. Zero counts are muted so three inactive
 * dots never imply activity; semantic tokens keep light and dark mode correct.
 */
const COUNT_INDICATOR_CLASS: Record<EphemeralCountKind, string> = {
  online: 'bg-chatroom-status-success',
  offline: 'bg-chatroom-text-muted',
  errored: 'bg-chatroom-status-error',
};

export function getCountIndicatorClass(kind: EphemeralCountKind, value: number): string {
  return value === 0 ? 'bg-chatroom-text-muted/40' : COUNT_INDICATOR_CLASS[kind];
}

/** Count text colour: only a non-zero errored count draws attention. */
export function getCountTextClass(kind: EphemeralCountKind, value: number): string {
  return kind === 'errored' && value > 0
    ? 'text-chatroom-status-error'
    : 'text-chatroom-text-muted';
}
