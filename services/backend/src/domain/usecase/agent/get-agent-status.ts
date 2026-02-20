/**
 * Use Case: Get Agent Status
 *
 * Single source of truth for computing an agent's display status.
 * Consolidates all status signals into one priority-based resolution:
 *
 *   1. Desired state (user intent: stopping/starting transitions)
 *   2. Pending commands (transitional states)
 *   3. Participant status + TTL expiration (actual lifecycle state)
 *
 * Valid statuses are a function of agent type:
 *
 *   Remote agents (daemon-managed):
 *     offline, starting, ready, working, stopping, restarting, dead, dead_failed_revive
 *
 *   Custom agents (user-managed):
 *     offline, ready, working, dead
 *     (no starting/stopping/restarting/dead_failed_revive — platform can't control these)
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

// ─── Valid Status Sets ───────────────────────────────────────────────────────

export const REMOTE_AGENT_STATUSES = [
  'offline',
  'starting',
  'ready',
  'working',
  'stopping',
  'restarting',
  'dead',
  'dead_failed_revive',
] as const;

export const CUSTOM_AGENT_STATUSES = ['offline', 'ready', 'working', 'dead'] as const;

export type RemoteAgentDisplayStatus = (typeof REMOTE_AGENT_STATUSES)[number];
export type CustomAgentDisplayStatus = (typeof CUSTOM_AGENT_STATUSES)[number];
export type AgentDisplayStatus = RemoteAgentDisplayStatus | CustomAgentDisplayStatus;

// ─── Input / Output Types ────────────────────────────────────────────────────

export interface GetAgentStatusInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
}

interface AgentStatusResultBase {
  statusReason: string;
  isExpired: boolean;
  desiredStatus?: 'running' | 'stopped';
  hasPendingCommand?: boolean;
}

export interface RemoteAgentStatusResult extends AgentStatusResultBase {
  agentType: 'remote';
  displayStatus: RemoteAgentDisplayStatus;
}

export interface CustomAgentStatusResult extends AgentStatusResultBase {
  agentType: 'custom';
  displayStatus: CustomAgentDisplayStatus;
}

export interface UnknownAgentStatusResult extends AgentStatusResultBase {
  agentType: undefined;
  displayStatus: AgentDisplayStatus;
}

export type AgentStatusResult =
  | RemoteAgentStatusResult
  | CustomAgentStatusResult
  | UnknownAgentStatusResult;

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Compute the authoritative display status for an agent.
 *
 * Reads from multiple tables and applies priority-based resolution
 * to determine the most accurate status to show in the UI.
 * The returned displayStatus is constrained to the valid set for the agent type.
 */
export async function getAgentStatus(
  ctx: QueryCtx,
  input: GetAgentStatusInput
): Promise<AgentStatusResult> {
  const { chatroomId, role } = input;
  const now = Date.now();

  // ── Read all signals in parallel ────────────────────────────────────────

  const [participant, desiredState, teamConfig] = await Promise.all([
    ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique(),

    ctx.db
      .query('chatroom_machineAgentDesiredState')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .first(),

    ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .first(),
  ]);

  const agentType = teamConfig?.type;

  if (agentType === 'remote' && teamConfig) {
    return resolveRemoteAgentStatus(ctx, {
      participant,
      desiredState,
      teamConfig,
      chatroomId,
      role,
      now,
    });
  }

  if (agentType === 'custom') {
    return resolveCustomAgentStatus({ participant, desiredState, now });
  }

  // Unknown agent type — use conservative status set
  return resolveUnknownAgentStatus({ participant, desiredState, now });
}

// ─── Remote Agent Resolution ─────────────────────────────────────────────────

interface ResolveRemoteInput {
  participant: ParticipantRecord | null;
  desiredState: DesiredStateRecord | null;
  teamConfig: TeamConfigRecord;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  now: number;
}

async function resolveRemoteAgentStatus(
  ctx: QueryCtx,
  input: ResolveRemoteInput
): Promise<RemoteAgentStatusResult> {
  const { participant, desiredState, teamConfig, chatroomId, role, now } = input;

  const base = { agentType: 'remote' as const };

  // No participant → check for pending start
  if (!participant) {
    if (desiredState?.desiredStatus === 'running' && teamConfig.machineId) {
      const hasPending = await hasPendingCommandForRole(
        ctx,
        teamConfig.machineId,
        chatroomId,
        role,
        'start-agent'
      );
      if (hasPending) {
        return {
          ...base,
          displayStatus: 'starting',
          statusReason: 'Start command dispatched, waiting for agent to join',
          isExpired: false,
          desiredStatus: 'running',
          hasPendingCommand: true,
        };
      }
    }

    return {
      ...base,
      displayStatus: 'offline',
      statusReason: 'No participant record — agent has not joined',
      isExpired: false,
      desiredStatus: desiredState?.desiredStatus,
    };
  }

  const isExpired = computeIsExpired(participant, now);

  // Desired = stopped + participant still alive → STOPPING
  if (
    desiredState?.desiredStatus === 'stopped' &&
    (participant.status === 'waiting' || participant.status === 'active') &&
    !isExpired
  ) {
    const hasPending = teamConfig.machineId
      ? await hasPendingCommandForRole(ctx, teamConfig.machineId, chatroomId, role, 'stop-agent')
      : false;

    return {
      ...base,
      displayStatus: 'stopping',
      statusReason: 'Stop requested, waiting for agent to shut down',
      isExpired: false,
      desiredStatus: 'stopped',
      hasPendingCommand: hasPending,
    };
  }

  // Expired TTL
  if (isExpired) {
    if (desiredState?.desiredStatus === 'running' && teamConfig.machineId) {
      const hasPending = await hasPendingCommandForRole(
        ctx,
        teamConfig.machineId,
        chatroomId,
        role,
        'start-agent'
      );
      if (hasPending) {
        return {
          ...base,
          displayStatus: 'restarting',
          statusReason: 'Agent expired but restart command is pending',
          isExpired: true,
          desiredStatus: 'running',
          hasPendingCommand: true,
        };
      }
    }

    return {
      ...base,
      displayStatus: 'dead',
      statusReason:
        participant.status === 'active'
          ? 'Active agent heartbeat expired — presumed crashed'
          : 'Waiting agent heartbeat expired — presumed disconnected',
      isExpired: true,
      desiredStatus: desiredState?.desiredStatus,
    };
  }

  // Participant status mapping
  return {
    ...base,
    ...mapParticipantStatusRemote(participant, desiredState),
  };
}

function mapParticipantStatusRemote(
  participant: ParticipantRecord,
  desiredState: DesiredStateRecord | null
): Pick<RemoteAgentStatusResult, 'displayStatus' | 'statusReason' | 'isExpired' | 'desiredStatus'> {
  const desiredStatus = desiredState?.desiredStatus;

  switch (participant.status) {
    case 'active':
      return {
        displayStatus: 'working',
        statusReason: 'Agent is actively processing a task',
        isExpired: false,
        desiredStatus,
      };
    case 'waiting':
      return {
        displayStatus: 'ready',
        statusReason: 'Agent is waiting for tasks',
        isExpired: false,
        desiredStatus,
      };
    case 'restarting':
      return {
        displayStatus: 'restarting',
        statusReason: 'Daemon is attempting to restart the agent',
        isExpired: false,
        desiredStatus,
      };
    case 'dead_failed_revive':
      return {
        displayStatus: 'dead_failed_revive',
        statusReason: 'All restart attempts exhausted — manual intervention required',
        isExpired: false,
        desiredStatus,
      };
    case 'planned_cleanup':
      return {
        displayStatus: 'dead',
        statusReason: 'Agent flagged for cleanup — may recover if heartbeat arrives',
        isExpired: false,
        desiredStatus,
      };
    case 'dead':
      return {
        displayStatus: 'dead',
        statusReason: 'Agent heartbeat stopped — presumed crashed',
        isExpired: false,
        desiredStatus,
      };
    case 'idle':
      return {
        displayStatus: 'offline',
        statusReason: 'Deprecated idle status — treated as offline',
        isExpired: false,
        desiredStatus,
      };
    case 'offline':
    default:
      return {
        displayStatus: 'offline',
        statusReason: 'Agent is offline',
        isExpired: false,
        desiredStatus,
      };
  }
}

// ─── Custom Agent Resolution ─────────────────────────────────────────────────

interface ResolveCustomInput {
  participant: ParticipantRecord | null;
  desiredState: DesiredStateRecord | null;
  now: number;
}

function resolveCustomAgentStatus(input: ResolveCustomInput): CustomAgentStatusResult {
  const { participant, desiredState, now } = input;
  const base = { agentType: 'custom' as const };

  if (!participant) {
    return {
      ...base,
      displayStatus: 'offline',
      statusReason: 'No participant record — agent has not joined',
      isExpired: false,
      desiredStatus: desiredState?.desiredStatus,
    };
  }

  const isExpired = computeIsExpired(participant, now);

  if (isExpired) {
    return {
      ...base,
      displayStatus: 'dead',
      statusReason:
        participant.status === 'active'
          ? 'Active agent heartbeat expired — presumed crashed'
          : 'Waiting agent heartbeat expired — presumed disconnected',
      isExpired: true,
      desiredStatus: desiredState?.desiredStatus,
    };
  }

  return {
    ...base,
    ...mapParticipantStatusCustom(participant, desiredState),
  };
}

function mapParticipantStatusCustom(
  participant: ParticipantRecord,
  desiredState: DesiredStateRecord | null
): Pick<CustomAgentStatusResult, 'displayStatus' | 'statusReason' | 'isExpired' | 'desiredStatus'> {
  const desiredStatus = desiredState?.desiredStatus;

  switch (participant.status) {
    case 'active':
      return {
        displayStatus: 'working',
        statusReason: 'Agent is actively processing a task',
        isExpired: false,
        desiredStatus,
      };
    case 'waiting':
      return {
        displayStatus: 'ready',
        statusReason: 'Agent is waiting for tasks',
        isExpired: false,
        desiredStatus,
      };
    // Custom agents cannot be restarted by the platform — map to dead
    case 'restarting':
    case 'dead_failed_revive':
    case 'planned_cleanup':
    case 'dead':
      return {
        displayStatus: 'dead',
        statusReason: 'Agent is not responding — manual restart required',
        isExpired: false,
        desiredStatus,
      };
    case 'idle':
      return {
        displayStatus: 'offline',
        statusReason: 'Deprecated idle status — treated as offline',
        isExpired: false,
        desiredStatus,
      };
    case 'offline':
    default:
      return {
        displayStatus: 'offline',
        statusReason: 'Agent is offline',
        isExpired: false,
        desiredStatus,
      };
  }
}

// ─── Unknown Agent Type Resolution ───────────────────────────────────────────

interface ResolveUnknownInput {
  participant: ParticipantRecord | null;
  desiredState: DesiredStateRecord | null;
  now: number;
}

function resolveUnknownAgentStatus(input: ResolveUnknownInput): UnknownAgentStatusResult {
  const { participant, desiredState, now } = input;
  const base = { agentType: undefined as undefined };

  if (!participant) {
    return {
      ...base,
      displayStatus: 'offline',
      statusReason: 'No participant record — agent has not joined',
      isExpired: false,
      desiredStatus: desiredState?.desiredStatus,
    };
  }

  const isExpired = computeIsExpired(participant, now);

  if (isExpired) {
    return {
      ...base,
      displayStatus: 'dead',
      statusReason: 'Agent heartbeat expired',
      isExpired: true,
      desiredStatus: desiredState?.desiredStatus,
    };
  }

  // Use the same mapping as custom (conservative — no daemon-specific states)
  const mapped = mapParticipantStatusCustom(participant, desiredState);
  return { ...base, ...mapped };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ParticipantRecord = {
  status: string;
  readyUntil?: number;
  activeUntil?: number;
};

type DesiredStateRecord = {
  desiredStatus: 'running' | 'stopped';
};

type TeamConfigRecord = {
  type: 'remote' | 'custom';
  machineId?: string;
};

function computeIsExpired(participant: ParticipantRecord, now: number): boolean {
  return (
    (participant.status === 'waiting' &&
      participant.readyUntil != null &&
      participant.readyUntil < now) ||
    (participant.status === 'active' &&
      participant.activeUntil != null &&
      participant.activeUntil < now)
  );
}

/**
 * Check if there's a pending command of a given type for a specific role.
 * Queries the machine command queue and filters in memory.
 */
async function hasPendingCommandForRole(
  ctx: QueryCtx,
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  commandType: 'start-agent' | 'stop-agent'
): Promise<boolean> {
  const pendingCommands = await ctx.db
    .query('chatroom_machineCommands')
    .withIndex('by_machineId_status', (q) => q.eq('machineId', machineId).eq('status', 'pending'))
    .collect();

  return pendingCommands.some(
    (cmd) =>
      cmd.type === commandType &&
      cmd.payload.chatroomId === chatroomId &&
      cmd.payload.role?.toLowerCase() === role.toLowerCase()
  );
}
